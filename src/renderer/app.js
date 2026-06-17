(function () {
  "use strict";

  var ui = window.RelayMonitorUI;
  var overview = window.RelayMonitorOverview;
  var detail = window.RelayMonitorRequestDetail;
  var settingsView = window.RelayMonitorSettings;
  var settingsSaveTimer = 0;
  var pendingSettingsPatch = null;

  var defaultSettings = {
    appearanceTheme: "light",
    cacheHitAlert: true,
    cacheHitTarget: 60,
    contextWarning: true,
    contextWarningThreshold: 78,
    customRelayName: "",
    closeButtonBehavior: "hide-to-tray",
    balanceAcquisitionMode: "auto-api",
    balanceManualAmount: "",
    balancePageUrl: "",
    balanceSelector: "",
    companionVisible: true,
    refreshSeconds: 5,
    glassBlur: 24,
    glassOpacity: 0.8,
    panelOpacity: 0.8,
    windowOpacity: 1,
    systemGlass: false
  };

  var rendererSettingKeys = {
    appearanceTheme: true,
    cacheHitAlert: true,
    cacheHitTarget: true,
    contextWarning: true,
    contextWarningThreshold: true,
    customRelayName: true,
    closeButtonBehavior: true,
    balanceAcquisitionMode: true,
    balanceManualAmount: true,
    balancePageUrl: true,
    balanceSelector: true,
    companionVisible: true,
    glassBlur: true,
    glassOpacity: true,
    panelOpacity: true,
    refreshSeconds: true,
    systemGlass: true,
    windowOpacity: true
  };

  var panelLayoutStorageKey = "relay-monitor:v2-panel-layout";
  var defaultActiveModules = {};
  var moduleOrder = ["api", "requests", "tokens", "balance", "cache", "settings"];
  var defaultPanelPositions = {
    api: { left: 468, top: 70 },
    requests: { left: 488, top: 146 },
    tokens: { left: 468, top: 222 },
    balance: { left: 488, top: 298 },
    cache: { left: 468, top: 374 },
    settings: { left: 488, top: 450 }
  };
  var secretKeys = {
    apiKey: true,
    key: true,
    keyPreview: true,
    apiKeyPreview: true,
    secretKey: true,
    token: true,
    accessToken: true,
    refreshToken: true,
    authorization: true
  };

  var state = {
    api: window.relayMonitor || null,
    snapshot: createUnconfiguredSnapshot(),
    settings: Object.assign({}, defaultSettings),
    secretsVisible: false,
    relayNameEditing: false,
    activeModules: Object.assign({}, defaultActiveModules),
    modulePositions: {},
    moduleZ: {},
    moduleOrder: moduleOrder.slice(),
    nextModuleZ: 10,
    selectedRequestId: null,
    settingsOpen: false,
    balanceLoginStatus: null,
    balanceLoginBusy: false,
    balanceDiagnostic: null,
    balanceDiagnosticBusy: false,
    loading: true,
    snapshotSignature: ""
  };

  var elements = {};
  var dragState = null;
  var snapshotRenderFrame = 0;

  function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function maskSecret(value) {
    var text = String(value || "");
    if (!text) {
      return "";
    }
    var suffix = text.length > 4 ? text.slice(-4) : "";
    return "sk-************" + suffix;
  }

  function sanitizeSnapshot(value, parentKey) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return sanitizeSnapshot(item, parentKey);
      });
    }
    if (!isPlainObject(value)) {
      return value;
    }
    var output = {};
    Object.keys(value).forEach(function (key) {
      var lowerKey = String(key).toLowerCase();
      if (secretKeys[key] || secretKeys[lowerKey]) {
        output[key] = maskSecret(value[key]);
        return;
      }
      if (/apikey|secret|token|authorization/.test(lowerKey) && !/masked|usage|tokens|totaltokens|inputtokens|outputtokens|cachedtokens|reasoningtokens/.test(lowerKey)) {
        output[key] = maskSecret(value[key]);
        return;
      }
      output[key] = sanitizeSnapshot(value[key], key);
    });
    return output;
  }

  function normalizePanelPoint(point) {
    if (!isPlainObject(point)) {
      return null;
    }
    var left = ui.toNumber(point.left, NaN);
    var top = ui.toNumber(point.top, NaN);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return {
      left: Math.round(ui.clamp(left, -1200, 2400)),
      top: Math.round(ui.clamp(top, -800, 1600))
    };
  }

  function normalizeZMap(zMap) {
    var normalized = {};
    var maxZ = state.nextModuleZ;
    if (isPlainObject(zMap)) {
      Object.keys(zMap).forEach(function (id) {
        if (moduleOrder.indexOf(id) === -1) {
          return;
        }
        var z = Math.round(ui.toNumber(zMap[id], 0));
        if (z > 0) {
          normalized[id] = z;
          maxZ = Math.max(maxZ, z + 1);
        }
      });
    }
    state.nextModuleZ = maxZ;
    return normalized;
  }

  function loadPanelLayout() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(panelLayoutStorageKey);
      var parsed = raw ? JSON.parse(raw) : {};
      var positions = {};
      if (isPlainObject(parsed.positions)) {
        Object.keys(parsed.positions).forEach(function (id) {
          var point = normalizePanelPoint(parsed.positions[id]);
          if (point && moduleOrder.indexOf(id) !== -1) {
            positions[id] = point;
          }
        });
      }
      state.modulePositions = positions;
      state.moduleZ = normalizeZMap(parsed.z);
      state.moduleOrder = Array.isArray(parsed.order) ? parsed.order.filter(function (id, index, list) {
        return moduleOrder.indexOf(id) !== -1 && list.indexOf(id) === index;
      }) : moduleOrder.slice();
    } catch (error) {
      state.modulePositions = {};
      state.moduleZ = {};
      state.moduleOrder = moduleOrder.slice();
    }
  }

  function savePanelLayout() {
    try {
      if (!window.localStorage) {
        return;
      }
      window.localStorage.setItem(panelLayoutStorageKey, JSON.stringify({
        positions: state.modulePositions,
        z: state.moduleZ,
        order: state.moduleOrder
      }));
    } catch (error) {
      setStatus("面板位置保存失败：" + error.message);
    }
  }

  function createUnconfiguredSnapshot() {
    return sanitizeSnapshot({
      balance: { status: "unavailable", amount: null, available: false },
      cache: { hitRate: 0 },
      context: { usage: 0, usedPercent: 0, usedTokens: 0, windowTokens: 0, remainingTokens: 0 },
      currentRelay: { name: "等待中转站数据", endpoint: "" },
      endpoint: "",
      provider: {
        name: "",
        baseUrl: "",
        maskedKey: "",
        model: "未检测到",
        reasoningEffort: "未记录"
      },
      recentRequests: [],
      requests: { failed: 0, success: 0 },
      spend: { today: 0, week: 0, month: 0, total: 0 },
      tokens: {
        cached: 0,
        daily: 0,
        input: 0,
        monthly: 0,
        output: 0,
        total: 0,
        weekly: 0
      },
      usage: { avgLatencyMs: 0, monthTokens: 0, todayTokens: 0, weekTokens: 0 },
      trend7d: []
    });
  }

  function snapshotSignature(snapshot) {
    var source = isPlainObject(snapshot) ? snapshot : {};
    var recent = Array.isArray(source.recentRequests) ? source.recentRequests.slice(0, 6) : [];
    var trend = Array.isArray(source.trend7d) ? source.trend7d : Array.isArray(source.trend) ? source.trend : [];
    return JSON.stringify({
      provider: ui.getPath(source, ["provider.providerId", "provider.name", "provider.baseUrl", "currentRelay.name"], ""),
      model: ui.getPath(source, ["model", "currentModel", "provider.model"], ""),
      reasoning: ui.getPath(source, ["reasoningEffort", "provider.reasoningEffort"], ""),
      balance: ui.getPath(source, ["balance.status", "balance.amount", "balance.source"], ""),
      tokens: ui.getPath(source, ["tokens.daily", "tokens.weekly", "tokens.monthly", "usage.todayTokens", "usage.totalTokens"], ""),
      spend: ui.getPath(source, ["spend.today", "spend.week", "spend.month", "spend.total", "spend.source", "spend.status"], ""),
      cache: ui.getPath(source, ["cache.hitRate", "cache.hitTokens", "cache.missTokens"], ""),
      context: ui.getPath(source, ["context.usedPercent", "context.usedTokens", "context.remainingTokens"], ""),
      trend: trend.map(function (point) {
        return [point && point.date, point && point.value, point && point.cost];
      }),
      recent: recent.map(function (request) {
        return [
          request && (request.id || request.requestId),
          request && (request.requestModel || request.model),
          request && request.reasoningEffort,
          request && (request.totalCostUsd || request.cost),
          request && (request.latencyMs || request.latency),
        ];
      })
    });
  }

  function normalizeTheme(value) {
    return value === "dark" || value === "light" ? value : defaultSettings.appearanceTheme;
  }

  function normalizeRatio(value, fallback, min, max) {
    var number = ui.toNumber(value, fallback);
    return ui.clamp(number > 1 ? number / 100 : number, min, max);
  }

  function normalizeSettings(settings) {
    var input = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    var merged = Object.assign({}, defaultSettings);
    Object.keys(input).forEach(function (key) {
      if (rendererSettingKeys[key]) {
        merged[key] = input[key];
      }
    });
    merged.appearanceTheme = normalizeTheme(merged.appearanceTheme);
    merged.windowOpacity = normalizeRatio(merged.windowOpacity, defaultSettings.windowOpacity, 0.65, 1);
    if (Object.prototype.hasOwnProperty.call(input, "glassOpacity") && !Object.prototype.hasOwnProperty.call(input, "panelOpacity")) {
      merged.panelOpacity = input.glassOpacity;
    }
    merged.panelOpacity = normalizeRatio(merged.panelOpacity, defaultSettings.panelOpacity, 0.35, 0.92);
    merged.glassOpacity = merged.panelOpacity;
    merged.glassBlur = ui.clamp(ui.toNumber(merged.glassBlur, defaultSettings.glassBlur), 8, 36);
    merged.cacheHitTarget = ui.clamp(ui.toNumber(merged.cacheHitTarget, defaultSettings.cacheHitTarget), 0, 100);
    merged.contextWarningThreshold = ui.clamp(ui.toNumber(merged.contextWarningThreshold, defaultSettings.contextWarningThreshold), 0, 100);
    merged.refreshSeconds = ui.clamp(ui.toNumber(merged.refreshSeconds, defaultSettings.refreshSeconds || 5), 5, 3600);
    merged.cacheHitAlert = merged.cacheHitAlert !== false;
    merged.contextWarning = merged.contextWarning !== false;
    merged.systemGlass = merged.systemGlass !== false;
    merged.companionVisible = merged.companionVisible !== false;
    merged.customRelayName = normalizeRelayName(merged.customRelayName);
    if (["hide-to-tray", "quit"].indexOf(merged.closeButtonBehavior) === -1) {
      merged.closeButtonBehavior = defaultSettings.closeButtonBehavior;
    }
    if (["auto-api", "web-session", "manual"].indexOf(merged.balanceAcquisitionMode) === -1) {
      merged.balanceAcquisitionMode = defaultSettings.balanceAcquisitionMode;
    }
    merged.balanceManualAmount = String(merged.balanceManualAmount == null ? "" : merged.balanceManualAmount).trim().slice(0, 32);
    merged.balancePageUrl = String(merged.balancePageUrl || "").trim().slice(0, 500);
    merged.balanceSelector = String(merged.balanceSelector || "").trim().slice(0, 240);
    return merged;
  }

  function sanitizeSettingsPatch(patch) {
    var safePatch = {};
    var normalized = normalizeSettings(Object.assign({}, state.settings, patch || {}));
    Object.keys(patch || {}).forEach(function (key) {
      if (rendererSettingKeys[key]) {
        safePatch[key] = normalized[key];
      }
    });
    if (Object.prototype.hasOwnProperty.call(safePatch, "panelOpacity")) {
      safePatch.glassOpacity = safePatch.panelOpacity;
    }
    if (Object.prototype.hasOwnProperty.call(safePatch, "glassOpacity")) {
      safePatch.panelOpacity = safePatch.glassOpacity;
    }
    return safePatch;
  }

  function getRequests() {
    return overview.resolveRequests(state.snapshot);
  }

  function getSelectedRequest() {
    if (!state.selectedRequestId) {
      return null;
    }
    return getRequests().find(function (request, index) {
      var id = ui.getPath(request, ["id", "requestId"], "request-" + index);
      return String(id) === String(state.selectedRequestId);
    }) || null;
  }

  function setStatus(message) {
    if (elements.status) {
      elements.status.textContent = message;
    }
  }

  function getViewOptions() {
    return {
      activeModules: state.activeModules,
      externalModules: true,
      modulePositions: state.modulePositions,
      moduleZ: state.moduleZ,
      moduleOrder: state.moduleOrder,
      secretsVisible: state.secretsVisible,
      relayNameEditing: state.relayNameEditing
    };
  }

  function getPanelId(panel) {
    return panel && panel.getAttribute("data-module-panel");
  }

  function getPanelPosition(id, index) {
    var saved = normalizePanelPoint(state.modulePositions[id]);
    if (saved) {
      return clampPanelPosition(saved, id);
    }
    var fallback = defaultPanelPositions[id] || {
      left: 18 + (index % 3) * 28,
      top: 18 + index * 22
    };
    var viewportWidth = window.innerWidth || 900;
    var mainLeft = 14;
    var rightSide = Math.min(viewportWidth - 360 - 20, mainLeft + 454);
    if (viewportWidth < 760) {
      return clampPanelPosition({
        left: Math.max(12, Math.min(viewportWidth - 280, 24 + (index % 2) * 24)),
        top: 84 + index * 28
      }, id);
    }
    return clampPanelPosition({
      left: Math.max(24, rightSide + (index % 2) * 18),
      top: fallback.top
    }, id);
  }

  function getPanelSize(id) {
    if (id === "requests") {
      return { width: 222, height: 168 };
    }
    if (id === "api") {
      return { width: 360, height: 238 };
    }
    if (id === "tokens") {
      return { width: 360, height: 242 };
    }
    return { width: 360, height: 260 };
  }

  function clampPanelPosition(point, id) {
    var size = getPanelSize(id);
    var maxLeft = Math.max(12, (window.innerWidth || 1120) - size.width - 14);
    var maxTop = Math.max(12, (window.innerHeight || 620) - size.height - 14);
    return {
      left: Math.round(ui.clamp(ui.toNumber(point.left, 468), 12, maxLeft)),
      top: Math.round(ui.clamp(ui.toNumber(point.top, 70), 12, maxTop))
    };
  }

  function setPanelTransform(panel, left, top) {
    panel.style.transform = "translate3d(" + Math.round(left) + "px, " + Math.round(top) + "px, 0)";
  }

  function setPanelPosition(panel, left, top) {
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
    panel.style.transform = "translate3d(0, 0, 0)";
  }

  function bringModuleToFront(id, options) {
    if (!id) {
      return;
    }
    state.moduleZ[id] = state.nextModuleZ++;
    state.moduleOrder = [id].concat(state.moduleOrder.filter(function (moduleId) {
      return moduleId !== id;
    }));
    if (!options || options.save !== false) {
      savePanelLayout();
    }
    var panel = elements.viewRoot && elements.viewRoot.querySelector('[data-module-panel="' + id + '"]');
    if (panel) {
      panel.style.zIndex = String(state.moduleZ[id]);
    }
  }

  function ensureDragHandles(panel) {
    panel.setAttribute("data-drag-panel", panel.getAttribute("data-module-panel"));
    var handle = panel.querySelector("[data-drag-handle]");
    if (!handle) {
      handle = panel.querySelector(".module-panel-head") || panel;
      handle.setAttribute("data-drag-handle", panel.getAttribute("data-module-panel"));
    }
  }

  function applyPanelLayout() {
    var panels = elements.viewRoot ? elements.viewRoot.querySelectorAll("[data-module-panel]") : [];
    Array.prototype.forEach.call(panels, function (panel, index) {
      var id = getPanelId(panel);
      var position = getPanelPosition(id, index);
      state.modulePositions[id] = position;
      ensureDragHandles(panel);
      panel.style.willChange = "transform";
      panel.style.order = String(state.moduleOrder.indexOf(id) === -1 ? index : state.moduleOrder.indexOf(id));
      panel.style.zIndex = String(state.moduleZ[id] || index + 1);
      setPanelPosition(panel, position.left, position.top);
    });
  }

  function render() {
    settingsView.apply(state.settings);
    elements.viewRoot.innerHTML = overview.render(state.snapshot, state.settings, getViewOptions());
    applyPanelLayout();
    renderDetail();
    renderSettings();
    setStatus(state.api ? "已连接渲染端 API" : "等待中转站数据");
  }

  function renderSnapshotViews() {
    snapshotRenderFrame = 0;
    elements.viewRoot.innerHTML = overview.render(state.snapshot, state.settings, getViewOptions());
    applyPanelLayout();
    renderDetail();
  }

  function scheduleSnapshotRender() {
    if (snapshotRenderFrame) {
      return;
    }
    if (typeof window.requestAnimationFrame !== "function") {
      renderSnapshotViews();
      return;
    }
    snapshotRenderFrame = window.requestAnimationFrame(renderSnapshotViews);
  }

  function renderDetail() {
    var selected = getSelectedRequest();
    elements.detailRoot.classList.toggle("is-open", Boolean(selected));
    elements.detailRoot.innerHTML = selected ? detail.render(selected, state.snapshot, state.settings, { secretsVisible: state.secretsVisible }) : "";
  }

  function toggleSecrets() {
    state.secretsVisible = !state.secretsVisible;
    renderSnapshotViews();
  }

  function renderSettings() {
    elements.settingsRoot.classList.toggle("is-open", state.settingsOpen);
    elements.settingsRoot.innerHTML = state.settingsOpen ? settingsView.render(state.settings, {
      balanceLoginStatus: state.balanceLoginStatus,
      balanceLoginBusy: state.balanceLoginBusy,
      balanceDiagnostic: state.balanceDiagnostic,
      balanceDiagnosticBusy: state.balanceDiagnosticBusy
    }) : "";
  }

  function moduleLabel(id) {
    var labels = {
      api: "API 切换",
      requests: "请求",
      tokens: "Token",
      balance: "余额",
      cache: "缓存",
      settings: "设置"
    };
    return labels[id] || id;
  }

  function toggleModule(id) {
    if (!id || moduleOrder.indexOf(id) === -1) {
      return;
    }
    if (state.api && typeof state.api.toggleModuleWindow === "function") {
      setStatus("正在切换 " + moduleLabel(id) + " 独立仪表盘");
      Promise.resolve(state.api.toggleModuleWindow(id))
        .then(function (result) {
          state.activeModules[id] = Boolean(result && result.visible);
          renderSnapshotViews();
          setStatus((state.activeModules[id] ? "已打开 " : "已关闭 ") + moduleLabel(id) + " 独立仪表盘");
        })
        .catch(function (error) {
          setStatus("切换 " + moduleLabel(id) + " 仪表盘失败：" + error.message);
        });
      return;
    }
    state.activeModules[id] = !state.activeModules[id];
    if (state.activeModules[id]) {
      bringModuleToFront(id, { save: false });
    }
    renderSnapshotViews();
    savePanelLayout();
    setStatus((state.activeModules[id] ? "已打开 " : "已关闭 ") + moduleLabel(id) + " 详情仪表板");
  }

  function closeModules() {
    state.activeModules = {};
    if (state.api && typeof state.api.closeModuleWindow === "function") {
      moduleOrder.forEach(function (id) {
        Promise.resolve(state.api.closeModuleWindow(id)).catch(function () {});
      });
    }
    renderSnapshotViews();
  }

  function updateDragFrame() {
    if (!dragState) {
      return;
    }
    dragState.frame = null;
    dragState.left = dragState.startLeft + dragState.lastX - dragState.startX;
    dragState.top = dragState.startTop + dragState.lastY - dragState.startY;
    setPanelTransform(dragState.panel, dragState.left - dragState.startLeft, dragState.top - dragState.startTop);
  }

  function queueDragFrame() {
    if (!dragState || dragState.frame) {
      return;
    }
    dragState.frame = window.requestAnimationFrame(updateDragFrame);
  }

  function startPanelDrag(event) {
    var handle = event.target && event.target.closest ? event.target.closest("[data-drag-handle]") : null;
    if (!handle || event.button !== 0) {
      return;
    }
    var panel = handle.closest("[data-drag-panel]") || handle.closest("[data-module-panel]");
    var id = getPanelId(panel);
    if (!panel || !id) {
      return;
    }
    if (event.target.closest("button, input, textarea, select, a")) {
      bringModuleToFront(id);
      return;
    }
    event.preventDefault();
    bringModuleToFront(id);
    var rect = panel.getBoundingClientRect();
    var position = normalizePanelPoint({
      left: rect.left,
      top: rect.top
    }) || getPanelPosition(id, Array.prototype.indexOf.call(elements.viewRoot.querySelectorAll("[data-module-panel]"), panel));
    dragState = {
      id: id,
      panel: panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startLeft: position.left,
      startTop: position.top,
      left: position.left,
      top: position.top,
      frame: null
    };
    panel.classList.add("is-dragging");
    if (panel.setPointerCapture) {
      panel.setPointerCapture(event.pointerId);
    }
  }

  function movePanelDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    queueDragFrame();
  }

  function endPanelDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (dragState.frame) {
      window.cancelAnimationFrame(dragState.frame);
      updateDragFrame();
    }
    var point = clampPanelPosition(normalizePanelPoint({ left: dragState.left, top: dragState.top }) || {
      left: dragState.left,
      top: dragState.top
    }, dragState.id);
    if (point) {
      state.modulePositions[dragState.id] = point;
      setPanelPosition(dragState.panel, point.left, point.top);
      savePanelLayout();
    }
    dragState.panel.classList.remove("is-dragging");
    if (dragState.panel.releasePointerCapture) {
      dragState.panel.releasePointerCapture(event.pointerId);
    }
    dragState = null;
  }

  function selectRequest(id) {
    state.selectedRequestId = id;
    renderDetail();
  }

  function closeDetail() {
    state.selectedRequestId = null;
    renderDetail();
  }

  function openSettings() {
    state.settingsOpen = true;
    renderSettings();
    refreshBalanceLoginStatus();
  }

  function closeSettings() {
    state.settingsOpen = false;
    renderSettings();
  }

  function sanitizeBalanceLoginStatus(status) {
    if (!status || typeof status !== "object" || Array.isArray(status)) {
      return {
        status: "unknown",
        hasCookies: false,
        origin: "",
        updatedAt: "",
        message: ""
      };
    }
    return {
      status: String(status.status || "").toLowerCase().slice(0, 48),
      hasCookies: Boolean(status.hasCookies),
      origin: String(status.origin || "").trim().slice(0, 220),
      updatedAt: String(status.updatedAt || "").trim().slice(0, 80),
      message: String(status.message || "").trim().slice(0, 160)
    };
  }

  function refreshBalanceLoginStatus() {
    if (!state.settingsOpen || state.settings.balanceAcquisitionMode !== "web-session") {
      return Promise.resolve(null);
    }
    if (!state.api || typeof state.api.getBalanceLoginStatus !== "function") {
      state.balanceLoginStatus = sanitizeBalanceLoginStatus(null);
      renderSettings();
      return Promise.resolve(state.balanceLoginStatus);
    }
    return Promise.resolve(state.api.getBalanceLoginStatus())
      .then(function (status) {
        state.balanceLoginStatus = sanitizeBalanceLoginStatus(status);
        renderSettings();
        return state.balanceLoginStatus;
      })
      .catch(function (error) {
        state.balanceLoginStatus = sanitizeBalanceLoginStatus({
          status: "error",
          hasCookies: false,
          message: error.message
        });
        renderSettings();
        setStatus("读取余额登录状态失败：" + error.message);
        return state.balanceLoginStatus;
      });
  }

  function ensureWebSessionBalanceMode() {
    if (state.settings.balanceAcquisitionMode === "web-session") {
      return flushSettingsSave();
    }
    var saved = updateSettingsPatch({ balanceAcquisitionMode: "web-session" }, "text");
    state.balanceDiagnostic = null;
    state.balanceLoginStatus = null;
    setStatus("已切换为网页登录余额模式");
    return saved;
  }

  function openBalanceLogin() {
    if (state.balanceLoginBusy) {
      return Promise.resolve(null);
    }
    if (!state.api || typeof state.api.openBalanceLogin !== "function") {
      setStatus("当前后端不支持网页登录余额");
      state.balanceLoginStatus = sanitizeBalanceLoginStatus({
        status: "unsupported",
        hasCookies: false,
        message: "当前后端不支持网页登录余额"
      });
      renderSettings();
      return Promise.resolve(null);
    }
    state.balanceLoginBusy = true;
    renderSettings();
    setStatus("正在打开余额登录页面");
    return Promise.resolve(ensureWebSessionBalanceMode())
      .then(function () {
        return state.api.openBalanceLogin();
      })
      .then(function () {
        setStatus("余额登录流程已完成，正在刷新状态");
        return refreshBalanceLoginStatus();
      })
      .then(function (status) {
        setStatus(status && (status.hasLoginState || status.hasCookies || status.hasAuthToken) ? "已保存余额登录态" : "余额登录状态已刷新");
        return status;
      })
      .catch(function (error) {
        state.balanceLoginStatus = sanitizeBalanceLoginStatus({
          status: "error",
          hasCookies: false,
          message: error.message
        });
        renderSettings();
        setStatus("余额登录失败：" + error.message);
      })
      .finally(function () {
        state.balanceLoginBusy = false;
        renderSettings();
      });
  }

  function openExternalBalancePage() {
    if (!state.api || typeof state.api.openExternalBalancePage !== "function") {
      setStatus("当前后端不支持用系统浏览器打开余额页面");
      return Promise.resolve(null);
    }
    setStatus("正在用系统浏览器打开余额页面");
    return Promise.resolve(state.api.openExternalBalancePage())
      .then(function (result) {
        setStatus(result && result.opened ? "已用系统浏览器打开余额页面" : (result && result.message) || "未配置余额页面地址");
        return result;
      })
      .catch(function (error) {
        setStatus("打开系统浏览器失败：" + error.message);
        return null;
      });
  }

  function sanitizeBalanceDiagnostic(diagnostic) {
    if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
      return {
        mode: "",
        balanceStatus: "unknown",
        advice: "暂时无法读取诊断结果"
      };
    }
    return {
      mode: String(diagnostic.mode || "").slice(0, 48),
      providerName: String(diagnostic.providerName || "").slice(0, 80),
      providerHost: String(diagnostic.providerHost || "").slice(0, 220),
      targetHost: String(diagnostic.targetHost || "").slice(0, 220),
      suggestedBalancePageUrl: String(diagnostic.suggestedBalancePageUrl || "").slice(0, 500),
      suggestedBalancePageHost: String(diagnostic.suggestedBalancePageHost || "").slice(0, 220),
      effectiveLoginUrl: String(diagnostic.effectiveLoginUrl || "").slice(0, 500),
      effectiveLoginHost: String(diagnostic.effectiveLoginHost || "").slice(0, 220),
      balanceStatus: String(diagnostic.balanceStatus || "").slice(0, 48),
      balanceSource: String(diagnostic.balanceSource || "").slice(0, 80),
      amount: diagnostic.amount == null ? null : ui.toNumber(diagnostic.amount, null),
      httpStatus: diagnostic.httpStatus || null,
      sourceField: String(diagnostic.sourceField || "").slice(0, 120),
      quotaStatus: String(diagnostic.quotaStatus || "").slice(0, 48),
      quotaEndpoint: String(diagnostic.quotaEndpoint || "").slice(0, 240),
      quotaSourceField: String(diagnostic.quotaSourceField || "").slice(0, 120),
      hasLoginState: Boolean(diagnostic.hasLoginState),
      hasCookies: Boolean(diagnostic.hasCookies),
      hasAuthToken: Boolean(diagnostic.hasAuthToken),
      hasAuthUserId: Boolean(diagnostic.hasAuthUserId),
      loginStatus: String(diagnostic.loginStatus || "").slice(0, 48),
      loginOrigin: String(diagnostic.loginOrigin || "").slice(0, 220),
      updatedAt: String(diagnostic.updatedAt || "").slice(0, 80),
      failureKind: String(diagnostic.failureKind || "").slice(0, 80),
      nextStep: String(diagnostic.nextStep || "").slice(0, 220),
      advice: String(diagnostic.advice || "").slice(0, 220)
    };
  }

  function diagnoseBalance() {
    if (state.balanceDiagnosticBusy) return Promise.resolve(null);
    if (!state.api || typeof state.api.diagnoseBalance !== "function") {
      state.balanceDiagnostic = sanitizeBalanceDiagnostic({
        balanceStatus: "unsupported",
        advice: "当前后端不支持余额诊断"
      });
      renderSettings();
      return Promise.resolve(state.balanceDiagnostic);
    }
    state.balanceDiagnosticBusy = true;
    renderSettings();
    return Promise.resolve(state.api.diagnoseBalance())
      .then(function (diagnostic) {
        state.balanceDiagnostic = sanitizeBalanceDiagnostic(diagnostic);
        setStatus("余额诊断已更新");
        return state.balanceDiagnostic;
      })
      .catch(function (error) {
        state.balanceDiagnostic = sanitizeBalanceDiagnostic({
          balanceStatus: "error",
          advice: error.message
        });
        setStatus("余额诊断失败：" + error.message);
        return state.balanceDiagnostic;
      })
      .finally(function () {
        state.balanceDiagnosticBusy = false;
        renderSettings();
      });
  }

  function useSuggestedBalancePageUrl(button) {
    var url = button && button.dataset ? String(button.dataset.useSuggestedBalancePage || "").trim() : "";
    if (!url) return;
    updateSettingsPatch({
      balanceAcquisitionMode: "web-session",
      balancePageUrl: url
    }, "text");
    state.balanceDiagnostic = null;
    state.balanceLoginStatus = null;
    refreshBalanceLoginStatus();
    setStatus("已切换为当前中转站余额页面，正在打开登录窗口");
    window.setTimeout(function () {
      openBalanceLogin();
    }, 0);
  }

  function normalizeRelayName(value) {
    return String(value || "").trim().slice(0, 40);
  }

  function coerceSettingValue(key, value, inputType) {
    if (inputType === "checkbox") {
      return Boolean(value);
    }
    if (key === "glassOpacity" || key === "panelOpacity") {
      var opacity = ui.toNumber(value, defaultSettings.panelOpacity);
      return ui.clamp(opacity > 1 ? opacity / 100 : opacity, 0.35, 0.92);
    }
    if (key === "windowOpacity") {
      var windowOpacity = ui.toNumber(value, defaultSettings.windowOpacity);
      return ui.clamp(windowOpacity > 1 ? windowOpacity / 100 : windowOpacity, 0.65, 1);
    }
    if (key === "glassBlur") {
      return ui.clamp(ui.toNumber(value, defaultSettings.glassBlur), 8, 36);
    }
    if (key === "cacheHitTarget" || key === "contextWarningThreshold") {
      return ui.clamp(ui.toNumber(value, defaultSettings[key]), 0, 100);
    }
    if (key === "customRelayName") {
      return normalizeRelayName(value);
    }
    if (key === "balanceAcquisitionMode") {
      return ["auto-api", "web-session", "manual"].indexOf(value) === -1 ? defaultSettings.balanceAcquisitionMode : value;
    }
    if (key === "closeButtonBehavior") {
      return ["hide-to-tray", "quit"].indexOf(value) === -1 ? defaultSettings.closeButtonBehavior : value;
    }
    if (key === "companionVisible") {
      return Boolean(value);
    }
    if (key === "balanceManualAmount") {
      return String(value == null ? "" : value).trim().slice(0, 32);
    }
    if (key === "balancePageUrl") {
      return String(value || "").trim().slice(0, 500);
    }
    if (key === "balanceSelector") {
      return String(value || "").trim().slice(0, 240);
    }
    if (key === "appearanceTheme") {
      return normalizeTheme(value);
    }
    return value;
  }

  function persistSettingsPatch(patch) {
    if (!state.api || typeof state.api.updateSettings !== "function") return Promise.resolve(null);
    return Promise.resolve(state.api.updateSettings(sanitizeSettingsPatch(patch))).catch(function (error) {
      setStatus("设置保存失败：" + error.message);
      return null;
    });
  }

  function isAppearanceOnlyPatch(patch) {
    var keys = Object.keys(patch || {});
    return keys.length > 0 && keys.every(function (key) {
      return key === "appearanceTheme"
        || key === "windowOpacity"
        || key === "panelOpacity"
        || key === "glassOpacity"
        || key === "glassBlur"
        || key === "systemGlass";
    });
  }

  function queueSettingsSave(patch, delay) {
    pendingSettingsPatch = Object.assign({}, pendingSettingsPatch || {}, patch);
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(function () {
      var nextPatch = pendingSettingsPatch;
      pendingSettingsPatch = null;
      settingsSaveTimer = 0;
      persistSettingsPatch(nextPatch || {});
    }, delay);
  }

  function flushSettingsSave() {
    if (!pendingSettingsPatch) return Promise.resolve(null);
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = 0;
    var nextPatch = pendingSettingsPatch;
    pendingSettingsPatch = null;
    return persistSettingsPatch(nextPatch);
  }

  function updateSettingsPatch(patch, inputType, options) {
    var saveDelay = options && typeof options.saveDelay === "number" ? options.saveDelay : 0;
    Object.keys(patch).forEach(function (key) {
      state.settings[key] = coerceSettingValue(key, patch[key], inputType);
      if (key === "glassOpacity" || key === "panelOpacity") {
        state.settings.glassOpacity = state.settings[key];
        state.settings.panelOpacity = state.settings[key];
      }
    });
    state.settings = normalizeSettings(state.settings);
    settingsView.apply(state.settings);
    if (!isAppearanceOnlyPatch(patch)) {
      renderSnapshotViews();
    }
    syncSettingValues();
    if (saveDelay > 0) queueSettingsSave(patch, saveDelay);
    else {
      if (pendingSettingsPatch) {
        patch = Object.assign({}, pendingSettingsPatch, patch);
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = 0;
        pendingSettingsPatch = null;
      }
      return persistSettingsPatch(patch);
    }
    return Promise.resolve(null);
  }

  function updateSetting(key, value, inputType, options) {
    var patch = {};
    patch[key] = value;
    var result = updateSettingsPatch(patch, inputType, options);
    if (key === "balanceAcquisitionMode" && !(options && options.previewOnly)) {
      refreshBalanceLoginStatus();
    }
    return result;
  }

  function resetAppearanceSettings() {
    updateSettingsPatch({
      appearanceTheme: defaultSettings.appearanceTheme,
      windowOpacity: defaultSettings.windowOpacity,
      panelOpacity: defaultSettings.panelOpacity,
      glassOpacity: defaultSettings.panelOpacity,
      glassBlur: defaultSettings.glassBlur,
      systemGlass: defaultSettings.systemGlass
    });
    renderSettings();
  }

  function syncSettingValues() {
    if (!state.settingsOpen) {
      return;
    }
    Array.prototype.forEach.call(elements.settingsRoot.querySelectorAll("[data-range-value]"), function (node) {
      var key = node.getAttribute("data-range-value");
      if (key === "glassOpacity" || key === "panelOpacity" || key === "windowOpacity") {
        node.textContent = Math.round(ui.toNumber(state.settings[key], defaultSettings[key] || defaultSettings.panelOpacity) * 100) + "%";
        return;
      }
      var suffix = key === "glassBlur" ? "px" : key === "cacheHitTarget" || key === "contextWarningThreshold" ? "%" : "";
      node.textContent = state.settings[key] + suffix;
    });
  }

  function refreshBalance() {
    if (!state.api || typeof state.api.refreshBalance !== "function") {
      setStatus("等待中转站数据刷新");
      state.snapshot = createUnconfiguredSnapshot();
      render();
      return Promise.resolve();
    }
    setStatus("正在刷新余额");
    return Promise.resolve(state.api.refreshBalance())
      .then(function (snapshot) {
        if (snapshot) {
          state.snapshot = sanitizeSnapshot(snapshot);
        }
        setStatus("余额已刷新");
        render();
      })
      .catch(function (error) {
        setStatus("刷新余额失败：" + error.message);
      });
  }

  function closeWindow() {
    var api = window.relayMonitor || state.api;
    if (api && typeof api.close === "function") {
      Promise.resolve(api.close()).catch(function (error) {
        setStatus("关闭窗口失败：" + error.message);
      });
      return;
    }
    window.close();
  }

  function minimizeWindow() {
    var api = window.relayMonitor || state.api;
    if (api && typeof api.minimize === "function") {
      Promise.resolve(api.minimize()).catch(function (error) {
        setStatus("最小化失败：" + error.message);
      });
    }
  }

  function hideWindow() {
    var api = window.relayMonitor || state.api;
    if (api && typeof api.hide === "function") {
      Promise.resolve(api.hide()).catch(function (error) {
        setStatus("隐藏窗口失败：" + error.message);
      });
    }
  }

  function isScopedSecretToggle(target) {
    var button = target && target.closest ? target.closest("button[data-toggle-secrets]") : null;
    return button && button.closest("[data-secret-panel]") ? button : null;
  }

  function openRelayNameEditor() {
    state.relayNameEditing = true;
    renderSnapshotViews();
    var input = elements.viewRoot.querySelector("[data-relay-name-input]");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeRelayNameEditor() {
    state.relayNameEditing = false;
    renderSnapshotViews();
  }

  function saveRelayName(value) {
    state.relayNameEditing = false;
    updateSetting("customRelayName", value, "text");
    setStatus(normalizeRelayName(value) ? "中转站名称已保存" : "已恢复自动中转站名称");
  }

  function saveRelayNameFromInput() {
    var input = elements.viewRoot.querySelector("[data-relay-name-input]");
    saveRelayName(input ? input.value : "");
  }

  function bindEvents() {
    elements.viewRoot.addEventListener("click", function (event) {
      var panel = event.target.closest("[data-drag-panel], [data-module-panel]");
      if (panel) {
        bringModuleToFront(getPanelId(panel));
      }
      if (event.target.closest("button[data-open-relay-editor]")) {
        openRelayNameEditor();
        return;
      }
      if (event.target.closest("button[data-save-relay-name]")) {
        saveRelayNameFromInput();
        return;
      }
      if (event.target.closest("button[data-clear-relay-name]")) {
        saveRelayName("");
        return;
      }
      if (event.target.closest("button[data-cancel-relay-name]")) {
        closeRelayNameEditor();
        return;
      }
      if (event.target.closest("button[data-open-settings-panel]")) {
        openSettings();
        return;
      }
      if (event.target.closest("button[data-open-balance-login]")) {
        openSettings();
        openBalanceLogin();
        return;
      }
      if (event.target.closest("button[data-refresh-balance]")) {
        refreshBalance();
        return;
      }
      var closeModuleButton = event.target.closest("button[data-module-close]");
      if (closeModuleButton) {
        var closeId = closeModuleButton.getAttribute("data-module-close");
        state.activeModules[closeId] = false;
        renderSnapshotViews();
        savePanelLayout();
        setStatus("已关闭 " + moduleLabel(closeId) + " 详情仪表板");
        return;
      }
      var moduleButton = event.target.closest("button[data-module-toggle]");
      if (moduleButton) {
        toggleModule(moduleButton.getAttribute("data-module-toggle"));
        return;
      }
      if (isScopedSecretToggle(event.target)) {
        toggleSecrets();
        return;
      }
      var row = event.target.closest("button[data-request-id]");
      if (row) {
        selectRequest(row.getAttribute("data-request-id"));
      }
    });

    elements.viewRoot.addEventListener("pointerdown", startPanelDrag);
    elements.viewRoot.addEventListener("pointermove", movePanelDrag);
    elements.viewRoot.addEventListener("pointerup", endPanelDrag);
    elements.viewRoot.addEventListener("pointercancel", endPanelDrag);

    elements.viewRoot.addEventListener("keydown", function (event) {
      if (!event.target || !event.target.matches("[data-relay-name-input]")) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        saveRelayNameFromInput();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeRelayNameEditor();
      }
    });

    elements.detailRoot.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-detail]")) {
        closeDetail();
        return;
      }
      if (isScopedSecretToggle(event.target)) {
        toggleSecrets();
      }
    });

    elements.settingsRoot.addEventListener("click", function (event) {
      if (event.target.closest("[data-open-balance-login]")) {
        openBalanceLogin();
        return;
      }
      if (event.target.closest("[data-open-balance-external]")) {
        openExternalBalancePage();
        return;
      }
      if (event.target.closest("[data-diagnose-balance]")) {
        diagnoseBalance();
        return;
      }
      var suggestedBalancePage = event.target.closest("[data-use-suggested-balance-page]");
      if (suggestedBalancePage) {
        useSuggestedBalancePageUrl(suggestedBalancePage);
        return;
      }
      if (event.target.closest("[data-reset-appearance]")) {
        resetAppearanceSettings();
        return;
      }
      if (event.target.closest("[data-close-settings]")) {
        closeSettings();
      }
    });

    elements.settingsRoot.addEventListener("input", function (event) {
      var target = event.target;
      if (!target || !target.dataset || !target.dataset.setting) {
        return;
      }
      if (target.type === "checkbox" || target.type === "radio") {
        return;
      }
      var key = target.dataset.setting;
      var value = target.value;
      updateSetting(key, value, target.type, { saveDelay: 220, previewOnly: true });
    });

    elements.settingsRoot.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.dataset || !target.dataset.setting) {
        return;
      }
      if (target.type === "checkbox") {
        updateSetting(target.dataset.setting, target.checked, target.type);
        return;
      }
      updateSetting(target.dataset.setting, target.value, target.type);
    });

    if (elements.minimizeButton) {
      elements.minimizeButton.addEventListener("click", minimizeWindow);
    }
    if (elements.hideButton) {
      elements.hideButton.addEventListener("click", hideWindow);
    }
    if (elements.refreshButton) {
      elements.refreshButton.addEventListener("click", refreshBalance);
    }
    if (elements.settingsButton) {
      elements.settingsButton.addEventListener("click", openSettings);
    }
    elements.closeButton.addEventListener("click", closeWindow);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (state.relayNameEditing) {
          closeRelayNameEditor();
        }
        closeDetail();
        closeSettings();
        if (Object.keys(state.activeModules).some(function (id) { return state.activeModules[id]; })) {
          closeModules();
        }
      }
    });
  }

  function hydrate() {
    var api = state.api;
    var snapshotPromise = api && typeof api.getSnapshot === "function" ? Promise.resolve(api.getSnapshot()) : Promise.resolve(state.snapshot);
    var settingsPromise = api && typeof api.getSettings === "function" ? Promise.resolve(api.getSettings()) : Promise.resolve(state.settings);
    var modulesPromise = api && typeof api.getModuleWindowState === "function" ? Promise.resolve(api.getModuleWindowState()) : Promise.resolve(state.activeModules);

    return Promise.all([snapshotPromise, settingsPromise, modulesPromise])
      .then(function (results) {
        state.snapshot = sanitizeSnapshot(results[0] || state.snapshot);
        state.snapshotSignature = snapshotSignature(state.snapshot);
        state.settings = normalizeSettings(results[1]);
        state.activeModules = isPlainObject(results[2]) ? results[2] : {};
        state.loading = false;
        render();
      })
      .catch(function (error) {
        state.loading = false;
        setStatus("读取失败，已切换为空状态：" + error.message);
        state.snapshot = createUnconfiguredSnapshot();
        state.snapshotSignature = snapshotSignature(state.snapshot);
        state.settings = normalizeSettings();
        render();
      });
  }

  function bindSnapshotPush() {
    if (!state.api || typeof state.api.onSnapshotPush !== "function") {
      return;
    }
    state.api.onSnapshotPush(function (snapshot) {
      if (!snapshot) {
        return;
      }
      var nextSnapshot = sanitizeSnapshot(snapshot);
      var nextSignature = snapshotSignature(nextSnapshot);
      if (nextSignature === state.snapshotSignature) {
        return;
      }
      state.snapshot = nextSnapshot;
      state.snapshotSignature = nextSignature;
      scheduleSnapshotRender();
    });
  }

  function bindModuleStatePush() {
    if (!state.api || typeof state.api.onModuleStatePush !== "function") {
      return;
    }
    state.api.onModuleStatePush(function (modules) {
      state.activeModules = isPlainObject(modules) ? modules : {};
      scheduleSnapshotRender();
    });
  }

  function boot() {
    elements.viewRoot = document.getElementById("view-root");
    elements.detailRoot = document.getElementById("detail-root");
    elements.settingsRoot = document.getElementById("settings-root");
    elements.status = document.getElementById("app-status");
    elements.minimizeButton = document.getElementById("minimize-button");
    elements.hideButton = document.getElementById("hide-button");
    elements.refreshButton = document.getElementById("refresh-button");
    elements.settingsButton = document.getElementById("settings-button");
    elements.closeButton = document.getElementById("close-button");

    loadPanelLayout();
    bindEvents();
    settingsView.apply(state.settings);
    render();
    hydrate();
    bindSnapshotPush();
    bindModuleStatePush();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
