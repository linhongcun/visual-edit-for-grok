const assert = require("assert");
const {
  VIEWPORT_PRESETS,
  normalizeViewportPreset,
  viewportPresetSnapshot,
  deviceEmulationPlan,
} = require("../electron/viewport-presets.cjs");

function testKnownPresets() {
  assert.deepStrictEqual(Object.keys(VIEWPORT_PRESETS), [
    "fit",
    "desktop",
    "laptop",
    "tablet",
    "phone390",
    "phone375",
  ]);
  assert.strictEqual(normalizeViewportPreset("unknown"), "fit");
}

function testLandscapeSwapsDimensions() {
  const preset = viewportPresetSnapshot("phone390", "landscape");
  assert.strictEqual(preset.width, 844);
  assert.strictEqual(preset.height, 390);
}

function testFitDisablesEmulation() {
  assert.strictEqual(deviceEmulationPlan({ presetId: "fit" }).enabled, false);
}

function testDevicePlanScalesIntoAvailablePane() {
  const plan = deviceEmulationPlan({
    presetId: "desktop",
    availableWidth: 720,
    availableHeight: 700,
  });
  assert.strictEqual(plan.enabled, true);
  assert.strictEqual(plan.parameters.viewSize.width, 1440);
  assert.strictEqual(plan.parameters.scale, 0.5);
}

const tests = [
  testKnownPresets,
  testLandscapeSwapsDimensions,
  testFitDisablesEmulation,
  testDevicePlanScalesIntoAvailablePane,
];
let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`ok  - ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail - ${test.name}`, error);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
