import { CONFIG } from '../utils/config.js';
import { callModel } from '../utils/llm.js';
import { profileToFacts } from '../utils/facts.js';
import { redactResumeText } from '../utils/resume.js';
import { buildStrategistPrompt } from '../utils/prompts/strategist.js';
import { buildWriterPrompt } from '../utils/prompts/writer.js';
import { goalGuidance } from '../utils/prompts/goals.js';
import { memoryCardToFacts } from './memory.js';

const VARIANTS = ['short', 'medium', 'question'];
const ASK_SIZES = new Set(['tiny', 'small', 'medium']);

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

export function buildEvidencePack(matches = [], facts = []) {
  const byId = new Map((Array.isArray(facts) ? facts : []).map((fact) => [fact.id, fact]));
  const ordered = (Array.isArray(matches) ? matches : [])
    .filter((match) => match && match.meFactId && match.otherFactId)
    .slice()
    .sort((a, b) => Number(b.tier === 'strong') - Number(a.tier === 'strong')
      || Number(b.score || 0) - Number(a.score || 0));
  const seen = new Set();
  const pack = [];

  for (const match of ordered) {
    const pair = `${match.layer || 1}:${match.meFactId}:${match.otherFactId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const meFact = byId.get(match.meFactId);
    const otherFact = byId.get(match.otherFactId);
    const meText = cleanText(meFact?.text || match.meText, 240);
    const otherText = cleanText(otherFact?.text || match.otherText, 240);
    if (!meText || !otherText) continue;
    const source = otherFact?.source === 'news' || Number(match.layer) === 2 ? 'company_news' : 'profile';
    const meLabel = meFact?.source === 'goal' || String(match.meFactId) === 'G1' ? 'Your outreach goal' : 'Your resume';
    const meta = otherFact?.meta || {};
    pack.push({
      id: 'E' + (pack.length + 1),
      text: `${meLabel}: ${meText}\n${source === 'company_news' ? 'Company news' : 'Their profile'}: ${otherText}`,
      score: Math.max(0, Math.min(1, Number(match.score) || 0)),
      tier: match.tier === 'strong' ? 'strong' : 'medium',
      source,
      ...(source === 'company_news' && meta.url ? { url: meta.url } : {}),
      ...(meta.date ? { date: meta.date } : {}),
      matchIds: { meFactId: match.meFactId, otherFactId: match.otherFactId }
    });
    if (pack.length >= 6) break;
  }
  return pack;
}

function validateStrategy(value, evidencePack) {
  const validIds = new Set(evidencePack.map((item) => item.id));
  if (!value || !['hook', 'fallback'].includes(value.mode)) throw new Error('Strategy mode must be hook or fallback.');
  const primaryIds = value?.primary?.evidenceIds;
  if (!Array.isArray(primaryIds)) throw new Error('Strategy primary evidence IDs are missing.');
  if (value.mode === 'hook') {
    if (primaryIds.length !== 1 || !validIds.has(primaryIds[0])) throw new Error('Strategy must choose exactly one valid primary evidence ID.');
  } else if (primaryIds.length) {
    throw new Error('Fallback strategy must not reference a primary evidence item.');
  }
  const supporting = value.supporting;
  if (!Array.isArray(supporting) || supporting.length > 2 || supporting.some((id) => !validIds.has(id))) {
    throw new Error('Strategy supporting evidence must contain at most two valid evidence IDs.');
  }
  if (value.mode === 'hook' && supporting.includes(primaryIds[0])) throw new Error('Supporting evidence must differ from the primary hook.');
  if (!ASK_SIZES.has(value.askSize)) throw new Error('Strategy ask size is invalid.');
  return {
    mode: value.mode,
    primary: {
      evidenceIds: primaryIds,
      angle: cleanText(value.primary.angle, 180)
    },
    supporting,
    askSize: value.askSize,
    tone: cleanText(value.tone, 80) || 'warm and professional',
    rationale: cleanText(value.rationale, 240)
  };
}

async function getStrategy({ apiKey, llm, goal, evidencePack, recentPost }) {
  let retryNote = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const value = await llm({
      apiKey,
      model: CONFIG.models.strong,
      system: 'You are an outreach strategist writing for the extension user, who is the sender. Use only provided evidence, never invent facts, dates, employers, opportunities, or relationships. Return JSON only.',
      messages: [{ role: 'user', content: buildStrategistPrompt({ goal, evidencePack, recentPost, retryNote }) }],
      json: true,
      reasoningEffort: 'low',
      maxTokens: 1400
    });
    try {
      return validateStrategy(value, evidencePack);
    } catch (error) {
      if (attempt === 1) throw error;
      retryNote = error.message + ' Choose IDs only from: ' + evidencePack.map((item) => item.id).join(', ');
    }
  }
  throw new Error('Could not choose a valid outreach strategy.');
}

function validateDrafts(value, { limit, validEvidenceIds }) {
  const rows = value?.drafts;
  if (!Array.isArray(rows) || rows.length !== 3) throw new Error('Writer must return exactly three draft variants.');
  const byVariant = new Map();
  for (const row of rows) {
    const variant = String(row?.variant || '').toLowerCase();
    if (!VARIANTS.includes(variant) || byVariant.has(variant)) throw new Error('Writer returned a missing or duplicate draft variant.');
    const text = String(row?.text || '').trim();
    if (!text) throw new Error(`The ${variant} draft is empty.`);
    if (text.length > limit) throw new Error(`The ${variant} draft is ${text.length} characters; the limit is ${limit}.`);
    const claims = row?.claims;
    if (!Array.isArray(claims)) throw new Error(`The ${variant} draft claims must be an array.`);
    const normalizedClaims = claims.map((claim) => {
      const claimText = cleanText(claim?.text, 400);
      const ids = claim?.evidenceIds;
      if (!claimText || !Array.isArray(ids) || !ids.length || ids.some((id) => !validEvidenceIds.has(id))) {
        throw new Error(`The ${variant} draft includes an unsupported or ungrounded claim.`);
      }
      return { text: claimText, evidenceIds: [...new Set(ids)] };
    });
    byVariant.set(variant, { variant, text, charCount: text.length, claims: normalizedClaims });
  }
  if (VARIANTS.some((variant) => !byVariant.has(variant))) throw new Error('Writer did not return all three required variants.');
  const drafts = VARIANTS.map((variant) => byVariant.get(variant));
  if (new Set(drafts.map((draft) => draft.text.toLowerCase())).size !== drafts.length) {
    throw new Error('The three draft variants must use different wording.');
  }
  return drafts;
}

async function getDrafts({ apiKey, llm, goal, messageType, limit, strategy, evidencePack, memoryFacts, senderName, senderBio, recipient, regenerationNonce }) {
  const validEvidenceIds = new Set([
    ...evidencePack.map((item) => item.id),
    ...memoryFacts.map((fact) => fact.id),
    ...(senderName ? ['SENDER_NAME'] : [])
  ]);
  let retryNote = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const value = await llm({
      apiKey,
      model: CONFIG.models.strong,
      system: 'Write a draft for the extension user as sender. The person in the profile is the recipient. Use only supplied evidence, do not invent any facts, and keep every draft within the stated character limit. Return JSON only; do not send a message.',
      messages: [{
        role: 'user',
        content: buildWriterPrompt({
          goal,
          messageType,
          limit,
          strategy,
          evidencePack,
          memoryFacts,
          senderName,
          senderBio,
          recipient,
          retryNote,
          regenerationNonce
        })
      }],
      json: true,
      reasoningEffort: 'low',
      maxTokens: 3500
    });
    try {
      return validateDrafts(value, { limit, validEvidenceIds });
    } catch (error) {
      if (attempt === 1) throw error;
      retryNote = error.message + ` Use evidence IDs only from: ${[...validEvidenceIds].join(', ')}. Keep every text at or below ${limit} characters.`;
    }
  }
  throw new Error('Could not create valid outreach drafts.');
}

function fallbackAsk(goal, variant) {
  const wording = {
    internship: {
      short: 'Would you be open to a brief chat about internship opportunities?',
      medium: 'I am exploring internship opportunities and would value your advice. Would you be open to a brief conversation?',
      question: 'Do you know of any internship opportunities I could explore?'
    },
    referral: {
      short: 'Could you advise me on suitable roles or a referral?',
      medium: 'I am exploring suitable roles and would appreciate your guidance or a referral if you feel comfortable.',
      question: 'Would you feel comfortable advising me about a suitable role or referral?'
    },
    informational_chat: {
      short: 'Could I ask you a few questions about your work?',
      medium: 'I would value learning about your work. Would you be open to a brief 15-minute conversation?',
      question: 'Would you have 15 minutes to share your perspective on your work?'
    },
    recruiter_outreach: {
      short: 'Could you point me to suitable openings?',
      medium: 'I am interested in relevant opportunities and would appreciate your advice on suitable openings or the application process.',
      question: 'Could you suggest a suitable role or application path for me?'
    },
    collaboration: {
      short: 'Would you be open to discussing a collaboration?',
      medium: 'I would be interested in exploring a collaboration and would value a brief conversation if you are open to it.',
      question: 'Might you be open to a short conversation about a possible collaboration?'
    }
  };
  return wording[goal]?.[variant] || 'Would you be open to a brief professional conversation?';
}

function joinWithinLimit(parts, limit) {
  const kept = [];
  for (const part of parts) {
    if (!part) continue;
    const candidate = [...kept, part].join(' ');
    if (candidate.length <= limit) kept.push(part);
  }
  return kept.join(' ').trim();
}

function buildFallbackDrafts({ goal, messageType, limit, card, senderName, recipient, memoryFacts }) {
  const firstName = cleanText(recipient?.name, 100).split(/\s+/)[0] || 'there';
  const headlineFact = memoryFacts.find((fact) => fact.type === 'role');
  const headline = cleanText(card?.headline || '', 110);
  const nameClaim = senderName ? [{ text: `The sender's name is ${senderName}.`, evidenceIds: ['SENDER_NAME'] }] : [];
  const roleFact = headlineFact;
  const roleClaim = headline && roleFact ? [{ text: `The sender's professional headline is ${headline}.`, evidenceIds: [roleFact.id] }] : [];
  const greeting = `Hi ${firstName},`;
  const intro = senderName ? `I'm ${senderName}${headline ? `, ${headline}` : ''}.` : headline ? `I'm ${headline}.` : '';
  const variants = VARIANTS.map((variant) => {
    const ask = fallbackAsk(goal, variant);
    const pieces = variant === 'short'
      ? [greeting, intro, ask]
      : variant === 'medium'
        ? [greeting, intro, `I'm exploring ${goalGuidance(goal).label}.`, ask]
        : [greeting, intro, ask];
    const text = joinWithinLimit(pieces, limit);
    const includeIntro = Boolean(intro && text.includes(intro));
    return {
      variant,
      text,
      charCount: text.length,
      claims: [
        ...(includeIntro ? nameClaim : []),
        ...(includeIntro && headline ? roleClaim : [])
      ]
    };
  });
  return variants;
}

function messageLimit(messageType) {
  return messageType === 'connection_note'
    ? CONFIG.limits.connectionNoteDefault
    : CONFIG.limits.messageMax;
}

export async function runApproachLayer(ctx = {}, { llm = callModel } = {}) {
  const storage = ctx.storage;
  const card = ctx.memoryCard || (storage?.getMemoryCard ? await storage.getMemoryCard() : null);
  const settings = ctx.settings || (storage?.getSettings ? await storage.getSettings() : {});
  const apiKey = String(ctx.apiKey || settings.userApiKey || '').trim();
  if (!apiKey) throw new Error('Add your Groq API key in Settings to draft Deep Mode messages.');

  const profile = ctx.profileJSON || ctx.profile || {};
  const memoryFacts = memoryCardToFacts(card || {});
  const profileFacts = profileToFacts(profile)
    .map((fact) => ({ ...fact, text: redactResumeText(fact.text).text }))
    .filter((fact) => fact.text);
  const newsFacts = Array.isArray(ctx.newsFacts) ? ctx.newsFacts : [];
  const goalFacts = ctx.goal
    ? [{ id: 'G1', source: 'goal', type: 'goal', text: 'Outreach goal: ' + goalGuidance(ctx.goal).label, meta: {} }]
    : [];
  const allFacts = [...memoryFacts, ...profileFacts, ...newsFacts, ...goalFacts];
  const matches = Array.isArray(ctx.matches) ? ctx.matches : [];
  const evidencePack = buildEvidencePack(matches, allFacts);
  const senderName = cleanText(redactResumeText(card?.name || settings.userName).text, 100);
  const senderBio = cleanText(redactResumeText(card?.summary || settings.userBio).text, 500);
  const writerMemoryFacts = [
    ...memoryFacts,
    ...(senderName ? [{ id: 'SENDER_NAME', source: 'me', type: 'name', text: senderName, meta: {} }] : []),
    ...(senderBio ? [{ id: 'SENDER_BACKGROUND', source: 'me', type: 'about', text: senderBio, meta: {} }] : [])
  ];
  const messageType = ctx.messageType === 'connection_note' ? 'connection_note' : 'message';
  const limit = messageLimit(messageType);

  let strategy = {
    mode: 'fallback',
    primary: { evidenceIds: [], angle: 'No strong or medium shared evidence.' },
    supporting: [],
    askSize: 'small',
    tone: 'warm and professional',
    rationale: 'No supported resume-to-profile or resume-to-news match cleared the threshold.'
  };
  let drafts;
  if (evidencePack.length) {
    const postSummaries = Array.isArray(profile.recentPostSummaries) ? profile.recentPostSummaries : [];
    const recentPost = postSummaries.map((item) => typeof item === 'string' ? item : item?.summary).filter(Boolean)[0] || '';
    strategy = await getStrategy({ apiKey, llm, goal: ctx.goal, evidencePack, recentPost });
    if (strategy.mode === 'hook') {
      drafts = await getDrafts({
        apiKey,
        llm,
        goal: ctx.goal,
        messageType,
        limit,
        strategy,
        evidencePack,
        memoryFacts: writerMemoryFacts,
        senderName,
        senderBio,
        recipient: profile,
        regenerationNonce: ctx.regenerationNonce || ''
      });
    }
  }

  if (!drafts) {
    drafts = buildFallbackDrafts({ goal: ctx.goal, messageType, limit, card, senderName, recipient: profile, memoryFacts });
  }

  return {
    status: 'done',
    detail: `Prepared ${drafts.length} ${strategy.mode === 'hook' ? 'personalized' : 'honest fallback'} draft variants.`,
    strategy,
    evidencePack,
    drafts
  };
}
