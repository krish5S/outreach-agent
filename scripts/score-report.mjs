import { embed } from '../src/utils/embeddings.js';
import { matchFacts } from '../src/utils/matcher.js';

const cases = [
  {
    label: 'Shared college',
    me: [{ id: 'M1', source: 'me', type: 'education', text: 'B.Tech at Example Institute', meta: { entity: 'Example Institute' } }],
    other: [{ id: 'P1', source: 'person', type: 'education', text: 'Example Institute', meta: { entity: 'Example Institute' } }]
  },
  {
    label: 'Shared tool',
    me: [{ id: 'M1', source: 'me', type: 'skill', text: 'Skill: PyTorch', meta: { entities: ['PyTorch'] } }],
    other: [{ id: 'P1', source: 'person', type: 'skill', text: 'Deep learning tools', meta: { entities: ['PyTorch'] } }]
  },
  {
    label: 'LinkedIn skill label',
    me: [{ id: 'M1', source: 'me', type: 'skill', text: 'Skill: Python', meta: { entities: ['Python'] } }],
    other: [{ id: 'P1', source: 'person', type: 'skill', text: 'Python (Programming Language)', meta: { entities: ['Python (Programming Language)'] } }]
  },
  {
    label: 'Unrelated skills',
    me: [{ id: 'M1', source: 'me', type: 'skill', text: 'Skill: Python', meta: { entities: ['Python'] } }],
    other: [{ id: 'P1', source: 'person', type: 'skill', text: 'Jazz performance', meta: { entities: ['Jazz'] } }]
  },
  {
    label: 'Generic role only',
    me: [{ id: 'M1', source: 'me', type: 'role', text: 'Software engineer', meta: {} }],
    other: [{ id: 'P1', source: 'person', type: 'role', text: 'Software engineer', meta: {} }]
  }
];

for (const sample of cases) {
  const facts = [...sample.me, ...sample.other];
  const vectors = await embed(facts.map((fact) => fact.text));
  facts.forEach((fact, index) => { fact.vec = vectors[index]; });
  const matches = matchFacts(facts.slice(0, sample.me.length), facts.slice(sample.me.length));
  const match = matches[0];
  console.log([
    sample.label.padEnd(20),
    match ? match.tier.padEnd(7) : 'none'.padEnd(7),
    match ? String(match.score.toFixed(3)).padEnd(7) : '—'.padEnd(7),
    match?.exact ? 'exact' : ''
  ].join(' | '));
}
