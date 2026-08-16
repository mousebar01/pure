import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("refreshes the session list when a new running session appears", () => {
  assert.match(
    source,
    /const startedSinceLastPoll = newlyRunning\.filter\(\(id\) => !previous\.has\(id\)\)/,
  );
  assert.match(
    source,
    /completedInBackground\.length > 0 \|\| startedSinceLastPoll\.length > 0[\s\S]*?loadSessions\(false\)/,
  );
});

test("scrolls overflowing session titles instead of showing a native tooltip", () => {
  assert.match(sessionItemSource, /<ScrollingSessionTitle text=\{title\} active=\{hovered\} \/>/);
  assert.doesNotMatch(sessionItemSource, /title=\{title\}/);
});

test("finishes a missing URL session restore when the session list is empty", () => {
  const restoreEffect = source.slice(
    source.indexOf("// Auto-select cwd and restore session from URL on first load"),
    source.indexOf("const commitCustomPath"),
  );
  const restoreCheck = restoreEffect.indexOf("if (initialSessionId && !restoredRef.current)");
  const emptyListCheck = restoreEffect.indexOf("if (allSessions.length === 0) return");

  assert.ok(restoreCheck >= 0);
  assert.ok(emptyListCheck > restoreCheck);
  assert.match(restoreEffect, /if \(loading\) return;[\s\S]*?onInitialRestoreDone\?\.\(\)/);
});
