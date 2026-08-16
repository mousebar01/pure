# 移动端

Expo / React Native 客户端，代码在 `apps/mobile/`，连接 Web 服务提供的同一套 HTTP + SSE API。

### 连接与认证（src/api.ts + App.tsx）

`PiApi` 封装 HTTP + SSE：

- `normalizeServerUrl()` 自动补 `http://` 前缀
- 认证头：有设备 token 用 `Authorization: Bearer pim_...`；否则退回 `Basic base64("pi:密码")`
- 错误分类：401 → authentication、403 → server（通常是 `PURE_ALLOWED_HOSTS` 没配置）、health 404 → version，抛带 stage 的 `ConnectionError` 供 UI 分步提示

**密码 → 设备 token（首次连接）**：

1. `health()` 探活
2. `POST /api/mobile/devices`（中间件豁免该路径的 Basic，但路由要求服务端已配 `PURE_PASSWORD`）
3. 服务端生成 `pim_` + 32 字节 base64url token，只存 SHA-256 哈希到 `~/.pi/agent/mobile-devices.json`
4. 客户端把 token 存进 SecureStore，之后全部请求走 Bearer

**扫码配对**：网页端 `MobileDevicesConfig` 显示二维码（`POST /api/mobile/pairing` 生成 2 分钟有效的 id+secret 票据）→ 手机扫 `pure-mobile://pair?server&id&secret` → `POST /api/mobile/pairing/redeem` 兑换成设备 token。兑换失败（health 探不通）会 `revokeCurrentDevice()` 回滚。

**启动迁移**：旧版本只存了密码的配置会自动走一次 `pairDevice()` 升级成 token。

### 本地存储

| 存储 | key | 内容 |
| --- | --- | --- |
| SecureStore | `pure-mobile.connections.v2` | profiles + activeId（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`）；旧 `connection.v1` 做迁移 |
| SecureStore | `theme.v1` / `preferences.v1` | 主题/偏好 |
| AsyncStorage | `pure-mobile.cache.v1:<serverUrl>:sessions` / `:detail:<id>` | 会话缓存（`SESSION_CACHE_MAX=50`），离线兜底 |
| AsyncStorage | `pure-mobile.draft.v1:<serverUrl>:<sessionId\|new>` | 草稿 |

### 缓存与重连

- **App 级**：`sync()` 每 15s（前台 + 在线）刷新会话列表与默认 cwd；失败按 1/2/4/8/15s 指数退避，AppState/NetInfo 变化重置退避；失败时读缓存兜底
- **会话级**：SSE 出错且运行中按退避重连；每 4s `reconcile` 轮询 `agentState`，非 busy 即走 `finishRun()` 结算；`eventGeneration`/`runGeneration` 单调计数丢弃过期事件
- 消息渲染与 Web 对齐：`buildChatList()` 把 user/compaction 锚点间的 thinking/toolCall/toolResult 折叠成「过程组」+ 最终答案，`ProcessDetailsGroup` 显示「正在工作 / 已完成 N 次工具调用」

### 原生构建配置

- `app.json`：Expo ~57，scheme `pure-mobile`；Android 允许明文流量（局域网开发）、禁备份、禁录音权限；iOS 配 ATS `NSAllowsLocalNetworking` + 局域网权限文案；secure-store 关闭 Android 备份
- `eas.json`：development / preview / production 三个 profile，`appVersionSource=remote` 自动递增版本号
- 构建走 EAS Cloud（`eas build`），本地开发用 `expo run:android|ios`
