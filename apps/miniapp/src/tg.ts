import { parseStartParam } from '@vitrina/core/store';

/** Тонкая обёртка над Telegram WebApp SDK с запасными вариантами для обычного браузера */

type Haptic = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

interface TgButton {
  setParams(p: Record<string, unknown>): void;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; username?: string; first_name?: string }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  isFullscreen?: boolean;
  onEvent(e: string, cb: () => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  requestWriteAccess(cb?: (ok: boolean) => void): void;
  showAlert(msg: string, cb?: () => void): void;
  MainButton: TgButton;
  /** Bot API 7.10 */
  SecondaryButton?: TgButton;
  BackButton: TgButton;
  HapticFeedback: {
    impactOccurred(s: Haptic): void;
    selectionChanged(): void;
    notificationOccurred(t: 'success' | 'warning' | 'error'): void;
  };
}

const w = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

/** Внутри Telegram ли мы (в браузере SDK загружен, но initData пустой) */
export const inTelegram = !!w?.initData;
export const tg = w;
export const initData = w?.initData ?? '';
const query = new URLSearchParams(location.search);
const start = parseStartParam(w?.initDataUnsafe.start_param);
/** Магазин (нужен демо-деплою, где на одном боте много магазинов) и карточка, с которой открыли мини-апп */
export const storeId = start.store ?? query.get('s') ?? '';
export const startListing = start.listing ?? (Number(query.get('l')) || null);
export const supports = (v: string) => !!w && inTelegram && w.isVersionAtLeast(v);

export function initTelegram() {
  if (!w || !inTelegram) return;
  w.ready();
  w.expand();
  if (supports('7.7')) w.disableVerticalSwipes?.();
  // во весь экран на телефонах; на десктопе Telegram это окно на весь монитор — там не нужно
  if (supports('8.0') && ['ios', 'android', 'android_x'].includes(w.platform)) w.requestFullscreen?.();
}

/** Шапка и нижняя панель Telegram — в цвет фона витрины, а не темы Telegram */
export function paintChrome(bg: string) {
  if (!w || !supports('6.1')) return;
  w.setHeaderColor(bg);
  w.setBackgroundColor(bg);
  if (supports('7.10')) w.setBottomBarColor?.(bg);
}

export const haptic = {
  tap: () => supports('6.1') && w!.HapticFeedback.impactOccurred('light'),
  select: () => supports('6.1') && w!.HapticFeedback.selectionChanged(),
  success: () => supports('6.1') && w!.HapticFeedback.notificationOccurred('success'),
  medium: () => supports('6.1') && w!.HapticFeedback.impactOccurred('medium'),
};

export function openTgLink(url: string) {
  if (inTelegram) w!.openTelegramLink(url);
  else window.open(url, '_blank');
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!supports('6.9')) return resolve(true);
    w!.requestWriteAccess((ok) => resolve(ok));
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * Стек вложенных «назад»: полноэкранная галерея, лист и т. п. регистрируют сюда закрытие,
 * и кнопка «Назад» Telegram сначала закрывает самый верхний слой.
 */
const backStack: (() => void)[] = [];
export function pushBack(fn: () => void) {
  backStack.push(fn);
  return () => {
    const i = backStack.lastIndexOf(fn);
    if (i >= 0) backStack.splice(i, 1);
  };
}
export function popBack(): boolean {
  const fn = backStack.pop();
  if (!fn) return false;
  fn();
  return true;
}
