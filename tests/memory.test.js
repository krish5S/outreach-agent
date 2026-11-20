import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryCard, memoryCardToFacts, validateMemoryCard } from '../layers/memory.js';

const sections = {
  summary: ['Software engineer interested in accessible applications.'],
  experience: ['Frontend Engineer', 'Example Labs | 2021–2024', 'Built a dashboard for community organizations.'],
  education: ['Example University', 'Bachelor of Science, Computer Science | 2017–2021'],
  skills: ['JavaScript', 'TypeScript', 'Accessibility'],
  projects: ['Transit Helper — React, Node.js'],
  achievements: ['Won a university hackathon.'],
  interests: ['Civic technology']
};

test('buildMemoryCard sends only sanitized section JSON and adds the name locally', async () => {
  let request;
  const card = await buildMemoryCard(sections, {
    apiKey: 'fake-test-key',
    name: 'Alex Example',
    now: new Date('2026-11-20T00:00:00.000Z'),
    llm: async (options) => {
      request = options;
      return {
        headline: 'Software Engineer',
        summary: 'Builds accessible applications.',
        skills: ['JavaScript', 'TypeScript'],
        education: [{ school: 'Example University', degree: 'Bachelor of Science', field: 'Computer Science', years: '2017–2021' }],
        experience: [{ title: 'Frontend Engineer', org: 'Example Labs', years: '2021–2024', highlights: ['Built a dashboard.'] }],
        projects: [{ name: 'Transit Helper', summary: 'A route-planning app.', tech: ['React', 'Node.js'] }],
        achievements: ['Won a university hackathon.'],
        goals: '',
        interests: ['Civic technology'],
        name: 'This model-provided name must be ignored.',
        unknownField: 'discard this'
      };
    }
  });

  assert.equal(request.model, 'openai/gpt-oss-20b');
  assert.equal(request.json, true);
  assert.doesNotMatch(request.messages[0].content, /Alex Example/);
  assert.equal(card.name, 'Alex Example');
  assert.equal(card.updatedAt, '2026-11-20T00:00:00.000Z');
  assert.equal(card.email, undefined);
  assert.equal(card.unknownField, undefined);
  assert.equal(card.facts[0].id, 'M1');
  assert.ok(card.facts.every((fact) => fact.text.length <= 200));
  assert.ok(card.facts.every((fact) => fact.source === 'me'));
});

test('a model response cannot put the locally supplied name back into other fields', () => {
  assert.throws(() => validateMemoryCard({
    summary: 'Alex Example is a software engineer.'
  }, { name: 'Alex Example' }), /name/);
});

test('validateMemoryCard repairs missing arrays, caps facts, and drops unknown fields', () => {
  const card = validateMemoryCard({
    headline: ' Engineer ',
    summary: 'A short summary.',
    skills: [' JavaScript '],
    experience: [{ title: 'Engineer', org: 'Example Co', years: '2022-present', highlights: ['Built things.'] }],
    unknownField: 'discard this'
  }, { name: 'Local Name', now: new Date('2026-11-20T00:00:00.000Z') });

  assert.equal(card.headline, 'Engineer');
  assert.equal(card.name, 'Local Name');
  assert.deepEqual(card.education, []);
  assert.deepEqual(card.skills, ['JavaScript']);
  assert.equal(card.unknownField, undefined);
  assert.ok(card.facts.length <= 40);
  assert.ok(card.facts.every((fact) => fact.text.length <= 200));
  assert.throws(() => validateMemoryCard({ skills: ['user@example.test'] }), /email/);
});

test('memoryCardToFacts creates unique IDs and caps the collection at 40', () => {
  const card = {
    skills: Array.from({ length: 50 }, (_, index) => 'Skill ' + index),
    experience: [{ title: 'Engineer', org: 'Example', years: '2020–present', highlights: [] }]
  };
  const facts = memoryCardToFacts(card);
  assert.equal(facts.length, 40);
  assert.equal(new Set(facts.map((fact) => fact.id)).size, facts.length);
  assert.equal(facts[0].id, 'M1');
});
