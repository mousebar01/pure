import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const subject = () => jiti.import("./api.ts");

test("normalizes mobile server addresses", async () => {
  const { normalizeServerUrl } = await subject();
  assert.equal(normalizeServerUrl("192.168.1.20:30001/"), "http://192.168.1.20:30001");
  assert.equal(normalizeServerUrl("https://pi.example.test///"), "https://pi.example.test");
});

test("prefers a device bearer token and uses basic auth for first login", async () => {
  const { buildAuthorizationHeader } = await subject();
  assert.equal(buildAuthorizationHeader({ serverUrl: "http://host", token: "pim_token", password: "old" }), "Bearer pim_token");
  assert.equal(buildAuthorizationHeader({ serverUrl: "http://host", password: "friend1799" }), `Basic ${Buffer.from("pi:friend1799").toString("base64")}`);
  assert.equal(buildAuthorizationHeader({ serverUrl: "http://host", username: "operator", password: "friend1799" }), `Basic ${Buffer.from("operator:friend1799").toString("base64")}`);
  assert.equal(buildAuthorizationHeader({ serverUrl: "http://host" }), null);
});

test("creates a new session with native preflight selections", async (context) => {
  const { PiApi } = await subject();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      sessionId: "session-1",
      model: { provider: "openai", modelId: "gpt-5" },
      thinkingLevel: "high",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const api = new PiApi({ serverUrl: "http://host", token: "pim_token" });
  const result = await api.createSession("/work", {
    model: { provider: "openai", modelId: "gpt-5" },
    thinkingLevel: "high",
    toolPreset: "full",
  });
  assert.equal(result.sessionId, "session-1");
  assert.equal(request.url, "http://host/api/agent/new");
  assert.equal(request.init.headers.Authorization, "Bearer pim_token");
  assert.deepEqual(JSON.parse(request.init.body), {
    cwd: "/work",
    type: "ensure_session",
    toolNames: ["bash", "read", "edit", "write", "grep", "find", "ls"],
    provider: "openai",
    modelId: "gpt-5",
    thinkingLevel: "high",
  });
});

test("uses the bearer-only endpoint to inspect and revoke the current device", async (context) => {
  const { PiApi } = await subject();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const body = init.method === "DELETE"
      ? { removed: true }
      : { device: { id: "phone-1", name: "Android device", createdAt: "2026-08-13T00:00:00.000Z" } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const api = new PiApi({ serverUrl: "http://host", token: "pim_token" });
  assert.equal((await api.currentDevice()).id, "phone-1");
  await api.revokeCurrentDevice();
  assert.deepEqual(calls.map(({ url, init }) => ({ url, method: init.method ?? "GET", authorization: init.headers.Authorization })), [
    { url: "http://host/api/mobile/device", method: "GET", authorization: "Bearer pim_token" },
    { url: "http://host/api/mobile/device", method: "DELETE", authorization: "Bearer pim_token" },
  ]);
});

test("loads deferred thinking content by session entry and block index", async (context) => {
  const { PiApi } = await subject();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ thinking: "完整思考内容" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const api = new PiApi({ serverUrl: "http://host", token: "pim_token" });
  assert.equal(await api.thinking("session/1", "entry/2", 3), "完整思考内容");
  assert.equal(requestedUrl, "http://host/api/sessions/session%2F1/entries/entry%2F2/thinking?blockIndex=3");
});

test("browses and validates server workspaces before loading worktrees", async (context) => {
  const { PiApi } = await subject();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/api/cwd/browse")) return new Response(JSON.stringify({ path: "/repo", parentPath: "/", directories: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/api/cwd/validate")) return new Response(JSON.stringify({ cwd: "/repo" }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ projectRoot: "/repo", isGit: true, isTopLevel: true, worktrees: [{ path: "/repo", branch: "main", isMain: true }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const api = new PiApi({ serverUrl: "http://host", token: "pim_token" });
  assert.equal((await api.browseCwd("/repo name")).path, "/repo");
  assert.equal(await api.validateCwd("/repo"), "/repo");
  assert.equal((await api.worktrees("/repo")).worktrees[0].branch, "main");
  assert.deepEqual(calls.map(({ url, init }) => ({ url, method: init.method ?? "GET" })), [
    { url: "http://host/api/cwd/browse?path=%2Frepo%20name", method: "GET" },
    { url: "http://host/api/cwd/validate", method: "POST" },
    { url: "http://host/api/worktrees?cwd=%2Frepo", method: "GET" },
  ]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { cwd: "/repo" });
});
