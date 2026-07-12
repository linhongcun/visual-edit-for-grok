/// <reference types="vite/client" />

import type {
  CaptureReceiptState,
  CaptureResult,
  ElementSelection,
  EnrichmentPayload,
  FrameMode,
  GrokRuntimeState,
  LayoutBounds,
  PreviewStatus,
  ViewportOrientation,
  ViewportPreset,
  ViewportPresetId,
  VerifyPair,
} from "./types";

export interface VefgApi {
  getState: () => Promise<{
    previewUrl: string;
    pickMode: boolean;
    lastSelection: ElementSelection | null;
    lastScreenshotPath: string | null;
    lastVerifyPair?: VerifyPair | null;
    captureDir: string;
    projectCwd: string;
    recentPreviewUrls?: string[];
    recentProjectCwds?: string[];
    splitRatio: number;
    previewCollapsed?: boolean;
    autoPasteTerminal: boolean;
    frameMode?: FrameMode;
    viewportPresets?: ViewportPreset[];
    viewportPreset?: ViewportPresetId;
    viewportOrientation?: ViewportOrientation;
    privateMode?: boolean;
    appVersion?: string;
    locale?: "en" | "zh" | string;
    captureBusy?: boolean;
    terminals?: {
      sessions: Array<{
        id: string;
        cwd: string;
        label: string;
        createdAt?: number;
        shellAlive?: boolean;
        grokRunning?: boolean;
        mode?: string | null;
        previewUrl?: string;
        viewportPreset?: ViewportPresetId;
        viewportOrientation?: ViewportOrientation;
        lastSelection?: ElementSelection | null;
        lastScreenshotPath?: string | null;
        lastCaptureMeta?: CaptureReceiptState | null;
        verifyPair?: VerifyPair | null;
      }>;
      activeId: string | null;
      maxSessions?: number;
    };
    activeTerminalId?: string | null;
    terminalAlive: boolean;
    shellAlive?: boolean;
    grokLaunchRequested?: boolean;
    grokReady?: boolean | null;
    grokReadiness?: "ready" | "unknown" | "unavailable" | string;
    grokState?: GrokRuntimeState | string;
    grokRunning?: boolean;
    terminalMode?: "shell" | "grok" | null;
    previewStatus?: PreviewStatus;
    lastCapture?: CaptureReceiptState | null;
    lastCaptureMeta?: CaptureReceiptState | null;
    layout: LayoutBounds;
    termFontSize?: number;
    linkTooltip?: boolean;
    copyOnSelect?: boolean;
    termScrollback?: number;
    notifyOnGrokExit?: boolean;
    notifyOnLongTask?: boolean;
    longTaskNotifyThresholdSec?: number;
  }>;
  navigate: (url: string) => Promise<{ ok: boolean; status?: PreviewStatus }>;
  reload: () => Promise<{ ok: boolean; status?: PreviewStatus }>;
  goBack: () => Promise<{ ok: boolean; status?: PreviewStatus }>;
  goForward: () => Promise<{ ok: boolean; status?: PreviewStatus }>;
  setViewport: (opts: {
    presetId: ViewportPresetId;
    orientation?: ViewportOrientation;
  }) => Promise<PreviewStatus>;
  setPrivateMode: (enabled: boolean) => Promise<PreviewStatus>;
  clearPreviewData: (scope?: "all" | "origin") => Promise<{ ok: boolean }>;
  setPickMode: (
    enabled: boolean,
  ) => Promise<{
    pickMode: boolean;
    warning?: string | null;
    terminalAlive?: boolean;
  }>;
  screenshot: (opts?: { mode?: FrameMode }) => Promise<{
    path: string;
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
    cropped?: boolean;
    captureMode?: FrameMode;
  }>;
  recopy: (enrichment?: EnrichmentPayload) => Promise<{
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
    text?: string;
  }>;
  deliver: () => Promise<{
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
    text?: string;
  }>;
  verify: () => Promise<{
    verifyPair: VerifyPair;
    targetSessionId?: string;
  }>;
  deliverVerification: () => Promise<{
    copied: boolean;
    pastedToTerminal?: boolean;
    imageAttachmentsAttempted?: number;
  }>;
  openCaptureFolder: () => Promise<{ ok: boolean; path: string }>;
  captureThumbnail: (capturePath: string) => Promise<{ dataUrl: string | null }>;
  clearCapture: () => Promise<{ ok: boolean }>;
  setAutoPaste: (enabled: boolean) => Promise<{ autoPasteTerminal: boolean }>;
  setFrameMode: (mode: FrameMode) => Promise<{ frameMode: FrameMode }>;
  setLocale: (locale: "en" | "zh" | string) => Promise<{ locale: "en" | "zh" }>;
  setTermSettings: (partial: {
    termFontSize?: number;
    linkTooltip?: boolean;
    copyOnSelect?: boolean;
    termScrollback?: number;
    notifyOnGrokExit?: boolean;
    notifyOnLongTask?: boolean;
    longTaskNotifyThresholdSec?: number;
  }) => Promise<{
    termFontSize: number;
    linkTooltip: boolean;
    copyOnSelect: boolean;
    termScrollback: number;
    notifyOnGrokExit: boolean;
    notifyOnLongTask: boolean;
    longTaskNotifyThresholdSec: number;
  }>;
  copyDiagnostics: () => Promise<{ ok: boolean }>;
  stabilityProbe: (payload?: {
    code?: string;
    message?: string;
  }) => Promise<{
    ok: boolean;
    entry?: {
      code: string;
      message: string;
      severity?: string;
      at?: number;
    } | null;
    recentErrors?: Array<{
      code: string;
      message: string;
      at?: number;
      severity?: string;
    }>;
    bufferSize?: number;
  }>;
  checkUpdates: () => Promise<{ ok: boolean }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  pickProjectDir: () => Promise<{
    projectCwd: string;
    terminalRestarted?: boolean;
    canceled?: boolean;
  }>;
  setProjectDir: (cwd: string) => Promise<{
    projectCwd: string;
    terminalRestarted?: boolean;
    canceled?: boolean;
  }>;
  setSplit: (
    ratio: number,
    opts?: { force?: boolean; persist?: boolean },
  ) => Promise<LayoutBounds>;
  setPreviewCollapsed: (collapsed: boolean) => Promise<LayoutBounds>;
  terminalList: () => Promise<{
    sessions: Array<{
      id: string;
      cwd: string;
      label: string;
      createdAt?: number;
      shellAlive?: boolean;
      grokRunning?: boolean;
      mode?: string | null;
    }>;
    activeId: string | null;
    maxSessions?: number;
  }>;
  terminalCreate: (opts?: {
    cwd?: string;
    label?: string;
    activate?: boolean;
  }) => Promise<{
    ok: boolean;
    sessionId: string;
    sessions: Array<{
      id: string;
      cwd: string;
      label: string;
      shellAlive?: boolean;
      grokRunning?: boolean;
    }>;
    activeId: string | null;
    maxSessions?: number;
  }>;
  terminalClose: (sessionId: string) => Promise<{
    canceled?: boolean;
    sessions: Array<{
      id: string;
      cwd: string;
      label: string;
      displayLabel?: string;
      grokRunning?: boolean;
    }>;
    activeId: string | null;
  }>;
  terminalSetActive: (sessionId: string) => Promise<{
    sessions: Array<{ id: string; cwd: string; label: string }>;
    activeId: string | null;
  }>;
  terminalRename: (
    sessionId: string,
    label: string,
  ) => Promise<{
    sessions: Array<{ id: string; cwd: string; label: string }>;
    activeId: string | null;
  }>;
  terminalReorder: (orderedIds: string[]) => Promise<{
    sessions: Array<{ id: string; cwd: string; label: string }>;
    activeId: string | null;
  }>;
  terminalStart: (opts?: {
    cols?: number;
    rows?: number;
    sessionId?: string;
  }) => Promise<{ ok: boolean; cwd: string; sessionId?: string }>;
  terminalWrite: (
    dataOrOpts: string | { data: string; sessionId?: string },
    sessionId?: string,
  ) => Promise<{ ok: boolean }>;
  terminalPaste: (
    textOrOpts: string | { text: string; sessionId?: string },
    sessionId?: string,
  ) => Promise<{ ok: boolean }>;
  terminalResize: (size: {
    cols: number;
    rows: number;
    sessionId?: string;
  }) => Promise<{ ok: boolean }>;
  terminalLaunchGrok: (opts?: { sessionId?: string }) => Promise<{
    ok: boolean;
    sessionId?: string;
    terminalAlive?: boolean;
    shellAlive?: boolean;
    grokLaunchRequested?: boolean;
    grokReady?: boolean | null;
    grokReadiness?: "ready" | "unknown" | "unavailable" | string;
    grokState?: GrokRuntimeState | string;
    mode?: "shell" | "grok";
    alreadyRunning?: boolean;
  }>;
  terminalRestart: (opts?: {
    cols?: number;
    rows?: number;
    sessionId?: string;
  }) => Promise<{ ok: boolean; cwd: string; sessionId?: string }>;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    vefg: VefgApi;
  }
}

export type {
  CaptureResult,
  ElementSelection,
  EnrichmentPayload,
  LayoutBounds,
  PreviewStatus,
};
