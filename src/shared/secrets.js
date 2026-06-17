'use strict';

function maskSecret(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  const start = options.start ?? 3;
  const end = options.end ?? 4;
  if (text.length <= start + end + 4) return 'configured';

  const prefix = text.slice(0, start);
  const separator = /[-_]$/.test(prefix) ? '' : '-';
  return `${prefix}${separator}${'\u2022'.repeat(12)}${text.slice(-end).toUpperCase()}`;
}

function previewSecret(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  const start = options.start ?? 5;
  const end = options.end ?? 4;
  if (text.length <= start + end + 3) return 'configured';
  return `${text.slice(0, start)}...${text.slice(-end).toUpperCase()}`;
}

module.exports = { maskSecret, previewSecret };
