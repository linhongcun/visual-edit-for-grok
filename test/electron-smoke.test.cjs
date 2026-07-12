const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const FAKE_GROK = path.join(__dirname, "fixtures", "fake-grok.js");

function countSgrWheelReports(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const input = fs.readFileSync(filePath).toString("latin1");
  return (input.match(/\x1b\[<6[45];\d+;\d+M/g) || []).length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode == null && child.signalCode == null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  if (child.exitCode == null && child.signalCode == null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function waitFor(check, message, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await delay(80);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Runtime.evaluate failed",
      );
    }
    return response.result?.value;
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // best-effort smoke cleanup
    }
  }
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
  return response.json();
}

async function connectTarget(port, predicate, label) {
  const target = await waitFor(async () => {
    const list = await targets(port);
    return list.find(predicate) || null;
  }, `Could not find ${label}`);
  return new CdpClient(target.webSocketDebuggerUrl).connect();
}

async function dispatchChord(client, key, code, modifiers) {
  const virtualKeyCode = key.length === 1 ? key.charCodeAt(0) : 0;
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
}

async function dispatchArrow(client, key, modifiers = 0) {
  const virtualKeyCode = key === "ArrowLeft" ? 37 : 39;
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
}

async function assertTuiWheelAcceleration(shellClient, inputLog) {
  await waitFor(
    () => fs.existsSync(inputLog),
    "fake Grok TUI did not enter alternate screen",
  );
  await shellClient.evaluate(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  await delay(180);
  const terminalPoint = await shellClient.evaluate(`(() => {
    const rect = document.querySelector('.xterm-screen')?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  assert.ok(terminalPoint, "xterm screen was unavailable for wheel smoke");

  const dispatchTuiWheel = async (deltaY) => {
    fs.writeFileSync(inputLog, "");
    await shellClient.evaluate(`(() => {
      const screen = document.querySelector('.xterm-screen');
      if (!screen) return false;
      return screen.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaX: 0,
        deltaY: ${JSON.stringify(deltaY)},
        clientX: ${JSON.stringify(terminalPoint.x)},
        clientY: ${JSON.stringify(terminalPoint.y)}
      }));
    })()`);
    await delay(220);
    return countSgrWheelReports(inputLog);
  };
  const slowReports = await dispatchTuiWheel(16);
  const fastReports = await dispatchTuiWheel(60);
  assert.ok(
    slowReports >= 1,
    `slow TUI trackpad glide was lost (${slowReports} reports)`,
  );
  assert.ok(
    fastReports >= slowReports * 4,
    `fast TUI flick did not accelerate (${slowReports} -> ${fastReports})`,
  );
  return { slowReports, fastReports };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vefg-electron-smoke-"));
  const fakeGrokInputLog = path.join(tmp, "fake-grok-input.bin");
  const projectDir = path.join(tmp, "project with spaces");
  fs.mkdirSync(projectDir, { recursive: true });

  const demoServer = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/second") {
      response.end("<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><title>Second page</title><main id='second'>Second page</main>");
      return;
    }
    response.end(`<!doctype html>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Picker smoke page</title>
      <style>body{font:16px system-ui;margin:40px}#target{padding:20px;background:#2563eb;color:white;border:0;border-radius:10px}</style>
      <button id="target" data-token="must-redact" value="secret-value">Pick this target</button>`);
  });
  await new Promise((resolve) => demoServer.listen(0, "127.0.0.1", resolve));
  const demoPort = demoServer.address().port;
  const demoUrl = `http://127.0.0.1:${demoPort}/`;
  const secondUrl = `${demoUrl}second`;
  const debuggingPort = await freePort();
  const releasedPort = await freePort();
  const primaryModifier = process.platform === "darwin" ? 4 : 2;
  const primaryShiftModifiers = primaryModifier | 8;

  const packagedBinary = process.env.VEFG_PACKAGED_BINARY || "";
  const electronBinary = packagedBinary || require("electron");
  const electronArgs = [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${path.join(tmp, "profile")}`,
    "--lang=en-US",
  ];
  // A background packaged window can lose its macOS overlay mailbox under CDP;
  // software compositing keeps capturePage deterministic for this headless smoke.
  if (packagedBinary) electronArgs.push("--disable-gpu");
  else electronArgs.push(ROOT);
  const child = spawn(
    electronBinary,
    electronArgs,
    {
      cwd: ROOT,
      env: {
        ...process.env,
        GROK_PATH: FAKE_GROK,
        VEFG_FAKE_GROK_INPUT_LOG: fakeGrokInputLog,
        HOME: tmp,
        LANG: "en_US.UTF-8",
        NODE_OPTIONS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let appLog = "";
  child.stdout.on("data", (chunk) => (appLog += chunk));
  child.stderr.on("data", (chunk) => (appLog += chunk));

  let shellClient = null;
  let previewClient = null;
  try {
    shellClient = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.title === "Visual Capture for Grok",
      "app shell target",
    );
    await shellClient.send("Runtime.enable");

    const initial = await waitFor(
      () =>
        shellClient.evaluate(
          `(async () => window.vefg ? window.vefg.getState() : null)()`,
        ),
      "Preload API did not become available",
    );
    assert.strictEqual(initial.previewUrl, "", "fresh profile uses bundled welcome");
    assert.strictEqual(initial.previewStatus.isWelcome, true);
    const initialUi = await waitFor(
      () => shellClient.evaluate(`(() => {
        const url = document.querySelector('.url-input');
        const aim = document.querySelector('.btn-pick');
        const onboarding = document.querySelector('.setup-inline');
        return url && aim && onboarding ? {
          url: url.value,
          aimDisabled: aim.disabled,
          hasOnboarding: true
        } : null;
      })()`),
      "React shell did not render initial controls",
    );
    assert.deepStrictEqual(initialUi, {
      url: "",
      aimDisabled: true,
      hasOnboarding: true,
    });
    assert.ok(
      (await shellClient.evaluate(
        `document.querySelector('.url-input')?.getBoundingClientRect().width || 0`,
      )) >= 140,
      "preview URL input was squeezed by neighboring controls",
    );
    if (process.env.VEFG_SCROLL_SMOKE_ONLY === "1") {
      const grokStart = await shellClient.evaluate(
        `(async () => window.vefg.terminalLaunchGrok())()`,
      );
      assert.strictEqual(grokStart.mode, "grok");
      const counts = await assertTuiWheelAcceleration(
        shellClient,
        fakeGrokInputLog,
      );
      console.log(
        `ok  - ${packagedBinary ? "Packaged" : "Electron"} Grok TUI wheel ${counts.slowReports} -> ${counts.fastReports}`,
      );
      return;
    }
    const unsafeLinkResult = await shellClient.evaluate(`(async () => {
      try {
        await window.vefg.openExternal("file:///etc/passwd");
        return "opened";
      } catch (error) {
        return String(error?.message || error);
      }
    })()`);
    assert.match(unsafeLinkResult, /Only http\(s\) links/);

    // Stability: soft main-side fault probe must scrub secrets and not kill the process.
    const stabilityProbe = await shellClient.evaluate(`(async () => {
      if (!window.vefg?.stabilityProbe) return { missing: true };
      return window.vefg.stabilityProbe({
        code: "stability-probe",
        message: "smoke soft fault token=supersecret99 https://evil.example/?api_key=xyz",
      });
    })()`);
    assert.notStrictEqual(stabilityProbe.missing, true, "stabilityProbe API missing");
    assert.strictEqual(stabilityProbe.ok, true);
    assert.ok(stabilityProbe.bufferSize >= 1, "stability buffer empty after probe");
    const probeJson = JSON.stringify(stabilityProbe);
    assert.doesNotMatch(probeJson, /supersecret99|api_key=xyz/);
    assert.match(
      String(stabilityProbe.entry?.message || ""),
      /smoke soft fault|REDACTED/i,
    );
    // Workbench still alive after soft fault
    const afterProbe = await shellClient.evaluate(
      `(async () => window.vefg ? window.vefg.getState() : null)()`,
    );
    assert.ok(afterProbe && typeof afterProbe.splitRatio === "number");
    assert.ok(
      await shellClient.evaluate(
        `Boolean(document.querySelector('.btn-pick') && document.querySelector('.url-input'))`,
      ),
      "workbench chrome missing after soft stability probe",
    );
    console.log("ok  - stability soft-error probe (scrubbed, no crash)");

    const initialSplitter = await shellClient.evaluate(`(() => {
      const splitter = document.querySelector('[role="separator"]');
      return splitter ? {
        role: splitter.getAttribute("role"),
        orientation: splitter.getAttribute("aria-orientation"),
        controls: splitter.getAttribute("aria-controls"),
        label: splitter.getAttribute("aria-label"),
        valueMin: Number(splitter.getAttribute("aria-valuemin")),
        valueMax: Number(splitter.getAttribute("aria-valuemax")),
        valueNow: Number(splitter.getAttribute("aria-valuenow")),
        valueText: splitter.getAttribute("aria-valuetext"),
        tabIndex: splitter.tabIndex,
      } : null;
    })()`);
    assert.ok(initialSplitter, "splitter was not exposed as a separator");
    assert.deepStrictEqual(
      {
        role: initialSplitter.role,
        orientation: initialSplitter.orientation,
        controls: initialSplitter.controls,
        label: initialSplitter.label,
        tabIndex: initialSplitter.tabIndex,
      },
      {
        role: "separator",
        orientation: "vertical",
        controls: "terminal-pane preview-pane",
        label: "Resize terminal and preview",
        tabIndex: 0,
      },
    );
    assert.ok(initialSplitter.valueMin < initialSplitter.valueMax);
    assert.ok(initialSplitter.valueNow >= initialSplitter.valueMin);
    assert.ok(initialSplitter.valueNow <= initialSplitter.valueMax);
    assert.match(initialSplitter.valueText, /^\d+% terminal width$/);
    const splitterArrow =
      initialSplitter.valueNow < initialSplitter.valueMax
        ? "ArrowRight"
        : "ArrowLeft";
    await shellClient.evaluate(
      `document.querySelector('[role="separator"]')?.focus(); true`,
    );
    await dispatchArrow(shellClient, splitterArrow, 8);
    const movedSplitter = await waitFor(
      () =>
        shellClient.evaluate(`(() => {
          const splitter = document.querySelector('[role="separator"]');
          if (!splitter) return null;
          const valueNow = Number(splitter.getAttribute("aria-valuenow"));
          return valueNow !== ${initialSplitter.valueNow}
            ? { valueNow, valueText: splitter.getAttribute("aria-valuetext") }
            : null;
        })()`),
      "splitter did not respond to its keyboard control",
    );
    assert.notStrictEqual(movedSplitter.valueNow, initialSplitter.valueNow);
    assert.notStrictEqual(movedSplitter.valueText, initialSplitter.valueText);

    // Warp-inspired chrome inputs: URL field a11y + placeholder + one-click clear
    const urlChrome = await shellClient.evaluate(`(() => {
      const input = document.querySelector('#preview-url-input, .url-input');
      if (!input) return null;
      return {
        placeholder: String(input.getAttribute('placeholder') || input.placeholder || ''),
        ariaLabel: String(input.getAttribute('aria-label') || ''),
        hasForm: Boolean(input.closest('.url-form, form.url-form, .chrome-field')),
      };
    })()`);
    assert.ok(urlChrome, "preview URL input missing");
    assert.ok(
      urlChrome.placeholder.length > 0 || urlChrome.ariaLabel.length > 0,
      "URL input needs placeholder or aria-label",
    );
    assert.ok(urlChrome.hasForm, "URL input not wrapped in chrome form");
    await shellClient.evaluate(`(() => {
      const input = document.querySelector('#preview-url-input, .url-input');
      if (!input) return;
      const proto = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      );
      proto.set.call(input, 'http://127.0.0.1:9/smoke');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const clearVisible = await waitFor(
      () =>
        shellClient.evaluate(
          `Boolean(document.querySelector('.url-clear-btn'))`,
        ),
      "URL clear button did not appear after typing",
      4_000,
    );
    assert.ok(clearVisible, "URL clear button missing");
    await shellClient.evaluate(
      `document.querySelector('.url-clear-btn')?.click()`,
    );
    const cleared = await shellClient.evaluate(
      `document.querySelector('#preview-url-input, .url-input')?.value || ''`,
    );
    assert.strictEqual(cleared, "", "URL clear did not empty the field");
    await shellClient.evaluate(
      `document.querySelector('#preview-url-input')?.blur()`,
    );
    console.log("ok  - URL chrome clear + placeholder");

    const welcomeClient = await connectTarget(
      debuggingPort,
      (target) => {
        try {
          return target.type === "page" &&
            new URL(target.url).pathname.endsWith("/welcome.html");
        } catch {
          return false;
        }
      },
      "welcome preview target",
    );
    assert.strictEqual(await welcomeClient.evaluate("typeof require"), "undefined");
    assert.strictEqual(await welcomeClient.evaluate("typeof process"), "undefined");
    welcomeClient.close();

    await shellClient.evaluate(`(() => {
      window.__vefgTestTerminal = "";
      window.vefg.on("terminal:data", value => {
        if (value && typeof value === "object" && "data" in value) {
          window.__vefgTestTerminal += String(value.data || "");
        } else {
          window.__vefgTestTerminal += String(value || "");
        }
      });
      return true;
    })()`);
    const switched = await shellClient.evaluate(
      `(async () => window.vefg.setProjectDir(${JSON.stringify(projectDir)}))()`,
    );
    assert.strictEqual(switched.projectCwd, projectDir);
    assert.strictEqual(switched.terminalRestarted, true);
    let recentState = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(recentState.recentProjectCwds[0], projectDir);
    const pwdCommand = `printf '__VEFG_PWD__%s\\n' "$PWD"\r`;
    await shellClient.evaluate(
      `(async () => window.vefg.terminalWrite(${JSON.stringify(pwdCommand)}))()`,
    );
    const terminalOutput = await waitFor(
      () =>
        shellClient.evaluate(
          `window.__vefgTestTerminal.includes(${JSON.stringify(`__VEFG_PWD__${projectDir}`)}) ? window.__vefgTestTerminal : null`,
        ),
      "shell did not report its cwd",
    );
    assert.ok(
      terminalOutput.includes(`__VEFG_PWD__${projectDir}`),
      `running shell cwd mismatch: ${terminalOutput}`,
    );

    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(demoUrl)}))()`,
    );
    await waitFor(async () => {
      const state = await shellClient.evaluate("window.vefg.getState()");
      return state.previewUrl === demoUrl && !state.previewStatus.loading
        ? state
        : null;
    }, "preview did not navigate to demo");
    recentState = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(recentState.recentPreviewUrls[0], demoUrl);
    await waitFor(
      () =>
        shellClient.evaluate(`(() => {
          const aim = document.querySelector('[aria-label="Aim at page element"]');
          const url = document.querySelector('[aria-label="Preview URL"]');
          return aim && !aim.disabled && url?.value === ${JSON.stringify(demoUrl)};
        })()`),
      "renderer did not reflect loaded preview",
    );

    previewClient = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.url === demoUrl,
      "demo preview target",
    );
    await previewClient.send("Runtime.enable");
    assert.strictEqual(await previewClient.evaluate("typeof require"), "undefined");
    assert.strictEqual(await previewClient.evaluate("typeof process"), "undefined");
    assert.strictEqual(
      await previewClient.evaluate(
        `navigator.permissions.query({name:"geolocation"}).then(result => result.state)`,
      ),
      "denied",
    );

    // A page-authored console marker used by v0.3 must no longer cross into main.
    await previewClient.evaluate(
      `console.log("__VEFG_SELECT__" + JSON.stringify({tag:"button",id:"forged",boundingBox:{x:0,y:0,width:50,height:50}})); true`,
    );
    await delay(250);
    let state = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(state.lastSelection, null, "forged console selection was accepted");

    await shellClient.evaluate("window.vefg.setPickMode(true)");
    await previewClient.evaluate(`(() => {
      const target = document.querySelector("#target");
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2
      }));
      return true;
    })()`);
    await delay(250);
    state = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(state.lastSelection, null, "synthetic page click was accepted");
    assert.strictEqual(state.pickMode, true, "synthetic click canceled real Aim");
    const bounds = await previewClient.evaluate(
      `(() => { const r = document.querySelector("#target").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await previewClient.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: bounds.x,
      y: bounds.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await previewClient.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: bounds.x,
      y: bounds.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.lastSelection?.id === "target" ? next : null;
    }, "trusted Aim click was not captured");
    assert.ok(fs.existsSync(state.lastScreenshotPath), "Aim screenshot missing");
    assert.ok(!state.lastCaptureMeta.delivery.deliveryConfirmed);
    await waitFor(
      () =>
        shellClient.evaluate(`Boolean(
          document.querySelector('.capture-receipt') &&
          document.querySelector('.receipt-thumbnail')
        )`),
      "capture receipt or thumbnail did not render",
    );
    const thumbnail = await shellClient.evaluate(
      `(async () => window.vefg.captureThumbnail(${JSON.stringify(state.lastScreenshotPath)}))()`,
    );
    assert.ok(thumbnail.dataUrl.startsWith("data:image/png;base64,"));
    const rejectedThumbnail = await shellClient.evaluate(
      `(async () => window.vefg.captureThumbnail("/etc/passwd"))()`,
    );
    assert.strictEqual(rejectedThumbnail.dataUrl, null);

    await previewClient.evaluate(`(() => {
      const target = document.querySelector("#target");
      target.textContent = "Updated target";
      target.style.backgroundColor = "rgb(22, 163, 74)";
      return true;
    })()`);
    const verification = await shellClient.evaluate(
      `(async () => window.vefg.verify())()`,
    );
    assert.strictEqual(verification.verifyPair.comparison.changed, true);
    assert.ok(
      fs.existsSync(verification.verifyPair.before.screenshotPath),
      "Verify before image missing",
    );
    assert.ok(
      fs.existsSync(verification.verifyPair.after.screenshotPath),
      "Verify after image missing",
    );
    state = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(state.lastVerifyPair.comparison.changed, true);
    await waitFor(
      () =>
        shellClient.evaluate(
          `document.querySelectorAll('.verify-images img').length === 2`,
        ),
      "Before / After thumbnails did not render",
    );
    const verificationDelivery = await shellClient.evaluate(
      `(async () => window.vefg.deliverVerification())()`,
    );
    assert.strictEqual(verificationDelivery.copied, true);

    await previewClient.evaluate(
      `document.querySelector("#target")?.remove(); true`,
    );
    const missingTargetVerification = await shellClient.evaluate(
      `(async () => window.vefg.verify())()`,
    );
    assert.strictEqual(
      missingTargetVerification.verifyPair.comparison.targetFound,
      false,
    );
    assert.strictEqual(
      missingTargetVerification.verifyPair.after.captureMeta.captureMode,
      "viewport",
    );
    assert.ok(
      fs.existsSync(missingTargetVerification.verifyPair.after.screenshotPath),
      "Verify missing-target After image missing",
    );
    await previewClient.evaluate(`(() => {
      const target = document.createElement("button");
      target.id = "target";
      target.textContent = "Updated target";
      document.body.appendChild(target);
      return true;
    })()`);

    assert.strictEqual(state.previewStatus.hasCurrentTarget, true);
    const phoneViewport = await shellClient.evaluate(
      `(async () => window.vefg.setViewport({presetId:"phone390",orientation:"portrait"}))()`,
    );
    assert.strictEqual(phoneViewport.viewportPreset, "phone390");
    assert.strictEqual(phoneViewport.emulatedViewport.width, 390);
    assert.strictEqual(phoneViewport.emulatedViewport.height, 844);
    const targetFrameMode = await shellClient.evaluate(
      `(async () => window.vefg.setFrameMode("target-context"))()`,
    );
    assert.strictEqual(targetFrameMode.frameMode, "target-context");
    const beforeTargetShortcut = state.lastScreenshotPath;
    await dispatchChord(previewClient, "F", "KeyF", primaryShiftModifiers);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.lastScreenshotPath !== beforeTargetShortcut ? next : null;
    }, "preview-focused target-context Frame shortcut did not run");
    assert.strictEqual(state.lastCaptureMeta.captureMode, "target-context");
    assert.strictEqual(state.lastCaptureMeta.viewportPreset, "phone390");
    assert.strictEqual(state.lastSelection?.id, "target");

    const firstShot = state.lastScreenshotPath;
    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(secondUrl)}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewUrl === secondUrl && !next.previewStatus.loading
        ? next
        : null;
    }, "preview did not navigate to second page");
    const staleUi = await waitFor(
      () =>
        shellClient.evaluate(`(() => {
          const value = {
            staleLabel: document.body.innerText.includes("prior page"),
            targetDisabled: document.querySelector('option[value="target-context"]')?.disabled
          };
          return value.staleLabel && value.targetDisabled ? value : null;
        })()`),
      "stale target UI did not update",
    );
    assert.deepStrictEqual(staleUi, {
      staleLabel: true,
      targetDisabled: true,
    });
    const staleFrame = await shellClient.evaluate(
      `(async () => window.vefg.screenshot({mode:"target-context"}))()`,
    );
    assert.strictEqual(staleFrame.captureMode, "viewport");
    assert.strictEqual(staleFrame.fallbackReason, "target-from-prior-navigation");
    state = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(state.lastSelection, null, "stale DOM survived a new Frame");
    assert.notStrictEqual(state.lastScreenshotPath, firstShot);

    await shellClient.evaluate("window.vefg.goBack()");
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === demoUrl && !next.previewStatus.loading
        ? next
        : null;
    }, "preview Back did not synchronize URL");
    assert.strictEqual(state.previewStatus.canGoForward, true);
    assert.strictEqual(
      await shellClient.evaluate(
        `document.querySelector('[aria-label="Preview URL"]')?.value`,
      ),
      demoUrl,
    );
    await shellClient.evaluate("window.vefg.goForward()");
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === secondUrl && !next.previewStatus.loading
        ? next
        : null;
    }, "preview Forward did not synchronize URL");

    await shellClient.evaluate(
      `(async () => window.vefg.terminalWrite({data:"repeat 240 print -r -- wheel-smoke-line\\r"}))()`,
    );
    await waitFor(
      () =>
        shellClient.evaluate(`(() => {
          const viewport = document.querySelector('.xterm-viewport');
          return viewport && viewport.scrollHeight - viewport.clientHeight > 1000;
        })()`),
      "terminal scrollback was not populated",
    );
    const scrollbackTravel = await shellClient.evaluate(`(async () => {
      const viewport = document.querySelector('.xterm-viewport');
      const screen = document.querySelector('.xterm-screen');
      if (!viewport || !screen) return 0;
      viewport.scrollTop = 0;
      const rect = screen.getBoundingClientRect();
      screen.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: 30,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return viewport.scrollTop;
    })()`);
    assert.ok(
      scrollbackTravel >= 100,
      `wheel over xterm screen did not accelerate scrollback (${scrollbackTravel}px)`,
    );

    const grokStart = await shellClient.evaluate(
      `(async () => window.vefg.terminalLaunchGrok())()`,
    );
    assert.strictEqual(grokStart.mode, "grok");
    assert.strictEqual(grokStart.alreadyRunning, false);
    state = await shellClient.evaluate("window.vefg.getState()");
    assert.strictEqual(state.terminalMode, "grok");
    assert.strictEqual(state.grokRunning, true);
    const duplicate = await shellClient.evaluate(
      `(async () => window.vefg.terminalLaunchGrok())()`,
    );
    assert.strictEqual(duplicate.alreadyRunning, true);

    await assertTuiWheelAcceleration(shellClient, fakeGrokInputLog);

    // Preview-focused global shortcuts: Cmd+Shift on macOS, Ctrl+Shift elsewhere.
    previewClient.close();
    previewClient = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.url === secondUrl,
      "second preview target",
    );
    assert.strictEqual(
      await previewClient.evaluate("window.innerWidth"),
      390,
      "responsive emulation was lost after navigation",
    );
    const viewportFrameMode = await shellClient.evaluate(
      `(async () => window.vefg.setFrameMode("viewport"))()`,
    );
    assert.strictEqual(viewportFrameMode.frameMode, "viewport");
    const beforeShortcut = state.lastScreenshotPath;
    await dispatchChord(previewClient, "F", "KeyF", primaryShiftModifiers);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.lastScreenshotPath !== beforeShortcut ? next : null;
    }, "preview-focused Frame shortcut did not run");
    assert.strictEqual(state.lastCaptureMeta.captureMode, "viewport");
    assert.strictEqual(state.lastCaptureMeta.delivery.deliveryConfirmed, false);

    const resendShot = state.lastScreenshotPath;
    const previousResentAt = state.lastCaptureMeta.resentAt || 0;
    await dispatchChord(previewClient, "V", "KeyV", primaryShiftModifiers);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.lastCaptureMeta?.resentAt > previousResentAt ? next : null;
    }, "preview-focused Re-send shortcut did not run");
    assert.strictEqual(
      state.lastScreenshotPath,
      resendShot,
      "Re-send created a new screenshot",
    );

    const reloadBefore = {
      navigationId: state.previewStatus.navigationId,
      terminalAlive: state.terminalAlive,
      terminalMode: state.terminalMode,
      grokRunning: state.grokRunning,
    };
    const reloadSentinel = `shell-survived-${Date.now()}`;
    await shellClient.evaluate(
      `window.__vefgReloadSentinel = ${JSON.stringify(reloadSentinel)}; true`,
    );
    await dispatchChord(previewClient, "R", "KeyR", primaryModifier);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.navigationId > reloadBefore.navigationId &&
        !next.previewStatus.loading
        ? next
        : null;
    }, "Cmd/Ctrl+R did not reload the preview");
    assert.strictEqual(state.previewStatus.error, null);
    assert.strictEqual(state.terminalAlive, reloadBefore.terminalAlive);
    assert.strictEqual(state.terminalMode, reloadBefore.terminalMode);
    assert.strictEqual(state.grokRunning, reloadBefore.grokRunning);
    assert.strictEqual(
      await shellClient.evaluate("window.__vefgReloadSentinel"),
      reloadSentinel,
      "Cmd/Ctrl+R reloaded the shell renderer",
    );

    previewClient.close();
    previewClient = null;
    const unavailableUrl = `http://127.0.0.1:${releasedPort}/`;
    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(unavailableUrl)}))()`,
    );
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.error && !next.previewStatus.loading
        ? next
        : null;
    }, "unavailable preview did not report a load error");
    assert.strictEqual(child.exitCode, null, "app exited after a preview load error");
    assert.strictEqual(state.terminalMode, "grok");
    assert.strictEqual(state.grokRunning, true);

    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(secondUrl)}))()`,
    );
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === secondUrl &&
        !next.previewStatus.loading &&
        !next.previewStatus.error
        ? next
        : null;
    }, "preview did not recover after a load error");
    assert.strictEqual(state.terminalMode, "grok");
    assert.strictEqual(state.grokRunning, true);
    previewClient = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.url === secondUrl,
      "recovered second preview target",
    );

    await dispatchChord(previewClient, "A", "KeyA", primaryShiftModifiers);
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.pickMode ? next : null;
    }, "preview-focused Aim shortcut did not run");
    await previewClient.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 53,
    });
    await previewClient.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 53,
    });
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.pickMode ? null : next;
    }, "Escape did not cancel Aim");

    previewClient.close();
    previewClient = null;
    state = await shellClient.evaluate("window.vefg.getState()");
    const firstSessionId = state.activeTerminalId;
    const createdSession = await shellClient.evaluate(
      `(async () => window.vefg.terminalCreate({cwd:${JSON.stringify(projectDir)},activate:true}))()`,
    );
    const secondSessionId = createdSession.sessionId;
    assert.notStrictEqual(secondSessionId, firstSessionId);
    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(demoUrl)}))()`,
    );
    await shellClient.evaluate(
      `(async () => window.vefg.setViewport({presetId:"fit",orientation:"portrait"}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.activeTerminalId === secondSessionId &&
        next.previewStatus.url === demoUrl &&
        !next.previewStatus.loading ? next : null;
    }, "second terminal workspace did not settle");
    await shellClient.evaluate(
      `(async () => window.vefg.terminalSetActive(${JSON.stringify(firstSessionId)}))()`,
    );
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.activeTerminalId === firstSessionId &&
        next.previewStatus.url === secondUrl &&
        !next.previewStatus.loading ? next : null;
    }, "first terminal workspace was not restored");
    assert.strictEqual(state.viewportPreset, "phone390");
    const firstWorkspacePreview = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.url === secondUrl,
      "restored first workspace preview target",
    );
    assert.strictEqual(
      await firstWorkspacePreview.evaluate("window.innerWidth"),
      390,
      "first terminal responsive viewport was not restored",
    );
    firstWorkspacePreview.close();

    const historyBeforePrivate = state.recentPreviewUrls;
    const privateStatus = await shellClient.evaluate(
      `(async () => window.vefg.setPrivateMode(true))()`,
    );
    assert.strictEqual(privateStatus.privateMode, true);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.privateMode && !next.previewStatus.loading ? next : null;
    }, "private preview did not settle");
    const privateUrl = `${demoUrl}private-a?token=do-not-persist`;
    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(privateUrl)}))()`,
    );
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === privateUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private preview navigation did not settle");
    assert.deepStrictEqual(state.recentPreviewUrls, historyBeforePrivate);
    await shellClient.evaluate(
      `(async () => window.vefg.terminalSetActive(${JSON.stringify(secondSessionId)}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.activeTerminalId === secondSessionId &&
        next.previewStatus.url === demoUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private second terminal did not start from its persistent page");
    const secondPrivateUrl = `${demoUrl}private-b?token=do-not-persist`;
    await shellClient.evaluate(
      `(async () => window.vefg.navigate(${JSON.stringify(secondPrivateUrl)}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === secondPrivateUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private second terminal navigation did not settle");
    await shellClient.evaluate(
      `(async () => window.vefg.terminalSetActive(${JSON.stringify(firstSessionId)}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === privateUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private first terminal URL was not isolated");
    const clearedPreview = await shellClient.evaluate(
      `(async () => window.vefg.clearPreviewData("all"))()`,
    );
    assert.strictEqual(clearedPreview.ok, true);
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === privateUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private preview did not recover after clearing data");
    const diagnostics = await shellClient.evaluate(
      `(async () => window.vefg.copyDiagnostics())()`,
    );
    assert.strictEqual(diagnostics.ok, true);
    const persistentStatus = await shellClient.evaluate(
      `(async () => window.vefg.setPrivateMode(false))()`,
    );
    assert.strictEqual(persistentStatus.privateMode, false);
    state = await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.previewStatus.url === secondUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private mode did not restore the last persistent page");
    await shellClient.evaluate(
      `(async () => window.vefg.terminalSetActive(${JSON.stringify(secondSessionId)}))()`,
    );
    await waitFor(async () => {
      const next = await shellClient.evaluate("window.vefg.getState()");
      return next.activeTerminalId === secondSessionId &&
        next.previewStatus.url === demoUrl &&
        !next.previewStatus.loading ? next : null;
    }, "private mode overwrote the second terminal persistent page");
    const secondWorkspacePreview = await connectTarget(
      debuggingPort,
      (target) => target.type === "page" && target.url === demoUrl,
      "restored second workspace preview target",
    );
    assert.ok(
      (await secondWorkspacePreview.evaluate("window.innerWidth")) > 390,
      "second terminal Fit viewport inherited the first terminal phone width",
    );
    secondWorkspacePreview.close();
    const settingsPath = path.join(
      tmp,
      "profile",
      "visual-capture-settings.json",
    );
    const persistedSettings = await waitFor(() => {
      if (!fs.existsSync(settingsPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      return parsed.activeTerminalId === secondSessionId ? parsed : null;
    }, "active terminal workspace was not persisted");
    const persistedFirst = persistedSettings.terminalSessions.find(
      (item) => item.id === firstSessionId,
    );
    const persistedSecond = persistedSettings.terminalSessions.find(
      (item) => item.id === secondSessionId,
    );
    assert.strictEqual(persistedFirst.previewUrl, secondUrl);
    assert.strictEqual(persistedSecond.previewUrl, demoUrl);
    assert.doesNotMatch(JSON.stringify(persistedSettings), /do-not-persist/);

    const restoreProfile = path.join(tmp, "restore-profile");
    fs.mkdirSync(restoreProfile, { recursive: true });
    const restoreSettingsPath = path.join(
      restoreProfile,
      "visual-capture-settings.json",
    );
    fs.writeFileSync(
      restoreSettingsPath,
      JSON.stringify({
        settingsVersion: 2,
        previewUrl: demoUrl,
        projectCwd: projectDir,
        terminalSessions: [
          { id: "restore-a", cwd: projectDir, label: "A", createdAt: 1 },
          { id: "restore-b", cwd: projectDir, label: "B", createdAt: 2 },
        ],
        activeTerminalId: "restore-b",
      }),
      { mode: 0o600 },
    );
    const restoreDebugPort = await freePort();
    const restoreArgs = [
      `--remote-debugging-port=${restoreDebugPort}`,
      `--user-data-dir=${restoreProfile}`,
      "--lang=en-US",
    ];
    if (packagedBinary) restoreArgs.push("--disable-gpu");
    else restoreArgs.push(ROOT);
    const restoreChild = spawn(electronBinary, restoreArgs, {
      cwd: ROOT,
      env: {
        ...process.env,
        GROK_PATH: FAKE_GROK,
        VEFG_FAKE_GROK_INPUT_LOG: fakeGrokInputLog,
        HOME: tmp,
        LANG: "en_US.UTF-8",
        NODE_OPTIONS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let restoreLog = "";
    restoreChild.stdout.on("data", (chunk) => (restoreLog += chunk));
    restoreChild.stderr.on("data", (chunk) => (restoreLog += chunk));
    let restoreClient = null;
    try {
      restoreClient = await connectTarget(
        restoreDebugPort,
        (target) =>
          target.type === "page" && target.title === "Visual Capture for Grok",
        "restored app shell target",
      );
      const restoredState = await waitFor(
        () =>
          restoreClient.evaluate(
            `(async () => window.vefg ? window.vefg.getState() : null)()`,
          ),
        "restored preload API did not become available",
      );
      assert.strictEqual(restoredState.activeTerminalId, "restore-b");
      assert.strictEqual(restoredState.terminals.activeId, "restore-b");
      assert.strictEqual(restoredState.previewUrl, demoUrl);
      const rewrittenRestoreSettings = JSON.parse(
        fs.readFileSync(restoreSettingsPath, "utf8"),
      );
      assert.strictEqual(rewrittenRestoreSettings.activeTerminalId, "restore-b");
      assert.strictEqual(
        rewrittenRestoreSettings.terminalSessions.find(
          (item) => item.id === "restore-b",
        ).previewUrl,
        demoUrl,
      );
    } catch (error) {
      error.message += `\nRestore Electron log:\n${restoreLog.slice(-3_000)}`;
      throw error;
    } finally {
      restoreClient?.close();
      await stopChild(restoreChild);
    }

    console.log(
      `ok  - ${packagedBinary ? "Packaged" : "Electron"} Aim / Verify / responsive / private workspaces / restore / Grok smoke`,
    );
  } catch (err) {
    err.message += `\nElectron log:\n${appLog.slice(-6_000)}`;
    throw err;
  } finally {
    shellClient?.close();
    previewClient?.close();
    await stopChild(child);
    await new Promise((resolve) => demoServer.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
