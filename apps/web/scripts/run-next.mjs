import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [command = "dev", hostname = "127.0.0.1"] = process.argv.slice(2);
if (!new Set(["dev", "start"]).has(command)) {
  console.error(`Unsupported Next.js command: ${command}`);
  process.exit(1);
}

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next", { paths: [webRoot] });
const port = process.env.PURE_PORT || process.env.PORT || "30001";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(`Invalid PURE_PORT/PORT value: ${port}`);
  process.exit(1);
}

const child = spawn(process.execPath, [nextBin, command, "-H", hostname, "-p", port], {
  cwd: webRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
