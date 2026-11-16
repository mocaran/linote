# linote release instructions

The stable Android download URL `https://linote-notes-20261103.thinmerit.chatgpt.site/linote.apk` must serve a fresh APK with every published linote update.

## 签名（重要）

- 用**私有 release key** 签名，配置在 `android/keystore.properties`（不入库）或环境变量 `LINOTE_KEYSTORE` / `LINOTE_KEYSTORE_PASSWORD` / `LINOTE_KEY_ALIAS` / `LINOTE_KEY_PASSWORD`。
- `android/build-apk.ps1` 找不到 release key 才会退回 `android/debug.keystore` 并打印警告 —— 那个签名**只能用于本机调试，绝不对外发布**：debug key 是公开的通用密钥，任何人都能签出同名同签名的 APK 冒充本应用的更新。
- keystore 文件与密码永不进仓库（`.gitignore` 已忽略 `keystore.properties`、`*.jks`、`*.keystore`）。密钥丢失 = 无法再给已安装用户发更新。
- 更换签名密钥后，已安装旧包的设备必须先卸载再安装（签名不同，Android 不允许覆盖）。

## 构建环境

- `build-apk.ps1` 需要 JDK 17+：把 `JAVA_HOME` 指向 Android Studio 的 `jbr`，系统默认的 JDK 8 会报「无效的源发行版: 17」。
- `build-apk.ps1` 含中文，**必须保存为 UTF-8 带 BOM**，否则 PowerShell 5.1 会吞掉注释后的换行导致变量失效。

## 版本号：以下六处必须一起改

1. `android/app/src/main/AndroidManifest.xml` — `android:versionCode` +1、`android:versionName`
2. `public/app.js` — `APP_VERSION`
3. `app/notes-page.tsx` — 资源指纹 `?v=`
4. `public/sw.js` — `CACHE` 名称与 `CORE` 列表（同时改 `scripts/test-service-worker.mjs` 的期望值）
5. `scripts/generate-offline.mjs` — 资源指纹 `?v=`
6. `public/android-version.json` — `versionCode` / `versionName`

## 打包与发布

1. 单机版：`powershell -File android/build-apk.ps1 -Standalone`（输出 `android/linote-standalone.apk`，包名 `chatgpt.site.linote.standalone`，脚本会移除全部权限）
2. 联网版：`powershell -File android/build-apk.ps1`（输出并复制到 `public/linote.apk`，保留 `INTERNET`、`REQUEST_INSTALL_PACKAGES`）
3. `npm run build` — 重新生成离线页并刷新 `dist/client/linote.apk`
4. 校验 `android/linote.apk`、`public/linote.apk`、`dist/client/linote.apk` 三处字节一致（sha256）
5. 在创建该 Site 的托管平台上发布（`dist/server/wrangler.json` 只是本地预览配置，worker 名仍是脚手架名，本机 `wrangler deploy` 不会发布到 `chatgpt.site`）
6. 发布后校验 `https://linote-notes-20261103.thinmerit.chatgpt.site/linote.apk` 的 sha256 与新包一致
7. GitHub Release：tag `v<版本>-standalone`，资产 `linote-standalone.apk`，body 里写明签名者与 sha256
