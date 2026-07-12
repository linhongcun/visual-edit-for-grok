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

export function normalizeUrlInputValue(value: unknown): string;
