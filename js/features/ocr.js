const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const PDF_JS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';

let tesseractPromise = null;
let pdfModulePromise = null;

function isSupportedImage(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return (
    type.startsWith('image/') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp')
  );
}

function isPdf(file) {
  return String(file?.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }

    const existing = [...document.querySelectorAll('script')].find((script) => script.src === src);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Tesseract), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load OCR library.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Failed to load OCR library.'));
    document.head.appendChild(script);
  });
}

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!tesseractPromise) {
    tesseractPromise = loadScript(TESSERACT_CDN);
  }
  return tesseractPromise;
}

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

export async function runOCR(file, onProgress = () => {}) {
  try {
    if (!file) {
      return { success: false, error: 'No file provided.' };
    }

    if (isPdf(file)) {
      return await runPdfOCR(file, onProgress);
    }

    if (!isSupportedImage(file)) {
      return {
        success: false,
        error: 'Unsupported file type. Please upload a JPG, PNG, or WEBP image.'
      };
    }

    onProgress(0);
    const bitmap = await createBitmap(file);
    onProgress(15);

    const prepared = await preprocessBitmap(bitmap);
    onProgress(40);

    const text = await recognizeCanvas(prepared, (progress) => {
      onProgress(40 + Math.round(progress * 55));
    });

    onProgress(100);
    return {
      success: true,
      text: String(text || '').trim()
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}

async function runPdfOCR(file, onProgress) {
  onProgress(0);
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageCount = Math.max(1, pdf.numPages || 1);
  const texts = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const rendered = await renderPdfPage(page);
    onProgress(Math.round(((pageNumber - 1) / pageCount) * 30));

    const prepared = await preprocessCanvas(rendered);
    const pageText = await recognizeCanvas(prepared, (progress) => {
      const base = ((pageNumber - 1) / pageCount) * 30;
      const span = 70 / pageCount;
      onProgress(Math.min(99, Math.round(base + progress * span)));
    });

    if (pageText.trim()) {
      texts.push(pageText.trim());
    }
  }

  onProgress(100);

  return {
    success: true,
    text: texts.join('\n\n').trim()
  };
}

async function createBitmap(file) {
  if (window.createImageBitmap) {
    return await createImageBitmap(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read the image.'));
    image.src = src;
  });
}

async function renderPdfPage(page) {
  const viewport = page.getViewport({ scale: 2.25 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

async function preprocessBitmap(source) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const minWidth = 1600;
  const scale = source.width < minWidth ? minWidth / source.width : 1;

  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  applyContrastGrayscale(context, canvas.width, canvas.height);
  clampNearWhiteAndBlack(context, canvas.width, canvas.height);

  const angle = estimateSkewAngle(canvas);
  if (Math.abs(angle) >= 0.75) {
    return rotateCanvas(canvas, angle);
  }

  return canvas;
}

async function preprocessCanvas(sourceCanvas) {
  return preprocessBitmap(sourceCanvas);
}

function applyContrastGrayscale(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
    const contrast = Math.min(255, Math.max(0, Math.round(((gray - 128) * 1.28) + 128)));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }

  context.putImageData(imageData, 0, 0);
}

function clampNearWhiteAndBlack(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const value = data[i];
    if (value > 243) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    } else if (value < 35) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }

  context.putImageData(imageData, 0, 0);
}

function estimateSkewAngle(sourceCanvas) {
  const sample = document.createElement('canvas');
  const context = sample.getContext('2d', { willReadFrequently: true });
  const maxDimension = 720;
  const scale = Math.min(1, maxDimension / Math.max(sourceCanvas.width, sourceCanvas.height));

  sample.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  sample.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  context.drawImage(sourceCanvas, 0, 0, sample.width, sample.height);

  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let angle = -5; angle <= 5; angle += 1) {
    const rotated = rotateCanvas(sample, angle);
    const rotatedContext = rotated.getContext('2d', { willReadFrequently: true });
    const imageData = rotatedContext.getImageData(0, 0, rotated.width, rotated.height);
    const rows = new Array(rotated.height).fill(0);
    const data = imageData.data;

    for (let y = 0; y < rotated.height; y += 1) {
      for (let x = 0; x < rotated.width; x += 1) {
        const offset = ((y * rotated.width) + x) * 4;
        if (data[offset] < 180) {
          rows[y] += 1;
        }
      }
    }

    const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
    const variance = rows.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / rows.length;

    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

function rotateCanvas(sourceCanvas, angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const rotatedWidth = Math.max(1, Math.ceil((width * cos) + (height * sin)));
  const rotatedHeight = Math.max(1, Math.ceil((width * sin) + (height * cos)));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = rotatedWidth;
  canvas.height = rotatedHeight;

  context.translate(rotatedWidth / 2, rotatedHeight / 2);
  context.rotate(radians);
  context.drawImage(sourceCanvas, -width / 2, -height / 2);

  return canvas;
}

async function recognizeCanvas(canvas, onProgress) {
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(canvas, 'eng', {
    logger: (message) => {
      if (message?.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress(message.progress);
      }
    }
  });

  return {
    text: String(result?.data?.text || '').trim(),
    lines: extractOcrLines(result?.data?.lines || []),
  };
}

function extractOcrLines(lines) {
  return lines
    .map((line) => ({
      text: String(line?.text || '').trim(),
      words: Array.isArray(line?.words)
        ? line.words
            .map((word) => ({
              text: String(word?.text || '').trim(),
              x: Number(word?.bbox?.x0 ?? word?.bbox?.left ?? word?.x0 ?? word?.left ?? 0),
              y: Number(word?.bbox?.y0 ?? word?.bbox?.top ?? word?.y0 ?? word?.top ?? 0),
              width: Number(word?.bbox?.x1 ?? word?.bbox?.right ?? word?.width ?? 0),
              height: Number(word?.bbox?.y1 ?? word?.bbox?.bottom ?? word?.height ?? 0),
            }))
            .filter((word) => word.text)
        : [],
    }))
    .filter((line) => line.text || line.words.length);
}

function formatError(error) {
  if (!error) return 'OCR failed.';
  if (error instanceof Error) return error.message || 'OCR failed.';
  return String(error.message || error.error || error || 'OCR failed.');
}