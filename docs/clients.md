# 移动端

Expo / React Native 客户端，代码在 `apps/mobile/`，连接 Web 服务提供的同一套 HTTP + SSE API。

### 连接与认证（src/api.ts + App.tsx）

`PiApi` 封装 HTTP + SSE：

- `normalizeServerUrl()` 自动补 `http://` 前缀
- 认证头：有设备 token 用 `Authorization: Bearer pim_...`；否则使用配置的 `Basic base64("账号:密码")`（默认账号为 `pi`）
- 错误分类：401 → authentication、403 → server（通常是 `PURE_ALLOWED_HOSTS` 没配置）、health 404 → version，抛带 stage 的 `ConnectionError` 供 UI 分步提示

**密码 → 设备 token（首次连接）**：

1. `health()` 探活
2. `POST /api/mobile/devices`（代理和路由都要求有效的 Basic 账号/密码）
3. 服务端生成 `pim_` + 32 字节 base64url token，只存 SHA-256 哈希到 `~/.pi/agent/mobile-devices.json`
4. 客户端把 token 存进 SecureStore，之后全部请求走 Bearer

没有云端账号或二维码配对服务。首次连接由用户在手机输入可达的服务地址、访问账号和访问密码；Tailscale/ZeroTier 等虚拟网络也直接填写对应的 IP、MagicDNS 或 HTTPS 地址。局域网内可以先点击“查找局域网电脑”，再补充账号和密码。


### 本地存储

| 存储 | key | 内容 |
| --- | --- | --- |
| SecureStore | `pure-mobile.connections.v3` | profiles + activeId（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`）；首次登录只短暂使用访问账号/密码，保存连接时只保留设备 token |
| SecureStore | `theme.v1` / `preferences.v1` | 主题/偏好 |
| AsyncStorage | `pure-mobile.cache.v1:<serverUrl>:sessions` / `:detail:<id>` | 会话缓存（`SESSION_CACHE_MAX=50`），离线兜底 |
| AsyncStorage | `pure-mobile.draft.v1:<serverUrl>:<sessionId\|new>` | 草稿 |

### 缓存与重连

- **App 级**：`sync()` 每 15s（前台 + 在线）刷新会话列表与默认 cwd；失败按 1/2/4/8/15s 指数退避，AppState/NetInfo 变化重置退避；失败时读缓存兜底
- **会话级**：SSE 出错且运行中按退避重连；每 4s `reconcile` 轮询 `agentState`，非 busy 即走 `finishRun()` 结算；`eventGeneration`/`runGeneration` 单调计数丢弃过期事件
- 消息渲染与 Web 对齐：`buildChatList()` 把 user/compaction 锚点间的 thinking/toolCall/toolResult 折叠成「过程组」+ 最终答案，`ProcessDetailsGroup` 显示「正在工作 / 已完成 N 次工具调用」

### 原生构建配置

- `app.json`：Expo ~57；Android 允许明文流量（局域网开发）、禁备份、禁录音权限；iOS 配 ATS `NSAllowsLocalNetworking` + 局域网权限文案；secure-store 关闭 Android 备份
- `eas.json`：development / preview / production 三个 profile，`appVersionSource=remote` 自动递增版本号
- 构建走 EAS Cloud（`eas build`），本地开发用 `expo run:android|ios`
