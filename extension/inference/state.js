export const state = {
  activeRequestId: null,
  currentImage: null,
  currentPrompt: null,
  degradedSteps: 0,
  device: 'unknown',
  modelState: 'idle',
};

export function resetRequestState() {
  state.activeRequestId = null;
  state.currentImage = null;
  state.currentPrompt = null;
}

export function setModelState(next) {
  state.modelState = next;
}

export function setDevice(device) {
  state.device = device;
}
