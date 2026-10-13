# 咪咪抓视频 / Mimi Media Catcher

**咪咪抓视频（Mimi Media Catcher）** 是一款本地运行的 Chrome Manifest V3 媒体下载扩展，面向 X、抖音、TikTok 和小红书的日常视频与图文保存场景。

> 当前版本：`v0.5.5`  
> 项目不使用第三方解析服务，不上传浏览记录。

[English](#english)

## 主要功能

| 平台 | 单条下载 | 浮动按钮 | 多档画质 | 图文/多图 | 主页批量下载 |
| --- | --- | --- | --- | --- | --- |
| X | ✓ | ✓ | 最多三档 | — | — |
| 抖音 | ✓ | ✓ | 最多三档 | ✓ | ✓ |
| TikTok | ✓ | ✓ | 最多三档 | ✓ | ✓ |
| 小红书 | ✓ | ✓ | 最多三档 | ✓ | ✓ |

### X

- 浏览推文时识别当前视频。
- 视频上的浮动按钮可选择最多三档画质和封面。
- 扩展弹窗中也可查看和下载当前视频。
- 按推文 ID 和媒体序号精确匹配；不提供批量下载。

### 抖音

- 支持主页、推荐、关注、朋友、精选、个人/博主主页、作品详情和视频弹窗。
- 最多三档视频画质，并支持封面和音频下载。
- 图文作品支持逐张下载和同作品多图一键下载。
- 信息流与单条详情只提供当前作品下载；只有真正的博主主页或“我的”主页支持批量下载。

### TikTok

- 支持 For You、Following、Friends、Explore、作品详情和创作者主页。
- 支持最多三档视频画质、封面、音频和 Photo 多图作品。
- 只有真正的 `@creator` 主页开放批量下载。

### 小红书

- 支持发现页、搜索页、笔记详情和博主主页。
- 视频笔记支持页面实际提供的最多三档画质和封面。
- 图文笔记支持单张下载和同笔记多图一键下载。
- 视频和图文的浮动按钮位于左上角，避开小红书原生图文页码。
- 只有真正的 `/user/profile/用户ID` 主页支持批量下载。

## 安装

1. 下载或克隆本仓库。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库根目录。
5. 更新代码后，在扩展管理页点击“重新加载”，并刷新已打开的目标网页。

## 使用

- 页面识别到可下载的媒体后，点击视频或图片上的浮动下载按钮。
- 也可点击 Chrome 工具栏中的扩展图标，查看当前页面的下载选项。
- 在支持的创作者主页中，可通过扩展弹窗或侧边栏进行批量选择。

## 隐私与安全

- 不使用第三方解析服务，不上传用户的浏览记录。
- 只允许从已声明平台的 HTTPS 媒体 CDN 下载，拒绝任意域名和非 HTTPS 地址。
- 浮动按钮下载必须来自用户的真实点击，页面脚本合成点击无法触发下载。
- 作品与当前页面使用 ID、路由和媒体 URL 精确匹配，避免 SPA 页面混入旧作品。

## 合规说明

本项目只用于保存你自己创作、已获授权或平台明确允许下载的内容。使用者应遵守当地法律、版权规则和相关平台服务条款。本项目不用于绕过 DRM、付费墙、访问控制或其他技术保护措施。

## 开发与测试

项目不需要构建工具或运行时依赖，直接加载源码目录即可开发调试。

```bash
node --test tests/*.test.js
node --check background.js
node --check content/inject.js
node --check content/bridge.js
node --check popup/popup.js
node --check sidepanel/sidepanel.js
jq empty manifest.json
```

### 代码结构

- `shared/`：平台域名校验、文件名清理和画质选择。
- `content/inject.js`：捕获和解析页面中的媒体数据。
- `content/bridge.js`：安全校验、媒体绑定和浮动下载菜单。
- `background.js`：下载权限校验和批量任务。
- `popup/` 与 `sidepanel/`：扩展弹窗和批量下载界面。
- `tests/`：平台解析、域名安全和路由匹配回归测试。

---

## English

**Mimi Media Catcher** is a locally running Chrome Manifest V3 extension for saving videos and image posts from X, Douyin, TikTok, and Xiaohongshu.

> Current version: `v0.5.5`  
> No third-party parsing service is used, and browsing history is never uploaded.

### Features

- **X:** Detects videos in posts, offers up to three available qualities plus cover download, and supports the extension popup. Batch downloading is intentionally disabled.
- **Douyin:** Supports Home, Recommended, Following, Friends, Featured, creator profiles, personal profiles, detail pages, and video modals. Video, cover, audio, single-image, multi-image, and creator-profile batch downloads are supported.
- **TikTok:** Supports For You, Following, Friends, Explore, detail pages, and `@creator` profiles. Video qualities, covers, audio, Photo posts, and creator-profile batch downloads are supported.
- **Xiaohongshu:** Supports Explore, Search, note details, and creator profiles. Video qualities, covers, single images, multi-image download, and creator-profile batch download are supported. Floating controls are placed at the top-left to avoid the native carousel counter.
- Media is matched to the active post by its ID, route, and media URL to avoid stale items after single-page navigation.

### Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root directory.
5. After updating the source, reload the extension and refresh any already-open target pages.

### Usage

- Click the floating download control on a recognized video or image.
- Alternatively, open the extension popup to view download options for the current page.
- On supported creator profile pages, use the popup or side panel to select multiple posts.

### Privacy and security

- No third-party media resolver is used and browsing history is not uploaded.
- Downloads are restricted to HTTPS media URLs on allowlisted platform CDN domains.
- Floating downloads require a real, trusted user click; synthetic page-script clicks are rejected.
- Active media is matched by post ID, route, and media URL to prevent stale SPA data from being downloaded.

### Responsible use

Use this project only for content you created, content you are authorized to save, or content the platform explicitly permits you to download. You are responsible for complying with applicable laws, copyright rules, and platform terms. This project is not designed to bypass DRM, paywalls, access controls, or other technical protection measures.

### Development

The extension has no build step or runtime dependencies. Load the source directory directly in Chrome for development. Run the commands in the Chinese development section above to execute tests and syntax checks.

