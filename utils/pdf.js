const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MIN_SELECTABLE_TEXT = 30;
const OCR_RENDER_SCALE = 1.7;

function extensionUrl(path) {
  if (!globalThis.chrome?.runtime?.getURL) {
    throw new Error('Resume PDF processing must run inside the extension popup.');
  }
  return globalThis.chrome.runtime.getURL(path);
}

export function selectablePageText(items = []) {
  let text = '';
  let previousY = null;
  for (const item of items) {
    const value = String(item?.str || '').trim();
    if (!value) continue;
    const y = Number.isFinite(item?.transform?.[5]) ? item.transform[5] : null;
    const changedLine = y !== null && previousY !== null && Math.abs(y - previousY) > 2;
    if (text && !text.endsWith('\n')) text += item.hasEOL || changedLine ? '\n' : ' ';
    text += value;
    if (item.hasEOL) text += '\n';
    if (y !== null) previousY = y;
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function loadPdfJs() {
  return import(extensionUrl('node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
}

async function loadTesseract() {
  return import(extensionUrl('node_modules/tesseract.js/dist/tesseract.esm.min.js'));
}

async function defaultOcrWorkerFactory({ onProgress = () => {}, assetUrl = extensionUrl } = {}) {
  const { createWorker } = await loadTesseract();
  return createWorker('eng', 1, {
    workerPath: assetUrl('node_modules/tesseract.js/dist/worker.min.js'),
    corePath: assetUrl('node_modules/tesseract.js-core/'),
    langPath: assetUrl('node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
    workerBlobURL: false,
    gzip: true,
    logger: (event) => onProgress(event)
  });
}

export async function extractPdfText(file, {
  pdfjsLoader = loadPdfJs,
  ocrWorkerFactory = defaultOcrWorkerFactory,
  assetUrl = extensionUrl,
  canvasFactory = () => document.createElement('canvas'),
  onProgress = () => {},
  maxBytes = MAX_PDF_BYTES,
  maxPages = MAX_PDF_PAGES
} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new TypeError('Choose a PDF file to extract.');
  }
  if (file.type && file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    throw new TypeError('Please choose a PDF file.');
  }
  if (file.size > maxBytes) throw new Error('Resume PDF is too large. The limit is 10 MB.');

  const pdfjs = await pdfjsLoader();
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  }

  let loadingTask;
  let ocrWorker = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    const pdf = await (loadingTask.promise || loadingTask);
    if (!pdf.numPages) throw new Error('The PDF has no pages.');
    if (pdf.numPages > maxPages) {
      throw new Error('This resume has more than ' + maxPages + ' pages. Please upload a shorter PDF.');
    }

    const pages = [];
    let activeOcrPage = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress({ phase: 'extract', page: pageNumber, total: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = selectablePageText(content.items);

      if (text.length < MIN_SELECTABLE_TEXT) {
        activeOcrPage = pageNumber;
        if (!ocrWorker) {
          onProgress({ phase: 'ocr-start', page: pageNumber, total: pdf.numPages });
          ocrWorker = await ocrWorkerFactory({
            assetUrl,
            onProgress: (event) => onProgress({
              phase: 'ocr', page: activeOcrPage, total: pdf.numPages,
              progress: Number.isFinite(event?.progress) ? event.progress : 0
            })
          });
        }
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = canvasFactory();
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Could not render a PDF page for local OCR.');
        const renderTask = page.render({ canvasContext: context, viewport });
        await (renderTask.promise || renderTask);
        const recognized = await ocrWorker.recognize(canvas);
        text = String(recognized?.data?.text || '').trim();
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push(text);
    }
    return pages.filter(Boolean).join('\n\n');
  } catch (error) {
    if (/Invalid PDF|Failed to parse|password/i.test(error?.message || '')) {
      throw new Error('Could not read this PDF. Check that it is a valid, unlocked resume PDF.');
    }
    throw error;
  } finally {
    if (ocrWorker?.terminate) await ocrWorker.terminate().catch(() => {});
    if (loadingTask?.destroy) await loadingTask.destroy().catch(() => {});
  }
}
