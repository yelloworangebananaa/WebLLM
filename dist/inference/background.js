const OFFSCREEN_URL = 'inference/offscreen.html';

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (existing.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'WebLLM vision model inference runtime',
  });
}

async function captureActiveTab(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 50,
    });
  } catch {
    return null;
  }
}

function relayToOffscreen(message) {
  return ensureOffscreen().then(() =>
    chrome.runtime.sendMessage({ target: 'offscreen', ...message })
  );
}

const popupPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'webllm') return;
  popupPorts.add(port);

  port.onMessage.addListener((message) => {
    if (message.type === 'GET_STATUS') {
      relayToOffscreen(message)
        .then((response) => {
          if (response) port.postMessage(response);
        })
        .catch(() => {
          port.postMessage({
            type: 'STATUS',
            modelState: 'loading',
            device: 'unknown',
            queueBusy: false,
            cpuFallback: false,
          });
        });
      return;
    }

    if (message.type === 'ASK') {
      const useScreen = message.useScreen !== false;

      ensureOffscreen()
        .then(() => (useScreen ? captureActiveTab(message.windowId) : null))
        .then((captureDataUrl) =>
          relayToOffscreen({
            ...message,
            captureDataUrl,
            useScreen,
          })
        )
        .catch((err) => {
          port.postMessage({
            type: 'STREAM_ERROR',
            requestId: message.requestId,
            code: err?.message || 'ROUTER_ERROR',
          });
        });
      return;
    }

    if (message.type === 'ABORT') {
      relayToOffscreen(message).catch(() => {});
    }
  });

  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.source !== 'offscreen') return;

  for (const port of popupPorts) {
    try {
      port.postMessage(message);
    } catch {
      popupPorts.delete(port);
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreen().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'webllm-idle-preflight') return;
  relayToOffscreen({ type: 'PREFLIGHT' }).catch(() => {});
});

chrome.alarms.create('webllm-idle-preflight', { periodInMinutes: 1 });
