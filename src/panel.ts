import type { PanelCommand, Snapshot, Target, WorkerMessage } from './protocol.js';
import { DEFAULT_WPM, MAX_WPM, MIN_WPM, firstDifference, intervalMs, normalizeText, splitText, validateText } from './typing.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panel = document.querySelector('main')!;
const source = element<HTMLTextAreaElement>('source');
const speed = element<HTMLInputElement>('speed');
const ready = element<HTMLInputElement>('ready');
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const refresh = element<HTMLButtonElement>('refresh');
const progress = element<HTMLProgressElement>('progress');
const progressFill = element('progress-fill');
const verification = element<HTMLDetailsElement>('verification');
const resultText = element<HTMLTextAreaElement>('result-text');
const compare = element<HTMLButtonElement>('compare');
const compareHint = element('compare-hint');
const comparisonCount = element('comparison-count');
const difference = element('difference');
const differenceExcerpts = element('difference-excerpts');
const status = element('status');
const presets = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'));
const formatted = new Intl.NumberFormat('ko-KR');
let target: Target | undefined;
let state: Snapshot = { phase: 'idle', done: 0, total: 0 };
let pending = false;
let count = 0;
let inputProblem: string | undefined;
let port: ExtensionPort | undefined;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

function report(message: string, error = false): void {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function send(command: PanelCommand): void {
  try {
    if (!port) {
      const connection = chrome.runtime.connect({ name: 'docs-typer-panel' });
      port = connection;
      connection.onMessage.addListener((data) => {
        if (port === connection) receive(data);
      });
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = undefined;
        if (pending || state.phase === 'running' || state.phase === 'paused') {
          state = { ...state, phase: 'review' };
          ready.checked = false;
          report('연결이 끊겼습니다. 문서에서 마지막으로 입력된 글자를 확인하세요.', true);
        }
        pending = false;
        render();
      });
    }
    port.postMessage(command);
  } catch {
    port = undefined;
    pending = false;
    ready.checked = false;
    if (state.phase === 'running' || state.phase === 'paused') state = { ...state, phase: 'review' };
    report('연결이 끊겼습니다. 패널을 다시 여세요.', true);
    render();
  }
}

function measure(): void {
  inputProblem = validateText(source.value);
  count = splitText(source.value).length;
  updateComparisonCount();
}

function updateComparisonCount(): void {
  const pasted = splitText(resultText.value).length;
  comparisonCount.textContent = `원문 ${formatted.format(count)}자 · 붙여넣은 본문 ${formatted.format(pasted)}자`;
}

function isValidSpeed(wpm: number): boolean {
  return Number.isInteger(wpm) && wpm >= MIN_WPM && wpm <= MAX_WPM;
}

function updateSpeed(): void {
  const wpm = speed.valueAsNumber;
  if (isValidSpeed(wpm) && (state.phase === 'running' || state.phase === 'paused')) {
    send({ type: 'speed', wpm });
  }
  render();
}

function clearComparison(): void {
  difference.textContent = '';
  differenceExcerpts.hidden = true;
}

function showDifference(output: HTMLElement, parts: { before: string; change: string; after: string }, gap: string): void {
  const mark = document.createElement('mark');
  mark.textContent = parts.change ? parts.change.replaceAll('\n', '↵\n') : gap;
  mark.classList.toggle('difference-gap', !parts.change);
  output.replaceChildren(parts.before, mark, parts.after);
  const start = mark.getBoundingClientRect().top - output.getBoundingClientRect().top;
  output.scrollTop += start - 32;
}

function render(): void {
  const { phase, done, total } = state;
  if (phase === 'paused' && port) {
    // The debugger is detached while paused. Keep the in-memory job available for resume.
    keepAliveTimer ??= setInterval(() => send({ type: 'keep-alive' }), 20_000);
  } else if (keepAliveTimer !== undefined) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = undefined;
  }
  panel.dataset.phase = phase;
  const working = phase === 'running' || phase === 'paused';
  const title = working ? state.target?.title : target?.title;
  element('target-title').textContent = title ?? 'Google Docs 문서를 여세요.';
  element('confirmation').hidden = phase === 'running';
  element('ready-label').textContent = phase === 'paused'
    ? '이어서 입력할 위치를 확인했습니다'
    : '빈 문서에 커서를 뒀습니다';
  source.readOnly = working;
  speed.disabled = pending && !working;
  refresh.disabled = working || pending;
  for (const preset of presets) {
    preset.disabled = speed.disabled;
    preset.setAttribute('aria-pressed', String(Number(preset.dataset.speed) === speed.valueAsNumber));
  }
  const wpm = speed.valueAsNumber;
  const validSpeed = isValidSpeed(wpm);
  const seconds = validSpeed ? Math.ceil(count * intervalMs(wpm) / 1000) : 0;
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
  element('estimate').textContent = count && validSpeed
    ? `${formatted.format(count)}자 · 약 ${time}`
    : `${formatted.format(count)}자`;
  element('speed-hint').textContent = validSpeed ? `분당 약 ${wpm * 5}자` : '15~100 사이의 정수를 입력하세요.';
  start.textContent = phase === 'running' ? '일시정지' : phase === 'paused' ? '재개' : '입력 시작';
  start.disabled = pending
    || (phase === 'paused' && !ready.checked)
    || (!working && (!ready.checked || !target || !!inputProblem || !validSpeed));
  stop.hidden = !working;
  stop.disabled = pending;
  element('progress-wrap').hidden = phase === 'idle';
  progress.max = Math.max(1, total);
  progress.value = done;
  progressFill.style.setProperty('--fraction', String(progress.position));
  element('progress-text').textContent = `${formatted.format(done)} / ${formatted.format(total)}자`;
  compare.disabled = !source.value.trim();
  compareHint.hidden = !compare.disabled;
}

refresh.addEventListener('click', () => {
  ready.checked = false;
  report('');
  send({ type: 'target' });
  render();
});
function refreshDocument(): void {
  if (!pending && state.phase !== 'running' && state.phase !== 'paused') send({ type: 'target' });
}
window.addEventListener('focus', refreshDocument);
source.addEventListener('focus', refreshDocument);
source.addEventListener('input', () => {
  clearComparison();
  measure();
  report(source.value && inputProblem ? inputProblem : '', true);
  render();
});
speed.addEventListener('input', updateSpeed);
ready.addEventListener('change', render);
for (const preset of presets) {
  preset.addEventListener('click', () => {
    speed.value = preset.dataset.speed ?? String(DEFAULT_WPM);
    updateSpeed();
  });
}
start.addEventListener('click', () => {
  pending = true;
  if (state.phase === 'running') send({ type: 'pause' });
  else if (state.phase === 'paused') send({ type: 'resume' });
  else if (target) {
    resultText.value = '';
    clearComparison();
    updateComparisonCount();
    verification.open = false;
    send({ type: 'start', target, text: source.value, wpm: speed.valueAsNumber });
  }
  render();
});
stop.addEventListener('click', () => {
  pending = true;
  send({ type: 'stop' });
  render();
});
resultText.addEventListener('input', () => {
  clearComparison();
  updateComparisonCount();
});
compare.addEventListener('click', () => {
  const mismatch = firstDifference(source.value, resultText.value);
  const expectedOutput = element('expected-excerpt');
  const actualOutput = element('actual-excerpt');
  differenceExcerpts.hidden = false;
  if (!mismatch) {
    difference.textContent = '원문과 일치합니다.';
    expectedOutput.textContent = normalizeText(source.value);
    actualOutput.textContent = normalizeText(resultText.value);
    expectedOutput.scrollTop = 0;
    actualOutput.scrollTop = 0;
    return;
  }
  const { position, expected, actual } = mismatch;
  const at = `${formatted.format(position)}번째 글자부터`;
  if (!actual.count) difference.textContent = `${at} ${formatted.format(expected.count)}자가 빠졌어요.`;
  else if (!expected.count) difference.textContent = `${at} ${formatted.format(actual.count)}자가 더 들어갔어요.`;
  else difference.textContent = `${at} 내용이 달라요.`;
  showDifference(expectedOutput, expected, '추가 위치');
  showDifference(actualOutput, actual, '누락 위치');
});

function receive(data: unknown): void {
  const message = data as WorkerMessage;
  if (message.type === 'target') {
    if (target?.tabId !== message.target?.tabId || target?.url !== message.target?.url) ready.checked = false;
    target = message.target;
  } else if (message.type === 'error') {
    pending = false;
    report(message.message, true);
  } else if (message.type === 'state') {
    if (state.phase !== message.state.phase) {
      ready.checked = false;
      report(message.state.message ?? '', message.state.phase === 'review');
    }
    state = message.state;
    pending = false;
  }
  render();
}

send({ type: 'target' });
measure();
render();
