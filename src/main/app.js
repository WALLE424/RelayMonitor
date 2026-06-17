'use strict';

const path = require('node:path');
const { app } = require('electron');
const {
  createCompanionWindow,
  createMainWindow,
  createModuleWindow,
  restoreAndFocusWindow,
} = require('./windows');
const { createTray, destroyTray } = require('./tray');
const { registerIpc } = require('./ipc');

let mainWindow = null;
let companionWindow = null;
const moduleWindows = new Map();
let tray = null;
let ipcController = null;
let isAppQuitting = false;
const smokeMode = process.argv.includes('--smoke');

function windowOptions() {
  return {
    preloadPath: path.join(__dirname, '..', 'preload', 'index.js'),
    rendererPath: path.join(__dirname, '..', 'renderer', 'index.html'),
    companionPath: path.join(__dirname, '..', 'renderer', 'companion.html'),
    modulePath: path.join(__dirname, '..', 'renderer', 'module.html'),
    appIconPath: path.join(__dirname, '..', 'assets', 'icons', 'app-icon.ico'),
    smokeMode,
    getCloseButtonBehavior,
    isQuitting: () => isAppQuitting,
  };
}

function isSupportedModule(moduleId) {
  return ['api', 'requests', 'tokens', 'balance', 'cache', 'settings'].includes(moduleId);
}

function getCloseButtonBehavior() {
  return ipcController?.getSettings?.().closeButtonBehavior || 'hide-to-tray';
}

function createOrGetMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  if (!app.isReady()) return null;

  const window = createMainWindow({
    ...windowOptions(),
    initialBounds: ipcController?.getSettings?.().mainWindowBounds || null,
  });
  mainWindow = window;
  attachWindowBoundsPersistence(window, () => {
    ipcController?.updateMainWindowBounds?.(window.getBounds());
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function createOrGetCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    return companionWindow;
  }
  if (!app.isReady() || smokeMode) return null;

  const bounds = ipcController?.getSettings?.().companionBounds || null;
  const window = createCompanionWindow({
    ...windowOptions(),
    initialBounds: bounds,
  });
  companionWindow = window;
  window.on('closed', () => {
    if (companionWindow === window) companionWindow = null;
  });
  return window;
}

function createOrGetModuleWindow(moduleId, initialBounds = null) {
  if (!isSupportedModule(moduleId)) return null;
  const existing = moduleWindows.get(moduleId);
  if (existing && !existing.isDestroyed()) {
    return existing;
  }
  if (!app.isReady() || smokeMode) return null;

  const window = createModuleWindow({
    ...windowOptions(),
    moduleId,
    initialBounds,
  });
  moduleWindows.set(moduleId, window);
  attachWindowBoundsPersistence(window, () => {
    ipcController?.updateModuleWindowBounds?.(moduleId, window.getBounds());
  });
  window.on('closed', () => {
    if (moduleWindows.get(moduleId) === window) {
      moduleWindows.delete(moduleId);
    }
  });
  return window;
}

function attachWindowBoundsPersistence(window, saveBounds) {
  if (!window || typeof saveBounds !== 'function') return;
  let timer = null;
  const schedule = () => {
    if (smokeMode || window.isDestroyed()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!window.isDestroyed()) saveBounds();
    }, 350);
    timer.unref?.();
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    if (!smokeMode && !window.isDestroyed()) saveBounds();
  });
}

function restoreMainWindow() {
  const window = createOrGetMainWindow();
  restoreAndFocusWindow(window);
}

function showCompanionWindow() {
  const window = createOrGetCompanionWindow();
  if (!window || window.isDestroyed()) return null;
  window.showInactive?.();
  window.setAlwaysOnTop(true, 'floating');
  return window;
}

function hideCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.hide();
  }
}

function getModuleWindow(moduleId) {
  const window = moduleWindows.get(moduleId);
  return window && !window.isDestroyed() ? window : null;
}

function getModuleWindows() {
  return Object.fromEntries(Array.from(moduleWindows.entries()).filter(([, window]) => window && !window.isDestroyed()));
}

function closeModuleWindow(moduleId) {
  const window = getModuleWindow(moduleId);
  if (!window) return false;
  window.hide();
  return true;
}

function toggleModuleWindow(moduleId, initialBounds = null) {
  const window = createOrGetModuleWindow(moduleId, initialBounds);
  if (!window) return { id: moduleId, visible: false };
  const wasVisible = window.isVisible();
  if (wasVisible) {
    const bounds = window.getBounds();
    window.hide();
    return { id: moduleId, visible: false, bounds };
  }
  window.show();
  window.focus();
  return { id: moduleId, visible: true, bounds: window.getBounds() };
}

function quitApp() {
  isAppQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.forceClose = true;
  }
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.forceClose = true;
  }
  for (const window of moduleWindows.values()) {
    if (window && !window.isDestroyed()) {
      window.forceClose = true;
    }
  }
  app.quit();
}

function ensureTray() {
  if (smokeMode) return null;
  if (tray && !tray.isDestroyed?.()) return tray;
  tray = createTray({
    app,
    iconPath: windowOptions().appIconPath,
    getMainWindow: () => mainWindow,
    quitApp,
  });
  return tray;
}

function gotSingleInstanceLock() {
  const lock = app.requestSingleInstanceLock();
  if (!lock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (!app.isReady()) {
      app.once('ready', restoreMainWindow);
      return;
    }
    restoreMainWindow();
  });
  return true;
}

async function boot() {
  if (!gotSingleInstanceLock()) return;

  app.setName('\u4e2d\u8f6c\u7ad9\u76d1\u63a7');
  app.setAppUserModelId('com.walle.relaymonitor');
  await app.whenReady();

  ipcController = registerIpc({
    app,
    getMainWindow: () => mainWindow,
    getCompanionWindow: () => companionWindow,
    getModuleWindow,
    getModuleWindows,
    toggleModuleWindow,
    closeModuleWindow,
    showCompanionWindow,
    hideCompanionWindow,
    restoreMainWindow,
  });

  createOrGetMainWindow();

  const settings = ipcController?.getSettings?.();
  if (!smokeMode && settings?.companionVisible !== false) {
    showCompanionWindow();
  }

  ensureTray();

  app.on('activate', () => {
    restoreMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (smokeMode || isAppQuitting || getCloseButtonBehavior() === 'quit') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.forceClose = true;
  }
  for (const window of moduleWindows.values()) {
    if (window && !window.isDestroyed()) {
      window.forceClose = true;
    }
  }
  moduleWindows.clear();
  ipcController?.dispose?.();
  ipcController = null;
  destroyTray();
  tray = null;
});

boot().catch((error) => {
  console.error(error);
  app.quit();
});
