/** Иконки одной толщины линии, как в макетах */
type P = { size?: number; stroke?: number };
const S = ({ size = 20, stroke = 1.8, children }: P & { children: preact.ComponentChildren }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconSearch = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </S>
);
export const IconBell = (p: P) => (
  <S {...p}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
  </S>
);
export const IconGrid = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </S>
);
export const IconStore = (p: P) => (
  <S {...p}>
    <path d="M4 10 5.5 4h13L20 10" />
    <path d="M4 10v10h16V10" />
    <path d="M4 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3" />
  </S>
);
export const IconChart = (p: P) => (
  <S {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </S>
);
export const IconBack = (p: P) => (
  <S stroke={2} {...p}>
    <path d="m15 18-6-6 6-6" />
  </S>
);
export const IconClose = (p: P) => (
  <S stroke={2.2} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </S>
);
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </svg>
);
export const IconShare = (p: P) => (
  <S {...p}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </S>
);
export const IconCheck = (p: P) => (
  <S stroke={2.2} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </S>
);
export const IconAlert = (p: P) => (
  <S stroke={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </S>
);
export const IconPlay = (p: P) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5Z" />
  </svg>
);
export const IconChevronDown = (p: P) => (
  <S stroke={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </S>
);
export const IconChevron = (p: P) => (
  <S stroke={2} {...p}>
    <path d="m9 6 6 6-6 6" />
  </S>
);
export const IconFilter = (p: P) => (
  <S {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </S>
);
export const IconChat = (p: P) => (
  <S {...p}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />
  </S>
);
export const IconPin = (p: P) => (
  <S {...p}>
    <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" />
    <circle cx="12" cy="9" r="2.5" />
  </S>
);
export const IconTruck = (p: P) => (
  <S {...p}>
    <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17.5" cy="17.5" r="1.8" />
  </S>
);
export const IconShield = (p: P) => (
  <S {...p}>
    <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </S>
);
export const IconWallet = (p: P) => (
  <S {...p}>
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M3 10h18M16 15h2" />
  </S>
);
export const IconExternal = (p: P) => (
  <S {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
  </S>
);
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </S>
);
