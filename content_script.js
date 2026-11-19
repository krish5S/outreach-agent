'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrapeProfile') {
    scrapeWithScroll().then(async profile => {
      await saveLatestProfile(profile);
      sendResponse({ success: true, data: profile });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function scrapeWithScroll() {
  window.scrollTo(0, 800); await wait(500);
  window.scrollTo(0, 1600); await wait(500);
  window.scrollTo(0, 2400); await wait(600);
  window.scrollTo(0, 0); await wait(300);
  return scrapeProfile();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function saveLatestProfile(profile) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ latestScrapedProfile: profile }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function scrapeProfile() {
  const clean = (str) => (str || '').replace(/\s+/g, ' ').trim();
  const unique = (values) => [...new Set(values.filter(Boolean))];

  // Find the card containing a heading. LinkedIn uses both <section> elements
  // and div-based artdeco cards, so don't assume the heading has a section tag.
  function getSection(heading) {
    const headingNode = Array.from(document.querySelectorAll('h2, h3')).find(node =>
      clean(node.innerText).toLowerCase().includes(heading.toLowerCase())
    );
    if (!headingNode) return null;

    const headingText = clean(headingNode.innerText);
    let ancestor = headingNode.parentElement;
    while (ancestor && ancestor !== document.body) {
      const otherHeadings = Array.from(ancestor.querySelectorAll('h2')).filter(node => node !== headingNode);
      const onlyTargetHeading = otherHeadings.length === 0;
      const hasSectionContent = clean(ancestor.innerText).length > headingText.length + 20;
      const isCard = ancestor.matches('section,[class*="artdeco-card"],[class*="profile-card"]');
      if (onlyTargetHeading && hasSectionContent && isCard) return ancestor;
      ancestor = ancestor.parentElement;
    }

    // Fallback to the nearest content container if the card has no known class.
    ancestor = headingNode.parentElement;
    while (ancestor && ancestor !== document.body) {
      const otherHeadings = Array.from(ancestor.querySelectorAll('h2')).filter(node => node !== headingNode);
      if (
        otherHeadings.length === 0 &&
        clean(ancestor.innerText).length > headingText.length + 20
      ) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return headingNode.parentElement;
  }

  // Read rendered text regardless of whether LinkedIn used p, span, or a link.
  function getTexts(section) {
    if (!section) return [];
    const texts = [];
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (parent?.closest('button,[role="button"],script,style')) continue;
      const editLink = parent?.closest('a[href*="/edit/"]');
      if (editLink && /^(edit|add|show all)\b/i.test(clean(editLink.innerText))) continue;
      const text = clean(node.nodeValue);
      if (
        text.length > 2 &&
        !/^[·•\s]+$/.test(text) &&
        !/^(about|experience|education|skills|activity|see more|show more|show all)$/i.test(text)
      ) texts.push(text);
    }
    return unique(texts);
  }

  // ── PROFILE INTRO ─────────────────────────────────────────────────────────
  const nameHeading = document.querySelector('h1');
  const name = clean(nameHeading?.innerText) ||
    clean(document.title.split('|')[0]);
  const introSection = nameHeading?.closest(
    'section,[class*="artdeco-card"],[class*="profile-card"],[class*="top-card"]'
  ) || nameHeading?.parentElement?.parentElement?.parentElement || null;
  const introTexts = unique([
    ...getTexts(introSection),
    ...(introSection?.innerText || '').split(/\n+/).map(clean)
  ]).map(text => {
    let normalized = clean(text);
    if (name && normalized.toLowerCase().startsWith(name.toLowerCase())) {
      normalized = normalized.slice(name.length).trim();
    }
    return normalized
      .replace(/^(?:he\/him|she\/her|they\/them)\s+/i, '')
      .replace(/[·•]\s*$/, '')
      .trim();
  }).filter(Boolean);
  const location = introTexts.find(text =>
    text !== name && text.length < 100 && !/[|@]/.test(text) &&
    (text.includes(',') || /(?:metropolitan region|\bregion|\barea|\bdistrict)$/i.test(text))
  ) || null;
  const headlineCandidates = introTexts.filter(text =>
    text.length > 5 && text !== name && text !== location &&
    !/^(?:he\/him|she\/her|they\/them|contact info|open to|\d+\+? connections|\d+ followers)$/i.test(text) &&
    !/^(?:edit|view|message|connect|follow)\b/i.test(text)
  );
  const likelyHeadlines = headlineCandidates.filter(text =>
    /[|@]/.test(text) || /manager|engineer|analyst|developer|designer|founder|director|lead|specialist|consultant|intern|fellow|trainee|student|aspiring|b-tech/i.test(text)
  ).sort((a, b) => b.length - a.length);
  let headline = likelyHeadlines[0] || headlineCandidates.sort((a, b) => b.length - a.length)[0] || null;
  if (headline && location && headline.toLowerCase().endsWith(location.toLowerCase())) {
    headline = headline.slice(0, -location.length).replace(/[·•,\s-]+$/, '').trim() || null;
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  let about = null;
  const aboutSection = getSection('About');
  if (aboutSection) {
    const aboutParts = getTexts(aboutSection).filter(text =>
      text.length > 30 && !/^(edit about|see more|show more)$/i.test(text)
    );
    if (aboutParts.length) about = aboutParts.join(' ').slice(0, 5000);
  }

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const expSection = getSection('Experience');
  const experienceLines = getTexts(expSection);
  const experienceSectionContent = experienceLines.join('\n');
  const monthNames = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const dateRangePattern = new RegExp(`\\b(?:(?:${monthNames})\\s+)?(?:19|20)\\d{2}\\s*[-–]\\s*(?:present|(?:(?:${monthNames})\\s+)?(?:19|20)\\d{2})\\b`, 'i');

  function parseExperienceRole(text) {
    const normalized = clean(text);
    const dateRange = normalized.match(dateRangePattern);
    if (!dateRange) return null;

    let prefix = clean(normalized.slice(0, dateRange.index));
    const typeMatch = prefix.match(/\b(full[- ]time|part[- ]time|contract|freelance|internship|self[- ]employed|seasonal|temporary|volunteer)\s*$/i);
    const employmentType = typeMatch?.[1] || null;
    if (typeMatch) prefix = clean(prefix.slice(0, typeMatch.index));
    if (!prefix || prefix.length > 160) return null;

    return {
      title: prefix,
      company: null,
      employmentType,
      duration: clean(normalized.slice(dateRange.index)).slice(0, 180),
      isCurrent: /\bpresent\b/i.test(dateRange[0])
    };
  }

  function stripCompanyTenure(text) {
    return clean(text).replace(/\s+(?:\d+\s+(?:yrs?|years?|mos?|months?)\s*)+$/i, '').trim();
  }

  const companyNames = expSection
    ? unique(Array.from(expSection.querySelectorAll('a[href*="/company/"]'))
      .map(link => stripCompanyTenure(link.innerText))
      .filter(text => text.length > 1 && text !== name))
    : [];

  function companyForRole(link) {
    let ancestor = link.parentElement;
    while (ancestor && ancestor !== expSection) {
      const names = unique(Array.from(ancestor.querySelectorAll('a[href*="/company/"]'))
        .map(companyLink => stripCompanyTenure(companyLink.innerText))
        .filter(Boolean));
      if (names.length === 1) return names[0];
      ancestor = ancestor.parentElement;
    }
    return companyNames.length === 1 ? companyNames[0] : null;
  }

  const experienceEntries = [];
  if (expSection) {
    const positionLinks = Array.from(expSection.querySelectorAll('a[href*="/position/"]'));
    let roleLinks = positionLinks.filter(link => parseExperienceRole(link.innerText));
    if (!roleLinks.length) {
      roleLinks = Array.from(expSection.querySelectorAll('a')).filter(link => parseExperienceRole(link.innerText));
    }

    roleLinks.forEach(link => {
      const role = parseExperienceRole(link.innerText);
      if (!role) return;
      role.company = companyForRole(link);
      if (!experienceEntries.some(entry => entry.title === role.title && entry.duration === role.duration)) {
        experienceEntries.push(role);
      }
    });

    // Fallback for profile layouts where role titles and dates aren't links.
    if (!experienceEntries.length) {
      experienceLines.forEach((line, index) => {
        const dateRange = line.match(dateRangePattern);
        if (!dateRange) return;
        let prefix = clean(line.slice(0, dateRange.index));
        if (!prefix) {
          const previous = experienceLines[index - 1] || '';
          const typeOnly = /^(full[- ]time|part[- ]time|contract|freelance|internship|self[- ]employed|seasonal|temporary|volunteer)$/i.test(previous);
          prefix = typeOnly
            ? `${experienceLines[index - 2] || ''} ${previous}`
            : previous;
        }
        const role = parseExperienceRole(`${prefix} ${line.slice(dateRange.index)}`);
        if (role && !experienceEntries.some(entry => entry.title === role.title && entry.duration === role.duration)) {
          role.company = companyNames.length === 1 ? companyNames[0] : null;
          experienceEntries.push(role);
        }
      });
    }
  }

  const currentEntry = experienceEntries[0] || null;
  const currentTitle = currentEntry?.title || extractFromHeadline(headline, 'title');
  const currentCompany = currentEntry?.company || companyNames[0] || extractFromHeadline(headline, 'company');
  const pastCompanies = companyNames.filter(company => company !== currentCompany).slice(0, 4);

  // ── SKILLS ────────────────────────────────────────────────────────────────
  const skills = [];
  const skillsSection = getSection('Skills');
  if (skillsSection) {
    const texts = getTexts(skillsSection);
    texts.filter(text =>
      text.length < 60 && text.length > 2 &&
      !/\d{4}|follower|connection|endorsement|endorse|show all|see all|dialog|window|escape/i.test(text)
    ).forEach(text => skills.push(text));
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const educationEntries = [];
  const eduSection = getSection('Education');
  const educationTexts = getTexts(eduSection);
  const educationSectionContent = educationTexts.join('\n');
  if (eduSection) {
    const schoolLinks = Array.from(eduSection.querySelectorAll('a[href*="/school/"]'))
      .map(link => clean(link.innerText))
      .filter(text => text.length > 2 && !/edit|show all|see all/i.test(text));
    educationEntries.push(...unique(schoolLinks).slice(0, 3));
    if (!educationEntries.length) {
      const educationDetails = educationTexts.filter(text => !/edit|show all|see all/i.test(text));
      for (let i = 0; i < educationDetails.length && educationEntries.length < 3; i += 3) {
        const entry = educationDetails.slice(i, i + 2).join(' — ');
        if (entry) educationEntries.push(entry);
      }
    }
  }

  // ── RECENT POSTS ──────────────────────────────────────────────────────────
  const recentPosts = [];
  const activitySection = getSection('Activity');
  if (activitySection) {
    const addPostCandidate = (text) => {
      let candidate = clean(text);
      if (candidate.length <= 40 || candidate === name || candidate === headline ||
        /dialog|window|escape|cancel|close|beginning|notifications|premium|people you may|you might/i.test(candidate)) return;
      if (candidate.length > 2500) candidate = `${candidate.slice(0, 2499).trimEnd()}…`;
      if (!recentPosts.includes(candidate)) recentPosts.push(candidate);
    };

    // On some LinkedIn profile layouts the post copy is exposed as the text of
    // a permalink rather than a paragraph/span. Read those links first.
    activitySection.querySelectorAll(
      'a[href*="/feed/update/"], a[href*="/posts/"]'
    ).forEach(link => addPostCandidate(link.innerText));

    // Prefer known post-text containers when no permalink text was found.
    // Keep all selectors scoped to Activity to avoid picking up the headline.
    const postTextSelectors = [
      '[data-ad-preview="message"]',
      '[class*="update-components-text"]',
      '[class*="feed-shared-update-v2__description"]',
      '[class*="feed-shared-text"]'
    ];
    if (!recentPosts.length) {
      for (const selector of postTextSelectors) {
        activitySection.querySelectorAll(selector).forEach(el => addPostCandidate(el.innerText));
      }
    }

    // Fall back to readable leaf text for LinkedIn layouts with different markup.
    if (!recentPosts.length) {
      getTexts(activitySection).forEach(addPostCandidate);
    }
  }

  const selectedRecentPosts = recentPosts.slice(0, 3);

  return {
    schemaVersion: 2,
    name,
    bio: headline || '',
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    experienceSectionContent,
    educationSectionContent,
    recentPosts: selectedRecentPosts,
    recentPostSummaries: selectedRecentPosts.map((post, index) => ({
      postNumber: index + 1,
      summary: makePostBrief(post)
    })),
    experienceEntries: experienceEntries.slice(0, 5),
    pastCompanies: pastCompanies.slice(0, 4),
    educationEntries: educationEntries.slice(0, 3),
    skills: skills.slice(0, 10),
    profileUrl: window.location.href.split('?')[0],
    rawTitle: document.title,
    scrapedAt: new Date().toISOString()
  };
}

function makePostBrief(post, maxLength = 180) {
  const normalized = String(post || '').replace(/\s+/g, ' ').trim();
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || normalized;
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
  if (pipeMatch) return field === 'title' ? pipeMatch[1].trim() : pipeMatch[2].trim();
  return null;
}
