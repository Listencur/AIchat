'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ViewLayout,
  SIDEBAR_WIDTH,
  TOP_BAR_HEIGHT,
} = require('../electron/view-layout');

function createMockView(overrides = {}) {
  let bounds = {};
  return {
    setBounds: (b) => { bounds = b; },
    getBounds: () => ({ ...bounds }),
    ...overrides,
  };
}

function createMockWindow(overrides = {}) {
  return {
    ...overrides,
  };
}

// ── ViewLayout 常量测试 ──

test('SIDEBAR_WIDTH is 240', () => {
  assert.equal(SIDEBAR_WIDTH, 240);
});

test('TOP_BAR_HEIGHT is 36', () => {
  assert.equal(TOP_BAR_HEIGHT, 36);
});

// ── ViewLayout 构造测试 ──

test('ViewLayout constructor initializes with defaults', () => {
  const win = createMockWindow();
  const layout = new ViewLayout(win);
  assert.equal(layout.splitMode, false);
  assert.deepEqual(layout.splitIds, []);
  assert.deepEqual(layout.splitRatios, []);
  assert.equal(layout.splitDirection, 'horizontal');
  assert.equal(layout.sidebarCollapsed, false);
});

// ── 侧边栏测试 ──

test('ViewLayout.setSidebarCollapsed toggles sidebar state', () => {
  const layout = new ViewLayout(createMockWindow());
  assert.equal(layout.isSidebarCollapsed(), false);
  layout.setSidebarCollapsed(true);
  assert.equal(layout.isSidebarCollapsed(), true);
  layout.setSidebarCollapsed(false);
  assert.equal(layout.isSidebarCollapsed(), false);
});

test('ViewLayout.getSidebarWidth returns correct width', () => {
  const layout = new ViewLayout(createMockWindow());
  assert.equal(layout.getSidebarWidth(), 240);
  layout.setSidebarCollapsed(true);
  assert.equal(layout.getSidebarWidth(), 56);
});

// ── 分屏模式测试 ──

test('ViewLayout.setSplitMode sets split state', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2'], [0.5, 0.5], 'vertical');
  assert.equal(layout.splitMode, true);
  assert.deepEqual(layout.splitIds, ['m1', 'm2']);
  assert.equal(layout.splitDirection, 'vertical');
});

test('ViewLayout.setSplitMode disables split mode', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  layout.setSplitMode(false);
  assert.equal(layout.splitMode, false);
  assert.deepEqual(layout.splitIds, []);
});

// ── 分屏比例测试 ──

test('ViewLayout.setSplitRatios updates ratios', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2', 'm3']);
  const result = layout.setSplitRatios([1, 2, 3]);
  assert.equal(result, true);
  const ratios = layout.getSplitRatios();
  assert.ok(Math.abs(ratios[0] - 1 / 6) < 0.001);
  assert.ok(Math.abs(ratios[1] - 2 / 6) < 0.001);
  assert.ok(Math.abs(ratios[2] - 3 / 6) < 0.001);
});

test('ViewLayout.setSplitRatios returns false when not in split mode', () => {
  const layout = new ViewLayout(createMockWindow());
  assert.equal(layout.setSplitRatios([0.5, 0.5]), false);
});

test('ViewLayout.setSplitRatios returns false for mismatched lengths', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  assert.equal(layout.setSplitRatios([1]), false);
});

test('ViewLayout.setSplitRatios returns false for invalid ratios', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  assert.equal(layout.setSplitRatios([-1, 2]), false);
});

test('ViewLayout.setSplitRatios returns false for zero total', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  assert.equal(layout.setSplitRatios([0, 0]), false);
});

test('ViewLayout.getSplitRatios returns equal ratios when no splitRatios set', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2', 'm3']);
  layout.splitRatios = [];
  const ratios = layout.getSplitRatios();
  assert.equal(ratios.length, 3);
  assert.ok(Math.abs(ratios[0] - 1 / 3) < 0.001);
});

test('ViewLayout.getSplitRatios normalizes when total is not 1', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  layout.splitRatios = [3, 1];
  const ratios = layout.getSplitRatios();
  assert.ok(Math.abs(ratios[0] - 0.75) < 0.001);
  assert.ok(Math.abs(ratios[1] - 0.25) < 0.001);
});

// ── 单视图布局测试 ──

test('ViewLayout.setSingleViewBounds positions view correctly', () => {
  const layout = new ViewLayout(createMockWindow());
  const view = createMockView();
  layout.setSingleViewBounds(view, { width: 1200, height: 800 });
  const bounds = view.getBounds();
  assert.equal(bounds.x, SIDEBAR_WIDTH);
  assert.equal(bounds.y, TOP_BAR_HEIGHT);
  assert.equal(bounds.width, 1200 - SIDEBAR_WIDTH);
  assert.equal(bounds.height, 800 - TOP_BAR_HEIGHT);
});

test('ViewLayout.setSingleViewBounds with collapsed sidebar', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSidebarCollapsed(true);
  const view = createMockView();
  layout.setSingleViewBounds(view, { width: 1200, height: 800 });
  const bounds = view.getBounds();
  assert.equal(bounds.x, 56);
  assert.equal(bounds.width, 1200 - 56);
});

test('ViewLayout.setSingleViewBounds handles null view', () => {
  const layout = new ViewLayout(createMockWindow());
  // Should not throw
  layout.setSingleViewBounds(null, { width: 1200, height: 800 });
});

test('ViewLayout.setSingleViewBounds handles zero container', () => {
  const layout = new ViewLayout(createMockWindow());
  const view = createMockView();
  layout.setSingleViewBounds(view, { width: 0, height: 0 });
  const bounds = view.getBounds();
  assert.equal(bounds.width, 0);
  assert.equal(bounds.height, 0);
});

// ── 分屏布局测试 ──

test('ViewLayout.setSplitViewBounds horizontal split', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2']);
  const view1 = createMockView();
  const view2 = createMockView();
  layout.setSplitViewBounds([view1, view2], { width: 1200, height: 800 });
  const b1 = view1.getBounds();
  const b2 = view2.getBounds();
  assert.equal(b1.y, TOP_BAR_HEIGHT);
  assert.equal(b2.y, TOP_BAR_HEIGHT);
  assert.equal(b1.height, 800 - TOP_BAR_HEIGHT);
  assert.equal(b2.height, 800 - TOP_BAR_HEIGHT);
  assert.equal(b1.x, SIDEBAR_WIDTH);
  assert.ok(b2.x > b1.x);
});

test('ViewLayout.setSplitViewBounds vertical split', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2'], [], 'vertical');
  const view1 = createMockView();
  const view2 = createMockView();
  layout.setSplitViewBounds([view1, view2], { width: 1200, height: 800 });
  const b1 = view1.getBounds();
  const b2 = view2.getBounds();
  assert.equal(b1.x, SIDEBAR_WIDTH);
  assert.equal(b2.x, SIDEBAR_WIDTH);
  assert.equal(b1.width, 1200 - SIDEBAR_WIDTH);
  assert.equal(b2.width, 1200 - SIDEBAR_WIDTH);
  assert.ok(b2.y > b1.y);
});

test('ViewLayout.setSplitViewBounds handles empty views array', () => {
  const layout = new ViewLayout(createMockWindow());
  // Should not throw
  layout.setSplitViewBounds([], { width: 1200, height: 800 });
});

test('ViewLayout.setSplitViewBounds handles three-way horizontal split', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSplitMode(true, ['m1', 'm2', 'm3'], [1, 1, 1]);
  const views = [createMockView(), createMockView(), createMockView()];
  layout.setSplitViewBounds(views, { width: 1200, height: 800 });
  const b1 = views[0].getBounds();
  const b2 = views[1].getBounds();
  const b3 = views[2].getBounds();
  assert.equal(b1.y, TOP_BAR_HEIGHT);
  assert.equal(b2.y, TOP_BAR_HEIGHT);
  assert.equal(b3.y, TOP_BAR_HEIGHT);
  assert.equal(b1.height, b2.height);
  assert.equal(b2.height, b3.height);
});

test('ViewLayout.setSplitViewBounds with collapsed sidebar', () => {
  const layout = new ViewLayout(createMockWindow());
  layout.setSidebarCollapsed(true);
  layout.setSplitMode(true, ['m1', 'm2']);
  const views = [createMockView(), createMockView()];
  layout.setSplitViewBounds(views, { width: 1200, height: 800 });
  const b1 = views[0].getBounds();
  const b2 = views[1].getBounds();
  assert.equal(b1.x, 56);
  assert.ok(b2.x > b1.x);
  assert.equal(b1.height, 800 - 36);
  assert.equal(b2.height, 800 - 36);
});

// ── getNormalizedRatios 测试 ──

test('ViewLayout.getNormalizedRatios returns equal ratios for invalid input', () => {
  const layout = new ViewLayout(createMockWindow());
  const ratios = layout.getNormalizedRatios(null, 3);
  assert.equal(ratios.length, 3);
  assert.ok(Math.abs(ratios[0] - 1 / 3) < 0.001);
});

test('ViewLayout.getNormalizedRatios returns equal ratios for mismatched length', () => {
  const layout = new ViewLayout(createMockWindow());
  const ratios = layout.getNormalizedRatios([1, 2], 3);
  assert.equal(ratios.length, 3);
});

test('ViewLayout.getNormalizedRatios returns equal ratios for zero total', () => {
  const layout = new ViewLayout(createMockWindow());
  const ratios = layout.getNormalizedRatios([0, 0], 2);
  assert.equal(ratios.length, 2);
  assert.ok(Math.abs(ratios[0] - 0.5) < 0.001);
});
