import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeepPipeline } from '../src/layers/pipeline.js';

test('pipeline emits ordered progress and returns a placeholder draft', async () => {
  const events = [];
  const result = await runDeepPipeline({
    runId: 'run-test',
    profileJSON: { profileUrl: 'https://www.linkedin.com/in/fake-person/' },
    goal: 'internship',
    messageType: 'message'
  }, { emit: (event) => events.push(event) });

  assert.deepEqual(
    events.filter((event) => event.status === 'start').map((event) => event.layer),
    ['memory', 'company', 'approach']
  );
  assert.equal(result.runId, 'run-test');
  assert.equal(result.profileUrl, 'https://www.linkedin.com/in/fake-person/');
  assert.equal(result.drafts.length, 1);
  assert.match(result.drafts[0].text, /placeholder/i);
});

test('a failing layer is reported while later layers still run', async () => {
  const events = [];
  const called = [];
  const result = await runDeepPipeline({}, {
    emit: (event) => events.push(event),
    layers: {
      memory: async () => { called.push('memory'); throw new Error('memory stub failed'); },
      company: async () => { called.push('company'); return { status: 'skipped', detail: 'no company lookup yet' }; },
      approach: async () => { called.push('approach'); return { status: 'done', draft: 'Placeholder draft.' }; }
    }
  });

  assert.deepEqual(called, ['memory', 'company', 'approach']);
  assert.equal(result.layers.memory.status, 'error');
  assert.equal(result.layers.company.status, 'skipped');
  assert.equal(result.layers.approach.status, 'done');
  assert.ok(events.some((event) => event.layer === 'memory' && event.status === 'error'));
  assert.equal(result.drafts[0].text, 'Placeholder draft.');
});

test('the default pipeline runs Layer 1 and includes its matches in the result', async () => {
  const result = await runDeepPipeline({
    profileJSON: { skills: ['Python'] },
    memoryCard: { skills: ['Python'] }
  });
  assert.equal(result.layers.memory.status, 'done');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].tier, 'strong');
  assert.match(result.layers.memory.detail, /match/);
});
