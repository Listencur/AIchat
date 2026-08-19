'use strict';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const TOP_BAR_HEIGHT = 36;
const SPLIT_GUTTER_WIDTH = 10;

class ViewLayout {
  constructor(win) {
    this.win = win;
    this.splitMode = false;
    this.splitIds = [];
    this.splitRatios = [];
    this.splitDirection = 'horizontal';
    this.sidebarCollapsed = false;
  }

  setSidebarCollapsed(collapsed) {
    this.sidebarCollapsed = collapsed === true;
  }

  isSidebarCollapsed() {
    return this.sidebarCollapsed;
  }

  getSidebarWidth() {
    return this.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  }

  setSplitMode(splitMode, splitIds = [], splitRatios = [], splitDirection = 'horizontal') {
    this.splitMode = splitMode;
    this.splitIds = splitIds;
    this.splitRatios = splitRatios;
    this.splitDirection = splitDirection;
  }

  setSplitRatios(ratios) {
    if (
      !this.splitMode ||
      !Array.isArray(ratios) ||
      ratios.length !== this.splitIds.length
    )
      return false;
    const validRatios = ratios.map(Number).filter((r) => r > 0);
    if (validRatios.length !== ratios.length) return false;
    const total = validRatios.reduce((s, r) => s + r, 0);
    if (total <= 0) return false;
    this.splitRatios = validRatios.map((r) => r / total);
    return true;
  }

  getSplitRatios() {
    if (
      !Array.isArray(this.splitRatios) ||
      this.splitRatios.length !== this.splitIds.length
    )
      return this.splitIds.map(() => 1 / Math.max(1, this.splitIds.length));
    const total = this.splitRatios.reduce((s, r) => s + r, 0);
    if (total <= 0)
      return this.splitIds.map(() => 1 / Math.max(1, this.splitIds.length));
    return this.splitRatios.map((r) => r / total);
  }

  setSingleViewBounds(view, containerBounds) {
    if (!view) return;
    const sidebarWidth = this.getSidebarWidth();
    const x = sidebarWidth;
    const y = TOP_BAR_HEIGHT;
    const width = Math.max(0, (containerBounds.width || 0) - sidebarWidth);
    const height = Math.max(0, (containerBounds.height || 0) - TOP_BAR_HEIGHT);
    view.setBounds({ x, y, width, height });
  }

  setSplitViewBounds(views, containerBounds, ratios) {
    if (!Array.isArray(views) || views.length === 0) return;
    const [width, height] = [containerBounds.width || 0, containerBounds.height || 0];
    const sidebarWidth = this.getSidebarWidth();
    const contentHeight = Math.max(0, height - TOP_BAR_HEIGHT);
    const availableWidth = Math.max(0, width - sidebarWidth);

    if (this.splitDirection === 'vertical') {
      const gutterTotal = SPLIT_GUTTER_WIDTH * (views.length - 1);
      const contentHeightForRows = Math.max(0, contentHeight - gutterTotal);
      const normalizedRatios = this.getNormalizedRatios(ratios, views.length);
      let y = TOP_BAR_HEIGHT;
      views.forEach((view, index) => {
        if (!view) return;
        const isLast = index === views.length - 1;
        const rowHeight = isLast
          ? TOP_BAR_HEIGHT + contentHeight - y
          : Math.floor(contentHeightForRows * normalizedRatios[index]);
        view.setBounds({
          x: sidebarWidth,
          y,
          width: availableWidth,
          height: Math.max(0, rowHeight),
        });
        y += rowHeight + SPLIT_GUTTER_WIDTH;
      });
      return;
    }

    const gutterTotal = SPLIT_GUTTER_WIDTH * (views.length - 1);
    const contentWidth = Math.max(0, availableWidth - gutterTotal);
    const normalizedRatios = this.getNormalizedRatios(ratios, views.length);
    let x = sidebarWidth;
    views.forEach((view, index) => {
      if (!view) return;
      const isLast = index === views.length - 1;
      const columnWidth = isLast
        ? sidebarWidth + availableWidth - x
        : Math.floor(contentWidth * normalizedRatios[index]);
      view.setBounds({
        x,
        y: TOP_BAR_HEIGHT,
        width: Math.max(0, columnWidth),
        height: contentHeight,
      });
      x += columnWidth + SPLIT_GUTTER_WIDTH;
    });
  }

  getNormalizedRatios(ratios, count) {
    if (!Array.isArray(ratios) || ratios.length !== count)
      return Array(count).fill(1 / Math.max(1, count));
    const total = ratios.reduce((s, r) => s + r, 0);
    if (total <= 0) return Array(count).fill(1 / Math.max(1, count));
    return ratios.map((r) => r / total);
  }
}

module.exports = { ViewLayout, SIDEBAR_WIDTH, TOP_BAR_HEIGHT };