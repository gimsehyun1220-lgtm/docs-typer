import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

class Event {
  listeners = [];
  addListener(listener) { this.listeners.push(listener); }
  emit(...args) { for (const listener of this.listeners) listener(...args); }
}

let suite = 0;
const docs = 'https://docs.google.com/document/d/example/edit?tab=t.0';
const target = { tabId: 7, title: 'Sample', url: docs };

async function harness(t) {
  let active = { id: 7, url: docs, title: 'Sample' };
  const log = [];
  const responses = [];
  const onConnect = new Event();
  const activated = new Event();
  const updated = new Event();
  let focused = true;
  let onWrite = () => {};
  const port = {
    name: 'docs-typer-panel',
    sender: { id: 'unit-test', url: 'chrome-extension://unit-test/panel.html' },
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage(value) { responses.push(value); },
  };
  globalThis.chrome = {
    runtime: { id: 'unit-test', onConnect, onInstalled: new Event(), onStartup: new Event(), getURL: (path) => 'chrome-extension://unit-test/' + path },
    tabs: {
      query: async () => [active],
      onActivated: activated, onUpdated: updated, onRemoved: new Event(), onReplaced: new Event(),
    },
    windows: { onFocusChanged: new Event() },
    debugger: {
      attach: async (debuggee) => log.push(['attach', debuggee.tabId]),
      detach: async (debuggee) => log.push(['detach', debuggee.tabId]),
      sendCommand: async (debuggee, command, params) => {
        if (command === 'Runtime.evaluate') return { result: { value: focused } };
        log.push([command, debuggee.tabId, params.text ?? params.type]);
        await onWrite();
      },
      onDetach: new Event(),
    },
  };
  await import('../dist/worker.js?test=' + ++suite);
  onConnect.emit(port);
  t.after(() => port.onDisconnect.emit());
  return {
    responses, log, activated, updated,
    setActive(value) { active = value; },
    setFocused(value) { focused = value; },
    onWrite(callback) { onWrite = callback; },
    command(data) { port.onMessage.emit(data); },
    close() { port.onDisconnect.emit(); },
    start(text) { port.onMessage.emit({ type: 'start', target, text, wpm: 100 }); },
  };
}

async function until(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for a worker event');
    await sleep(10);
  }
}

const stateIs = (tool, phase, done) => tool.responses.some((message) =>
  message.type === 'state' && message.state.phase === phase && message.state.done === done);
const writes = (tool) => tool.log.filter(([method]) => method.startsWith('Input.'));

test('uses the same confirmed tab for Korean, line breaks, and emoji', async (t) => {
  const tool = await harness(t);
  tool.start('한\n👩🏽‍💻');
  await until(() => stateIs(tool, 'complete', 3));
  assert.deepEqual(writes(tool), [
    ['Input.insertText', 7, '한'],
    ['Input.dispatchKeyEvent', 7, '\r'],
    ['Input.dispatchKeyEvent', 7, 'keyUp'],
    ['Input.insertText', 7, '👩🏽‍💻'],
  ]);
  assert.deepEqual(tool.log.at(-1), ['detach', 7]);
});

test('pauses on tab changes and resumes without repeating a character', async (t) => {
  const tool = await harness(t);
  tool.start('abc');
  await until(() => stateIs(tool, 'running', 1));
  tool.setActive({ id: 8, url: docs });
  tool.activated.emit({ tabId: 8, windowId: 1 });
  await until(() => stateIs(tool, 'paused', 1));
  tool.command({ type: 'resume' });
  await until(() => tool.responses.some(({ type }) => type === 'error'));
  assert.equal(writes(tool).length, 1);
  tool.setActive({ id: 7, url: docs });
  tool.command({ type: 'resume' });
  await until(() => stateIs(tool, 'complete', 3));
  assert.deepEqual(writes(tool).map(([, id, text]) => [id, text]), [[7, 'a'], [7, 'b'], [7, 'c']]);
});

test('requires editor focus and releases the target when the panel closes', async (t) => {
  const tool = await harness(t);
  tool.setFocused(false);
  tool.start('ab');
  await until(() => stateIs(tool, 'paused', 0));
  assert.equal(writes(tool).length, 0);
  tool.setFocused(true);
  tool.command({ type: 'resume' });
  await until(() => stateIs(tool, 'running', 1));
  tool.close();
  await sleep(180);
  assert.equal(writes(tool).length, 1);
  assert.deepEqual(tool.log.at(-1), ['detach', 7]);
});

test('stops for a manual review after an ambiguous write', async (t) => {
  const tool = await harness(t);
  tool.onWrite(() => { throw new Error('Debugger detached while sending'); });
  tool.start('abc');
  await until(() => stateIs(tool, 'review', 0));
  tool.command({ type: 'resume' });
  await sleep(150);
  assert.equal(writes(tool).length, 1);
});

test('ignores duplicate start and stops between characters', async (t) => {
  const tool = await harness(t);
  tool.start('abc');
  tool.start('xyz');
  await until(() => stateIs(tool, 'running', 1));
  assert.ok(tool.responses.some(({ type }) => type === 'error'));
  tool.command({ type: 'stop' });
  await until(() => stateIs(tool, 'stopped', 1));
  await sleep(160);
  assert.deepEqual(writes(tool).map(([, , text]) => text), ['a']);
});
