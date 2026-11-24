export const MIN_WPM = 15;
export const MAX_WPM = 100;
export const DEFAULT_WPM = 40;
export const MAX_LENGTH = 60_000;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function splitText(text: string): string[] {
  return Array.from(segmenter.segment(normalizeText(text)), ({ segment }) => segment);
}

export function validateText(text: string): string | undefined {
  if (!text.trim()) return '입력할 글을 붙여넣어 주세요.';
  if (text.length > MAX_LENGTH) return '한 번에 최대 60,000자까지 입력할 수 있어요.';
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(normalizeText(text))) {
    return '탭 문자나 지원하지 않는 제어 문자가 있어요. 일반 공백으로 바꿔 주세요.';
  }
}

export function intervalMs(wpm: number): number {
  if (!Number.isFinite(wpm) || wpm < MIN_WPM || wpm > MAX_WPM) {
    throw new RangeError('입력 속도는 15~100 WPM 사이로 설정해 주세요.');
  }
  return 60_000 / (5 * wpm);
}

export function createTypingPace(wpm: number, random = Math.random): () => number {
  const baseline = intervalMs(wpm);
  let position = 0;
  let length = 0;
  let amplitude = 0;

  // Each full wave has zero mean, so successive waves stay centered on the selected WPM.
  return () => {
    if (position === length) {
      position = 0;
      length = 8 + 2 * Math.floor(random() * 3);
      amplitude = (0.25 + random() * 0.10) * (random() < 0.5 ? -1 : 1);
    }
    const offset = amplitude * Math.sin(2 * Math.PI * position / length);
    position += 1;
    return baseline * (1 + offset);
  };
}

export function docsUrl(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://docs.google.com') return;
    if (!/^\/document\/(?:u\/\d+\/)?d\/[\w-]+\/edit\/?$/.test(url.pathname)) return;
    // A Docs document may contain multiple independently editable document tabs.
    return url.origin + url.pathname.replace(/\/$/, '') + '?tab=' + (url.searchParams.get('tab') || 't.0');
  } catch {
    return undefined;
  }
}

function differenceParts(chars: string[], start: number, end: number) {
  return {
    before: chars.slice(0, start).join(''),
    change: chars.slice(start, end).join(''),
    after: chars.slice(end).join(''),
    count: end - start,
  };
}

export function firstDifference(expected: string, actual: string) {
  const left = splitText(expected);
  const right = splitText(actual);
  let start = 0;
  while (start < left.length && left[start] === right[start]) start += 1;
  if (start === left.length && start === right.length) return;

  // Trim the shared ending too, so a missing character doesn't flag all the text after it.
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  return {
    position: start + 1,
    expected: differenceParts(left, start, leftEnd),
    actual: differenceParts(right, start, rightEnd),
  };
}
