import { CONFIG } from '../utils/config.js';
import { assertResumeSectionsSafe, findResumePii, redactResumeText } from '../utils/resume.js';
import { callModel } from '../utils/llm.js';
import { buildResumeStructuringPrompt } from '../utils/prompts/resume.js';

const MAX_FACTS = 40;
const MAX_STRING = 1000;

function cleanText(value, limit = MAX_STRING) {
  const redacted = redactResumeText(typeof value === 'string' ? value : '').text;
  return redacted.replace(/\s+/g, ' ').trim().slice(0, limit).trim();
}

function cleanStringArray(value, { maxItems = 30, maxLength = 160 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanObjectArray(value, fields, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => {
    const clean = {};
    for (const [field, options] of Object.entries(fields)) {
      if (options.array) clean[field] = cleanStringArray(item?.[field], options);
      else clean[field] = cleanText(item?.[field], options.maxLength || 200);
    }
    return clean;
  }).filter((item) => Object.values(item).some((value) => Array.isArray(value) ? value.length : value));
}

export function memoryCardToFacts(card = {}) {
  const facts = [];
  const seen = new Set();
  const add = (type, value) => {
    const text = cleanText(value, 200);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || facts.length >= MAX_FACTS) return;
    seen.add(key);
    facts.push({ id: 'M' + (facts.length + 1), source: 'me', type, text, meta: {} });
  };

  add('role', card.headline);
  add('about', card.summary);
  for (const skill of card.skills || []) add('skill', 'Skill: ' + skill);
  for (const entry of card.education || []) {
    add('education', [entry.degree, entry.field, entry.school, entry.years].filter(Boolean).join(' — '));
  }
  for (const entry of card.experience || []) {
    const text = [entry.title, entry.org, entry.years, ...(entry.highlights || [])].filter(Boolean).join(' — ');
    add('role', text);
  }
  for (const entry of card.projects || []) {
    add('project', [entry.name, entry.summary, ...(entry.tech || [])].filter(Boolean).join(' — '));
  }
  for (const achievement of card.achievements || []) add('about', 'Achievement: ' + achievement);
  add('goal', card.goals);
  for (const interest of card.interests || []) add('goal', 'Interest: ' + interest);
  return facts;
}

export function validateMemoryCard(input, { name = '', now = new Date() } = {}) {
  const source = typeof input === 'string' ? JSON.parse(input) : (input || {});
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('The resume model response must be a JSON object.');
  }
  const responseFields = { ...source };
  delete responseFields.name;
  const piiFindings = findResumePii(responseFields, { name });
  if (piiFindings.length) {
    throw new Error('The memory-card response included detected ' + piiFindings.join(', ') + ' details, so it was not accepted.');
  }

  const card = {
    version: 1,
    updatedAt: now.toISOString(),
    name: cleanText(name, 100),
    headline: cleanText(source.headline, 160),
    summary: cleanText(source.summary, 1000),
    skills: cleanStringArray(source.skills, { maxItems: 40, maxLength: 100 }),
    education: cleanObjectArray(source.education, {
      school: { maxLength: 160 }, degree: { maxLength: 100 },
      field: { maxLength: 100 }, years: { maxLength: 60 }
    }),
    experience: cleanObjectArray(source.experience, {
      title: { maxLength: 120 }, org: { maxLength: 160 }, years: { maxLength: 60 },
      highlights: { array: true, maxItems: 8, maxLength: 200 }
    }),
    projects: cleanObjectArray(source.projects, {
      name: { maxLength: 140 }, summary: { maxLength: 300 },
      tech: { array: true, maxItems: 20, maxLength: 100 }
    }),
    achievements: cleanStringArray(source.achievements, { maxItems: 30, maxLength: 180 }),
    goals: cleanText(source.goals, 500),
    interests: cleanStringArray(source.interests, { maxItems: 30, maxLength: 120 }),
    facts: []
  };
  card.facts = memoryCardToFacts(card).slice(0, MAX_FACTS);
  return card;
}

export async function buildMemoryCard(sections, {
  apiKey,
  name = '',
  llm = callModel,
  now = new Date()
} = {}) {
  const safeSections = assertResumeSectionsSafe(sections, { name });
  const result = await llm({
    apiKey,
    model: CONFIG.models.fast,
    messages: [{ role: 'user', content: buildResumeStructuringPrompt(safeSections) }],
    json: true,
    maxTokens: 3000,
    reasoningEffort: 'low'
  });
  return validateMemoryCard(result, { name, now });
}
