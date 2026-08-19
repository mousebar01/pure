/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getPureConfigPath(env = process.env) {
  return env.PURE_CONFIG_PATH
    || env.PI_PURE_CONFIG_PATH
    || path.join(os.homedir(), ".pi", "agent", "pure-config.json");
}

function getPureRestartRequestPath(env = process.env) {
  return env.PURE_RESTART_PATH || path.join(path.dirname(getPureConfigPath(env)), "pure-restart.request");
}

function consumePureRestartRequest(env = process.env) {
  const requestPath = getPureRestartRequestPath(env);
  if (!fs.existsSync(requestPath)) return false;
  try {
    fs.unlinkSync(requestPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { consumePureRestartRequest, getPureRestartRequestPath };
