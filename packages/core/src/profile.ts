/**
 * Профиль разбора — всё, чем шаблон постов одного продавца отличается от других.
 * Хранится как данные (clients/<slug>/profile.json или строка в D1 у демо), код движка общий.
 */
export interface ParseProfile {
  version: 1;
  /**
   * active_marker — товар в наличии, только если в посте есть метка из activeMarkers (как #АКТУАЛЬНО_RaXi);
   * unless_sold — любой пост с моделью и ценой в наличии, пока не появилась метка из soldMarkers.
   */
  mode: 'active_marker' | 'unless_sold';
  activeMarkers: string[];
  soldMarkers: string[];
  reservedMarkers: string[];
  /** Посты с этими метками — не объявления (отзывы, розыгрыши, график работы) */
  ignoreMarkers: string[];
  /** Метка строки с ценой: 💰, «Цена:» */
  priceMarkers: string[];
  plusMarkers: string[];
  nuanceMarkers: string[];
  /** Подпись строки состояния: «Состояние:» */
  conditionLabels: string[];
  /** Бренд по умолчанию: у магазина только айфоны — «15 Pro» без слова iPhone тоже айфон */
  defaultBrand?: string;
  /** Ниже этой уверенности карточка ждёт подтверждения продавца */
  threshold: number;
  /**
   * Только для unless_sold: объявление старше стольких дней считается неактуальным.
   * Продавцы без отметок «продано» просто перестают упоминать товар; 0 — не устаревает.
   */
  staleDays: number;
}

export const DEFAULT_PROFILE: ParseProfile = {
  version: 1,
  mode: 'unless_sold',
  activeMarkers: ['в наличии', 'актуально'],
  soldMarkers: ['продано', 'продан', 'продана', 'sold'],
  reservedMarkers: ['бронь', 'забронирован', 'забронировано', 'резерв'],
  ignoreMarkers: ['#отзыв', 'розыгрыш', 'конкурс'],
  priceMarkers: ['💰', 'цена', 'стоимость'],
  plusMarkers: ['✅', '☑', '✔', '➕', '🟢'],
  nuanceMarkers: ['✖', '❌', '⚠', '❗', '➖', '🔴'],
  conditionLabels: ['состояние', 'condition'],
  threshold: 0.75,
  staleDays: 60,
};

export function resolveProfile(p: Partial<ParseProfile> | null | undefined): ParseProfile {
  return { ...DEFAULT_PROFILE, ...(p ?? {}), version: 1 };
}

/** Убираем вариационный селектор: «✖️» и «✖» — одна метка */
export const stripVS = (s: string) => s.replace(/️/g, '');

/**
 * Метка — подстрока без учёта регистра или регулярка в виде `/…/флаги`.
 * Возвращает функцию-проверку для строки или всего текста.
 */
export function markerTest(markers: string[]): (s: string) => boolean {
  const tests = markers.map((m) => {
    const re = m.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
      const r = new RegExp(re[1], re[2].includes('u') ? re[2] : re[2] + 'u');
      return (s: string) => r.test(s);
    }
    const needle = stripVS(m).toLowerCase();
    return (s: string) => s.toLowerCase().includes(needle);
  });
  return (s) => tests.some((t) => t(s));
}

/** Где кончается первая найденная метка в строке; -1 — метки нет */
export function markerEnd(line: string, markers: string[]): number {
  const low = line.toLowerCase();
  let best = -1;
  for (const m of markers) {
    const re = m.match(/^\/(.+)\/([a-z]*)$/);
    let end = -1;
    if (re) {
      const r = new RegExp(re[1], re[2].replace('g', '') + (re[2].includes('u') ? '' : 'u')).exec(line);
      if (r) end = r.index + r[0].length;
    } else {
      const needle = stripVS(m).toLowerCase();
      const i = low.indexOf(needle);
      if (i >= 0) end = i + needle.length;
    }
    if (end >= 0 && (best < 0 || end < best)) best = end;
  }
  return best;
}

/** Метка в начале строки (плюсы и нюансы). Возвращает строку без метки или null */
export function leadingMarker(line: string, markers: string[]): string | null {
  const t = line.trimStart();
  for (const m of markers) {
    const mk = stripVS(m);
    if (t.startsWith(mk)) return t.slice(mk.length).trim();
  }
  return null;
}
