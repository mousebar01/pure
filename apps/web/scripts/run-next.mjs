import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [command = "dev", hostnameArg] = process.argv.slice(2);
if (!new Set(["dev", "start"]).has(command)) {
  console.error(`Unsupported Next.js command: ${command}`);
  process.exit(1);
}

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next", { paths: [webRoot] });
const { ensurePureConfig } = require(path.join(webRoot, "bin", "pure-config.cjs"));
const { consumePureRestartRequest, getPureRestartRequestPath } = require(path.join(webRoot, "bin", "pure-restart.cjs"));

let child = null;
let restarting = false;
let firstLaunch = true;

function launch() {
  let bootstrap;
  try {
    bootstrap = ensurePureConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (process.env.PURE_NETWORK) {
    console.error("PURE_NETWORK has been removed; choose the access range in Pure settings.");
    process.exit(1);
  }

  const hostname = hostnameArg
    || process.env.PURE_HOSTNAME
    || (bootstrap.config?.network.mode === "lan" ? "0.0.0.0" : "127.0.0.1");
  const port = process.env.PURE_PORT || process.env.PORT || "30001";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    console.error(`Invalid PURE_PORT/PORT value: ${port}`);
    process.exit(1);
  }

  if (firstLaunch && bootstrap.created) {
    console.info("Pure 已创建本地配置，当前仅允许本机访问。请打开设置 → 移动设备设置访问密码；如需手机或局域网访问，再选择访问范围并点击“保存并重启”。\n");
  }
  firstLaunch = false;

  child = spawn(process.execPath, [nextBin, command, "-H", hostname, "-p", port], {
    cwd: webRoot,
    env: { ...process.env, PURE_SUPERVISOR: "1" },
    stdio: "inherit",
    windowsHide: false,
  });

  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    child = null;
    if (restarting) {
      restarting = false;
      setTimeout(launch, 150);
      return;
    }
    clearInterval(restartPoll);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

function restartChild() {
  if (!child || restarting) return;
  restarting = true;
  console.info(`Pure 正在重启以应用新的监听范围（${getPureRestartRequestPath()}）。`);
  child.kill();
}

// A stale marker is safe to discard when the launcher itself is starting.
consumePureRestartRequest();
const restartPoll = setInterval(() => {
  if (consumePureRestartRequest()) restartChild();
}, 250);

process.once("exit", () => clearInterval(restartPoll));
launch();
