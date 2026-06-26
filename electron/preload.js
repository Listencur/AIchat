'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * preload.js — 通过 contextBridge 向渲染进程暴露安全的 API。
 * 渲染进程通过 window.api 调用，无法直接访问 Node.js / Electron 内部模块。
 */
contextBridge.exposeInMainWorld('api', {
  // ── 模型管理 ──
  models: {
    /** 获取所有模型列表 */
    list: () => ipcRenderer.invoke('models:list'),

    /** 添加新模型 */
    add: (config) => ipcRenderer.invoke('models:add', config),

    /** 删除模型 */
    remove: (id) => ipcRenderer.invoke('models:remove', id),

    /** 监听模型列表更新事件 */
    onUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('models:updated', handler);
      return () => ipcRenderer.removeListener('models:updated', handler);
    },
  },

  // ── 视图操作 ──
  view: {
    /** 切换到指定模型 */
    switch: (id) => ipcRenderer.invoke('view:switch', id),

    /** 刷新当前视图 */
    refresh: () => ipcRenderer.invoke('view:refresh'),

    /** 隐藏/显示所有 WebView（弹窗时隐藏，关闭时恢复） */
    setVisible: (visible) => ipcRenderer.invoke('view:setVisible', visible),

    /** 监听视图切换事件 */
    onSwitched: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('view:switched', handler);
      return () => ipcRenderer.removeListener('view:switched', handler);
    },
  },

  // ── 设置 ──
  settings: {
    /** 获取应用设置 */
    get: () => ipcRenderer.invoke('settings:get'),

    /** 保存应用设置 */
    set: (settings) => ipcRenderer.invoke('settings:set', settings),
  },
});
