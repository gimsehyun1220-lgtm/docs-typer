import type { PanelCommand, Snapshot, Target, WorkerMessage } from './protocol.js';
import { createTypingPace, docsUrl, splitText, validateText } from './typing.js';

type Job = {
  owner: ExtensionPort;
  target: Target;
  chunks: string[];
  index: number;
  nextInterval: () => number;
  phase: Snapshot['phase'];
  message?: string;
  attached: boolean;
  busy: boolean;
  timer?: ReturnType<typeof setTimeout>;
  lastTickStarted?: number;
};

let job: Job | undefined;
const panelPath = chrome.runtime.getURL('panel.html');

function guardExpression(target: Target): string {
  return `(() => {
    const url = new URL(location.href);
    const tab = url.searchParams.get('tab') || 't.0';
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    return url.origin + path + '?tab=' + tab === ${JSON.stringify(target.url)}
      && document.activeElement?.matches('iframe.docs-texteventtarget-iframe') === true;
  })()`;
}

function post(port: ExtensionPort, message: WorkerMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // A closed panel has no recipient.
  }
}

function publish(current: Job): void {
  const { phase, target, index: done, message, chunks } = current;
  post(current.owner, { type: 'state', state: { phase, target, done, total: chunks.length, message } });
}

async function activeTarget(): Promise<Target | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = docsUrl(tab?.url);
  if (!url || tab.id === undefined || tab.pendingUrl) return;
  return { tabId: tab.id, url, title: tab.title || 'Google Docs' };
}

function sameTarget(a: Target | undefined, b: Target): boolean {
  return a?.tabId === b.tabId && a.url === b.url;
}

function changePhase(current: Job, phase: Job['phase'], message?: string): void {
  clearTimeout(current.timer);
  current.timer = undefined;
  current.phase = phase;
  current.message = message;
  publish(current);
  if (!current.busy && phase !== 'running') void release(current);
}

async function release(current: Job): Promise<void> {
  if (current.busy) return;
  if (current.attached) {
    current.busy = true;
    current.attached = false;
    try {
      await chrome.debugger.detach({ tabId: current.target.tabId });
    } catch {
      // The tab or Chrome may already have closed the debugger connection.
    } finally {
      current.busy = false;
      publish(current);
    }
  }
  if (current.phase !== 'paused' && current.phase !== 'running' && job === current) job = undefined;
}

async function sendCharacter(target: { tabId: number }, text: string): Promise<void> {
  if (text === '\n') {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    return;
  }
  await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
}

function scheduleNext(current: Job, started: number): void {
  clearTimeout(current.timer);
  const remaining = current.nextInterval() - (performance.now() - started);
  current.timer = setTimeout(() => {
    current.timer = undefined;
    void tick(current);
  }, Math.max(0, remaining));
}

async function tick(current: Job): Promise<void> {
  if (current.phase !== 'running' || current.busy) return;
  const started = performance.now();
  current.lastTickStarted = started;
  const target = { tabId: current.target.tabId };
  current.busy = true;
  let sending = false;
  try {
    const tab = await chrome.tabs.get(target.tabId);
    if (current.phase !== 'running') return;
    if (tab.pendingUrl || docsUrl(tab.url) !== current.target.url) {
      changePhase(current, 'paused', '원래 문서를 열고 본문 커서를 확인해 주세요.');
      return;
    }
    if (!current.attached) {
      await chrome.debugger.attach(target, '1.3');
      current.attached = true;
      if (current.phase !== 'running') return;
      // Keep the editor focused inside the target page when its browser tab goes into the background.
      await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    if (current.phase !== 'running') return;
    const focus = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: guardExpression(current.target),
      returnByValue: true,
    }) as { result?: { value?: boolean } };
    if (current.phase !== 'running') return;
    if (!focus?.result?.value) {
      changePhase(current, 'paused', 'Google Docs 본문을 클릭해 입력 위치를 잡은 다음 재개해 주세요.');
      return;
    }
    sending = true;
    await sendCharacter(target, current.chunks[current.index]);
    current.index += 1;
    if (current.phase === 'running' && current.index === current.chunks.length) {
      changePhase(current, 'complete', '입력 요청이 끝났어요. Docs 본문을 복사해 원문과 비교할 수 있어요.');
    } else {
      publish(current);
    }
  } catch {
    if (sending) {
      changePhase(current, 'review', '마지막 글자가 반영됐는지 확인할 수 없어요. 문서와 원문을 비교해 주세요.');
    } else if (current.phase === 'running') {
      changePhase(current, 'paused', 'Chrome 입력 연결이 끊겼어요. Docs 편집 상태를 확인하고 재개해 주세요.');
    }
  } finally {
    current.busy = false;
    if (current.phase === 'running') {
      scheduleNext(current, started);
    } else {
      await release(current);
    }
  }
}

function pauseForTabChange(tabId: number): void {
  if (job?.phase === 'running' && job.target.tabId === tabId) {
    changePhase(job, 'paused', '대상 문서가 바뀌었어요. 원래 문서의 본문 커서를 확인해 주세요.');
  }
}

async function handle(port: ExtensionPort, data: unknown, connected: () => boolean): Promise<void> {
  const command = data as PanelCommand | undefined;
  if (!command || typeof command !== 'object') return;
  if (command.type === 'target') {
    post(port, { type: 'target', target: await activeTarget() });
    return;
  }
  if (command.type === 'start') {
    if (typeof command.text !== 'string' || !command.target || typeof command.wpm !== 'number') return;
    const problem = validateText(command.text);
    if (problem) throw new Error(problem);
    const nextInterval = createTypingPace(command.wpm);
    const target = await activeTarget();
    if (!connected()) return;
    if (job) throw new Error('다른 입력 작업이 진행 중이에요. 먼저 기존 작업을 중지해 주세요.');
    if (!target || !sameTarget(target, command.target)) throw new Error('대상 문서가 바뀌었어요. 문서를 다시 확인해 주세요.');
    job = { owner: port, target, chunks: splitText(command.text), index: 0, nextInterval, phase: 'running', attached: false, busy: false };
    publish(job);
    void tick(job);
    return;
  }
  const current = job;
  if (!current || current.owner !== port) return;
  if (command.type === 'speed' && (current.phase === 'running' || current.phase === 'paused')) {
    current.nextInterval = createTypingPace(command.wpm);
    if (current.timer !== undefined && current.lastTickStarted !== undefined) {
      scheduleNext(current, current.lastTickStarted);
    }
    return;
  }
  if (command.type === 'pause' && current.phase === 'running') {
    changePhase(current, 'paused', '일시정지했어요. 문서의 본문 커서를 확인하고 다시 시작할 수 있어요.');
  }
  if (command.type === 'stop') {
    changePhase(current, 'stopped', '입력을 중지했어요. 이미 들어간 내용은 문서에 남아요.');
  }
  if (command.type === 'resume' && current.phase === 'paused') {
    if (current.busy) throw new Error('이전 입력이 마무리 중이에요. 잠시 후 다시 재개해 주세요.');
    if (!sameTarget(await activeTarget(), current.target) || job !== current || current.phase !== 'paused' || current.busy) {
      throw new Error('처음 선택한 문서를 열고 본문 커서를 확인해 주세요.');
    }
    if (current.index === current.chunks.length) {
      changePhase(current, 'complete', '입력 요청이 끝났어요. Docs 본문을 복사해 원문과 비교할 수 있어요.');
      return;
    }
    changePhase(current, 'running');
    void tick(current);
  }
}

function configurePanel(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(configurePanel);
chrome.runtime.onStartup.addListener(configurePanel);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'docs-typer-panel' || port.sender?.id !== chrome.runtime.id || port.sender.url !== panelPath) return;
  let connected = true;
  port.onMessage.addListener((data) => {
    void handle(port, data, () => connected).catch((error: unknown) => {
      post(port, { type: 'error', message: error instanceof Error ? error.message : '입력 요청을 처리할 수 없어요.' });
    });
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    if (job?.owner === port) changePhase(job, 'stopped');
  });
});

chrome.tabs.onRemoved.addListener(pauseForTabChange);
chrome.tabs.onReplaced.addListener((_added, removed) => pauseForTabChange(removed));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || (change.url && docsUrl(change.url) !== job?.target.url)) pauseForTabChange(tabId);
});
chrome.debugger.onDetach.addListener(({ tabId }) => {
  const current = job;
  if (!current || current.target.tabId !== tabId || !current.attached) return;
  current.attached = false;
  if (current.phase === 'running') {
    changePhase(current, 'paused', 'Chrome 입력 연결이 종료됐어요. 문서를 확인하고 재개해 주세요.');
  }
});
