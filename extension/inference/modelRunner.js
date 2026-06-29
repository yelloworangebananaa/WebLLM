import {
  env,
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  TextStreamer,
  InterruptableStoppingCriteria,
  StoppingCriteriaList,
} from '@huggingface/transformers';
import { config, downgradeResolution } from './config.js';
import { buildPreflightMessages, buildPrompt } from './promptBuilder.js';
import { base64ToRawImage } from './screenCapture.js';
import { state, setModelState, setDevice } from './state.js';

let processor = null;
let model = null;
let activeDevice = 'webgpu';
let loadPromise = null;
let interruptable = new InterruptableStoppingCriteria();
let latencyTracker = { slowStreak: 0 };

export function configureEnv() {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: chrome.runtime.getURL('transformers/ort-wasm-simd-threaded.asyncify.mjs'),
    wasm: chrome.runtime.getURL('transformers/ort-wasm-simd-threaded.asyncify.wasm'),
  };
  env.allowRemoteModels = true;
  // Model weights only — prompts and screenshots stay in memory for the active request.
  env.useBrowserCache = true;
  env.useFSCache = false;
  env.useWasmCache = false;
}

let loadProgress = 0;
let lastProgressEmit = 0;

function emitLoadProgress(info) {
  if (info.status === 'progress_total' && typeof info.progress === 'number') {
    loadProgress = Math.round(info.progress);
  } else if (info.status === 'progress' && typeof info.progress === 'number' && loadProgress === 0) {
    loadProgress = Math.round(info.progress);
  } else if (info.status !== 'progress_total' && info.status !== 'progress') {
    return;
  }

  const now = Date.now();
  if (now - lastProgressEmit < 400 && info.status !== 'progress_total') {
    return;
  }
  lastProgressEmit = now;

  chrome.runtime.sendMessage({
    source: 'offscreen',
    type: 'MODEL_PROGRESS',
    progress: loadProgress,
    file: info.file || '',
    status: info.status,
  }).catch(() => {});
}

async function loadModel(device) {
  configureEnv();
  setModelState('loading');
  loadProgress = 0;

  const loadOptions = {
    dtype: config.dtype,
    device,
    progress_callback: emitLoadProgress,
  };

  processor = await AutoProcessor.from_pretrained(config.modelId, {
    progress_callback: emitLoadProgress,
  });
  model = await Gemma4ForConditionalGeneration.from_pretrained(config.modelId, loadOptions);

  activeDevice = device;
  setDevice(device);
  setModelState('ready');
  return { device };
}

export async function ensureModelReady(onProgress) {
  if (model && processor) {
    return { device: activeDevice, modelState: 'ready' };
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      return await loadModel('webgpu');
    } catch {
      try {
        return await loadModel('cpu');
      } catch {
        setModelState('error');
        loadPromise = null;
        throw new Error('MODEL_LOAD_FAILED');
      }
    }
  })();

  return loadPromise;
}

async function silentlyReloadModel() {
  setModelState('refreshing');
  processor = null;
  model = null;
  loadPromise = null;
  interruptable = new InterruptableStoppingCriteria();
  await ensureModelReady();
}

function recordLatency(ms) {
  if (ms > config.slowInferenceMs) {
    latencyTracker.slowStreak += 1;
    state.degradedSteps = downgradeResolution(state.degradedSteps);
  } else {
    latencyTracker.slowStreak = 0;
  }

  if (latencyTracker.slowStreak >= config.slowStreakThreshold) {
    latencyTracker.slowStreak = 0;
    silentlyReloadModel();
  }
}

function needsContinuation(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[.!?…]["')\]]?$/.test(trimmed)) return false;
  if (trimmed.endsWith(':')) return true;
  const lastWord = trimmed.split(/\s+/).pop() ?? '';
  if (lastWord.length > 0 && lastWord === lastWord.toUpperCase() && /[A-Z]/.test(lastWord)) {
    return false;
  }
  return true;
}

async function prepareInputs(question, imageBase64, continuationPrefix = '') {
  let promptText = buildPrompt(question, Boolean(imageBase64));
  if (continuationPrefix) {
    promptText = `${promptText}\n\nPARTIAL:\n${continuationPrefix}\nContinue concisely.`;
  }

  const messages = imageBase64
    ? [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: promptText }] }]
    : [{ role: 'user', content: [{ type: 'text', text: promptText }] }];

  const prompt = processor.apply_chat_template(messages, {
    enable_thinking: false,
    add_generation_prompt: true,
  });

  if (imageBase64) {
    const image = await base64ToRawImage(imageBase64);
    return processor(prompt, image, null, { add_special_tokens: false });
  }

  return processor(prompt, null, null, { add_special_tokens: false });
}

async function generatePhase(inputs, maxTokens, onToken) {
  interruptable.reset();
  let outputText = '';

  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      outputText += text;
      onToken(text);
    },
  });

  await model.generate({
    ...inputs,
    max_new_tokens: maxTokens,
    do_sample: false,
    streamer,
    stopping_criteria: new StoppingCriteriaList([interruptable]),
  });

  return outputText;
}

export async function runInference({ question, imageBase64, onToken, requestId }) {
  await ensureModelReady();
  const started = performance.now();

  setModelState('running');
  const inputs = await prepareInputs(question, imageBase64, '');

  const phase1 = await generatePhase(inputs, config.phase1Tokens, onToken);
  let fullText = phase1;

  if (needsContinuation(phase1)) {
    const remaining = Math.min(config.phase2Tokens, config.maxTotalTokens - config.phase1Tokens);
    if (remaining > 0) {
      const continueInputs = await prepareInputs(question, imageBase64, phase1);
      const phase2 = await generatePhase(continueInputs, remaining, onToken);
      fullText += phase2;
    }
  }

  recordLatency(performance.now() - started);
  setModelState('ready');
  return fullText;
}

export async function runPreflight() {
  if (!model || !processor || state.modelState === 'running') return;

  try {
    const messages = buildPreflightMessages();
    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });
    const inputs = await processor(prompt, null, null, { add_special_tokens: false });
    interruptable.reset();
    await model.generate({
      ...inputs,
      max_new_tokens: 1,
      do_sample: false,
      stopping_criteria: new StoppingCriteriaList([interruptable]),
    });
  } catch {
    // Preflight failures are non-fatal.
  }
}

export function abortInference(requestId) {
  if (state.activeRequestId === requestId) {
    interruptable.interrupt();
  }
}

export function getRuntimeStatus() {
  return {
    device: activeDevice,
    modelState: state.modelState,
    cpuFallback: activeDevice === 'cpu',
    loadProgress,
  };
}

export async function initModelOnStartup() {
  try {
    await ensureModelReady();
  } catch {
    setModelState('error');
  }
}
