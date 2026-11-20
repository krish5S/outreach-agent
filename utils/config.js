export const CONFIG = Object.freeze({
  models: Object.freeze({
    fast: 'openai/gpt-oss-20b',
    strong: 'openai/gpt-oss-120b'
  }),
  thresholds: Object.freeze({
    strong: 0.6,
    medium: 0.45
  }),
  limits: Object.freeze({
    factText: 200,
    maxFacts: 40,
    connectionNoteDefault: 200,
    connectionNoteMax: 300,
    maxDrafts: 3
  }),
  goals: Object.freeze([
    { id: 'internship', label: 'Internship' },
    { id: 'referral', label: 'Referral' },
    { id: 'informational_chat', label: 'Informational chat' },
    { id: 'recruiter_outreach', label: 'Recruiter outreach' },
    { id: 'collaboration', label: 'Collaboration' }
  ]),
  messageTypes: Object.freeze([
    { id: 'connection_note', label: 'Connection note' },
    { id: 'message', label: 'Message' }
  ]),
  cacheTtlMs: Object.freeze({
    companyNews: 24 * 60 * 60 * 1000
  })
});

// Keep existing storage names stable so Quick Mode and user data continue to work.
export const STORAGE_KEYS = Object.freeze({
  settings: 'settings',
  apiKey: 'userApiKey',
  userName: 'userName',
  userBio: 'userBio',
  resumeBase64: 'resumeBase64',
  resumeFileName: 'resumeFileName',
  recentContacts: 'recentContacts',
  latestScrapedProfile: 'latestScrapedProfile',
  memoryCard: 'memoryCard',
  vecCache: 'vecCache',
  companyCachePrefix: 'companyCache:',
  deepRunPrefix: 'deepRun:'
});
