export function shouldShowUrlClear(value: unknown): boolean;

export function filterRecentUrls(
  query: unknown,
  recentUrls: unknown,
  opts?: { limit?: number; privateMode?: boolean },
): string[];

export function paletteItemMatches(
  item: { id: string; label: string },
  query: string,
): boolean;

export function filterPaletteItems(
  query: unknown,
  items: Array<{ id: string; label: string }>,
): Array<{ id: string; label: string }>;

export function resolveEscapeAction(state?: {
  pickMode?: boolean;
  findOpen?: boolean;
  paletteOpen?: boolean;
  settingsOpen?: boolean;
  shortcutsOpen?: boolean;
  urlFocused?: boolean;
}):
  | "aim-cancel"
  | "close-find"
  | "close-palette"
  | "close-settings"
  | "close-shortcuts"
  | "blur-url"
  | "none";

export function resolveFocusedChromeEscape(
  surface: "url" | "find" | "palette" | "settings" | "shortcuts",
  pickMode?: boolean,
):
  | "aim-cancel"
  | "close-find"
  | "close-palette"
  | "close-settings"
  | "close-shortcuts"
  | "blur-url"
  | "none";

export function normalizeUrlInputValue(value: unknown): string;

export function normalizeKeyEvent(event: {
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
} | null | undefined): {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export function resolveUrlKeyAction(event: {
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): "submit" | "none";

export function resolveFindKeyAction(event: {
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): "find-next" | "find-prev" | "none";

export function clampPaletteIndex(index: unknown, itemCount: unknown): number;

export function movePaletteIndex(
  index: unknown,
  itemCount: unknown,
  direction: "up" | "down",
): number;

export function resolvePaletteKeyAction(
  event: {
    key?: string;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
  },
  state?: { index?: number; itemCount?: number },
): { type: "none" | "move" | "run"; index?: number };
