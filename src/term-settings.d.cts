export const TERM_FONT_SIZE_MIN: number;
export const TERM_FONT_SIZE_MAX: number;
export const TERM_FONT_SIZE_DEFAULT: number;
export const TERM_SCROLLBACK_MIN: number;
export const TERM_SCROLLBACK_MAX: number;
export const TERM_SCROLLBACK_DEFAULT: number;
export const TERM_MIN_CONTRAST_MIN: number;
export const TERM_MIN_CONTRAST_MAX: number;
export const TERM_MIN_CONTRAST_DEFAULT: number;
export const WEBGL_CONTEXT_LOSS_MAX_RETRIES: number;
export const WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS: number;

export function clampTermFontSize(value: unknown, fallback?: number): number;
export function nextTermFontSize(current: number, delta: 1 | -1 | 0): number;
export function clampTermScrollback(value: unknown, fallback?: number): number;
export function clampMinimumContrastRatio(value: unknown, fallback?: number): number;
export function mayAttachWebglRenderer(input?: {
  disposed?: boolean;
  termRefCurrent?: unknown;
  term?: unknown;
}): { ok: boolean; reason: string };
export function planWebglContextLoss(input?: {
  lossCount?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}): {
  action: "dispose-to-canvas" | "retry-webgl";
  reason: string;
  nextLossCount: number;
  retryDelayMs: number;
};
export function asBoolean(value: unknown, fallback?: boolean): boolean;
