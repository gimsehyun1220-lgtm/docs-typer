import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docsUrl, firstDifference, intervalMs, splitText, validateText } from '../dist/typing.js';

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

test('accepts only Docs editor URLs and distinguishes document tabs', () => {
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/edit#heading=x'), 'https://docs.google.com/document/d/abc/edit?tab=t.0');
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/edit?tab=t.3'), 'https://docs.google.com/document/d/abc/edit?tab=t.3');
  assert.equal(docsUrl('https://docs.google.com/document/d/abc/view'), undefined);
  assert.equal(docsUrl('https://docs.google.com.evil.example/document/d/abc/edit'), undefined);
  assert.equal(docsUrl('https://docs.google.com/document/d/e/published/pub'), undefined);
});
