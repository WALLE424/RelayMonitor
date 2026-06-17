'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildTrayMenuTemplate, trayPngPath } = require('../../src/main/tray');

test('buildTrayMenuTemplate returns Chinese tray controls with stable actions', () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    toggleWindow: () => calls.push('toggle'),
    minimizeWindow: () => calls.push('minimize'),
    quitApp: () => calls.push('quit'),
  });

  assert.deepEqual(template.map((item) => item.type || item.label), [
    '显示/隐藏窗口',
    '最小化窗口',
    'separator',
    '退出程序',
  ]);

  template[0].click();
  template[1].click();
  template[3].click();

  assert.deepEqual(calls, ['toggle', 'minimize', 'quit']);
});

test('trayPngPath prefers a stable small PNG beside the window icon', () => {
  assert.equal(
    trayPngPath(path.join('E:', 'RelayMonitor', 'src', 'assets', 'icons', 'app-icon.ico')),
    path.join('E:', 'RelayMonitor', 'src', 'assets', 'icons', 'app-icon-32.png'),
  );
});
