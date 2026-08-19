'use strict';

const MEMORY_SNAPSHOT_TTL_MS = 5000;

class MemoryManager {
  constructor(deps = {}) {
    this.app = deps.app;
    this._lastSnapshot = null;
    this._watchTimer = null;
  }

  getMemorySnapshot(force = false) {
    if (!force && this._lastSnapshot && Date.now() - this._lastSnapshot.sampledAt < MEMORY_SNAPSHOT_TTL_MS) {
      return this._lastSnapshot;
    }
    const memoryByPid = new Map();
    let totalKb = 0;
    const metrics = this.app.getAppMetrics();
    metrics.forEach((metric) => {
      const workingSetSize = metric && metric.memory ? Number(metric.memory.workingSetSize) : 0;
      if (workingSetSize > 0) totalKb += workingSetSize;
      if (metric.pid && workingSetSize) memoryByPid.set(metric.pid, Math.round((workingSetSize / 1024) * 10) / 10);
    });
    this._lastSnapshot = {
      sampledAt: Date.now(),
      memoryByPid,
      totalMb: Math.round((totalKb / 1024) * 10) / 10,
      processCount: metrics.length,
    };
    return this._lastSnapshot;
  }

  getProcessMemoryByPid() {
    return this.getMemorySnapshot().memoryByPid;
  }

  getTotalAppMemoryMb() {
    return this.getMemorySnapshot().totalMb;
  }

  getMemorySummary(settings, viewManager) {
    const snapshot = this.getMemorySnapshot();
    const state = viewManager ? viewManager.getState() : null;
    return {
      totalMb: snapshot.totalMb,
      thresholdMb: settings.memoryPressureMb,
      autoReclaimEnabled: settings.autoReclaimEnabled,
      maxAliveViews: settings.maxAliveViews,
      trayMemoryMode: settings.trayMemoryMode,
      loadedCount: state ? state.loadedIds.length : 0,
      activeId: state ? state.activeId : null,
      processCount: snapshot.processCount,
      sampledAt: snapshot.sampledAt,
    };
  }

  startWatch(settings, deps) {
    this.stopWatch();
    const { viewManager, mainWindow, appIsQuittingFn, getMemorySnapshotFn, notifyReclaimFn, sendToMainWindowFn } = deps;
    if (!settings.autoReclaimEnabled && !(settings.idleReclaimEnabled && settings.inactiveViewTtlMinutes > 0)) {
      return;
    }
    this._watchTimer = setInterval(() => {
      if (!viewManager || appIsQuittingFn()) return;
      const idleState = viewManager.closeIdleViews(settings.inactiveViewTtlMinutes);
      if (idleState.closedIds.length > 0) {
        notifyReclaimFn({ ...idleState, reason: 'idle' });
        sendToMainWindowFn('view:reclaimed', { reason: 'idle', closedIds: idleState.closedIds, state: idleState });
      }
      if (!settings.autoReclaimEnabled) return;
      const totalMb = (getMemorySnapshotFn || this.getMemorySnapshot.bind(this))(true).totalMb;
      if (totalMb < settings.memoryPressureMb) return;
      const state = viewManager.closeInactiveViews();
      if (!state.closedIds || state.closedIds.length === 0) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        state.closedIds.forEach((id) => {
          sendToMainWindowFn('view:closed', { id, state });
        });
        sendToMainWindowFn('view:splitChanged', {
          enabled: state.splitMode,
          ids: state.splitIds,
          direction: state.splitDirection,
        });
        sendToMainWindowFn('view:switched', { id: state.activeId });
        sendToMainWindowFn('memory:reclaimed', {
          reason: 'pressure',
          totalMb: (getMemorySnapshotFn || this.getMemorySnapshot.bind(this))(true).totalMb,
          thresholdMb: settings.memoryPressureMb,
          closedIds: state.closedIds,
        });
      }
    }, 30000);
  }

  stopWatch() {
    if (this._watchTimer) {
      clearInterval(this._watchTimer);
      this._watchTimer = null;
    }
  }

  notifyViewStateAfterReclaim(state, mainWindow) {
    if (!state || !mainWindow || mainWindow.isDestroyed()) return;
    const closedIds = Array.isArray(state.closedIds) ? state.closedIds : [];
    closedIds.forEach((id) => {
      mainWindow.webContents.send('view:closed', { id, state });
    });
    mainWindow.webContents.send('view:splitChanged', {
      enabled: state.splitMode,
      ids: state.splitIds,
      direction: state.splitDirection,
    });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
  }

  applyTrayMemoryPolicy(viewManager, settings) {
    if (!viewManager) return null;
    if (settings.trayMemoryMode === 'closeInactive') return viewManager.closeInactiveViews();
    if (settings.trayMemoryMode === 'hibernateAll') return viewManager.hibernateAllViews();
    return null;
  }
}

module.exports = {
  MemoryManager,
  MEMORY_SNAPSHOT_TTL_MS,
};
