'use strict';

const { BrowserWindow, nativeImage, nativeTheme, screen } = require('electron');

const MODULE_WINDOW_SIZES = {
  api: { width: 380, height: 320 },
  requests: { width: 520, height: 360 },
  tokens: { width: 380, height: 320 },
  balance: { width: 380, height: 320 },
  cache: { width: 380, height: 320 },
  settings: { width: 520, height: 640 },
};

const MAIN_WINDOW_SIZE = {
  width: 418,
  height: 548,
  minWidth: 360,
  minHeight: 460,
  maxWidth: 720,
  maxHeight: 920,
};

function coerceBounds(bounds, defaults) {
  const width = Number.isFinite(bounds?.width)
    ? Math.min(defaults.maxWidth || 1200, Math.max(defaults.minWidth || 320, Math.round(bounds.width)))
    : defaults.width;
  const height = Number.isFinite(bounds?.height)
    ? Math.min(defaults.maxHeight || 1200, Math.max(defaults.minHeight || 220, Math.round(bounds.height)))
    : defaults.height;
  return {
    width,
    height,
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : null,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : null,
  };
}

function workAreaPoint(width, height, offsetX = 24, offsetY = 72) {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + offsetX,
    y: workArea.y + Math.min(offsetY, Math.max(12, workArea.height - height - 12)),
  };
}

function restoreAndFocusWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function resolveWindowIcon(appIconPath) {
  if (!appIconPath) return undefined;
  const image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) return appIconPath;
  image.setTemplateImage(false);
  return image;
}

function applyWindowIcon(window, appIconPath) {
  if (!window || window.isDestroyed?.()) return;
  const image = resolveWindowIcon(appIconPath);
  if (!image) return;
  try {
    window.setIcon(image);
  } catch (_) {
    // BrowserWindow constructor icon already covers platforms that don't expose setIcon.
  }
}

function createMainWindow({
  appIconPath,
  preloadPath,
  rendererPath,
  smokeMode = false,
  getCloseButtonBehavior = () => 'hide-to-tray',
  initialBounds = null,
  isQuitting = () => false,
}) {
  const bounds = coerceBounds(initialBounds, MAIN_WINDOW_SIZE);
  const { width, height } = bounds;
  const point = workAreaPoint(width, height, 24, 72);
  const windowIcon = resolveWindowIcon(appIconPath);
  const window = new BrowserWindow({
    width,
    height,
    minWidth: MAIN_WINDOW_SIZE.minWidth,
    minHeight: MAIN_WINDOW_SIZE.minHeight,
    maxWidth: MAIN_WINDOW_SIZE.maxWidth,
    maxHeight: MAIN_WINDOW_SIZE.maxHeight,
    x: Number.isFinite(bounds.x) ? bounds.x : point.x,
    y: Number.isFinite(bounds.y) ? bounds.y : point.y,
    show: !smokeMode,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: windowIcon || appIconPath,
    title: '\u4e2d\u8f6c\u7ad9\u76d1\u63a7',
    titleBarStyle: 'hidden',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    resizable: true,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });
  applyWindowIcon(window, appIconPath);

  window.once('ready-to-show', () => {
    if (!smokeMode) window.show();
  });

  if (smokeMode) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        window.forceClose = true;
        window.close();
      }, 700);
    });
  }

  window.on('close', (event) => {
    if (smokeMode || window.forceClose || isQuitting()) return;
    if (getCloseButtonBehavior() === 'quit') {
      window.forceClose = true;
      return;
    }
    event.preventDefault();
    window.hide();
  });

  window.loadFile(rendererPath);

  try {
    nativeTheme.themeSource = 'light';
  } catch (_) {
    // Non-critical. The renderer owns the final color system.
  }

  return window;
}

function createModuleWindow({
  appIconPath,
  preloadPath,
  modulePath,
  moduleId,
  smokeMode = false,
  initialBounds = null,
  isQuitting = () => false,
}) {
  const size = MODULE_WINDOW_SIZES[moduleId] || { width: 360, height: 280 };
  const minimum = MODULE_WINDOW_SIZES.balance;
  const limits = {
    ...size,
    minWidth: minimum.width,
    minHeight: minimum.height,
    maxWidth: 980,
    maxHeight: 900,
  };
  const bounds = coerceBounds(initialBounds, limits);
  const point = workAreaPoint(size.width, size.height, 468, 96);
  const windowIcon = resolveWindowIcon(appIconPath);
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
    x: Number.isFinite(bounds.x) ? bounds.x : point.x,
    y: Number.isFinite(bounds.y) ? bounds.y : point.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: windowIcon || appIconPath,
    title: `Relay Monitor ${moduleId}`,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });
  applyWindowIcon(window, appIconPath);

  window.setAlwaysOnTop(true, 'floating');

  window.on('close', (event) => {
    if (smokeMode || window.forceClose || isQuitting()) return;
    event.preventDefault();
    window.hide();
  });

  window.loadFile(modulePath, { query: { module: moduleId } });
  return window;
}

function createCompanionWindow({
  appIconPath,
  preloadPath,
  companionPath,
  smokeMode = false,
  initialBounds = null,
  isQuitting = () => false,
}) {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Number.isFinite(initialBounds?.width)
    ? Math.min(380, Math.max(286, Math.round(initialBounds.width)))
    : 326;
  const height = Number.isFinite(initialBounds?.height)
    ? Math.min(190, Math.max(44, Math.round(initialBounds.height)))
    : 48;
  const x = Number.isFinite(initialBounds?.x)
    ? initialBounds.x
    : workArea.x + workArea.width - width - 24;
  const y = Number.isFinite(initialBounds?.y)
    ? initialBounds.y
    : workArea.y + 18;
  const windowIcon = resolveWindowIcon(appIconPath);

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 286,
    minHeight: 44,
    maxWidth: 380,
    maxHeight: 190,
    x,
    y,
    show: !smokeMode,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: windowIcon || appIconPath,
    title: 'Relay Monitor \u60ac\u6d6e\u6761',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });
  applyWindowIcon(window, appIconPath);

  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(false);

  window.on('close', (event) => {
    if (smokeMode || window.forceClose || isQuitting()) return;
    event.preventDefault();
    window.hide();
  });

  window.loadFile(companionPath);
  return window;
}

module.exports = {
  createCompanionWindow,
  createMainWindow,
  createModuleWindow,
  MODULE_WINDOW_SIZES,
  restoreAndFocusWindow,
};
