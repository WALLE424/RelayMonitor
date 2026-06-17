(function () {
  "use strict";

  var api = window.relayMonitor || null;
  var overview = window.RelayMonitorOverview;
  var moduleId = new URLSearchParams(window.location.search).get("module") || "api";
  var state = {
    balanceLoginBusy: false,
    balanceDiagnostic: null,
    balanceDiagnosticBusy: false,
    balanceLoginStatus: null,
    snapshot: null,
    settings: null,
    settingsSignature: "",
    snapshotSignature: ""
  };
  var renderFrame = 0;
  var settingsSaveTimer = 0;
  var pendingSettingsPatch = null;

  function emptySnapshot() {
    return {
      balance: { amount: null, status: "unknown" },
      cache: { hitRate: 0 },
      context: { usedPercent: 0, usedTokens: 0, windowTokens: 0 },
      currentRelay: { name: "未连接中转站", endpoint: "" },
      provider: { name: "未连接中转站", maskedKey: "", keyPreview: "" },
      recentRequests: [],
      spend: { today: 0, week: 0, month: 0, total: 0 },
      tokens: { cached: 0, daily: 0, input: 0, monthly: 0, output: 0, total: 0, weekly: 0 },
      trend7d: []
    };
  }

  function defaultSettings() {
    return {
      appearanceTheme: "light",
      cacheHitTarget: 60,
      contextWarningThreshold: 78,
      glassBlur: 24,
      panelOpacity: 0.8,
      glassOpacity: 0.8,
      windowOpacity: 1,
      systemGlass: false
    };
  }

  function readPath(source, paths, fallback) {
    var list = Array.isArray(paths) ? paths : [paths];
    for (var pathIndex = 0; pathIndex < list.length; pathIndex += 1) {
      var cursor = source;
      var parts = String(list[pathIndex]).split(".");
      for (var index = 0; index < parts.length; index += 1) {
        if (!cursor || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, parts[index])) {
          cursor = undefined;
          break;
        }
        cursor = cursor[parts[index]];
      }
      if (cursor !== undefined && cursor !== null && cursor !== "") return cursor;
    }
    return fallback;
  }

  function snapshotSignature(snapshot) {
    var source = snapshot && typeof snapshot === "object" ? snapshot : {};
    var recent = Array.isArray(source.recentRequests) ? source.recentRequests.slice(0, 10) : [];
    var trend = Array.isArray(source.trend7d) ? source.trend7d : Array.isArray(source.trend) ? source.trend : [];
    return JSON.stringify({
      provider: readPath(source, ["provider.providerId", "provider.name", "provider.baseUrl", "currentRelay.name"], ""),
      model: readPath(source, ["model", "currentModel", "provider.model"], ""),
      reasoning: readPath(source, ["reasoningEffort", "provider.reasoningEffort"], ""),
      balance: readPath(source, ["balance.status", "balance.amount", "balance.source", "balance.endpoint"], ""),
      tokens: readPath(source, ["tokens.daily", "tokens.weekly", "tokens.monthly", "usage.todayTokens", "usage.totalTokens"], ""),
      spend: readPath(source, ["spend.today", "spend.week", "spend.month", "spend.total", "spend.source", "spend.status"], ""),
      cache: readPath(source, ["cache.hitRate", "cache.hitTokens", "cache.missTokens"], ""),
      context: readPath(source, ["context.usedPercent", "context.usedTokens", "context.remainingTokens"], ""),
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
          request && request.status,
        ];
      })
    });
  }

  function settingsSignature(settings) {
    var source = settings && typeof settings === "object" ? settings : {};
    return JSON.stringify({
      appearanceTheme: source.appearanceTheme,
      balanceAcquisitionMode: source.balanceAcquisitionMode,
      balanceManualAmount: source.balanceManualAmount,
      balancePageUrl: source.balancePageUrl,
      balanceSelector: source.balanceSelector,
      cacheHitTarget: source.cacheHitTarget,
      contextWarningThreshold: source.contextWarningThreshold,
      glassBlur: source.glassBlur,
      panelOpacity: source.panelOpacity,
      systemGlass: source.systemGlass,
      windowOpacity: source.windowOpacity
    });
  }

  function render() {
    renderFrame = 0;
    var root = document.getElementById("module-root");
    if (moduleId === "settings" && window.RelayMonitorSettings) {
      root.innerHTML = window.RelayMonitorSettings.render(state.settings || defaultSettings(), {
        balanceDiagnostic: state.balanceDiagnostic,
        balanceDiagnosticBusy: state.balanceDiagnosticBusy,
        balanceLoginBusy: state.balanceLoginBusy,
        balanceLoginStatus: state.balanceLoginStatus
      });
      return;
    }
    var activeModules = {};
    activeModules[moduleId] = true;
    var snapshot = state.snapshot || emptySnapshot();
    var settings = state.settings || defaultSettings();
    if (overview && typeof overview.renderModule === "function") {
      root.innerHTML = overview.renderModule(moduleId, snapshot, settings, {
        activeModules: activeModules,
        externalModules: false,
        secretsVisible: false
      }) || '<article class="module-panel glass-panel"><p>模块不可用</p></article>';
      return;
    }
    var html = overview.render(snapshot, settings, {
      activeModules: activeModules,
      externalModules: false,
      secretsVisible: false
    });
    var holder = document.createElement("div");
    holder.innerHTML = html;
    var panel = holder.querySelector('[data-module-panel="' + moduleId + '"]');
    root.innerHTML = panel ? panel.outerHTML : '<article class="module-panel glass-panel"><p>模块不可用</p></article>';
  }

  function scheduleRender() {
    if (renderFrame) return;
    if (typeof window.requestAnimationFrame !== "function") {
      render();
      return;
    }
    renderFrame = window.requestAnimationFrame(render);
  }

  function closeModule() {
    if (api && typeof api.closeModuleWindow === "function") {
      Promise.resolve(api.closeModuleWindow(moduleId)).catch(function () {});
      return;
    }
    window.close();
  }

  function coerceSettingValue(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.type === "radio") return target.value;
    return target.value;
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

  function syncRangeValues() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-range-value]"), function (node) {
      var key = node.getAttribute("data-range-value");
      var value = state.settings && state.settings[key];
      if (key === "glassOpacity" || key === "panelOpacity" || key === "windowOpacity") {
        node.textContent = Math.round(Number(value || 0) * 100) + "%";
        return;
      }
      node.textContent = value + (key === "glassBlur" ? "px" : key === "cacheHitTarget" || key === "contextWarningThreshold" ? "%" : "");
    });
  }

  function persistSettingsPatch(patch) {
    if (!api || typeof api.updateSettings !== "function") return;
    Promise.resolve(api.updateSettings(patch)).then(function (settings) {
      state.settings = settings || state.settings;
      if (window.RelayMonitorSettings && typeof window.RelayMonitorSettings.apply === "function") {
        window.RelayMonitorSettings.apply(state.settings);
      }
      if (isAppearanceOnlyPatch(patch)) {
        syncRangeValues();
      } else {
        scheduleRender();
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "balanceAcquisitionMode")) {
        refreshBalanceLoginStatus();
      }
    }).catch(function () {
      scheduleRender();
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
    if (!pendingSettingsPatch) return;
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = 0;
    var nextPatch = pendingSettingsPatch;
    pendingSettingsPatch = null;
    persistSettingsPatch(nextPatch);
  }

  function updateSetting(target, options) {
    if (!target || !target.dataset || !target.dataset.setting) return;
    var patch = {};
    patch[target.dataset.setting] = coerceSettingValue(target);
    state.settings = Object.assign({}, state.settings || defaultSettings(), patch);
    if (window.RelayMonitorSettings && typeof window.RelayMonitorSettings.apply === "function") {
      window.RelayMonitorSettings.apply(state.settings);
    }
    var saveDelay = options && typeof options.saveDelay === "number" ? options.saveDelay : 0;
    if (saveDelay > 0) {
      if (isAppearanceOnlyPatch(patch)) {
        syncRangeValues();
      } else {
        scheduleRender();
      }
      queueSettingsSave(patch, saveDelay);
      return;
    }
    if (pendingSettingsPatch) {
      patch = Object.assign({}, pendingSettingsPatch, patch);
      pendingSettingsPatch = null;
      clearTimeout(settingsSaveTimer);
      settingsSaveTimer = 0;
    }
    persistSettingsPatch(patch);
    if (isAppearanceOnlyPatch(patch)) {
      syncRangeValues();
    } else {
      scheduleRender();
    }
  }

  function refreshBalanceLoginStatus() {
    if (moduleId !== "settings" || !state.settings || state.settings.balanceAcquisitionMode !== "web-session") {
      return Promise.resolve(null);
    }
    if (!api || typeof api.getBalanceLoginStatus !== "function") {
      return Promise.resolve(null);
    }
    return Promise.resolve(api.getBalanceLoginStatus()).then(function (status) {
      state.balanceLoginStatus = status || null;
      render();
      return status;
    }).catch(function () {
      state.balanceLoginStatus = { status: "error", hasCookies: false };
      render();
    });
  }

  function diagnoseBalance() {
    if (moduleId !== "settings" || state.balanceDiagnosticBusy) return Promise.resolve(null);
    if (!api || typeof api.diagnoseBalance !== "function") {
      state.balanceDiagnostic = {
        balanceStatus: "unsupported",
        advice: "当前后端不支持余额诊断"
      };
      render();
      return Promise.resolve(state.balanceDiagnostic);
    }
    state.balanceDiagnosticBusy = true;
    render();
    return Promise.resolve(api.diagnoseBalance()).then(function (diagnostic) {
      state.balanceDiagnostic = diagnostic || null;
      return state.balanceDiagnostic;
    }).catch(function (error) {
      state.balanceDiagnostic = {
        balanceStatus: "error",
        advice: error.message || "余额诊断失败"
      };
      return state.balanceDiagnostic;
    }).finally(function () {
      state.balanceDiagnosticBusy = false;
      render();
    });
  }

  function openBalanceLogin() {
    if (!api || typeof api.openBalanceLogin !== "function" || state.balanceLoginBusy) return;
    var modeReady = Promise.resolve(null);
    if (!state.settings || state.settings.balanceAcquisitionMode !== "web-session") {
      state.settings = Object.assign({}, state.settings || defaultSettings(), { balanceAcquisitionMode: "web-session" });
      if (typeof api.updateSettings === "function") {
        modeReady = Promise.resolve(api.updateSettings({ balanceAcquisitionMode: "web-session" })).then(function (settings) {
          state.settings = settings || state.settings;
          return settings;
        }).catch(function () {
          return null;
        });
      }
    }
    state.balanceLoginBusy = true;
    render();
    modeReady.then(function () {
      return api.openBalanceLogin();
    }).then(function (status) {
      state.balanceLoginStatus = status || null;
      return refreshBalanceLoginStatus();
    }).catch(function () {
      state.balanceLoginStatus = { status: "error", hasCookies: false };
    }).finally(function () {
      state.balanceLoginBusy = false;
      render();
    });
  }

  function openExternalBalancePage() {
    if (!api || typeof api.openExternalBalancePage !== "function") return Promise.resolve(null);
    return Promise.resolve(api.openExternalBalancePage()).catch(function () {
      return null;
    });
  }

  function useSuggestedBalancePageUrl(button) {
    var url = button && button.dataset ? String(button.dataset.useSuggestedBalancePage || "").trim() : "";
    if (!url) return;
    state.settings = Object.assign({}, state.settings || defaultSettings(), {
      balanceAcquisitionMode: "web-session",
      balancePageUrl: url
    });
    state.balanceDiagnostic = null;
    state.balanceLoginStatus = null;
    render();
    if (!api || typeof api.updateSettings !== "function") return;
    Promise.resolve(api.updateSettings({
      balanceAcquisitionMode: "web-session",
      balancePageUrl: url
    })).then(function (settings) {
      state.settings = settings || state.settings;
      return refreshBalanceLoginStatus();
    }).then(function () {
      openBalanceLogin();
    }).catch(function () {
      render();
    });
  }

  function resetAppearance() {
    if (!api || typeof api.updateSettings !== "function") return;
    Promise.resolve(api.updateSettings({
      appearanceTheme: "light",
      glassBlur: 24,
      glassOpacity: 0.8,
      panelOpacity: 0.8,
      systemGlass: false,
      windowOpacity: 1
    })).then(function (settings) {
      state.settings = settings || state.settings;
      render();
    }).catch(function () {});
  }

  function bind() {
    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-module-close]")) {
        closeModule();
        return;
      }
      if (event.target.closest("[data-close-settings]")) {
        closeModule();
        return;
      }
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
        resetAppearance();
        return;
      }
      if (event.target.closest("[data-open-settings-panel]") && api && typeof api.toggleModuleWindow === "function") {
        Promise.resolve(api.toggleModuleWindow("settings")).catch(function () {});
      }
    });

    document.addEventListener("input", function (event) {
      var target = event.target;
      if (!target || !target.dataset || !target.dataset.setting || target.type === "checkbox" || target.type === "radio") {
        return;
      }
      updateSetting(target, { saveDelay: 220 });
    });

    document.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.dataset || !target.dataset.setting) return;
      flushSettingsSave();
      updateSetting(target);
    });
  }

  function hydrate() {
    var snapshotPromise = api && typeof api.getSnapshot === "function" ? Promise.resolve(api.getSnapshot()) : Promise.resolve(emptySnapshot());
    var settingsPromise = api && typeof api.getSettings === "function" ? Promise.resolve(api.getSettings()) : Promise.resolve(defaultSettings());
    return Promise.all([snapshotPromise, settingsPromise]).then(function (result) {
      state.snapshot = result[0] || emptySnapshot();
      state.settings = result[1] || defaultSettings();
      state.snapshotSignature = snapshotSignature(state.snapshot);
      state.settingsSignature = settingsSignature(state.settings);
      if (window.RelayMonitorSettings && typeof window.RelayMonitorSettings.apply === "function") {
        window.RelayMonitorSettings.apply(state.settings);
      }
      render();
      refreshBalanceLoginStatus();
    }).catch(function () {
      state.snapshot = emptySnapshot();
      state.settings = defaultSettings();
      render();
    });
  }

  function boot() {
    bind();
    render();
    hydrate();
    if (api && typeof api.onSnapshotPush === "function") {
      api.onSnapshotPush(function (snapshot) {
        var nextSnapshot = snapshot || state.snapshot;
        var nextSignature = snapshotSignature(nextSnapshot);
        if (nextSignature === state.snapshotSignature) return;
        state.snapshot = nextSnapshot;
        state.snapshotSignature = nextSignature;
        scheduleRender();
      });
    }
    if (api && typeof api.onSettingsPush === "function") {
      api.onSettingsPush(function (settings) {
        var nextSettings = settings || state.settings;
        var nextSignature = settingsSignature(nextSettings);
        if (nextSignature === state.settingsSignature) return;
        state.settings = nextSettings;
        state.settingsSignature = nextSignature;
        if (window.RelayMonitorSettings && typeof window.RelayMonitorSettings.apply === "function") {
          window.RelayMonitorSettings.apply(state.settings);
        }
        scheduleRender();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
