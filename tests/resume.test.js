import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResumeSectionsSafe, extractResumeIdentity, findResumePii, sectionizeResumeText } from '../utils/resume.js';
import { extractPdfText, selectablePageText } from '../utils/pdf.js';

const sampleResume = `
Alex Example
alex.example@example.test | +1 (415) 555-0198
Address: 123 Main Street, Example City, CA 90210

PROFESSIONAL SUMMARY
Software engineer focused on accessible web applications.

EXPERIENCE
Software Engineer
Example Labs | 2021 – 2024
Built a web application for community organizations.

EDUCATION
Example University
Bachelor of Science, Computer Science | 2017 – 2021

SKILLS
JavaScript, TypeScript, accessibility

CONTACT
alex.example@example.test
`;

test('resume sectioning removes contact details and keeps career sections', () => {
  const result = sectionizeResumeText(sampleResume, { name: 'Alex Example' });
  const payload = JSON.stringify(result.sections);
  assert.ok(result.sections.summary.some((line) => line.includes('Software engineer')));
  assert.ok(result.sections.experience.some((line) => line.includes('Example Labs')));
  assert.ok(result.sections.education.some((line) => line.includes('Example University')));
  assert.ok(result.sections.skills.some((line) => line.includes('TypeScript')));
  assert.doesNotMatch(payload, /alex\.example@example\.test/i);
  assert.doesNotMatch(payload, /415/);
  assert.doesNotMatch(payload, /123 Main Street/i);
  assert.doesNotMatch(payload, /Alex Example/);
  assert.match(payload, /2021/);
  assert.ok(result.redactions.email > 0);
  assert.ok(result.redactions.phone > 0);
  assert.ok(result.redactions.address > 0);
  assert.ok(result.redactions.name > 0);
});

test('resume header name and headline are extracted locally and excluded from Groq sections', () => {
  const resume = [
    'Krish Sawant',
    'B-Tech AIML @DJSCE’28 | Aspiring AI Engineer',
    'krish.sawant@example.test | +91 98765 43210',
    'PROFESSIONAL SUMMARY',
    'Software engineering undergraduate focused on AI applications.'
  ].join('\n');

  const identity = extractResumeIdentity(resume);
  const result = sectionizeResumeText(resume);
  const payload = JSON.stringify(result.sections);

  assert.equal(identity.name, 'Krish Sawant');
  assert.equal(identity.headline, 'B-Tech AIML @DJSCE’28 | Aspiring AI Engineer');
  assert.equal(result.identity.name, identity.name);
  assert.equal(result.identity.headline, identity.headline);
  assert.doesNotMatch(payload, /Krish Sawant|Aspiring AI Engineer|krish\.sawant@example\.test|98765/);
  assert.match(payload, /Software engineering undergraduate/);
  assert.deepEqual(findResumePii(result.sections, { name: identity.name }), []);
});

test('a name and headline sharing one header line are separated before sending sections', () => {
  const result = sectionizeResumeText([
    'Krish Sawant | Aspiring AI Engineer',
    'Professional summary',
    'Builds useful software.'
  ].join('\n'));

  assert.equal(result.identity.name, 'Krish Sawant');
  assert.equal(result.identity.headline, 'Aspiring AI Engineer');
  assert.doesNotMatch(JSON.stringify(result.sections), /Krish Sawant|Aspiring AI Engineer/);
});

test('a PDF header flattened into one line still separates a leading name from its headline', () => {
  const result = sectionizeResumeText([
    'Vivan Tejani B-Tech AIML @DJSCE’28 | Aspiring AI Engineer',
    'Professional summary',
    'Builds useful software.'
  ].join('\n'));

  assert.equal(result.identity.name, 'Vivan Tejani');
  assert.match(result.identity.headline, /Aspiring AI Engineer/);
  assert.doesNotMatch(JSON.stringify(result.sections), /Vivan Tejani|Aspiring AI Engineer/);
});

test('PDF text item baselines are restored as line breaks for header parsing', () => {
  const text = selectablePageText([
    { str: 'Vivan Tejani', transform: [1, 0, 0, 1, 40, 700] },
    { str: 'Aspiring AI Engineer', transform: [1, 0, 0, 1, 40, 680], hasEOL: true }
  ]);
  assert.equal(text, 'Vivan Tejani\nAspiring AI Engineer');
});

test('outbound resume JSON rejects any remaining direct contact details or unknown keys', () => {
  assert.throws(() => assertResumeSectionsSafe({
    skills: ['TypeScript user@example.test']
  }), /email/);
  assert.throws(() => assertResumeSectionsSafe({
    experience: ['Phone: +1 415 555 0198']
  }), /phone/);
  assert.throws(() => assertResumeSectionsSafe({
    summary: ['123 Main Street, Example City, CA']
  }), /address/);
  assert.throws(() => assertResumeSectionsSafe({
    summary: ['Mail project materials to 123 Main Street, Example City.']
  }), /address/);
  assert.throws(() => assertResumeSectionsSafe({ name: 'Alex Example' }), /unsupported fields/);
  assert.deepEqual(findResumePii({ summary: ['Alex Example'] }, { name: 'Alex Example' }), ['name']);
  assert.deepEqual(findResumePii({ summary: ['Planning systems for teams'] }, { name: 'Ann' }), []);
});

test('PDF extraction uses selectable text and OCR only for scanned pages', async () => {
  let ocrCalls = 0;
  let terminated = false;
  let workerSource = '';
  const pages = [
    {
      async getTextContent() {
        return { items: [{ str: 'A long selectable text section from this digital resume.', hasEOL: true }] };
      }
    },
    {
      async getTextContent() { return { items: [] }; },
      getViewport() { return { width: 100, height: 150 }; },
      render() { return { promise: Promise.resolve() }; }
    }
  ];
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          async getPage(number) { return pages[number - 1]; }
        }),
        async destroy() {}
      };
    }
  };
  const text = await extractPdfText({
    name: 'resume.pdf', type: 'application/pdf', size: 5,
    async arrayBuffer() { return new ArrayBuffer(5); }
  }, {
    pdfjsLoader: async () => pdfjs,
    assetUrl: (path) => { workerSource = path; return 'chrome-extension://test/' + path; },
    canvasFactory: () => ({
      getContext() { return {}; },
      width: 0,
      height: 0
    }),
    ocrWorkerFactory: async () => ({
      async recognize() { ocrCalls += 1; return { data: { text: 'Scanned project section from OCR.' } }; },
      async terminate() { terminated = true; }
    })
  });

  assert.match(text, /selectable text/);
  assert.match(text, /Scanned project section from OCR/);
  assert.equal(ocrCalls, 1);
  assert.equal(terminated, true);
  assert.match(workerSource, /pdf\.worker\.mjs$/);
});
