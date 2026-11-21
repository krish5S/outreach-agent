import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePack, runApproachLayer } from '../src/layers/approach.js';
import { CONFIG } from '../src/utils/config.js';

function writerDrafts({ overLimit = false } = {}) {
  return {
    drafts: [
      {
        variant: 'short',
        text: overLimit ? 'x'.repeat(201) : "Hi Jordan, I'm Alex, an AI student. Could we chat?",
        claims: [{ text: 'The sender is Alex, an AI student.', evidenceIds: ['SENDER_NAME', 'M1'] }]
      },
      {
        variant: 'medium',
        text: "Hi Jordan, I'm Alex, an AI student. I am exploring internship opportunities and would value your advice.",
        claims: [{ text: 'The sender is Alex, an AI student.', evidenceIds: ['SENDER_NAME', 'M1'] }]
      },
      {
        variant: 'question',
        text: 'Jordan, do you know of internship opportunities I could explore?',
        claims: []
      }
    ]
  };
}

const strategy = {
  mode: 'hook',
  primary: { evidenceIds: ['E1'], angle: 'shared technical background' },
  supporting: [],
  askSize: 'small',
  tone: 'warm and professional',
  rationale: 'The resume and profile share a technical focus.'
};

function matchContext(overrides = {}) {
  return {
    apiKey: 'test-key',
    goal: 'internship',
    messageType: 'connection_note',
    memoryCard: { name: 'Alex Example', headline: 'AI student' },
    profileJSON: { name: 'Jordan Example', currentTitle: 'AI student' },
    matches: [{
      meFactId: 'M1', otherFactId: 'P1', meText: 'AI student', otherText: 'AI student',
      score: 0.8, tier: 'strong', layer: 1
    }],
    ...overrides
  };
}

test('evidence pack ranks strong facts first and limits to six items', () => {
  const facts = [];
  const matches = [];
  for (let index = 1; index <= 8; index += 1) {
    facts.push({ id: 'M' + index, source: 'me', text: 'Resume fact ' + index, meta: {} });
    facts.push({ id: 'P' + index, source: 'person', text: 'Profile fact ' + index, meta: {} });
    matches.push({ meFactId: 'M' + index, otherFactId: 'P' + index, score: index / 10, tier: index === 1 ? 'medium' : 'strong', layer: 1 });
  }
  const pack = buildEvidencePack(matches, facts);
  assert.equal(pack.length, 6);
  assert.equal(pack[0].tier, 'strong');
  assert.equal(pack[0].id, 'E1');
  assert.equal(pack.at(-1).tier, 'strong');
});

test('company matches distinguish the outreach goal from resume facts', () => {
  const pack = buildEvidencePack([{
    meFactId: 'G1', otherFactId: 'N1', meText: 'Outreach goal: internship',
    otherText: 'The company opened internship applications.', score: 0.8, tier: 'strong', layer: 2
  }], [
    { id: 'G1', source: 'goal', text: 'Outreach goal: internship' },
    { id: 'N1', source: 'news', text: 'The company opened internship applications.', meta: { url: 'https://example.com/news', date: '2026-10-12' } }
  ]);
  assert.match(pack[0].text, /Your outreach goal:/);
  assert.match(pack[0].text, /Company news:/);
});

test('strategist invalid IDs and an overlong writer draft are each retried once', async () => {
  const calls = [];
  let strategyCalls = 0;
  let writerCalls = 0;
  const llm = async (options) => {
    calls.push(options);
    assert.equal(options.model, CONFIG.models.strong);
    if (options.messages[0].content.includes('Choose the outreach approach')) {
      strategyCalls += 1;
      if (strategyCalls === 1) return { ...strategy, primary: { evidenceIds: ['E99'], angle: 'unknown' } };
      return strategy;
    }
    writerCalls += 1;
    if (writerCalls === 1) return writerDrafts({ overLimit: true });
    return writerDrafts();
  };
  const result = await runApproachLayer(matchContext(), { llm });
  assert.equal(strategyCalls, 2);
  assert.equal(writerCalls, 2);
  assert.equal(result.drafts.length, 3);
  assert.ok(result.drafts.every((draft) => draft.charCount <= 200));
  assert.equal(result.strategy.primary.evidenceIds[0], 'E1');
  assert.match(calls.find((call) => call.messages[0].content.includes('Write three LinkedIn')).messages[0].content, /sender is the extension user/i);
  assert.match(calls.find((call) => call.messages[0].content.includes('Write three LinkedIn')).messages[0].content, /Do not invent facts/i);
});

test('writer claims must cite known evidence IDs', async () => {
  const llm = async (options) => {
    if (options.messages[0].content.includes('Choose the outreach approach')) return strategy;
    return {
      drafts: writerDrafts().drafts.map((draft, index) => index === 0
        ? { ...draft, claims: [{ text: 'Unsupported statement.', evidenceIds: ['E55'] }] }
        : draft)
    };
  };
  await assert.rejects(runApproachLayer(matchContext(), { llm }), /unsupported or ungrounded claim/i);
});

test('no-match input takes an honest local fallback without calling Groq', async () => {
  let calls = 0;
  const result = await runApproachLayer(matchContext({ matches: [] }), {
    llm: async () => { calls += 1; throw new Error('should not call model'); }
  });
  assert.equal(calls, 0);
  assert.equal(result.strategy.mode, 'fallback');
  assert.equal(result.drafts.length, 3);
  assert.match(result.drafts[0].text, /I'm Alex Example, an AI student/);
  assert.match(result.drafts[0].text, /internship opportunities/i);
  assert.doesNotMatch(result.drafts[1].text, /exploring internship\. I am exploring internship/i);
  assert.ok(result.drafts.every((draft) => draft.charCount <= 200));
});
