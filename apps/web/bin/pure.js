#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pure-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startNextServer } = require("./pure-server");

const pkgDir = path.join(__dirname, "..");

const { port, hostname, openBrowser } = parseLaunchOptions();
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const passwordEnabled = Boolean(process.env.PURE_PASSWORD);

if (!loopbackHostnames.has(hostname)) {
  if (passwordEnabled) {
    console.warn(
      `Warning: pure is listening on ${hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
    );
  } else {
    console.warn(
      `Warning: pure is listening on ${hostname} without authentication. Only use this on a trusted network.`,
    );
  }
}

let child;
try {
  child = startNextServer({
    pkgDir,
    port,
    hostname,
    stdio: ["inherit", "pipe", "inherit"],
    detached: false,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
