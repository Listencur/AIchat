'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ViewReclaimer } = require('../electron/view-reclaimer');

test('ViewReclaimer constructor with defaults', () => {
  const r = new ViewReclaimer();
  assert.equal(r.maxAliveViews, 0);
  assert.equal(r.idleReclaimMinutes, 30);
  assert.equal(r.idleReclaimEnabled, true);
});

test('ViewReclaimer constructor with custom options', () => {
  const r = new ViewReclaimer({ maxAliveViews: 5, idleReclaimMinutes: 60, idleReclaimEnabled: false });
  assert.equal(r.maxAliveViews, 5);
  assert.equal(r.idleReclaimMinutes, 60);
  assert.equal(r.idleReclaimEnabled, false);
});

test('ViewReclaimer.constructor clamps idleReclaimMinutes to 1440', () => {
  assert.equal(new ViewReclaimer({ idleReclaimMinutes: 99999 }).idleReclaimMinutes, 1440);
});

test('ViewReclaimer.setMaxAlive updates max alive views', () => {
  const r = new ViewReclaimer();
  r.setMaxAlive(8);
  assert.equal(r.getMaxAlive(), 8);
  r.setMaxAlive(-1);
  assert.equal(r.getMaxAlive(), 0);
});

test('ViewReclaimer protected ids', () => {
  const r = new ViewReclaimer();
  r.addProtectedId('m1');
  assert.equal(r.isProtected('m1'), true);
  assert.equal(r.isProtected('m2'), false);
  r.removeProtectedId('m1');
  assert.equal(r.isProtected('m1'), false);
});

test('ViewReclaimer.canAutoReclaim logic', () => {
  const r = new ViewReclaimer();
  r.addProtectedId('p1');
  const state = { activeId: 'a1', splitMode: true, splitIds: ['s1'], isBusy: (id) => id === 'b1' };
  assert.equal(r.canAutoReclaim('p1', state), false); // protected
  assert.equal(r.canAutoReclaim('a1', state), false); // active
  assert.equal(r.canAutoReclaim('s1', state), false); // split
  assert.equal(r.canAutoReclaim('b1', state), false); // busy
  assert.equal(r.canAutoReclaim('x1', state), true);  // reclaimable
});

test('ViewReclaimer.enforceMaxAlive closes oldest', () => {
  const r = new ViewReclaimer({ maxAliveViews: 2 });
  const closed = [];
  const views = new Map([['m1', { lastUsedAt: 100 }], ['m2', { lastUsedAt: 200 }], ['m3', { lastUsedAt: 300 }]]);
  r.enforceMaxAlive(views, { activeId: null, splitMode: false, splitIds: [] }, (id) => { closed.push(id); views.delete(id); });
  assert.ok(closed.length > 0);
  assert.ok(closed.includes('m1'));
});

test('ViewReclaimer.enforceMaxAlive respects protections', () => {
  const r = new ViewReclaimer({ maxAliveViews: 2 });
  r.addProtectedId('m1');
  const closed = [];
  const views = new Map([['m1', { lastUsedAt: 100 }], ['m2', { lastUsedAt: 200 }], ['m3', { lastUsedAt: 300 }]]);
  r.enforceMaxAlive(views, { activeId: null, splitMode: false, splitIds: [] }, (id) => { closed.push(id); views.delete(id); });
  assert.ok(!closed.includes('m1'));
});

test('ViewReclaimer.enforceMaxAlive no-op when no limit', () => {
  const r = new ViewReclaimer();
  const views = new Map([['m1', { lastUsedAt: 100 }]]);
  const closed = [];
  r.enforceMaxAlive(views, { activeId: null, splitMode: false, splitIds: [] }, (id) => closed.push(id));
  assert.deepEqual(closed, []);
});

test('ViewReclaimer.reclaimIdleViews reclaims old inactive', () => {
  const r = new ViewReclaimer({ idleReclaimMinutes: 30 });
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const closed = [];
  const views = new Map([
    ['m1', { lastUsedAt: oneHourAgo, inactiveSince: oneHourAgo }],
    ['m2', { lastUsedAt: Date.now(), inactiveSince: 0 }],
  ]);
  r.reclaimIdleViews(views, { activeId: null, splitMode: false, splitIds: [] }, (id) => closed.push(id));
  assert.ok(closed.includes('m1'));
  assert.ok(!closed.includes('m2'));
});

test('ViewReclaimer.reclaimIdleViews skips active/split/protected', () => {
  const r = new ViewReclaimer({ idleReclaimMinutes: 30 });
  r.addProtectedId('p1');
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const closed = [];
  const views = new Map([['p1', { lastUsedAt: oneHourAgo, inactiveSince: oneHourAgo }]]);
  r.reclaimIdleViews(views, { activeId: 'p1', splitMode: true, splitIds: ['p1'] }, (id) => closed.push(id));
  assert.deepEqual(closed, []);
});

test('ViewReclaimer.reclaimIdleViews disabled returns empty', () => {
  const r = new ViewReclaimer({ idleReclaimEnabled: false });
  const views = new Map([['m1', { lastUsedAt: 100, inactiveSince: 1 }]]);
  const closed = [];
  r.reclaimIdleViews(views, { activeId: null, splitMode: false, splitIds: [] }, (id) => closed.push(id));
  assert.deepEqual(closed, []);
});

test('ViewReclaimer.setIdleReclaimSettings updates', () => {
  const r = new ViewReclaimer();
  r.setIdleReclaimSettings(false, 60);
  assert.equal(r.idleReclaimEnabled, false);
  assert.equal(r.idleReclaimMinutes, 60);
  r.setIdleReclaimSettings(true, 99999);
  assert.equal(r.idleReclaimMinutes, 1440);
});

test('ViewReclaimer.getProtectedIds combines all sources', () => {
  const r = new ViewReclaimer();
  r.addProtectedId('m1');
  const ids = r.getProtectedIds({ splitMode: true, splitIds: ['m2'], activeId: 'm3' });
  assert.ok(ids.has('m1'));
  assert.ok(ids.has('m2'));
  assert.ok(ids.has('m3'));
});
