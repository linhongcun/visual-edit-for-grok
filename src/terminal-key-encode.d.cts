export type ModifiedEnterResult =
  | { action: "write"; sequence: string; reason: string }
  | { action: "swallow"; reason: string };

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
