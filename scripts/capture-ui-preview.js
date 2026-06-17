'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { applyBalanceProviderProfile, normalizeSettings } = require('../src/main/ipc');
const { getRelaySnapshot } = require('../src/relay/snapshot');

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

function readSettings() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  const files = [
    path.join(appData, '\u4e2d\u8f6c\u7ad9\u76d1\u63a7', 'settings.json'),
    path.join(app.getPath('userData'), 'settings.json'),
    path.join(appData, 'relay-monitor', 'settings.json'),
  ];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (_) {
      // Try the next known settings location.
    }
  }
  return normalizeSettings();
}

function balanceSettingsSignature(settings = {}) {
  return JSON.stringify({
    mode: settings.balanceAcquisitionMode || 'auto-api',
    manualAmount: settings.balanceManualAmount ?? null,
    pageUrl: settings.balancePageUrl || '',
    selector: settings.balanceSelector || '',
  });
}

async function readSnapshot(settings) {
  return getRelaySnapshot({
    settings,
    relayOptions: { dbPath: settings.ccswitchDbPath, recentLimit: 80, requestDailyLimit: 366 },
    balanceOptions: {
      enabled: (settings.balanceAcquisitionMode || 'auto-api') === 'auto-api',
      manualAmount: settings.balanceManualAmount,
      mode: settings.balanceAcquisitionMode || 'auto-api',
      pageUrl: settings.balancePageUrl,
      selector: settings.balanceSelector,
      timeoutMs: 2500,
    },
  });
}

async function readProfiledSnapshot(settings) {
  const firstSnapshot = await readSnapshot(settings);
  const effectiveSettings = applyBalanceProviderProfile(settings, firstSnapshot);
  if (balanceSettingsSignature(effectiveSettings) === balanceSettingsSignature(settings)) {
    return { settings, snapshot: firstSnapshot };
  }
  return {
    settings: effectiveSettings,
    snapshot: await readSnapshot(effectiveSettings),
  };
}

function writeSnapshotSummary(snapshot, settings) {
  const outputPath = path.join(__dirname, '..', 'docs', 'ui-preview', 'relay-monitor-v2-current-snapshot.json');
  const summary = {
    capturedAt: new Date().toISOString(),
    balanceMode: settings.balanceAcquisitionMode,
    provider: {
      name: snapshot.provider?.name || '',
      baseUrl: snapshot.provider?.baseUrl ? 'hidden-for-docs' : '',
      model: snapshot.provider?.model || '',
      reasoningEffort: snapshot.provider?.reasoningEffort || '',
    },
    balance: {
      status: snapshot.balance?.status || 'unknown',
      amount: snapshot.balance?.amount ?? null,
      source: snapshot.balance?.source || '',
      endpoint: snapshot.balance?.endpoint ? 'hidden-for-docs' : '',
    },
    tokens: snapshot.tokens || {},
    spend: snapshot.spend || {},
    trendFlat: Array.isArray(snapshot.trend7d)
      ? new Set(snapshot.trend7d.map((point) => Number(point.value || 0))).size <= 1
      : null,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return outputPath;
}

function cloneForDocs(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sanitizeSnapshotForDocs(snapshot) {
  const safe = cloneForDocs(snapshot);
  if (safe.provider) {
    safe.provider.baseUrl = '';
    safe.provider.endpoint = '';
  }
  if (safe.currentRelay) safe.currentRelay.endpoint = '';
  if (safe.relay) safe.relay.endpoint = '';
  safe.endpoint = '';
  return safe;
}

async function captureWindow({ fileName, width, height, url, initScript }) {
  const outputPath = path.join(__dirname, '..', 'docs', 'ui-preview', fileName);
  const preloadPath = initScript ? path.join(__dirname, '..', 'tmp', 'capture-preview-preload.js') : '';
  if (initScript) {
    fs.mkdirSync(path.dirname(preloadPath), { recursive: true });
    fs.writeFileSync(preloadPath, initScript, 'utf8');
  }
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath || undefined,
    },
  });
  const targetUrl = fileUrl(url.file, url.query || url.options?.query || {});
  await window.loadURL(targetUrl);
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1200);
    timer.unref?.();
  });
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  window.destroy();
  return outputPath;
}

function writeModulePreviewHtml(rendererDir, moduleId) {
  const template = fs.readFileSync(path.join(rendererDir, 'module.html'), 'utf8');
  const previewDir = path.join(__dirname, '..', 'tmp', 'ui-preview');
  const previewPath = path.join(previewDir, `module-${moduleId}.html`);
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(previewPath, template.replace(
    '<script src="./module-window.js"></script>',
    `<script>window.history.replaceState(null, "", "?module=${moduleId}");</script>\n    <script src="../../src/renderer/module-window.js"></script>`,
  ).replaceAll('./styles/', '../../src/renderer/styles/')
    .replaceAll('./components/', '../../src/renderer/components/')
    .replaceAll('./charts/', '../../src/renderer/charts/')
    .replaceAll('./views/', '../../src/renderer/views/'), 'utf8');
  return previewPath;
}

function fileUrl(filePath, query = {}) {
  const url = new URL(`file:///${path.resolve(filePath).replace(/\\/g, '/')}`);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function relayApiScript(snapshot, settings) {
  const safeSnapshot = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  const safeSettings = JSON.stringify(settings).replace(/</g, '\\u003c');
  return `
    window.relayMonitor = {
      getSnapshot: () => Promise.resolve(${safeSnapshot}),
      refreshBalance: () => Promise.resolve(${safeSnapshot}),
      getSettings: () => Promise.resolve(${safeSettings}),
      updateSettings: () => Promise.resolve(${safeSettings}),
      getModuleWindowState: () => Promise.resolve({}),
      toggleModuleWindow: () => Promise.resolve({ visible: false }),
      closeModuleWindow: () => Promise.resolve(true),
      getBalanceLoginStatus: () => Promise.resolve({ status: 'preview', hasLoginState: false }),
      diagnoseBalance: () => Promise.resolve({ status: 'preview' }),
      onSnapshotPush: () => () => {},
      onSettingsPush: () => () => {},
      onModuleStatePush: () => () => {},
      onError: () => () => {},
      getCompanionState: () => Promise.resolve({ visible: true, expanded: true, followCodex: true, locked: false, bounds: { x: 0, y: 0, width: 326, height: 164 } }),
      setCompanionBounds: () => Promise.resolve({ visible: true }),
      setCompanionExpanded: () => Promise.resolve({ visible: true, expanded: true }),
      setCompanionLocked: () => Promise.resolve({ visible: true, locked: false }),
      setCompanionFollowCodex: () => Promise.resolve({ visible: true, followCodex: true }),
      openMainWindow: () => Promise.resolve(true),
      hideCompanion: () => Promise.resolve(true),
      minimize: () => Promise.resolve(true),
      hide: () => Promise.resolve(true),
      close: () => Promise.resolve(true)
    };
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".dashboard-provider-lines span:nth-child(2){display:none!important}";
      document.head.appendChild(style);
    });
  `;
}

async function main() {
  await app.whenReady();
  const result = await readProfiledSnapshot(readSettings());
  const settings = result.settings;
  const snapshot = result.snapshot;
  const snapshotSummary = writeSnapshotSummary(snapshot, settings);
  const previewSnapshot = sanitizeSnapshotForDocs(snapshot);
  const initScript = relayApiScript(previewSnapshot, settings);
  const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
  const tokenPreviewHtml = writeModulePreviewHtml(rendererDir, 'tokens');
  const captures = [];
  captures.push(await captureWindow({
    fileName: 'relay-monitor-v2-current-screen.png',
    width: 418,
    height: 548,
    url: { file: path.join(rendererDir, 'index.html') },
    initScript,
  }));
  captures.push(await captureWindow({
    fileName: 'relay-monitor-v2-current-tokens-module.png',
    width: 420,
    height: 380,
    url: { file: tokenPreviewHtml },
    initScript,
  }));
  captures.push(await captureWindow({
    fileName: 'relay-monitor-v2-current-companion.png',
    width: 380,
    height: 230,
    url: { file: path.join(rendererDir, 'companion.html') },
    initScript,
  }));
  console.log(JSON.stringify({ captures, snapshotSummary }, null, 2));
  app.quit();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.quit();
  process.exitCode = 1;
});
