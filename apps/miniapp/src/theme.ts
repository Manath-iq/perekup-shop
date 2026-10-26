import { paintChrome } from './tg';

const HEX = /^#([0-9a-f]{6})$/i;

/** Относительная яркость по WCAG — чтобы текст на акцентной кнопке читался при любом цвете магазина */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Акцент магазина из client.jsonc: кнопки, выбранные чипы, свечение в шапке */
export function applyAccent(hex: string | undefined) {
  if (!hex || !HEX.test(hex)) return;
  const root = document.documentElement.style;
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)).join(', ');
  root.setProperty('--accent', hex);
  root.setProperty('--accent-rgb', rgb);
  // тёмный текст на светлом акценте, белый — на тёмном: что даёт контраст больше
  const l = luminance(hex);
  const dark = (l + 0.05) / (luminance('#140a05') + 0.05);
  const light = 1.05 / (l + 0.05);
  root.setProperty('--on-accent', dark >= light ? '#140a05' : '#ffffff');
}

/** Шапка и фон Telegram — в цвет текущей темы витрины */
export function syncChrome() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) paintChrome(bg);
}
