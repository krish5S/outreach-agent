import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../utils/storage.js';

function makeArea(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get(keys, callback) {
      const selected = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.prototype.hasOwnProperty.call(values, key)) selected[key] = values[key];
      }
      callback(selected);
    },
    set(items, callback) {
      Object.assign(values, items);
      callback();
    },
    remove(keys, callback) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      callback();
    },
    clear(callback) {
      for (const key of Object.keys(values)) delete values[key];
      callback();
    }
  };
}

test('saving a memory card keeps it locally and removes a legacy PDF only after save', async () => {
  const localArea = makeArea({
    resumeBase64: 'legacy-pdf-data',
    resumeFileName: 'old-resume.pdf',
    userName: 'Alex Example'
  });
  const storage = createStorage({ localArea, sessionArea: makeArea() });
  const card = { version: 1, name: 'Alex Example', skills: ['TypeScript'] };

  await storage.setMemoryCard(card);
  assert.equal((await storage.getMemoryCard()).name, 'Alex Example');
  assert.equal(localArea.values.resumeBase64, 'legacy-pdf-data');

  await storage.clearLegacyResume();
  assert.equal(localArea.values.resumeBase64, undefined);
  assert.equal(localArea.values.resumeFileName, undefined);
  assert.equal((await storage.getMemoryCard()).name, 'Alex Example');
});

test('clearAllData clears local and session extension data', async () => {
  const localArea = makeArea({ memoryCard: { name: 'Alex' }, recentContacts: [1] });
  const sessionArea = makeArea({ activeRun: { status: 'running' } });
  const storage = createStorage({ localArea, sessionArea });

  await storage.clearAllData();

  assert.deepEqual(localArea.values, {});
  assert.deepEqual(sessionArea.values, {});
});
