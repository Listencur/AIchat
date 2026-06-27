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

    /** 编辑模型 */
    update: (id, config) => ipcRenderer.invoke('models:update', id, config),

    /** 调整模型顺序 */
    reorder: (ids) => ipcRenderer.invoke('models:reorder', ids),

    /** 选择本地图标 */
    selectIcon: () => ipcRenderer.invoke('models:selectIcon'),

    /** 删除模型 */
    remove: (id) => ipcRenderer.invoke('models:remove', id),

    /** 监听模型列表更新事件 */
    onUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('models:updated', handler);
      return () => ipcRenderer.removeListener('models:updated', handler);
    },
  },

  // ── 分组管理 ──
  groups: {
    /** 获取所有自定义分组 */
    list: () => ipcRenderer.invoke('groups:list'),

    /** 添加分组 */
    add: (config) => ipcRenderer.invoke('groups:add', config),

    /** 删除分组 */
    remove: (id) => ipcRenderer.invoke('groups:remove', id),

    /** 监听分组列表更新事件 */
    onUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('groups:updated', handler);
      return () => ipcRenderer.removeListener('groups:updated', handler);
    },
  },

  // ── 视图操作 ──
  view: {
    /** 切换到指定模型 */
    switch: (id) => ipcRenderer.invoke('view:switch', id),

    /** 刷新当前视图 */
    refresh: () => ipcRenderer.invoke('view:refresh'),

    /** 刷新指定模型视图 */
    refreshModel: (id) => ipcRenderer.invoke('view:refreshModel', id),

    /** 获取模型状态面板数据 */
    getStatus: () => ipcRenderer.invoke('view:getStatus'),

    /** 导出当前对话为 Markdown */
    exportConversation: () => ipcRenderer.invoke('view:exportConversation'),

    /** 结束指定模型的 WebView，释放内存 */
    close: (id) => ipcRenderer.invoke('view:close', id),

    /** 结束后台已加载但当前未展示的 WebView */
    closeInactive: () => ipcRenderer.invoke('view:closeInactive'),

    /** 进入分屏模式 */
    enterSplit: (ids) => ipcRenderer.invoke('view:enterSplit', ids),

    /** 退出分屏模式 */
    exitSplit: () => ipcRenderer.invoke('view:exitSplit'),

    /** 调整分屏列宽比例 */
    setSplitRatios: (ratios) => ipcRenderer.invoke('view:setSplitRatios', ratios),

    /** 隐藏/显示所有 WebView（弹窗时隐藏，关闭时恢复） */
    setVisible: (visible) => ipcRenderer.invoke('view:setVisible', visible),

    /** 监听视图切换事件 */
    onSwitched: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('view:switched', handler);
      return () => ipcRenderer.removeListener('view:switched', handler);
    },

    /** 监听分屏状态变化 */
    onSplitChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('view:splitChanged', handler);
      return () => ipcRenderer.removeListener('view:splitChanged', handler);
    },

    /** 监听模型加载状态变化 */
    onLoadingChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('view:loadingChanged', handler);
      return () => ipcRenderer.removeListener('view:loadingChanged', handler);
    },

    /** 监听模型视图结束事件 */
    onClosed: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('view:closed', handler);
      return () => ipcRenderer.removeListener('view:closed', handler);
    },
  },

  // ── 设置 ──
  settings: {
    /** 获取应用设置 */
    get: () => ipcRenderer.invoke('settings:get'),

    /** 保存应用设置 */
    set: (settings) => ipcRenderer.invoke('settings:set', settings),
  },

  // ── 迷你窗口 ──
  quick: {
    /** 提交快速输入 */
    submit: (payload) => ipcRenderer.invoke('quick:submit', payload),

    /** 获取快速输入状态 */
    stateGet: () => ipcRenderer.invoke('quick:stateGet'),

    /** 保存快速输入状态 */
    stateSet: (patch) => ipcRenderer.invoke('quick:stateSet', patch),

    /** 设置快速窗口置顶 */
    setPinned: (pinned) => ipcRenderer.invoke('quick:setPinned', pinned),

    /** 隐藏迷你窗口 */
    hide: () => ipcRenderer.invoke('quick:hide'),

    /** 迷你窗口显示时触发 */
    onShow: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('quick:show', handler);
      return () => ipcRenderer.removeListener('quick:show', handler);
    },
  },

  // ── 会话快照 ──
  snapshot: {
    /** 获取上次保存的会话快照 */
    get: () => ipcRenderer.invoke('snapshot:get'),
  },

  // ── 主窗口控制 ──
  windowControls: {
    /** 最小化主窗口 */
    minimize: () => ipcRenderer.invoke('window:minimize'),

    /** 最大化/还原主窗口 */
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),

    /** 关闭主窗口，沿用关闭提示/托盘逻辑 */
    close: () => ipcRenderer.invoke('window:close'),
  },
});
