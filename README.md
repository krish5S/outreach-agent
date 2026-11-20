# Outreach Agent

A Manifest V3 Chrome extension that reads a LinkedIn profile and helps prepare personalized outreach. Quick Mode drafts a message; Deep Mode compares the profile with a locally saved resume card. Deep Mode’s later company research and personalized drafting layers are still planned.

## Run the extension

1. Install the local PDF and OCR dependencies with `npm ci`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select this repository’s root folder (the folder containing `manifest.json`).
4. Open a LinkedIn profile and click the extension.

Add a Groq API key in **Settings** to structure a resume card and run Deep Mode. Layer 1 uses local keyword matching; it does not need a separate embeddings provider, model, or API key. Quick Mode remains available independently.

## Project map

```text
manifest.json          Chrome extension entry point and permissions
src/
  background.js        Extension service worker and message routing
  content_script.js    LinkedIn profile extraction
  popup/               Extension interface (HTML, CSS, and browser logic)
  layers/              Deep Mode pipeline and layer implementations
  utils/               Storage, resume processing, facts, matching, and API helpers
assets/icons/          Extension icons
tests/                 Automated tests and sample profile fixtures
scripts/               Local development reports
docs/                  Architecture and data-flow guide
```

For the responsibilities and data flow, see [docs/architecture.md](docs/architecture.md).

## Development checks

```sh
npm test
node scripts/score-report.mjs
```

## Data and privacy

Resume PDFs and OCR run locally. Detected name and headline stay local; recognized email, phone, and common street-address patterns are removed before resume sections are sent to Groq for memory-card structuring. Review the sanitized sections before submitting them. The saved resume card remains in extension storage.

Resume-to-profile matching and its cached keyword vectors stay on-device. No resume or viewed-profile facts are sent to an embeddings service. Resume section JSON is sent to Groq only after local redaction and user review to build the memory card; profile details and bio are sent to Groq when drafting messages. API keys are stored in the extension’s local Chrome storage.
