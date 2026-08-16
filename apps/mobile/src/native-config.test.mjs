import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appConfig = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8")).expo;

function pluginOptions(name) {
  const entry = appConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  return entry?.[1];
}

test("native config keeps camera permission available for QR pairing", () => {
  const imagePicker = pluginOptions("expo-image-picker");
  const camera = pluginOptions("expo-camera");

  assert.notEqual(imagePicker?.cameraPermission, false);
  assert.match(imagePicker?.cameraPermission ?? "", /扫描.*二维码/);
  assert.match(camera?.cameraPermission ?? "", /扫描.*二维码/);
  assert.equal(camera?.recordAudioAndroid, false);
  assert.deepEqual(appConfig.android.blockedPermissions, ["android.permission.RECORD_AUDIO"]);
});

test("native window fallback matches the light top panel", () => {
  assert.equal(appConfig.backgroundColor, "#f5f5f5");
});
