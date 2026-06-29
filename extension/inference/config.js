export const config = {
  modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
  dtype: 'q4f16',

  phase1Tokens: 112,
  phase2Tokens: 272,
  maxTotalTokens: 384,

  resolution: {
    textHeavy: 720,
    imageHeavy: 512,
    cpuCap: 480,
    floor: 480,
  },

  jpegQuality: 0.5,
  captureQuality: 50,

  slowInferenceMs: 5000,
  slowStreakThreshold: 5,
  softResetReloadMs: 500,

  tabCacheMaxEntries: 3,

  edgeDensityTextThreshold: 0.08,
  colorVarianceImageThreshold: 2500,
};

const RESOLUTION_TIERS = [720, 512, 480];

export function getResolutionTier(device, contentProfile, degradedSteps = 0) {
  let width = config.resolution.imageHeavy;

  if (device === 'cpu') {
    width = config.resolution.cpuCap;
  } else if (contentProfile === 'text') {
    width = config.resolution.textHeavy;
  } else if (contentProfile === 'image') {
    width = config.resolution.imageHeavy;
  }

  const startIdx = RESOLUTION_TIERS.indexOf(width);
  const baseIdx = startIdx >= 0 ? startIdx : RESOLUTION_TIERS.indexOf(512);
  const idx = Math.min(baseIdx + degradedSteps, RESOLUTION_TIERS.length - 1);
  return RESOLUTION_TIERS[idx];
}

export function downgradeResolution(currentSteps) {
  return currentSteps + 1;
}
