# 中转站监控

`中转站监控 / Relay Monitor` 是一个面向 Windows 的 Electron 桌面工具。当前版本以 `ccswitch` 当前中转站为唯一主数据源，读取或计算请求地址、当前 provider、真实请求日志、模型、推理强度、Token、消费、缓存命中率、上下文消耗、平均耗时和余额状态。

## 当前状态

- 主窗口是白色毛玻璃单仪表盘，可打开独立功能仪表盘。
- 功能仪表盘支持独立移动、调整大小、置顶和关闭。
- Codex 伴随悬浮条复用同一份中转站快照，只显示短格式状态。
- 今日 Token、今日消费、总消费和 7 天趋势来自 `ccswitch` 真实请求日志或日汇总。
- 余额优先读取中转站接口；没有接口时可使用网页登录 session 读取；再不行才使用手动估算。
- 余额失败会显示“需要登录 / 提取失败 / 未配置 / 读取失败”等状态，不会伪装成 `¥0.00`。

## 项目结构

```text
<project-root>
├─ src
│  ├─ main          Electron 主进程、窗口、托盘、IPC、余额登录窗口和悬浮条跟随逻辑
│  ├─ preload       暴露给渲染进程的受限安全 API
│  ├─ renderer      中文毛玻璃界面、独立仪表盘、设置页和趋势图
│  ├─ relay         ccswitch 数据库、provider、余额和快照聚合
│  ├─ collectors    从中转站请求数据计算缓存命中率和上下文消耗
│  └─ shared        时间、格式化、密钥脱敏和共享工具
├─ docs             计划、数据源和验证说明
├─ scripts          开发、检查、诊断和 Windows 打包入口
├─ dist             Electron Builder 输出目录
└─ package.json     npm 脚本和打包配置
```

## 常用命令

```powershell
cd <project-root>
npm install
npm start
```

| 命令 | 作用 |
| --- | --- |
| `npm run check` | 对主进程、preload、relay、renderer 做 JS 语法检查 |
| `npm test` | 运行 Node.js 内置测试 |
| `npm run smoke` | Electron 最小启动冒烟检查 |
| `npm run diagnose` | 输出当前 ccswitch 快照诊断，不显示明文密钥 |
| `npm run dist:win` | 生成 Windows 安装版和便携版 |

打包产物输出到：

```text
<project-root>\dist
```

安装版使用 NSIS 引导安装，支持选择安装目录；同时保留便携版 exe。

## 数据口径

默认读取：

```text
%USERPROFILE%\.cc-switch\settings.json
%USERPROFILE%\.cc-switch\cc-switch.db
```

核心原则：

- 当前中转站以 `ccswitch` 选中的 provider 为准。
- 请求模型和推理强度优先取最近真实请求；没有真实请求时显示未检测或未记录。
- Token、消费、平均耗时、缓存命中率、上下文消耗和 7 天趋势只从中转站请求日志或日聚合数据计算。
- Codex/Claude 只是使用该中转站的客户端，不再作为独立用量来源。
- 切换中转站后，快照会按当前 provider 过滤请求日志、趋势和余额缓存。

## 余额读取

余额有三种方式：

- 自动接口：使用中转站配置或常见余额 API 探测。
- 网页登录：打开内置登录窗口，用户手动登录后读取；程序保存 Cookie/session，不保存密码。
- 手动估算：用初始余额减去中转站累计消费，并明确标记为估算。

如果中转站后台需要验证码、没有余额接口或页面结构特殊，网页登录方式可能需要在设置里填写余额页地址或 CSS 选择器。读取失败时会显示明确状态，不会显示假余额。

## 安全说明

- 明文 API key 只在主进程内读取，用于必要的中转站接口请求。
- 渲染进程只接收 `maskedKey` 或 `keyPreview`。
- IPC、诊断输出、UI 和错误信息不输出明文密钥、网页登录密码或 Cookie 明文。
- 打包产物不包含用户目录下的配置、数据库或登录态。
