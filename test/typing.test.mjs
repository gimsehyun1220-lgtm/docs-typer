import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTypingPace, docsUrl, firstDifference, intervalMs, splitText, validateText } from '../dist/typing.js';

test('keeps graphemes and blank lines intact', () => {
  const source = '한A\r\n\r\n👩🏽‍💻e\u0301\n';
  assert.deepEqual(splitText(source), ['한', 'A', '\n', '\n', '👩🏽‍💻', 'e\u0301', '\n']);
  assert.equal(firstDifference(source, '한A\n\n👩🏽‍💻e\u0301\n'), undefined);
  assert.deepEqual(firstDifference(source, '한A\n👩🏽‍💻e\u0301\n'), {
    position: 4,
    expected: { before: '한A\n', change: '\n', after: '👩🏽‍💻e\u0301\n', count: 1 },
    actual: { before: '한A\n', change: '', after: '👩🏽‍💻e\u0301\n', count: 0 },
  });
  assert.equal(validateText('한글\nEnglish'), undefined);
  assert.ok(validateText('x\ty'));
});

test('isolates missing, extra and replaced graphemes, including at the end', () => {
  assert.deepEqual(firstDifference('한👩🏽‍💻글', '한글'), {
    position: 2,
    expected: { before: '한', change: '👩🏽‍💻', after: '글', count: 1 },
    actual: { before: '한', change: '', after: '글', count: 0 },
  });
  assert.deepEqual(firstDifference('한글', '한글 '), {
    position: 3,
    expected: { before: '한글', change: '', after: '', count: 0 },
    actual: { before: '한글', change: ' ', after: '', count: 1 },
  });
  assert.deepEqual(firstDifference('빨간색', '파란색'), {
    position: 1,
    expected: { before: '', change: '빨간', after: '색', count: 2 },
    actual: { before: '', change: '파란', after: '색', count: 2 },
  });
});

test('keeps the full text around a difference without cutting off graphemes', () => {
  const before = '한'.repeat(20);
  const missing = '👩🏽‍💻'.repeat(33);
  const after = '글'.repeat(20);
  const result = firstDifference(before + missing + after, before + after);
  assert.equal(result.position, 21);
  assert.deepEqual(result.expected, {
    before,
    change: missing,
    after,
    count: 33,
  });
  assert.deepEqual(result.actual, { before, change: '', after, count: 0 });
});

test('derives an interval from the pace the user chooses', () => {
  assert.equal(intervalMs(40), 300);
  assert.equal(intervalMs(100), 120);
  assert.throws(() => intervalMs(Infinity), RangeError);
  assert.throws(() => intervalMs(5), RangeError);
});

test('varies pace smoothly and keeps the average interval at the selected WPM', () => {
  const randomValues = [0, 0, 0, 0.99, 0.99, 0.99];
  const nextInterval = createTypingPace(40, () => randomValues.shift());
  const intervals = Array.from({ length: 20 }, nextInterval);

  assert.equal(intervals[0], 300);
  assert.equal(intervals[8], 300);
  assert.equal(intervals[2], 225);
  assert.equal(intervals[6], 375);
  assert.ok(intervals[11] > 400 && intervals[17] < 200);
  assert.ok(intervals.every((ms) => ms >= 195 && ms <= 405));
  const mean = intervals.reduce((sum, ms) => sum + ms, 0) / intervals.length;
  assert.ok(Math.abs(mean - 300) < 1e-9);
});

test('accepts only Docs editor URLs and distinguishes document tabs', () => {
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/edit#heading=x'), 'https://docs.google.com/document/d/abc/edit?tab=t.0');
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/edit?tab=t.3'), 'https://docs.google.com/document/d/abc/edit?tab=t.3');
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/view'), undefined);
  assert.equal(docsUrl('https://docs.google.com.evil.example/document/d/abc/edit'), undefined);
  assert.equal(docsUrl('https://docs.google.com/document/d/e/published/pub'), undefined);
});
