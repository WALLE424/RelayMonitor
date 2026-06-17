(function () {
  "use strict";

  function toNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(value) {
    var amount = toNumber(value, 0);
    return "\u00a5" + new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: amount >= 100 ? 1 : 2,
      minimumFractionDigits: amount >= 100 ? 1 : 2
    }).format(amount);
  }

  function formatCompactNumber(value) {
    var number = toNumber(value, 0);
    return new Intl.NumberFormat("zh-CN", {
      notation: Math.abs(number) >= 10000 ? "compact" : "standard",
      maximumFractionDigits: 1
    }).format(number);
  }

  function formatPercent(value) {
    var number = toNumber(value, 0);
    var normalized = number > 1 ? number : number * 100;
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 1
    }).format(normalized) + "%";
  }

  function formatDateTime(value) {
    if (!value) return "\u521a\u521a";
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDurationMs(value) {
    var ms = toNumber(value, 0);
    if (ms >= 1000) {
      return new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: ms >= 10000 ? 0 : 1
      }).format(ms / 1000) + " \u79d2";
    }
    return Math.round(ms) + " ms";
  }

  function metricCard(options) {
    var className = ["metric-card", "glass-panel", options.tone ? "is-" + options.tone : ""].filter(Boolean).join(" ");
    return [
      '<article class="' + className + '">',
      '<div class="metric-label"><span class="text-clip">' + escapeHtml(options.label) + '</span>' + (options.badge || "") + "</div>",
      '<div class="metric-value" title="' + escapeHtml(options.value) + '">' + escapeHtml(options.value) + "</div>",
      '<div class="metric-sub" title="' + escapeHtml(options.sub || "") + '">' + escapeHtml(options.sub || "") + "</div>",
      "</article>"
    ].join("");
  }

  function statusPill(label, active) {
    return [
      '<span class="status-pill">',
      '<span class="status-dot" style="background:' + (active === false ? "var(--accent-warm)" : "var(--accent)") + '"></span>',
      '<span class="text-clip">' + escapeHtml(label) + "</span>",
      "</span>"
    ].join("");
  }

  function gauge(label, value, sub, tone) {
    var percent = clamp(toNumber(value, 0), 0, 100);
    var color = tone === "danger" ? "var(--accent-danger)" : tone === "warm" ? "var(--accent-warm)" : "var(--accent)";
    return [
      '<div class="gauge-stack">',
      '<div class="gauge-head"><span class="text-clip">' + escapeHtml(label) + '</span><span class="gauge-value">' + formatPercent(percent) + "</span></div>",
      '<div class="gauge-track"><span class="gauge-fill" style="width:' + percent + "%;background:" + color + '"></span></div>',
      '<div class="metric-sub">' + escapeHtml(sub || "") + "</div>",
      "</div>"
    ].join("");
  }

  function splitBar(label, value, max) {
    var width = max > 0 ? clamp((toNumber(value, 0) / max) * 100, 0, 100) : 0;
    return [
      '<div class="split-row">',
      '<span class="request-cell">' + escapeHtml(label) + "</span>",
      '<span class="split-track"><span class="split-fill" style="width:' + width + '%"></span></span>',
      '<span class="request-cell" title="' + escapeHtml(value) + '">' + escapeHtml(formatCompactNumber(value)) + "</span>",
      "</div>"
    ].join("");
  }

  function getPath(source, paths, fallback) {
    if (!source) return fallback;
    for (var i = 0; i < paths.length; i += 1) {
      var path = paths[i].split(".");
      var cursor = source;
      var matched = true;
      for (var j = 0; j < path.length; j += 1) {
        if (cursor == null || !Object.prototype.hasOwnProperty.call(cursor, path[j])) {
          matched = false;
          break;
        }
        cursor = cursor[path[j]];
      }
      if (matched && cursor != null) return cursor;
    }
    return fallback;
  }

  function normalizePercent(value, fallback) {
    var number = toNumber(value, fallback);
    return number <= 1 ? number * 100 : number;
  }

  window.RelayMonitorUI = {
    clamp: clamp,
    escapeHtml: escapeHtml,
    formatCompactNumber: formatCompactNumber,
    formatCurrency: formatCurrency,
    formatDurationMs: formatDurationMs,
    formatDateTime: formatDateTime,
    formatPercent: formatPercent,
    gauge: gauge,
    getPath: getPath,
    metricCard: metricCard,
    normalizePercent: normalizePercent,
    splitBar: splitBar,
    statusPill: statusPill,
    toNumber: toNumber
  };
})();
