'use strict';

class ViewReclaimer {
  constructor(options = {}) {
    this.maxAliveViews = Number(options.maxAliveViews) > 0 ? Math.floor(Number(options.maxAliveViews)) : 0;
    this.idleReclaimMinutes = Number(options.idleReclaimMinutes) > 0 ? Math.min(24 * 60, Math.floor(Number(options.idleReclaimMinutes))) : 30;
    this.idleReclaimEnabled = options.idleReclaimEnabled !== false;
    this.protectedIds = new Set();
  }

  setMaxAlive(max) {
    this.maxAliveViews = Number(max) > 0 ? Math.floor(Number(max)) : 0;
  }

  getMaxAlive() {
    return this.maxAliveViews;
  }

  addProtectedId(id) {
    this.protectedIds.add(id);
  }

  removeProtectedId(id) {
    this.protectedIds.delete(id);
  }

  isProtected(modelId) {
    return this.protectedIds.has(modelId);
  }

  canAutoReclaim(modelId, state) {
    // state 包含 activeId, splitMode, splitIds, isBusy 函数
    if (this.isProtected(modelId)) return false;
    if (state.splitMode && state.splitIds.includes(modelId)) return false;
    if (state.activeId === modelId) return false;
    if (state.isBusy && state.isBusy(modelId)) return false;
    return true;
  }

  enforceMaxAlive(views, state, removeViewFn) {
    if (!this.maxAliveViews || this.maxAliveViews <= 0) return [];
    const closedIds = [];
    const protectedIds = this.getProtectedIds(state);
    while (views.size > this.maxAliveViews) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, entry] of views) {
        if (protectedIds.has(id) || (state.isBusy && state.isBusy(id))) continue;
        if ((entry.lastUsedAt || 0) < oldestAt) {
          oldestAt = entry.lastUsedAt || 0;
          oldestId = id;
        }
      }
      if (!oldestId) break;
      removeViewFn(oldestId);
      closedIds.push(oldestId);
    }
    return closedIds;
  }

  getProtectedIds(state) {
    const protectedIds = new Set(this.protectedIds);
    if (state.splitMode) {
      for (const id of state.splitIds) protectedIds.add(id);
    }
    if (state.activeId) protectedIds.add(state.activeId);
    return protectedIds;
  }

  reclaimIdleViews(views, state, removeViewFn) {
    if (!this.idleReclaimEnabled || !this.idleReclaimMinutes || this.idleReclaimMinutes <= 0) {
      return [];
    }
    const cutoff = Date.now() - Math.floor(this.idleReclaimMinutes * 60 * 1000);
    const candidates = Array.from(views.entries())
      .filter(
        ([modelId, entry]) =>
          this.canAutoReclaim(modelId, state) &&
          entry.inactiveSince > 0 &&
          entry.inactiveSince <= cutoff
      )
      .sort(([, a], [, b]) => a.inactiveSince - b.inactiveSince);
    const closedIds = [];
    candidates.forEach(([modelId]) => {
      if (!this.canAutoReclaim(modelId, state)) return;
      removeViewFn(modelId);
      closedIds.push(modelId);
    });
    return closedIds;
  }

  setIdleReclaimSettings(enabled, minutes) {
    this.idleReclaimEnabled = enabled !== false;
    this.idleReclaimMinutes =
      Number(minutes) > 0 ? Math.min(24 * 60, Math.floor(Number(minutes))) : 0;
  }
}

module.exports = { ViewReclaimer };