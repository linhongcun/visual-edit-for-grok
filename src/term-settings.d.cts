export const TERM_FONT_SIZE_MIN: number;
export const TERM_FONT_SIZE_MAX: number;
export const TERM_FONT_SIZE_DEFAULT: number;
export const TERM_SCROLLBACK_MIN: number;
export const TERM_SCROLLBACK_MAX: number;
export const TERM_SCROLLBACK_DEFAULT: number;

export function clampTermFontSize(value: unknown, fallback?: number): number;
export function nextTermFontSize(current: number, delta: 1 | -1 | 0): number;
export function clampTermScrollback(value: unknown, fallback?: number): number;
export function asBoolean(value: unknown, fallback?: boolean): boolean;
