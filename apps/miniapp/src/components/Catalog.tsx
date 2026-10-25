import type { Facets, Listing } from '@vitrina/core/types';
import { applyFilters, plural, sheetCount, SORT_LABELS, type Filters, type Sort } from '../filters';
import { haptic } from '../tg';
import { IconChevronDown, IconFilter } from '../icons';
import { Emoji } from './Emoji';
import { Card, CardSkeleton } from './Card';

interface Props {
  items: Listing[] | null;
  facets: Facets | null;
  filters: Filters;
  setFilters: (f: Filters) => void;
  storeName: string;
  error: boolean;
  onOpen: (l: Listing) => void;
  onOpenFilters: () => void;
  onSubscribe: (family: string | null) => void;
  onRetry: () => void;
}

export function Catalog({ items, facets, filters, setFilters, storeName, error, onOpen, onOpenFilters, onSubscribe, onRetry }: Props) {
  const total = items?.length ?? facets?.total ?? 0;
  const shown = items ? applyFilters(items, filters) : null;
  const families = facets?.families ?? [];
  const nSheet = sheetCount(filters);

  const pickFamily = (family: string | null) => {
    haptic.select();
    setFilters({ ...filters, family });
  };

  return (
    <div class="screen catalog">
      <header class="topbar glass">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span>R</span>
          </div>
          <div class="brand-text">
            <div class="brand-name">{storeName}</div>
            <div class="brand-sub">
              <span class="live-dot" />
              {items || facets ? `В наличии: ${total}` : 'Загружаем…'}
            </div>
          </div>
          <button class="icon-btn glass-btn" onClick={() => (haptic.tap(), onOpenFilters())} aria-label="Фильтры">
            <IconFilter />
            {nSheet > 0 && <span class="icon-badge">{nSheet}</span>}
          </button>
        </div>
        <div class="chips" role="tablist">
          <button class={`chip ${filters.family === null ? 'on' : ''}`} onClick={() => pickFamily(null)}>
            Все
          </button>
          {families.map((f) => (
            <button key={f.family} class={`chip ${filters.family === f.family ? 'on' : ''}`} onClick={() => pickFamily(f.family)}>
              {f.family}
              <span class="chip-count">{f.count}</span>
            </button>
          ))}
        </div>
      </header>

      <div class="toolbar">
        <div class="toolbar-count">
          {shown ? `${shown.length} ${plural(shown.length, 'телефон', 'телефона', 'телефонов')}` : ' '}
        </div>
        <label class="sort">
          {SORT_LABELS[filters.sort]}
          <IconChevronDown size={16} />
          <select
            value={filters.sort}
            onChange={(e) => (haptic.select(), setFilters({ ...filters, sort: e.currentTarget.value as Sort }))}
            aria-label="Сортировка"
          >
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option value={k}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      {error && !items ? (
        <div class="empty">
          <Emoji name="retry" size={64} class="empty-emoji" />
          <div class="empty-title">Не удалось загрузить каталог</div>
          <div class="empty-text">Проверьте интернет и попробуйте ещё раз</div>
          <button class="btn-primary" onClick={onRetry}>
            Обновить
          </button>
        </div>
      ) : !shown ? (
        <div class="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div class="empty">
          <Emoji name="search" size={64} class="empty-emoji" />
          <div class="empty-title">Под фильтры ничего нет</div>
          <div class="empty-text">Сбросьте фильтры или подпишитесь — пришлём, как только появится</div>
          <div class="empty-actions">
            <button class="btn-secondary" onClick={() => (haptic.tap(), setFilters({ ...filters, family: null, storages: [], priceMin: null, priceMax: null, batteryMin: null, conditions: [], sim: 'any' }))}>
              Сбросить
            </button>
            <button class="btn-primary" onClick={() => onSubscribe(filters.family)}>
              Подписаться на такую модель
            </button>
          </div>
        </div>
      ) : (
        <div class="grid">
          {shown.map((l, i) => (
            <Card key={l.id} l={l} index={i} onOpen={onOpen} />
          ))}
        </div>
      )}

      {shown && shown.length > 0 && (
        <button class="promo" onClick={() => (haptic.tap(), onSubscribe(filters.family))}>
          <div class="promo-icon">
            <Emoji name="bell" size={30} />
          </div>
          <div class="promo-text">
            <b>Нет нужной модели?</b>
            <span>Сообщу, когда появится</span>
          </div>
        </button>
      )}
    </div>
  );
}
