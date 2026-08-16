# 发布流程

pure 的发布渠道有两个：**Web 从源码运行/自建（无发布产物）**，**移动端走 EAS**。不发布到 npm，也不在 GitHub Release 发布安装包。

版本号策略：`apps/web` 版本号（当前 `1.0.0`）跟随代码演进；`apps/mobile` 独立（当前 `0.1.0`，EAS `autoIncrement` 自动递增）。

```
Web（源码运行 / 自建）                 EAS Build（移动端）
        ▲                                ▲
   git clone + npm install           eas build
```

## Web：从源码运行

Web 不产出安装包或压缩包，直接拉源码跑：

```bash
git clone https://github.com/mousebar01/pure.git
cd pure
npm install
npm run dev        # 开发模式 → http://127.0.0.1:30001
npm run build && npm start   # 生产模式
```

需要给局域网用（例如配合移动端）时：

```bash
PURE_PASSWORD='足够长的随机密码' npm run start:lan
```

> 打 `v*` 标签目前不触发任何发布工作流（`release.yml` 已移除）；tag 仅作版本标记，将来若要自动发 Release 需另配工作流。

## 移动端：EAS

Expo 的构建不在 GitHub Actions 跑，用 EAS 云构建（`apps/mobile/eas.json` 定义了三个 profile）：

```bash
npm install                            # mobile 已在根 workspaces，根锁文件统一管理
npm --prefix apps/mobile run build:production    # eas build --platform all --profile production
npm --prefix apps/mobile run build:preview:android   # 内部测试 APK
npm --prefix apps/mobile run build:preview:ios       # 内部测试 IPA
```

- `production` profile 开了 `autoIncrement: true` + `appVersionSource: remote`——每次构建自动递增版本号（不需要手改 `package.json`）
- 构建完成后在 EAS 面板或 `eas submit` 提交到 App Store / Play 商店
- 首次使用需 `eas login` 并关联项目（`eas init`）

## 发布检查清单

- [ ] `npm run lint -- --quiet && npm run typecheck && npm test` 全绿
- [ ] 移动端改动时：`npm run typecheck:mobile && npm run test:mobile`
- [ ] Web：`npm run build && npm start` 本地验证可访问
- [ ] 移动端：`eas build --profile production`，商店审核前在测试设备上验证
- [ ] （可选）更新 README 的功能描述 / docs 里过时的内容

## 相关

- CI 现状与建议：[ci.md](ci.md)
- 移动端构建配置：`apps/mobile/eas.json`、`app.json`
