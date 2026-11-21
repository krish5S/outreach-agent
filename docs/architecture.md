# Architecture and data flow

## Entry points

| File | Responsibility |
| --- | --- |
| `manifest.json` | Declares Chrome permissions, the service worker, popup, content script, and icons. |
| `src/background.js` | Routes popup messages, accesses extension storage, calls providers, and runs Deep Mode. |
| `src/content_script.js` | Reads rendered LinkedIn profile details and returns structured profile data. |
| `src/popup/` | Presents Quick Mode, Deep Mode, Settings, resume review, and results. |
| `src/layers/` | Builds the resume memory card and coordinates Deep Mode layers. |
| `src/utils/` | Shared storage, resume, fact, embedding, matching, prompt, and API helpers. |
| `tests/` | Unit tests and sample profile fixtures. |
| `scripts/` | Local development reports, including matcher score examples. |

## Request flow

```mermaid
flowchart TD
  User[Popup UI] -->|scrape profile| Background[Background service worker]
  Background -->|message| Scraper[LinkedIn content script]
  Scraper -->|structured profile| Background
  Background --> Quick[Quick Mode message]
  Background --> Pipeline[Deep Mode pipeline]
  Pipeline --> Memory[Layer 1: resume/profile matching]
  Pipeline --> Company[Layer 2: Groq web search and company news]
  Pipeline --> Approach[Layer 3: evidence-based strategy and drafts]
  Memory --> Results[Popup results and matched facts]
  Company --> Results
  Approach --> Results
```

## Resume card flow

1. The Settings popup reads PDF text or runs OCR locally through `src/utils/pdf.js`.
2. `src/utils/resume.js` extracts sections and removes detected contact details. The user reviews the sanitized sections before sending them.
3. The background worker passes the reviewed sections to Groq. `src/layers/memory.js` validates the response, ignores model-provided identity fields, and builds a structured card.
4. The user reviews and saves the card. The card is kept in Chrome local storage; an older saved PDF is removed after the card is saved.

## Deep Mode Layer 1

`src/layers/pipeline.js` runs the memory, company, and approach layers in order. For Layer 1, `src/layers/memory.js` turns the saved card and scraped profile into short facts, preserving education and achievement facts ahead of long skill lists. Direct email, phone, and recognized street-address patterns are removed from profile facts before embedding.

`src/utils/embeddings.js` creates and caches keyword vectors locally; matching has no hosted embeddings provider, model setting, or separate API key. `src/utils/matcher.js` combines cosine similarity with exact school, employer, skill, and tool matches; applies generic-overlap penalties; deduplicates the result; and returns up to six pairs. The popup displays the matched facts and scores.

Resume and viewed-profile facts stay on-device during matching. They are not sent to an embeddings service.

## Deep Mode Layer 2

`src/layers/company.js` uses the company confirmed in the popup. `src/utils/search.js` asks Groq's GPT-OSS browser-search tool for current dated sources, then a fast Groq call condenses no more than five facts. The code validates each source URL and date and drops news older than 12 months. News is cached by normalized company name for 24 hours; the selected company is remembered locally per profile URL.

The local keyword matcher compares dated news facts with resume facts, interests, and the selected outreach goal. The results panel shows source links, dates, and whether cached data was reused. A missing company or failed search skips Layer 2 while the rest of the pipeline continues.

## Deep Mode Layer 3

`src/layers/approach.js` builds an evidence pack from strong and medium Layer 1 and Layer 2 matches. A Groq strategist selects one primary hook and at most two supporting matches; a writer prepares short, medium, and question-led drafts. The app validates evidence IDs and message limits, retries invalid model output once, and uses a plain local fallback when there is no suitable match. Users can edit, copy, switch between, or regenerate drafts. Drafts are never sent automatically.

## Extension storage

| Key | Contents |
| --- | --- |
| `userApiKey` | Groq API key for message generation and resume-card structuring. |
| `memoryCard` | The structured resume card and its facts. |
| `vecCache` | Cached local keyword vectors keyed by fact type and text hash. |
| `recentContacts` | Recent generated message records. |
| `companyCache:<slug>` | Dated public company news and source links, cached for 24 hours. |
| `companyChoice:<hash>` | User-confirmed company name associated with a profile URL. |

Use **Clear all my data** in Settings to remove extension-local data.
