const PDF_JS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';

let pdfModulePromise = null;

async function loadPdfJs() {
  if (!pdfModulePromise) {
    pdfModulePromise = import(PDF_JS_URL).then((module) => {
      if (module.GlobalWorkerOptions) {
        module.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      }
      return module;
    });
  }

  return pdfModulePromise;
}

export async function extractPDFText(file) {
  if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || ''))) {
    return {
      success: false,
      requiresOCR: false,
      text: '',
      error: 'Unsupported file type. Please upload a PDF.'
    };
  }

  try {
    const pdfjs = await loadPdfJs();
    const data = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    const pages = [];
    const pageLayouts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      pageLayouts.push(buildPageLayout(content.items || []));
      const pageText = buildPageText(content.items || []);
      if (pageText.trim()) {
        pages.push(pageText.trim());
      }
    }

    const text = pages
      .join('\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text) {
      return {
        success: false,
        requiresOCR: true,
        text: ''
      };
    }

    return {
      success: true,
      requiresOCR: false,
      text,
      lines: pageLayouts.flatMap((page) => page.lines),
    };
  } catch (error) {
    return {
      success: false,
      requiresOCR: false,
      text: '',
      error: formatError(error)
    };
  }
}

function buildPageText(items) {
  return buildPageLayout(items).text;
}

function buildPageLayout(items) {
  const lines = [];

  for (const item of items) {
    const str = String(item?.str || '').trim();
    if (!str) continue;

    const x = Number(item?.transform?.[4]) || 0;
    const y = Number(item?.transform?.[5]) || 0;
    let targetLine = null;

    for (const line of lines) {
      if (Math.abs(line.y - y) <= 2.5) {
        targetLine = line;
        break;
      }
    }

    if (!targetLine) {
      targetLine = { y, parts: [] };
      lines.push(targetLine);
    }

    targetLine.parts.push({ x, str });
  }

  const orderedLines = lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const parts = line.parts.sort((a, b) => a.x - b.x);
      return {
        text: parts.map((part) => part.str).join(' ').replace(/\s+/g, ' ').trim(),
        words: parts.map((part) => ({ text: part.str, x: part.x, y: line.y })),
      };
    })
    .filter((line) => line.text || line.words.length);

  return {
    text: orderedLines.map((line) => line.text).filter(Boolean).join('\n'),
    lines: orderedLines,
  };
}

function formatError(error) {
  if (!error) return 'Failed to read the PDF.';
  if (error instanceof Error) return error.message || 'Failed to read the PDF.';
  return String(error.message || error.error || error || 'Failed to read the PDF.');
}