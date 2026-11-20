export const RESUME_SECTION_KEYS = Object.freeze([
  'summary',
  'experience',
  'education',
  'skills',
  'projects',
  'achievements',
  'interests',
  'other'
]);

const SECTION_HEADINGS = new Map([
  ['summary', 'summary'], ['profile', 'summary'], ['professional summary', 'summary'],
  ['career objective', 'summary'], ['objective', 'summary'], ['about me', 'summary'],
  ['experience', 'experience'], ['work experience', 'experience'],
  ['professional experience', 'experience'], ['employment history', 'experience'],
  ['work history', 'experience'], ['career history', 'experience'],
  ['education', 'education'], ['academic background', 'education'],
  ['qualifications', 'education'], ['education and training', 'education'],
  ['skills', 'skills'], ['technical skills', 'skills'], ['core skills', 'skills'],
  ['core competencies', 'skills'], ['competencies', 'skills'],
  ['projects', 'projects'], ['selected projects', 'projects'], ['personal projects', 'projects'],
  ['achievements', 'achievements'], ['awards', 'achievements'], ['certifications', 'achievements'],
  ['honors and awards', 'achievements'], ['accomplishments', 'achievements'],
  ['interests', 'interests'], ['areas of interest', 'interests'],
  ['contact', 'contact'], ['contact information', 'contact'], ['personal details', 'contact']
]);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<![\p{L}\p{N}])\+?\d[\d\s().-]{5,}\d(?![\p{L}\p{N}])/gu;
const ADDRESS_LABEL_RE = /^\s*(?:(?:home|mailing|residential|current)\s+)?(?:street\s+)?address\s*[:\-]?\s*(.*)$/i;
const ADDRESS_LINE_RE = /\b\d{1,6}\s+[\p{L}\d.'’\-#]+(?:\s+[\p{L}\d.'’\-#]+){0,7}\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|way|place|pl\.?|terrace|trail)\b/iu;
const PERSONAL_FIELD_RE = /^\s*(?:e-?mail|phone|mobile|telephone|tel|date of birth|birth date|dob|passport|national id|aadhaar|aadhar|ssn)\s*[:\-]/i;
const YEAR_RANGE_RE = /^(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|present|current)$/i;
const DATE_RE = /^(?:0?[1-9]|1[0-2])[/. -](?:0?[1-9]|[12]\d|3[01])[/. -](?:\d{2}|\d{4})$/;
const HEADLINE_SIGNAL_RE = /\b(?:engineer|engineering|developer|development|student|undergraduate|graduate|aspiring|software|AI|AIML|ML|machine learning|data|product|designer|design|analyst|manager|researcher|research|founder|intern|professional|specialist|architect|consultant|B\.?Tech|B\.?E\.?|M\.?Tech|MBA|Ph\.?D\.?|full[- ]stack|cybersecurity|cloud|marketing|finance)\b/i;

function cleanLine(value) {
  return String(value || '').replace(/[\t\u00a0]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function normalizeHeading(value) {
  return cleanLine(value)
    .replace(/^[\s•·|—–-]+|[\s:|—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeNamePattern(name) {
  const normalized = cleanLine(name);
  if (!normalized) return null;
  const words = normalized.split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp('(?<![\\p{L}\\p{N}])' + words + '(?![\\p{L}\\p{N}])', 'giu');
}

function likelyNameLine(value) {
  const line = cleanLine(value);
  if (!line || line.length > 48 || /\d|@|https?:|[,:;]/i.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (SECTION_HEADINGS.has(normalizeHeading(line))) return false;
  if (HEADLINE_SIGNAL_RE.test(line)) return false;
  return words.every((word) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(word));
}

function leadingNameAndTail(value) {
  const segments = cleanLine(value).split(/\s*[|•·]\s*/);
  const first = segments.shift() || '';
  const words = first.split(/\s+/).filter(Boolean);
  let detectedName = '';
  let remainder = '';

  if (likelyNameLine(first)) {
    detectedName = first;
  } else {
    for (let count = 2; count <= Math.min(4, words.length); count += 1) {
      const candidate = words.slice(0, count).join(' ');
      if (likelyNameLine(candidate)) {
        detectedName = candidate;
        remainder = words.slice(count).join(' ');
        break;
      }
    }
  }

  return {
    name: detectedName,
    tail: [remainder, ...segments].filter(Boolean).join(' | ')
  };
}

function sectionHeadingOnLine(line) {
  return SECTION_HEADINGS.has(normalizeHeading(line));
}

function namePatterns(names) {
  return [...new Set(names.map(cleanLine).filter(Boolean).map((name) => name.toLowerCase()))]
    .map((name) => makeNamePattern(name));
}

export function extractResumeIdentity(text, { name = '' } = {}) {
  const configuredName = cleanLine(name);
  const header = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map(cleanLine).filter(Boolean).slice(0, 10);
  const firstHeadingIndex = header.findIndex(sectionHeadingOnLine);
  const headerLines = firstHeadingIndex >= 0 ? header.slice(0, firstHeadingIndex) : header;

  let detectedName = '';
  let nameLineIndex = -1;
  let nameTail = '';
  for (let index = 0; index < Math.min(headerLines.length, 8); index += 1) {
    const candidate = leadingNameAndTail(headerLines[index]);
    if (candidate.name) {
      detectedName = candidate.name;
      nameTail = candidate.tail;
      nameLineIndex = index;
      break;
    }
  }

  const names = [configuredName, detectedName].filter(Boolean);
  const candidates = [];
  for (let index = 0; index < headerLines.length; index += 1) {
    if (index === nameLineIndex) {
      if (nameTail) candidates.push(nameTail);
      continue;
    }
    candidates.push(headerLines[index]);
  }

  let headline = '';
  for (const candidate of candidates) {
    const cleaned = redactResumeText(candidate, { names }).text
      .replace(/^[\s|•·,;]+|[\s|•·,;]+$/g, '').trim();
    if (!cleaned || cleaned.length > 160 || /https?:\/\/|linkedin\.com/i.test(cleaned)) continue;
    if (sectionHeadingOnLine(cleaned)) continue;
    if (findResumePii(cleaned).length) continue;
    if (HEADLINE_SIGNAL_RE.test(cleaned)) {
      headline = cleaned;
      break;
    }
  }

  return {
    name: configuredName || detectedName,
    headline,
    detectedName
  };
}

function isYearOrDate(candidate) {
  const normalized = cleanLine(candidate).replace(/[–—]/g, '-');
  return YEAR_RANGE_RE.test(normalized) || DATE_RE.test(normalized);
}

function likelyPhone(candidate, line) {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || isYearOrDate(candidate)) return false;
  if (/\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/.test(candidate)) return false;
  return /[+()]/.test(candidate) || /\b(?:phone|mobile|tel|call|whatsapp)\b/i.test(line) || digits.length >= 9;
}

function newRedactionCounts() {
  return { email: 0, phone: 0, address: 0, name: 0, otherIdentifier: 0 };
}

export function redactResumeText(text, { name = '', names = [] } = {}) {
  const redactions = newRedactionCounts();
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const patterns = namePatterns([name, ...names]);
  let skipAddressLines = 0;
  const safeLines = [];

  for (const original of lines) {
    const line = cleanLine(original);
    if (!line) {
      safeLines.push('');
      continue;
    }

    if (skipAddressLines > 0) {
      if (SECTION_HEADINGS.has(normalizeHeading(line))) skipAddressLines = 0;
      else {
        skipAddressLines -= 1;
        redactions.address += 1;
        continue;
      }
    }

    const addressLabel = line.match(ADDRESS_LABEL_RE);
    if (addressLabel) {
      redactions.address += 1;
      if (!addressLabel[1]) skipAddressLines = 2;
      continue;
    }
    if (ADDRESS_LINE_RE.test(line)) {
      redactions.address += 1;
      continue;
    }
    if (PERSONAL_FIELD_RE.test(line)) {
      if (/e-?mail/i.test(line)) redactions.email += 1;
      else if (/phone|mobile|telephone|tel/i.test(line)) redactions.phone += 1;
      else redactions.otherIdentifier += 1;
      continue;
    }

    let safe = line.replace(EMAIL_RE, () => {
      redactions.email += 1;
      return '';
    });
    safe = safe.replace(PHONE_RE, (candidate) => {
      if (!likelyPhone(candidate, line)) return candidate;
      redactions.phone += 1;
      return '';
    });
    for (const pattern of patterns) {
      safe = safe.replace(pattern, () => {
        redactions.name += 1;
        return '';
      });
    }
    safe = safe.replace(/^[\s|•·,;]+|[\s|•·,;]+$/g, '');
    safeLines.push(cleanLine(safe));
  }

  return { text: safeLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), redactions };
}

export function sectionizeResumeText(text, options = {}) {
  const identity = extractResumeIdentity(text, options);
  const names = [options.name, identity.detectedName].filter(Boolean);
  const redacted = redactResumeText(text, { names });
  const lines = redacted.text.split('\n');
  const firstContentIndex = lines.findIndex((line) => cleanLine(line));
  if (!names.length && firstContentIndex >= 0 && likelyNameLine(lines[firstContentIndex])) {
    lines[firstContentIndex] = '';
    redacted.redactions.name += 1;
  }

  if (identity.headline) {
    const normalizedHeadline = cleanLine(identity.headline).toLowerCase();
    for (let index = 0; index < lines.length; index += 1) {
      if (sectionHeadingOnLine(lines[index])) break;
      if (cleanLine(lines[index]).toLowerCase() === normalizedHeadline) {
        lines[index] = '';
        break;
      }
    }
  }

  const sections = Object.fromEntries(RESUME_SECTION_KEYS.map((key) => [key, []]));
  let currentSection = 'summary';
  let insideContact = false;

  for (const original of lines) {
    const line = cleanLine(original);
    if (!line) continue;
    const section = SECTION_HEADINGS.get(normalizeHeading(line));
    if (section) {
      insideContact = section === 'contact';
      currentSection = insideContact ? '' : section;
      continue;
    }
    if (insideContact || !currentSection) continue;
    sections[currentSection].push(line);
  }

  for (const key of RESUME_SECTION_KEYS) {
    sections[key] = sections[key].slice(0, 200).map(cleanLine).filter(Boolean);
  }

  return { sections, redactions: redacted.redactions, identity };
}

export function findResumePii(value, { name = '', names = [] } = {}) {
  const collectStrings = (item) => {
    if (typeof item === 'string') return [item];
    if (Array.isArray(item)) return item.flatMap(collectStrings);
    if (item && typeof item === 'object') return Object.values(item).flatMap(collectStrings);
    return [];
  };
  const text = (typeof value === 'string' ? [value] : collectStrings(value || {})).join('\n');
  const findings = [];
  if (EMAIL_RE.test(text)) findings.push('email');
  EMAIL_RE.lastIndex = 0;

  for (const match of text.matchAll(PHONE_RE)) {
    if (likelyPhone(match[0], text)) {
      findings.push('phone');
      break;
    }
  }
  if (text.split('\n').some((line) => ADDRESS_LABEL_RE.test(line) || ADDRESS_LINE_RE.test(line))) findings.push('address');
  if (namePatterns([name, ...names]).some((pattern) => pattern.test(text))) findings.push('name');
  return [...new Set(findings)];
}

export function assertResumeSectionsSafe(sections, options = {}) {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    throw new TypeError('Resume sections must be a JSON object.');
  }
  const allowed = new Set(RESUME_SECTION_KEYS);
  const safeSections = {};
  for (const key of RESUME_SECTION_KEYS) {
    const value = sections[key];
    if (value === undefined) {
      safeSections[key] = [];
      continue;
    }
    const entries = Array.isArray(value) ? value : [value];
    safeSections[key] = entries
      .filter((entry) => typeof entry === 'string')
      .map((entry) => cleanLine(entry))
      .filter(Boolean)
      .slice(0, 200);
  }
  const unknown = Object.keys(sections).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError('Resume sections contain unsupported fields.');
  const findings = findResumePii(safeSections, options);
  if (findings.length) {
    throw new Error('Remove detected ' + findings.join(', ') + ' details before sending resume sections to Groq.');
  }
  return safeSections;
}
