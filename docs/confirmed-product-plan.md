# Pure 移动连接与访问配置方案

## 已确认的边界

Pure 没有云端账号体系，因此不引入二维码配对、云端中转或厂商网络发现适配。PC 端只负责监听 HTTP/HTTPS 服务并提供统一 API；移动端负责输入地址、发现同一局域网中的服务，并在首次登录后保存设备令牌。

## 访问配置

- 配置文件为 `~/.pi/agent/pure-config.json`，权限 `0600`，不包含额外的 schema version 字段。
- 新配置默认 `network.mode = "local"`，`auth.username = "pi"`，`auth.password = null`。
- 首次启动不生成随机密码，也不把密码写入命令行或日志。
- 用户在“设置 → 移动设备”设置或修改访问密码；密码以明文保存在权限为 `0600` 的本地配置中，界面默认掩码并支持查看。
- 账号是一个访问账号字段，不是完整账号体系；默认账号为 `pi`，可在设置中修改。
- 用户修改访问范围后点击“保存并重启”；受支持的 Pure 启动器会自动重启，服务随后监听新的地址。
- 部署可用 `PURE_USERNAME` 与 `PURE_PASSWORD_FILE` 注入账号和 Secret 文件；密码文件由部署系统管理。
- `PURE_PASSWORD`、`PURE_NETWORK` 和 `start:lan` 不再是支持的入口。

## 移动端首次连接

1. 在 PC 设置页设置访问密码并选择访问范围。
2. 修改访问范围时点击“保存并重启”，等待页面自动恢复。
3. 手机输入可达的服务地址、访问账号和访问密码；局域网内可先点击“查找局域网电脑”。
4. 手机调用 `GET /api/health` 探活，再用 Basic Auth 调用 `POST /api/mobile/devices`。
5. 服务端只保存设备 token 的 SHA-256 哈希，手机把明文 token 保存到系统安全存储。
6. 后续请求使用 `Authorization: Bearer pim_...`；设备可在设置页重命名或吊销。

Tailscale、ZeroTier、Nebula、WireGuard 等工具只负责提供可达网络，不需要 Pure 集成厂商 API，也不自动扫描整个虚拟网络。用户直接填写对应 IP、MagicDNS 名称或 HTTPS 地址即可。

## 局域网发现

`/api/mobile/discovery` 是轻量、无凭据的服务探测端点，只返回服务名、协议、端口和地址等元数据。它不返回密码、不签发 token，也不替代 Basic Auth。移动端只扫描当前私有 Wi-Fi 网段；虚拟组网使用手动地址。

## 安全边界

- 非回环访问必须使用 Basic Auth 或已经签发的移动 Bearer token。
- 明文 HTTP 只用于可信局域网开发；服务器部署使用 HTTPS 或可信 VPN/组网工具。
- `/api/mobile/devices` 只接受 Basic Auth，移动 Bearer 不能管理其他设备。
- `/api/mobile/device` 只接受当前设备 Bearer token，可用于查看或吊销自身 token。
- 不把密码写入日志；配置状态接口只在已通过访问认证的设置页面中返回本地配置密码。
- 不引入 QR 票据、`pure-mobile://` 深链、相机权限或内存配对票据。

## 验收清单

- 新配置是本机监听、密码未设置、没有随机密码。
- 设置页持久化显示账号、访问范围和密码“已设置/未设置”状态。
- 设置自定义密码后，Basic Auth 可用；配置文件包含可回显的访问密码。
- 手机手动输入地址/账号/密码可获得 token，重启后 token 仍可用。
- 局域网发现只提供元数据，不能绕过认证。
- 二维码、配对票据、配对兑换 API、二维码文档和相机权限均已删除。
- Web 与 Mobile 类型检查、测试和 lint 全部通过。

## 兼容性说明

旧的带 `version` 字段的配置不做兼容迁移；请删除 `~/.pi/agent/pure-config.json` 后重新启动，再在设置页重新配置访问范围和密码。
