export type HostKeyResult =
  | { action: "write"; sequence: string; reason: string }
  | { action: "swallow"; reason: string };

export type ModifiedEnterResult = HostKeyResult;

export function resolveGrokHostKey(event: {
  type?: string;
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): HostKeyResult | null;

export function resolveModifiedEnterForGrok(event: {
  type?: string;
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): ModifiedEnterResult | null;

export function encodeModifiedEnterForGrok(event: {
  type?: string;
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): { sequence: string; reason: string } | null;

export const KITTY_MOD_SUPER: number;
export const KITTY_KEY_A: number;
export const KITTY_KEY_BACKSPACE: number;
export const SEQ_LINE_START: string;
export const SEQ_LINE_END: string;
export const SEQ_BUFFER_START: string;
export const SEQ_BUFFER_END: string;
export const SEQ_WORD_DELETE_FORWARD: string;
