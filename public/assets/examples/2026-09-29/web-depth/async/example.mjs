// Synthetic UI state model. Run with: node example.mjs
import assert from 'node:assert/strict';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function keyOf({ user, folder, query, page }) {
  return JSON.stringify([user, folder, query, page]);
}

function coordinator() {
  const state = { visible: null, error: null, loading: false, selection: null };
  let generation = 0;
  let controller;
  let mounted = true;
  let scheduled;

  function invalidate(key = null) {
    if (scheduled) scheduled.cancelled = true;
    scheduled = undefined;
    controller?.abort();
    controller = undefined;
    generation++;
    state.selection = key;
    state.loading = false;
  }

  function select(key, work) {
    if (!mounted) throw new Error('screen closed');
    invalidate(key);
    const mine = generation;
    const mineController = new AbortController();
    controller = mineController;
    state.visible = null;
    state.error = null;
    state.loading = true;
    const current = () => mounted && mine === generation &&
      key === state.selection && !mineController.signal.aborted;
    const done = (async () => {
      try {
        const value = await work(mineController.signal);
        if (current()) state.visible = value;
      } catch (error) {
        if (current()) state.error = String(error);
      } finally {
        if (current()) state.loading = false;
      }
    })();
    return { done, signal: mineController.signal };
  }

  // Manual timer: fire() represents the debounce callback, with no clock sleeps.
  function input(scope, composing) {
    const key = keyOf(scope);
    invalidate(key); // Old results are stale even before the timer fires.
    state.visible = null;
    state.error = null;
    if (composing || scope.query === '') return;
    scheduled = { key, cancelled: false };
    return scheduled;
  }
  function fire(ticket, work) {
    if (!mounted || !ticket || ticket.cancelled || ticket !== scheduled) return;
    scheduled = undefined;
    return select(ticket.key, work);
  }
  function close() {
    invalidate();
    mounted = false;
  }
  return { state, select, input, fire, close };
}

// Bug first: completion order wins when results have no owner.
const rawOld = deferred();
const rawNew = deferred();
let naiveVisible;
const wrongOld = rawOld.promise.then(value => { naiveVisible = value; });
const wrongNew = rawNew.promise.then(value => { naiveVisible = value; });
rawNew.resolve('new result');
await wrongNew;
rawOld.resolve('old result');
await wrongOld;
assert.equal(naiveVisible, 'old result');
console.log('naive late response:', naiveVisible);

const ui = coordinator();
const old = deferred();
const fresh = deferred();
const first = ui.select(keyOf({ user: 'mina', folder: 'A', query: 'report', page: 1 }),
  () => old.promise); // This task deliberately ignores AbortSignal.
const second = ui.select(keyOf({ user: 'mina', folder: 'B', query: 'report', page: 1 }),
  () => fresh.promise);
assert.equal(first.signal.aborted, true);
fresh.resolve('folder B result');
await second.done;
old.resolve('folder A result');
await first.done;
assert.deepEqual([ui.state.visible, ui.state.error, ui.state.loading],
  ['folder B result', null, false]);
console.log('different selection:', ui.state.visible);

const moved = coordinator();
const oldTicket = moved.input({ user: 'mina', folder: 'A', query: 'report', page: 1 }, false);
const directB = moved.select(keyOf({ user: 'mina', folder: 'B', query: 'report', page: 1 }),
  () => Promise.resolve('folder B direct result'));
await directB.done;
assert.equal(oldTicket.cancelled, true);
assert.equal(moved.fire(oldTicket, () => Promise.resolve('old A timer result')), undefined);
assert.equal(moved.state.visible, 'folder B direct result');
console.log('old timer after direct selection:', moved.state.visible);

const sameKey = keyOf({ user: 'mina', folder: 'B', query: 'report', page: 1 });
const stale = deferred();
const latest = deferred();
const oldRefresh = ui.select(sameKey, () => stale.promise);
const newRefresh = ui.select(sameKey, () => latest.promise);
stale.reject(new Error('old failure'));
await oldRefresh.done;
assert.deepEqual([ui.state.error, ui.state.loading], [null, true]);
latest.resolve('refreshed result');
await newRefresh.done;
assert.deepEqual([ui.state.visible, ui.state.error, ui.state.loading],
  ['refreshed result', null, false]);
console.log('same-key stale error ignored:', ui.state.visible);

const closed = deferred();
const afterClose = ui.select(sameKey, () => closed.promise);
ui.close();
const snapshot = JSON.stringify(ui.state);
closed.resolve('late closed result');
await afterClose.done;
assert.equal(JSON.stringify(ui.state), snapshot);
console.log('after close unchanged:', ui.state.visible);

const typing = coordinator();
const obsolete = typing.input({ user: 'mina', folder: 'A', query: 'rep', page: 1 }, false);
typing.input({ user: 'mina', folder: 'A', query: '', page: 1 }, false);
assert.equal(typing.fire(obsolete, () => Promise.resolve('obsolete')), undefined);
const composing = typing.input({ user: 'mina', folder: 'A', query: 'ㅂ', page: 1 }, true);
assert.equal(composing, undefined);
const committed = typing.input({ user: 'mina', folder: 'A', query: '보고', page: 1 }, false);
const request = typing.fire(committed, () => Promise.resolve('보고 result'));
await request.done;
assert.equal(typing.state.visible, '보고 result');
console.log('clear and IME:', typing.state.visible);
