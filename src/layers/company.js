import { CONFIG, STORAGE_KEYS } from '../utils/config.js';
import { embed } from '../utils/embeddings.js';
import { matchFacts } from '../utils/matcher.js';
import { memoryCardToFacts } from './memory.js';
import { buildNewsCondensePrompt } from '../utils/prompts/condense.js';
import { goalLabel } from '../utils/prompts/goals.js';
import { callModel } from '../utils/llm.js';
import { searchCompanyNews } from '../utils/search.js';
import { redactResumeText } from '../utils/resume.js';

const NEWS_KINDS = new Set(['funding', 'hiring', 'product', 'leadership', 'expansion', 'other']);

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

export function companySlug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function companyCacheKey(company) {
  return STORAGE_KEYS.companyCachePrefix + companySlug(company);
}

function hashKey(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function companyChoiceKey(profileUrl) {
  return 'companyChoice:' + hashKey(String(profileUrl || '').trim().toLowerCase());
}

export async function getCompanyChoice(profileUrl, storage) {
  if (!profileUrl || !storage?.getLocal) return '';
  const key = companyChoiceKey(profileUrl);
  const result = await storage.getLocal([key]);
  const value = result?.[key];
  return typeof value === 'string' ? value : String(value?.company || '');
}

export async function saveCompanyChoice(profileUrl, company, storage) {
  const name = cleanText(company, 120);
  if (!profileUrl || !name || !storage?.setLocal) return;
  await storage.setLocal({ [companyChoiceKey(profileUrl)]: { company: name, updatedAt: new Date().toISOString() } });
}

async function readCache(storage, key) {
  if (!storage?.getLocal) return null;
  const result = await storage.getLocal([key]);
  return result?.[key] || null;
}

function cacheIsFresh(value, now) {
  const cachedAt = Date.parse(value?.fetchedAt || '');
  return Number.isFinite(cachedAt)
    && new Date(now).getTime() - cachedAt >= 0
    && new Date(now).getTime() - cachedAt < CONFIG.cacheTtlMs.companyNews
    && Array.isArray(value?.newsFacts);
}

function searchKeywords(card) {
  const skills = Array.isArray(card?.skills) ? card.skills : [];
  const interests = Array.isArray(card?.interests) ? card.interests : [];
  const projectTech = (Array.isArray(card?.projects) ? card.projects : [])
    .flatMap((project) => Array.isArray(project?.tech) ? project.tech : []);
  return [...new Set([...skills, ...interests, ...projectTech]
    .map((value) => cleanText(value, 60)).filter(Boolean))].slice(0, 8);
}

function parseCondensedNews(response, sources, now) {
  const rows = Array.isArray(response) ? response : response?.news;
  if (!Array.isArray(rows)) return [];
  const current = new Date(now);
  const cutoff = new Date(current);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const seen = new Set();
  const facts = [];
  for (const row of rows) {
    const sourceIndex = Number(row?.sourceIndex);
    const source = Number.isInteger(sourceIndex) ? sources[sourceIndex] : null;
    const date = Date.parse(source?.date || '');
    const text = cleanText(row?.text, 160);
    const kind = NEWS_KINDS.has(row?.kind) ? row.kind : 'other';
    if (!source || !text || !Number.isFinite(date) || date < cutoff.getTime() || date > current.getTime() + 86400000) continue;
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    facts.push({
      id: 'N' + (facts.length + 1),
      source: 'news',
      type: 'news',
      text,
      meta: { title: source.title, url: source.url, date: source.date, kind }
    });
    if (facts.length >= CONFIG.limits.maxNewsItems) break;
  }
  return facts;
}

async function condenseNews(company, goal, sources, { apiKey, llm, now }) {
  if (!sources.length) return [];
  const today = new Date(now).toISOString().slice(0, 10);
  const response = await llm({
    apiKey,
    model: CONFIG.models.fast,
    system: 'Condense only the dated company-news sources provided. Never add or alter source URLs, dates, or facts. Return valid JSON only.',
    messages: [{
      role: 'user',
      content: buildNewsCondensePrompt({ company, goal: goalLabel(goal), results: sources, today })
    }],
    json: true,
    reasoningEffort: 'low',
    maxTokens: 1800
  });
  return parseCondensedNews(response, sources, now);
}

export async function runCompanyLayer(ctx = {}, {
  storage = ctx.storage,
  search = searchCompanyNews,
  llm = callModel,
  embedder = embed,
  matcher = matchFacts,
  now = new Date()
} = {}) {
  const profile = ctx.profileJSON || ctx.profile || {};
  const companyCandidate = Object.prototype.hasOwnProperty.call(ctx, 'company') ? ctx.company : profile.currentCompany;
  const company = cleanText(redactResumeText(String(companyCandidate || '')).text, 120);
  if (!company || !companySlug(company)) {
    return { status: 'skipped', detail: 'No company was selected; company research was skipped.', matches: [], newsFacts: [], sources: [] };
  }

  const settings = ctx.settings || (storage?.getSettings ? await storage.getSettings() : {});
  const apiKey = String(ctx.apiKey || settings.userApiKey || '').trim();
  if (!apiKey) {
    return { status: 'skipped', detail: 'No Groq API key is available for company research.', matches: [], newsFacts: [], sources: [] };
  }

  const key = companyCacheKey(company);
  let cached = await readCache(storage, key);
  let wasCached = cacheIsFresh(cached, now);
  let newsFacts = wasCached ? cached.newsFacts : [];

  if (!wasCached) {
    try {
      const card = ctx.memoryCard || (storage?.getMemoryCard ? await storage.getMemoryCard() : null);
      const sources = await search(company, {
        goal: goalLabel(ctx.goal),
        keywords: searchKeywords(card),
        apiKey,
        now
      });
      if (!sources.length) {
        return { status: 'skipped', detail: `No recent, dated company news was found for ${company}.`, matches: [], newsFacts: [], sources: [] };
      }
      newsFacts = await condenseNews(company, ctx.goal, sources, { apiKey, llm, now });
      if (!newsFacts.length) {
        return { status: 'skipped', detail: `Recent search results for ${company} could not be verified as dated news.`, matches: [], newsFacts: [], sources: [] };
      }
      cached = { company, fetchedAt: new Date(now).toISOString(), newsFacts };
      if (storage?.setLocal) await storage.setLocal({ [key]: cached });
      wasCached = false;
    } catch (error) {
      const reason = error?.message || 'the search request failed';
      return { status: 'skipped', detail: `Company research was skipped: ${reason}`, matches: [], newsFacts: [], sources: [] };
    }
  }

  const card = ctx.memoryCard || (storage?.getMemoryCard ? await storage.getMemoryCard() : null);
  const meFacts = memoryCardToFacts(card || {});
  const goalFact = ctx.goal
    ? [{ id: 'G1', source: 'goal', type: 'goal', text: 'Outreach goal: ' + goalLabel(ctx.goal), meta: {} }]
    : [];
  const matchFactsForRun = [...meFacts, ...goalFact];
  let matches = [];
  if (matchFactsForRun.length && newsFacts.length) {
    const vectors = await embedder([...matchFactsForRun, ...newsFacts].map((fact) => fact.text), { kind: 'fact', storage });
    const withVectors = [...matchFactsForRun, ...newsFacts].map((fact, index) => ({ ...fact, vec: vectors[index] }));
    matches = matcher(
      withVectors.slice(0, matchFactsForRun.length),
      withVectors.slice(matchFactsForRun.length),
      { layer: 2, topK: 6 }
    );
  }

  const sources = newsFacts.map((fact) => ({
    title: fact.meta.title,
    url: fact.meta.url,
    date: fact.meta.date,
    kind: fact.meta.kind,
    text: fact.text
  }));
  return {
    status: 'done',
    detail: `Found ${newsFacts.length} recent news item${newsFacts.length === 1 ? '' : 's'} for ${company}${wasCached ? ' (cached)' : ''}.`,
    cached: wasCached,
    matches,
    newsFacts,
    sources
  };
}
