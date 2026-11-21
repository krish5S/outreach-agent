import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companyCacheKey,
  companyChoiceKey,
  companySlug,
  getCompanyChoice,
  saveCompanyChoice,
  runCompanyLayer
} from '../src/layers/company.js';
import { normalizeCompanySearchResults, searchCompanyNews } from '../src/utils/search.js';

function makeStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async getLocal(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async setLocal(items) { Object.assign(values, items); },
    async getMemoryCard() { return { skills: ['Python'], interests: ['space technology'] }; }
  };
}

const now = new Date('2026-11-21T12:00:00.000Z');

test('company slug and cache key are stable and readable', () => {
  assert.equal(companySlug('DJS Phoenix, Inc.'), 'djs-phoenix-inc');
  assert.equal(companyCacheKey('DJS Phoenix'), 'companyCache:djs-phoenix');
});

test('confirmed company choice is remembered locally without putting the profile URL in its key', async () => {
  const storage = makeStorage();
  const profileUrl = 'https://www.linkedin.com/in/fake-person/';
  await saveCompanyChoice(profileUrl, 'Example Systems', storage);
  assert.equal(await getCompanyChoice(profileUrl, storage), 'Example Systems');
  assert.equal(companyChoiceKey(profileUrl).includes('fake-person'), false);
});

test('company search results keep recent dated HTTPS sources and drop stale or invalid URLs', () => {
  const results = normalizeCompanySearchResults({ results: [
    { title: 'Recent launch', url: 'https://example.com/news', date: '2026-10', snippet: 'A recent product launch.' },
    { title: 'Old item', url: 'https://example.com/old', date: '2024-02-01', snippet: 'Old news.' },
    { title: 'Bad URL', url: 'javascript:alert(1)', date: '2026-10-01', snippet: 'Invalid.' },
    { title: 'No date', url: 'https://example.com/undated', snippet: 'Undated.' }
  ] }, { now });
  assert.equal(results.length, 1);
  assert.equal(results[0].date, '2026-10-01');
});

test('Groq company search requests browser search and parses its source list', async () => {
  let request;
  const result = await searchCompanyNews('Example Systems', {
    goal: 'internship',
    keywords: ['Python'],
    apiKey: 'test-key',
    now,
    llm: async (options) => {
      request = options;
      return 'Search results:\n{"results":[{"title":"Internship program","url":"https://example.com/careers","date":"2026-10-12","snippet":"The company opened summer internships."}]} 〖1†L2-L4〗';
    }
  });
  assert.equal(request.toolChoice, 'required');
  assert.deepEqual(request.tools, [{ type: 'browser_search' }]);
  assert.equal(request.json, undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.com/careers');
});

test('company layer condenses dated news, matches it locally, and stores source metadata', async () => {
  const storage = makeStorage();
  let searchCalls = 0;
  let matcherLayer = 0;
  const result = await runCompanyLayer({
    company: 'Example Systems',
    goal: 'internship',
    apiKey: 'test-key',
    memoryCard: { skills: ['Python'] },
    storage
  }, {
    now,
    search: async () => {
      searchCalls += 1;
      return [{
        title: 'Example opens its internship program',
        url: 'https://example.com/internships',
        date: '2026-10-12',
        snippet: 'The company opened a summer program for software students.'
      }];
    },
    llm: async () => ({ news: [{ sourceIndex: 0, text: 'Example opened a summer internship program.', kind: 'hiring' }] }),
    embedder: async (texts) => texts.map(() => [1, 0]),
    matcher: (me, other, options) => {
      matcherLayer = options.layer;
      return [{ meFactId: me[0].id, otherFactId: other[0].id, score: 0.8, tier: 'strong', layer: options.layer }];
    }
  });

  assert.equal(searchCalls, 1);
  assert.equal(matcherLayer, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.cached, false);
  assert.equal(result.newsFacts.length, 1);
  assert.equal(result.newsFacts[0].id, 'N1');
  assert.equal(result.newsFacts[0].meta.url, 'https://example.com/internships');
  assert.equal(result.sources[0].date, '2026-10-12');
  assert.equal(result.matches[0].layer, 2);
  assert.ok(storage.values['companyCache:example-systems']);
});

test('fresh company cache avoids another search and condense call', async () => {
  const cacheKey = companyCacheKey('Example Systems');
  const storage = makeStorage({
    [cacheKey]: {
      company: 'Example Systems',
      fetchedAt: now.toISOString(),
      newsFacts: [{ id: 'N1', source: 'news', type: 'news', text: 'Recent company hiring news.', meta: { title: 'Careers', url: 'https://example.com/careers', date: '2026-10-12', kind: 'hiring' } }]
    }
  });
  let searchCalls = 0;
  let llmCalls = 0;
  const result = await runCompanyLayer({
    company: 'Example Systems', apiKey: 'test-key', goal: 'internship',
    memoryCard: { skills: ['Python'] }, storage
  }, {
    now,
    search: async () => { searchCalls += 1; return []; },
    llm: async () => { llmCalls += 1; return { news: [] }; },
    embedder: async (texts) => texts.map(() => [1, 0]),
    matcher: () => []
  });
  assert.equal(result.status, 'done');
  assert.equal(result.cached, true);
  assert.equal(searchCalls, 0);
  assert.equal(llmCalls, 0);
});

test('expired company cache triggers fresh search and condensation', async () => {
  const cacheKey = companyCacheKey('Example Systems');
  const storage = makeStorage({
    [cacheKey]: { company: 'Example Systems', fetchedAt: '2026-11-19T12:00:00.000Z', newsFacts: [] }
  });
  let searchCalls = 0;
  const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const result = await runCompanyLayer({ company: 'Example Systems', goal: 'referral', apiKey: 'test-key', memoryCard: {}, storage }, {
    now: later,
    search: async () => {
      searchCalls += 1;
      return [{ title: 'New expansion', url: 'https://example.com/expansion', date: '2026-11-21', snippet: 'Opened a new office.' }];
    },
    llm: async () => ({ news: [{ sourceIndex: 0, text: 'The company opened a new office.', kind: 'expansion' }] }),
    embedder: async (texts) => texts.map(() => [1, 0]),
    matcher: () => []
  });
  assert.equal(searchCalls, 1);
  assert.equal(result.cached, false);
  assert.equal(result.newsFacts.length, 1);
});

test('search failures produce a skipped layer with a readable reason', async () => {
  const result = await runCompanyLayer({ company: 'Example Systems', goal: 'internship', apiKey: 'test-key' }, {
    now,
    search: async () => { throw new Error('network unavailable'); }
  });
  assert.equal(result.status, 'skipped');
  assert.match(result.detail, /network unavailable/);
});

test('an explicitly blank company skips research even if the scraped field has a value', async () => {
  let called = false;
  const result = await runCompanyLayer({ company: '', profileJSON: { currentCompany: 'A scraped company' } }, {
    search: async () => { called = true; return []; }
  });
  assert.equal(called, false);
  assert.equal(result.status, 'skipped');
});
