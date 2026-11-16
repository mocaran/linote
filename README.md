# linote

> 保卫个人史 —— 离线优先的卡片笔记应用。

linote 是一款离线 Android 卡片笔记工具：打开应用即可创建本机档案，随手记录文字和图片，用 `#话题` 整理笔记，通过搜索和随机回顾找回过去的想法。笔记只保存在当前设备。

灵感来自刘白光（Light），以及他与刘少楠合著的《笔记的方法》。linote 把书中「用自己的话写卡片、用标签串联记录、定期回顾」的做法融入日常记录。（[《笔记的方法》](https://help.flomoapp.com/thinking/book.html)）

- 适用于 **Android 10 及以上**（`minSdk 29`）
- 单机版可与联网版并存，使用独立的本机档案
- 当前版本暂不支持本机笔记的导入 / 导出

**[下载 Android APK](https://github.com/mocaran/linote/releases/latest)**

---

## 仓库结构

这个仓库同时包含「网页版（站点）」和「Android 单机版套壳」两部分，二者共用同一份前端代码。

| 路径 | 说明 |
| --- | --- |
| `app/` `components/` `hooks/` `lib/` | 站点前端（Next.js / React / TypeScript，Tailwind + shadcn 风格组件） |
| `public/` | 离线版的前端资源：`offline.html`、`app.js`、各主题 CSS |
| `scripts/` | 构建与发布脚本（含把 `public/` 资源打成本地站点包的脚本） |
| `worker/` `db/` `drizzle/` | 站点后端：Cloudflare Worker / D1 数据库与迁移 |
| `android/` | Android 单机版：`MainActivity.java` 里的 WebView 壳 + 打包脚本 |
| `vendor/` `examples/` | 站点脚手架带来的第三方与示例代码 |

### 单机版与联网版的差别

单机版的界面就是 `public/offline.html` + `public/app.js`，被 `android/` 里的 WebView 加载，数据落在 **IndexedDB**（`linote-offline-v1`）与 **localStorage**（`linote.account.v1`）里，不上传任何服务器。因为依赖后端，以下功能在校本机档案下不可用，点了会提示「仅本机档案暂不支持」：

- 导出 / 导入（JSON、flomo HTML 导入）
- 洞察
- 微信公众号接入

## 从源码构建

### 网页版

```bash
npm install
npm run dev      # 本地开发
npm run build    # 产物构建
```

要求 Node.js ≥ 22.13。

### Android 单机版 APK

```powershell
powershell -File android/build-apk.ps1 -Standalone
```

脚本会用 Android SDK 的 `aapt2` / `d8` / `zipalign` / `apksigner` 手工打包（不经过 Gradle），需要：

- Android SDK：`build-tools;36.1.0`、`platforms;android-36.1`（或设置 `ANDROID_HOME`）
- JDK 17（或设置 `JAVA_HOME`）

> ⚠️ 当前脚本使用仓库内的 `android/debug.keystore` 签名。debug key 是公开可得的通用密钥，任何人都能用同名同签名的 APK 伪装成这个应用的更新，**不适合作为正式分发签名**；对外发布请改用自己生成的 release keystore。

## 已知限制

- `检查更新` 会请求版本清单并下载 APK，但 Android 清单**没有声明 `INTERNET` 权限**（应用本身完全离线），因此这条链路在当前版本不可用。
- 应用内没有任何权限声明，也就无法联网；这是「离线优先」的取舍，不是遗漏。

## License

尚未添加开源许可证文件。若要允许他人自由使用 / 修改 / 分发，建议补充 MIT 或 Apache-2.0。
