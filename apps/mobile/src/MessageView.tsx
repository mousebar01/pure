import { createContext, memo, useContext, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentMessage, ContentBlock, ToolCallBlock } from "./types";
import { getThemeColors, mono, type ThemeColors, type ThemeMode } from "./theme";

const lightTheme = getThemeColors("light");
const darkTheme = getThemeColors("dark");
const messageThemes = {
  light: { colors: lightTheme, styles: createStyles(lightTheme) },
  dark: { colors: darkTheme, styles: createStyles(darkTheme) },
};
const MessageThemeContext = createContext(messageThemes.light);

function textFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function InlineText({ children, style }: { children: string; style?: object }) {
  const { styles } = useContext(MessageThemeContext);
  const parts = children.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text selectable style={style ?? styles.assistantText}>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) return <Text key={index} style={styles.inlineCode}>{part.slice(1, -1)}</Text>;
        if (part.startsWith("**") && part.endsWith("**")) return <Text key={index} style={styles.strong}>{part.slice(2, -2)}</Text>;
        return part;
      })}
    </Text>
  );
}

function RichText({ children }: { children: string }) {
  const { styles } = useContext(MessageThemeContext);
  const segments = children.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return (
    <View style={styles.richText}>
      {segments.map((segment, index) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const firstLineEnd = segment.indexOf("\n");
          const language = firstLineEnd > 3 ? segment.slice(3, firstLineEnd).trim() : "";
          const code = segment.slice(firstLineEnd > -1 ? firstLineEnd + 1 : 3, -3).trimEnd();
          return (
            <View key={index} style={styles.codeBlock}>
              {Boolean(language) && <Text style={styles.codeLanguage}>{language}</Text>}
              <Text selectable style={styles.codeText}>{code}</Text>
            </View>
          );
        }
        const lines = segment.split("\n");
        return (
          <View key={index}>
            {lines.map((line, lineIndex) => {
              const heading = /^(#{1,3})\s+(.+)$/.exec(line);
              if (heading) return <InlineText key={lineIndex} style={heading[1].length === 1 ? styles.heading1 : heading[1].length === 2 ? styles.heading2 : styles.heading3}>{heading[2]}</InlineText>;
              const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
              if (bullet) return <View key={lineIndex} style={styles.listRow}><Text style={styles.listMarker}>•</Text><InlineText style={styles.listText}>{bullet[1]}</InlineText></View>;
              const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
              if (numbered) return <View key={lineIndex} style={styles.listRow}><Text style={styles.listMarker}>{numbered[1]}.</Text><InlineText style={styles.listText}>{numbered[2]}</InlineText></View>;
              if (!line.trim()) return <View key={lineIndex} style={styles.paragraphGap} />;
              return <InlineText key={lineIndex}>{line}</InlineText>;
            })}
          </View>
        );
      })}
    </View>
  );
}

function toolAction(toolName: string): { label: string; icon: "document-text-outline" | "search-outline" | "create-outline" | "terminal-outline" | "eye-outline" | "build-outline" } {
  const name = toolName.toLowerCase();
  if (name === "read" || name === "ls") return { label: "读取", icon: "document-text-outline" };
  if (name === "grep" || name === "find") return { label: "搜索", icon: "search-outline" };
  if (name === "edit" || name === "write") return { label: "修改", icon: "create-outline" };
  if (name === "bash") return { label: "运行", icon: "terminal-outline" };
  if (name.includes("inspect")) return { label: "检查", icon: "eye-outline" };
  return { label: "工具", icon: "build-outline" };
}

function toolPreview(block: ToolCallBlock): string {
  const input = block.input ?? block.arguments;
  if (!input) return "";
  if (Array.isArray(input.queries)) {
    const queries = input.queries.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (queries.length) return `${queries.slice(0, 2).join(" · ")}${queries.length > 2 ? ` · +${queries.length - 2}` : ""}`;
  }
  const preferred = ["query", "pattern", "path", "file_path", "command"];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function summarizeThinkingPreview(thinking: string, maxLength = 160): string {
  const normalized = thinking.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentence = normalized.match(new RegExp(`^.{1,${maxLength}}?(?:[。！？]|[.!?](?=\\s|$))`))?.[0];
  if (sentence) return sentence.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
}

type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

function ProcessRow({ kind, title, preview, content, result, loadContent, error = false, active = false }: {
  kind: "thinking" | "tool";
  title: string;
  preview?: string;
  content?: string;
  result?: ToolResultMessage;
  loadContent?: () => Promise<string>;
  error?: boolean;
  active?: boolean;
}) {
  const { colors, styles } = useContext(MessageThemeContext);
  const [expanded, setExpanded] = useState(false);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const action = kind === "tool" ? toolAction(title) : null;
  const accent = error ? colors.danger : kind === "thinking" ? "#8b5cf6" : active ? colors.accent : colors.muted;
  const visibleContent = loadedContent ?? content;
  const [previewText, setPreviewText] = useState(preview ?? "");
  useEffect(() => {
    setPreviewText(preview ?? "");
  }, [preview]);
  useEffect(() => {
    if (!loadContent || loadedContent !== null || loading) return;
    let active = true;
    setLoading(true);
    void loadContent().then((value) => {
      if (!active) return;
      setLoadedContent(value);
      setPreviewText(summarizeThinkingPreview(value));
    }).catch((cause) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadContent, loadedContent, loading]);
  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || !loadContent || loadedContent !== null || loading) return;
    setLoading(true);
    setLoadError("");
    try { setLoadedContent(await loadContent()); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => void toggle()} style={styles.processBlock}>
      <View style={styles.processRow}>
        <Ionicons name={kind === "thinking" ? "sparkles-outline" : action?.icon ?? "build-outline"} size={13} color={accent} />
        {kind === "tool" && <Text numberOfLines={1} style={[styles.processLabel, { color: accent }]}>{action?.label}</Text>}
        {Boolean(previewText) && <Text numberOfLines={1} ellipsizeMode="tail" style={styles.processPreview}>{previewText}</Text>}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={colors.faint} />
      </View>
      {expanded && (
        <View style={styles.processExpanded}>
          {(loading || loadError || visibleContent !== undefined) && <Text selectable style={[styles.processContent, Boolean(loadError) && styles.processErrorText]}>{loading ? "正在加载思考内容..." : loadError || visibleContent?.slice(0, 6000) || "(无内容)"}</Text>}
          {result && <View style={[styles.processResult, result.isError && styles.processResultError]}><Text selectable style={[styles.processResultContent, result.isError && styles.processErrorText]}>{textFromContent(result.content).slice(0, 6000) || "(无输出)"}</Text></View>}
        </View>
      )}
    </Pressable>
  );
}

function MessageViewContent({ message, streaming = false, processDetails = false, toolResults, loadThinking }: { message: AgentMessage; streaming?: boolean; processDetails?: boolean; toolResults?: Map<string, ToolResultMessage>; loadThinking?: (entryId: string, blockIndex: number) => Promise<string> }) {
  const { styles } = useContext(MessageThemeContext);
  if (message.role === "custom" && message.display === false) return null;

  if (message.role === "user") {
    return (
      <View style={styles.userMessage}>
        <View style={styles.userBubble}>
          <Text selectable style={styles.userText}>{textFromContent(message.content)}</Text>
        </View>
      </View>
    );
  }

  if (message.role === "toolResult") {
    return <ProcessRow kind="tool" title={message.toolName ?? "工具"} preview={message.isError ? "执行失败" : "已完成"} content={textFromContent(message.content)} error={message.isError} />;
  }

  if (message.role === "bashExecution") {
    return <ProcessRow kind="tool" title="bash" preview={message.command} content={message.output} error={message.exitCode !== undefined && message.exitCode !== 0} active={message.exitCode === undefined} />;
  }

  if (message.role === "custom") return <Text selectable style={styles.custom}>{textFromContent(message.content)}</Text>;

  const blocks = message.content ?? [];
  return (
    <View style={processDetails ? styles.processMessage : styles.assistant}>
      {!processDetails && Boolean(message.model) && <Text style={styles.modelLabel}>{message.model}</Text>}
      <View style={styles.assistantBlocks}>
        {blocks.map((block, index) => {
          if (block.type === "text") return <RichText key={index}>{block.text}</RichText>;
          if (block.type === "thinking") {
            const preview = summarizeThinkingPreview(block.thinking) || (block.deferred ? "" : "思考中");
            const blockIndex = block.sourceBlockIndex ?? index;
            const loader = block.deferred && message.entryId && loadThinking ? () => loadThinking(message.entryId!, blockIndex) : undefined;
            return <ProcessRow key={index} kind="thinking" title="思考" preview={preview} content={block.deferred ? undefined : block.thinking} loadContent={loader} />;
          }
          if (block.type === "toolCall") {
            const toolName = block.toolName ?? block.name ?? "工具";
            const result = block.toolCallId ? toolResults?.get(block.toolCallId) : undefined;
            return <ProcessRow key={index} kind="tool" title={toolName} preview={toolPreview(block)} content={JSON.stringify(block.input ?? block.arguments ?? {}, null, 2)} result={result} active={streaming && !result} />;
          }
          if (block.type === "image") return <Text key={index} style={styles.imageLabel}>[图片]</Text>;
          return null;
        })}
      </View>
      {message.errorMessage && <Text style={styles.error}>{message.errorMessage}</Text>}
      {streaming && <View style={styles.cursor} />}
    </View>
  );
}

export const MessageView = memo(function MessageView({ message, streaming = false, themeMode, processDetails = false, toolResults, loadThinking }: { message: AgentMessage; streaming?: boolean; themeMode: ThemeMode; processDetails?: boolean; toolResults?: Map<string, ToolResultMessage>; loadThinking?: (entryId: string, blockIndex: number) => Promise<string> }) {
  return <MessageThemeContext.Provider value={messageThemes[themeMode]}><MessageViewContent message={message} streaming={streaming} processDetails={processDetails} toolResults={toolResults} loadThinking={loadThinking} /></MessageThemeContext.Provider>;
});

export function ProcessDetailsGroup({ messages, live, toolCallCount, themeMode, toolResults, loadThinking }: { messages: AgentMessage[]; live: boolean; toolCallCount: number; themeMode: ThemeMode; toolResults: Map<string, ToolResultMessage>; loadThinking?: (entryId: string, blockIndex: number) => Promise<string> }) {
  const theme = messageThemes[themeMode];
  const [expanded, setExpanded] = useState(live);
  const label = live ? "正在工作" : `已完成工作 · ${toolCallCount > 0 ? `${toolCallCount} 次工具调用` : `${messages.length} 项活动`}`;
  return (
    <MessageThemeContext.Provider value={theme}>
      <View style={[theme.styles.processGroup, live && theme.styles.processGroupLive]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={expanded ? "收起处理详情" : "展开处理详情"} onPress={() => setExpanded((value) => !value)} style={theme.styles.processGroupToggle}>
          <View style={[theme.styles.processStatusDot, live && theme.styles.processStatusDotLive]} />
          <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={12} color={theme.colors.muted} />
          <Text numberOfLines={1} style={theme.styles.processGroupLabel}>{label}</Text>
        </Pressable>
        {expanded && (
          <View style={theme.styles.processTimeline}>
            <View style={theme.styles.processTimelineLine} />
            {messages.map((message, index) => (
              <View key={index} style={theme.styles.processTimelineItem}>
                <View style={theme.styles.processTimelineDot} />
                <MessageView message={message} streaming={live && index === messages.length - 1} themeMode={themeMode} processDetails toolResults={toolResults} loadThinking={loadThinking} />
              </View>
            ))}
          </View>
        )}
      </View>
    </MessageThemeContext.Provider>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    userMessage: { alignItems: "flex-end" },
    userBubble: { maxWidth: "85%", backgroundColor: theme.user, borderWidth: 1, borderColor: theme.userBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
    userText: { color: theme.ink, fontSize: 14, lineHeight: 22 },
    assistant: {},
    processMessage: { marginBottom: 0 },
    modelLabel: { color: theme.faint, fontSize: 11, lineHeight: 16, marginBottom: 4 },
    assistantBlocks: { gap: 8 },
    assistantText: { color: theme.ink, fontSize: 14, lineHeight: 24 },
    richText: { gap: 8 },
    heading1: { color: theme.ink, fontSize: 16, lineHeight: 22, fontWeight: "600", marginTop: 10, marginBottom: 5 },
    heading2: { color: theme.ink, fontSize: 15, lineHeight: 21, fontWeight: "600", marginTop: 10, marginBottom: 5 },
    heading3: { color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: "600", marginTop: 9, marginBottom: 4 },
    strong: { color: theme.ink, fontWeight: "700" },
    inlineCode: { color: theme.ink, fontFamily: mono, fontSize: 13, backgroundColor: theme.panel },
    listRow: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 7, marginVertical: 2 },
    listMarker: { width: 20, color: theme.accent, fontSize: 14, lineHeight: 23, fontWeight: "600" },
    listText: { flex: 1, color: theme.ink, fontSize: 14, lineHeight: 23 },
    paragraphGap: { height: 8 },
    processBlock: { backgroundColor: "transparent" },
    processRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6 },
    processLabel: { fontSize: 12, fontWeight: "600" },
    processPreview: { minWidth: 0, flex: 1, color: theme.muted, fontSize: 12, fontStyle: "italic" },
    processExpanded: { marginLeft: 12, marginBottom: 4 },
    processContent: { color: theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: theme.subtle, borderLeftWidth: 1, borderLeftColor: theme.line },
    processResult: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, backgroundColor: theme.subtle },
    processResultContent: { color: theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8 },
    processResultError: { borderTopColor: theme.danger, backgroundColor: theme.dangerSoft },
    processErrorText: { color: theme.danger },
    processGroup: {},
    processGroupLive: {},
    processGroupToggle: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start" },
    processStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.faint },
    processStatusDotLive: { backgroundColor: theme.accent },
    processGroupLabel: { color: theme.muted, fontSize: 12 },
    processTimeline: { position: "relative", marginTop: 5, marginLeft: 5, paddingTop: 5, paddingBottom: 3, paddingLeft: 17, gap: 4 },
    processTimelineLine: { position: "absolute", top: 4, bottom: 4, left: 4, width: 1, backgroundColor: theme.line },
    processTimelineItem: { position: "relative" },
    processTimelineDot: { position: "absolute", top: 11, left: -15, width: 5, height: 5, borderRadius: 3, borderWidth: 1, borderColor: theme.canvas, backgroundColor: theme.faint },
    custom: { color: theme.muted, fontSize: 13, lineHeight: 20 },
    imageLabel: { color: theme.muted, fontSize: 13 },
    error: { color: theme.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
    cursor: { width: 7, height: 16, backgroundColor: theme.accent, marginTop: 4 },
    codeBlock: { width: "100%", backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line, borderRadius: 7, overflow: "hidden" },
    codeLanguage: { color: theme.faint, fontFamily: mono, fontSize: 10, paddingHorizontal: 10, paddingTop: 7 },
    codeText: { color: theme.ink, fontFamily: mono, fontSize: 12, lineHeight: 18, padding: 10 },
  });
}
