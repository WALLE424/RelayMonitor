'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'relay:getSnapshot',
  'relay:refreshBalance',
  'relay:getSettings',
  'relay:updateSettings',
  'balance:openLogin',
  'balance:openExternalLogin',
  'balance:getLoginStatus',
  'balance:diagnose',
  'app:openUserData',
  'window:minimize',
  'window:hide',
  'window:close',
  'window:openMain',
  'companion:show',
  'companion:hide',
  'companion:toggle',
  'companion:getState',
  'companion:setBounds',
  'companion:setExpanded',
  'companion:setLocked',
  'companion:setFollowCodex',
  'module:toggle',
  'module:close',
  'module:getState',
]);

const EVENT_CHANNELS = new Set([
  'relay:snapshot',
  'relay:settings',
  'relay:modules',
  'relay:error',
]);

function invoke(channel, ...args) {
  if (!INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Blocked IPC invoke channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function on(channel, callback) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC event channel: ${channel}`);
  }
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (_) {
      // Renderer callback errors should not break the bridge.
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('relayMonitor', {
  getSnapshot: () => invoke('relay:getSnapshot'),
  refreshBalance: () => invoke('relay:refreshBalance'),
  getSettings: () => invoke('relay:getSettings'),
  updateSettings: (patch) => invoke('relay:updateSettings', patch),
  openBalanceLogin: () => invoke('balance:openLogin'),
  openExternalBalancePage: () => invoke('balance:openExternalLogin'),
  getBalanceLoginStatus: () => invoke('balance:getLoginStatus'),
  diagnoseBalance: () => invoke('balance:diagnose'),
  setCloseButtonBehavior: (behavior) => invoke('relay:updateSettings', { closeButtonBehavior: behavior }),
  openUserData: () => invoke('app:openUserData'),
  minimize: () => invoke('window:minimize'),
  hide: () => invoke('window:hide'),
  close: () => invoke('window:close'),
  openMainWindow: () => invoke('window:openMain'),
  showCompanion: () => invoke('companion:show'),
  hideCompanion: () => invoke('companion:hide'),
  toggleCompanion: () => invoke('companion:toggle'),
  getCompanionState: () => invoke('companion:getState'),
  setCompanionBounds: (bounds, options) => invoke('companion:setBounds', bounds, options),
  setCompanionExpanded: (expanded) => invoke('companion:setExpanded', expanded),
  setCompanionLocked: (locked) => invoke('companion:setLocked', locked),
  setCompanionFollowCodex: (enabled) => invoke('companion:setFollowCodex', enabled),
  toggleModuleWindow: (moduleId) => invoke('module:toggle', moduleId),
  closeModuleWindow: (moduleId) => invoke('module:close', moduleId),
  getModuleWindowState: () => invoke('module:getState'),
  onSnapshotPush: (callback) => on('relay:snapshot', callback),
  onSettingsPush: (callback) => on('relay:settings', callback),
  onModuleStatePush: (callback) => on('relay:modules', callback),
  onError: (callback) => on('relay:error', callback),
});
