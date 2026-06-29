import { requestQueue } from './requestQueue.js';
import { getCached, setCached } from './tabCache.js';
import { compressFromDataUrl, hashFromDataUrl } from './screenCapture.js';
import {
  initModelOnStartup,
  runInference,
  runPreflight,
  abortInference,
  getRuntimeStatus,
} from './modelRunner.js';
import { resetRequestState, state } from './state.js';

let lastIdleAt = Date.now();

function emit(message) {
  chrome.runtime.sendMessage({ source: 'offscreen', ...message }).catch(() => {});
}

async function resolveImage(tabId, captureDataUrl) {
  const device = state.device === 'unknown' ? 'webgpu' : state.device;

  if (!captureDataUrl) {
    return { imageBase64: null, captureFailed: true };
  }

  try {
    const hash = await hashFromDataUrl(captureDataUrl);
    const cached = getCached(tabId, hash);
    if (cached) {
      return {
        imageBase64: cached.imageBase64,
        captureSkipped: true,
        captureFailed: false,
        contentProfile: cached.contentProfile || 'text',
      };
    }

    const captured = await compressFromDataUrl(captureDataUrl, device, state.degradedSteps);
    setCached(tabId, captured.hash, captured.imageBase64, captured.contentProfile);
    return {
      imageBase64: captured.imageBase64,
      captureSkipped: false,
      captureFailed: false,
      contentProfile: captured.contentProfile,
    };
  } catch {
    try {
      const hash = await hashFromDataUrl(captureDataUrl);
      const captured = await compressFromDataUrl(captureDataUrl, device, state.degradedSteps);
      setCached(tabId, captured.hash, captured.imageBase64, captured.contentProfile);
      return {
        imageBase64: captured.imageBase64,
        captureSkipped: false,
        captureFailed: false,
        contentProfile: captured.contentProfile,
      };
    } catch {
      return { imageBase64: null, captureSkipped: false, captureFailed: true };
    }
  }
}

async function handleAsk(payload) {
  const { requestId, question, tabId, captureDataUrl, useScreen = true } = payload;

  try {
    await requestQueue.enqueue(requestId, async () => {
      state.activeRequestId = requestId;
      lastIdleAt = Date.now();

      const screenEnabled = useScreen !== false;

      if (screenEnabled) {
        emit({ type: 'PHASE', requestId, phase: 'preparing' });
      }

      try {
        let imageBase64 = null;

        if (screenEnabled) {
          const resolved = await resolveImage(tabId, captureDataUrl);
          imageBase64 = resolved.imageBase64;

          if (resolved.captureFailed) {
            emit({ type: 'STREAM_ERROR', requestId, code: 'CAPTURE_FAILED_TEXT_ONLY' });
          } else {
            emit({ type: 'PHASE', requestId, phase: 'inferring' });
          }
        }

        state.currentImage = imageBase64;
        state.currentPrompt = question;

        await runInference({
          question,
          imageBase64,
          requestId,
          onToken: (text) => emit({ type: 'STREAM_TOKEN', requestId, text }),
        });

        emit({ type: 'STREAM_DONE', requestId });
      } catch (err) {
        emit({
          type: 'STREAM_ERROR',
          requestId,
          code: err?.message || 'INFERENCE_FAILED',
        });
      } finally {
        resetRequestState();
        state.currentImage = null;
        state.currentPrompt = null;
        await runPreflight();
        lastIdleAt = Date.now();
      }
    });
  } catch (err) {
    emit({
      type: 'STREAM_ERROR',
      requestId,
      code: err?.code === 'BUSY' ? 'BUSY' : err?.message || 'ASK_FAILED',
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  if (message.type === 'GET_STATUS') {
    const status = getRuntimeStatus();
    sendResponse({
      type: 'STATUS',
      device: status.device,
      modelState: status.modelState,
      queueBusy: requestQueue.isBusy(),
      cpuFallback: status.cpuFallback,
      loadProgress: status.loadProgress,
    });
    return true;
  }

  if (message.type === 'ASK') {
    handleAsk(message);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'ABORT') {
    abortInference(message.requestId);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'PREFLIGHT') {
    runPreflight();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

initModelOnStartup().then(() => {
  emit({
    type: 'STATUS',
    ...getRuntimeStatus(),
    queueBusy: false,
  });
});
