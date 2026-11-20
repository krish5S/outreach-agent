'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentProfile     = null;
let isGenerating       = false;
let currentMode        = 'simple';
let isDeepRunning      = false;
let activeProfileAvailable = false;
let deepRunPort        = null;
let deepRunFinished    = false;
let selectedResumeFile = null;
let memoryCardOriginal = null;
let preparedResumeIdentity = { name: '', headline: '' };

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  await checkCurrentPage();
  await loadSettings();
  await renderRecentContacts();
  await checkLicenseStatus();
  await updateDeepRunAvailability();
});

// ─── License key status in header ────────────────────────────────────────────
async function checkLicenseStatus() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';
  document.getElementById('no-key-warning').classList.add('hidden');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
  document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
  document.getElementById('mode-deep').addEventListener('click', () => setMode('deep'));
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-simple').classList.toggle('active', mode === 'simple');
  document.getElementById('mode-deep').classList.toggle('active', mode === 'deep');
  document.getElementById('simple-mode-ui').classList.toggle('hidden', mode === 'deep');
  document.getElementById('deep-mode-ui').classList.toggle('hidden', mode === 'simple');
  document.getElementById('quick-controls-row').classList.toggle('hidden', mode === 'deep');
  hideMessage();
  clearCurrentStatus();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab       = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  activeProfileAvailable = Boolean(onProfile);
  document.getElementById('scrape-btn').disabled  = !onProfile;
  document.getElementById('deep-run-btn').disabled = !onProfile || isDeepRunning;
  if (!onProfile) {
    document.getElementById('page-warning').classList.remove('hidden');
  } else {
    document.getElementById('page-warning').classList.add('hidden');
  }
  return onProfile;
}

async function updateDeepRunAvailability() {
  const settings = await loadStoredSettings();
  const hasApiKey = Boolean((settings.userApiKey || '').trim());
  const warning = document.getElementById('deep-key-warning');
  warning.classList.toggle('hidden', hasApiKey);
  document.getElementById('deep-run-btn').disabled =
    !hasApiKey || !activeProfileAvailable || isDeepRunning;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('deep-run-btn').addEventListener('click', handleDeepRun);
  document.getElementById('regenerate-btn').addEventListener('click', handleRegenerate);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('generated-message').addEventListener('input', updateCharCount);
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });

  const dropArea = document.getElementById('file-upload-area');
  dropArea.addEventListener('click', () => document.getElementById('resume-upload').click());
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processResumeFile(file);
  });
  document.getElementById('resume-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processResumeFile(file);
  });
  document.getElementById('prepare-resume-btn').addEventListener('click', handlePrepareResume);
  document.getElementById('convert-legacy-resume-btn').addEventListener('click', handleConvertLegacyResume);
  document.getElementById('resume-review-confirm').addEventListener('change', updateBuildMemoryCardAvailability);
  document.getElementById('resume-sanitized-json').addEventListener('input', updateBuildMemoryCardAvailability);
  document.getElementById('user-name').addEventListener('input', updateBuildMemoryCardAvailability);
  document.getElementById('build-memory-card-btn').addEventListener('click', handleBuildMemoryCard);
  document.getElementById('save-memory-card-btn').addEventListener('click', handleSaveMemoryCard);
  document.getElementById('reset-memory-card-btn').addEventListener('click', handleResetMemoryCard);
  document.getElementById('clear-all-data-btn').addEventListener('click', handleClearAllData);
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    await Cache.clearContacts();
    renderRecentContacts();
  });
}

// ─── Simple Mode ──────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (isGenerating) return;


  isGenerating = true;
  hideMessage();
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Scraping profile…');
  clearCurrentStatus();

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    currentProfile = profile;
    renderProfileCard(profile);
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Generating message…');

    const message = await callQuickGenerate(profile);
    renderMessage(message);

    await Cache.addContact({
      profileUrl: profile.profileUrl || '',
      name:       profile.name       || 'Unknown',
      headline:   profile.headline   || '',
      company:    profile.currentCompany || '',
      message,
      timestamp:  Date.now()
    });

    showCurrentStatus('Message ready.', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

async function callQuickGenerate(profile) {
  const settings    = await loadStoredSettings();
  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  return sendToBackground({ action: 'generateMessage', data: { profileData: profile, settings, messageType, tone } });
}

async function handleRegenerate() {
  if (isGenerating) return;
  if (currentMode === 'deep') { handleDeepRun(); return; }
  if (!currentProfile) return;

  isGenerating = true;
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Regenerating…');

  try {
    const message = await callQuickGenerate(currentProfile);
    renderMessage(message);
    showCurrentStatus('Regenerated!', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

// ─── Deep Mode ────────────────────────────────────────────────────────────────
async function handleDeepRun() {
  if (isDeepRunning) return;

  const settings = await loadStoredSettings();
  if (!(settings.userApiKey || '').trim()) {
    showCurrentStatus('Add your Groq API key in Settings to enable Deep Mode.', 'warning');
    return;
  }
  if (!await checkCurrentPage()) {
    showCurrentStatus('Open a LinkedIn profile before running Deep Mode.', 'warning');
    return;
  }

  isDeepRunning = true;
  deepRunFinished = false;
  resetLayerStatuses();
  document.getElementById('deep-result').classList.add('hidden');
  document.getElementById('deep-draft').value = '';
  hideMessage();
  clearCurrentStatus();
  setButtonLoading('deep-run-btn', 'deep-run-label', 'deep-run-spinner', true, 'Scraping profile…');

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    currentProfile = profile;
    renderProfileCard(profile);
    setButtonLoading('deep-run-btn', 'deep-run-label', 'deep-run-spinner', true, 'Running layers…');
    showCurrentStatus('Profile scraped. Starting the Deep Mode pipeline…');

    const port = chrome.runtime.connect({ name: 'deep-run' });
    deepRunPort = port;
    port.onMessage.addListener(handleDeepRunEvent);
    port.onDisconnect.addListener(() => {
      if (!deepRunFinished && deepRunPort === port) {
        const error = chrome.runtime.lastError?.message || 'Deep Mode connection ended unexpectedly.';
        finishDeepRun();
        showCurrentStatus(error, 'error');
      }
    });
    port.postMessage({
      type: 'run',
      payload: {
        profileJSON: profile,
        goal: document.getElementById('deep-goal').value,
        messageType: document.getElementById('deep-message-type').value
      }
    });
  } catch (error) {
    finishDeepRun();
    showCurrentStatus(error.message || 'Could not start the Deep Mode run.', 'error');
  }
}

function handleDeepRunEvent(event) {
  if (event?.type === 'progress') {
    const layerNumber = { memory: 1, company: 2, approach: 3 }[event.layer];
    if (!layerNumber) return;
    const isStarting = event.status === 'start';
    setLayerStatus(
      layerNumber,
      isStarting ? 'running' : event.status,
      isStarting ? 'Running' : (event.detail || event.status)
    );
    return;
  }

  if (event?.type === 'result') {
    const draft = event.result?.drafts?.[0]?.text || 'No placeholder draft was returned.';
    document.getElementById('deep-draft').value = draft;
    renderMemoryMatches(event.result?.matches || [], event.result?.layers?.memory);
    document.getElementById('deep-result').classList.remove('hidden');
    finishDeepRun();
    const memoryDetail = event.result?.layers?.memory?.detail || 'Layer 1 matching completed.';
    showCurrentStatus(memoryDetail + ' Message drafting remains a placeholder until a later step.', 'success');
    return;
  }

  if (event?.type === 'error') {
    finishDeepRun();
    showCurrentStatus(event.error || 'Deep Mode could not complete this run.', 'error');
  }
}

function renderMemoryMatches(matches, layerResult = {}) {
  const list = document.getElementById('memory-match-list');
  list.replaceChildren();
  if (!Array.isArray(matches) || !matches.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-match-empty';
    empty.textContent = layerResult?.detail || 'No matches cleared the medium threshold. Deep Mode will not claim a connection from weak overlap.';
    list.append(empty);
    return;
  }

  for (const match of matches) {
    const item = document.createElement('article');
    item.className = 'memory-match-item';

    const header = document.createElement('div');
    header.className = 'memory-match-header';
    const tier = document.createElement('span');
    tier.className = 'memory-match-tier ' + (match.tier === 'strong' ? 'strong' : 'medium');
    tier.textContent = (match.tier || 'match') + (match.exact ? ' · exact entity' : '');
    const score = document.createElement('span');
    score.className = 'memory-match-score';
    score.textContent = Math.round((Number(match.score) || 0) * 100) + '%';
    header.append(tier, score);

    const meFact = document.createElement('p');
    meFact.className = 'memory-match-fact';
    const meLabel = document.createElement('strong');
    meLabel.textContent = 'You: ';
    meFact.append(meLabel, document.createTextNode(match.meText || match.meFactId || ''));

    const otherFact = document.createElement('p');
    otherFact.className = 'memory-match-fact';
    const otherLabel = document.createElement('strong');
    otherLabel.textContent = 'Profile: ';
    otherFact.append(otherLabel, document.createTextNode(match.otherText || match.otherFactId || ''));

    item.append(header, meFact, otherFact);
    list.append(item);
  }
}

function finishDeepRun() {
  const port = deepRunPort;
  deepRunPort = null;
  deepRunFinished = true;
  isDeepRunning = false;
  setButtonLoading('deep-run-btn', 'deep-run-label', 'deep-run-spinner', false, 'Run Deep Mode');
  if (port) {
    try { port.disconnect(); } catch (_) {}
  }
  updateDeepRunAvailability();
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await loadStoredSettings();
  if (s.userApiKey) document.getElementById('api-key').value = s.userApiKey;
  if (s.userName)   document.getElementById('user-name').value   = s.userName;
  if (s.userBio)    document.getElementById('user-bio').value    = s.userBio;
  if (s.resumeBase64) {
    document.getElementById('file-label').textContent = s.resumeFileName;
    document.getElementById('file-upload-area').classList.add('has-file');
    const statusEl = document.getElementById('resume-status');
    statusEl.textContent = 'An older saved PDF can be converted locally. It will be deleted after you save its memory card.';
    statusEl.className   = 'resume-status pending';
    statusEl.classList.remove('hidden');
    document.getElementById('convert-legacy-resume-btn').classList.remove('hidden');
  }
  try {
    const savedCard = await sendToBackground({ type: 'GET_MEMORY_CARD' });
    if (savedCard) renderMemoryCardEditor(savedCard);
  } catch (error) {
    showResumeStatus(error.message, 'error');
  }
}

async function handleSaveSettings() {
  const userApiKey = document.getElementById('api-key').value.trim();
  const userName   = document.getElementById('user-name').value.trim();
  const userBio    = document.getElementById('user-bio').value.trim();

  const savePayload = { userApiKey, userName, userBio };
  await new Promise(resolve => chrome.storage.local.set(savePayload, resolve));
  showSettingsStatus('Settings saved!', 'success');
  await checkLicenseStatus();
  await updateDeepRunAvailability();
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) return;

  const btn = document.getElementById('validate-btn');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey } }, resolve);
  });

  btn.textContent = 'Test';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    el.textContent = '✓ Key works — AI Mode on';
    el.className   = 'key-validation-status valid';
    const s = await loadStoredSettings();
    await new Promise(resolve => chrome.storage.local.set({ ...s, userApiKey: apiKey }, resolve));
    await checkLicenseStatus();
    await updateDeepRunAvailability();
  } else {
    el.textContent = `✗ ${result?.reason || 'Key did not work'}`;
    el.className   = 'key-validation-status invalid';
  }
}

// ─── Pipeline UI ──────────────────────────────────────────────────────────────
function setLayerStatus(layer, status, text) {
  document.getElementById(`l${layer}-dot`).className = `status-dot ${status}`;
  document.getElementById(`l${layer}-text`).textContent = text;
}

function resetLayerStatuses() {
  [1, 2, 3].forEach((number) => setLayerStatus(number, '', 'Ready'));
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');
  const name = data.name || 'Unknown';
  document.getElementById('profile-avatar').textContent  = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent    = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';
}

function renderMessage(text) {
  const message = String(text || '').trim();
  if (!message) throw new Error('No message was generated. Please try again.');
  document.getElementById('generated-message').value = message;
  document.getElementById('message-section').classList.remove('hidden');
  updateCharCount();
}

function hideMessage() { document.getElementById('message-section').classList.add('hidden'); }
function updateCharCount() {
  document.getElementById('char-count').textContent = `${document.getElementById('generated-message').value.length} chars`;
}

async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch(_) {
    const ta = document.getElementById('generated-message');
    ta.select(); document.execCommand('copy');
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary'); btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  }, 2200);
}

function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(labelId).innerHTML = labelText;
  document.getElementById(spinnerId).classList.toggle('hidden', !loading);
}

// ─── Recent contacts ──────────────────────────────────────────────────────────
async function renderRecentContacts() {
  const contacts  = await Cache.getContacts();
  const listEl    = document.getElementById('recent-list');
  const emptyEl   = document.getElementById('no-recent');
  const actionsEl = document.getElementById('recent-actions');
  listEl.innerHTML = '';
  if (contacts.length === 0) {
    emptyEl.classList.remove('hidden'); actionsEl.classList.add('hidden'); return;
  }
  emptyEl.classList.add('hidden'); actionsEl.classList.remove('hidden');
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name||'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline||contact.company||'')}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message||'')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (!response.success) { reject(new Error(response.error || 'Background returned an error.')); return; }
      if (response.data !== undefined) { resolve(response.data); return; }
      if (response.generatedMessage !== undefined) { resolve(response.generatedMessage); return; }
      reject(new Error('Unexpected response: ' + JSON.stringify(Object.keys(response))));
    });
  });
}

// ─── Resume upload ────────────────────────────────────────────────────────────
function showResumeStatus(message, type = 'pending') {
  const statusEl = document.getElementById('resume-status');
  statusEl.textContent = message;
  statusEl.className = 'resume-status ' + type;
  statusEl.classList.remove('hidden');
}

function processResumeFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    showResumeStatus('Please choose a PDF file.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showResumeStatus('Resume PDF is too large. The limit is 10 MB.', 'error');
    return;
  }

  selectedResumeFile = file;
  preparedResumeIdentity = { name: '', headline: '' };
  document.getElementById('file-label').textContent = file.name || 'Resume PDF selected';
  document.getElementById('file-upload-area').classList.add('has-file');
  document.getElementById('resume-text-input').value = '';
  document.getElementById('resume-review').classList.add('hidden');
  document.getElementById('resume-review-confirm').checked = false;
  updateBuildMemoryCardAvailability();
  showResumeStatus('PDF selected. Extract and review the sanitized sections to continue.', 'pending');
}

async function handlePrepareResume() {
  const button = document.getElementById('prepare-resume-btn');
  button.disabled = true;
  preparedResumeIdentity = { name: '', headline: '' };
  document.getElementById('resume-review').classList.add('hidden');
  showResumeStatus('Reading resume locally…', 'pending');
  try {
    let rawText = document.getElementById('resume-text-input').value;
    if (selectedResumeFile) {
      const { extractPdfText } = await import(chrome.runtime.getURL('src/utils/pdf.js'));
      rawText = await extractPdfText(selectedResumeFile, {
        onProgress: ({ phase, page, total, progress }) => {
          if (phase === 'ocr') showResumeStatus(`Running local OCR on page ${page} of ${total} (${Math.round((progress || 0) * 100)}%)…`, 'pending');
          else if (phase === 'extract') showResumeStatus(`Extracting page ${page} of ${total} locally…`, 'pending');
          else if (phase === 'ocr-start') showResumeStatus(`Preparing local OCR for page ${page} of ${total}…`, 'pending');
        }
      });
    }
    if (!String(rawText || '').trim()) throw new Error('No resume text was found. Try a searchable PDF or paste its text.');
    if (rawText.length > 60000) throw new Error('The extracted resume is too long to process safely. Use a shorter resume or paste the relevant sections.');

    const { sectionizeResumeText, findResumePii } = await import(chrome.runtime.getURL('src/utils/resume.js'));
    const localName = document.getElementById('user-name').value.trim();
    const result = sectionizeResumeText(rawText, { name: localName });
    preparedResumeIdentity = {
      name: result.identity.name,
      headline: result.identity.headline
    };
    const findings = findResumePii(result.sections, {
      name: localName,
      names: [result.identity.name, result.identity.detectedName]
    });
    document.getElementById('resume-sanitized-json').value = JSON.stringify(result.sections, null, 2);
    const counts = Object.entries(result.redactions)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind}: ${count}`);
    const identityStatus = `Local header check — name ${result.identity.name ? 'available' : 'not found'}, headline ${result.identity.headline ? 'found' : 'not found'}.`;
    document.getElementById('resume-redaction-count').textContent = counts.length
      ? `${identityStatus} Removed locally — ${counts.join(', ')}`
      : `${identityStatus} No contact details were detected for removal.`;
    document.getElementById('resume-review').classList.remove('hidden');
    document.getElementById('resume-review-confirm').checked = false;
    document.getElementById('resume-text-input').value = '';
    selectedResumeFile = null;
    document.getElementById('resume-upload').value = '';
    updateBuildMemoryCardAvailability();
    if (findings.length) {
      showResumeStatus('Potential contact details remain. Remove them from the JSON preview before sending.', 'error');
    } else {
      showResumeStatus('Text extraction and PII checks ran locally. Review the JSON before sending it to Groq.', 'success');
    }
  } catch (error) {
    showResumeStatus(error?.message || 'Could not process this resume.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function handleConvertLegacyResume() {
  try {
    const settings = await loadStoredSettings();
    if (!settings.resumeBase64) throw new Error('No older saved resume was found.');
    const binary = atob(settings.resumeBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const file = new File([bytes], settings.resumeFileName || 'saved-resume.pdf', { type: 'application/pdf' });
    processResumeFile(file);
    await handlePrepareResume();
  } catch (error) {
    showResumeStatus(error?.message || 'Could not convert the previously saved PDF.', 'error');
  }
}

let privacyCheckSequence = 0;

async function updateBuildMemoryCardAvailability() {
  const button = document.getElementById('build-memory-card-btn');
  if (!button) return;
  const checkSequence = ++privacyCheckSequence;
  button.disabled = true;
  let safe = false;
  try {
    const sections = JSON.parse(document.getElementById('resume-sanitized-json').value || '{}');
    const localName = preparedResumeIdentity.name || document.getElementById('user-name').value.trim();
    const { assertResumeSectionsSafe } = await import(chrome.runtime.getURL('src/utils/resume.js'));
    const sanitized = assertResumeSectionsSafe(sections, {
      name: localName,
      names: [preparedResumeIdentity.name]
    });
    safe = Object.values(sanitized).some((items) => items.length);
  } catch (_) {
    safe = false;
  }
  if (checkSequence === privacyCheckSequence) {
    button.disabled = !safe || !document.getElementById('resume-review-confirm').checked;
  }
}

async function handleBuildMemoryCard() {
  const button = document.getElementById('build-memory-card-btn');
  button.disabled = true;
  try {
    const sections = JSON.parse(document.getElementById('resume-sanitized-json').value || '{}');
    const { assertResumeSectionsSafe } = await import(chrome.runtime.getURL('src/utils/resume.js'));
    const safeSections = assertResumeSectionsSafe(sections, {
      name: preparedResumeIdentity.name || document.getElementById('user-name').value.trim(),
      names: [preparedResumeIdentity.name]
    });
    if (!Object.values(safeSections).some((items) => items.length)) throw new Error('No resume sections contain text.');
    showResumeStatus('Groq is structuring the sanitized sections…', 'pending');
    const card = await sendToBackground({ type: 'BUILD_MEMORY_CARD', payload: { sections: safeSections } });
    renderMemoryCardEditor({
      ...card,
      name: preparedResumeIdentity.name || card.name || document.getElementById('user-name').value.trim(),
      headline: preparedResumeIdentity.headline || card.headline
    });
    showResumeStatus('Memory card ready to review. Save it to store it locally and remove any older saved PDF.', 'success');
  } catch (error) {
    showResumeStatus(error?.message || 'Could not build the memory card.', 'error');
  } finally {
    updateBuildMemoryCardAvailability();
  }
}

function makeInput(value, placeholder, multiline = false) {
  const element = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) element.type = 'text';
  else element.rows = 3;
  element.className = multiline ? 'field-textarea' : 'field-input';
  element.value = String(value || '');
  element.placeholder = placeholder || '';
  return element;
}

function addScalarMemoryField(container, key, labelText, value, multiline = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'memory-card-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = makeInput(value, labelText, multiline);
  input.dataset.memoryScalar = key;
  wrapper.append(label, input);
  container.append(wrapper);
}

function addRemoveButton(row, onRemove) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-ghost';
  button.textContent = 'Remove';
  button.addEventListener('click', () => { row.remove(); });
  return button;
}

function addSimpleListEditor(container, key, labelText, values = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'memory-card-field';
  wrapper.dataset.memoryList = key;
  const label = document.createElement('label');
  label.textContent = labelText + ' (one item per row)';
  const list = document.createElement('div');
  list.className = 'memory-list-editor';
  const addRow = (value = '') => {
    const row = document.createElement('div');
    row.className = 'memory-list-row';
    row.dataset.simpleListRow = key;
    const input = makeInput(value, labelText);
    input.dataset.itemValue = 'true';
    row.append(input, addRemoveButton(row));
    list.append(row);
  };
  (Array.isArray(values) ? values : []).forEach((value) => addRow(value));
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn-ghost';
  addButton.textContent = '+ Add ' + labelText.toLowerCase().replace(/s$/, '');
  addButton.addEventListener('click', () => addRow());
  wrapper.append(label, list, addButton);
  container.append(wrapper);
}

function addObjectListEditor(container, key, labelText, values = [], fields = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'memory-card-field';
  wrapper.dataset.memoryObjectList = key;
  const label = document.createElement('label');
  label.textContent = labelText;
  const list = document.createElement('div');
  list.className = 'memory-list-editor';
  const addRow = (value = {}) => {
    const row = document.createElement('div');
    row.className = 'memory-list-row';
    row.dataset.objectListRow = key;
    for (const field of fields) {
      const input = makeInput(
        Array.isArray(value[field.key]) ? value[field.key].join('\n') : value[field.key],
        field.label,
        field.multiline || field.array
      );
      input.dataset.objectField = field.key;
      if (field.array) input.dataset.objectArray = 'true';
      row.append(input);
    }
    row.append(addRemoveButton(row));
    list.append(row);
  };
  (Array.isArray(values) ? values : []).forEach((value) => addRow(value));
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn-ghost';
  addButton.textContent = '+ Add ' + labelText.toLowerCase().replace(/s$/, '');
  addButton.addEventListener('click', () => addRow());
  wrapper.append(label, list, addButton);
  container.append(wrapper);
}

function renderMemoryCardEditor(card = {}) {
  const container = document.getElementById('memory-card-fields');
  container.replaceChildren();
  memoryCardOriginal = JSON.parse(JSON.stringify(card || {}));
  addScalarMemoryField(container, 'name', 'Name (saved locally only)', card.name || document.getElementById('user-name').value, false);
  addScalarMemoryField(container, 'headline', 'Headline', card.headline, false);
  addScalarMemoryField(container, 'summary', 'Summary', card.summary, true);
  addSimpleListEditor(container, 'skills', 'Skills', card.skills);
  addObjectListEditor(container, 'education', 'Education', card.education, [
    { key: 'school', label: 'School' }, { key: 'degree', label: 'Degree' },
    { key: 'field', label: 'Field' }, { key: 'years', label: 'Years' }
  ]);
  addObjectListEditor(container, 'experience', 'Experience', card.experience, [
    { key: 'title', label: 'Title' }, { key: 'org', label: 'Organization' },
    { key: 'years', label: 'Years' }, { key: 'highlights', label: 'Highlights, one per line', array: true, multiline: true }
  ]);
  addObjectListEditor(container, 'projects', 'Projects', card.projects, [
    { key: 'name', label: 'Project name' }, { key: 'summary', label: 'Summary', multiline: true },
    { key: 'tech', label: 'Technology, one per line', array: true, multiline: true }
  ]);
  addSimpleListEditor(container, 'achievements', 'Achievements', card.achievements);
  addScalarMemoryField(container, 'goals', 'Goals', card.goals, true);
  addSimpleListEditor(container, 'interests', 'Interests', card.interests);
  document.getElementById('memory-card-editor').classList.remove('hidden');
}

function collectMemoryCardFromEditor() {
  const container = document.getElementById('memory-card-fields');
  const result = { version: 1 };
  container.querySelectorAll('[data-memory-scalar]').forEach((input) => {
    result[input.dataset.memoryScalar] = input.value.trim();
  });
  container.querySelectorAll('[data-memory-list]').forEach((wrapper) => {
    const key = wrapper.dataset.memoryList;
    result[key] = [...wrapper.querySelectorAll(`[data-simple-list-row="${key}"] [data-item-value]`)]
      .map((input) => input.value.trim()).filter(Boolean);
  });
  container.querySelectorAll('[data-memory-object-list]').forEach((wrapper) => {
    const key = wrapper.dataset.memoryObjectList;
    result[key] = [...wrapper.querySelectorAll(`[data-object-list-row="${key}"]`)].map((row) => {
      const entry = {};
      row.querySelectorAll('[data-object-field]').forEach((input) => {
        const value = input.value.trim();
        entry[input.dataset.objectField] = input.dataset.objectArray === 'true'
          ? value.split('\n').map((line) => line.trim()).filter(Boolean)
          : value;
      });
      return entry;
    }).filter((entry) => Object.values(entry).some((value) => Array.isArray(value) ? value.length : value));
  });
  return result;
}

async function handleSaveMemoryCard() {
  try {
    const card = collectMemoryCardFromEditor();
    const saved = await sendToBackground({ type: 'SAVE_MEMORY_CARD', payload: { card } });
    renderMemoryCardEditor(saved);
    document.getElementById('convert-legacy-resume-btn').classList.add('hidden');
    showResumeStatus('Memory card saved locally. Any previously saved PDF data has been removed.', 'success');
  } catch (error) {
    showResumeStatus(error?.message || 'Could not save the memory card.', 'error');
  }
}

function handleResetMemoryCard() {
  renderMemoryCardEditor(memoryCardOriginal || {});
}

async function handleClearAllData() {
  if (!confirm('Clear all extension data, including your API key, memory card, resume, and recent contacts?')) return;
  try {
    await sendToBackground({ type: 'CLEAR_ALL_DATA' });
    document.getElementById('api-key').value = '';
    document.getElementById('user-name').value = '';
    document.getElementById('user-bio').value = '';
    document.getElementById('resume-upload').value = '';
    document.getElementById('resume-text-input').value = '';
    document.getElementById('resume-sanitized-json').value = '';
    document.getElementById('resume-review-confirm').checked = false;
    document.getElementById('resume-redaction-count').textContent = '';
    document.getElementById('file-label').textContent = 'Choose or drop a PDF (max 10 MB)';
    document.getElementById('file-upload-area').classList.remove('has-file');
    document.getElementById('resume-review').classList.add('hidden');
    document.getElementById('memory-card-editor').classList.add('hidden');
    document.getElementById('memory-card-fields').replaceChildren();
    document.getElementById('convert-legacy-resume-btn').classList.add('hidden');
    document.getElementById('resume-status').classList.add('hidden');
    selectedResumeFile = null;
    preparedResumeIdentity = { name: '', headline: '' };
    memoryCardOriginal = null;
    showSettingsStatus('All extension data cleared.', 'success');
    await renderRecentContacts();
    await checkLicenseStatus();
    await updateDeepRunAvailability();
  } catch (error) {
    showResumeStatus(error?.message || 'Could not clear extension data.', 'error');
  }
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey', 'userName', 'userBio', 'resumeBase64', 'resumeFileName'], resolve);
  });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
