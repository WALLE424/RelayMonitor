'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

let trayInstance = null;

function createFallbackIcon() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="8" fill="#0f1720"/>',
    '<path d="M8 20L14 8h10l-6 8h6L12 28l4-8H8z" fill="#63d7ff"/>',
    '</svg>',
  ].join('');
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function trayPngPath(iconPath) {
  if (!iconPath) return '';
  return path.join(path.dirname(iconPath), 'app-icon-32.png');
}

function createTrayIcon(iconPath) {
  const pngPath = trayPngPath(iconPath);
  if (pngPath && fs.existsSync(pngPath)) {
    const image = nativeImage.createFromPath(pngPath);
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  }
  if (iconPath && fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  }
  return createFallbackIcon();
}

function restoreAndFocusWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function buildTrayMenuTemplate({ toggleWindow, minimizeWindow, quitApp }) {
  return [
    { label: '显示/隐藏窗口', click: toggleWindow },
    { label: '最小化窗口', click: minimizeWindow },
    { type: 'separator' },
    { label: '退出程序', click: quitApp },
  ];
}

function createTray({ app, iconPath, getMainWindow, quitApp }) {
  if (trayInstance && !trayInstance.isDestroyed?.()) {
    return trayInstance;
  }

  const tray = new Tray(createTrayIcon(iconPath));
  trayInstance = tray;
  tray.setToolTip('中转站监控');

  const toggleWindow = () => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isVisible()) {
      window.hide();
      return;
    }
    restoreAndFocusWindow(window);
  };

  const minimizeWindow = () => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.minimize();
  };

  const exitApp = () => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.forceClose = true;
    if (quitApp) {
      quitApp();
      return;
    }
    app.quit();
  };

  tray.on('click', toggleWindow);
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    toggleWindow,
    minimizeWindow,
    quitApp: exitApp,
  })));

  return tray;
}

function destroyTray() {
  if (trayInstance && !trayInstance.isDestroyed?.()) {
    trayInstance.destroy();
  }
  trayInstance = null;
}

module.exports = {
  buildTrayMenuTemplate,
  createTray,
  destroyTray,
  trayPngPath,
};
