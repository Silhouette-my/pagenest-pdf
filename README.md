# PageNest PDF

**PDF 留在本地，阅读接着上次。**

[English](README.en.md) · [安装与部署](docs/install.md) · [版本下载](https://github.com/Silhouette-my/pagenest-pdf/releases/latest)

PageNest PDF 是一个在浏览器中运行的 PDF 阅读器，支持高亮、笔记、书签和阅读进度恢复。它把 PDF 渲染为普通网页中的可选择文本，方便配合 Gemini in Chrome 使用。

## 能做什么

- 阅读本地 PDF：选择文字、全文搜索、缩略图、目录、链接和表单。
- 四色高亮、添加笔记，将标注导出为 Markdown。
- 保存书签、导航历史和本地阅读统计。
- 记录最近阅读的文件，恢复页码、缩放、主题及标签页／窗口会话。
- 明暗界面、原始／深色／护眼页面主题，以及阅读外观调整。
- 可选 Chrome 扩展，将本地或网页 PDF 交给阅读器打开。
- 简体中文和英文界面。

PDF 解析、阅读记录与缓存都在浏览器本地处理。项目没有 PDF 上传接口、账号、云同步、统计追踪或 AI API。主动向 Gemini 分享标签页是另一项由用户控制的操作，适用 Google 服务的行为与条款。

## 先选一种使用方式

| 你的需求 | 推荐方式 | 是否需要安装 Node.js |
| --- | --- | --- |
| 日常使用、配合 Gemini | 下载网站包，部署为 HTTPS 网页 | 不需要 |
| 修改源码或先在电脑上试用 | 从源码启动本地服务 | 需要 |
| 自动打开本地／网页 PDF | 在上面任一种方式之外，再安装扩展 | 扩展本身不需要 |

**阅读器网页与 Chrome 扩展是两个部分。** 只用网页就能手动打开 PDF；扩展负责接管文件，不自带阅读器网站。当前没有 Chrome 商店安装入口。

### 方式一：下载即部署（推荐日常使用）

1. 打开[版本下载页](https://github.com/Silhouette-my/pagenest-pdf/releases/latest)，下载 `pagenest-pdf-site-v0.1.0.zip` 并解压。
2. 将解压后含 `index.html`、`assets/` 的文件夹上传到支持静态网站的 HTTPS 托管平台。可使用 [Netlify Drop](https://app.netlify.com/drop)：登录后拖入该文件夹，按页面提示完成部署。
3. 打开平台提供的 `https://…` 地址，选择或拖入 PDF，即可阅读。

上传的是阅读器程序，**不是你的 PDF**。部署包无需 Node.js、后端或 API 密钥。这里推荐部署在站点根路径；GitHub 仓库首页只是源码页面，不能当作阅读器网址。

### 方式二：在自己的电脑上启动

先安装 [Node.js LTS](https://nodejs.org/)（支持 20.19+ 或 22.12+），以及 Git，然后在终端运行：

```sh
git clone https://github.com/Silhouette-my/pagenest-pdf.git
cd pagenest-pdf
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

打开终端显示的地址，通常为 `http://127.0.0.1:5173/`。保持终端运行；停止服务后网页将不可用。以后只需进入项目文件夹并运行最后一条命令。

不使用 Git 也可以：在仓库页面点击 **Code → Download ZIP**，解压，在该文件夹打开终端，然后运行最后两条命令。用于 Gemini 的兼容性验证，请使用方式一的 HTTPS 地址。

### 可选：安装 Chrome 扩展

1. 在[版本下载页](https://github.com/Silhouette-my/pagenest-pdf/releases/latest)下载 `pagenest-pdf-extension-v0.1.0.zip` 并解压。
2. 打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**，选择解压后直接包含 `manifest.json` 的文件夹。
3. 打开扩展的**设置**，把**阅读器网址**改为你部署的 HTTPS 地址；本地试用则填写终端实际显示的地址。点击保存。
4. 要自动打开本地 PDF，在扩展**详细信息**中开启**允许访问文件网址**，并保持**自动打开本地 PDF**开启。

安装后请保留解压文件夹。**自动接管网页 PDF**默认关闭，可按需开启，也可使用扩展中的**打开当前 PDF**。完整步骤、检查方法和常见问题见[安装与部署指南](docs/install.md)。

## 阅读进度与隐私

**恢复上次会话**和 OPFS 离线副本默认开启。通过 **Recent Documents／最近文档**重新打开或移除文件，清空离线缓存会保留阅读记录。

恢复需要可读取的原文件句柄或有效缓存。普通文件缓存上限为 256 MiB；没有 Blob 的扩展传输缓存上限为 32 MiB。清除站点数据、更换网址或 Chrome 用户配置、文件权限失效，都可能需要重新选择 PDF。换部署网址不会自动迁移已有记录。

## 文档与限制

- [安装与部署](docs/install.md)：下载、启动、安装扩展、HTTPS 部署和常见问题。
- [开发说明](docs/development.md)：构建、项目结构与测试。
- [阅读器详细指南（英文）](docs/reader-guide.md)：控件、主题和具体实现。
- [验证记录（英文）](docs/verification.md)：自动化结果及待手动验收项。

扫描件需要 PDF 自身已有文字层；目前不支持 OCR 和密码保护文件。高亮与笔记保存在浏览器中，不嵌入原 PDF。深色模式保留大部分图片颜色，因此扫描页可能仍然明亮。远处尚未渲染页面的文字层不会为 Gemini 预先加载。

本项目独立于 Google 和 Mozilla。渲染依赖 [Mozilla PDF.js](https://github.com/mozilla/pdf.js)（Apache-2.0），阅读外观参考 [doq](https://github.com/shivaprsd/doq)，没有内置 doq 源码。详见[致谢](docs/reader-guide.md#acknowledgements--open-source-references)。项目自身代码尚未选择许可证。
