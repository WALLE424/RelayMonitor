(function () {
  "use strict";

  var ui = window.RelayMonitorUI;

  function renderRange(id, title, note, value, min, max, step, suffix) {
    return [
      '<div class="setting-row">',
      '<div><div class="setting-title">' + ui.escapeHtml(title) + '</div><div class="setting-note">' + ui.escapeHtml(note) + "</div></div>",
      '<span class="range-value" data-range-value="' + ui.escapeHtml(id) + '">' + ui.escapeHtml(value + suffix) + "</span>",
      "</div>",
      '<div class="range-row">',
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" data-setting="' + ui.escapeHtml(id) + '" />',
      '<span class="range-value">' + ui.escapeHtml(suffix) + "</span>",
      "</div>"
    ].join("");
  }

  function renderToggle(id, title, note, checked) {
    return [
      '<div class="setting-row">',
      '<div><div class="setting-title">' + ui.escapeHtml(title) + '</div><div class="setting-note">' + ui.escapeHtml(note) + "</div></div>",
      '<label class="toggle" title="' + ui.escapeHtml(title) + '">',
      '<input type="checkbox" data-setting="' + ui.escapeHtml(id) + '"' + (checked ? " checked" : "") + " />",
      "<span></span>",
      "</label>",
      "</div>"
    ].join("");
  }

  function renderTextInput(id, title, note, value, placeholder, type) {
    return [
      '<label class="setting-field-row">',
      '<span><strong>' + ui.escapeHtml(title) + '</strong><em>' + ui.escapeHtml(note) + "</em></span>",
      '<input type="' + ui.escapeHtml(type || "text") + '" value="' + ui.escapeHtml(value || "") + '" placeholder="' + ui.escapeHtml(placeholder || "") + '" data-setting="' + ui.escapeHtml(id) + '" />',
      "</label>"
    ].join("");
  }

  function normalizeTheme(value) {
    return value === "dark" ? "dark" : "light";
  }

  function normalizeCloseBehavior(value) {
    return value === "quit" ? "quit" : "hide-to-tray";
  }

  function renderThemePicker(value) {
    var theme = normalizeTheme(value);
    return [
      '<div class="setting-row">',
      '<div><div class="setting-title">主题配色</div><div class="setting-note">切换白色毛玻璃或全黑仪表盘主题</div></div>',
      '<div class="segmented-control" role="radiogroup" aria-label="主题配色">',
      '<label class="segmented-option">',
      '<input type="radio" name="appearanceTheme" value="light" data-setting="appearanceTheme"' + (theme === "light" ? " checked" : "") + " />",
      "<span>白色</span>",
      "</label>",
      '<label class="segmented-option">',
      '<input type="radio" name="appearanceTheme" value="dark" data-setting="appearanceTheme"' + (theme === "dark" ? " checked" : "") + " />",
      "<span>黑色</span>",
      "</label>",
      "</div>",
      "</div>"
    ].join("");
  }

  function renderCloseBehaviorPicker(value) {
    var behavior = normalizeCloseBehavior(value);
    return [
      '<div class="setting-row close-behavior-row">',
      '<div><div class="setting-title">关闭按钮行为</div><div class="setting-note">决定点击主窗口 X 后后台运行还是直接退出</div></div>',
      '<div class="segmented-control" role="radiogroup" aria-label="关闭按钮行为">',
      '<label class="segmented-option">',
      '<input type="radio" name="closeButtonBehavior" value="hide-to-tray" data-setting="closeButtonBehavior"' + (behavior === "hide-to-tray" ? " checked" : "") + " />",
      "<span>关闭到后台</span>",
      "</label>",
      '<label class="segmented-option">',
      '<input type="radio" name="closeButtonBehavior" value="quit" data-setting="closeButtonBehavior"' + (behavior === "quit" ? " checked" : "") + " />",
      "<span>直接退出</span>",
      "</label>",
      "</div>",
      "</div>"
    ].join("");
  }

  function normalizeBalanceMode(value) {
    return value === "web-session" || value === "manual" ? value : "auto-api";
  }

  function normalizeBalanceLoginStatus(status) {
    if (!status || typeof status !== "object" || Array.isArray(status)) {
      return { status: "unknown", hasCookies: false, hasAuthToken: false, hasLoginState: false, origin: "", updatedAt: "", message: "" };
    }
    return {
      status: String(status.status || "").toLowerCase().slice(0, 48),
      hasCookies: Boolean(status.hasCookies),
      hasAuthToken: Boolean(status.hasAuthToken),
      hasLoginState: Boolean(status.hasLoginState || status.hasCookies || status.hasAuthToken),
      origin: String(status.origin || "").trim().slice(0, 220),
      updatedAt: String(status.updatedAt || "").trim().slice(0, 80),
      message: String(status.message || "").trim().slice(0, 160)
    };
  }

  function getBalanceLoginLabel(status) {
    var normalized = normalizeBalanceLoginStatus(status);
    if (normalized.hasLoginState || normalized.hasCookies || normalized.hasAuthToken || normalized.status === "ready" || normalized.status === "logged-in" || normalized.status === "authenticated" || normalized.status === "saved") {
      return "已保存登录态";
    }
    if (normalized.status === "expired" || normalized.status === "auth-required" || normalized.status === "login-required" || normalized.status === "invalid") {
      return "需要重新登录";
    }
    return "未登录";
  }

  function renderBalanceLoginStatus(status, busy) {
    var normalized = normalizeBalanceLoginStatus(status);
    var label = getBalanceLoginLabel(normalized);
    var details = [];
    if (normalized.origin) details.push(normalized.origin);
    if (normalized.updatedAt) details.push("更新于 " + normalized.updatedAt);
    if (normalized.message) details.push(normalized.message);
    return [
      '<div class="balance-login-card" data-balance-login-status="' + ui.escapeHtml(normalized.status || "unknown") + '">',
      '<div class="balance-login-copy">',
      '<span class="balance-login-label">' + ui.escapeHtml(label) + "</span>",
      '<small>' + ui.escapeHtml(details.join(" · ") || "未检测到网页登录状态") + "</small>",
      "</div>",
      '<div class="balance-login-actions">',
      '<button class="text-button compact" type="button" data-open-balance-login="true"' + (busy ? " disabled" : "") + ">" + ui.escapeHtml(busy ? "正在登录" : label === "已保存登录态" ? "重新登录余额页面" : "登录余额页面") + "</button>",
      '<button class="text-button compact" type="button" data-open-balance-external="true">用浏览器打开</button>',
      "</div>",
      "</div>"
    ].join("");
  }

  function renderBalanceDiagnostic(diagnostic, busy) {
    var normalized = diagnostic && typeof diagnostic === "object" ? diagnostic : {};
    var rows = [];
    function compactUrl(value) {
      var raw = String(value || "").trim();
      if (!raw) return "";
      try {
        var parsed = new URL(raw);
        return parsed.hostname + parsed.pathname;
      } catch (_) {
        return raw.split("?")[0].slice(0, 140);
      }
    }
    function row(label, value) {
      if (value === null || value === undefined || value === "") return;
      rows.push('<span><b>' + ui.escapeHtml(label) + '</b>' + ui.escapeHtml(String(value)) + "</span>");
    }
    row("模式", normalized.mode);
    row("中转站", normalized.providerName);
    row("状态", normalized.balanceStatus);
    if (normalized.amount != null) row("余额", ui.formatCurrency(normalized.amount));
    row("登录态", normalized.hasLoginState ? "已检测到" : "未检测到");
    row("Cookie", normalized.hasCookies ? "有" : "无");
    row("网页 Token", normalized.hasAuthToken ? "有" : "无");
    row("用户标识", normalized.hasAuthUserId ? "有" : "无");
    row("HTTP", normalized.httpStatus);
    row("字段", normalized.sourceField);
    row("Token 额度", normalized.quotaStatus === "unlimited" ? "不限额（不是账户余额）" : normalized.quotaStatus);
    row("额度接口", compactUrl(normalized.quotaEndpoint));
    row("额度字段", normalized.quotaSourceField);
    row("目标", normalized.targetHost);
    row("建议页面", normalized.suggestedBalancePageHost);
    row("实际登录页", normalized.effectiveLoginHost);
    row("问题类型", normalized.failureKind);
    row("更新时间", normalized.updatedAt);
    row("下一步", normalized.nextStep);
    row("建议", normalized.advice);
    var suggestedUrl = String(normalized.suggestedBalancePageUrl || "").trim();
    var canUseSuggested = suggestedUrl && normalized.balanceStatus === "provider-mismatch";
    return [
      '<div class="balance-login-card" data-balance-diagnostic="' + ui.escapeHtml(normalized.balanceStatus || "unknown") + '">',
      '<div class="balance-login-copy">',
      '<span class="balance-login-label">余额诊断</span>',
      rows.length ? '<div class="balance-diagnostic-grid">' + rows.join("") + "</div>" : '<small>点击按钮执行余额诊断</small>',
      "</div>",
      canUseSuggested ? '<button class="text-button compact" type="button" data-use-suggested-balance-page="' + ui.escapeHtml(suggestedUrl) + '">使用当前中转站地址并登录</button>' : "",
      '<button class="text-button compact" type="button" data-diagnose-balance="true"' + (busy ? " disabled" : "") + ">" + ui.escapeHtml(busy ? "诊断中" : "诊断余额") + "</button>",
      "</div>"
    ].join("");
  }

  function renderBalanceModePicker(value) {
    var mode = normalizeBalanceMode(value);
    return [
      '<div class="setting-row balance-mode-row">',
      '<div><div class="setting-title">余额获取方式</div><div class="setting-note">只影响后台读取，不放到主仪表盘配置区</div></div>',
      '<div class="segmented-control is-three" role="radiogroup" aria-label="余额获取方式">',
      '<label class="segmented-option">',
      '<input type="radio" name="balanceAcquisitionMode" value="auto-api" data-setting="balanceAcquisitionMode"' + (mode === "auto-api" ? " checked" : "") + " />",
      "<span>自动接口</span>",
      "</label>",
      '<label class="segmented-option">',
      '<input type="radio" name="balanceAcquisitionMode" value="web-session" data-setting="balanceAcquisitionMode"' + (mode === "web-session" ? " checked" : "") + " />",
      "<span>网页登录</span>",
      "</label>",
      '<label class="segmented-option">',
      '<input type="radio" name="balanceAcquisitionMode" value="manual" data-setting="balanceAcquisitionMode"' + (mode === "manual" ? " checked" : "") + " />",
      "<span>手动估算</span>",
      "</label>",
      "</div>",
      "</div>"
    ].join("");
  }

  function renderCompanionToggle(value) {
    var checked = value !== false;
    return [
      '<div class="setting-row">',
      '<div><div class="setting-title">Codex 伴随悬浮条</div><div class="setting-note">显示右上角那条跟随 Codex 的小浮窗</div></div>',
      '<label class="toggle" title="Codex 伴随悬浮条">',
      '<input type="checkbox" data-setting="companionVisible"' + (checked ? " checked" : "") + " />",
      "<span></span>",
      "</label>",
      "</div>"
    ].join("");
  }

  function renderSettings(settings, options) {
    var viewOptions = options && typeof options === "object" ? options : {};
    var rawPanelOpacity = ui.toNumber(settings.panelOpacity == null ? settings.glassOpacity : settings.panelOpacity, 0.8);
    var panelOpacity = ui.clamp(rawPanelOpacity > 1 ? rawPanelOpacity / 100 : rawPanelOpacity, 0.35, 0.92);
    var glassBlur = ui.toNumber(settings.glassBlur, 24);
    var rawWindowOpacity = ui.toNumber(settings.windowOpacity, 1);
    var windowOpacity = ui.clamp(rawWindowOpacity > 1 ? rawWindowOpacity / 100 : rawWindowOpacity, 0.65, 1);
    var cacheTarget = ui.toNumber(settings.cacheHitTarget, 60);
    var contextThreshold = ui.toNumber(settings.contextWarningThreshold, 78);
    var balanceMode = normalizeBalanceMode(settings.balanceAcquisitionMode);

    return [
      '<div class="overlay-backdrop" data-close-settings="true"></div>',
      '<article class="settings-panel glass-panel" role="dialog" aria-modal="true" aria-label="设置">',
      '<header class="drawer-header">',
      '<div class="drawer-title"><h2>设置</h2><p>外观、提醒、余额和窗口行为</p></div>',
      '<button class="icon-button" type="button" data-close-settings="true" title="关闭" aria-label="关闭">×</button>',
      "</header>",
      '<div class="settings-body">',
      '<section class="setting-group glass-panel">',
      '<div class="panel-header"><div><h3>毛玻璃外观</h3><p>Windows Acrylic / Mica 风格</p></div></div>',
      renderThemePicker(settings.appearanceTheme),
      renderRange("windowOpacity", "窗口透明度", "控制整个窗口的不透明度", Math.round(windowOpacity * 100), 65, 100, 1, "%"),
      renderRange("panelOpacity", "卡片透明度", "控制卡片底色不透明度", Math.round(panelOpacity * 100), 35, 92, 1, "%"),
      renderRange("glassBlur", "毛玻璃模糊", "控制背景模糊强度", glassBlur, 8, 36, 1, "px"),
      renderToggle("systemGlass", "系统毛玻璃", "启用更接近 Mica 的底色", Boolean(settings.systemGlass)),
      '<button class="text-button compact" type="button" data-reset-appearance="true">恢复默认</button>',
      "</section>",
      '<section class="setting-group glass-panel">',
      '<div class="panel-header"><div><h3>窗口</h3><p>关闭策略与后台运行</p></div></div>',
      renderCloseBehaviorPicker(settings.closeButtonBehavior),
      '<p class="setting-footnote">默认关闭到后台，避免误关后中断监控；选择直接退出时，主窗口 X 会结束程序。</p>',
      "</section>",
      '<section class="setting-group glass-panel">',
      '<div class="panel-header"><div><h3>伴随悬浮条</h3><p>Codex 桌面端上方的小状态条</p></div></div>',
      renderCompanionToggle(settings.companionVisible),
      '<p class="setting-footnote">关闭后只隐藏悬浮条，不影响主仪表盘与后台监控；重新打开后会恢复跟随与点击展开功能。</p>',
      "</section>",
      '<section class="setting-group glass-panel">',
      '<div class="panel-header"><div><h3>提醒</h3><p>缓存命中率与上下文消耗</p></div></div>',
      renderToggle("cacheHitAlert", "缓存命中提醒", "低于目标时显示暖色提醒", settings.cacheHitAlert !== false),
      renderRange("cacheHitTarget", "命中率目标", "用于总览与详情高亮", cacheTarget, 20, 95, 1, "%"),
      renderToggle("contextWarning", "上下文提醒", "超过阈值时显示风险色", settings.contextWarning !== false),
      renderRange("contextWarningThreshold", "上下文阈值", "接近窗口上限前提醒", contextThreshold, 50, 98, 1, "%"),
      "</section>",
      '<section class="setting-group glass-panel">',
      '<div class="panel-header"><div><h3>余额读取</h3><p>后台获取方式，不占用主显示界面</p></div></div>',
      renderBalanceModePicker(balanceMode),
      balanceMode === "web-session" ? renderBalanceLoginStatus(viewOptions.balanceLoginStatus, Boolean(viewOptions.balanceLoginBusy)) : "",
      balanceMode === "web-session" ? renderBalanceDiagnostic(viewOptions.balanceDiagnostic, Boolean(viewOptions.balanceDiagnosticBusy)) : "",
      balanceMode === "web-session" ? renderTextInput("balancePageUrl", "余额页面地址", "登录后能看到余额的页面", settings.balancePageUrl, "https://example.com/dashboard/billing", "url") : "",
      balanceMode === "web-session" ? renderTextInput("balanceSelector", "余额提取规则", "可选 CSS 选择器，例如 .balance 或 [data-balance]", settings.balanceSelector, ".balance, [data-balance]", "text") : "",
      balanceMode === "manual" ? renderTextInput("balanceManualAmount", "初始余额", "按 ccswitch 累计消费扣减估算", settings.balanceManualAmount, "100.00", "number") : "",
      '<p class="setting-footnote">自动接口会尝试常见余额接口；网页登录读取使用保存的登录态，不保存密码；手动估算适合没有余额接口的中转站。</p>',
      "</section>",
      "</div>",
      "</article>"
    ].join("");
  }

  function applySettings(settings) {
    var root = document.documentElement;
    var rawOpacity = ui.toNumber(settings.panelOpacity == null ? settings.glassOpacity : settings.panelOpacity, 0.8);
    var opacity = ui.clamp(rawOpacity > 1 ? rawOpacity / 100 : rawOpacity, 0.35, 0.92);
    var rawWindowOpacity = ui.toNumber(settings.windowOpacity, 1);
    var windowOpacity = ui.clamp(rawWindowOpacity > 1 ? rawWindowOpacity / 100 : rawWindowOpacity, 0.65, 1);
    var blur = ui.clamp(ui.toNumber(settings.glassBlur, 24), 8, 36);
    var theme = normalizeTheme(settings.appearanceTheme);
    root.style.setProperty("--window-opacity", String(windowOpacity));
    root.style.setProperty("--card-opacity", String(opacity));
    root.style.setProperty("--card-opacity-soft", String(ui.clamp(opacity - 0.1, 0.35, 0.86)));
    root.style.setProperty("--card-opacity-strong", String(ui.clamp(opacity + 0.12, 0.55, 0.98)));
    root.style.setProperty("--glass-opacity", String(opacity));
    root.style.setProperty("--glass-blur", blur + "px");
    root.setAttribute("data-theme", theme);
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
    document.body.dataset.theme = theme;
    document.body.classList.toggle("system-glass", Boolean(settings.systemGlass));
  }

  window.RelayMonitorSettings = {
    apply: applySettings,
    render: renderSettings
  };
})();
