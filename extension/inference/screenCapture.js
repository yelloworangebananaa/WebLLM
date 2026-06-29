import { RawImage } from '@huggingface/transformers';
import { config, getResolutionTier } from './config.js';

function computeContentProfile(imageData, width, height) {
  let edgeSum = 0;
  let edgeCount = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let rSq = 0;
  let gSq = 0;
  let bSq = 0;
  const pixelCount = width * height;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];

      rSum += r;
      gSum += g;
      bSum += b;
      rSq += r * r;
      gSq += g * g;
      bSq += b * b;

      const left = imageData[idx - 4];
      const right = imageData[idx + 4];
      const up = imageData[((y - 1) * width + x) * 4];
      const down = imageData[((y + 1) * width + x) * 4];
      const gx = Math.abs(right - left);
      const gy = Math.abs(down - up);
      edgeSum += Math.sqrt(gx * gx + gy * gy) / 255;
      edgeCount += 1;
    }
  }

  const edgeDensity = edgeCount ? edgeSum / edgeCount : 0;
  const rVar = rSq / pixelCount - (rSum / pixelCount) ** 2;
  const gVar = gSq / pixelCount - (gSum / pixelCount) ** 2;
  const bVar = bSq / pixelCount - (bSum / pixelCount) ** 2;
  const colorVariance = rVar + gVar + bVar;

  if (edgeDensity >= config.edgeDensityTextThreshold && colorVariance < config.colorVarianceImageThreshold) {
    return 'text';
  }
  if (colorVariance >= config.colorVarianceImageThreshold) {
    return 'image';
  }
  return 'text';
}

function computeDHash(imageData, width, height) {
  const sampleW = 9;
  const sampleH = 8;
  const canvas = new OffscreenCanvas(sampleW, sampleH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const src = new OffscreenCanvas(width, height);
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  srcCtx.putImageData(new ImageData(imageData, width, height), 0, 0);
  ctx.drawImage(src, 0, 0, sampleW, sampleH);
  const small = ctx.getImageData(0, 0, sampleW, sampleH).data;

  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW - 1; x++) {
      const i = (y * sampleW + x) * 4;
      const j = i + 4;
      const lumA = small[i] * 0.299 + small[i + 1] * 0.587 + small[i + 2] * 0.114;
      const lumB = small[j] * 0.299 + small[j + 1] * 0.587 + small[j + 2] * 0.114;
      if (lumA > lumB) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  src.width = 0;
  src.height = 0;
  canvas.width = 0;
  canvas.height = 0;
  return hash.toString(16);
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function compressCapture(dataUrl, maxWidth, device, degradedSteps) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  let canvas = null;
  let resizedBitmap = null;

  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);

    const analysis = ctx.getImageData(0, 0, width, height);
    const contentProfile = computeContentProfile(analysis.data, width, height);
    const targetWidth = getResolutionTier(device, contentProfile, degradedSteps);

    if (targetWidth !== width) {
      const finalScale = Math.min(1, targetWidth / bitmap.width);
      const finalW = Math.max(1, Math.round(bitmap.width * finalScale));
      const finalH = Math.max(1, Math.round(bitmap.height * finalScale));
      canvas.width = 0;
      canvas.height = 0;
      canvas = new OffscreenCanvas(finalW, finalH);
      const finalCtx = canvas.getContext('2d', { willReadFrequently: true });
      finalCtx.drawImage(bitmap, 0, 0, finalW, finalH);
    }

    const outBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: config.jpegQuality,
    });
    const hashData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const hash = computeDHash(hashData.data, canvas.width, canvas.height);
    const imageBase64 = await blobToBase64(outBlob);

    return { imageBase64, hash, contentProfile };
  } finally {
    bitmap.close?.();
    resizedBitmap?.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
    }
  }
}

export async function captureAndCompress(windowId, device, degradedSteps = 0) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: 'jpeg',
    quality: config.captureQuality,
  });
  return compressCapture(dataUrl, config.resolution.textHeavy, device, degradedSteps);
}

export async function captureWithRetry(windowId, device, degradedSteps = 0) {
  try {
    return await captureAndCompress(windowId, device, degradedSteps);
  } catch {
    return captureAndCompress(windowId, device, degradedSteps);
  }
}

export async function compressFromDataUrl(dataUrl, device, degradedSteps = 0) {
  return compressCapture(dataUrl, config.resolution.textHeavy, device, degradedSteps);
}

export async function hashFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  let canvas = null;

  try {
    const width = 64;
    const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return computeDHash(imageData.data, width, height);
  } finally {
    bitmap.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export async function probeScreenHash(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: 'jpeg',
    quality: config.captureQuality,
  });
  return hashFromDataUrl(dataUrl);
}

export async function base64ToRawImage(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  return RawImage.read(blob);
}
