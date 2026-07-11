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
}

export interface CaptureResult {
  kind: "selection" | "screenshot" | "recopy" | "deliver" | "error";
  selection?: ElementSelection | null;
  copied?: boolean;
  pastedToTerminal?: boolean;
  hasImage?: boolean;
  /** Grok TUI image chip via OS clipboard paste (true multimodal) */
  imageChip?: boolean;
  imagePrepared?: boolean;
  multimodal?: boolean;
  fallback?: string | null;
  statusMessage?: string;
  terminalAlive?: boolean;
  textPreview?: string;
  text?: string;
  screenshotPath?: string | null;
  path?: string;
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
