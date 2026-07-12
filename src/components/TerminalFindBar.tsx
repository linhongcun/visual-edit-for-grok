import { useEffect, useRef } from "react";
import { resolveFocusedChromeEscape } from "../input-chrome.cjs";

export interface TerminalFindBarProps {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  resultIndex: number;
  resultCount: number;
  /** When true, Esc cancels Aim instead of closing find */
  pickMode?: boolean;
  onQueryChange: (query: string) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  /** Cancel Aim pick mode (used when Esc priority is aim-cancel) */
  onAimCancel?: () => void;
  labels: {
    placeholder: string;
    next: string;
    prev: string;
    close: string;
    caseSensitive: string;
    noResults: string;
    results: string;
    clear?: string;
  };
}

/**
 * Compact find bar for the active terminal tab (Warp-inspired chrome input).
 */
export default function TerminalFindBar({
  open,
  query,
  caseSensitive,
  resultIndex,
  resultCount,
  pickMode = false,
  onQueryChange,
  onCaseSensitiveChange,
  onFindNext,
  onFindPrevious,
  onClose,
  onAimCancel,
  labels,
}: TerminalFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  const status =
    !query.trim()
      ? ""
      : resultCount <= 0
        ? labels.noResults
        : labels.results
            .replace("{index}", String(resultIndex + 1))
            .replace("{count}", String(resultCount));

  return (
    <div
      className="term-find-bar"
      role="search"
      aria-label={labels.placeholder}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Aim pickMode always wins over close-find (shared escape policy).
          const action = resolveFocusedChromeEscape("find", pickMode);
          e.preventDefault();
          e.stopPropagation();
          if (action === "aim-cancel") {
            onAimCancel?.();
            return;
          }
          onClose();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) onFindPrevious();
          else onFindNext();
        }
      }}
    >
      <div className="term-find-field chrome-field is-focused">
        <input
          ref={inputRef}
          className="term-find-input"
          type="search"
          value={query}
          placeholder={labels.placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          enterKeyHint="search"
          aria-label={labels.placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="icon-btn url-clear-btn"
            title={labels.clear || labels.close}
            aria-label={labels.clear || labels.close}
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <label className="term-find-case" title={labels.caseSensitive}>
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => onCaseSensitiveChange(e.target.checked)}
        />
        <span>Aa</span>
      </label>
      <span className="term-find-status" aria-live="polite">
        {status}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={onFindPrevious}
        title={labels.prev}
        aria-label={labels.prev}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={onFindNext}
        title={labels.next}
        aria-label={labels.next}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={onClose}
        title={labels.close}
        aria-label={labels.close}
      >
        ×
      </button>
    </div>
  );
}
