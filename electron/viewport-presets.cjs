const VIEWPORT_PRESETS = Object.freeze({
  fit: { id: "fit", label: "Fit", width: null, height: null, mobile: false },
  desktop: { id: "desktop", label: "1440 × 900", width: 1440, height: 900, mobile: false },
  laptop: { id: "laptop", label: "1024 × 768", width: 1024, height: 768, mobile: false },
  tablet: { id: "tablet", label: "768 × 1024", width: 768, height: 1024, mobile: true },
  phone390: { id: "phone390", label: "390 × 844", width: 390, height: 844, mobile: true },
  phone375: { id: "phone375", label: "375 × 812", width: 375, height: 812, mobile: true },
});

function normalizeViewportPreset(value) {
  return Object.prototype.hasOwnProperty.call(VIEWPORT_PRESETS, value)
    ? value
    : "fit";
}

function viewportPresetSnapshot(id, orientation = "portrait") {
  const preset = VIEWPORT_PRESETS[normalizeViewportPreset(id)];
  if (!preset.width || !preset.height) return { ...preset, orientation: "fit" };
  const landscape = orientation === "landscape";
  return {
    ...preset,
    width: landscape ? preset.height : preset.width,
    height: landscape ? preset.width : preset.height,
    orientation: landscape ? "landscape" : "portrait",
  };
}

function deviceEmulationPlan({ presetId, orientation, availableWidth, availableHeight } = {}) {
  const preset = viewportPresetSnapshot(presetId, orientation);
  if (!preset.width || !preset.height) {
    return { enabled: false, preset, parameters: null };
  }
  const width = Math.max(1, Number(availableWidth) || preset.width);
  const height = Math.max(1, Number(availableHeight) || preset.height);
  const scale = Math.max(0.1, Math.min(1, width / preset.width, height / preset.height));
  return {
    enabled: true,
    preset,
    parameters: {
      screenPosition: preset.mobile ? "mobile" : "desktop",
      screenSize: { width: preset.width, height: preset.height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1,
      viewSize: { width: preset.width, height: preset.height },
      scale,
    },
  };
}

module.exports = {
  VIEWPORT_PRESETS,
  normalizeViewportPreset,
  viewportPresetSnapshot,
  deviceEmulationPlan,
};
