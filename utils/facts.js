import { CONFIG } from './config.js';

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function shortText(value) {
  const text = clean(value);
  if (text.length <= CONFIG.limits.factText) return text;
  return text.slice(0, CONFIG.limits.factText - 1).trimEnd() + '…';
}

function splitAbout(value) {
  const text = clean(value);
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
  const chunks = [];
  let current = '';

  for (const rawSentence of sentences) {
    const sentence = clean(rawSentence);
    if (!sentence) continue;
    if (sentence.length > CONFIG.limits.factText) {
      if (current) {
        chunks.push(shortText(current));
        current = '';
      }
      const words = sentence.split(/\s+/);
      let part = '';
      for (const word of words) {
        const candidate = part ? part + ' ' + word : word;
        if (candidate.length > CONFIG.limits.factText && part) {
          chunks.push(shortText(part));
          part = word;
        } else {
          part = candidate;
        }
      }
      if (part) chunks.push(shortText(part));
      continue;
    }
    const candidate = current ? current + ' ' + sentence : sentence;
    if (candidate.length > CONFIG.limits.factText && current) {
      chunks.push(shortText(current));
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(shortText(current));
  return chunks.slice(0, 2);
}

function listValues(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === 'string') return clean(value);
    if (!value || typeof value !== 'object') return '';
    return clean(value.school || value.name || value.title || Object.values(value).join(' '));
  }).filter(Boolean);
}

function groupValues(values, maxLength = CONFIG.limits.factText) {
  const groups = [];
  let current = '';
  for (const rawValue of values) {
    const value = shortText(rawValue);
    if (!value) continue;
    const candidate = current ? current + ', ' + value : value;
    if (candidate.length > maxLength && current) {
      groups.push(current);
      current = value;
    } else {
      current = candidate;
    }
  }
  if (current) groups.push(current);
  return groups;
}

export function profileToFacts(profile = {}) {
  const facts = [];
  const seen = new Set();
  const profileUrl = clean(profile.profileUrl) || undefined;

  function add(type, text, meta = {}) {
    const normalized = shortText(text);
    const key = type + ':' + normalized.toLowerCase();
    if (!normalized || seen.has(key) || facts.length >= CONFIG.limits.maxFacts) return;
    seen.add(key);
    facts.push({
      id: 'P' + (facts.length + 1),
      source: 'person',
      type,
      text: normalized,
      meta: { ...(profileUrl ? { url: profileUrl } : {}), ...meta }
    });
  }

  const currentTitle = clean(profile.currentTitle);
  const currentCompany = clean(profile.currentCompany);
  if (currentTitle) {
    add('role', currentCompany
      ? 'Current role: ' + currentTitle + ' at ' + currentCompany
      : 'Current role: ' + currentTitle);
  } else if (clean(profile.headline || profile.bio)) {
    add('role', 'Profile headline: ' + clean(profile.headline || profile.bio));
  }
  if (currentCompany) add('company', 'Current company: ' + currentCompany, { confidence: 0.9 });
  for (const company of listValues(profile.pastCompanies)) {
    add('company', 'Previous company: ' + company);
  }

  for (const entry of Array.isArray(profile.experienceEntries) ? profile.experienceEntries : []) {
    if (typeof entry === 'string') {
      add('role', 'Experience: ' + entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const title = clean(entry.title);
    const company = clean(entry.company);
    const duration = clean(entry.duration);
    const employmentType = clean(entry.employmentType);
    const role = [title, company ? 'at ' + company : '', employmentType, duration]
      .filter(Boolean).join(' ');
    if (role) add('role', (entry.isCurrent ? 'Current experience: ' : 'Experience: ') + role);
  }

  for (const aboutFact of splitAbout(profile.about)) add('about', aboutFact);

  for (const education of listValues(profile.educationEntries)) {
    add('education', education);
  }

  for (const skillGroup of groupValues(listValues(profile.skills))) {
    add('skill', skillGroup);
  }

  if (clean(profile.location)) add('location', clean(profile.location));

  const summaries = Array.isArray(profile.recentPostSummaries)
    ? profile.recentPostSummaries
    : [];
  if (summaries.length) {
    summaries.forEach((post, index) => {
      const summary = typeof post === 'string' ? post : post?.summary;
      const postNumber = typeof post === 'object' ? post?.postNumber : index + 1;
      add('post', clean(summary), { postNumber: postNumber || index + 1 });
    });
  } else {
    (Array.isArray(profile.recentPosts) ? profile.recentPosts : []).forEach((post, index) => {
      add('post', clean(post), { postNumber: index + 1 });
    });
  }

  return facts;
}
