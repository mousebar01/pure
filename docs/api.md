# API 参考

所有端点都挂在 Next.js App Router 下（`apps/web/app/api/**/route.ts`），HTTP + JSON（SSE 例外），并且全部经过 `proxy.ts` 守门（[security.md](security.md)）。除非特别说明，请求/响应都是 JSON。

约定：

- `[id]` 是会话 id（`.jsonl` 文件名里的 uuid）
- `[provider]` 是 provider id（如 `anthropic`、`openai`）
- 查询参数用 `?a=b` 表示；`deferThinking=1` / `deferMedia=1` 在移动端用于省流量

## 会话（sessions）

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/sessions` | GET | 全部会话 `{ sessions, runningSessionIds }`（侧边栏树 + 运行状态） |
| `/api/sessions/[id]` | GET | `{ sessionId, filePath, info, leafId, tree, context }`；支持 `deferThinking`/`deferMedia`；≥2KB 响应 Brotli 压缩 |
| `/api/sessions/[id]` | PATCH | 重命名：body `{ name }` → `appendSessionInfo` |
| `/api/sessions/[id]` | DELETE | 删除（级联改写子会话 parentSession，见 [session-files.md](session-files.md)） |
| `/api/sessions/[id]/context` | GET | `?leafId=` 构建指定分支叶子的 `{ context }`（切换会话内分支时用） |
| `/api/sessions/[id]/export` | GET | 导出 HTML（迭代化补丁防爆栈；CSP + X-Frame-Options: DENY） |
| `/api/sessions/[id]/auto-name` | POST | 自动命名，返回 `{ title, usage }`；会话中途关闭返回 409 |
| `/api/sessions/[id]/state` | GET | 同 `/api/agent/[id]` GET（运行状态快照） |
| `/api/sessions/[id]/entries/[entryId]/thinking` | GET | `?blockIndex=N` 取某条 assistant 消息的 thinking 块 `{ thinking }` |

## Agent 运行时（agent）

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/agent/new` | POST | body `{ cwd, type?, message?, toolNames?, provider?, modelId?, thinkingLevel? }`；创建/复用 AgentSession，`allowFileRoot(cwd)`；`type:"ensure_session"` 只建运行时；返回 `{ success, sessionId, data, model, thinkingLevel }` |
| `/api/agent/[id]` | POST | body `{ type, ... }` 任意命令（命令表见 [session-runtime.md](session-runtime.md#send-命令协议)）；wrapper 不存在则按文件路径惰性重建；返回 `{ success, data }` |
| `/api/agent/[id]` | GET | `{ running: false }` 或 `{ running: true, state }` |
| `/api/agent/[id]/events` | GET | SSE 事件流（事件表见 [session-runtime.md](session-runtime.md#sse-事件流协议)） |
| `/api/agent/[id]/bash-output` | GET | `?path=&download=1` 读取 bash 执行输出文件；仅 tmpdir 内且被会话引用；inline 超限 413 |
| `/api/agent/running` | GET | `{ runningSessionIds }` |
| `/api/agent/running/events` | GET | SSE：`{ type: "running", runningSessionIds }` 推送 |

## 认证（auth）

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/auth/providers` | GET | OAuth provider 列表 |
| `/api/auth/all-providers` | GET | API-key provider 列表 |
| `/api/auth/api-key/[provider]` | GET | key 状态（只回「已配置/未配置」，**永不返回明文**） |
| `/api/auth/api-key/[provider]` | POST | 存 API key |
| `/api/auth/api-key/[provider]` | DELETE | 删 key |
| `/api/auth/login/[provider]` | GET | SSE 流式 OAuth / device-code 登录 |
| `/api/auth/login/[provider]` | POST | 回传手动 code（短时 token 存 `globalThis.__piLoginCallbacks`） |
| `/api/auth/logout/[provider]` | POST | 登出（按凭据类型删除） |

要点：provider 列表是**能力驱动**的（`lib/provider-listing.ts` 根据 `auth.apiKey.login` / `auth.oauth` + 存储凭据类型判定），双认证 provider（anthropic、github-copilot）只出现一次；`auth.json` 每个 provider 只存一份凭据，删除用 `removeStoredCredentialIfType` 在锁内按类型比对，防误删（[security.md](security.md)）。

## 模型（models / models-config）

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/models` | GET | `?cwd=` 可见模型 + 默认模型 + thinking 级别/引脚；cwd 需在白名单且过信任门控 |
| `/api/models-config` | GET | 读 `~/.pi/agent/models.json` |
| `/api/models-config` | PUT | 原子写 `models.json` + 失效模型缓存 |
| `/api/models-config/catalog` | GET | models.dev 定价目录（1h TTL） |
| `/api/models-config/discover` | POST | 抓某个 provider 的上游模型列表（15s 超时） |
| `/api/models-config/test` | POST | 用临时 models.json + 真实 ModelRuntime 发一次补全（20s 超时，要求 JSON Content-Type） |

`enabledModels` 作用域由 `lib/model-scope.ts` 委托 SDK `resolveModelScopeWithDiagnostics` 解析，模式为空时回退全部模型并带诊断警告（[configuration.md](configuration.md)）。

## 技能 / 插件 / MCP

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/skills` | GET | `?cwd=` 技能列表（含安装信息；DefaultResourceLoader，与运行时一致） |
| `/api/skills` | PATCH | 切换 `disable-model-invocation`（只做外科手术式行编辑，保留原 YAML 格式） |
| `/api/skills/search` | GET/POST | skills.sh 搜索 |
| `/api/skills/install` | POST | `npx skills add ... --agent pi`（项目安装用所选 cwd） |
| `/api/skills/check` | GET | 检查技能更新 |
| `/api/skills/update` | POST | 更新技能 |
| `/api/plugins` | GET/POST | 插件列表 / 安装（`SettingsManager` + `DefaultPackageManager`；global/project 双 scope） |
| `/api/plugins` | DELETE/PATCH | 移除 / 更新 / 禁用 / 启用（禁用写空 extensions/skills/prompts/themes 数组） |
| `/api/mcp` | GET | MCP 配置 + runtime 状态 |
| `/api/mcp` | PATCH | 切换项目 MCP server 并 `session.send({type:"reload"})` |

## 文件 / git / 工作目录

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/files/[...path]` | GET | `?type=list\|read\|download\|meta\|preview\|watch`；列表/读取/预览/SSE watch 变更流 |
| `/api/files/[...path]` | POST | `?type=upload\|upload-check`；单文件 ≤25MB、总 ≤100MB、请求体 ≤101MB |
| `/api/file-index` | GET | `?cwd=&q=` 文件索引（git ls-files 或 BFS 深度 8；上限 5000/200k/50k；10s 缓存），供 `@` 菜单 |
| `/api/git/status` | GET | `?cwd=` git 状态（porcelain 解析） |
| `/api/git/diff` | GET | `?cwd=&path=` 单文件 diff（deleted 文件校验仓库归属） |
| `/api/cwd/browse` | GET | 服务端目录浏览（支持 Windows 盘符） |
| `/api/cwd/validate` | POST | 校验/选择自定义 cwd，`allowFileRoot` 放行 |
| `/api/default-cwd` | POST | 创建 `~/pi-cwd-YYYYMMDD` 并放行 |
| `/api/home` | GET | `{ home }` 用户 home 目录 |
| `/api/health` | GET | `{ ok, version }`（探活） |

文件访问全部受白名单约束，见 [security.md](security.md#文件访问白名单)。

## 工作树 / 项目信任

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/worktrees` | GET/POST/DELETE | 列出 / 创建（`<repo>-worktrees/<sanitized-branch>`，复用已有分支否则 `git worktree add -b`）/ 删除 |
| `/api/project-trust` | GET | `?cwd=` 查询是否需要信任 + 当前是否信任 |
| `/api/project-trust` | POST | 信任 cwd；无门控资源或会话运行中返回 409；成功后失效模型缓存 + 销毁该 cwd 的 RPC 会话 |

## 移动设备

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/api/mobile/devices` | GET/POST/DELETE/PATCH | 设备管理（**必须配 `PURE_PASSWORD`**，否则 409；只认 Basic，不认移动 Bearer） |
| `/api/mobile/device` | GET/DELETE | 当前设备（Bearer 自鉴权） |
| `/api/mobile/pairing` | POST | 创建配对票据 + 建议 URL（二维码）；GET 查状态 |
| `/api/mobile/pairing/redeem` | POST | 兑换票据换设备 token（**代理豁免认证**；过期 410 / 已用 409 / 错误 401） |

配对与 token 细节见 [security.md](security.md#移动端设备-token) 和 [clients.md](clients.md#移动端)。

## 响应约定与错误

- 成功一般是 `{ success: true, ... }` 或领域对象
- 错误一般是 `{ error: string }` + 4xx/5xx；常见 400（参数）、403（安全拒绝）、404（不存在）、409（状态冲突，如脏 worktree、信任冲突）、413（体积超限）
- SSE 响应 `Content-Type: text/event-stream`，事件是 `data: {...}\n\n`
- 除 SSE/文件外均 JSON；`/api/files` 的 read/preview 返回文件内容（文本/媒体），download 返回附件流
