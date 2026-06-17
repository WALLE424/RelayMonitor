# UI 预览说明

`docs/ui-preview` 用来保存界面效果图、对比截图和 UI 决策记录。截图文件建议按日期和视图命名，方便后续对照实现效果。

界面结构和模块说明见 [程序界面导览](../interface-guide.zh-CN.md)。

## 保存位置

```text
<project-root>\docs\ui-preview
```

推荐命名：

```text
overview-YYYYMMDD.png
request-detail-YYYYMMDD.png
settings-YYYYMMDD.png
```

## UI 决策

- 首屏是可常驻桌面的透明毛玻璃小窗，不做营销式首页。
- 文案保持中文短句，优先展示余额、当前中转站、最近请求和风险状态。
- 总览页强调扫视：当前 provider、余额、请求数、费用、缓存命中率、上下文占用和七天趋势。
- 请求详情页展示模型、token、费用、耗时、状态码、时间和关联来源。
- 设置抽屉用于数据源路径、刷新频率、脱敏预览和窗口行为。
- 敏感信息只显示脱敏值，不在截图中出现明文 key。
- 视觉上使用轻量毛玻璃、细边框和紧凑控件，避免占用桌面空间。

## 关键截图

| 截图 | 说明 |
| --- | --- |
| `relay-monitor-v2-current-screen.png` | 当前程序主仪表盘截图，已隐藏中转站地址。 |
| `relay-monitor-v2-current-tokens-module.png` | 当前程序 Token 模块截图。 |
| `relay-monitor-v2-current-companion.png` | Codex 伴随悬浮条。 |

## 开源截图要求

- 使用示例中转站、示例余额和示例 Token。
- 不提交真实后台地址、真实消费流水、真实 Cookie、真实 API key 或完整本机路径。
- 如果截图来自真实环境，提交前需要裁剪或脱敏。
