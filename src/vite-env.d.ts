/// <reference types="vite/client" />

import type {
  CaptureResult,
  ElementSelection,
  EnrichmentPayload,
  LayoutBounds,
  PreviewStatus,
} from "./types";

export interface VefgApi {
  getState: () => Promise<{
    previewUrl: string;
    pickMode: boolean;
    lastSelection: ElementSelection | null;
    lastScreenshotPath: string | null;
    captureDir: string;
    projectCwd: string;
    splitRatio: number;
    autoPasteTerminal: boolean;
    captureBusy?: boolean;
    terminalAlive: boolean;
    layout: LayoutBounds;
  }>;
  navigate: (url: string) => Promise<{ ok: boolean }>;
  reload: () => Promise<{ ok: boolean }>;
  goBack: () => Promise<{ ok: boolean }>;
  goForward: () => Promise<{ ok: boolean }>;
  setPickMode: (
    enabled: boolean,
  ) => Promise<{
    pickMode: boolean;
    warning?: string | null;
    terminalAlive?: boolean;
  }>;
  screenshot: () => Promise<{
    path: string;
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
  }>;
  recopy: (enrichment?: EnrichmentPayload) => Promise<{
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
    text?: string;
  }>;
  deliver: (enrichment?: EnrichmentPayload) => Promise<{
    copied: boolean;
    pastedToTerminal?: boolean;
    hasImage: boolean;
    text?: string;
  }>;
  openCaptureFolder: () => Promise<{ ok: boolean; path: string }>;
  clearCapture: () => Promise<{ ok: boolean }>;
  setAutoPaste: (enabled: boolean) => Promise<{ autoPasteTerminal: boolean }>;
  pickProjectDir: () => Promise<{ projectCwd: string }>;
  setProjectDir: (cwd: string) => Promise<{ projectCwd: string }>;
  setSplit: (
    ratio: number,
    opts?: { force?: boolean; persist?: boolean },
  ) => Promise<LayoutBounds>;
  terminalStart: (opts?: {
    cols?: number;
    rows?: number;
  }) => Promise<{ ok: boolean; cwd: string }>;
  terminalWrite: (data: string) => Promise<{ ok: boolean }>;
  terminalPaste: (text: string) => Promise<{ ok: boolean }>;
  terminalResize: (size: {
    cols: number;
    rows: number;
  }) => Promise<{ ok: boolean }>;
  terminalLaunchGrok: () => Promise<{ ok: boolean }>;
  terminalRestart: (opts?: {
    cols?: number;
    rows?: number;
  }) => Promise<{ ok: boolean; cwd: string }>;
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
