(function (factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.RelayMonitorCompanion = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", api.initCompanion);
      } else {
        api.initCompanion();
      }
    }
  }
})(function () {
  "use strict";

  var TEXT = {
    balance: "\u4f59\u989d",
    balanceUnknown: "\u4f59\u989d\u672a\u77e5",
    balanceUnavailable: "\u4f59\u989d\u4e0d\u53ef\u7528",
    balanceNotConfigured: "\u4f59\u989d\u672a\u914d\u7f6e",
    balanceProviderMismatch: "\u4f59\u989d\u9875\u4e0d\u5339\u914d",
    cacheHit: "\u7f13\u5b58\u547d\u4e2d\u7387",
    close: "\u5173\u95ed\u4f34\u968f\u6761",
    companionLabel: "\u4e2d\u8f6c\u7ad9\u4f34\u968f\u60ac\u6d6e\u6761",
    collapse: "\u6536\u8d77\u4f34\u968f\u6761",
    drag: "\u53ef\u62d6\u52a8",
    expand: "\u5c55\u5f00\u4f34\u968f\u6761",
    extractionFailed: "\u63d0\u53d6\u5931\u8d25",
    followOff: "\u624b\u52a8\u4f4d",
    followOn: "\u8ddf\u968f\u4e2d",
    hide: "\u9690\u85cf",
    latency: "\u5e73\u5747\u8017\u65f6",
    locked: "\u5df2\u9501\u5b9a",
    loginRequired: "\u9700\u8981\u767b\u5f55",
    model: "\u6a21\u578b",
    noData: "\u6682\u65e0",
    noModel: "\u672a\u68c0\u6d4b\u5230",
    noReasoning: "\u672a\u8bb0\u5f55",
    open: "\u6253\u5f00",
    openMain: "\u6253\u5f00\u5b8c\u6574\u4e3b\u9762\u677f",
    readFailed: "\u8bfb\u53d6\u5931\u8d25",
    reasoning: "\u63a8\u7406\u5f3a\u5ea6",
    relay: "\u4e2d\u8f6c\u7ad9",
    toggleFollow: "\u5207\u6362\u662f\u5426\u8d34\u9760 Codex \u7a97\u53e3",
    toggleLock: "\u9501\u5b9a\u6216\u89e3\u9501\u60ac\u6d6e\u6761\u4f4d\u7f6e"
  };

  var fallbackSnapshot = {
    compact: {
      providerName: TEXT.relay,
      todayTokens: 0,
      todaySpend: null,
      balanceAmount: null,
      balanceStatus: "unknown",
      currencySymbol: "\u00a5"
    },
    details: {
      model: TEXT.noModel,
      reasoningEffort: TEXT.noReasoning,
      avgLatencyMs: 0,
      cacheHitRate: null,
      balanceStatus: "unknown",
      balanceAmount: null
    }
  };

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function readPath(source, path) {
    if (!isObject(source)) return null;
    var cursor = source;
    var parts = String(path).split(".");
    for (var index = 0; index < parts.length; index += 1) {
      if (!isObject(cursor) && index < parts.length - 1) return null;
      cursor = cursor[parts[index]];
      if (cursor === null || cursor === undefined || cursor === "") return null;
    }
    return cursor;
  }

  function pick(source, paths) {
    for (var index = 0; index < paths.length; index += 1) {
      var value = readPath(source, paths[index]);
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  function firstValue(values) {
    for (var index = 0; index < values.length; index += 1) {
      var value = values[index];
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || fallback || TEXT.noData;
  }

  function shortRelayName(value) {
    var name = safeText(value, TEXT.relay);
    var separators = [" \u00b7 ", " \u8def ", " | ", " / ", " - ", " \u2014 "];
    for (var index = 0; index < separators.length; index += 1) {
      var separator = separators[index];
      if (name.indexOf(separator) > 0) {
        name = name.split(separator)[0].trim();
        break;
      }
    }
    return name || TEXT.relay;
  }

  function trimFixed(value, digits) {
    return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function formatCompactToken(value) {
    var number = toNumber(value);
    if (number === null) return "0";
    var sign = number < 0 ? "-" : "";
    var abs = Math.abs(number);
    if (abs < 1000) return sign + String(Math.round(abs));
    if (abs < 1000000) return sign + trimFixed(abs / 1000, abs < 10000 ? 1 : 0) + "K";
    if (abs < 1000000000) return sign + trimFixed(abs / 1000000, abs < 10000000 ? 1 : 0) + "M";
    return sign + trimFixed(abs / 1000000000, abs < 10000000000 ? 1 : 0) + "B";
  }

  function formatCompactMoney(value, options) {
    var settings = options || {};
    var fallback = settings.fallback || TEXT.balanceUnknown;
    var symbol = settings.symbol || "\u00a5";
    var number = toNumber(value);
    if (number === null) return fallback;
    var sign = number < 0 ? "-" : "";
    var abs = Math.abs(number);
    if (abs >= 100000000) return sign + symbol + trimFixed(abs / 100000000, 1) + "\u4ebf";
    if (abs >= 10000) return sign + symbol + trimFixed(abs / 10000, 1) + "\u4e07";
    return sign + symbol + abs.toFixed(2);
  }

  function normalizePercent(value) {
    var number = toNumber(value);
    if (number === null) return null;
    if (number >= 0 && number <= 1) return Math.round(number * 100);
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function formatPercent(value) {
    var percent = normalizePercent(value);
    return percent === null ? TEXT.noData : percent + "%";
  }

  function formatLatency(value) {
    var number = toNumber(value);
    if (number === null || number <= 0) return TEXT.noData;
    if (number >= 1000) return trimFixed(number / 1000, number >= 10000 ? 0 : 1) + "s";
    return Math.round(number) + "ms";
  }

  function balanceStatusLabel(status, amount, symbol) {
    var number = toNumber(amount);
    if (number !== null) return TEXT.balance + " " + formatCompactMoney(number, { symbol: symbol });
    if (status === "unlimited") return TEXT.loginRequired;
    if (status === "auth-required") return TEXT.loginRequired;
    if (status === "parse-error") return TEXT.extractionFailed;
    if (status === "provider-mismatch") return TEXT.balanceProviderMismatch;
    if (status === "error") return TEXT.readFailed;
    if (status === "unavailable") return TEXT.balanceUnavailable;
    if (status === "not-configured") return TEXT.balanceNotConfigured;
    return TEXT.balanceUnknown;
  }

  function cloneSnapshotForAnimation(snapshot) {
    var source = isObject(snapshot) ? snapshot : fallbackSnapshot;
    return {
      compact: Object.assign({}, isObject(source.compact) ? source.compact : {}),
      details: Object.assign({}, isObject(source.details) ? source.details : {}),
      recentRequests: Array.isArray(source.recentRequests) ? source.recentRequests.slice(0, 1) : [],
      currentRelay: Object.assign({}, isObject(source.currentRelay) ? source.currentRelay : {}),
      provider: Object.assign({}, isObject(source.provider) ? source.provider : {}),
      tokens: Object.assign({}, isObject(source.tokens) ? source.tokens : {}),
      usage: Object.assign({}, isObject(source.usage) ? source.usage : {}),
      spend: Object.assign({}, isObject(source.spend) ? source.spend : {}),
      periods: Object.assign({}, isObject(source.periods) ? source.periods : {}),
      balance: Object.assign({}, isObject(source.balance) ? source.balance : {}),
      cache: Object.assign({}, isObject(source.cache) ? source.cache : {}),
      latency: Object.assign({}, isObject(source.latency) ? source.latency : {})
    };
  }

  function animatedNumber(from, to, progress) {
    var start = toNumber(from);
    var end = toNumber(to);
    if (start === null || end === null) return to;
    return start + (end - start) * progress;
  }

  function easeOutCubic(progress) {
    var t = Math.max(0, Math.min(1, progress));
    return 1 - Math.pow(1 - t, 3);
  }

  function createAnimatedSnapshot(fromSnapshot, toSnapshot, progress) {
    var from = cloneSnapshotForAnimation(fromSnapshot);
    var target = cloneSnapshotForAnimation(toSnapshot);
    var eased = easeOutCubic(progress);
    target.compact.todayTokens = animatedNumber(from.compact.todayTokens, target.compact.todayTokens, eased);
    target.compact.todaySpend = animatedNumber(from.compact.todaySpend, target.compact.todaySpend, eased);
    target.compact.balanceAmount = animatedNumber(from.compact.balanceAmount, target.compact.balanceAmount, eased);
    target.details.balanceAmount = animatedNumber(from.details.balanceAmount, target.details.balanceAmount, eased);
    if (isObject(target.balance)) {
      target.balance.amount = animatedNumber(from.balance && from.balance.amount, target.balance.amount, eased);
      target.balance.balance = animatedNumber(from.balance && from.balance.balance, target.balance.balance, eased);
    }
    if (isObject(target.tokens)) {
      target.tokens.daily = animatedNumber(from.tokens && from.tokens.daily, target.tokens.daily, eased);
    }
    if (isObject(target.spend)) {
      target.spend.today = animatedNumber(from.spend && from.spend.today, target.spend.today, eased);
    }
    return target;
  }

  function statusTone(label) {
    if (new RegExp(TEXT.loginRequired + "|" + TEXT.extractionFailed + "|" + TEXT.readFailed + "|" + TEXT.balanceUnavailable).test(label)) {
      return "danger";
    }
    if (new RegExp(TEXT.balanceUnknown + "|" + TEXT.balanceNotConfigured + "|" + TEXT.balanceProviderMismatch + "|" + TEXT.noData).test(label)) {
      return "warning";
    }
    return "ok";
  }

  function createCompanionViewModel(snapshot) {
    var source = isObject(snapshot) ? snapshot : fallbackSnapshot;
    var compact = isObject(source.compact) ? source.compact : {};
    var details = isObject(source.details) ? source.details : {};
    var latest = Array.isArray(source.recentRequests) && source.recentRequests.length > 0
      ? source.recentRequests[0]
      : {};
    var symbol = firstValue([
      compact.currencySymbol,
      pick(source, ["balance.currencySymbol"])
    ]) || "\u00a5";
    var relayName = shortRelayName(firstValue([
      compact.providerName,
      pick(source, ["currentRelay.name", "provider.name", "relayName", "name"]),
      pick(latest, ["relay", "providerName"])
    ]));
    var todayTokens = firstValue([
      compact.todayTokens,
      pick(source, ["tokens.daily", "usage.todayTokens", "periods.todayTokens"])
    ]);
    var todaySpend = firstValue([
      compact.todaySpend,
      pick(source, ["spend.today", "periods.todayCost"])
    ]);
    var balanceAmount = firstValue([
      compact.balanceAmount,
      details.balanceAmount,
      pick(source, ["balance.amount", "balance.balance", "balance.remaining"])
    ]);
    var balanceStatus = firstValue([
      compact.balanceStatus,
      details.balanceStatus,
      pick(source, ["balance.status"])
    ]) || "unknown";
    var balanceLabel = balanceStatusLabel(balanceStatus, balanceAmount, symbol);
    var model = safeText(firstValue([
      details.model,
      pick(latest, ["requestModel", "request_model", "modelName", "model"]),
      pick(source, ["currentModel", "model", "provider.model"])
    ]), TEXT.noModel);
    var reasoningEffort = safeText(firstValue([
      details.reasoningEffort,
      pick(latest, ["reasoningEffort", "requestReasoningEffort"]),
      pick(source, ["reasoningEffort", "provider.reasoningEffort"])
    ]), TEXT.noReasoning);
    var avgLatency = firstValue([
      details.avgLatencyMs,
      pick(source, ["usage.avgLatencyMs", "latency.avg", "latency.average"]),
      pick(latest, ["latencyMs", "latency", "durationMs", "duration"])
    ]);
    var cacheHitRate = firstValue([
      details.cacheHitRate,
      pick(source, ["cache.hitRate", "cache.rate", "cacheHitRate"]),
      pick(latest, ["cacheHitRate"])
    ]);
    var viewModel = {
      relayName: relayName,
      todayTokens: toNumber(todayTokens) || 0,
      todayTokenText: formatCompactToken(todayTokens),
      todaySpendText: formatCompactMoney(todaySpend, { symbol: symbol, fallback: balanceLabel }),
      balanceText: balanceLabel,
      todaySpend: toNumber(todaySpend),
      balanceAmount: toNumber(balanceAmount),
      currencySymbol: symbol,
      model: model,
      reasoningEffort: reasoningEffort,
      avgLatencyText: formatLatency(avgLatency),
      cacheHitRateText: formatPercent(cacheHitRate),
      balanceStatus: balanceLabel
    };
    viewModel.compactText = [viewModel.relayName, viewModel.todayTokenText, viewModel.balanceText].join(" \u00b7 ");
    viewModel.statusTone = statusTone(viewModel.balanceStatus);
    return viewModel;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function element(tagName, className, textContent) {
    var node = document.createElement(tagName);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function button(className, textContent, title) {
    var node = element("button", className, textContent);
    node.type = "button";
    if (title) {
      node.title = title;
      node.setAttribute("aria-label", title);
    }
    return node;
  }

  function metric(label, value) {
    var node = element("div", "companion-metric");
    node.appendChild(element("span", "companion-label", label));
    node.appendChild(element("span", "companion-value", value));
    return node;
  }

  function updateRenderedValues(root, state, viewModel) {
    var bar = root.querySelector(".companion-bar");
    if (!bar) return false;
    bar.classList.toggle("is-expanded", Boolean(state.expanded));
    bar.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    bar.setAttribute("data-follow-codex", state.followCodex ? "true" : "false");
    bar.setAttribute("data-locked", state.locked ? "true" : "false");

    var compactButton = root.querySelector(".companion-button");
    if (compactButton) {
      compactButton.title = state.expanded ? TEXT.collapse : TEXT.expand;
      compactButton.setAttribute("aria-label", state.expanded ? TEXT.collapse : TEXT.expand);
    }

    var dot = root.querySelector(".companion-status-dot");
    if (dot) {
      dot.classList.toggle("is-warning", viewModel.statusTone === "warning");
      dot.classList.toggle("is-danger", viewModel.statusTone === "danger");
    }

    var compact = root.querySelector(".companion-compact");
    if (compact) compact.textContent = viewModel.compactText;

    var values = root.querySelectorAll(".companion-metric .companion-value");
    if (values[0]) values[0].textContent = viewModel.model;
    if (values[1]) values[1].textContent = viewModel.reasoningEffort;
    if (values[2]) values[2].textContent = viewModel.avgLatencyText;
    if (values[3]) values[3].textContent = viewModel.cacheHitRateText;

    var balance = root.querySelector(".companion-balance");
    if (balance) balance.textContent = viewModel.balanceStatus;

    var actions = root.querySelectorAll(".companion-action");
    if (actions[0]) actions[0].textContent = state.followCodex ? TEXT.followOn : TEXT.followOff;
    if (actions[1]) actions[1].textContent = state.locked ? TEXT.locked : TEXT.drag;
    return true;
  }

  function callApi(api, names, args) {
    if (!api) return Promise.resolve(null);
    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      var fn = name.split(".").reduce(function (cursor, part) {
        return cursor && cursor[part];
      }, api);
      if (typeof fn === "function") {
        try {
          return Promise.resolve(fn.apply(api, args || [])).catch(function () {
            return null;
          });
        } catch (_) {
          return Promise.resolve(null);
        }
      }
    }
    return Promise.resolve(null);
  }

  function fallbackHideBody() {
    if (typeof document === "undefined" || !document.body) return;
    document.body.style.display = "none";
    document.body.setAttribute("aria-hidden", "true");
  }

  function hideCompanion(api) {
    var relayApi = (typeof window !== "undefined" && window.relayMonitor) || api;
    if (relayApi && typeof relayApi.hideCompanion === "function") {
      try {
        return Promise.resolve(relayApi.hideCompanion()).catch(function () {
          fallbackHideBody();
          return null;
        });
      } catch (_) {
        fallbackHideBody();
        return Promise.resolve(null);
      }
    }
    fallbackHideBody();
    return Promise.resolve(null);
  }

  function render(root, state) {
    var viewModel = createCompanionViewModel(state.displaySnapshot || state.snapshot);
    if (updateRenderedValues(root, state, viewModel)) return;
    clearNode(root);

    var bar = element("section", "companion-bar" + (state.expanded ? " is-expanded" : ""));
    bar.setAttribute("aria-label", TEXT.companionLabel);
    bar.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    bar.setAttribute("data-follow-codex", state.followCodex ? "true" : "false");
    bar.setAttribute("data-locked", state.locked ? "true" : "false");

    var compactButton = button("companion-button", "", state.expanded ? TEXT.collapse : TEXT.expand);
    var dot = element("span", "companion-status-dot");
    if (viewModel.statusTone === "warning") dot.classList.add("is-warning");
    if (viewModel.statusTone === "danger") dot.classList.add("is-danger");
    dot.setAttribute("aria-hidden", "true");
    compactButton.appendChild(dot);
    compactButton.appendChild(element("span", "companion-compact", viewModel.compactText));
    var closeButton = button("companion-close-button", "\u00d7", TEXT.close);

    var details = element("div", "companion-details");
    var grid = element("div", "companion-grid");
    grid.appendChild(metric(TEXT.model, viewModel.model));
    grid.appendChild(metric(TEXT.reasoning, viewModel.reasoningEffort));
    grid.appendChild(metric(TEXT.latency, viewModel.avgLatencyText));
    grid.appendChild(metric(TEXT.cacheHit, viewModel.cacheHitRateText));

    var footer = element("div", "companion-footer");
    footer.appendChild(element("span", "companion-balance", viewModel.balanceStatus));
    footer.appendChild(button("companion-open-main", TEXT.open, TEXT.openMain));

    var actions = element("div", "companion-actions");
    actions.appendChild(button("companion-action", state.followCodex ? TEXT.followOn : TEXT.followOff, TEXT.toggleFollow));
    actions.appendChild(button("companion-action", state.locked ? TEXT.locked : TEXT.drag, TEXT.toggleLock));
    actions.appendChild(button("companion-action is-muted", TEXT.hide, TEXT.hide));

    details.appendChild(grid);
    details.appendChild(footer);
    details.appendChild(actions);
    bar.appendChild(compactButton);
    bar.appendChild(closeButton);
    bar.appendChild(details);
    root.appendChild(bar);

    compactButton.addEventListener("click", function () {
      if (state.dragMoved) {
        state.dragMoved = false;
        return;
      }
      setExpanded(state, !state.expanded, true);
    });
    bar.addEventListener("mouseenter", function () {
      setExpanded(state, true, false);
    });
    bar.addEventListener("mouseleave", function () {
      if (!state.pinned) setExpanded(state, false, false);
    });
    bar.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      setExpanded(state, true, true);
    });
    bar.addEventListener("pointerdown", function (event) {
      beginDrag(event, state);
    });
    closeButton.addEventListener("click", function (event) {
      event.stopPropagation();
      hideCompanion(state.api);
    });

    footer.querySelector(".companion-open-main").addEventListener("click", function (event) {
      event.stopPropagation();
      callApi(state.api, ["openMainWindow", "openMain", "companion.openMain"]);
    });
    actions.children[0].addEventListener("click", function (event) {
      event.stopPropagation();
      state.followCodex = !state.followCodex;
      callApi(state.api, ["setCompanionFollowCodex", "companion.setFollowCodex"], [state.followCodex]);
      render(state.root, state);
    });
    actions.children[1].addEventListener("click", function (event) {
      event.stopPropagation();
      state.locked = !state.locked;
      callApi(state.api, ["setCompanionLocked", "companion.setLocked"], [state.locked]);
      render(state.root, state);
    });
    actions.children[2].addEventListener("click", function (event) {
      event.stopPropagation();
      hideCompanion(state.api);
    });
  }

  function setExpanded(state, expanded, pinned) {
    var next = Boolean(expanded);
    if (typeof pinned === "boolean") state.pinned = next && pinned;
    if (state.expanded === next) return;
    state.expanded = next;
    callApi(state.api, ["setCompanionExpanded", "setExpanded", "companion.setExpanded"], [next]);
    render(state.root, state);
  }

  function beginDrag(event, state) {
    if (state.locked || event.button !== 0) return;
    if (event.target.closest("button") && !event.target.closest(".companion-button")) return;
    var startScreenX = event.screenX;
    var startScreenY = event.screenY;
    var startBounds = state.bounds || {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight
    };
    var raf = 0;
    var pendingBounds = null;
    var lastSentAt = 0;

    function flush() {
      raf = 0;
      if (pendingBounds) {
        var now = Date.now();
        if (now - lastSentAt >= 33) {
          lastSentAt = now;
          callApi(state.api, ["setCompanionBounds", "companion.setBounds"], [pendingBounds, { persist: false }]);
        }
      }
    }

    function move(moveEvent) {
      var dx = moveEvent.screenX - startScreenX;
      var dy = moveEvent.screenY - startScreenY;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.dragMoved = true;
      pendingBounds = {
        x: Math.round(startBounds.x + dx),
        y: Math.round(startBounds.y + dy),
        width: startBounds.width || window.outerWidth,
        height: startBounds.height || window.outerHeight
      };
      if (!raf) raf = window.requestAnimationFrame(flush);
    }

    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (pendingBounds) {
        state.bounds = pendingBounds;
        callApi(state.api, ["setCompanionBounds", "companion.setBounds"], [pendingBounds]);
      }
      window.setTimeout(function () {
        state.dragMoved = false;
      }, 0);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function subscribeSnapshots(state) {
    if (!state.api) return null;
    var callback = function (snapshot) {
      setSnapshot(state, snapshot || fallbackSnapshot, true);
    };
    try {
      if (typeof state.api.onSnapshotPush === "function") return state.api.onSnapshotPush(callback);
      if (typeof state.api.on === "function") return state.api.on("relay:snapshot", callback);
    } catch (_) {
      return null;
    }
    return null;
  }

  function cancelSnapshotAnimation(state) {
    if (state.animationFrame) {
      window.cancelAnimationFrame(state.animationFrame);
      state.animationFrame = 0;
    }
  }

  function setSnapshot(state, snapshot, animate) {
    var next = snapshot || fallbackSnapshot;
    state.snapshot = next;
    if (!animate || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      cancelSnapshotAnimation(state);
      state.displaySnapshot = next;
      render(state.root, state);
      return;
    }
    cancelSnapshotAnimation(state);
    var start = state.displaySnapshot || state.snapshot || fallbackSnapshot;
    var startedAt = Date.now();
    var duration = 360;
    function step() {
      var progress = (Date.now() - startedAt) / duration;
      if (progress >= 1) {
        state.displaySnapshot = next;
        state.animationFrame = 0;
        render(state.root, state);
        return;
      }
      state.displaySnapshot = createAnimatedSnapshot(start, next, progress);
      render(state.root, state);
      state.animationFrame = window.requestAnimationFrame(step);
    }
    step();
  }

  function initCompanion() {
    var root = document.getElementById("companion-root");
    if (!root) return;
    var state = {
      api: window.relayMonitor || null,
      bounds: null,
      expanded: false,
      followCodex: true,
      locked: false,
      pinned: false,
      root: root,
      snapshot: fallbackSnapshot,
      displaySnapshot: fallbackSnapshot,
      animationFrame: 0,
      unsubscribe: null
    };

    render(root, state);
    state.unsubscribe = subscribeSnapshots(state);
    callApi(state.api, ["getCompanionState", "companion.getState"]).then(function (companionState) {
      if (isObject(companionState)) {
        state.bounds = companionState.bounds || state.bounds;
        state.expanded = Boolean(companionState.expanded);
        state.followCodex = companionState.followCodex !== false;
        state.locked = Boolean(companionState.locked);
        render(root, state);
      }
    });
    callApi(state.api, ["getSnapshot", "relay.getSnapshot"]).then(function (snapshot) {
      if (snapshot) {
        setSnapshot(state, snapshot, true);
      }
    });
    window.addEventListener("beforeunload", function () {
      cancelSnapshotAnimation(state);
      if (typeof state.unsubscribe === "function") state.unsubscribe();
    });
  }

  return {
    createCompanionViewModel: createCompanionViewModel,
    createAnimatedSnapshot: createAnimatedSnapshot,
    formatCompactMoney: formatCompactMoney,
    formatCompactToken: formatCompactToken,
    hideCompanion: hideCompanion,
    initCompanion: initCompanion
  };
});
