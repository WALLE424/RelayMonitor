# 数据源说明

本项目只读取本机 `ccswitch` 配置、SQLite 数据库和用户主动登录后的中转站网页 session，不主动上传数据。

## ccswitch

默认位置：

```text
%USERPROFILE%\.cc-switch\settings.json
%USERPROFILE%\.cc-switch\cc-switch.db
```

主要用途：

- 读取当前选中的中转站 provider。
- 读取请求地址、模型配置、密钥脱敏预览和余额配置。
- 读取真实请求日志，包括模型、推理强度、Token、费用、耗时、状态码和时间。
- 读取或计算每日、每周、每月 Token 与消费。
- 当切换中转站后，按当前 provider 过滤请求、趋势和余额缓存。

## 余额

余额读取顺序：

1. 当前 provider 显式配置的余额接口。
2. 常见中转站余额 API。
3. 用户手动登录后的网页 session 读取。
4. 手动估算余额。

网页登录方式只保存 Cookie/session，不保存密码。若页面需要验证码、余额在异步接口中或页面结构特殊，需要补充余额页面地址或 CSS 选择器。

## 缓存和上下文

缓存命中率、上下文消耗不是从 Codex/Claude 本地会话估算，而是从 `ccswitch` 请求日志里的 Token 字段计算：

- `cacheReadTokens`
- `cacheCreationTokens`
- `inputTokens`
- `outputTokens`
- 当前请求模型对应的上下文窗口

## 缺失和异常

- 找不到 `ccswitch` 数据库时，界面显示未连接/无数据。
- 没有当前 provider 的请求日志时，Token 和消费显示 0 或无记录。
- 余额失败时显示“需要登录 / 提取失败 / 未配置 / 读取失败”，不会显示假 `¥0.00`。
- 密钥、Cookie、网页登录密码不会进入渲染进程或诊断输出。
