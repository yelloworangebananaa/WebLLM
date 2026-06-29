const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const composerEl = document.getElementById('composer');
const statusEl = document.getElementById('status');
const warningEl = document.getElementById('warning');
const screenToggleEl = document.getElementById('screenToggle');
const emptyStateEl = document.getElementById('emptyState');
const onboardingEl = document.getElementById('onboarding');
const dismissOnboardingEl = document.getElementById('dismissOnboarding');
const modelProgressEl = document.getElementById('modelProgress');
const modelProgressBarEl = document.getElementById('modelProgressBar');

let requestId = 0;
let currentRequestId = 0;
let port = null;
let streaming = false;
let cpuWarningShown = false;
let assistantBubble = null;
let modelReady = false;
let useScreen = true;

const SCAFFOLD_SCREEN = ['Reading screen…', 'Detecting interface…', 'Analyzing elements…'];
const SCAFFOLD_TEXT = ['Thinking…'];

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = `status ${className}`;
}

function setModelProgress(percent) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  if (pct <= 0) {
    modelProgressEl.classList.add('hidden');
    modelProgressEl.setAttribute('aria-valuenow', '0');
    modelProgressBarEl.style.width = '0%';
    return;
  }
  modelProgressEl.classList.remove('hidden');
  modelProgressEl.setAttribute('aria-valuenow', String(Math.round(pct)));
  modelProgressBarEl.style.width = `${pct}%`;
}

function updateInputPlaceholder() {
  if (streaming) return;
  if (!modelReady) {
    inputEl.placeholder = 'Waiting for model to finish loading…';
    return;
  }
  inputEl.placeholder = useScreen
    ? 'Ask about what\'s on your screen…'
    : 'Ask anything (no screen capture)…';
}

function hideEmptyState() {
  emptyStateEl.classList.add('hidden');
}

function syncEmptyState() {
  const hasConversation = chatEl.querySelector('.msg--user, .msg--assistant');
  emptyStateEl.classList.toggle('hidden', Boolean(hasConversation));
}

function dismissOnboarding() {
  onboardingDismissed = true;
  onboardingEl.classList.add('hidden');
}

function scrollChat() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addMessage(role, text, extraClass = '') {
  if (role === 'user' || role === 'assistant') {
    hideEmptyState();
  }
  const el = document.createElement('div');
  el.className = `msg msg--${role} ${extraClass}`.trim();
  el.textContent = text;
  chatEl.appendChild(el);
  scrollChat();
  return el;
}

function showSystem(text) {
  return addMessage('system', text);
}

function connectPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: 'webllm' });

  port.onMessage.addListener((message) => {
    if (message.type === 'STATUS') {
      updateStatusFromRuntime(message);
      return;
    }

    if (message.type === 'MODEL_PROGRESS') {
      const pct = message.progress > 0 ? message.progress : 0;
      setModelProgress(pct);
      const pctLabel = pct > 0 ? ` ${pct}%` : '';
      setStatus(`Downloading model (~3 GB)${pctLabel}`, 'status--warming');
      return;
    }

    if (message.requestId != null && message.requestId !== currentRequestId) {
      return;
    }

    switch (message.type) {
      case 'PHASE':
        if (assistantBubble && message.phase === 'inferring') {
          assistantBubble.textContent = useScreen ? 'Analyzing screen…' : 'Thinking…';
        }
        break;
      case 'STREAM_TOKEN':
        if (assistantBubble) {
          if (assistantBubble.classList.contains('msg--typing')) {
            assistantBubble.textContent = '';
            assistantBubble.classList.remove('msg--typing');
          }
          assistantBubble.textContent += message.text;
          scrollChat();
        }
        break;
      case 'STREAM_DONE':
        finishRequest();
        break;
      case 'STREAM_ERROR':
        handleError(message.code);
        if (message.code !== 'CAPTURE_FAILED_TEXT_ONLY') {
          finishRequest(true);
        }
        break;
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    if (streaming) {
      finishRequest(true);
    }
    port = null;
  });

  return port;
}

function updateStatusFromRuntime(message) {
  if (message.modelState === 'loading') {
    modelReady = false;
    setModelProgress(message.loadProgress || 0);
    const pct = message.loadProgress > 0 ? ` ${message.loadProgress}%` : '';
    setStatus(`Downloading model (~3 GB)${pct}`, 'status--warming');
    if (!streaming) setComposerMode('send');
    updateInputPlaceholder();
    return;
  }

  if (message.modelState === 'refreshing') {
    setStatus('Refreshing…', 'status--refreshing');
    return;
  }

  if (message.modelState === 'error') {
    setModelProgress(0);
    setStatus('Error', 'status--error');
    modelReady = false;
    if (!streaming) setComposerMode('send');
    updateInputPlaceholder();
    return;
  }

  modelReady = true;
  setModelProgress(0);
  if (!streaming) setComposerMode('send');
  updateInputPlaceholder();

  if (message.cpuFallback) {
    setStatus('CPU fallback', 'status--cpu');
    if (!cpuWarningShown) {
      warningEl.textContent = 'WebGPU unavailable. Running on CPU — responses may be slower.';
      warningEl.classList.remove('hidden');
      cpuWarningShown = true;
    }
    return;
  }

  setStatus('WebGPU active', 'status--webgpu');
}

function handleError(code) {
  if (code === 'BUSY') {
    showSystem('Already analyzing your previous message…');
    return;
  }
  if (code === 'CAPTURE_FAILED_TEXT_ONLY') {
    warningEl.textContent = 'Screen capture failed. Answering without screenshot.';
    warningEl.classList.remove('hidden');
    return;
  }
  if (code === 'MODEL_LOAD_FAILED') {
    setStatus('Error', 'status--error');
    if (assistantBubble) {
      assistantBubble.textContent = 'Model failed to load. Reload the extension and try again.';
      assistantBubble.classList.remove('msg--typing');
    }
    modelReady = false;
    setComposerLocked(false);
    sendBtn.disabled = true;
    updateInputPlaceholder();
    return;
  }
  if (assistantBubble) {
    const detail = code && code !== 'INFERENCE_FAILED' ? `\n(${code})` : '';
    assistantBubble.textContent = `Something went wrong. Try again.${detail}`;
    assistantBubble.classList.remove('msg--typing');
  }
}

function setComposerMode(mode) {
  const isStop = mode === 'stop';
  sendBtn.classList.toggle('is-stop', isStop);
  sendBtn.type = isStop ? 'button' : 'submit';
  sendBtn.disabled = !isStop && !modelReady;
  sendBtn.setAttribute('aria-label', isStop ? 'Stop response' : 'Send message');
}

function setComposerLocked(locked) {
  streaming = locked;
  chatEl.setAttribute('aria-busy', locked ? 'true' : 'false');
  setComposerMode(locked ? 'stop' : 'send');
  inputEl.disabled = locked || !modelReady;
  screenToggleEl.disabled = locked;
  composerEl.classList.toggle('composer--busy', locked);
  updateInputPlaceholder();
}

function cancelPendingSend(restoreQuestion = '') {
  setComposerLocked(false);
  if (restoreQuestion) {
    inputEl.value = restoreQuestion;
  }
  inputEl.focus();
}

function stopRequest() {
  if (!streaming) return;

  connectPort().postMessage({ type: 'ABORT', requestId: currentRequestId });
  currentRequestId = -1;

  if (assistantBubble) {
    assistantBubble.textContent = 'Stopped.';
    assistantBubble.classList.remove('msg--typing');
  }

  finishRequest(true);
}

function finishRequest(errored = false) {
  setComposerLocked(false);
  if (assistantBubble && !errored && assistantBubble.classList.contains('msg--typing')) {
    assistantBubble.textContent = 'No response generated.';
    assistantBubble.classList.remove('msg--typing');
  }
  assistantBubble = null;
  syncEmptyState();
  inputEl.focus();
}

async function sendMessage(event) {
  event?.preventDefault();

  const question = inputEl.value.trim();
  if (!question || streaming || !modelReady) return;

  useScreen = screenToggleEl.checked;
  setComposerLocked(true);
  inputEl.value = '';

  if (useScreen) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.windowId == null) {
      showSystem('No active tab found.');
      cancelPendingSend(question);
      return;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      showSystem('Cannot capture Chrome internal pages. Open a normal website first.');
      cancelPendingSend(question);
      return;
    }

    addMessage('user', question);

    requestId += 1;
    currentRequestId = requestId;

    assistantBubble = addMessage('assistant', SCAFFOLD_SCREEN.join('\n'), 'msg--typing');

    connectPort().postMessage({
      type: 'ASK',
      requestId: currentRequestId,
      question,
      tabId: tab.id,
      windowId: tab.windowId,
      useScreen: true,
    });
    return;
  }

  addMessage('user', question);

  requestId += 1;
  currentRequestId = requestId;

  assistantBubble = addMessage('assistant', SCAFFOLD_TEXT.join('\n'), 'msg--typing');

  connectPort().postMessage({
    type: 'ASK',
    requestId: currentRequestId,
    question,
    useScreen: false,
  });
}

function requestStatus() {
  connectPort().postMessage({ type: 'GET_STATUS' });
}

composerEl.addEventListener('submit', (event) => {
  event.preventDefault();
  if (streaming) {
    stopRequest();
    return;
  }
  sendMessage(event);
});

sendBtn.addEventListener('click', (event) => {
  if (streaming) {
    event.preventDefault();
    stopRequest();
  }
});

screenToggleEl.addEventListener('change', () => {
  useScreen = screenToggleEl.checked;
  updateInputPlaceholder();
});

dismissOnboardingEl.addEventListener('click', dismissOnboarding);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (streaming || !modelReady) return;
    sendMessage();
  }
});

window.addEventListener('beforeunload', () => {
  if (port && streaming) {
    port.postMessage({ type: 'ABORT', requestId: currentRequestId });
  }
});

syncEmptyState();
updateInputPlaceholder();
requestStatus();
setComposerMode('send');
inputEl.focus();
