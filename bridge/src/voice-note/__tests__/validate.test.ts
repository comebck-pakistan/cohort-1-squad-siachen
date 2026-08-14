// Unit tests for isValidTranscript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTranscript } from '../validate';

test('rejects null / undefined / empty', () => {
  assert.equal(isValidTranscript(null), false);
  assert.equal(isValidTranscript(undefined), false);
  assert.equal(isValidTranscript(''), false);
  assert.equal(isValidTranscript('   '), false);
});

test('rejects too-short transcripts', () => {
  assert.equal(isValidTranscript('.'), false);
  assert.equal(isValidTranscript('?'), false);
  assert.equal(isValidTranscript(' a '), false); // stripped = 'a' = length 1
});

test('rejects punctuation-only transcripts', () => {
  assert.equal(isValidTranscript('...'), false);
  assert.equal(isValidTranscript('?!?!'), false);
  assert.equal(isValidTranscript('---'), false);
});

test('rejects Groq noise tokens (case-insensitive)', () => {
  assert.equal(isValidTranscript('music'), false);
  assert.equal(isValidTranscript('Music'), false);
  assert.equal(isValidTranscript('[Music]'), false);
  assert.equal(isValidTranscript('(music)'), false);
  assert.equal(isValidTranscript('inaudible'), false);
  assert.equal(isValidTranscript('[inaudible]'), false);
  assert.equal(isValidTranscript('silence'), false);
  assert.equal(isValidTranscript('(silence)'), false);
  assert.equal(isValidTranscript('background noise'), false);
  assert.equal(isValidTranscript('[background noise]'), false);
  assert.equal(isValidTranscript('applause'), false);
  assert.equal(isValidTranscript('[Applause]'), false);
  assert.equal(isValidTranscript('laughter'), false);
  assert.equal(isValidTranscript('static'), false);
  assert.equal(isValidTranscript('(static)'), false);
});

test('accepts normal transcripts (Urdu / English / code-switched)', () => {
  assert.equal(isValidTranscript('hi'), true);
  assert.equal(isValidTranscript('Hello'), true);
  assert.equal(isValidTranscript('mujhe kal appointment chahiye'), true);
  assert.equal(
    isValidTranscript('Mujhe facial chahiye tomorrow 4 baje'),
    true
  );
  assert.equal(
    isValidTranscript('I want to book a haircut for tomorrow at 4 PM'),
    true
  );
  assert.equal(isValidTranscript('ok'), true);
});

test('accepts transcripts that mention noise in context', () => {
  // "I heard music in the background" — partial sentence with 'music' is
  // legitimate input and must NOT be flagged.
  assert.equal(
    isValidTranscript('I heard music in the background, what time?'),
    true
  );
  assert.equal(
    isValidTranscript('There was applause, can you repeat?'),
    true
  );
});