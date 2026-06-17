(function () {
  "use strict";

  var ui = window.RelayMonitorUI;
  var trend = window.RelayMonitorTrend;
  var overview = window.RelayMonitorOverview;

  function requestModel(request, fallback) {
    return ui.getPath(request, ["requestModel", "request_model", "model", "modelName"], fallback || "");
  }

  function tokenBreakdown(request) {
    var input = ui.toNumber(ui.getPath(request, ["tokens.input", "usage.inputTokens", "inputTokens", "promptTokens"], 0), 0);
    var output = ui.toNumber(ui.getPath(request, ["tokens.output", "usage.outputTokens", "outputTokens", "completionTokens"], 0), 0);
    var cached = ui.toNumber(ui.getPath(request, ["tokens.cached", "usage.cachedTokens", "cacheReadTokens", "cachedTokens"], 0), 0);
    var cacheWrite = ui.toNumber(ui.getPath(request, ["tokens.cacheWrite", "cacheWriteTokens", "cacheCreationTokens"], 0), 0);
    var reasoning = ui.toNumber(ui.getPath(request, ["tokens.reasoning", "reasoningTokens", "usage.reasoningTokens"], 0), 0);
    var total = ui.toNumber(ui.getPath(request, ["tokens.total", "usage.totalTokens", "totalTokens"], input + output + cached + cacheWrite + reasoning), input + output + cached + cacheWrite + reasoning);
    return { cacheWrite: cacheWrite, cached: cached, input: input, output: output, reasoning: reasoning, total: total };
  }

  function modelTrends(snapshot, request) {
    var byModel = ui.getPath(snapshot, ["modelTrends", "trends.models"], null);
    var model = requestModel(request, "");
    if (byModel && model && Array.isArray(byModel[model])) {
      return [{ name: model, points: byModel[model] }];
    }
    if (byModel && typeof byModel === "object") {
      return Object.keys(byModel).slice(0, 4).map(function (name) {
        return { name: name, points: byModel[name] };
      });
    }
    var source = overview.getTrend(snapshot);
    if (!Array.isArray(source)) {
      source = [];
    }
    return [
      { name: model || "当前模型", points: source },
      { name: "缓存命中", points: source.map(function (point) {
        var value = typeof point === "number" ? point : ui.getPath(point, ["cached", "value"], 0);
        return Object.assign({}, point, { value: value });
      }) }
    ];
  }

  function renderModelTrends(snapshot, request) {
    var rows = modelTrends(snapshot, request).map(function (item) {
      return [
        '<div class="model-row">',
        '<span class="request-cell" title="' + ui.escapeHtml(item.name) + '">' + ui.escapeHtml(item.name) + "</span>",
        trend.buildMiniTrendSvg(item.points, item.name + " 七天趋势"),
        "</div>"
      ].join("");
    }).join("");
    return rows || '<div class="empty-state">暂无模型趋势</div>';
  }

  function kv(label, value) {
    return [
      '<div class="kv-card">',
      '<div class="kv-label">' + ui.escapeHtml(label) + "</div>",
      '<div class="kv-value" title="' + ui.escapeHtml(value) + '">' + ui.escapeHtml(value) + "</div>",
      "</div>"
    ].join("");
  }

  function secretValue(snapshot, visible) {
    var provider = ui.getPath(snapshot, ["provider", "currentProvider"], {}) || {};
    var masked = ui.getPath(provider, ["maskedKey", "apiKeyMasked", "keyMasked"], "");
    var preview = ui.getPath(provider, ["keyPreview", "apiKeyPreview"], "");
    return visible && preview ? preview : masked || "未检测到密钥";
  }

  function renderDetail(request, snapshot, settings, options) {
    if (!request) {
      return "";
    }
    var view = options || {};
    var tokens = tokenBreakdown(request);
    var maxToken = Math.max(tokens.input, tokens.output, tokens.cached, tokens.cacheWrite, tokens.reasoning, 1);
    var cacheHit = ui.normalizePercent(ui.getPath(request, ["cache.hitRate", "cacheHitRate"], overview.getCacheHit(snapshot)), 0);
    var contextUsage = ui.normalizePercent(ui.getPath(request, ["context.usage", "contextUsage", "context.percent"], overview.getContextUsage(snapshot)), 0);
    var cacheTone = settings.cacheHitAlert !== false && cacheHit < ui.toNumber(settings.cacheHitTarget, 60) ? "warm" : "";
    var contextTone = settings.contextWarning !== false && contextUsage > ui.toNumber(settings.contextWarningThreshold, 78) ? "danger" : "";
    var title = requestModel(request, "请求详情");
    var time = ui.formatDateTime(ui.getPath(request, ["time", "createdAt", "timestamp"], null));
    var status = ui.getPath(request, ["status", "state"], "成功");
    var reasoningEffort = ui.getPath(request, ["requestReasoningEffort", "reasoningEffort", "reasoning.effort"], "未记录");
    var latency = ui.getPath(request, ["latency", "duration", "durationMs", "latencyMs"], 0);

    return [
      '<div class="overlay-backdrop" data-close-detail="true"></div>',
      '<article class="detail-panel glass-panel" role="dialog" aria-modal="true" aria-label="请求详情">',
      '<header class="drawer-header">',
      '<div class="drawer-title"><h2 title="' + ui.escapeHtml(title) + '">' + ui.escapeHtml(title) + '</h2><p title="' + ui.escapeHtml(time) + '">' + ui.escapeHtml(time) + " · " + ui.escapeHtml(status) + "</p></div>",
      '<button class="icon-button" type="button" data-close-detail="true" title="关闭" aria-label="关闭">×</button>',
      "</header>",
      '<div class="detail-body">',
      '<section class="detail-section glass-panel">',
      '<div class="panel-header"><div><h3>请求概览</h3><p>模型、费用、延迟与中转站</p></div></div>',
      '<div class="detail-grid">',
      kv("模型", title),
      kv("推理强度", reasoningEffort),
      kv("费用", ui.formatCurrency(ui.getPath(request, ["cost", "price", "amount", "totalCostUsd"], 0))),
      kv("平均/本次耗时", ui.formatDurationMs(latency)),
      kv("中转站", ui.getPath(request, ["relay", "provider", "station"], ui.getPath(snapshot, ["currentRelay.name", "currentRelay"], "等待中转站数据"))),
      kv("请求 ID", ui.getPath(request, ["id", "requestId"], "未知")),
      "</div>",
      "</section>",
      '<section class="detail-section glass-panel">',
      '<div class="panel-header"><div><h3>Token 拆分</h3><p>输入、输出、缓存与推理消耗</p></div><span class="muted">' + ui.escapeHtml(ui.formatCompactNumber(tokens.total)) + " 总量</span></div>",
      '<div class="split-bars">',
      ui.splitBar("输入", tokens.input, maxToken),
      ui.splitBar("输出", tokens.output, maxToken),
      ui.splitBar("缓存命中", tokens.cached, maxToken),
      ui.splitBar("缓存写入", tokens.cacheWrite, maxToken),
      ui.splitBar("推理", tokens.reasoning, maxToken),
      "</div>",
      "</section>",
      '<section class="detail-section glass-panel">',
      '<div class="panel-header"><div><h3>缓存与上下文</h3><p>当前请求阈值检查</p></div></div>',
      '<div class="gauge-stack">',
      ui.gauge("缓存命中率", cacheHit, "目标 " + ui.formatPercent(settings.cacheHitTarget), cacheTone),
      ui.gauge("上下文消耗", contextUsage, "提醒线 " + ui.formatPercent(settings.contextWarningThreshold), contextTone),
      "</div>",
      "</section>",
      '<section class="detail-section glass-panel" data-secret-panel="provider">',
      '<div class="panel-header"><div><h3>提供商信息</h3><p>端点与密钥默认隐藏</p></div><button class="text-button compact" type="button" data-toggle-secrets="true">' + (view.secretsVisible ? "隐藏密钥" : "显示密钥") + "</button></div>",
      '<div class="detail-grid">',
      kv("端点", ui.getPath(request, ["endpoint"], ui.getPath(snapshot, ["endpoint", "provider.baseUrl"], "未检测到"))),
      kv("密钥", secretValue(snapshot, view.secretsVisible)),
      "</div>",
      "</section>",
      '<section class="detail-section glass-panel">',
      '<div class="panel-header"><div><h3>七天模型趋势</h3><p>按模型展示折线</p></div></div>',
      '<div class="model-trends">' + renderModelTrends(snapshot, request) + "</div>",
      "</section>",
      "</div>",
      "</article>"
    ].join("");
  }

  window.RelayMonitorRequestDetail = {
    render: renderDetail,
    tokenBreakdown: tokenBreakdown
  };
})();
