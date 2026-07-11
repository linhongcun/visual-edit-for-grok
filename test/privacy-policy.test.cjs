const assert = require("assert");
const {
  sanitizeHistoryUrl,
  sanitizeHistoryUrls,
  evaluateDownloadPolicy,
  buildPreviewSessionPolicy,
  buildPreviewDataClearPlan,
} = require("../electron/privacy-policy.cjs");

function testHistoryUrlRemovesCredentialsAndSecrets() {
  const sanitized = sanitizeHistoryUrl(
    "https://alice:password@example.com/app?tab=layout&access_token=abc&x-amz-signature=signed#access_token=fragment",
  );
  assert.strictEqual(sanitized, "https://example.com/app?tab=layout");
}

function testHistoryUrlKeepsOrdinaryState() {
  assert.strictEqual(
    sanitizeHistoryUrl("http://localhost:3000/view?page=2&theme=dark#section"),
    "http://localhost:3000/view?page=2&theme=dark#section",
  );
  assert.strictEqual(sanitizeHistoryUrl("file:///etc/passwd"), null);
  assert.strictEqual(sanitizeHistoryUrl("not a url"), null);
}

function testNestedSecretAndSanitizedDedupe() {
  const values = sanitizeHistoryUrls([
    "https://example.com/app?redirect=https%3A%2F%2Fidp.test%2Fcb%3Ftoken%3Dabc",
    "https://example.com/app?redirect=https%3A%2F%2Fidp.test%2Fcb%3Ftoken%3Ddef",
    "javascript:alert(1)",
    "https://example.com/other",
  ]);
  assert.deepStrictEqual(values, [
    "https://example.com/app",
    "https://example.com/other",
  ]);
}

function testDownloadsAreDefaultDenyAndRequireConfirmation() {
  assert.deepStrictEqual(
    evaluateDownloadPolicy({ url: "https://example.com/file.zip" }),
    { allow: false, reason: "downloads-disabled", url: null },
  );
  assert.deepStrictEqual(
    evaluateDownloadPolicy({
      url: "https://example.com/file.zip",
      downloadsEnabled: true,
    }),
    { allow: false, reason: "confirmation-required", url: null },
  );
  assert.deepStrictEqual(
    evaluateDownloadPolicy({
      url: "file:///tmp/payload",
      downloadsEnabled: true,
      userConfirmed: true,
    }),
    { allow: false, reason: "unsupported-protocol", url: null },
  );
  assert.deepStrictEqual(
    evaluateDownloadPolicy({
      url: "https://example.com/file.zip",
      downloadsEnabled: true,
      userConfirmed: true,
    }),
    {
      allow: true,
      reason: null,
      url: "https://example.com/file.zip",
    },
  );
}

function testPrivateAndPersistentSessionPolicies() {
  assert.deepStrictEqual(buildPreviewSessionPolicy({ privateMode: true }), {
    privateMode: true,
    partition: "vefg-preview-private",
    persistent: false,
    persistHistory: false,
    clearOnClose: true,
  });
  assert.deepStrictEqual(buildPreviewSessionPolicy(), {
    privateMode: false,
    partition: "persist:vefg-preview",
    persistent: true,
    persistHistory: true,
    clearOnClose: false,
  });
  assert.strictEqual(
    buildPreviewSessionPolicy({
      privateMode: true,
      privatePartition: "persist:mistake",
    }).partition,
    "mistake",
  );
}

function testClearDataPlans() {
  const originPlan = buildPreviewDataClearPlan({
    scope: "origin",
    currentUrl: "https://alice:secret@example.com/app?token=abc",
  });
  assert.strictEqual(originPlan.ok, true);
  assert.strictEqual(originPlan.clearStorageData.origin, "https://example.com");
  assert.ok(originPlan.clearStorageData.storages.includes("cookies"));
  assert.ok(originPlan.clearStorageData.storages.includes("serviceworkers"));
  assert.ok(!originPlan.clearStorageData.storages.includes("appcache"));
  assert.ok(!originPlan.clearStorageData.storages.includes("websql"));
  assert.strictEqual(originPlan.clearCache, true);
  assert.strictEqual(originPlan.clearAuthCache, true);

  assert.deepStrictEqual(
    buildPreviewDataClearPlan({
      scope: "origin",
      currentUrl: "file:///tmp/page.html",
    }),
    {
      ok: false,
      reason: "invalid-origin",
      clearStorageData: null,
      clearCache: false,
      clearAuthCache: false,
    },
  );

  const allPlan = buildPreviewDataClearPlan({ scope: "all" });
  assert.strictEqual(allPlan.ok, true);
  assert.strictEqual("origin" in allPlan.clearStorageData, false);
}

function run() {
  const tests = [
    testHistoryUrlRemovesCredentialsAndSecrets,
    testHistoryUrlKeepsOrdinaryState,
    testNestedSecretAndSanitizedDedupe,
    testDownloadsAreDefaultDenyAndRequireConfirmation,
    testPrivateAndPersistentSessionPolicies,
    testClearDataPlans,
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
  if (failed) process.exitCode = 1;
}

run();
