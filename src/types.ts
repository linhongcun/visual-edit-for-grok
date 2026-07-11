export interface ElementSelection {
  tag: string;
  id: string | null;
  className: string;
  classes: string[];
  selector: string;
  domPath?: string;
  text: string;
  attributes: Record<string, string>;
  outerHTML: string;
  computedStyle: Record<string, string>;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
    top?: number;
    left?: number;
  };
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
}

export interface StyleChange {
  before: string;
  after: string;
}

/** camelCase CSS keys → before/after */
export type StyleDiffMap = Record<string, StyleChange>;

export type FrameMode = "viewport" | "target-context";

/**
 * `ready` is only used when the main process has an explicit readiness signal.
 * A successful launch request alone is represented by `launch-requested`.
 */
export type GrokRuntimeState =
  | "idle"
  | "launching"
  | "launch-requested"
  | "ready"
  | "exited"
  | "unknown";

export interface EnrichmentPayload {
  intent?: string;
  styleDiffs?: StyleDiffMap;
  pasteToTerminal?: boolean;
}

export interface PreviewStatus {
  url?: string;
  title?: string;
  loading?: boolean;
  error?: string | null;
  canGoBack?: boolean;
  canGoForward?: boolean;
  isWelcome?: boolean;
  navigationId?: number;
  selectionStale?: boolean;
  hasCurrentTarget?: boolean;
}

export interface TerminalStatus {
  alive?: boolean;
  shellAlive?: boolean;
  terminalAlive?: boolean;
  cwd?: string;
  error?: string | null;
  grokLaunchRequested?: boolean;
  grokReady?: boolean | null;
  grokReadiness?: "ready" | "unknown" | "unavailable" | string;
  grokState?: GrokRuntimeState | string;
  grokRunning?: boolean;
  terminalMode?: "shell" | "grok" | null;
}

export interface CaptureReceiptState {
  target?: string;
  kind?: string;
  selection?: ElementSelection | null;
  screenshotPath?: string | null;
  pageUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
  captureMode?: FrameMode;
  deliveryStatus?: string;
}

export interface CaptureResult {
  kind: "selection" | "screenshot" | "recopy" | "deliver" | "error";
  selection?: ElementSelection | null;
  copied?: boolean;
  pastedToTerminal?: boolean;
  hasImage?: boolean;
  /** Grok TUI image chip via OS clipboard paste (true multimodal) */
  imageChip?: boolean;
  imageChipAttempted?: boolean;
  imageChipConfirmed?: boolean;
  imagePrepared?: boolean;
  multimodal?: boolean;
  fallback?: string | null;
  statusMessage?: string;
  terminalAlive?: boolean;
  textPreview?: string;
  text?: string;
  screenshotPath?: string | null;
  path?: string;
  fullPath?: string;
  cropped?: boolean;
  captureMode?: FrameMode;
  capturedAt?: number;
  pageUrl?: string;
  pageTitle?: string;
  deliveryStatus?: string;
  /** Stable outcome kind from classifyDeliveryOutcome (never chip-confirmed). */
  deliveryOutcome?:
    | "image-attempted"
    | "text-attempted"
    | "clipboard-only"
    | "local-only"
    | "failed"
    | "unknown"
    | string;
  deliveryOutcomeLabel?: string;
  deliveryAttempted?: boolean;
  deliveryConfirmed?: boolean;
  shellAlive?: boolean;
  grokReadiness?: "ready" | "unknown" | "unavailable" | string;
  grokLaunchRequested?: boolean;
  grokReady?: boolean | null;
  grokState?: GrokRuntimeState | string;
  captureMeta?: CaptureReceiptState | null;
  message?: string;
  awaitEnrichment?: boolean;
}

export interface LayoutBounds {
  toolbarHeight: number;
  terminalWidth: number;
  previewWidth: number;
  contentWidth: number;
  contentHeight: number;
  splitRatio: number;
}

/** Props offered in the style-diff editor (match computedStyle keys). */
export const EDITABLE_STYLE_PROPS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
  "width",
  "height",
  "borderRadius",
  "border",
  "opacity",
  "lineHeight",
] as const;

export type EditableStyleProp = (typeof EDITABLE_STYLE_PROPS)[number];

export function prefillStyleDiffs(
  selection: ElementSelection | null,
): StyleDiffMap {
  const cs = selection?.computedStyle || {};
  const out: StyleDiffMap = {};
  for (const prop of EDITABLE_STYLE_PROPS) {
    out[prop] = {
      before: cs[prop] != null ? String(cs[prop]) : "",
      after: "",
    };
  }
  return out;
}
