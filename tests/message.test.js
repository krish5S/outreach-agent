import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGeneratedMessage } from '../utils/message.js';

test('removes an AI placeholder signature when sender name is not set', () => {
  assert.equal(
    sanitizeGeneratedMessage('Hi Krish,\n\nI would love to connect.\n\nBest, [Your Name]'),
    'Hi Krish,\n\nI would love to connect.\n\nBest,'
  );
});

test('replaces an AI placeholder with the configured sender name', () => {
  assert.equal(
    sanitizeGeneratedMessage('Hi Krish,\n\nBest,\n[Your Name]', 'Alex Example'),
    'Hi Krish,\n\nBest,\nAlex Example'
  );
});

test('removes an unbracketed placeholder only from the final signature', () => {
  assert.equal(sanitizeGeneratedMessage('Please tell me your name.\n\nRegards,\nYour Name'), 'Please tell me your name.\n\nRegards,');
});
