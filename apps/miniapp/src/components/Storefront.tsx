import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Facets, Listing } from '@vitrina/core/types';
import { formatPrice } from '@vitrina/core/format';
import { isEmptyQuery, matchesQuery, nearest, parseQuery, queryChips, withoutChip, type SearchQuery } from '@vitrina/core/search';
import type { StoreInfo } from '../api';
import { api } from '../api';
import { ago, applyFilters, cardMeta, initials, plural, sheetCount, sortItems, SORT_LABELS, type Filters } from '../filters';
import { haptic } from '../tg';
import { IconBack, IconBell, IconChevronDown, IconClose, IconFilter, IconSearch } from '../icons';
import { Card, CardSkeleton } from './Card';
import { Emoji } from './Emoji';

interface Props {
  items: Listing[] | null;
  facets: Facets | null;
  store: StoreInfo | null;
  filters: Filters;
  setFilters: (f: Filters) => void;
  error: boolean;
  onRetry: () => void;
  onOpen: (l: Listing) => void;
  onOpenFilters: () => void;
  onSubscribe: (q: SearchQuery) => void;
  onGoSubs: () => void;
}

const HINTS = ['15 про 256', 'до 50к акб 90', 'айфон 13 мини', 'полный комплект'];

export function Storefront(p: Props) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  // чипы снимаются по одному: правка поверх разобранного текста, сбрасывается при новом вводе
  const [override, setOverride] = useState<SearchQuery | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const searching = focused || text.trim() !== '';
  const parsed = useMemo(() => parseQuery(text, { defaultBrand: p.store?.default_brand ?? undefined }), [text, p.store?.default_brand]);
  const q = override ?? parsed;

  const onInput = (v: string) => {
    setText(v);
    setOverride(null);
  };
  const exitSearch = () => {
    setText('');
    setOverride(null);
    setFocused(false);
    input.current?.blur();
  };

  return (
    <div class="page">
      <div class="glow" aria-hidden="true" />
      {!searching && <Header {...p} />}
      {/* одно и то же поле в обоих режимах: Preact сохраняет элемент, фокус и клавиатура не теряются */}
      <div class="row" style={{ position: 'relative', marginTop: searching ? 0 : '-8px' }}>
        {searching && (
          <button class="icon-btn" aria-label="Назад к витрине" onClick={exitSearch}>
            <IconBack />
          </button>
        )}
        <SearchField inputRef={input} text={text} active={searching} onInput={onInput} onFocus={() => setFocused(true)} onClear={() => (onInput(''), input.current?.focus())} />
      </div>

      {searching ? (
        <SearchResults
          q={q}
          items={p.items ?? []}
          onOpen={p.onOpen}
          onHint={(h) => (onInput(h), input.current?.focus())}
          onEdit={(next) => setOverride(next)}
          onSubscribe={p.onSubscribe}
          onReset={() => (onInput(''), input.current?.focus())}
        />
      ) : (
        <Catalog {...p} />
      )}
    </div>
  );
}

function SearchField(props: {
  inputRef: preact.Ref<HTMLInputElement>;
  text: string;
  active?: boolean;
  onInput: (v: string) => void;
  onFocus: () => void;
  onClear?: () => void;
}) {
  return (
    <label class={`search ${props.active ? 'active' : ''}`}>
      <IconSearch size={20} />
      <span class="sr">Поиск по каталогу</span>
      <input
        ref={props.inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Например: 15 про 256 до 60к"
        value={props.text}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onFocus={props.onFocus}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {props.text && props.onClear && (
        <button type="button" class="clear" aria-label="Очистить поиск" onClick={props.onClear}>
          <IconClose size={16} />
        </button>
      )}
    </label>
  );
}

function Header({ store, facets, onGoSubs }: Props) {
  const total = facets?.total ?? null;
  return (
    <div class="stack">
      <div class="row">
        <div class="avatar">{store?.avatar ? <img src={store.avatar} alt="" /> : initials(store?.name ?? '…')}</div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div class="store-name">{store?.name ?? ' '}</div>
          <div class="muted" style={{ fontSize: '13px' }}>
            {store ? ['@' + store.channel, store.about.city].filter(Boolean).join(' · ') : ' '}
          </div>
        </div>
        <button class="icon-btn" aria-label="Подписки на модели" onClick={onGoSubs}>
          <IconBell />
        </button>
      </div>

      <div class="live">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span class="live-count">{total ?? '–'}</span>
            <span class="live-caption">
              в наличии
              <br />
              прямо сейчас
            </span>
          </div>
          <div class="row muted" style={{ gap: '7px', fontSize: '13px' }}>
            <span class="pulse" aria-hidden="true" />
            {facets?.synced_at ? `сверено с каналом ${ago(facets.synced_at)}` : 'сверяется с каналом'}
          </div>
        </div>
        {!!facets?.price_min && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <span class="muted" style={{ fontSize: '12px' }}>цены</span>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>от {formatPrice(facets.price_min)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Catalog({ items, facets, filters, setFilters, error, onRetry, onOpen, onOpenFilters }: Props) {
  const set = (patch: Partial<Filters>) => (haptic.select(), setFilters({ ...filters, ...patch }), window.scrollTo({ top: 0, behavior: 'smooth' }));
  const models = (facets?.models ?? []).filter((m) => !filters.category || m.category === filters.category);
  const shown = items ? applyFilters(items, filters) : null;
  const nFilters = sheetCount(filters);

  if (error)
    return (
      <div class="panel empty">
        <Emoji name="retry" size={56} />
        <h3>Не загрузилось</h3>
        <p>Проверьте интернет и попробуйте ещё раз.</p>
        <button class="btn primary block" onClick={onRetry}>
          Обновить
        </button>
      </div>
    );

  if (facets && facets.total === 0)
    return (
      <div class="panel empty">
        <Emoji name="shrug" size={56} />
        <h3>Сейчас всё раскупили</h3>
        <p>Новые товары появятся здесь сразу после поста в канале. Найдите модель через поиск — напишем, когда она будет.</p>
      </div>
    );

  return (
    <>
      {(facets?.categories.length ?? 0) > 0 && (
        <div class="chips" style={{ marginTop: '-8px' }}>
          <button class={`chip ${!filters.category ? 'on' : ''}`} onClick={() => set({ category: null, model_id: null })}>
            Все · {facets!.total}
          </button>
          {facets!.categories.map((c) => (
            <button class={`chip ${filters.category === c.category ? 'on' : ''}`} onClick={() => set({ category: c.category, model_id: null })}>
              {c.title} · {c.count}
            </button>
          ))}
        </div>
      )}

      {models.length > 1 && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="label">Модели</div>
          <div class="rail">
            {models.map((m) => (
              <button class={`model ${filters.model_id === m.model_id ? 'on' : ''}`} aria-pressed={filters.model_id === m.model_id} onClick={() => set({ model_id: filters.model_id === m.model_id ? null : m.model_id })}>
                <span class="between" style={{ width: '100%' }}>
                  <span class="model-line">{m.line}</span>
                  <span class="model-count">{m.count}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                  <span class="model-short">{m.short || m.line}</span>
                  {m.min_price && <span class="muted" style={{ fontSize: '13px' }}>от {formatPrice(m.min_price)}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div class="stack" style={{ gap: '14px' }}>
        <div class="between">
          <div class="label">{shown ? `В наличии · ${shown.length}` : 'В наличии'}</div>
          <button class="row" style={{ gap: '6px', height: '36px', fontSize: '14px' }} onClick={onOpenFilters}>
            {nFilters ? <IconFilter size={18} /> : null}
            {nFilters ? `Фильтры · ${nFilters}` : SORT_LABELS[filters.sort]}
            <IconChevronDown size={16} />
          </button>
        </div>

        {shown && shown.length === 0 ? (
          <div class="panel empty">
            <Emoji name="search" size={52} />
            <h3>Под фильтры ничего нет</h3>
            <p>Попробуйте ослабить условия — например, память или АКБ.</p>
            <button class="btn ghost block" onClick={() => setFilters({ ...filters, storages: [], priceMin: null, priceMax: null, batteryMin: null, conditions: [], sim: 'any' })}>
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div class="grid">
            {shown ? shown.map((l, i) => <Card key={l.id} l={l} index={i} onOpen={onOpen} />) : [0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}
          </div>
        )}
      </div>
    </>
  );
}

function SearchResults({
  q,
  items,
  onOpen,
  onHint,
  onEdit,
  onSubscribe,
  onReset,
}: {
  q: SearchQuery;
  items: Listing[];
  onOpen: (l: Listing) => void;
  onHint: (h: string) => void;
  onEdit: (q: SearchQuery) => void;
  onSubscribe: (q: SearchQuery) => void;
  onReset: () => void;
}) {
  const empty = isEmptyQuery(q);
  const found = empty ? [] : sortItems(items.filter((l) => matchesQuery(l, q)), 'new');
  const near = !empty && !found.length ? nearest(items, q) : null;
  const chips = queryChips(q);

  // поиск конкретной модели — это спрос: продавец увидит в кабинете то, что ищут и не находят
  const logged = useRef(new Set<string>());
  useEffect(() => {
    if (!q.model) return;
    const key = JSON.stringify([q.model.id, q.storage_gb, q.price_max]);
    const t = setTimeout(() => {
      if (logged.current.has(key)) return;
      logged.current.add(key);
      api.event('search', { model_id: q.model!.id, meta: { title: q.model!.title, storage_gb: q.storage_gb ?? null, price_max: q.price_max ?? null, results: found.length } });
    }, 1500);
    return () => clearTimeout(t);
  }, [q.model?.id, q.storage_gb, q.price_max, found.length]);

  if (empty)
    return (
      <div class="stack" style={{ gap: '10px' }}>
        <div class="muted" style={{ fontSize: '13px' }}>
          Пишите как привыкли — поймём модель, память, цену и АКБ
        </div>
        <div class="chips wrap">
          {HINTS.map((h) => (
            <button class="chip" onClick={() => onHint(h)}>
              {h}
            </button>
          ))}
        </div>
      </div>
    );

  const toggle = (key: 'battery_min' | 'physical_sim' | 'full_kit', value: number | boolean) =>
    onEdit(q[key] ? withoutChip(q, key) : { ...q, [key]: value });
  const desc = [q.model?.title, q.storage_gb && `на ${q.storage_gb >= 1024 ? q.storage_gb / 1024 + ' ТБ' : q.storage_gb + ' ГБ'}`, q.price_max && `до ${formatPrice(q.price_max)}`]
    .filter(Boolean)
    .join(' ')
    // «256 ГБ» и «60 000 ₽» не разрываем переносом
    .replace(/(\d) (?=[\dГТ₽])/g, '$1\u00a0')
    .replace(/(на|до) /g, '$1\u00a0');

  return (
    <>
      {chips.length > 0 && (
        <div class="stack" style={{ gap: '10px' }}>
          <div class="muted" style={{ fontSize: '13px' }}>Поняли так</div>
          <div class="chips wrap">
            {chips.map((c) => (
              <button class="chip soft" aria-label={`Убрать: ${c.label}`} onClick={() => (haptic.select(), onEdit(withoutChip(q, c.key)))}>
                {c.label}
                <IconClose size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      {found.length > 0 ? (
        <div class="stack" style={{ gap: '14px' }}>
          <div class="label">
            Нашли {found.length} {plural(found.length, 'товар', 'товара', 'товаров')}
          </div>
          <div class="grid">
            {found.map((l, i) => (
              <Card key={l.id} l={l} index={i} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ) : q.model ? (
        <div class="panel empty">
          <div class="empty-icon">
            <IconBell size={30} />
          </div>
          <h3>Такого сейчас нет</h3>
          <p>Напишем в Telegram, как только в канале появится {desc}.</p>
          <button class="btn primary block" style={{ marginTop: '6px' }} onClick={() => (haptic.tap(), onSubscribe(q))}>
            Сообщить, когда появится
          </button>
          <div class="muted" style={{ fontSize: '12px' }}>
            Продавец увидит, что такую модель ищут
          </div>
        </div>
      ) : (
        <div class="panel empty">
          <Emoji name="search" size={52} />
          <h3>Ничего не нашли</h3>
          <p>Попробуйте написать модель: «14 Pro», «S24 Ultra», «AirPods Pro 2».</p>
          <button class="btn ghost block" onClick={onReset}>
            Новый поиск
          </button>
        </div>
      )}

      {near && (
        <div class="stack" style={{ gap: '10px' }}>
          <div class="label">Ближе всего из наличия</div>
          <button class="panel near" onClick={() => onOpen(near.item)}>
            {near.item.cover ? <img class="near-photo" src={near.item.cover} alt="" /> : <span class="near-photo" />}
            <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontSize: '16px', fontWeight: 600 }}>{near.item.title}</span>
              <span class="muted" style={{ fontSize: '13px' }}>
                {[cardMeta(near.item), near.item.attrs.battery_pct && `АКБ ${near.item.attrs.battery_pct}%`].filter(Boolean).join(' · ')}
              </span>
              <span class="price" style={{ marginTop: 0 }}>{near.item.price ? formatPrice(near.item.price) : ''}</span>
              {near.diff && (
                <span class="tag warn sm" style={{ alignSelf: 'flex-start' }}>
                  {near.diff}
                </span>
              )}
            </span>
          </button>
        </div>
      )}

      <div class="stack" style={{ gap: '10px' }}>
        <div class="muted" style={{ fontSize: '13px' }}>Можно уточнить</div>
        <div class="chips wrap">
          <button class={`chip ${q.battery_min ? 'on' : ''}`} onClick={() => toggle('battery_min', 90)}>
            АКБ от 90%
          </button>
          <button class={`chip ${q.physical_sim ? 'on' : ''}`} onClick={() => toggle('physical_sim', true)}>
            С физической SIM
          </button>
          <button class={`chip ${q.full_kit ? 'on' : ''}`} onClick={() => toggle('full_kit', true)}>
            Полный комплект
          </button>
        </div>
      </div>
    </>
  );
}
