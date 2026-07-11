/** Consistent 24×24 outline icons (stroke 1.75) — no emoji. */

type IconProps = { className?: string; title?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function IconCrosshair(_p: IconProps) {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function IconFolder(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

export function IconPlay(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M8 5v14l11-7L8 5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCamera(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function IconSend(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M4 12h12M12 6l6 6-6 6" />
    </svg>
  );
}

export function IconChevronLeft(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconRefresh(_p: IconProps) {
  return (
    <svg {...base}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function IconMark(_p: IconProps) {
  return (
    <svg {...base} width={16} height={16}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

/** Collapse right preview pane (panel to the right) */
export function IconPanelCollapse(_p: IconProps) {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      <path d="M10 9l-3 3 3 3" />
    </svg>
  );
}

/** Expand / show right preview pane */
export function IconPanelExpand(_p: IconProps) {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      <path d="M8 9l3 3-3 3" />
    </svg>
  );
}
