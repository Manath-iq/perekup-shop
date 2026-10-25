/** Набор иконок одной толщины линии (1.75), в стиле SF Symbols */
type P = { size?: number };
const S = ({ size = 20, children }: P & { children: preact.ComponentChildren }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconFilter = (p: P) => (
  <S {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </S>
);
export const IconCheck = (p: P) => (
  <S {...p}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </S>
);
export const IconInfo = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.6v.1" />
  </S>
);
export const IconBell = (p: P) => (
  <S {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />
  </S>
);
export const IconGrid = (p: P) => (
  <S {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </S>
);
export const IconStore = (p: P) => (
  <S {...p}>
    <path d="M4 9.5L5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5 12v8h14v-8M10 20v-4.5h4V20" />
  </S>
);
export const IconChevron = (p: P) => (
  <S {...p}>
    <path d="M9 6l6 6-6 6" />
  </S>
);
export const IconChevronDown = (p: P) => (
  <S {...p}>
    <path d="M7 10l5 5 5-5" />
  </S>
);
export const IconShare = (p: P) => (
  <S {...p}>
    <path d="M12 15V4M8 7.5L12 4l4 3.5M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
  </S>
);
export const IconPaper = (p: P) => (
  <S {...p}>
    <path d="M21 4L3 11l6.5 2.5M21 4l-3 16-8.5-6.5M21 4L9.5 13.5V19l3-3" />
  </S>
);
export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />
  </S>
);
export const IconPlay = (p: P) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);
export const IconBattery = (p: P) => (
  <S {...p}>
    <rect x="3" y="7.5" width="16" height="9" rx="2.5" />
    <path d="M21.5 11v2" />
  </S>
);
