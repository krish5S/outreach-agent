import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { profileToFacts } from '../src/utils/facts.js';

const fixtureUrl = new URL('./fixtures/profile-ada-example.json', import.meta.url);
const profile = JSON.parse(await readFile(fixtureUrl, 'utf8'));

test('profileToFacts maps the real scraper shape to distinct facts', () => {
  const facts = profileToFacts(profile);
  const types = new Set(facts.map((fact) => fact.type));
  assert.ok(types.has('role'));
  assert.ok(types.has('company'));
  assert.ok(types.has('about'));
  assert.ok(types.has('education'));
  assert.ok(types.has('skill'));
  assert.ok(types.has('location'));
  assert.ok(types.has('post'));
  assert.equal(facts.find((fact) => fact.type === 'education').meta.entity, 'Example University');
  assert.equal(facts.find((fact) => fact.type === 'company').meta.entity, 'Example Robotics Lab');
  assert.ok(facts.find((fact) => fact.type === 'skill').meta.entities.includes('Python'));
  assert.equal(new Set(facts.map((fact) => fact.id)).size, facts.length);
  assert.ok(facts.every((fact) => fact.source === 'person'));
  assert.ok(facts.every((fact) => fact.text.length > 0 && fact.text.length <= 200));
});

test('about text is split into no more than two short facts', () => {
  const facts = profileToFacts({
    about: 'First useful sentence. Second useful sentence. Third sentence that should be omitted.'
  }).filter((fact) => fact.type === 'about');
  assert.ok(facts.length <= 2);
  assert.ok(facts.every((fact) => fact.text.length <= 200));
});

test('empty profiles do not create empty facts', async () => {
  const emptyUrl = new URL('./fixtures/profile-morgan-sample.json', import.meta.url);
  const emptyProfile = JSON.parse(await readFile(emptyUrl, 'utf8'));
  assert.deepEqual(profileToFacts(emptyProfile), []);
});

test('post briefs are preferred and legacy full posts remain supported', () => {
  const preferred = profileToFacts({
    recentPosts: ['Long full post text'],
    recentPostSummaries: [{ postNumber: 1, summary: 'Brief post summary.' }]
  }).filter((fact) => fact.type === 'post');
  assert.deepEqual(preferred.map((fact) => fact.text), ['Brief post summary.']);

  const legacy = profileToFacts({ recentPosts: ['A full post with a useful detail.'] })
    .filter((fact) => fact.type === 'post');
  assert.equal(legacy[0].text, 'A full post with a useful detail.');
});
