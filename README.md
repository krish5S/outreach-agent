# outreach-agent

A Manifest V3 Chrome extension that uses profile details and recent posts to help draft personalized LinkedIn messages.

## Run locally

1. Install the local PDF/OCR runtime files: `npm install`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select this project folder.
4. Add a Groq API key in the extension Settings to use AI message drafting and resume-to-memory-card conversion.

## Resume privacy

PDF text extraction and OCR run in the extension using locally installed PDF.js and Tesseract.js assets. The name and headline are detected from the resume header on-device (the name can also come from Settings); both stay local and are excluded from the section JSON sent to Groq. The extension also removes detected email addresses, phone numbers, and common street-address patterns. You review the JSON before sending it; automatic checks can miss details. Skills, education, projects, and work history remain personal information and are sent to Groq for structuring. New PDFs and raw extracted text are not saved in extension storage. A PDF saved by an older version is deleted after its converted memory card is saved.

## Automated checks

Run `npm test` for the built-in Node test suite.
