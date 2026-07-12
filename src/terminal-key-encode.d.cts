export function encodeModifiedEnterForGrok(event: {
  type?: string;
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): { sequence: string; reason: string } | null;
