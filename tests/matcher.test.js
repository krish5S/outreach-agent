import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/utils/config.js';
import { keywordEmbed } from '../src/utils/embeddings.js';
import { cosine, matchFacts } from '../src/utils/matcher.js';

function fact(id, source, text, type = 'about', extra = {}) {
  return { id, source, text, type, vec: keywordEmbed(text), meta: extra.meta || {} };
}

test('cosine returns expected similarity and handles empty or incompatible vectors', () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosine([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-12);
  assert.equal(cosine([0, 0], [1, 0]), 0);
  assert.equal(cosine([1], [1, 0]), 0);
});

test('tiers follow the configured strong and medium thresholds', () => {
  const me = [
    { id: 'M1', type: 'about', text: 'A', vec: [1, 0], meta: {} },
    { id: 'M2', type: 'about', text: 'B', vec: [1, 0], meta: {} }
  ];
  const others = [
    { id: 'P1', type: 'about', text: 'strong boundary', vec: [CONFIG.thresholds.strong, Math.sqrt(1 - CONFIG.thresholds.strong ** 2)], meta: {} },
    { id: 'P2', type: 'about', text: 'medium boundary', vec: [CONFIG.thresholds.medium, Math.sqrt(1 - CONFIG.thresholds.medium ** 2)], meta: {} },
    { id: 'P3', type: 'about', text: 'below threshold', vec: [CONFIG.thresholds.medium - 0.01, 1], meta: {} }
  ];
  const matches = matchFacts(me, others);
  assert.equal(matches[0].tier, 'strong');
  assert.equal(matches[0].otherFactId, 'P1');
  assert.ok(matches.some((match) => match.otherFactId === 'P2' && match.tier === 'medium'));
  assert.ok(!matches.some((match) => match.otherFactId === 'P3'));
});

test('the same school or employer is a strong exact match regardless of vector score', () => {
  const me = [
    { id: 'M1', source: 'me', type: 'education', text: 'BSc Computer Science', vec: [1, 0], meta: { entity: 'D. J. Sanghvi College of Engineering' } },
    { id: 'M2', source: 'me', type: 'company', text: 'Acme Robotics', vec: [0, 1], meta: { entity: 'Acme Robotics' } }
  ];
  const other = [
    { id: 'P1', source: 'person', type: 'education', text: 'DJSCE', vec: [0, 1], meta: { entity: 'D. J. Sanghvi College of Engineering' } },
    { id: 'P2', source: 'person', type: 'company', text: 'Previously at Acme', vec: [1, 0], meta: { entity: 'Acme Robotics' } }
  ];
  const matches = matchFacts(me, other);
  assert.equal(matches.length, 2);
  assert.ok(matches.every((match) => match.tier === 'strong' && match.exact && match.score === 1));
});

test('an exact named tool overrides a low text similarity', () => {
  const matches = matchFacts(
    [{ id: 'M1', type: 'skill', text: 'Skill: PyTorch', vec: [1, 0], meta: { entities: ['PyTorch'] } }],
    [{ id: 'P1', type: 'skill', text: 'Deep learning frameworks', vec: [0, 1], meta: { entities: ['PyTorch'] } }]
  );
  assert.equal(matches[0].tier, 'strong');
  assert.equal(matches[0].exact, true);
});

test('a resume skill matches LinkedIn skill labels with a programming-language qualifier', () => {
  const matches = matchFacts(
    [{ id: 'M1', type: 'skill', text: 'Skill: Python', vec: [1, 0], meta: { entities: ['Python'] } }],
    [{ id: 'P1', type: 'skill', text: 'Python (Programming Language)', vec: [0, 1], meta: { entities: ['Python (Programming Language)'] } }]
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, 'strong');
  assert.equal(matches[0].exact, true);
});

test('generic-only overlap is penalized and cannot be strong', () => {
  const matches = matchFacts(
    [fact('M1', 'me', 'Software engineer')],
    [fact('P1', 'person', 'Software engineer')]
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, 'medium');
  assert.ok(matches[0].score < CONFIG.thresholds.strong);
});

test('unrelated facts do not produce a match', () => {
  const matches = matchFacts(
    [fact('M1', 'me', 'Python programming language', 'skill', { meta: { entities: ['Python'] } })],
    [fact('P1', 'person', 'Jazz performance and music composition', 'skill', { meta: { entities: ['Jazz'] } })]
  );
  assert.deepEqual(matches, []);
});

test('matching deduplicates both facts and returns no more than the top six', () => {
  const me = Array.from({ length: 8 }, (_, index) => ({
    id: 'M' + index,
    type: 'skill',
    text: 'Skill ' + index,
    vec: [1, 0],
    meta: { entities: ['Tool ' + index] }
  }));
  const other = Array.from({ length: 8 }, (_, index) => ({
    id: 'P' + index,
    type: 'skill',
    text: 'Other text ' + index,
    vec: [0, 1],
    meta: { entities: ['Tool ' + index] }
  }));
  const matches = matchFacts(me, other);
  assert.equal(matches.length, 6);
  assert.equal(new Set(matches.map((match) => match.meFactId)).size, matches.length);
  assert.equal(new Set(matches.map((match) => match.otherFactId)).size, matches.length);
});

test('a fact can be used only once even when two other facts share it', () => {
  const matches = matchFacts(
    [{ id: 'M1', type: 'about', text: 'shared fact', vec: [1, 0], meta: {} }],
    [
      { id: 'P1', type: 'about', text: 'shared fact one', vec: [1, 0], meta: {} },
      { id: 'P2', type: 'about', text: 'shared fact two', vec: [1, 0], meta: {} }
    ]
  );
  assert.equal(matches.length, 1);
});
