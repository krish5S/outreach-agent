import { CONFIG, STORAGE_KEYS } from './config.js';

export const KEYWORD_VECTOR_SIZE = CONFIG.embeddings.vectorSize;
const MAX_VECTOR_CACHE_ENTRIES = CONFIG.embeddings.maxCacheEntries;
const CACHE_PREFIX = 'keyword:local:';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the',
  'to', 'with', 'as', 'be', 'been', 'being', 'current', 'previous', 'role', 'company',
  'profile', 'headline', 'experience', 'studied', 'work', 'worked', 'using', 'use'
]);

const SYNONYMS = Object.freeze({
  ai: ['artificial', 'intelligence'],
  ml: ['machine', 'learning'],
  aiml: ['artificial', 'intelligence', 'machine', 'learning'],
  llm: ['large', 'language', 'model'],
  llms: ['large', 'language', 'model'],
  rag: ['retrieval', 'augmented', 'generation'],
  nlp: ['natural', 'language', 'processing'],
  js: ['javascript'],
  ts: ['typescript'],
  nodejs: ['node', 'javascript'],
  reactjs: ['react', 'javascript'],
  fullstack: ['full', 'stack', 'web', 'development']
});

function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function keywordTokens(text) {
  const words = normalizeText(text).match(/[\p{L}\p{N}]+/gu) || [];
  const expanded = [];
  for (const word of words) {
    const values = SYNONYMS[word] || [word];
    for (const value of values) {
      if (!STOP_WORDS.has(value) && (value.length > 1 || /^\d+$/.test(value))) expanded.push(value);
    }
  }
  return expanded;
}

function featuresFor(text) {
  const tokens = keywordTokens(text);
  const features = tokens.map((token) => 'w:' + token);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push('b:' + tokens[index] + '_' + tokens[index + 1]);
  }
  return features;
}

function featureIndex(feature, dimensions) {
  let hash = 2166136261;
  for (const character of feature) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dimensions;
}

export function keywordEmbed(text, { dimensions = KEYWORD_VECTOR_SIZE } = {}) {
  const vector = new Array(dimensions).fill(0);
  for (const feature of featuresFor(text)) vector[featureIndex(feature, dimensions)] += 1;
  return vector;
}

export function hashEmbeddingText(text) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ').trim();
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function readVectorCache(storage) {
  if (!storage?.getLocal) return {};
  const result = await storage.getLocal([STORAGE_KEYS.vecCache]);
  const cache = result?.[STORAGE_KEYS.vecCache];
  return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
}

export async function embed(texts, { kind = 'fact', storage = null } = {}) {
  const values = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text || ''));
  const cache = await readVectorCache(storage);
  const keys = values.map((text) => `${CACHE_PREFIX}${kind}:${hashEmbeddingText(text)}`);
  const missingByKey = new Map();
  keys.forEach((key, index) => {
    if (!Array.isArray(cache[key])) missingByKey.set(key, values[index]);
  });

  if (missingByKey.size) {
    for (const [key, text] of missingByKey) cache[key] = keywordEmbed(text);
    if (storage?.setLocal) {
      const entries = Object.entries(cache).filter(([key]) => key.startsWith(CACHE_PREFIX));
      const boundedCache = Object.fromEntries(entries.slice(-MAX_VECTOR_CACHE_ENTRIES));
      await storage.setLocal({ [STORAGE_KEYS.vecCache]: boundedCache });
    }
  }

  return keys.map((key) => cache[key]);
}
