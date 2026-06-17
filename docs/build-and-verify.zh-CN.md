# 构建与验证说明

本文档记录 Relay Monitor 当前 npm 脚本、PowerShell 入口和打包产物目录的对应关系。项目根目录固定为：

```text
<project-root>
```

## 前置条件

- Windows 本机桌面环境。
- Node.js 18.17 或更新版本。
- 已在项目根目录执行 `npm install`。
- 如需运行 Electron 启动或冒烟检查，当前会话需要可打开桌面窗口。

## 脚本对应关系

| npm 命令 | PowerShell 入口 | 实际行为 |
| --- | --- | --- |
| `npm start` | `scripts\dev.ps1` | 执行 `electron .`，启动桌面窗口。 |
| `npm run check` | `scripts\build.ps1` | 对列入脚本的主进程、preload、采集器、共享模块和渲染层文件执行 `node --check`。 |
| `npm test` | 无单独 PowerShell 包装 | 执行 relay、collectors 和 renderer 的 Node.js 测试。 |
| `npm run smoke` | 无单独 PowerShell 包装 | 执行 `electron . --smoke`，用于最小启动冒烟检查。 |
| `npm run dist:win` | `scripts\package-win.ps1` | 执行 `electron-builder --win --x64`，生成 Windows x64 安装包和便携包。 |
| `npm run clean` | `scripts\build.ps1 -CleanOnly` | 只删除项目内的 `dist` 构建输出目录。 |

## 推荐验证顺序

```powershell
cd <project-root>
npm run check
npm test
npm run smoke
npm run dist:win
```

`scripts\package-win.ps1` 会先设置 Electron / Electron Builder 镜像源，再依次运行 `npm run check`、`npm test`、`npm run smoke` 和 `npm run dist:win`。如果只想验证打包入口，可以执行：

```powershell
powershell -ExecutionPolicy Bypass -File <project-root>\scripts\package-win.ps1
```

## 产物目录

所有 Electron Builder 产物都输出到：

```text
<project-root>\dist
```

该目录由 `package.json` 中的 `build.directories.output` 指定。当前 Windows 打包目标包括：

- NSIS 安装包。
- Portable 便携包。
- Electron Builder 生成的辅助文件和 unpacked 目录。

清理构建输出时使用：

```powershell
npm run clean
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File <project-root>\scripts\build.ps1 -CleanOnly
```

清理脚本会校验目标路径仍在 `<project-root>` 项目内，只删除 `dist`，不删除源代码、依赖、用户目录数据或配置文件。

## 已知限制

- `npm run smoke` 依赖 Electron 能在当前 Windows 会话打开窗口；无图形环境中可能失败。
- `npm run check` 是语法检查，不替代单元测试或真实启动验证。
- `npm test` 当前覆盖 `tests\relay`、`tests\collectors` 和 `tests\renderer` 下的测试文件。
- `npm run dist:win` 需要本机依赖完整，首次运行可能下载或复用 Electron Builder 缓存。`scripts\package-win.ps1` 默认使用 `https://npmmirror.com/mirrors/electron/` 和 `https://npmmirror.com/mirrors/electron-builder-binaries/`，如需改回官方源，可在执行前设置同名环境变量覆盖。
