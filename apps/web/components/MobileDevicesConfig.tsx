"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Pencil, QrCode, RefreshCw, Smartphone, Trash2, X } from "lucide-react";

interface MobileDeviceInfo {
  id: string;
  name: string;
  createdAt: string;
}

interface PairingTicket {
  id: string;
  secret: string;
  expiresAt: string;
}

export function MobileDevicesConfig() {
  const [devices, setDevices] = useState<MobileDeviceInfo[]>([]);
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [pairingState, setPairingState] = useState<"idle" | "creating" | "pending" | "paired" | "error">("idle");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [suggestedServerUrls, setSuggestedServerUrls] = useState<string[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localOnlyOrigin = typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  const loadDevices = useCallback(async () => {
    const response = await fetch("/api/mobile/devices", { cache: "no-store" });
    const body = await response.json() as { devices?: MobileDeviceInfo[]; error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setDevices(body.devices ?? []);
  }, []);

  useEffect(() => { void loadDevices().catch((cause) => setError(String(cause))); }, [loadDevices]);

  useEffect(() => {
    if (!ticket || pairingState !== "pending") return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(ticket.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pairingState, ticket]);

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  const beginPairing = async (serverUrlOverride?: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setPairingState("creating");
    setError("");
    try {
      const response = await fetch("/api/mobile/pairing", { method: "POST" });
      const body = await response.json() as { ticket?: PairingTicket; suggestedServerUrls?: string[]; error?: string };
      if (!response.ok || !body.ticket) throw new Error(body.error || `HTTP ${response.status}`);
      const next = body.ticket;
      const suggestions = body.suggestedServerUrls ?? [];
      const selectedServerUrl = localOnlyOrigin
        ? serverUrlOverride || serverUrl || suggestions.find((url) => !new URL(url).hostname.startsWith("100.")) || suggestions[0]
        : window.location.origin;
      if (!selectedServerUrl) throw new Error("没有找到手机可访问的地址，请手动输入电脑的局域网地址。");
      setSuggestedServerUrls(suggestions);
      setServerUrl(selectedServerUrl);
      const payload = new URL("pure-mobile://pair");
      payload.searchParams.set("server", selectedServerUrl);
      payload.searchParams.set("id", next.id);
      payload.searchParams.set("secret", next.secret);
      setQrDataUrl(await QRCode.toDataURL(payload.toString(), { width: 280, margin: 2, errorCorrectionLevel: "M" }));
      setTicket(next);
      setPairingState("pending");
      pollingRef.current = setInterval(async () => {
        const statusResponse = await fetch(`/api/mobile/pairing?id=${encodeURIComponent(next.id)}`, { cache: "no-store" });
        const status = await statusResponse.json() as { status: "pending" | "paired" | "expired" };
        if (status.status === "paired") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPairingState("paired");
          void loadDevices();
        } else if (status.status === "expired") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPairingState("idle");
        }
      }, 1200);
    } catch (cause) {
      setPairingState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const rename = async (id: string) => {
    const response = await fetch("/api/mobile/devices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editingName }),
    });
    if (!response.ok) return setError("无法重命名设备");
    setEditingId(null);
    await loadDevices();
  };

  const revoke = async (device: MobileDeviceInfo) => {
    if (!window.confirm(`吊销“${device.name}”的访问权限？`)) return;
    const response = await fetch(`/api/mobile/devices?id=${encodeURIComponent(device.id)}`, { method: "DELETE" });
    if (!response.ok) return setError("无法吊销设备");
    await loadDevices();
  };

  return (
    <div className="mobile-devices-config">
      <div className="settings-section-heading"><h2>移动设备</h2><p>配对 Pure Mobile，并管理可以访问此服务的设备。</p></div>
      <div className="mobile-devices-layout">
        <section className="mobile-pairing-pane" aria-label="扫码配对">
          <div className="mobile-pane-heading"><QrCode size={16} /><span>连接新设备</span></div>
          <div className={`mobile-qr-stage is-${pairingState}`}>
            {pairingState === "pending" && qrDataUrl ? (
              // QR data URLs are generated locally and must remain unoptimized.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Pure Mobile 配对二维码" />
            ) : pairingState === "paired" ? (
              <div className="mobile-pairing-result"><span><Check size={22} /></span><strong>设备已连接</strong><small>二维码已经失效</small></div>
            ) : (
              <div className="mobile-pairing-placeholder"><Smartphone size={30} /><span>生成一次性二维码</span></div>
            )}
          </div>
          {pairingState === "pending" ? <p className="mobile-pairing-note">使用 Pure Mobile 扫描 · {secondsLeft} 秒后失效</p> : <p className="mobile-pairing-note">二维码不包含访问密码，使用一次后立即失效。</p>}
          {localOnlyOrigin && suggestedServerUrls.length > 0 && <label className="mobile-pairing-address" htmlFor="mobile-pairing-server">
            <span>访问地址</span>
            <select id="mobile-pairing-server" value={serverUrl} onChange={(event) => void beginPairing(event.target.value)}>
              {suggestedServerUrls.map((url) => <option value={url} key={url}>{new URL(url).hostname.startsWith("100.") ? "Tailscale" : "局域网"} · {new URL(url).host}</option>)}
            </select>
          </label>}
          <button type="button" className="mobile-primary-button" disabled={pairingState === "creating"} onClick={() => void beginPairing()}>
            <RefreshCw size={14} className={pairingState === "creating" ? "is-spinning" : ""} />
            {pairingState === "pending" ? "刷新二维码" : pairingState === "paired" ? "连接另一台设备" : "生成二维码"}
          </button>
        </section>
        <section className="mobile-device-list-pane" aria-label="已配对设备">
          <div className="mobile-pane-heading"><Smartphone size={16} /><span>已配对设备</span><em>{devices.length}</em></div>
          <div className="mobile-device-list">
            {devices.length === 0 ? <div className="mobile-device-empty">还没有已配对的设备</div> : devices.map((device) => (
              <div className="mobile-device-item" key={device.id}>
                <span className="mobile-device-icon"><Smartphone size={17} /></span>
                <div className="mobile-device-copy">
                  {editingId === device.id ? <input autoFocus value={editingName} maxLength={80} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(device.id); if (event.key === "Escape") setEditingId(null); }} /> : <strong>{device.name}</strong>}
                  <small>配对于 {new Date(device.createdAt).toLocaleString()}</small>
                </div>
                <div className="mobile-device-actions">
                  {editingId === device.id ? <><button title="保存" onClick={() => void rename(device.id)}><Check size={15} /></button><button title="取消" onClick={() => setEditingId(null)}><X size={15} /></button></> : <><button title="重命名" onClick={() => { setEditingId(device.id); setEditingName(device.name); }}><Pencil size={14} /></button><button className="is-danger" title="吊销" onClick={() => void revoke(device)}><Trash2 size={14} /></button></>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      {error && <div className="mobile-devices-error">{error}</div>}
    </div>
  );
}
