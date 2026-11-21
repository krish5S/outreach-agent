# Outreach Agent

A Manifest V3 Chrome extension that reads one LinkedIn profile at a time and prepares personalized outreach. Quick Mode drafts a message. Deep Mode compares the profile with a locally saved resume card, researches recent company news, and prepares three evidence-based message variants for review.

## Run the extension

1. Install the local PDF and OCR dependencies with `npm ci`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select this repository’s root folder (the folder containing `manifest.json`).
4. Open a LinkedIn profile and click the extension.

Add a Groq API key in **Settings** to structure a resume card, research company news, and run Deep Mode. Layer 1 uses local keyword matching; it does not need a separate embeddings provider, model, or API key. Quick Mode remains available independently.

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

Resume PDFs and OCR run locally. Detected name and headline stay local during resume extraction; recognized email, phone, and common street-address patterns are removed before the sections you review are sent to Groq for memory-card structuring. The saved resume card remains in extension storage.

Resume-to-profile matching and its cached keyword vectors stay on-device. Company search sends the selected company, goal, and up to eight skills/interests keywords to Groq; Groq returns dated public results that it condenses. Drafting sends the saved resume facts (up to 40 short facts), the Layer 1/2 matches, your sender name, and your background. Company news is cached locally for 24 hours. API keys stay in Chrome local storage, and the extension never sends LinkedIn messages.
