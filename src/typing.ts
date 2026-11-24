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

export function firstDifference(expected: string, actual: string): number | undefined {
  const left = splitText(expected);
  const right = splitText(actual);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return i + 1;
  }
}
