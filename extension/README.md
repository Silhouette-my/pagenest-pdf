# PageNest PDF Chrome 扩展

[返回项目首页](../README.md) · [完整安装与部署指南](../docs/install.md)

扩展把 Chrome 中的 PDF 交给普通 HTTP(S) 阅读器网页。**先准备一个可以访问的阅读器网址，再安装扩展。** 扩展本身不包含阅读器网站。

## 安装：下载、加载、设置

1. 到[版本下载页](https://github.com/Silhouette-my/pagenest-pdf/releases/latest)下载含 `extension` 的 ZIP，解压；使用源码时直接选择本目录。
2. 打开 `chrome://extensions`，启用**开发者模式**，点击**加载已解压的扩展程序**。
3. 选择直接包含 `manifest.json` 的文件夹。
4. 打开扩展**设置**，填写**阅读器网址**并保存。部署后填写你的 `https://…/` 地址；本地开发通常填 `http://127.0.0.1:5173/`，以终端实际地址为准。
5. 要接管本地 PDF，在 Chrome 的扩展**详细信息**中启用**允许访问文件网址**，保持**自动打开本地 PDF**开启。

保留解压后的文件夹。移动或删除它会影响 Chrome 加载扩展。目前没有 Chrome 商店安装入口。

## 日常使用

- 本地 PDF：在 Chrome 中打开 `file://` PDF，扩展按设置自动交给阅读器。
- 网页 PDF：自动接管默认关闭，打开 PDF 后可点击扩展中的**打开当前 PDF**；想自动处理时再开启**自动接管网页 PDF**。
- 返回原 PDF：阅读器工具栏的 **Exit Reader** 返回原网址，并短暂避免重复接管。
- 使用本地阅读器时保持开发服务运行；部署后的 HTTPS 阅读器无需在电脑上保持该服务运行。

## 工作原理与边界

扩展从本地文件或 PDF 原始网址获取数据，交给网页中的 PDF.js 渲染，没有 PageNest PDF 后端上传接口。

HTTP(S) 来源支持 Range 时按需获取字节；支持流式传输时渐进加载；其他来源使用缓冲传输。传输有 512 MB 安全上限，队列通过确认消息限制堆积。macOS 本地 PDF 使用新标签页和隐藏桥接 iframe，将 ArrayBuffer 直接传给阅读器；网页 PDF 避免过早的导航重定向，可能短暂显示 Chrome 原生 PDF 界面。

本地文件权限由 Chrome 控制，扩展不能自行开启。将阅读器标签页分享给 Gemini 是用户主动选择的另一个流程。

## 开发验证

在仓库根目录运行：

```sh
npm run test:extension
npm run test:extension-file
npm run test:extension-range
```

测试使用 Chrome DevTools 的扩展加载接口。真实用户安装请使用上述 **加载已解压的扩展程序** 操作。测试结果与限制见[验证记录](../docs/verification.md)。
