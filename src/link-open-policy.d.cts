export function preferSystemBrowserForLinkClick(
  event:
    | {
        metaKey?: boolean;
        ctrlKey?: boolean;
        getModifierState?: (key: string) => boolean;
      }
    | null
    | undefined,
): boolean;

export function isHttpUrl(uri: string): boolean;

export function resolveTerminalLinkTarget(
  uri: string,
  event?: object | null,
): "preview" | "system" | "none";
