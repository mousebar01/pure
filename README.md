# pure

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。pure 读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览——同一个 pi 会话在终端里和 pure 里看到的是同一份数据。

## 快速开始

pure 要求 Node.js 22.19.0 或更高版本，可用 `node --version` 检查。从源码安装和运行：

```bash
git clone https://github.com/mousebar01/pure.git
cd pure
npm install
npm run dev                      # 开发模式
# 或生产模式
npm run build && npm start
```

启动后打开 [http://127.0.0.1:30001](http://127.0.0.1:30001)。pure 默认只监听 `127.0.0.1`。

**可选参数：**

```bash
PURE_PORT=8080 npm run start              # 自定义端口（开发时：PURE_PORT=8080 npm run dev）
npm run start:lan                         # 在可信网络中开放访问（监听 0.0.0.0）
PURE_ALLOWED_HOSTS=pure.internal npm run start  # 允许指定的代理或自定义主机名
PURE_PASSWORD='足够长的随机密码' npm run start  # 启用 Basic Auth（用户名固定为 pi）
PURE_NO_OPEN=1 npm run start              # 适用于后台服务或开机自启
```

设置 `PURE_PASSWORD` 后，网页和所有 API 端点都会启用 HTTP Basic Auth，用户名固定为 `pi`。未设置或为空时不启用认证。

pure 可以调用高权限智能体。Basic Auth 不会加密传输中的密码，因此不要把明文 HTTP 暴露到互联网。远程访问时应使用可信反向代理提供 HTTPS，或通过可信 VPN 访问。
API 请求只接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PURE_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

## 移动端

`apps/mobile` 里的 Expo 客户端连接到同一个 pure API。在可信局域网内开发时，先用密码启动服务，再启动 Expo：

```bash
PURE_PASSWORD='choose-a-strong-password' npm run dev:lan
npm --prefix apps/mobile install
npm run dev:mobile
```

在 Pure Mobile 里输入 `http://<电脑局域网IP>:30001` 和同样的密码。凭据保存在 Android Keystore 或 iOS Keychain 中。明文 HTTP 只用于本地网络开发；离开局域网请使用 HTTPS 或可信 VPN。

首次用密码连接后，Pure Mobile 会把共享密码兑换成独立的设备令牌。服务端只在 `~/.pi/agent/mobile-devices.json` 中保存令牌的 SHA-256 哈希；设备管理请求仍然要求 Web 密码，所以移动端令牌无法再添加其他设备。

### 构建 Android APK

以下命令均在仓库根目录执行。EAS CLI 已作为项目依赖安装，不需要再全局安装 `eas-cli`：

```bash
cd /home/sky/project/pure
npm install

# 首次构建时检查 Expo 登录状态；未登录再执行下一行
npm exec --workspace pure-mobile -- eas whoami
npm exec --workspace pure-mobile -- eas login

# 构建前检查移动端代码
npm run typecheck:mobile
npm run test:mobile

# 云端构建可直接安装和上传的 Android APK
npm --prefix apps/mobile run build:preview:android
```

已经登录 Expo 时不需要重复执行 `eas login`。构建完成后，终端会输出 Expo 构建页面和 `.apk` 下载地址；下载该 APK 后即可安装、测试或上传到分发平台。该命令使用 `preview` profile 并生成 APK，`production` profile 默认生成应用商店使用的 AAB，不适用于只需要 APK 的场景。

## HTTP 代理

pure 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run start
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npm run start
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：在侧边栏切换同一项目下的不同 checkout，新建目录位于 `<repo>-worktrees/<分支>`；删除 worktree 不会删除对应分支。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。
- **国际化和多语言**：界面内置简体中文和英文，可在顶部栏切换；新增语言在 `apps/web/lib/i18n/` 下添加。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30001](http://127.0.0.1:30001)。
如需换端口，可设置 `PURE_PORT`，例如 `PURE_PORT=30002 npm run dev`。

常用检查：

```bash
npm run typecheck
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
apps/web/app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
apps/web/components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  DirectoryPicker.tsx # 支持浏览和路径输入的工作目录选择器
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
apps/web/lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
apps/web/hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
apps/web/bin/
  pure.js             # CLI 入口（构建后可运行）
apps/web/instrumentation.ts # 初始化服务端 HTTP dispatcher
apps/mobile/           # Expo 客户端，保留独立依赖锁文件
```
