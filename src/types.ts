export interface ElementSelection {
  tag: string;
  id: string | null;
  className: string;
  classes: string[];
  selector: string;
  domPath?: string;
  text: string;
  attributes: Record<string, string>;
  outerHTML?: string;
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
  captureContext?: {
    navigationId?: number;
    navigationToken?: string;
    sourceId?: number;
    pageUrl?: string;
    viewport?: {
      width?: number;
      height?: number;
      devicePixelRatio?: number;
      scrollX?: number;
      scrollY?: number;
    };
    scroll?: { x?: number; y?: number };
  };
}

export interface StyleChange {
  before: string;
  after: string;
}

/** camelCase CSS keys → before/after */
export type StyleDiffMap = Record<string, StyleChange>;

export type FrameMode = "viewport" | "target-context";
export type ViewportPresetId =
  | "fit"
  | "desktop"
  | "laptop"
  | "tablet"
  | "phone390"
  | "phone375";
export type ViewportOrientation = "portrait" | "landscape";

export interface ViewportPreset {
  id: ViewportPresetId;
  label: string;
  width: number | null;
  height: number | null;
  mobile: boolean;
}

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
  viewportPreset?: ViewportPresetId;
  viewportOrientation?: ViewportOrientation;
  emulatedViewport?: ViewportPreset & { orientation?: string };
  privateMode?: boolean;
}

export interface TerminalStatus {
  sessionId?: string;
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
  previewUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
  captureMode?: FrameMode;
  deliveryStatus?: string;
  targetSessionId?: string;
  targetSessionLabel?: string;
  viewportPreset?: ViewportPresetId;
  viewportOrientation?: ViewportOrientation;
  emulatedViewport?: ViewportPreset & { orientation?: string };
}

export interface VerificationComparison {
  targetFound: boolean;
  changed: boolean;
  geometryChanged?: boolean;
  geometryDelta?: Record<string, number>;
  textChanged?: boolean;
  identityChanged?: boolean;
  attributeChanges?: string[];
  styleChanges?: Array<{ property: string; before: string; after: string }>;
  summary: string[];
}

export interface CaptureReference {
  selection: ElementSelection | null;
  screenshotPath: string | null;
  captureMeta: CaptureReceiptState | null;
}

export interface VerifyPair {
  before: CaptureReference | null;
  after: CaptureReference | null;
  comparison?: VerificationComparison | null;
  verifiedAt: number;
  targetSessionId?: string;
  targetCwd?: string;
  targetLabel?: string;
}

export interface CaptureResult {
  kind:
    | "selection"
    | "screenshot"
    | "recopy"
    | "deliver"
    | "workspace"
    | "verify"
    | "verify-deliver"
    | "error";
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
  previewUrl?: string;
  pageTitle?: string;
  viewportPreset?: ViewportPresetId;
  viewportOrientation?: ViewportOrientation;
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
  verifyPair?: VerifyPair | null;
  targetSessionId?: string | null;
  targetSessionLabel?: string | null;
  targetCwd?: string | null;
  imageAttachmentsAttempted?: number;
  message?: string;
  awaitEnrichment?: boolean;
}

export interface LayoutBounds {
  toolbarHeight: number;
  previewChromeHeight?: number;
  terminalWidth: number;
  previewWidth: number;
  contentWidth: number;
  contentHeight: number;
  splitRatio: number;
  previewCollapsed?: boolean;
  splitterVisible?: boolean;
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
