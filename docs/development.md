# 开发与构建

面向使用者的步骤请看[安装与部署](install.md)。本页用于修改源码、构建和验证。

## 开发

需要 Node.js 20.19+ 或 22.12+、npm 和项目锁文件。在仓库根目录运行：

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

浏览器打开终端输出的网址。扩展可以直接加载 `extension/`，设置阅读器网址为同一个地址。

## 构建和预览

```sh
npm run check
npm run preview -- --host 127.0.0.1
```

`check` 先运行严格 TypeScript 检查，再生成 `dist/`。`preview` 用于本地检查该构建，地址以终端输出为准，不是生产托管服务。

部署到 HTTPS 网站根路径时上传 `dist/` 的**内容**，无需后端。部署到子路径时需要在构建中指定对应 base，例如 GitHub Pages 项目页：

```sh
npm run build -- --base=/pagenest-pdf/
```

随后按托管平台要求发布 `dist/`。GitHub 源码仓库或 Release 的存在并不代表网站已部署；本次文档更新也没有创建公开阅读器站点。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/pdf/` | PDF.js 加载、渲染、搜索、链接及表单 |
| `src/history/` | 阅读历史、缓存和标签页／窗口恢复 |
| `src/reader/` | 高亮、笔记、书签及阅读统计 |
| `src/theme/`、`src/styles/`、`src/ui/` | 外观与界面 |
| `src/i18n/` | 阅读器翻译 |
| `extension/` | Chrome Manifest V3 扩展与桥接测试 |
| `tests/` | 浏览器验收及模拟诊断 |
| `public/` | 公开测试文件 |
| `docs/archive/` | 带日期的历史验证证据 |

## 验证

浏览器测试需要安装 Chrome 和 OpenSSL；可用 `CHROME_PATH` 指定浏览器。测试创建隔离用户配置和本地服务；HTTPS 测试的自签名证书仅由测试浏览器接受。

```sh
npm run test:history
npm run test:session
npm run test:performance
npm run test:extension
npm run test:extension-file
npm run test:extension-range
npm run test:production
```

`npm run test:acceptance` 组合运行 `check`、`test:performance` 和 `test:production`，不包含上面所有测试。`node tests/handoff-race-diagnostic.mjs` 是模拟 Chrome API 的调查工具，不能证明真实浏览器原生崩溃。

查看[验证记录](verification.md)了解历史结果及待手动检查项。

## 维护

提交源码、锁文件、测试及测试文件；不提交依赖、构建输出、个人日志、浏览器用户配置或发布 ZIP。改名时保留现有浏览器存储键和桥接协议，避免已有数据失去关联。

项目自身代码尚未选择许可证，依赖许可和设计参考见[详细致谢](reader-guide.md#acknowledgements--open-source-references)。
