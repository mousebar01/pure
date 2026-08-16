import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { connectionErrorMessage, PiApi, normalizedServerUrl } from "./src/api";
import { draftStorageKey, loadDraft, saveDraft } from "./src/draft-store";
import { readCachedDetail, readCachedSessions, writeCachedDetail, writeCachedSessions } from "./src/session-cache";
import { MessageView, ProcessDetailsGroup } from "./src/MessageView";
import { CHAT_BOTTOM_GAP, MESSAGE_SPACING, buildChatList, collectToolResults, shouldShowScrollToBottom, type ChatListItem } from "./src/message-layout";
import { WebAlignedIcon } from "./src/WebAlignedIcon";
import { clearConnection, loadConnection, loadConnections, loadPreferences, loadTheme, saveConnection, savePreferences, saveTheme, selectConnection } from "./src/storage";
import { colors, mono, setActiveTheme, type ThemeMode } from "./src/theme";
import { CONNECTED_SYNC_INTERVAL_MS, reconnectDelayMs } from "./src/reconnect";
import { IDLE_RUN_STATE, applyRunEvent, beginPromptRun as markPromptPending, type MobileRunState } from "./src/run-state";
import type { AgentEvent, AgentMessage, ConnectionConfig, DirectoryEntry, MobileDeviceInfo, MobilePreferences, ModelInfo, SessionDetail, SessionInfo, ToolPreset, WorktreeInfo, WorktreesResponse } from "./src/types";

interface ActiveChat {
  session: SessionInfo;
  initiallyRunning?: boolean;
  initialPrompt?: string;
  initialImages?: Array<{ type: "image"; data: string; mimeType: string }>;
}

interface AttachedImage {
  data: string;
  mimeType: string;
  uri: string;
  fileName: string;
}

function attachedImagesFromPicker(result: ImagePicker.ImagePickerResult): AttachedImage[] {
  if (result.canceled) return [];
  return result.assets.flatMap((asset) => {
    if (!asset.base64 || asset.type === "video") return [];
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) return [];
    return [{
      data: asset.base64,
      mimeType: asset.mimeType || "image/jpeg",
      uri: asset.uri,
      fileName: asset.fileName || "图片",
    }];
  });
}

function AppContent() {
  const [booting, setBooting] = useState(true);
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [preferences, setPreferences] = useState<MobilePreferences>({ thinkingLevel: "auto", toolPreset: "default" });
  const [defaultCwd, setDefaultCwd] = useState("");
  const [selectedCwd, setSelectedCwd] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const api = useMemo(() => config ? new PiApi(config) : null, [config]);
  const appSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appSyncAttempt = useRef(0);
  const appSyncInFlight = useRef(false);
  const appSyncRequested = useRef(false);
  const appActive = useRef(AppState.currentState === "active");
  const appOnline = useRef(true);
  const locallyRunningIds = useRef(new Set<string>());

  useEffect(() => {
    void loadTheme().then((storedTheme) => {
      setActiveTheme(storedTheme);
      refreshAppStyles();
      setThemeMode(storedTheme);
    });
    void loadPreferences().then(setPreferences);
    loadConnection().then(async (stored) => {
      if (!stored?.password || stored.token) { setConfig(stored); return; }
      try {
        const pairing = await new PiApi(stored).pairDevice(Platform.OS === "ios" ? "iPhone / iPad" : "Android device");
        const migrated = { serverUrl: stored.serverUrl, token: pairing.token, deviceId: pairing.device.id };
        await saveConnection(migrated);
        setConfig(migrated);
      } catch {
        setConfig(stored);
      }
    }).finally(() => setBooting(false));
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.sessions();
      setSessions(result.sessions);
      setRunningIds(new Set([...result.runningSessionIds, ...locallyRunningIds.current]));
      void writeCachedSessions(api.serverUrl, result.sessions);
    } catch (cause) {
      const cached = await readCachedSessions(api.serverUrl);
      if (cached) {
        setSessions(cached.sessions);
      }
      throw cause;
    }
  }, [api]);

  const handleSessionCreated = useCallback((session: SessionInfo, initialPrompt: string, initialImages: Array<{ type: "image"; data: string; mimeType: string }>) => {
    setSelectedCwd(session.cwd);
    setSelectedBranch(session.worktreeBranch ?? null);
    setActiveChat({ session, initiallyRunning: true, initialPrompt, initialImages });
    locallyRunningIds.current.add(session.id);
    setRunningIds((current) => new Set(current).add(session.id));
  }, []);

  const handleRunState = useCallback((sessionId: string, running: boolean) => {
    if (running) locallyRunningIds.current.add(sessionId); else locallyRunningIds.current.delete(sessionId);
    setRunningIds((current) => {
      const next = new Set(current);
      if (running) next.add(sessionId); else next.delete(sessionId);
      return next;
    });
    if (!running) void refreshSessions().catch(() => {});
  }, [refreshSessions]);

  useEffect(() => {
    if (selectedCwd) return;
    const recent = sessions[0];
    if (recent) {
      setSelectedCwd(recent.cwd);
      setSelectedBranch(recent.worktreeBranch ?? null);
    } else if (defaultCwd) {
      setSelectedCwd(defaultCwd);
    }
  }, [defaultCwd, selectedCwd, sessions]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;

    const clearRetry = () => {
      if (appSyncTimer.current) clearTimeout(appSyncTimer.current);
      appSyncTimer.current = null;
    };
    const sync = async () => {
      if (disposed || !appActive.current || !appOnline.current) return;
      if (appSyncInFlight.current) {
        appSyncRequested.current = true;
        return;
      }
      clearRetry();
      appSyncRequested.current = false;
      appSyncInFlight.current = true;
      try {
        await Promise.all([refreshSessions(), api.defaultCwd().then(setDefaultCwd)]);
        appSyncAttempt.current = 0;
        if (!disposed && appActive.current && appOnline.current) appSyncTimer.current = setTimeout(() => void sync(), CONNECTED_SYNC_INTERVAL_MS);
      } catch {
        const delay = reconnectDelayMs(appSyncAttempt.current++);
        if (!disposed && appActive.current && appOnline.current) appSyncTimer.current = setTimeout(() => void sync(), delay);
      } finally {
        appSyncInFlight.current = false;
        if (appSyncRequested.current) void sync();
      }
    };

    void sync();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      appActive.current = state === "active";
      if (appActive.current) { appSyncAttempt.current = 0; void sync(); }
      else clearRetry();
    });
    const networkSubscription = NetInfo.addEventListener((state) => {
      appOnline.current = state.isConnected !== false && state.isInternetReachable !== false;
      if (appOnline.current) { appSyncAttempt.current = 0; void sync(); }
      else clearRetry();
    });
    return () => {
      disposed = true;
      clearRetry();
      appStateSubscription.remove();
      networkSubscription();
    };
  }, [api, refreshSessions]);

  const statusBar = <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} backgroundColor="transparent" />;

  if (booting) return <>{statusBar}<Loading label="正在恢复连接" /></>;
  if (!config || !api) {
    return <>{statusBar}<ConnectScreen onConnected={(next) => setConfig(next)} /></>;
  }

  const selectSession = (session: SessionInfo) => {
    setSelectedCwd(session.cwd);
    setSelectedBranch(session.worktreeBranch ?? null);
    setActiveChat({ session, initiallyRunning: runningIds.has(session.id) });
    setDrawerOpen(false);
  };

  const newChat = () => {
    setActiveChat(null);
    setDrawerOpen(false);
  };

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      {statusBar}
      <CompactTopBar
        themeMode={themeMode}
        onToggleTheme={() => {
          const next: ThemeMode = themeMode === "dark" ? "light" : "dark";
          setActiveTheme(next);
          refreshAppStyles();
          setThemeMode(next);
          void saveTheme(next).catch(() => {});
        }}
        running={Boolean(activeChat && runningIds.has(activeChat.session.id))}
        onMenu={() => setDrawerOpen(true)}
        onSessionInfo={() => setSessionInfoOpen(true)}
      />
      <ChatWorkspace
        key={activeChat?.session.id ?? "new"}
        api={api}
        themeMode={themeMode}
        preferences={preferences}
        activeChat={activeChat}
        defaultCwd={selectedCwd || defaultCwd}
        contextBranch={selectedBranch}
        onSessionCreated={handleSessionCreated}
        onRunState={handleRunState}
      />
      <SessionDrawer
        visible={drawerOpen}
        api={api}
        sessions={sessions}
        runningIds={runningIds}
        selectedId={activeChat?.session.id}
        selectedCwd={selectedCwd || defaultCwd}
        selectedBranch={selectedBranch}
        onCwdChange={(cwd, branch) => {
          setSelectedCwd(cwd);
          setSelectedBranch(branch);
          setActiveChat(null);
        }}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refreshSessions}
        onNew={newChat}
        onOpen={selectSession}
        onSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
      />
      <ConnectionSettings
        visible={settingsOpen}
        api={api}
        deviceId={config.deviceId}
        themeMode={themeMode}
        preferences={preferences}
        onThemeChange={(next) => {
          setActiveTheme(next);
          refreshAppStyles();
          setThemeMode(next);
          void saveTheme(next).catch(() => {});
        }}
        onPreferencesChange={(next) => {
          setPreferences(next);
          void savePreferences(next).catch(() => {});
        }}
        onClose={() => setSettingsOpen(false)}
        onDisconnected={async () => {
          await clearConnection();
          locallyRunningIds.current.clear();
          setConfig(null);
          setSessions([]);
          setActiveChat(null);
          setSettingsOpen(false);
        }}
      />
      <SessionInfoSheet visible={sessionInfoOpen} session={activeChat?.session ?? null} running={Boolean(activeChat && runningIds.has(activeChat.session.id))} onClose={() => setSessionInfoOpen(false)} />
    </SafeAreaView>
  );
}

function ConnectScreen({ onConnected }: { onConnected: (config: ConnectionConfig) => void }) {
  const [serverUrl, setServerUrl] = useState("http://192.168.1.100:30001");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<ConnectionConfig[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => { void loadConnections().then((stored) => setProfiles(stored.profiles)); }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    const next = { serverUrl: normalizedServerUrl(serverUrl), password };
    try {
      const bootstrapApi = new PiApi(next);
      await bootstrapApi.health();
      const pairing = await bootstrapApi.pairDevice(Platform.OS === "ios" ? "iPhone / iPad" : "Android device");
      const paired = { serverUrl: next.serverUrl, token: pairing.token, deviceId: pairing.device.id };
      await saveConnection(paired);
      onConnected(paired);
    } catch (cause) {
      setError(connectionErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.connectPage} edges={["top", "bottom"]}>
      <Text style={styles.connectLogo}>Pi</Text>
      <Text style={styles.connectTitle}>连接 pure</Text>
      <Text style={styles.connectLead}>使用电脑上的服务地址继续工作</Text>
      <View style={styles.form}>
        <Pressable onPress={() => setScannerOpen(true)} style={({ pressed }) => [styles.scanButton, pressed && styles.buttonPressed]}>
          <Ionicons name="scan-outline" color={colors.ink} size={19} /><Text style={styles.scanButtonText}>扫描电脑上的二维码</Text>
        </Pressable>
        <View style={styles.connectDivider}><View style={styles.connectDividerLine} /><Text style={styles.connectDividerText}>或手动连接</Text><View style={styles.connectDividerLine} /></View>
        <Text style={styles.label}>服务器地址</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" value={serverUrl} onChangeText={setServerUrl} style={styles.input} placeholderTextColor={colors.faint} />
        <Text style={styles.label}>访问密码</Text>
        <TextInput secureTextEntry value={password} onChangeText={setPassword} style={styles.input} placeholder="PURE_PASSWORD" placeholderTextColor={colors.faint} />
        {Boolean(error) && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={busy || !serverUrl.trim()} onPress={connect} style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.buttonPressed]}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryButtonText}>连接</Text><Ionicons name="arrow-forward" color="#fff" size={17} /></>}
        </Pressable>
      </View>
      {profiles.length > 0 && <View style={styles.savedProfiles}>
        <Text style={styles.savedProfilesTitle}>已保存的电脑</Text>
        {profiles.map((profile) => <Pressable key={profile.profileId || profile.serverUrl} onPress={async () => {
          const selected = profile.profileId ? await selectConnection(profile.profileId) : profile;
          if (!selected) return;
          setBusy(true); setError("");
          try { await new PiApi(selected).health(); onConnected(selected); } catch (cause) { setError(connectionErrorMessage(cause)); } finally { setBusy(false); }
        }} style={({ pressed }) => [styles.savedProfileRow, pressed && styles.topBarButtonPressed]}>
          <View style={styles.savedProfileIcon}><Ionicons name="desktop-outline" size={17} color={colors.muted} /></View>
          <View style={styles.savedProfileCopy}><Text style={styles.savedProfileName}>{profile.name || "pure"}</Text><Text style={styles.savedProfileUrl}>{profile.serverUrl}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Pressable>)}
      </View>}
      <Text style={styles.securityNote}>HTTP 仅用于可信局域网。远程访问请使用 HTTPS 或受信 VPN。</Text>
      <PairingScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onConnected={onConnected} />
    </SafeAreaView>
  );
}

function PairingScanner({ visible, onClose, onConnected }: { visible: boolean; onClose: () => void; onConnected: (config: ConnectionConfig) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const permissionBlocked = permission?.granted === false && permission.canAskAgain === false;

  useEffect(() => {
    if (visible && permission?.status === "undetermined") {
      void requestPermission();
    }
  }, [permission?.status, requestPermission, visible]);

  const requestCameraAccess = () => {
    if (permissionBlocked) {
      void Linking.openSettings();
      return;
    }
    void requestPermission();
  };

  const scan = async ({ data }: BarcodeScanningResult) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const payload = new URL(data);
      if (payload.protocol !== "pure-mobile:" || payload.hostname !== "pair") throw new Error("这不是 Pure Mobile 配对二维码。");
      const serverUrl = payload.searchParams.get("server");
      const id = payload.searchParams.get("id");
      const secret = payload.searchParams.get("secret");
      if (!serverUrl || !id || !secret) throw new Error("二维码缺少配对信息，请在电脑上刷新后重试。");
      const api = new PiApi({ serverUrl });
      const pairing = await api.redeemPairing(id, secret, Platform.OS === "ios" ? "iPhone / iPad" : "Android device");
      const hostname = new URL(serverUrl).hostname;
      const paired: ConnectionConfig = { serverUrl, name: hostname, token: pairing.token, deviceId: pairing.device.id };
      const pairedApi = new PiApi(paired);
      try {
        await pairedApi.health();
      } catch (cause) {
        await pairedApi.revokeCurrentDevice().catch(() => {});
        throw cause;
      }
      await saveConnection(paired);
      onClose();
      onConnected((await loadConnection()) || paired);
    } catch (cause) {
      setError(connectionErrorMessage(cause));
      setBusy(false);
    }
  };

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.scannerPage} edges={["top", "bottom"]}>
      <View style={styles.scannerHeader}><Pressable accessibilityLabel="关闭扫码" onPress={onClose} style={styles.topBarButton}><Ionicons name="close" size={22} color={colors.ink} /></Pressable><Text style={styles.scannerTitle}>扫描配对二维码</Text><View style={styles.topBarButton} /></View>
      <View style={styles.scannerViewport}>
        {permission?.granted ? <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={busy ? undefined : scan} /> : <View style={styles.scannerPermission}><Ionicons name="camera-outline" size={28} color={colors.muted} /><Text style={styles.scannerPermissionText}>{permissionBlocked ? "相机权限已关闭，请在系统设置中开启" : "需要相机权限才能扫描二维码"}</Text><Pressable onPress={requestCameraAccess} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{permissionBlocked ? "打开系统设置" : "允许使用相机"}</Text></Pressable></View>}
        {permission?.granted && <View pointerEvents="none" style={styles.scanFrame}><View style={styles.scanCornerTL} /><View style={styles.scanCornerTR} /><View style={styles.scanCornerBL} /><View style={styles.scanCornerBR} /></View>}
      </View>
      <View style={styles.scannerFooter}>{busy ? <><ActivityIndicator color={colors.accent} /><Text style={styles.scannerHint}>正在验证并连接</Text></> : <Text style={styles.scannerHint}>{error || "将电脑上的二维码放入框内"}</Text>}</View>
    </SafeAreaView>
  </Modal>;
}

function CompactTopBar({ running, themeMode, onToggleTheme, onMenu, onSessionInfo }: { running: boolean; themeMode: ThemeMode; onToggleTheme: () => void; onMenu: () => void; onSessionInfo: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable accessibilityLabel="显示侧边栏" onPress={onMenu} style={styles.topBarButton}>
        <Ionicons name="menu-outline" size={21} color={colors.muted} />
      </Pressable>
      <Pressable accessibilityLabel={themeMode === "dark" ? "切换到日间模式" : "切换到夜间模式"} onPress={onToggleTheme} style={({ pressed }) => [styles.topBarButton, pressed && styles.topBarButtonPressed]}>
        <Ionicons name={themeMode === "dark" ? "sunny-outline" : "moon-outline"} size={18} color={colors.muted} />
      </Pressable>
      <View accessibilityLabel="分支导航将在后续版本提供" style={styles.topBarButton}><Ionicons name="git-branch-outline" size={17} color={colors.faint} /></View>
      <View style={styles.topBarSpacer} />
      {running && <View style={styles.topRunning}><View style={styles.runningDot} /><Text style={styles.topRunningText}>运行中</Text></View>}
      <Pressable accessibilityLabel="会话信息" disabled={!onSessionInfo} onPress={onSessionInfo} style={({ pressed }) => [styles.topBarButton, pressed && styles.topBarButtonPressed]}><Ionicons name="information-circle-outline" size={18} color={colors.muted} /></Pressable>
    </View>
  );
}

function SessionInfoSheet({ visible, session, running, onClose }: { visible: boolean; session: SessionInfo | null; running: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <SafeAreaView style={styles.settingsSheet} edges={["bottom"]}>
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>会话信息</Text><Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.settingsBody} showsVerticalScrollIndicator={false}>
            {session ? <>
              <Text style={styles.settingsLabel}>名称</Text><Text style={styles.settingsValue}>{session.name || session.firstMessage || "未命名会话"}</Text>
              <Text style={styles.settingsLabel}>工作目录</Text><Text selectable style={styles.settingsValue}>{session.cwd}</Text>
              <Text style={styles.settingsLabel}>消息</Text><Text style={styles.settingsValue}>{session.messageCount} 条</Text>
              <Text style={styles.settingsLabel}>状态</Text><View style={styles.sessionStatusRow}><View style={[styles.runningDot, !running && styles.idleDot]} /><Text style={styles.settingsValue}>{running ? "运行中" : "空闲"}</Text></View>
            </> : <Text style={styles.settingsError}>新对话尚未创建会话</Text>}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SessionDrawer({ visible, api, sessions, runningIds, selectedId, selectedCwd, selectedBranch, onCwdChange, onClose, onRefresh, onNew, onOpen, onSettings }: {
  visible: boolean;
  api: PiApi;
  sessions: SessionInfo[];
  runningIds: Set<string>;
  selectedId?: string;
  selectedCwd: string;
  selectedBranch: string | null;
  onCwdChange: (cwd: string, branch: string | null) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNew: () => void;
  onOpen: (session: SessionInfo) => void;
  onSettings: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SessionInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [worktreePickerOpen, setWorktreePickerOpen] = useState(false);
  const [worktreeState, setWorktreeState] = useState<WorktreesResponse | null>(null);
  const [worktreeLoading, setWorktreeLoading] = useState(false);
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const cwdLabel = selectedCwd ? compactPath(selectedCwd) : "选择工作目录";
  useEffect(() => {
    if (!visible || !selectedCwd) return;
    let cancelled = false;
    setWorktreeState(null);
    setWorktreeLoading(true);
    void api.worktrees(selectedCwd)
      .then((value) => { if (!cancelled) setWorktreeState(value); })
      .catch(() => { if (!cancelled) setWorktreeState(null); })
      .finally(() => { if (!cancelled) setWorktreeLoading(false); });
    return () => { cancelled = true; };
  }, [api, selectedCwd, visible]);
  const currentWorktree = worktreeState?.worktrees.find((item) => item.path === selectedCwd);
  const branchLabel = currentWorktree?.branch ?? selectedBranch ?? (worktreeState?.isGit ? "main" : "非 Git 目录");
  const selectedProjectRoot = worktreeState?.projectRoot
    ?? sessions.find((item) => item.cwd === selectedCwd)?.projectRoot
    ?? selectedCwd;
  const filteredSessions = sessions.filter((item) => {
    const projectRoot = item.projectRoot ?? item.cwd;
    if (projectRoot !== selectedProjectRoot) return false;
    if (currentWorktree && !currentWorktree.isMain) return item.cwd === currentWorktree.path || item.worktreeBranch === currentWorktree.branch;
    if (currentWorktree?.isMain) return !item.worktreeBranch;
    return item.cwd === selectedCwd || projectRoot === selectedCwd;
  });
  const beginRename = (session: SessionInfo) => {
    setRenameTarget(session);
    setRenameValue(session.name || session.firstMessage || "");
  };
  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try { await api.renameSession(renameTarget.id, renameValue.trim()); await onRefresh(); setRenameTarget(null); }
    catch (cause) { Alert.alert("重命名失败", cause instanceof Error ? cause.message : String(cause)); }
    finally { setRenaming(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.drawerLayer}>
        <Pressable accessibilityLabel="关闭侧边栏" onPress={onClose} style={styles.drawerBackdrop} />
        <SafeAreaView style={styles.drawer} edges={["top", "bottom"]}>
          <View style={styles.drawerCommands}>
            <Pressable onPress={onNew} style={styles.newChatButton}>
              <Ionicons name="add" size={18} color={colors.muted} />
              <Text style={styles.newChatText}>新对话</Text>
            </Pressable>
            <Pressable accessibilityLabel="刷新" onPress={() => void refresh()} style={styles.refreshButton}>
              <Ionicons name="refresh-outline" size={18} color={colors.muted} />
            </Pressable>
          </View>
          <Pressable onPress={() => setDirectoryPickerOpen(true)} style={({ pressed }) => [styles.contextButton, pressed && styles.topBarButtonPressed]}>
            <Ionicons name="folder-outline" size={15} color={colors.muted} />
            <Text numberOfLines={1} style={styles.contextText}>{cwdLabel}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.faint} />
          </Pressable>
          <Pressable disabled={worktreeLoading || !worktreeState?.isGit || worktreeState.worktrees.length === 0} onPress={() => setWorktreePickerOpen(true)} style={({ pressed }) => [styles.contextButton, pressed && styles.topBarButtonPressed]}>
            <Ionicons name="git-branch-outline" size={15} color={worktreeState?.isGit ? colors.muted : colors.faint} />
            <Text numberOfLines={1} style={[styles.contextText, !worktreeState?.isGit && styles.contextTextDisabled]}>{worktreeLoading ? "检查分支..." : branchLabel}</Text>
            {currentWorktree?.isMain && <Text style={styles.branchHint}>主分支</Text>}
            <Ionicons name="chevron-down" size={14} color={colors.faint} />
          </Pressable>
          <FlatList
            data={filteredSessions}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
            contentContainerStyle={styles.drawerList}
            ListEmptyComponent={<Text style={styles.drawerEmpty}>还没有历史会话</Text>}
            renderItem={({ item }) => {
              const running = runningIds.has(item.id);
              return (
                <Pressable onPress={() => onOpen(item)} onLongPress={() => beginRename(item)} delayLongPress={420} style={[styles.drawerSession, item.id === selectedId && styles.drawerSessionSelected]}>
                  <Text numberOfLines={2} style={styles.drawerSessionTitle}>{item.name || item.firstMessage || "未命名会话"}</Text>
                  <View style={styles.drawerSessionMeta}>
                    <Text style={styles.drawerMetaText}>{formatRelativeTime(item.modified)}</Text>
                    <Text style={styles.drawerMetaText}>{item.messageCount} 条消息</Text>
                    {running && <><View style={styles.runningDot} /><Text style={styles.drawerRunning}>运行中</Text></>}
                  </View>
                </Pressable>
              );
            }}
          />
          <View style={styles.drawerFooter}>
            <Pressable onPress={onSettings} style={styles.drawerFooterButton}>
              <Ionicons name="settings-outline" size={17} color={colors.muted} />
              <Text style={styles.drawerFooterText}>设置</Text>
            </Pressable>
            <Pressable accessibilityLabel="帮助" style={styles.drawerHelp}><Ionicons name="help-circle-outline" size={19} color={colors.muted} /></Pressable>
          </View>
          <Modal visible={Boolean(renameTarget)} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
            <View style={styles.dialogLayer}>
              <Pressable style={styles.dialogBackdrop} onPress={() => setRenameTarget(null)} />
              <View style={styles.renameDialog}>
                <Text style={styles.renameTitle}>重命名会话</Text>
                <TextInput autoFocus value={renameValue} onChangeText={setRenameValue} onSubmitEditing={() => void submitRename()} style={styles.renameInput} selectTextOnFocus returnKeyType="done" />
                <View style={styles.renameActions}>
                  <Pressable onPress={() => setRenameTarget(null)} style={styles.renameAction}><Text style={styles.renameCancel}>取消</Text></Pressable>
                  <Pressable disabled={renaming || !renameValue.trim()} onPress={() => void submitRename()} style={styles.renameAction}>{renaming ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.renameSave}>保存</Text>}</Pressable>
                </View>
              </View>
            </View>
          </Modal>
          <DirectoryPickerSheet
            visible={directoryPickerOpen}
            api={api}
            initialPath={selectedCwd}
            onClose={() => setDirectoryPickerOpen(false)}
            onSelect={(cwd) => { onCwdChange(cwd, null); setDirectoryPickerOpen(false); }}
          />
          <WorktreePickerSheet
            visible={worktreePickerOpen}
            worktrees={worktreeState?.worktrees ?? []}
            selectedCwd={selectedCwd}
            onClose={() => setWorktreePickerOpen(false)}
            onSelect={(worktree) => { onCwdChange(worktree.path, worktree.branch); setWorktreePickerOpen(false); }}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function DirectoryPickerSheet({ visible, api, initialPath, onClose, onSelect }: {
  visible: boolean;
  api: PiApi;
  initialPath: string;
  onClose: () => void;
  onSelect: (cwd: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");

  const navigate = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.browseCwd(path);
      setCurrentPath(result.path);
      setParentPath(result.parentPath);
      setPathInput(result.path);
      setDirectories(result.directories ?? []);
      setDrives(result.drives ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (visible) void navigate(initialPath || undefined);
  }, [initialPath, navigate, visible]);

  const commit = async () => {
    if (!currentPath || pathInput.trim() !== currentPath || selecting) return;
    setSelecting(true);
    setError("");
    try { onSelect(await api.validateCwd(currentPath)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSelecting(false); }
  };
  const entries = drives ?? directories;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <SafeAreaView style={styles.directorySheet} edges={["bottom"]}>
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>选择工作目录</Text><Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
          <View style={styles.directoryPathRow}>
            <Pressable accessibilityLabel="上一级目录" disabled={loading || (!parentPath && drives === null)} onPress={() => void navigate(parentPath || undefined)} style={styles.directoryUpButton}><Ionicons name="chevron-up" size={18} color={parentPath || drives !== null ? colors.muted : colors.faint} /></Pressable>
            <TextInput autoCapitalize="none" autoCorrect={false} value={pathInput} onChangeText={(value) => { setPathInput(value); setError(""); }} onSubmitEditing={() => void navigate(pathInput.trim())} placeholder="/path/to/project" placeholderTextColor={colors.faint} style={styles.directoryPathInput} returnKeyType="go" />
            <Pressable disabled={loading || !pathInput.trim()} onPress={() => void navigate(pathInput.trim())} style={styles.directoryGoButton}>{loading ? <ActivityIndicator size="small" color={colors.muted} /> : <Text style={styles.directoryGoText}>前往</Text>}</Pressable>
          </View>
          {Boolean(error) && <Text style={styles.directoryError}>{error}</Text>}
          <FlatList
            data={entries}
            keyExtractor={(item) => item.path}
            contentContainerStyle={styles.directoryList}
            ListEmptyComponent={!loading ? <Text style={styles.drawerEmpty}>{drives !== null ? "没有可用磁盘" : "当前目录没有子目录"}</Text> : null}
            renderItem={({ item }) => <Pressable onPress={() => void navigate(item.path)} style={({ pressed }) => [styles.directoryEntry, pressed && styles.topBarButtonPressed]}><Ionicons name={drives !== null ? "server-outline" : "folder-outline"} size={17} color={colors.muted} /><Text numberOfLines={1} style={styles.directoryEntryText}>{item.name}</Text><Ionicons name="chevron-forward" size={15} color={colors.faint} /></Pressable>}
          />
          <View style={styles.directoryActions}>
            <Pressable onPress={onClose} style={styles.directoryCancel}><Text style={styles.renameCancel}>取消</Text></Pressable>
            <Pressable disabled={!currentPath || pathInput.trim() !== currentPath || selecting} onPress={() => void commit()} style={[styles.directorySelect, (!currentPath || pathInput.trim() !== currentPath || selecting) && styles.sendDisabled]}>{selecting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.directorySelectText}>选择此目录</Text>}</Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function WorktreePickerSheet({ visible, worktrees, selectedCwd, onClose, onSelect }: {
  visible: boolean;
  worktrees: WorktreeInfo[];
  selectedCwd: string;
  onClose: () => void;
  onSelect: (worktree: WorktreeInfo) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <SafeAreaView style={styles.worktreeSheet} edges={["bottom"]}>
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>选择分支</Text><Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
          <FlatList
            data={worktrees}
            keyExtractor={(item) => item.path}
            contentContainerStyle={styles.worktreeList}
            renderItem={({ item }) => {
              const selected = item.path === selectedCwd;
              return <Pressable onPress={() => onSelect(item)} style={[styles.worktreeOption, selected && styles.modelOptionSelected]}><Ionicons name="git-branch-outline" size={17} color={selected ? colors.accent : colors.muted} /><View style={styles.modelOptionCopy}><Text numberOfLines={1} style={styles.modelOptionName}>{item.branch || compactPath(item.path)}</Text><Text numberOfLines={1} style={styles.modelOptionId}>{item.isMain ? "主工作区" : compactPath(item.path)}</Text></View>{selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}</Pressable>;
            }}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ConnectionSettings({ visible, api, deviceId, themeMode, preferences, onThemeChange, onPreferencesChange, onClose, onDisconnected }: {
  visible: boolean;
  api: PiApi;
  deviceId?: string;
  themeMode: ThemeMode;
  preferences: MobilePreferences;
  onThemeChange: (theme: ThemeMode) => void;
  onPreferencesChange: (preferences: MobilePreferences) => void;
  onClose: () => void;
  onDisconnected: () => Promise<void>;
}) {
  const [device, setDevice] = useState<MobileDeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setLoadError("");
    void api.currentDevice()
      .then(setDevice)
      .catch((cause) => { setDevice(null); setLoadError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => setLoading(false));
  }, [api, visible]);

  const revoke = () => Alert.alert(
    "吊销本机访问",
    "吊销后，这台设备必须再次输入访问密码才能连接。",
    [
      { text: "取消", style: "cancel" },
      {
        text: "吊销并断开",
        style: "destructive",
        onPress: () => {
          setRevoking(true);
          void api.revokeCurrentDevice()
            .then(onDisconnected)
            .catch((cause) => Alert.alert("吊销失败", cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setRevoking(false));
        },
      },
    ],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <SafeAreaView style={styles.settingsSheet} edges={["bottom"]}>
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>设置</Text><Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.settingsBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.settingsSectionTitle}>外观</Text>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsRowTitle}>主题</Text>
              <View style={styles.settingsSegmented}>
                {(["light", "dark"] as const).map((mode) => <Pressable key={mode} onPress={() => onThemeChange(mode)} style={[styles.settingsSegment, themeMode === mode && styles.settingsSegmentSelected]}><Ionicons name={mode === "light" ? "sunny-outline" : "moon-outline"} size={14} color={themeMode === mode ? colors.ink : colors.muted} /><Text style={[styles.settingsSegmentText, themeMode === mode && styles.settingsSegmentTextSelected]}>{mode === "light" ? "浅色" : "深色"}</Text></Pressable>)}
              </View>
            </View>

            <Text style={styles.settingsSectionTitle}>新对话默认值</Text>
            <View style={styles.settingsRow}>
              <View style={styles.settingsRowCopy}><Text style={styles.settingsRowTitle}>思考等级</Text><Text style={styles.settingsRowDetail}>仅用于新建会话</Text></View>
              <View style={styles.settingsCompactSegments}>{["auto", "off", "medium", "high"].map((level) => <Pressable key={level} onPress={() => onPreferencesChange({ ...preferences, thinkingLevel: level })} style={[styles.settingsCompactSegment, preferences.thinkingLevel === level && styles.settingsCompactSegmentSelected]}><Text style={[styles.settingsCompactText, preferences.thinkingLevel === level && styles.settingsCompactTextSelected]}>{level === "auto" ? "自动" : level === "off" ? "关闭" : level === "medium" ? "中" : "高"}</Text></Pressable>)}</View>
            </View>
            <View style={styles.settingsRow}>
              <View style={styles.settingsRowCopy}><Text style={styles.settingsRowTitle}>工具预设</Text><Text style={styles.settingsRowDetail}>仅用于新建会话</Text></View>
              <View style={styles.settingsCompactSegments}>{(["none", "default", "full"] as ToolPreset[]).map((preset) => <Pressable key={preset} onPress={() => onPreferencesChange({ ...preferences, toolPreset: preset })} style={[styles.settingsCompactSegment, preferences.toolPreset === preset && styles.settingsCompactSegmentSelected]}><Text style={[styles.settingsCompactText, preferences.toolPreset === preset && styles.settingsCompactTextSelected]}>{preset === "none" ? "关闭" : preset === "default" ? "默认" : "完整"}</Text></Pressable>)}</View>
            </View>

            <Text style={styles.settingsSectionTitle}>连接与设备</Text>
            <Text style={styles.settingsLabel}>服务器</Text>
            <Text selectable style={styles.settingsValue}>{api.serverUrl}</Text>
            <Text style={styles.settingsLabel}>当前设备</Text>
            {loading ? <ActivityIndicator color={colors.accent} /> : device ? (
              <View style={styles.deviceRow}>
                <View style={styles.deviceIcon}><Ionicons name="phone-portrait-outline" size={18} color={colors.muted} /></View>
                <View style={styles.deviceCopy}><Text style={styles.deviceName}>{device.name}</Text><Text style={styles.deviceMeta}>配对于 {new Date(device.createdAt).toLocaleDateString("zh-CN")} · {device.id === deviceId ? "本机" : "已验证"}</Text></View>
              </View>
            ) : <Text style={styles.settingsError}>{loadError || "无法读取设备信息"}</Text>}
            <Pressable disabled={revoking || !device} onPress={revoke} style={[styles.dangerButton, (revoking || !device) && styles.sendDisabled]}>{revoking ? <ActivityIndicator color={colors.danger} /> : <><Ionicons name="log-out-outline" size={17} color={colors.danger} /><Text style={styles.dangerButtonText}>吊销本机访问并断开</Text></>}</Pressable>
            <Pressable onPress={() => void onDisconnected()} style={styles.disconnectButton}><Text style={styles.disconnectText}>仅清除本机连接</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ChatWorkspace({ api, themeMode, preferences, activeChat, defaultCwd, contextBranch, onSessionCreated, onRunState }: {
  api: PiApi;
  themeMode: ThemeMode;
  preferences: MobilePreferences;
  activeChat: ActiveChat | null;
  defaultCwd: string;
  contextBranch: string | null;
  onSessionCreated: (session: SessionInfo, initialPrompt: string, initialImages: Array<{ type: "image"; data: string; mimeType: string }>) => void;
  onRunState: (sessionId: string, running: boolean) => void;
}) {
  const session = activeChat?.session;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<AgentMessage | null>(null);
  const [running, setRunning] = useState(Boolean(activeChat?.initiallyRunning));
  const [compacting, setCompacting] = useState(false);
  const [creating, setCreating] = useState(false);
  const draftKey = useMemo(() => draftStorageKey(api.serverUrl, session?.id), [api.serverUrl, session?.id]);
  const [draftRecord, setDraftRecord] = useState({ key: "", text: "" });
  const draftRecordRef = useRef(draftRecord);
  const draft = draftRecord.key === draftKey ? draftRecord.text : "";
  const setDraft = useCallback((value: string | ((current: string) => string)) => {
    setDraftRecord((current) => {
      const currentText = current.key === draftKey ? current.text : "";
      return { key: draftKey, text: typeof value === "function" ? value(currentText) : value };
    });
  }, [draftKey]);
  draftRecordRef.current = draftRecord;
  const [error, setError] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [controlPicker, setControlPicker] = useState<"thinking" | "tools" | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState(preferences.thinkingLevel);
  const [toolPreset, setToolPreset] = useState<ToolPreset>(preferences.toolPreset);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const isAwayFromBottomRef = useRef(false);
  const closeEvents = useRef<null | (() => void)>(null);
  const eventReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventReconnectAttempt = useRef(0);
  const eventGeneration = useRef(0);
  const workspaceActive = useRef(AppState.currentState === "active");
  const workspaceOnline = useRef(true);
  const runningRef = useRef(running);
  const runStateRef = useRef<MobileRunState>(IDLE_RUN_STATE);
  const runGeneration = useRef(0);
  const listRef = useRef<FlatList<ChatListItem>>(null);
  const initialPromptStarted = useRef(false);
  const scrollMetrics = useRef({ offset: 0, viewport: 0, content: 0 });
  runningRef.current = running;

  useEffect(() => {
    let cancelled = false;
    void loadDraft(draftKey).then((text) => {
      if (!cancelled) setDraftRecord((current) => current.key === draftKey ? current : { key: draftKey, text });
    });
    return () => {
      cancelled = true;
      const pending = draftRecordRef.current;
      if (pending.key === draftKey) void saveDraft(draftKey, pending.text);
    };
  }, [draftKey]);

  useEffect(() => {
    if (draftRecord.key !== draftKey) return;
    const timer = setTimeout(() => void saveDraft(draftKey, draftRecord.text), 250);
    return () => clearTimeout(timer);
  }, [draftKey, draftRecord]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void ImagePicker.getPendingResultAsync().then((pending) => {
      if (!pending || "code" in pending) return;
      const recovered = attachedImagesFromPicker(pending);
      if (recovered.length) setImages((current) => [...current, ...recovered].slice(0, 4));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const next = await api.session(session.id);
      setDetail(next);
      void writeCachedDetail(api.serverUrl, next);
    } catch (cause) {
      const cached = await readCachedDetail(api.serverUrl, session.id);
      if (cached) setDetail(cached);
      if (!cached) throw cause;
    }
  }, [api, session]);

  const stopEvents = useCallback(() => {
    eventGeneration.current += 1;
    if (eventReconnectTimer.current) clearTimeout(eventReconnectTimer.current);
    eventReconnectTimer.current = null;
    closeEvents.current?.();
    closeEvents.current = null;
  }, []);

  const finishRun = useCallback(() => {
    if (!session) return;
    runGeneration.current += 1;
    runStateRef.current = IDLE_RUN_STATE;
    runningRef.current = false;
    setRunning(false);
    setCompacting(false);
    setStreamingMessage(null);
    onRunState(session.id, false);
    void load();
  }, [load, onRunState, session]);

  const handleEvent = useCallback((event: AgentEvent) => {
    if ((event.type === "message_start" || event.type === "message_update") && event.message?.role === "assistant") setStreamingMessage(event.message);
    if (event.type === "agent_start" && session) {
      runStateRef.current = applyRunEvent(runStateRef.current, "agent_start").state;
      runningRef.current = true;
      setRunning(true);
      onRunState(session.id, true);
    }
    if (event.type === "prompt_error") setError(event.errorMessage ?? "任务执行失败");
    if (event.type === "compaction_start" || event.type === "auto_compaction_start") setCompacting(true);
    if (event.type === "compaction_end" || event.type === "auto_compaction_end") setCompacting(false);
    if (event.type === "message_end") { if (event.message?.role === "assistant") setStreamingMessage(null); void load(); }
    if (event.type === "agent_end") void load();
    if (event.type === "prompt_done" || event.type === "agent_settled") {
      const transition = applyRunEvent(runStateRef.current, event.type);
      runStateRef.current = transition.state;
      if (transition.settled && runningRef.current) finishRun();
    }
  }, [finishRun, load, onRunState, session]);

  const startEvents = useCallback(() => {
    if (!session || closeEvents.current) return;
    const generation = ++eventGeneration.current;
    const connect = () => {
      if (generation !== eventGeneration.current || closeEvents.current || !workspaceActive.current || !workspaceOnline.current) return;
      let closeSource: (() => void) | null = null;
      closeSource = api.events(session.id, (event) => {
        eventReconnectAttempt.current = 0;
        handleEvent(event);
      }, () => {
        if (generation !== eventGeneration.current || closeEvents.current !== closeSource) return;
        closeSource?.();
        closeEvents.current = null;
        if (!runningRef.current || !workspaceActive.current || !workspaceOnline.current) return;
        const delay = reconnectDelayMs(eventReconnectAttempt.current++);
        eventReconnectTimer.current = setTimeout(connect, delay);
      });
      closeEvents.current = closeSource;
    };
    connect();
  }, [api, handleEvent, session]);

  useEffect(() => {
    if (!session) return;
    const generation = runGeneration.current;
    if (activeChat?.initiallyRunning) startEvents();
    void Promise.all([
      load(),
      api.agentState(session.id).then((state) => {
        if (generation !== runGeneration.current) return;
        const busy = Boolean(state.running && (state.state?.isStreaming || state.state?.isPromptRunning || state.state?.isCompacting));
        runStateRef.current = busy ? {
          promptPending: Boolean(state.state?.isPromptRunning),
          agentActive: Boolean(state.state?.isStreaming),
        } : IDLE_RUN_STATE;
        runningRef.current = busy || Boolean(activeChat?.initialPrompt);
        setRunning(busy || Boolean(activeChat?.initialPrompt));
        setCompacting(Boolean(state.state?.isCompacting));
        onRunState(session.id, busy || Boolean(activeChat?.initialPrompt));
        if (busy || activeChat?.initialPrompt) startEvents();
      }),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return stopEvents;
  }, [activeChat, api, load, onRunState, session, startEvents, stopEvents]);

  useEffect(() => {
    const prompt = activeChat?.initialPrompt;
    if (!session || !prompt || initialPromptStarted.current) return;
    initialPromptStarted.current = true;
    runGeneration.current += 1;
    runStateRef.current = markPromptPending(runStateRef.current);
    runningRef.current = true;
    startEvents();
    void api.command(session.id, { type: "prompt", message: prompt, ...(activeChat.initialImages?.length ? { images: activeChat.initialImages } : {}) }).catch((cause) => {
      setDraft(prompt);
      setError(cause instanceof Error ? cause.message : String(cause));
      finishRun();
    });
  }, [activeChat, api, finishRun, session, setDraft, startEvents]);

  useEffect(() => {
    if (!session || !running) return;
    const reconcile = () => {
      if (!workspaceActive.current || !workspaceOnline.current) return;
      const generation = runGeneration.current;
      void api.agentState(session.id).then((state) => {
        if (generation !== runGeneration.current || !runningRef.current) return;
        const busy = Boolean(state.running && (state.state?.isStreaming || state.state?.isPromptRunning || state.state?.isCompacting));
        setCompacting(Boolean(state.state?.isCompacting));
        if (!busy) finishRun();
        else {
          runStateRef.current = {
            promptPending: Boolean(state.state?.isPromptRunning),
            agentActive: Boolean(state.state?.isStreaming),
          };
          startEvents();
          void load();
        }
      }).catch(() => {});
    };
    const timer = setInterval(reconcile, 4000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      workspaceActive.current = state === "active";
      if (workspaceActive.current) { eventReconnectAttempt.current = 0; reconcile(); } else stopEvents();
    });
    const networkSubscription = NetInfo.addEventListener((state) => {
      workspaceOnline.current = state.isConnected !== false && state.isInternetReachable !== false;
      if (workspaceOnline.current) { eventReconnectAttempt.current = 0; reconcile(); } else stopEvents();
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
      networkSubscription();
    };
  }, [api, finishRun, load, running, session, startEvents, stopEvents]);

  const beginRun = (sessionId: string) => {
    setError("");
    runGeneration.current += 1;
    runningRef.current = true;
    setRunning(true);
    onRunState(sessionId, true);
  };

  const beginPrompt = (sessionId: string) => {
    runStateRef.current = markPromptPending(IDLE_RUN_STATE);
    beginRun(sessionId);
  };

  const send = async () => {
    const message = draft.trim();
    if ((!message && images.length === 0) || running || creating) return;
    const promptText = message || "请查看这些图片。";
    const promptImages = images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
    setAwayFromBottom(false);
    setDraft("");
    setImages([]);
    if (!session) {
      setCreating(true);
      try {
        const cwd = defaultCwd || await api.defaultCwd();
        const result = await api.createSession(cwd, {
          toolPreset,
          ...(selectedModel ? { model: { provider: selectedModel.provider, modelId: selectedModel.id } } : {}),
          ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
        });
        const id = result.sessionId;
        const created: SessionInfo = { id, cwd, created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: 0, firstMessage: promptText };
        await saveDraft(draftKey, "");
        onSessionCreated(created, promptText, promptImages);
      } catch (cause) {
        setDraft(promptText);
        setImages(images);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setCreating(false);
      }
      return;
    }
    beginPrompt(session.id);
    startEvents();
    setDetail((current) => current ? { ...current, context: { ...current.context, messages: [...current.context.messages, { role: "user", content: promptText }] } } : current);
    requestAnimationFrame(performScrollToLatest);
    try {
      await api.command(session.id, { type: "prompt", message: promptText, ...(promptImages.length ? { images: promptImages } : {}) });
      await saveDraft(draftKey, "");
    } catch (cause) {
      setDraft((current) => current.trim() ? `${promptText}\n\n${current}` : promptText);
      setImages((current) => current.length ? current : images);
      setError(`${cause instanceof Error ? cause.message : String(cause)} 内容已恢复，请确认会话中没有该消息后再发送。`);
      finishRun();
    }
  };

  const pickImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 4 - images.length),
        base64: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const selected = attachedImagesFromPicker(result);
      setImages((current) => [...current, ...selected].slice(0, 4));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const abort = async () => {
    if (!session || !running) return;
    try { await api.command(session.id, { type: compacting ? "abort_compaction" : "abort" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const openModelPicker = async () => {
    const cwd = session?.cwd || defaultCwd || await api.defaultCwd();
    if (!cwd) return;
    setModelPickerOpen(true);
    if (models.length > 0) return;
    try { setModels((await api.models(cwd)).modelList); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const selectModel = async (model: ModelInfo) => {
    if (running) return;
    setModelPickerOpen(false);
    if (!session) { setSelectedModel(model); return; }
    try {
      await api.command(session.id, { type: "set_model", provider: model.provider, modelId: model.id });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selectThinking = async (next: string) => {
    if (running) return;
    setControlPicker(null);
    setThinkingLevel(next);
    if (!session) return;
    try { await api.command(session.id, { type: "set_thinking_level", level: next }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const selectTools = async (next: ToolPreset) => {
    if (running) return;
    setControlPicker(null);
    const names = next === "none" ? [] : next === "full" ? ["bash", "read", "edit", "write", "grep", "find", "ls"] : ["read", "bash", "edit", "write"];
    setToolPreset(next);
    if (!session) return;
    try { await api.command(session.id, { type: "set_tools", toolNames: names }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const compact = async () => {
    if (!session || running || messages.length === 0) return;
    beginRun(session.id);
    setCompacting(true);
    startEvents();
    try {
      await api.command(session.id, { type: "compact" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishRun();
    }
  };

  const loadedMessages = (detail?.context.messages ?? []).map((message, index) => (
    message.role === "assistant" && detail?.context.entryIds[index]
      ? { ...message, entryId: detail.context.entryIds[index] }
      : message
  ));
  const initialPrompt = activeChat?.initialPrompt;
  const optimisticInitial = initialPrompt && !loadedMessages.some((message) => message.role === "user")
    ? [{ role: "user" as const, content: initialPrompt }]
    : [];
  const messages = [...optimisticInitial, ...loadedMessages];
  const rawData = streamingMessage ? [...messages, streamingMessage] : messages;
  const data = buildChatList(rawData, running);
  const toolResults = collectToolResults(rawData);
  const loadThinking = session ? (entryId: string, blockIndex: number) => api.thinking(session.id, entryId, blockIndex) : undefined;
  const modelLabel = detail?.context.model?.modelId ?? selectedModel?.id ?? "选择模型";
  const effectiveCwd = session?.cwd || defaultCwd;
  const effectiveBranch = session?.worktreeBranch ?? contextBranch;
  const modelSections = Array.from(
    models.reduce((groups, model) => {
      const group = groups.get(model.provider) ?? [];
      group.push(model);
      groups.set(model.provider, group);
      return groups;
    }, new Map<string, ModelInfo[]>()).entries(),
  ).map(([provider, data]) => ({
    provider,
    data: [...data].sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id)),
  }));
  const setAwayFromBottom = (value: boolean) => {
    isAwayFromBottomRef.current = value;
    setIsAwayFromBottom(value);
  };
  const updateBottomDistance = () => {
    setAwayFromBottom(shouldShowScrollToBottom(scrollMetrics.current, isAwayFromBottomRef.current));
  };
  const captureScrollMetrics = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    scrollMetrics.current = { offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height };
  };
  const handleMessageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    captureScrollMetrics(event);
    updateBottomDistance();
  };
  const performScrollToLatest = () => {
    const { content, viewport } = scrollMetrics.current;
    setAwayFromBottom(false);
    listRef.current?.scrollToOffset({ offset: Math.max(0, content - viewport), animated: false });
  };
  const scrollToLatest = () => {
    listRef.current?.scrollToOffset({ offset: scrollMetrics.current.offset, animated: false });
    requestAnimationFrame(performScrollToLatest);
  };

  return (
    <KeyboardAvoidingView
      style={styles.workspace}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
    >
      {session && !detail && messages.length === 0 ? <Loading label="正在载入会话" /> : (
        <FlatList
          ref={listRef}
          data={data}
          extraData={themeMode}
          keyExtractor={(item) => item.key}
          contentContainerStyle={data.length ? styles.messages : styles.emptyWorkspace}
          keyboardShouldPersistTaps="handled"
          onScroll={handleMessageScroll}
          scrollEventThrottle={32}
          onMomentumScrollEnd={(event) => {
            captureScrollMetrics(event);
            updateBottomDistance();
          }}
          onScrollEndDrag={(event) => { captureScrollMetrics(event); updateBottomDistance(); }}
          ItemSeparatorComponent={() => <View style={styles.messageSeparator} />}
          renderItem={({ item }) => item.type === "process"
            ? <ProcessDetailsGroup messages={item.messages} live={item.live} toolCallCount={item.toolCallCount} themeMode={themeMode} toolResults={toolResults} loadThinking={loadThinking} />
            : <MessageView message={item.message} streaming={item.streaming} themeMode={themeMode} toolResults={toolResults} loadThinking={loadThinking} />}
          onLayout={(event) => {
            scrollMetrics.current.viewport = event.nativeEvent.layout.height;
            if (!isAwayFromBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: false });
              setAwayFromBottom(false);
            } else updateBottomDistance();
          }}
          onContentSizeChange={(_, height) => {
            scrollMetrics.current.content = height;
            if (!isAwayFromBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: false });
              setAwayFromBottom(false);
            } else updateBottomDistance();
          }}
          ListEmptyComponent={<Text style={styles.welcome}>今天想要做什么？</Text>}
          ListFooterComponent={running && !streamingMessage ? <View style={styles.waiting}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.waitingText}>等待模型响应</Text></View> : null}
        />
      )}
      {data.length > 0 && isAwayFromBottom && (
        <View pointerEvents="box-none" style={styles.scrollButtonAnchor}>
          <Pressable accessibilityLabel={running ? "查看正在生成的内容" : "滚动到对话底部"} onPress={scrollToLatest} style={({ pressed }) => [styles.scrollToBottomButton, running && styles.scrollToBottomRunning, pressed && styles.topBarButtonPressed]}>
            {running ? <View style={styles.scrollRunningDots}><View style={styles.scrollRunningDot} /><View style={styles.scrollRunningDot} /><View style={styles.scrollRunningDot} /></View> : <Ionicons name="arrow-down" size={17} color={colors.muted} />}
          </Pressable>
        </View>
      )}
      {Boolean(error) && <View style={styles.errorBar}><Text style={styles.errorBarText}>{error}</Text></View>}
      <View style={styles.composerArea}>
        <View style={styles.composerContext}>
          <Ionicons name="folder-outline" size={12} color={colors.faint} />
          <Text numberOfLines={1} style={styles.composerContextPath}>{compactPath(effectiveCwd)}</Text>
          {effectiveBranch && <><View style={styles.composerContextDivider} /><Ionicons name="git-branch-outline" size={12} color={colors.faint} /><Text numberOfLines={1} style={styles.composerContextBranch}>{effectiveBranch}</Text></>}
        </View>
        {images.length > 0 && (
          <View style={styles.imageTray}>
            {images.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.imagePreviewWrap}>
                <Image alt={image.fileName} source={{ uri: image.uri }} style={styles.imagePreview} />
                <Pressable accessibilityLabel={`移除 ${image.fileName}`} onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeImage}><Ionicons name="close" size={13} color="#fff" /></Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.composerBox}>
          <TextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            editable={!creating}
            placeholder="消息...输入 / 使用命令，输入 @ 查找文件"
            placeholderTextColor={colors.faint}
            style={styles.composerInput}
            maxLength={12000}
          />
          <Pressable accessibilityLabel={running ? "停止" : "发送"} disabled={!running && (!draft.trim() && images.length === 0 || creating)} onPress={running ? abort : send} style={[styles.sendButton, !running && (!draft.trim() && images.length === 0 || creating) && styles.sendDisabled]}>
            <Ionicons name={running ? "stop" : "arrow-forward"} color={running || draft.trim() || images.length ? colors.muted : colors.faint} size={16} />
            <Text style={[styles.sendText, !running && !draft.trim() && images.length === 0 && styles.sendTextDisabled]}>{running ? "停止" : "发送"}</Text>
          </Pressable>
        </View>
        <View style={styles.controlRow}>
          <Pressable accessibilityLabel="附加图片" disabled={images.length >= 4 || running} onPress={() => void pickImages()} style={styles.smallIconButton}><WebAlignedIcon name="attachment" size={17} color={images.length >= 4 || running ? colors.faint : colors.muted} /></Pressable>
          <Pressable accessibilityLabel="选择模型" disabled={running} onPress={() => void openModelPicker()} style={styles.modelButton}><WebAlignedIcon name="model" size={13} color={colors.muted} /><Text numberOfLines={1} style={styles.modelText}>{modelLabel}</Text></Pressable>
          <Pressable onPress={() => setControlsOpen((value) => !value)} style={styles.moreButton}><Text style={styles.moreText}>{controlsOpen ? "收起控件" : "更多控件"}</Text></Pressable>
        </View>
        {controlsOpen && (
          <View style={styles.expandedControls}>
            <Pressable disabled={running} onPress={() => setControlPicker("thinking")} style={styles.expandedControl}><WebAlignedIcon name="thinking" color={colors.muted} /><Text style={styles.expandedControlText}>思考 · {thinkingLevel === "auto" ? detail?.context.thinkingLevel || "自动" : thinkingLevel}</Text></Pressable>
            <Pressable disabled={running} onPress={() => setControlPicker("tools")} style={styles.expandedControl}><WebAlignedIcon name="tools" color={colors.muted} /><Text style={styles.expandedControlText}>工具 · {toolPreset === "none" ? "关闭" : toolPreset === "full" ? "完整" : "默认"}</Text></Pressable>
            <Pressable disabled={!session || running || messages.length === 0} onPress={() => Alert.alert("压缩上下文", "将较早的对话压缩成摘要，以释放上下文空间。", [{ text: "取消", style: "cancel" }, { text: "开始压缩", onPress: () => void compact() }])} style={styles.expandedControl}><WebAlignedIcon name="compact" color={!session || running || messages.length === 0 ? colors.faint : colors.muted} /><Text style={[styles.expandedControlText, (!session || running || messages.length === 0) && styles.controlChipDisabled]}>压缩上下文</Text></Pressable>
          </View>
        )}
      </View>
      <Modal visible={modelPickerOpen} transparent animationType="slide" onRequestClose={() => setModelPickerOpen(false)}>
        <View style={styles.sheetLayer}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setModelPickerOpen(false)} />
          <SafeAreaView style={styles.modelSheet} edges={["bottom"]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>选择模型</Text><Pressable accessibilityLabel="关闭" onPress={() => setModelPickerOpen(false)} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
            {models.length === 0 ? <Loading label="正在加载模型" /> : (
              <SectionList
                sections={modelSections}
                keyExtractor={(item) => `${item.provider}/${item.id}`}
                stickySectionHeadersEnabled
                renderSectionHeader={({ section }) => <View style={styles.providerHeader}><WebAlignedIcon name="model" color={colors.muted} /><Text style={styles.providerHeaderText}>{formatProviderName(section.provider)}</Text><Text style={styles.providerCount}>{section.data.length} 个模型</Text></View>}
                renderItem={({ item }) => {
                  const selected = detail?.context.model?.provider === item.provider && detail.context.model.modelId === item.id || !detail?.context.model && selectedModel?.provider === item.provider && selectedModel.id === item.id;
                  return <Pressable onPress={() => void selectModel(item)} style={[styles.modelOption, selected && styles.modelOptionSelected]}><View style={styles.modelOptionCopy}><Text numberOfLines={1} style={styles.modelOptionName}>{item.name || item.id}</Text><Text numberOfLines={1} style={styles.modelOptionId}>{item.provider} / {item.id}</Text></View>{selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}</Pressable>;
                }}
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>
      <Modal visible={Boolean(controlPicker)} transparent animationType="slide" onRequestClose={() => setControlPicker(null)}>
        <View style={styles.sheetLayer}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setControlPicker(null)} />
          <SafeAreaView style={styles.controlSheet} edges={["bottom"]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{controlPicker === "thinking" ? "选择思考等级" : "选择工具预设"}</Text><Pressable accessibilityLabel="关闭" onPress={() => setControlPicker(null)} style={styles.sheetClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
            {(controlPicker === "thinking"
              ? [
                  { value: "auto", label: "自动", detail: "使用模型或服务器默认值" },
                  { value: "off", label: "关闭", detail: "不使用扩展思考" },
                  { value: "minimal", label: "极少", detail: "最短的思考过程" },
                  { value: "low", label: "低", detail: "快速处理简单任务" },
                  { value: "medium", label: "中", detail: "平衡速度与质量" },
                  { value: "high", label: "高", detail: "用于复杂任务" },
                  { value: "xhigh", label: "极高", detail: "模型支持时使用" },
                  { value: "max", label: "最大", detail: "最大可用思考预算" },
                ]
              : [
                  { value: "none", label: "关闭", detail: "不提供任何工具" },
                  { value: "default", label: "默认", detail: "4 个常用内置工具" },
                  { value: "full", label: "完整", detail: "全部 7 个内置工具" },
                ]
            ).map((option) => {
              const selected = controlPicker === "thinking" ? thinkingLevel === option.value : toolPreset === option.value;
              return <Pressable key={option.value} onPress={() => controlPicker === "thinking" ? void selectThinking(option.value) : void selectTools(option.value as ToolPreset)} style={[styles.controlOption, selected && styles.modelOptionSelected]}><View style={styles.modelOptionCopy}><Text style={styles.modelOptionName}>{option.label}</Text><Text style={styles.modelOptionId}>{option.detail}</Text></View>{selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}</Pressable>;
            })}
          </SafeAreaView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Loading({ label }: { label: string }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>{label}</Text></View>;
}

function formatProviderName(provider: string): string {
  const labels: Record<string, string> = {
    anthropic: "Anthropic",
    google: "Google",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    github: "GitHub",
    "github-copilot": "GitHub Copilot",
  };
  return labels[provider] ?? provider;
}

function compactPath(path: string): string {
  const homeMatch = path.match(/^\/home\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] ?? ""}` : path;
}

function formatRelativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

function createStyles() {
  return StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.panel },
  workspace: { flex: 1, backgroundColor: colors.canvas },
  topBar: { height: 36, flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.panel },
  topBarButton: { width: 36, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: colors.line },
  topBarButtonPressed: { backgroundColor: colors.hover },
  topBarSpacer: { flex: 1 },
  topRunning: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8 },
  topRunningText: { color: colors.muted, fontSize: 10 },
  runningDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warm },
  connectPage: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 28, justifyContent: "center" },
  connectLogo: { color: colors.accent, fontFamily: mono, fontSize: 18, fontWeight: "700", marginBottom: 28 },
  connectTitle: { color: colors.ink, fontSize: 26, fontWeight: "700" },
  connectLead: { color: colors.muted, fontSize: 14, marginTop: 7, marginBottom: 30 },
  form: { gap: 9 },
  scanButton: { height: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  scanButtonText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  connectDivider: { height: 30, flexDirection: "row", alignItems: "center", gap: 10 },
  connectDividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  connectDividerText: { color: colors.faint, fontSize: 11 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 7 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 13, color: colors.ink, fontSize: 16 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  primaryButton: { height: 48, backgroundColor: colors.accent, borderRadius: 6, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  buttonPressed: { opacity: 0.58 },
  securityNote: { color: colors.faint, fontSize: 11, lineHeight: 17, marginTop: 20 },
  savedProfiles: { marginTop: 20, borderTopWidth: 1, borderTopColor: colors.line },
  savedProfilesTitle: { color: colors.faint, fontSize: 11, fontWeight: "600", marginTop: 12, marginBottom: 4 },
  savedProfileRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  savedProfileIcon: { width: 34, height: 34, borderWidth: 1, borderColor: colors.line, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  savedProfileCopy: { flex: 1, minWidth: 0 },
  savedProfileName: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  savedProfileUrl: { color: colors.faint, fontFamily: mono, fontSize: 10, marginTop: 3 },
  scannerPage: { flex: 1, backgroundColor: colors.canvas },
  scannerHeader: { height: 52, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface },
  scannerTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600", textAlign: "center" },
  scannerViewport: { flex: 1, position: "relative", overflow: "hidden", backgroundColor: "#111" },
  scannerPermission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 28 },
  scannerPermissionText: { color: colors.muted, fontSize: 13, textAlign: "center" },
  scanFrame: { position: "absolute", width: 240, height: 240, left: "50%", top: "50%", marginLeft: -120, marginTop: -120 },
  scanCornerTL: { position: "absolute", left: 0, top: 0, width: 30, height: 30, borderLeftWidth: 3, borderTopWidth: 3, borderColor: "#fff" },
  scanCornerTR: { position: "absolute", right: 0, top: 0, width: 30, height: 30, borderRightWidth: 3, borderTopWidth: 3, borderColor: "#fff" },
  scanCornerBL: { position: "absolute", left: 0, bottom: 0, width: 30, height: 30, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: "#fff" },
  scanCornerBR: { position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRightWidth: 3, borderBottomWidth: 3, borderColor: "#fff" },
  scannerFooter: { minHeight: 84, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 24, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  scannerHint: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  drawerLayer: { flex: 1, flexDirection: "row" },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.4)" },
  drawer: { width: 280, height: "100%", backgroundColor: colors.panel, borderRightWidth: 1, borderRightColor: colors.line, paddingHorizontal: 10 },
  drawerCommands: { flexDirection: "row", gap: 8, paddingTop: 10 },
  newChatButton: { flex: 1, height: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  newChatText: { color: colors.ink, fontSize: 13 },
  refreshButton: { width: 36, height: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  contextButton: { height: 36, marginTop: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  contextText: { color: colors.ink, fontFamily: mono, fontSize: 12, flex: 1 },
  contextTextDisabled: { color: colors.faint },
  branchHint: { color: colors.faint, fontSize: 11 },
  drawerList: { paddingVertical: 10 },
  drawerEmpty: { color: colors.faint, fontSize: 12, textAlign: "center", paddingTop: 30 },
  drawerSession: { paddingHorizontal: 6, paddingVertical: 8, borderRadius: 4 },
  drawerSessionSelected: { backgroundColor: colors.selected },
  drawerSessionTitle: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  drawerSessionMeta: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  drawerMetaText: { color: colors.faint, fontSize: 10 },
  drawerRunning: { color: colors.muted, fontSize: 10 },
  drawerFooter: { height: 42, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center" },
  drawerFooterButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 6, height: "100%" },
  drawerFooterText: { color: colors.muted, fontSize: 12 },
  drawerHelp: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dialogLayer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  dialogBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.4)" },
  renameDialog: { width: "100%", maxWidth: 340, backgroundColor: colors.surface, borderRadius: 7, borderWidth: 1, borderColor: colors.line, padding: 16 },
  renameTitle: { color: colors.ink, fontSize: 15, fontWeight: "600", marginBottom: 12 },
  renameInput: { height: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 5, paddingHorizontal: 10, color: colors.ink, fontSize: 16 },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  renameAction: { minWidth: 56, height: 36, alignItems: "center", justifyContent: "center" },
  renameCancel: { color: colors.muted, fontSize: 13 },
  renameSave: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  directorySheet: { height: "76%", backgroundColor: colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: "hidden" },
  directoryPathRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  directoryUpButton: { width: 38, height: 38, borderWidth: 1, borderColor: colors.line, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel },
  directoryPathInput: { flex: 1, minWidth: 0, height: 38, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 9, color: colors.ink, fontFamily: mono, fontSize: 12, backgroundColor: colors.panel },
  directoryGoButton: { minWidth: 52, height: 38, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel },
  directoryGoText: { color: colors.muted, fontSize: 12 },
  directoryError: { color: colors.danger, fontSize: 11, lineHeight: 16, paddingHorizontal: 14, paddingTop: 8 },
  directoryList: { paddingHorizontal: 10, paddingVertical: 6 },
  directoryEntry: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  directoryEntryText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 13 },
  directoryActions: { minHeight: 58, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.line },
  directoryCancel: { height: 38, minWidth: 62, alignItems: "center", justifyContent: "center" },
  directorySelect: { height: 38, minWidth: 108, paddingHorizontal: 14, borderRadius: 6, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  directorySelectText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  worktreeSheet: { maxHeight: "62%", minHeight: 220, backgroundColor: colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: "hidden" },
  worktreeList: { paddingVertical: 6 },
  worktreeOption: { minHeight: 54, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  emptyWorkspace: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  welcome: { color: colors.ink, fontSize: 25, lineHeight: 34, fontWeight: "300", marginBottom: 70 },
  messages: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: CHAT_BOTTOM_GAP },
  messageSeparator: { height: MESSAGE_SPACING },
  waiting: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13 },
  waitingText: { color: colors.muted, fontSize: 12 },
  scrollButtonAnchor: { height: 0, zIndex: 20, alignItems: "center" },
  scrollToBottomButton: { position: "absolute", bottom: 10, width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", shadowColor: "#0f172a", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 8, elevation: 5 },
  scrollToBottomRunning: { borderColor: colors.accent },
  scrollRunningDots: { flexDirection: "row", alignItems: "center", gap: 3 },
  scrollRunningDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  composerArea: { backgroundColor: colors.canvas, paddingHorizontal: 16, paddingTop: 5, paddingBottom: Platform.OS === "android" ? 10 : 6 },
  composerContext: { height: 24, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 3 },
  composerContextPath: { maxWidth: "62%", color: colors.faint, fontFamily: mono, fontSize: 10 },
  composerContextDivider: { width: 1, height: 10, backgroundColor: colors.line, marginHorizontal: 2 },
  composerContextBranch: { flex: 1, minWidth: 0, color: colors.faint, fontFamily: mono, fontSize: 10 },
  imageTray: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 7 },
  imagePreviewWrap: { width: 56, height: 56 },
  imagePreview: { width: 56, height: 56, borderRadius: 5, borderWidth: 1, borderColor: colors.line },
  removeImage: { position: "absolute", top: -5, right: -5, width: 19, height: 19, borderRadius: 10, backgroundColor: "rgba(26,26,26,0.85)", alignItems: "center", justifyContent: "center" },
  composerBox: { minHeight: 54, maxHeight: 150, flexDirection: "row", alignItems: "flex-end", gap: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.surface, padding: 7 },
  composerInput: { flex: 1, minHeight: 38, maxHeight: 132, paddingHorizontal: 7, paddingTop: 8, paddingBottom: 7, color: colors.ink, fontSize: 16, lineHeight: 22 },
  sendButton: { height: 36, minWidth: 70, borderRadius: 9, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 },
  sendDisabled: { opacity: 0.65 },
  sendText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  sendTextDisabled: { color: colors.faint },
  controlRow: { height: 37, flexDirection: "row", alignItems: "center", paddingHorizontal: 2 },
  smallIconButton: { width: 30, height: 32, alignItems: "center", justifyContent: "center" },
  modelButton: { flex: 1, minWidth: 0, height: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4 },
  modelText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
  moreButton: { height: 32, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  moreText: { color: colors.muted, fontSize: 11 },
  expandedControls: { minHeight: 34, flexDirection: "row", flexWrap: "wrap", gap: 5, paddingBottom: 4 },
  expandedControl: { height: 30, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 7 },
  expandedControlText: { color: colors.muted, fontSize: 11 },
  controlChipDisabled: { color: colors.faint, opacity: 0.6 },
  sheetLayer: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
  modelSheet: { height: "62%", backgroundColor: colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: "hidden" },
  controlSheet: { maxHeight: "72%", backgroundColor: colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: "hidden" },
  controlOption: { minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 },
  sheetHeader: { height: 48, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", paddingLeft: 16 },
  sheetTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600" },
  sheetClose: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  modelOption: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 },
  modelOptionSelected: { backgroundColor: colors.accentSoft },
  providerHeader: { height: 36, backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16 },
  providerHeaderText: { color: colors.ink, fontSize: 12, fontWeight: "700", flex: 1 },
  providerCount: { color: colors.faint, fontSize: 10 },
  modelOptionCopy: { flex: 1, minWidth: 0 },
  modelOptionName: { color: colors.ink, fontSize: 14 },
  modelOptionId: { color: colors.faint, fontFamily: mono, fontSize: 10, marginTop: 3 },
  settingsSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: "hidden" },
  settingsBody: { padding: 16, paddingBottom: 28 },
  settingsSectionTitle: { color: colors.faint, fontSize: 11, fontWeight: "600", marginTop: 14, marginBottom: 7 },
  settingsSectionHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  settingsRow: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  settingsRowCopy: { flex: 1, minWidth: 70 },
  settingsRowTitle: { color: colors.ink, fontSize: 14 },
  settingsRowDetail: { color: colors.faint, fontSize: 10, marginTop: 3 },
  settingsSegmented: { flexDirection: "row", borderWidth: 1, borderColor: colors.line, borderRadius: 6, overflow: "hidden" },
  settingsSegment: { minWidth: 72, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 10 },
  settingsSegmentSelected: { backgroundColor: colors.selected },
  settingsSegmentText: { color: colors.muted, fontSize: 12 },
  settingsSegmentTextSelected: { color: colors.ink, fontWeight: "600" },
  settingsCompactSegments: { flexDirection: "row", borderWidth: 1, borderColor: colors.line, borderRadius: 6, overflow: "hidden", flexShrink: 0 },
  settingsCompactSegment: { minWidth: 39, height: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  settingsCompactSegmentSelected: { backgroundColor: colors.selected },
  settingsCompactText: { color: colors.muted, fontSize: 11 },
  settingsCompactTextSelected: { color: colors.ink, fontWeight: "600" },
  settingsLabel: { color: colors.faint, fontSize: 11, marginTop: 4 },
  settingsValue: { color: colors.ink, fontFamily: mono, fontSize: 12 },
  settingsError: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  deviceRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  deviceIcon: { width: 36, height: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  deviceCopy: { flex: 1 },
  deviceName: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  deviceMeta: { color: colors.faint, fontSize: 10, marginTop: 3 },
  sessionStatusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  idleDot: { backgroundColor: colors.faint },
  dangerButton: { height: 44, marginTop: 8, borderWidth: 1, borderColor: "#fecaca", borderRadius: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  dangerButtonText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  disconnectButton: { height: 40, alignItems: "center", justifyContent: "center" },
  disconnectText: { color: colors.muted, fontSize: 12 },
  errorBar: { backgroundColor: "#fef2f2", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#fecaca" },
  errorBarText: { color: colors.danger, fontSize: 11 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: colors.canvas },
  loadingText: { color: colors.muted, fontSize: 12 },
  });
}

let styles = createStyles();

function refreshAppStyles(): void {
  styles = createStyles();
}
