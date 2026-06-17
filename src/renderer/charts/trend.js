(function () {
  "use strict";

  var ui = window.RelayMonitorUI;
  var svgCounter = 0;

  function normalizeSeries(points) {
    var fallbackLabels = ["周三", "周四", "周五", "周六", "周日", "周一", "今天"];
    var source = Array.isArray(points) && points.length ? points : fallbackLabels.map(function (label) {
      return { label: label, value: 0, tokens: 0 };
    });
    return source.slice(-7).map(function (point, index) {
      if (typeof point === "number") {
        return { label: fallbackLabels[index] || String(index + 1), value: point };
      }
      return {
        label: point.label || point.day || point.date || fallbackLabels[index] || String(index + 1),
        value: ui.toNumber(point.value != null ? point.value : point.tokens != null ? point.tokens : point.total, 0),
        input: ui.toNumber(point.input, 0),
        output: ui.toNumber(point.output, 0),
        cached: ui.toNumber(point.cached, 0)
      };
    });
  }

  function pointPath(points) {
    return points.map(function (point, index) {
      return (index === 0 ? "M" : "L") + point.x.toFixed(2) + " " + point.y.toFixed(2);
    }).join(" ");
  }

  function areaPath(points, height, padding) {
    if (!points.length) return "";
    var baseline = height - padding.bottom;
    return pointPath(points) + " L " + points[points.length - 1].x.toFixed(2) + " " + baseline + " L " + points[0].x.toFixed(2) + " " + baseline + " Z";
  }

  function buildTrendSvg(points, options) {
    var series = normalizeSeries(points);
    var settings = options || {};
    svgCounter += 1;
    var areaId = "trendArea" + svgCounter;
    var width = settings.width || 680;
    var height = settings.height || 260;
    var padding = { top: 18, right: 18, bottom: 34, left: 44 };
    var max = Math.max.apply(null, series.map(function (point) { return point.value; }).concat([1]));
    var min = Math.min.apply(null, series.map(function (point) { return point.value; }).concat([0]));
    var range = Math.max(max - min, 1);
    var innerWidth = width - padding.left - padding.right;
    var innerHeight = height - padding.top - padding.bottom;
    var mapped = series.map(function (point, index) {
      var x = padding.left + (series.length === 1 ? innerWidth / 2 : (innerWidth / (series.length - 1)) * index);
      var y = padding.top + innerHeight - ((point.value - min) / range) * innerHeight;
      return Object.assign({}, point, { x: x, y: y });
    });
    var lines = [0, 1, 2, 3].map(function (step) {
      var y = padding.top + (innerHeight / 3) * step;
      return '<line class="trend-grid" x1="' + padding.left + '" x2="' + (width - padding.right) + '" y1="' + y.toFixed(2) + '" y2="' + y.toFixed(2) + '"></line>';
    }).join("");
    var labels = mapped.map(function (point) {
      return '<text class="trend-label" x="' + point.x.toFixed(2) + '" y="' + (height - 10) + '" text-anchor="middle">' + ui.escapeHtml(String(point.label).slice(0, 5)) + "</text>";
    }).join("");
    var pointNodes = mapped.map(function (point) {
      return '<circle class="trend-point" cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="4"><title>' + ui.escapeHtml(point.label + " · " + ui.formatCompactNumber(point.value)) + "</title></circle>";
    }).join("");
    var yAxis = [
      '<text class="trend-axis" x="10" y="' + (padding.top + 4) + '">' + ui.escapeHtml(ui.formatCompactNumber(max)) + "</text>",
      '<text class="trend-axis" x="10" y="' + (height - padding.bottom) + '">' + ui.escapeHtml(ui.formatCompactNumber(min)) + "</text>"
    ].join("");

    return [
      '<svg class="trend-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + ui.escapeHtml(settings.label || "七天趋势") + '" preserveAspectRatio="none">',
      "<defs>",
      '<linearGradient id="' + areaId + '" x1="0" x2="0" y1="0" y2="1">',
      '<stop offset="0%" stop-color="#f29ab3" stop-opacity="0.34"></stop>',
      '<stop offset="56%" stop-color="#8bd8ca" stop-opacity="0.17"></stop>',
      '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"></stop>',
      "</linearGradient>",
      "</defs>",
      lines,
      yAxis,
      '<path class="trend-area" fill="url(#' + areaId + ')" d="' + areaPath(mapped, height, padding) + '"></path>',
      '<path class="trend-line" d="' + pointPath(mapped) + '"></path>',
      pointNodes,
      labels,
      "</svg>"
    ].join("");
  }

  function buildMiniTrendSvg(points, label) {
    var series = normalizeSeries(points);
    var width = 260;
    var height = 44;
    var max = Math.max.apply(null, series.map(function (point) { return point.value; }).concat([1]));
    var min = Math.min.apply(null, series.map(function (point) { return point.value; }).concat([0]));
    var range = Math.max(max - min, 1);
    var mapped = series.map(function (point, index) {
      return {
        x: series.length === 1 ? width / 2 : (width / (series.length - 1)) * index,
        y: height - 5 - ((point.value - min) / range) * (height - 10)
      };
    });
    return [
      '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + ui.escapeHtml(label || "模型趋势") + '" preserveAspectRatio="none">',
      '<path d="' + pointPath(mapped) + '" fill="none" stroke="#e99cb1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>',
      "</svg>"
    ].join("");
  }

  window.RelayMonitorTrend = {
    buildMiniTrendSvg: buildMiniTrendSvg,
    buildTrendSvg: buildTrendSvg,
    normalizeSeries: normalizeSeries
  };
})();
