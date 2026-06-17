# 中转站监控实施计划

## 目标

在 `<project-root>` 构建独立 Electron/Node.js 桌面工具，用来监控 `ccswitch` 当前中转站的真实请求、余额、Token、消费、缓存命中率、上下文消耗和平均耗时。界面采用中文白色毛玻璃仪表盘，支持独立功能仪表盘和 Codex 伴随悬浮条。

## 模块划分

- `src/main`：Electron 主进程、窗口生命周期、托盘、IPC、余额登录窗口和伴随悬浮条跟随逻辑。
- `src/preload`：向渲染进程暴露受限、安全的桥接 API。
- `src/renderer`：中文毛玻璃主仪表盘、功能仪表盘、设置页、伴随悬浮条和趋势图。
- `src/relay`：读取 `ccswitch` 配置、SQLite 数据库、provider 状态、余额和统一快照。
- `src/collectors`：只保留从中转站请求数据计算缓存命中率和上下文消耗的工具。
- `src/shared`：时间、格式化、脱敏和共享工具。
- `scripts`：开发启动、检查、诊断、清理和 Windows 打包入口。
- `docs`：数据源、计划和验证说明。

## 数据流

1. 主进程定时读取 `ccswitch` 当前 provider 和请求数据库。
2. `src/relay/snapshot.js` 按当前 provider 聚合请求日志、Token、消费、趋势、缓存、上下文和余额状态。
3. preload 暴露只读 IPC 方法给渲染进程。
4. 主仪表盘、功能仪表盘和 Codex 伴随悬浮条订阅同一份快照。
5. 切换中转站或余额网页登录状态变化时，快照缓存立即失效并重新读取。

## 验收标准

- `npm run check` 通过。
- `npm test` 通过。
- `npm run smoke` 通过。
- `npm run diagnose` 能显示当前中转站、真实 Token、消费、趋势和余额状态。
- `npm run dist:win` 能在 `<project-root>\dist` 生成安装版和便携版。
- UI 不显示明文密钥，不把余额失败伪造成 0。
- Token、消费和趋势只来自中转站真实请求日志。
