import { CONFIG } from './config.js';
import { keywordTokens } from './embeddings.js';

const GENERIC_TOKENS = new Set([
  'software', 'engineer', 'engineering', 'technology', 'technologies', 'developer', 'development',
  'data', 'artificial', 'intelligence', 'machine', 'learning', 'research', 'business', 'product',
  'management', 'manager', 'design', 'analysis', 'analyst', 'cloud', 'web', 'application', 'applications',
  'student', 'professional', 'passionate', 'experienced', 'skilled', 'enthusiastic', 'seeking', 'team', 'member'
]);
const EDUCATION_TYPE_WORDS = new Set([
  'college', 'university', 'institute', 'school', 'academy', 'polytechnic'
]);
const EDUCATION_FILLER_WORDS = new Set(['of', 'the', 'and', 'at', 'in']);
const EVENT_GENERIC_TOKENS = new Set([
  ...GENERIC_TOKENS,
  'achievement', 'achievements', 'award', 'awards', 'winner', 'winners', 'winning', 'won', 'win',
  'champion', 'champions', 'national', 'place', 'first', 'rank', 'team', 'teams', 'secured',
  'proud', 'share', 'received', 'participated', 'competition', 'competing', 'recognized'
]);

function cleanEntity(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalSkill(value) {
  const withoutLinkedInQualifier = String(value || '')
    .replace(/\s*\(?\s*programming languages?\s*\)?\s*$/i, '');
  return cleanEntity(withoutLinkedInQualifier);
}

function educationParts(value) {
  const full = cleanEntity(value);
  const words = full.split(' ').filter(Boolean);
  const type = [...new Set(words.filter((word) => EDUCATION_TYPE_WORDS.has(word)))].sort().join(' ');
  const core = words.filter((word) => (
    !EDUCATION_TYPE_WORDS.has(word) && !EDUCATION_FILLER_WORDS.has(word)
  )).sort().join(' ');
  const acronym = words
    .filter((word) => !EDUCATION_FILLER_WORDS.has(word))
    .map((word) => word[0])
    .join('');
  return { full, type, core, acronym: acronym.length > 1 ? acronym : '' };
}

function sameEducation(leftValue, rightValue) {
  const left = educationParts(leftValue);
  const right = educationParts(rightValue);
  if (!left.full || !right.full) return false;
  if (left.full === right.full || (left.acronym && left.acronym === right.full) || (right.acronym && right.acronym === left.full)) {
    return true;
  }
  if (left.acronym && left.acronym === right.acronym) return true;
  return Boolean(left.core && left.core === right.core && (!left.type || !right.type || left.type === right.type));
}

function sameAchievementEvent(achievement, post) {
  const achievementTerms = new Set(keywordTokens(achievement).filter((token) => !EVENT_GENERIC_TOKENS.has(token)));
  const postTerms = new Set(keywordTokens(post).filter((token) => !EVENT_GENERIC_TOKENS.has(token)));
  const shared = [...achievementTerms].filter((token) => postTerms.has(token));
  return shared.length >= 3;
}

function explicitEntities(fact, key) {
  const value = fact?.meta?.[key];
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(cleanEntity).filter(Boolean);
}

function entitiesForFact(fact) {
  if (fact?.type === 'skill') {
    const values = Array.isArray(fact?.meta?.entities) && fact.meta.entities.length
      ? fact.meta.entities
      : [String(fact?.text || '').replace(/^\s*skill\s*:\s*/i, '').split(/[,;|]/)];
    return values.flat().map(canonicalSkill).filter(Boolean);
  }

  const entities = explicitEntities(fact, 'entities');
  if (entities.length) return entities;
  const entity = fact?.meta?.entity;
  if (entity) return [cleanEntity(entity)].filter(Boolean);

  const text = String(fact?.text || '');
  if (fact?.type === 'company') {
    return [cleanEntity(text.replace(/^\s*(?:current|previous)?\s*company\s*:\s*/i, ''))].filter(Boolean);
  }
  if (fact?.type === 'education') {
    const school = text.match(/\b(?:school|university|college)\s*:\s*(.+)$/i)?.[1];
    return [cleanEntity(school || text)].filter(Boolean);
  }
  return [];
}

function isExactEntityMatch(meFact, otherFact) {
  const a = meFact?.type;
  const b = otherFact?.type;
  if ((a === 'company' && b === 'company') || (a === 'education' && b === 'education')) {
    const left = entitiesForFact(meFact);
    const right = entitiesForFact(otherFact);
    return a === 'education'
      ? left.some((entity) => right.some((other) => sameEducation(entity, other)))
      : left.some((entity) => right.includes(entity));
  }

  if (a === 'achievement' && b === 'post') return sameAchievementEvent(meFact?.text, otherFact?.text);
  if (a === 'post' && b === 'achievement') return sameAchievementEvent(otherFact?.text, meFact?.text);

  if (a === 'skill' && b === 'skill') {
    const right = new Set(entitiesForFact(otherFact));
    return entitiesForFact(meFact).some((entity) => right.has(entity));
  }

  if (a === 'skill' && b === 'project') {
    const right = new Set(explicitEntities(otherFact, 'tools').map(canonicalSkill));
    return entitiesForFact(meFact).some((entity) => right.has(entity));
  }
  if (a === 'project' && b === 'skill') return isExactEntityMatch(otherFact, meFact);

  if (a === 'project' && b === 'project') {
    const left = explicitEntities(meFact, 'projectName');
    const right = new Set(explicitEntities(otherFact, 'projectName'));
    return left.some((entity) => right.has(entity));
  }
  return false;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = Number(a[index]);
    const y = Number(b[index]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

function hasOnlyGenericOverlap(a, b) {
  const left = new Set(keywordTokens(a));
  const right = new Set(keywordTokens(b));
  const shared = [...left].filter((token) => right.has(token));
  return shared.length > 0 && shared.every((token) => GENERIC_TOKENS.has(token));
}

function tierFor(score, thresholds) {
  if (score >= thresholds.strong) return 'strong';
  if (score >= thresholds.medium) return 'medium';
  return '';
}

export function matchFacts(meFacts, otherFacts, {
  thresholds = CONFIG.thresholds,
  layer = 1,
  topK = 6,
  genericPenalty = 0.15
} = {}) {
  const candidates = [];
  for (const meFact of Array.isArray(meFacts) ? meFacts : []) {
    for (const otherFact of Array.isArray(otherFacts) ? otherFacts : []) {
      const exact = isExactEntityMatch(meFact, otherFact);
      let score = exact ? 1 : cosine(meFact?.vec, otherFact?.vec);
      if (!exact && hasOnlyGenericOverlap(meFact?.text, otherFact?.text)) {
        score = Math.min(Math.max(0, score - genericPenalty), thresholds.strong - 0.001);
      }
      const tier = tierFor(score, thresholds);
      if (!tier) continue;
      candidates.push({
        meFactId: meFact.id,
        otherFactId: otherFact.id,
        score,
        tier,
        layer,
        ...(exact ? { exact: true } : {}),
        meText: meFact.text,
        otherText: otherFact.text
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || Number(Boolean(b.exact)) - Number(Boolean(a.exact)));
  const usedMe = new Set();
  const usedOther = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedMe.has(candidate.meFactId) || usedOther.has(candidate.otherFactId)) continue;
    usedMe.add(candidate.meFactId);
    usedOther.add(candidate.otherFactId);
    matches.push(candidate);
    if (matches.length >= topK) break;
  }
  return matches;
}
