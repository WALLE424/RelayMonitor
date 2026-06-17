(function () {
  "use strict";

  var ui = window.RelayMonitorUI;
  var trend = window.RelayMonitorTrend;

  var dockModules = [
    { id: "api", label: "API", title: "API 切换", hint: "查看当前中转站、地址和密钥预览" },
    { id: "requests", label: "请求", title: "请求详情", hint: "最近真实请求、模型和耗时" },
    { id: "tokens", label: "Token", title: "Token 统计", hint: "Token、缓存和七天趋势" },
    { id: "balance", label: "余额", title: "余额消费", hint: "余额、消费额度和读取状态" },
    { id: "cache", label: "缓存", title: "缓存上下文", hint: "缓存命中率与上下文消耗" },
    { id: "settings", label: "设置", title: "设置", hint: "打开完整设置面板" }
  ];

  var defaultPanelLayout = {
    api: { left: 520, top: 96, z: 24 },
    requests: { left: 548, top: 188, z: 26 },
    tokens: { left: 516, top: 284, z: 25 },
    balance: { left: 558, top: 118, z: 21 },
    cache: { left: 540, top: 330, z: 20 },
    settings: { left: 530, top: 238, z: 19 }
  };

  function resolveRequests(snapshot) {
    var requests = ui.getPath(snapshot, ["recentRequests", "requests.recent", "latest"], []);
    return Array.isArray(requests) ? requests : [];
  }

  function getTrend(snapshot) {
    return ui.getPath(snapshot, ["trend7d", "trends.tokens7d", "usage.trend7d", "weeklyTrend", "trend"], []);
  }

  function trendValue(point) {
    return ui.toNumber(typeof point === "number" ? point : ui.getPath(point, ["value", "tokens", "total"], 0), 0);
  }

  function summarizeTokens(snapshot) {
    var usage = ui.getPath(snapshot, ["usage", "tokens"], {});
    var points = getTrend(snapshot);
    var input = ui.toNumber(ui.getPath(snapshot, ["tokens.input", "tokenUsage.input", "usage.inputTokens", "usage.promptTokens"], usage.input || usage.prompt || 0), 0);
    var output = ui.toNumber(ui.getPath(snapshot, ["tokens.output", "tokenUsage.output", "usage.outputTokens", "usage.completionTokens"], usage.output || usage.completion || 0), 0);
    var cached = ui.toNumber(ui.getPath(snapshot, ["tokens.cached", "tokenUsage.cached", "usage.cachedTokens", "cache.hitTokens"], usage.cached || 0), 0);
    var total = ui.toNumber(ui.getPath(snapshot, ["tokens.total", "tokenUsage.total", "usage.totalTokens"], usage.total || input + output + cached), input + output + cached);
    var weeklyFromTrend = Array.isArray(points) ? points.reduce(function (sum, point) {
      return sum + trendValue(point);
    }, 0) : 0;
    var todayPoint = Array.isArray(points) && points.length ? points[points.length - 1] : null;
    var dailyFromTrend = todayPoint ? trendValue(todayPoint) : 0;
    return {
      cached: cached,
      daily: ui.toNumber(ui.getPath(snapshot, ["tokens.daily", "usage.todayTokens", "periods.todayTokens"], dailyFromTrend), dailyFromTrend),
      input: input,
      monthly: ui.toNumber(ui.getPath(snapshot, ["tokens.monthly", "usage.monthTokens", "periods.monthTokens"], 0), 0),
      output: output,
      total: total,
      weekly: ui.toNumber(ui.getPath(snapshot, ["tokens.weekly", "usage.weekTokens", "periods.weekTokens"], weeklyFromTrend), weeklyFromTrend)
    };
  }

  function getAutomaticRelayName(snapshot) {
    return ui.getPath(snapshot, ["currentRelay.name", "relay.name", "provider.name", "station"], "等待中转站数据");
  }

  function getRelayName(snapshot, settings) {
    var customName = String(ui.getPath(settings || {}, ["customRelayName"], "") || "").trim();
    return customName || getAutomaticRelayName(snapshot);
  }

  function getProvider(snapshot) {
    return ui.getPath(snapshot, ["provider", "currentProvider"], {}) || {};
  }

  function isBalanceAmount(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
      return false;
    }
    return Number.isFinite(Number(value));
  }

  function firstBalanceAmount(source, fields) {
    for (var i = 0; i < fields.length; i += 1) {
      var value = ui.getPath(source, [fields[i]], null);
      if (isBalanceAmount(value)) {
        return Number(value);
      }
    }
    return null;
  }

  function getBalance(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (balance && typeof balance === "object" && !Array.isArray(balance)) {
      return firstBalanceAmount(balance, ["amount", "remaining", "available"]);
    }
    if (isBalanceAmount(balance)) {
      return Number(balance);
    }
    return firstBalanceAmount(snapshot, ["balance.available", "account.balance"]);
  }

  function getBalanceStatusText(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
      return "暂不可用";
    }
    var status = String(ui.getPath(balance, ["status"], "") || "").toLowerCase();
    var source = String(ui.getPath(balance, ["source"], "") || "").toLowerCase();
    var endpoint = String(ui.getPath(balance, ["endpoint"], "") || "").trim();
    if (/unlimited/.test(status)) {
      return "需要登录";
    }
    if (/auth-required|unauthorized|forbidden|401|403/.test(status)) {
      return "需要登录";
    }
    if (/parse-error/.test(status)) {
      return "提取失败";
    }
    if (/rate-limited|429/.test(status)) {
      return "请求过于频繁";
    }
    if (/provider-mismatch|wrong-provider|stale-provider/.test(status)) {
      return "余额页面不匹配";
    }
    if (/unconfigured|not[_-]?configured|missing|none|disabled/.test(status + " " + source) || (!endpoint && /unavailable|unknown|error/.test(status))) {
      return "未配置";
    }
    if (/error|unavailable|unknown/.test(status)) {
      return "读取失败";
    }
    return "暂不可用";
  }

  function getBalanceNote(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (balance && typeof balance === "object" && !Array.isArray(balance)) {
      if (getBalance(snapshot) === null) {
        return getBalanceStatusText(snapshot);
      }
      var source = String(ui.getPath(balance, ["source"], "") || "").trim();
      if (source === "web-session") return "网页登录读取";
      if (source === "web-session-api") return "网页登录接口";
      if (source === "manual") return "手动估算";
      if (source) return "真实接口读取";
    }
    return "账户可用";
  }

  function balanceSourceLabel(source) {
    var normalized = String(source || "").trim();
    if (normalized === "web-session-api") return "网页登录接口";
    if (normalized === "web-session") return "网页登录页面";
    if (normalized === "relay-endpoint") return "中转站接口";
    if (normalized === "manual-minus-spend") return "手动估算";
    if (normalized === "manual") return "手动输入";
    return normalized || "未检测";
  }

  function safeEndpointPath(endpoint) {
    var raw = String(endpoint || "").trim();
    if (!raw) return "未检测";
    try {
      var parsed = new URL(raw);
      return parsed.hostname + parsed.pathname;
    } catch (_) {
      return raw.split("?")[0].slice(0, 120);
    }
  }

  function getBalanceActionHint(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
      return "打开设置选择余额获取方式";
    }
    var status = String(ui.getPath(balance, ["status"], "") || "").toLowerCase();
    if (/unlimited/.test(status)) return "网页登录读取账户数据里的真实余额";
    if (/auth-required|unauthorized|forbidden|401|403/.test(status)) {
      return "到设置中使用网页登录余额页面";
    }
    if (/parse-error/.test(status)) {
      return "在设置中填写余额 CSS 选择器";
    }
    if (/provider-mismatch|wrong-provider|stale-provider/.test(status)) {
      return "检查余额页面是否属于当前中转站";
    }
    if (/not[_-]?configured|missing|none|disabled|unconfigured/.test(status)) {
      return "配置余额页面或手动余额";
    }
    if (/rate-limited|429/.test(status)) {
      return "稍后重试或延长刷新间隔";
    }
    if (/error|unavailable|unknown/.test(status)) {
      return "打开余额详情查看接口状态";
    }
    return "余额链路正常";
  }

  function shouldShowBalanceLoginAction(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
      return false;
    }
    var status = String(ui.getPath(balance, ["status"], "") || "").toLowerCase();
    return /auth-required|login-required|unauthorized|forbidden|expired|401|403/.test(status);
  }

  function getBalanceDiagnostics(snapshot) {
    var balance = ui.getPath(snapshot, ["balance"], null);
    if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
      return [];
    }
    var rows = [];
    var status = String(ui.getPath(balance, ["status"], "") || "").trim();
    var source = String(ui.getPath(balance, ["source"], "") || "").trim();
    var endpoint = String(ui.getPath(balance, ["endpoint"], "") || "").trim();
    var httpStatus = ui.getPath(balance, ["httpStatus"], null);
    var sourceField = String(ui.getPath(balance, ["sourceField"], "") || "").trim();
    var quotaPerUnit = ui.getPath(balance, ["quotaPerUnit"], null);
    var rawQuota = ui.getPath(balance, ["rawQuota"], null);
    var quotaStatus = String(ui.getPath(balance, ["quotaStatus"], "") || "").trim();
    var quotaEndpoint = String(ui.getPath(balance, ["quotaEndpoint"], "") || "").trim();
    var quotaSourceField = String(ui.getPath(balance, ["quotaSourceField"], "") || "").trim();
    if (status) rows.push({ label: "读取状态", value: status, note: getBalanceStatusText(snapshot) });
    if (source) rows.push({ label: "读取来源", value: balanceSourceLabel(source), note: source });
    if (httpStatus !== null && httpStatus !== undefined && httpStatus !== "") {
      rows.push({ label: "HTTP 状态", value: String(httpStatus), note: httpStatus >= 200 && httpStatus < 400 ? "接口已响应" : "接口异常" });
    }
    if (endpoint) rows.push({ label: "读取接口", value: safeEndpointPath(endpoint), note: "已隐藏参数" });
    if (sourceField) rows.push({ label: "余额字段", value: sourceField, note: "来自响应结构" });
    if (quotaPerUnit) rows.push({ label: "Quota 单位", value: String(quotaPerUnit), note: rawQuota ? "原始 quota " + rawQuota : "New API 换算" });
    if (quotaStatus) rows.push({ label: "Token 额度", value: quotaStatus === "unlimited" ? "不限额" : quotaStatus, note: "不是账户余额" });
    if (quotaEndpoint) rows.push({ label: "额度接口", value: safeEndpointPath(quotaEndpoint), note: quotaSourceField || "Token quota" });
    rows.push({ label: "建议操作", value: getBalanceActionHint(snapshot), note: "不会显示网页登录密码或 Cookie" });
    return rows;
  }

  function formatBalance(snapshot) {
    var amount = getBalance(snapshot);
    return amount === null ? getBalanceStatusText(snapshot) : ui.formatCurrency(amount);
  }

  function getSpend(snapshot) {
    return {
      today: ui.toNumber(ui.getPath(snapshot, ["spend.today", "periods.todayCost"], 0), 0),
      week: ui.toNumber(ui.getPath(snapshot, ["spend.week", "periods.weekCost"], 0), 0),
      month: ui.toNumber(ui.getPath(snapshot, ["spend.month", "periods.monthCost"], 0), 0),
      total: ui.toNumber(ui.getPath(snapshot, ["spend.total", "periods.totalCost"], 0), 0)
    };
  }

  function getTotalSpend(snapshot, spend) {
    var fallback = spend.total || spend.month;
    return ui.toNumber(ui.getPath(snapshot, ["spend.total", "periods.totalCost"], fallback), fallback);
  }

  function getSpendSourceLabel(snapshot) {
    var source = String(ui.getPath(snapshot, ["spend.source", "usageSummary.source"], "") || "").toLowerCase();
    var status = String(ui.getPath(snapshot, ["spend.status", "usageSummary.status"], "") || "").toLowerCase();
    if (/relay-official-api/.test(source)) return "中转站接口汇总";
    if (/relay-web-session/.test(source)) return "中转站网页登录汇总";
    if (/fallback-request-log|ccswitch-request-log/.test(status + " " + source)) return "请求日志累计";
    return "中转站账单口径";
  }

  function getCacheHit(snapshot) {
    return ui.normalizePercent(ui.getPath(snapshot, ["cache.hitRate", "cacheHitRate", "cache.rate"], 0), 0);
  }

  function getContextUsage(snapshot) {
    return ui.normalizePercent(ui.getPath(snapshot, ["context.usage", "contextUsage", "context.percent", "context.usedPercent"], 0), 0);
  }

  function getContextTokens(snapshot) {
    var used = ui.toNumber(ui.getPath(snapshot, ["context.usedTokens", "context.used", "context.tokensUsed"], 0), 0);
    var windowTokens = ui.toNumber(ui.getPath(snapshot, ["context.windowTokens", "context.window", "context.limit"], 0), 0);
    var remaining = ui.toNumber(ui.getPath(snapshot, ["context.remainingTokens", "context.remaining"], Math.max(windowTokens - used, 0)), Math.max(windowTokens - used, 0));
    return { remaining: remaining, used: used, windowTokens: windowTokens };
  }

  function getRequestModel(request, fallback) {
    return ui.getPath(request, ["requestModel", "request_model", "model", "modelName"], fallback || "未知模型");
  }

  function getRequestTime(request) {
    var value = ui.getPath(request, ["time", "createdAt", "timestamp"], null);
    var date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }

  function getLatestRequest(snapshot) {
    var requests = resolveRequests(snapshot);
    if (!requests.length) return null;
    return requests.slice().sort(function (a, b) {
      return getRequestTime(b) - getRequestTime(a);
    })[0] || requests[0];
  }

  function getModel(snapshot) {
    var providerModel = ui.getPath(snapshot, ["provider.model", "currentRelay.model", "model"], "未知模型");
    var latest = getLatestRequest(snapshot);
    return latest ? getRequestModel(latest, providerModel) : providerModel;
  }

  function getReasoningEffort(snapshot) {
    var fallback = ui.getPath(snapshot, ["provider.reasoningEffort", "reasoningEffort", "settings.reasoningEffort"], "未设置");
    var latest = getLatestRequest(snapshot);
    return latest ? ui.getPath(latest, ["requestReasoningEffort", "reasoningEffort", "reasoning.effort"], fallback) : fallback;
  }

  function getAverageLatency(snapshot) {
    return ui.toNumber(ui.getPath(snapshot, ["usage.avgLatencyMs", "latency.avg", "latency.p95", "avgLatencyMs"], 0), 0);
  }

  function getEndpoint(snapshot) {
    return ui.getPath(snapshot, ["endpoint", "provider.baseUrl", "currentRelay.endpoint", "relay.endpoint", "baseUrl"], "未检测到请求地址");
  }

  function getSecret(snapshot, visible) {
    var provider = getProvider(snapshot);
    var masked = ui.getPath(provider, ["maskedKey"], "");
    var preview = ui.getPath(provider, ["keyPreview", "apiKeyPreview"], "");
    if (visible && preview) return preview;
    return masked || preview || "未检测到密钥";
  }

  function requestStatusClass(request) {
    var status = String(ui.getPath(request, ["status", "state"], "成功"));
    return /error|fail|失败|异常|4\d\d|5\d\d/i.test(status) ? " is-error" : "";
  }

  function requestTokens(request) {
    var input = ui.toNumber(ui.getPath(request, ["tokens.input", "usage.inputTokens", "inputTokens"], 0), 0);
    var output = ui.toNumber(ui.getPath(request, ["tokens.output", "usage.outputTokens", "outputTokens"], 0), 0);
    var cached = ui.toNumber(ui.getPath(request, ["tokens.cached", "usage.cachedTokens", "cacheReadTokens"], 0), 0);
    return ui.toNumber(ui.getPath(request, ["tokens.total", "usage.totalTokens", "totalTokens"], input + output + cached), input + output + cached);
  }

  function infoRow(label, value, note) {
    return [
      '<div class="info-row">',
      '<span class="info-label">' + ui.escapeHtml(label) + "</span>",
      '<span class="info-value" title="' + ui.escapeHtml(value) + '">' + ui.escapeHtml(value) + "</span>",
      note ? '<span class="info-note" title="' + ui.escapeHtml(note) + '">' + ui.escapeHtml(note) + "</span>" : "",
      "</div>"
    ].join("");
  }

  function modelMark(model) {
    var name = String(model || "").toLowerCase();
    if (/claude|anthropic/.test(name)) return { className: "is-claude", label: "ANTH" };
    if (/deepseek|v3|v4/.test(name)) return { className: "is-deepseek", label: "DS" };
    return { className: "is-gpt", label: "MODEL" };
  }

  function renderModelSummary(snapshot, requests, tokens) {
    var latest = getLatestRequest(snapshot) || (requests.length ? requests[0] : null);
    var model = latest ? getRequestModel(latest, getModel(snapshot)) : getModel(snapshot);
    var total = latest ? requestTokens(latest) : tokens.total;
    var cost = latest ? ui.getPath(latest, ["cost", "price", "amount", "totalCostUsd"], 0) : ui.getPath(snapshot, ["spend.today"], 0);
    var latency = latest ? ui.toNumber(ui.getPath(latest, ["latency", "durationMs", "latencyMs"], getAverageLatency(snapshot)), getAverageLatency(snapshot)) : getAverageLatency(snapshot);
    var mark = modelMark(model);
    var fill = Math.max(6, Math.min(100, Math.round((total / Math.max(tokens.daily, total, 1)) * 100)));

    return [
      '<section class="dashboard-model-card">',
      '<span class="usage-icon ' + mark.className + '" aria-hidden="true"><span>' + ui.escapeHtml(mark.label) + "</span></span>",
      '<div class="dashboard-model-main">',
      '<strong title="' + ui.escapeHtml(model) + '">' + ui.escapeHtml(model) + "</strong>",
      '<span title="当前模型 · 推理强度 · Token">当前模型 · 推理 ' + ui.escapeHtml(getReasoningEffort(snapshot)) + " · " + ui.escapeHtml(ui.formatCompactNumber(total)) + " Tokens</span>",
      '<span class="usage-track"><span style="width:' + fill + '%"></span></span>',
      "</div>",
      '<div class="dashboard-model-side"><strong>实时</strong><span>' + ui.escapeHtml(ui.formatDurationMs(latency)) + "</span><em>" + ui.escapeHtml(ui.formatCurrency(cost)) + "</em></div>",
      "</section>"
    ].join("");
  }

  function renderDock(activeModules) {
    return [
      '<nav class="dashboard-dock" aria-label="功能 Dock">',
      dockModules.map(function (module) {
        var active = isModuleActive(activeModules, module.id);
        return [
          '<button class="dock-button' + (active ? " is-active" : "") + '" type="button" data-module-toggle="' + ui.escapeHtml(module.id) + '" aria-pressed="' + (active ? "true" : "false") + '" title="' + ui.escapeHtml(module.title) + '">',
          '<span class="dock-icon dock-icon-' + ui.escapeHtml(module.id) + '" aria-hidden="true"><i></i></span>',
          '<span class="dock-label">' + ui.escapeHtml(module.label) + "</span>",
          "</button>"
        ].join("");
      }).join(""),
      "</nav>"
    ].join("");
  }

  function isModuleActive(activeModules, id) {
    if (Array.isArray(activeModules)) return activeModules.indexOf(id) !== -1;
    return Boolean(activeModules && activeModules[id]);
  }

  function getActiveModuleIds(activeModules) {
    return dockModules.filter(function (module) {
      return isModuleActive(activeModules, module.id);
    }).map(function (module) {
      return module.id;
    });
  }

  function getModule(id) {
    return dockModules.filter(function (module) {
      return module.id === id;
    })[0] || { id: id, title: id, label: id, hint: "" };
  }

  function renderDragGrip(id) {
    return [
      '<span class="module-drag-grip" data-drag-handle="' + ui.escapeHtml(id) + '" aria-label="拖动 ' + ui.escapeHtml(getModule(id).label || id) + ' 面板">',
      '<i></i><i></i><i></i><i></i><i></i><i></i>',
      "</span>"
    ].join("");
  }

  function renderModuleHeader(module) {
    return [
      '<header class="module-panel-head">',
      '<div class="module-title-wrap">',
      renderDragGrip(module.id),
      '<h2>' + ui.escapeHtml(module.title) + "</h2>",
      "</div>",
      '<div class="module-panel-actions">',
      '<span class="module-hint">' + ui.escapeHtml(module.hint) + "</span>",
      '<button class="module-window-control" type="button" data-module-close="' + ui.escapeHtml(module.id) + '" aria-label="最小化' + ui.escapeHtml(module.label || module.title) + '面板" title="最小化">&#8722;</button>',
      '<button class="module-window-control" type="button" data-module-close="' + ui.escapeHtml(module.id) + '" aria-label="隐藏' + ui.escapeHtml(module.label || module.title) + '面板" title="隐藏">&#9633;</button>',
      '<button class="module-close-control" type="button" data-module-close="' + ui.escapeHtml(module.id) + '" aria-label="关闭' + ui.escapeHtml(module.label || module.title) + '面板" title="关闭面板">×</button>',
      "</div>",
      "</header>"
    ].join("");
  }

  function getSafeProviderKey(item, provider) {
    return ui.getPath(item, ["maskedKey", "keyPreview"], ui.getPath(provider, ["maskedKey", "keyPreview"], "未检测到密钥"));
  }

  function normalizeProviderText(value) {
    return String(value || "").trim();
  }

  function sameProviderOption(item, provider, endpoint, currentName) {
    var itemId = normalizeProviderText(ui.getPath(item, ["providerId", "id", "provider_id"], ""));
    var providerId = normalizeProviderText(ui.getPath(provider, ["providerId", "id", "provider_id"], ""));
    if (itemId && providerId && itemId === providerId) return true;
    var itemUrl = normalizeProviderText(ui.getPath(item, ["baseUrl", "endpoint", "url"], ""));
    var providerUrl = normalizeProviderText(ui.getPath(provider, ["baseUrl", "endpoint", "url"], endpoint));
    if (itemUrl && providerUrl && itemUrl === providerUrl) return true;
    var itemName = normalizeProviderText(ui.getPath(item, ["name", "label", "title"], ""));
    return Boolean(itemName && currentName && itemName === currentName);
  }

  function isCurrentProviderOption(item, provider, endpoint, currentName, index) {
    var explicit = ui.getPath(item, ["active", "current", "selected", "isCurrent"], null);
    if (explicit !== null && explicit !== undefined && explicit !== "") return Boolean(explicit);
    return sameProviderOption(item, provider, endpoint, currentName) || index === 0;
  }

  function resolveProviderOptions(snapshot) {
    var provider = getProvider(snapshot);
    var sources = ui.getPath(snapshot, ["providers", "providerOptions", "relays"], []);
    var endpoint = getEndpoint(snapshot);
    var currentName = getAutomaticRelayName(snapshot);
    var list = Array.isArray(sources) ? sources.slice(0, 8) : [];
    if (!list.length) {
      list = [{
        name: currentName,
        baseUrl: endpoint,
        maskedKey: ui.getPath(provider, ["maskedKey", "keyPreview"], "未检测到密钥"),
        status: "使用中",
        active: true
      }];
    }
    return list.map(function (item, index) {
      var name = ui.getPath(item, ["name", "label", "title"], index === 0 ? currentName : "备用 API " + (index + 1));
      var baseUrl = ui.getPath(item, ["baseUrl", "endpoint", "url"], index === 0 ? endpoint : "未配置地址");
      var maskedKey = getSafeProviderKey(item, provider);
      var active = isCurrentProviderOption(item, provider, endpoint, currentName, index);
      var status = ui.getPath(item, ["status", "state"], active ? "使用中" : "可切换");
      return { active: active, baseUrl: baseUrl, maskedKey: maskedKey, name: name, status: status };
    });
  }

  function renderApiModule(snapshot) {
    var options = resolveProviderOptions(snapshot);
    return [
      '<div class="api-switch-list">',
      options.map(function (item) {
        return [
          '<div class="api-option' + (item.active ? " is-current" : "") + '">',
          '<span class="api-option-dot" aria-hidden="true"></span>',
          '<div>',
          '<strong title="' + ui.escapeHtml(item.name) + '">' + ui.escapeHtml(item.name) + "</strong>",
          '<span title="' + ui.escapeHtml(item.baseUrl + " · " + item.maskedKey) + '">' + ui.escapeHtml(item.baseUrl) + " · " + ui.escapeHtml(item.maskedKey) + "</span>",
          "</div>",
          '<b>' + ui.escapeHtml(item.active ? "使用中" : item.status) + "</b>",
          "</div>"
        ].join("");
      }).join(""),
      "</div>"
    ].join("");
  }

  function renderRequestRows(requests) {
    if (!requests.length) return '<div class="empty-state compact">暂无最近请求</div>';
    var rows = requests.slice(0, 7).map(function (request, index) {
      var id = ui.getPath(request, ["id", "requestId"], "request-" + index);
      var time = ui.formatDateTime(ui.getPath(request, ["time", "createdAt", "timestamp"], null));
      var model = getRequestModel(request, "未知模型");
      var cost = ui.getPath(request, ["cost", "price", "amount", "totalCostUsd"], 0);
      var status = ui.getPath(request, ["status", "state"], "成功");
      var latency = ui.toNumber(ui.getPath(request, ["latency", "durationMs", "latencyMs"], 0), 0);
      return [
        '<button class="request-row" type="button" data-request-id="' + ui.escapeHtml(id) + '">',
        '<span class="request-cell">' + ui.escapeHtml(time) + "</span>",
        '<span class="request-cell" title="' + ui.escapeHtml(model) + '">' + ui.escapeHtml(model) + "</span>",
        '<span class="request-cell">' + ui.escapeHtml(ui.formatCompactNumber(requestTokens(request))) + "</span>",
        '<span class="request-cell">' + ui.escapeHtml(ui.formatDurationMs(latency)) + "</span>",
        '<span class="request-cell"><span class="request-status' + requestStatusClass(request) + '">' + ui.escapeHtml(status) + "</span></span>",
        '<span class="request-cell">' + ui.escapeHtml(ui.formatCurrency(cost)) + "</span>",
        "</button>"
      ].join("");
    }).join("");
    return [
      '<div class="request-row request-head" aria-hidden="true">',
      '<span class="request-cell">时间</span><span class="request-cell">模型</span><span class="request-cell">Token</span><span class="request-cell">耗时</span><span class="request-cell">状态</span><span class="request-cell">费用</span>',
      "</div>",
      rows
    ].join("");
  }

  function renderMetricCard(label, value, note, tone) {
    var className = ["dashboard-metric", tone ? "is-" + tone : ""].filter(Boolean).join(" ");
    return [
      '<article class="' + className + '">',
      '<span>' + ui.escapeHtml(label) + "</span>",
      '<strong title="' + ui.escapeHtml(value) + '">' + ui.escapeHtml(value) + "</strong>",
      '<em title="' + ui.escapeHtml(note || "") + '">' + ui.escapeHtml(note || "") + "</em>",
      "</article>"
    ].join("");
  }

  function renderRequestsModule(snapshot, requests) {
    var latest = getLatestRequest(snapshot) || (requests.length ? requests[0] : null);
    var model = latest ? getRequestModel(latest, getModel(snapshot)) : getModel(snapshot);
    var reasoning = latest ? ui.getPath(latest, ["requestReasoningEffort", "reasoningEffort", "reasoning.effort"], getReasoningEffort(snapshot)) : getReasoningEffort(snapshot);
    var latency = latest ? ui.toNumber(ui.getPath(latest, ["latency", "durationMs", "latencyMs"], getAverageLatency(snapshot)), getAverageLatency(snapshot)) : getAverageLatency(snapshot);
    var cost = latest ? ui.getPath(latest, ["cost", "price", "amount", "totalCostUsd"], 0) : ui.getPath(snapshot, ["spend.today"], 0);
    return [
      '<div class="request-popover-card">',
      '<strong title="' + ui.escapeHtml(model) + '">' + ui.escapeHtml(model) + "</strong>",
      '<span>推理 ' + ui.escapeHtml(reasoning) + " · " + ui.escapeHtml(ui.formatDurationMs(latency)) + " · " + ui.escapeHtml(ui.formatCurrency(cost)) + "</span>",
      "</div>",
      '<div class="module-request-list">' + renderRequestRows(requests) + "</div>"
    ].join("");
  }

  function renderRing(label, value, tone) {
    var percent = ui.clamp(ui.toNumber(value, 0), 0, 100);
    return [
      '<div class="module-ring-card ' + (tone ? "is-" + tone : "") + '">',
      '<div class="module-ring" style="--value:' + percent + '%">',
      '<strong>' + ui.escapeHtml(ui.formatPercent(percent)) + "</strong>",
      '<span>' + ui.escapeHtml(label) + "</span>",
      "</div>",
      "</div>"
    ].join("");
  }

  function renderTokensModule(tokens, trendPoints, cacheHit, contextUsage) {
    return [
      '<div class="token-detail-layout">',
      '<div class="token-chart-column">',
      '<div class="module-trend-frame">' + trend.buildTrendSvg(trendPoints, { height: 142, label: "七天 Token 趋势" }) + "</div>",
      '<div class="token-axis">' + trend.normalizeSeries(trendPoints).map(function (point) {
        return '<span>' + ui.escapeHtml(String(point.label).slice(0, 4)) + "</span>";
      }).join("") + "</div>",
      "</div>",
      '<div class="token-rings">',
      renderRing("CACHE", cacheHit, ""),
      renderRing("CTX", contextUsage, "warm"),
      "</div>",
      "</div>",
      '<div class="token-pills">',
      renderMetricCard("今日", ui.formatCompactNumber(tokens.daily), "今日 Token", ""),
      renderMetricCard("本周", ui.formatCompactNumber(tokens.weekly), "七天合计", ""),
      renderMetricCard("本月", ui.formatCompactNumber(tokens.monthly), "本月累计", ""),
      "</div>"
    ].join("");
  }

  function renderBalanceModule(snapshot, spend, totalSpend) {
    var diagnostics = getBalanceDiagnostics(snapshot);
    var spendSource = getSpendSourceLabel(snapshot);
    return [
      '<div class="module-stat-grid balance-grid">',
      renderMetricCard("账户余额", formatBalance(snapshot), getBalanceNote(snapshot), ""),
      renderMetricCard("总消费额度", ui.formatCurrency(totalSpend), spendSource, "warm"),
      renderMetricCard("今日消费", ui.formatCurrency(spend.today), spendSource, ""),
      renderMetricCard("本周消费", ui.formatCurrency(spend.week), spendSource, ""),
      renderMetricCard("本月消费", ui.formatCurrency(spend.month), spendSource, ""),
      "</div>",
      diagnostics.length ? [
        '<div class="info-list balance-diagnostics" aria-label="余额读取诊断">',
        diagnostics.map(function (row) {
          return infoRow(row.label, row.value, row.note);
        }).join(""),
        "</div>"
      ].join("") : ""
    ].join("");
  }

  function renderCacheModule(snapshot, settings, cacheHit, contextUsage) {
    var contextTokens = getContextTokens(snapshot);
    return [
      '<div class="module-ring-grid">',
      renderRing("CACHE", cacheHit, ""),
      renderRing("CTX", contextUsage, "warm"),
      "</div>",
      '<div class="info-list">',
      infoRow("缓存命中率", ui.formatPercent(cacheHit), "目标 " + ui.formatPercent(settings.cacheHitTarget)),
      infoRow("上下文已用", ui.formatCompactNumber(contextTokens.used), "当前窗口消耗"),
      infoRow("上下文窗口", ui.formatCompactNumber(contextTokens.windowTokens), "模型上下文上限"),
      infoRow("剩余额度", ui.formatCompactNumber(contextTokens.remaining), "可继续承载的上下文"),
      "</div>"
    ].join("");
  }

  function renderSettingsModule() {
    return [
      '<section class="settings-entry">',
      "<h3>设置入口</h3>",
      "<p>调整外观、缓存提醒、上下文阈值、关闭按钮行为和中转站显示名称。</p>",
      '<button class="text-button" type="button" data-open-settings-panel="true">打开完整设置</button>',
      "</section>",
      '<div class="info-list">',
      infoRow("外观", "主题 / 透明度 / 毛玻璃", "影响窗口呈现"),
      infoRow("提醒", "缓存命中率 / 上下文阈值", "影响模块告警颜色"),
      infoRow("窗口", "关闭到后台 / 直接退出", "影响 X 按钮行为"),
      "</div>"
    ].join("");
  }

  function getPanelPosition(id, view) {
    var defaults = defaultPanelLayout[id] || { left: 0, top: 0, z: 10 };
    var positions = view.modulePositions || {};
    var zMap = view.moduleZ || {};
    var position = positions[id] || {};
    return {
      left: ui.toNumber(position.left, defaults.left),
      top: ui.toNumber(position.top, defaults.top),
      z: ui.toNumber(zMap[id], ui.toNumber(position.zIndex, defaults.z))
    };
  }

  function renderModuleShell(id, body, view) {
    var module = getModule(id);
    var position = getPanelPosition(id, view);
    var className = ["module-panel", "glass-panel"];
    if (id === "api") className.push("api-module-panel");
    if (id === "requests") className.push("request-mini-panel");
    if (id === "tokens") className.push("token-module-panel");
    return [
      '<article class="' + className.join(" ") + '" data-module-panel="' + ui.escapeHtml(id) + '" data-drag-panel="' + ui.escapeHtml(id) + '" data-panel-id="' + ui.escapeHtml(id) + '" style="position:absolute;left:' + position.left + 'px;top:' + position.top + 'px;z-index:' + position.z + ';">',
      renderModuleHeader(module),
      body,
      "</article>"
    ].join("");
  }

  function renderModulePanel(id, snapshot, settings, view, tokens, spend, requests, trendPoints, cacheHit, contextUsage, totalSpend) {
    var body = "";
    if (id === "api") body = renderApiModule(snapshot);
    if (id === "requests") body = renderRequestsModule(snapshot, requests);
    if (id === "tokens") body = renderTokensModule(tokens, trendPoints, cacheHit, contextUsage);
    if (id === "balance") body = renderBalanceModule(snapshot, spend, totalSpend);
    if (id === "cache") body = renderCacheModule(snapshot, settings, cacheHit, contextUsage);
    if (id === "settings") body = renderSettingsModule();
    return body ? renderModuleShell(id, body, view) : "";
  }

  function renderActiveModules(snapshot, settings, view, tokens, spend, requests, trendPoints, cacheHit, contextUsage, totalSpend) {
    if (view.externalModules) return "";
    var activeIds = getActiveModuleIds(view.activeModules);
    if (!activeIds.length) return "";
    return [
      '<aside class="module-floating-layer module-dashboard-grid" aria-label="已打开的浮动详情面板">',
      activeIds.map(function (id) {
        return renderModulePanel(id, snapshot, settings, view, tokens, spend, requests, trendPoints, cacheHit, contextUsage, totalSpend);
      }).join(""),
      "</aside>"
    ].join("");
  }

  function renderOverview(snapshot, settings, options) {
    var view = options || {};
    var tokens = summarizeTokens(snapshot);
    var spend = getSpend(snapshot);
    var requests = resolveRequests(snapshot);
    var trendPoints = getTrend(snapshot);
    var endpoint = getEndpoint(snapshot);
    var cacheHit = getCacheHit(snapshot);
    var contextUsage = getContextUsage(snapshot);
    var totalSpend = getTotalSpend(snapshot, spend);
    var hasModules = !view.externalModules && getActiveModuleIds(view.activeModules).length > 0;
    var relayName = getRelayName(snapshot, settings);
    var secret = getSecret(snapshot, view.secretsVisible);
    var balanceValue = formatBalance(snapshot);
    var balanceNote = getBalanceNote(snapshot);
    var spendSource = getSpendSourceLabel(snapshot);

    return [
      '<section class="overview single-dashboard-overview">',
      '<div class="dashboard-board' + (hasModules ? " has-modules" : "") + '">',
      '<article class="primary-dashboard glass-panel">',
      '<section class="dashboard-balance-card">',
      '<div class="dashboard-balance-grid">',
      '<div><span class="dashboard-label">账户余额</span><strong class="dashboard-balance-value">' + ui.escapeHtml(balanceValue) + '</strong><span class="dashboard-ok">' + ui.escapeHtml(balanceNote) + '</span></div>',
      '<div><span class="dashboard-label">总消费额度</span><strong class="dashboard-spend-value">' + ui.escapeHtml(ui.formatCurrency(totalSpend)) + '</strong><span class="dashboard-note">' + ui.escapeHtml(spendSource) + ' · 平均耗时 ' + ui.escapeHtml(ui.formatDurationMs(getAverageLatency(snapshot))) + '</span></div>',
      "</div>",
      '<div class="dashboard-provider-lines">',
      '<span title="' + ui.escapeHtml(relayName) + '">中转站 ' + ui.escapeHtml(relayName) + "</span>",
      '<span title="' + ui.escapeHtml(endpoint) + '">地址 ' + ui.escapeHtml(endpoint) + "</span>",
      '<span data-secret-panel="provider" title="' + ui.escapeHtml(secret) + '">密钥 ' + ui.escapeHtml(secret) + ' <button class="secret-eye" type="button" data-toggle-secrets="true" aria-label="显示或隐藏密钥">◉</button></span>',
      "</div>",
      '<div class="dashboard-inline-actions">',
      shouldShowBalanceLoginAction(snapshot) ? '<button class="mini-action-button" type="button" data-open-balance-login="true" title="登录余额" aria-label="登录余额">↪</button>' : "",
      '<button class="mini-action-button" type="button" data-refresh-balance="true" title="刷新余额" aria-label="刷新余额">↻</button>',
      '<button class="mini-action-button" type="button" data-open-settings-panel="true" title="设置" aria-label="设置">⚙</button>',
      "</div>",
      "</section>",
      renderModelSummary(snapshot, requests, tokens),
      '<section class="dashboard-trend-card">',
      '<div class="dashboard-section-head"><div><h2>消耗趋势</h2><p>七天 Token 曲线</p></div><span>合计 ' + ui.escapeHtml(ui.formatCompactNumber(tokens.weekly)) + '</span></div>',
      '<div class="dashboard-trend-frame">' + trend.buildTrendSvg(trendPoints, { height: 112, label: "主仪表盘 Token 趋势" }) + "</div>",
      "</section>",
      renderDock(view.activeModules),
      "</article>",
      renderActiveModules(snapshot, settings, view, tokens, spend, requests, trendPoints, cacheHit, contextUsage, totalSpend),
      "</div>",
      "</section>"
    ].join("");
  }

  function renderSingleModule(id, snapshot, settings, options) {
    var view = options || {};
    var tokens = summarizeTokens(snapshot);
    var spend = getSpend(snapshot);
    var requests = resolveRequests(snapshot);
    var trendPoints = getTrend(snapshot);
    var cacheHit = getCacheHit(snapshot);
    var contextUsage = getContextUsage(snapshot);
    var totalSpend = getTotalSpend(snapshot, spend);
    return renderModulePanel(id, snapshot, settings, view, tokens, spend, requests, trendPoints, cacheHit, contextUsage, totalSpend);
  }

  window.RelayMonitorOverview = {
    getCacheHit: getCacheHit,
    getContextUsage: getContextUsage,
    getRelayName: getRelayName,
    getTrend: getTrend,
    render: renderOverview,
    renderModule: renderSingleModule,
    resolveRequests: resolveRequests,
    summarizeTokens: summarizeTokens
  };
})();
