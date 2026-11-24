import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTypingPace, docsUrl, firstDifference, intervalMs, splitText, validateText } from '../dist/typing.js';

test('keeps graphemes and blank lines intact', () => {
  const source = '한A\r\n\r\n👩🏽‍💻e\u0301\n';
  assert.deepEqual(splitText(source), ['한', 'A', '\n', '\n', '👩🏽‍💻', 'e\u0301', '\n']);
  assert.equal(firstDifference(source, '한A\n\n👩🏽‍💻e\u0301\n'), undefined);
  assert.equal(firstDifference(source, '한A\n👩🏽‍💻e\u0301\n'), 4);
  assert.equal(validateText('한글\nEnglish'), undefined);
  assert.ok(validateText('x\ty'));
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
