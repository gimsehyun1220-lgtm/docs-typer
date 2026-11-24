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
  const originalTab = active;
  const updated = new Event();
  let focused = true;
  let emulateFocus = false;
  let format = 'plain';
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
      get: async (id) => {
        assert.equal(id, originalTab.id);
        return originalTab;
      },
      query: async () => [active],
      onUpdated: updated, onRemoved: new Event(), onReplaced: new Event(),
    },
    debugger: {
      attach: async (debuggee) => log.push(['attach', debuggee.tabId]),
      detach: async (debuggee) => {
        emulateFocus = false;
        log.push(['detach', debuggee.tabId]);
      },
      sendCommand: async (debuggee, command, params) => {
        if (command === 'Emulation.setFocusEmulationEnabled') {
          assert.equal(debuggee.tabId, originalTab.id);
          emulateFocus = params.enabled;
          return;
        }
        if (command === 'Runtime.evaluate') {
          const hasFocus = focused && (active.id === originalTab.id || emulateFocus);
          return { result: { value: hasFocus ? format : undefined } };
        }
        log.push([command, debuggee.tabId, params.text ?? params.type]);
        await onWrite(params);
      },
      onDetach: new Event(),
    },
  };
  await import('../dist/worker.js?test=' + ++suite);
  onConnect.emit(port);
  t.after(() => port.onDisconnect.emit());
  return {
    responses, log, updated,
    setActive(value) { active = value; },
    setFocused(value) { focused = value; },
    setFormat(value) { format = value; },
    onWrite(callback) { onWrite = callback; },
    command(data) { port.onMessage.emit(data); },
    close() { port.onDisconnect.emit(); },
    start(text, wpm = 100) { port.onMessage.emit({ type: 'start', target, text, wpm }); },
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

test('schedules visible changes in pace during a single job', async (t) => {
  const tool = await harness(t);
  t.mock.method(Math, 'random', () => 0);
  const delays = [];
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    return schedule(callback, 0);
  });
  tool.start('abcdefghi');
  await until(() => stateIs(tool, 'complete', 9));
  assert.equal(delays.length, 8);
  assert.ok(delays[6] - delays[2] > 45);
  assert.deepEqual(writes(tool).map(([, , text]) => text), [...'abcdefghi']);
});

test('reschedules the next character when speed changes mid-job', async (t) => {
  const tool = await harness(t);
  t.mock.method(Math, 'random', () => 0);
  const delays = [];
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    return schedule(callback, delay);
  });
  tool.start('abc', 15);
  await until(() => delays.length === 1);
  tool.command({ type: 'speed', wpm: 100 });

  assert.ok(delays[0] > 700);
  assert.ok(delays[1] > 0 && delays[1] <= 120);
  await until(() => stateIs(tool, 'complete', 3));
  assert.deepEqual(writes(tool).map(([, , text]) => text), [...'abc']);
});

test('uses the updated speed after resuming a paused job', async (t) => {
  const tool = await harness(t);
  const delays = [];
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    return schedule(callback, delay);
  });
  tool.start('abc', 15);
  await until(() => delays.length === 1);
  tool.command({ type: 'pause' });
  await until(() => stateIs(tool, 'paused', 1));
  tool.command({ type: 'speed', wpm: 100 });
  assert.equal(delays.length, 1);
  tool.command({ type: 'resume' });
  await until(() => stateIs(tool, 'complete', 3));
  assert.ok(delays[1] <= 120);
  assert.deepEqual(writes(tool).map(([, , text]) => text), [...'abc']);
});

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

test('turns off bold before writing and leaves regular text alone', async (t) => {
  const tool = await harness(t);
  tool.setFormat('bold');
  tool.onWrite(({ code, type, modifiers, text }) => {
    if (code !== 'KeyB') return;
    assert.equal(modifiers, navigator.platform.startsWith('Mac') ? 4 : 2);
    assert.equal(text, undefined);
    if (type === 'rawKeyDown') tool.setFormat('plain');
  });
  tool.start('한글');
  await until(() => stateIs(tool, 'complete', 2));
  assert.deepEqual(writes(tool), [
    ['Input.dispatchKeyEvent', 7, 'rawKeyDown'],
    ['Input.dispatchKeyEvent', 7, 'keyUp'],
    ['Input.insertText', 7, '한'],
    ['Input.insertText', 7, '글'],
  ]);
});

test('pauses before writing if bold cannot be turned off', async (t) => {
  const tool = await harness(t);
  tool.setFormat('bold');
  tool.start('ab');
  await until(() => stateIs(tool, 'paused', 0));
  assert.equal(writes(tool).length, 2);
  assert.ok(writes(tool).every(([method]) => method === 'Input.dispatchKeyEvent'));
  tool.setFormat('plain');
  tool.command({ type: 'resume' });
  await until(() => stateIs(tool, 'complete', 2));
  assert.deepEqual(writes(tool).slice(2).map(([, , text]) => text), ['a', 'b']);
});

test('writes to a focused editor when the bold toolbar state is unavailable', async (t) => {
  const tool = await harness(t);
  tool.setFormat('unknown');
  tool.start('한');
  await until(() => stateIs(tool, 'complete', 1));
  assert.deepEqual(writes(tool), [['Input.insertText', 7, '한']]);
});

test('retains editor focus and writes to the original document while another tab is active', async (t) => {
  const tool = await harness(t);
  tool.start('abc');
  await until(() => stateIs(tool, 'running', 1));
  tool.setActive({ id: 8, url: 'https://docs.google.com/document/d/other/edit' });
  tool.updated.emit(8, { status: 'loading' });
  await until(() => stateIs(tool, 'complete', 3));
  assert.deepEqual(writes(tool).map(([, id, text]) => [id, text]), [[7, 'a'], [7, 'b'], [7, 'c']]);
});

test('pauses when the target navigates and resumes without repeating a character', async (t) => {
  const tool = await harness(t);
  tool.start('abc');
  await until(() => stateIs(tool, 'running', 1));
  tool.setActive({ id: 8, url: docs });
  tool.updated.emit(7, { status: 'loading' });
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
