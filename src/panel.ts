import type { PanelCommand, Snapshot, Target, WorkerMessage } from './protocol.js';
import { DEFAULT_WPM, MAX_WPM, MIN_WPM, firstDifference, intervalMs, splitText, validateText } from './typing.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = element<HTMLTextAreaElement>('source');
const speed = element<HTMLInputElement>('speed');
const ready = element<HTMLInputElement>('ready');
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const refresh = element<HTMLButtonElement>('refresh');
const progress = element<HTMLProgressElement>('progress');
const verification = element<HTMLDetailsElement>('verification');
const resultText = element<HTMLTextAreaElement>('result-text');
const status = element('status');
const presets = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'));
const formatted = new Intl.NumberFormat('ko-KR');
let target: Target | undefined;
let state: Snapshot = { phase: 'idle', done: 0, total: 0 };
let pending = false;
let connected = true;
let count = 0;
let inputProblem: string | undefined;
let approved = '';
const port = chrome.runtime.connect({ name: 'docs-typer-panel' });

function report(message: string, error = false): void {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function send(command: PanelCommand): void {
  try {
    port.postMessage(command);
  } catch {
    connected = false;
    pending = false;
    report('확장 프로그램 연결이 끊겼어요. 사이드패널을 다시 열어 주세요.', true);
    render();
  }
}

function measure(): void {
  inputProblem = validateText(source.value);
  count = splitText(source.value).length;
}

function render(): void {
  const { phase, done, total } = state;
  const working = phase === 'running' || phase === 'paused';
  const title = working ? state.target?.title : target?.title;
  element('target-title').textContent = title ?? 'Google Docs 편집 탭을 열어 주세요.';
  element('confirmation').hidden = phase === 'running';
  element('ready-label').textContent = phase === 'paused'
    ? '원래 문서에서 이어 쓸 위치를 확인했어요.'
    : '빈 문서에서 입력할 위치를 클릭했어요.';
  source.readOnly = working;
  speed.disabled = working;
  refresh.disabled = working || pending || !connected;
  for (const preset of presets) {
    preset.disabled = working;
    preset.setAttribute('aria-pressed', String(Number(preset.dataset.speed) === speed.valueAsNumber));
  }
  const wpm = speed.valueAsNumber;
  const validSpeed = Number.isInteger(wpm) && wpm >= MIN_WPM && wpm <= MAX_WPM;
  const seconds = validSpeed ? Math.ceil(count * intervalMs(wpm) / 1000) : 0;
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
  element('estimate').textContent = count && validSpeed
    ? `${formatted.format(count)}자 · 약 ${time}`
    : `${formatted.format(count)}자`;
  element('speed-hint').textContent = validSpeed ? `${wpm} WPM은 분당 약 ${wpm * 5}자예요.` : '15~100 사이의 정수를 입력해 주세요.';
  start.textContent = phase === 'running' ? '일시정지' : phase === 'paused' ? '재개' : '입력 시작';
  start.disabled = !connected || pending
    || (phase === 'paused' && !ready.checked)
    || (!working && (!ready.checked || !target || !!inputProblem || !validSpeed));
  stop.hidden = !working;
  stop.disabled = !connected || pending;
  element('progress-wrap').hidden = phase === 'idle';
  progress.max = Math.max(1, total);
  progress.value = done;
  element('progress-text').textContent = `${formatted.format(done)} / ${formatted.format(total)}자`;
  verification.hidden = !approved || !['complete', 'review', 'stopped'].includes(phase);
}

refresh.addEventListener('click', () => {
  ready.checked = false;
  report('');
  send({ type: 'target' });
  render();
});
source.addEventListener('input', () => {
  measure();
  report(source.value && inputProblem ? inputProblem : '', true);
  render();
});
speed.addEventListener('input', render);
ready.addEventListener('change', render);
for (const preset of presets) {
  preset.addEventListener('click', () => {
    speed.value = preset.dataset.speed ?? String(DEFAULT_WPM);
    render();
  });
}
start.addEventListener('click', () => {
  pending = true;
  if (state.phase === 'running') send({ type: 'pause' });
  else if (state.phase === 'paused') send({ type: 'resume' });
  else if (target) {
    approved = source.value;
    resultText.value = '';
    element('difference').textContent = '';
    verification.open = false;
    send({ type: 'start', target, text: approved, wpm: speed.valueAsNumber });
  }
  render();
});
stop.addEventListener('click', () => {
  pending = true;
  send({ type: 'stop' });
  render();
});
element<HTMLButtonElement>('compare').addEventListener('click', () => {
  const mismatch = firstDifference(approved, resultText.value);
  element('difference').textContent = mismatch === undefined
    ? '복사한 본문이 원문과 일치해요.'
    : `${formatted.format(mismatch)}번째 글자부터 달라요. 공백과 줄바꿈을 확인해 주세요.`;
});

port.onMessage.addListener((data) => {
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
});
port.onDisconnect.addListener(() => {
  connected = false;
  pending = false;
  state = { ...state, phase: 'review' };
  report('확장 프로그램 연결이 끊겼어요. 문서에서 마지막 입력 위치를 확인해 주세요.', true);
  render();
});

send({ type: 'target' });
measure();
render();
