import { useEffect, useState } from 'preact/hooks';
import type { Listing } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { applyFilters, EMPTY, SORT_LABELS, type Filters, type Sort } from '../filters';
import { haptic } from '../tg';
import { IconClose } from '../icons';

interface Props {
  open: boolean;
  /** Товары выбранной категории — фильтры показываются только те, что к ним применимы */
  items: Listing[];
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
}

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const STEP = 1000;
const uniq = <T,>(xs: (T | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== undefined))];

export function FilterSheet({ open, items, filters, onApply, onClose }: Props) {
  const [f, setF] = useState(filters);
  useEffect(() => {
    if (open) setF(filters);
  }, [open]);

  const prices = items.map((l) => l.price).filter((p): p is number => !!p);
  const lo = prices.length ? Math.floor(Math.min(...prices) / STEP) * STEP : 0;
  const hi = prices.length ? Math.ceil(Math.max(...prices) / STEP) * STEP : STEP;
  const pMin = f.priceMin ?? lo;
  const pMax = f.priceMax ?? hi;
  const storages = uniq(items.map((l) => l.attrs.storage_gb)).sort((a, b) => a - b);
  const conditions = uniq(items.map((l) => l.attrs.condition));
  const hasBattery = items.some((l) => l.attrs.battery_pct !== undefined);
  const hasSim = items.some((l) => l.attrs.physical_sim !== undefined);
  const count = applyFilters(items, f).length;
  const set = (patch: Partial<Filters>) => (haptic.select(), setF({ ...f, ...patch }));
  const pct = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;

  return (
    <div class={`sheet-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class="sheet" role="dialog" aria-label="Фильтры">
        <div class="sheet-grabber" />
        <div class="sheet-head">
          <h2 class="h2">Фильтры</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </div>

        <div class="sheet-scroll">
          <section class="fs">
            <h3>Порядок</h3>
            <div class="chips wrap">
              {(Object.keys(SORT_LABELS) as Sort[])
                .filter((s) => s !== 'battery' || hasBattery)
                .map((s) => (
                  <button class={`chip ${f.sort === s ? 'on' : ''}`} onClick={() => set({ sort: s })}>
                    {SORT_LABELS[s]}
                  </button>
                ))}
            </div>
          </section>

          {storages.length > 1 && (
            <section class="fs">
              <h3>Память</h3>
              <div class="chips wrap">
                {storages.map((gb) => (
                  <button class={`chip ${f.storages.includes(gb) ? 'on' : ''}`} onClick={() => set({ storages: toggle(f.storages, gb) })}>
                    {formatStorage(gb)}
                  </button>
                ))}
              </div>
            </section>
          )}

          {hi - lo > STEP && (
            <section class="fs">
              <h3>
                Цена
                <span class="muted">
                  {formatPrice(pMin)} — {formatPrice(pMax)}
                </span>
              </h3>
              <div class="range">
                <div class="range-track">
                  <i style={{ left: `${pct(pMin)}%`, right: `${100 - pct(pMax)}%` }} />
                </div>
                <input
                  type="range" min={lo} max={hi} step={STEP} value={pMin} aria-label="Цена от"
                  onInput={(e) => {
                    const v = Math.min(+e.currentTarget.value, pMax - STEP);
                    setF({ ...f, priceMin: v <= lo ? null : v });
                  }}
                />
                <input
                  type="range" min={lo} max={hi} step={STEP} value={pMax} aria-label="Цена до"
                  onInput={(e) => {
                    const v = Math.max(+e.currentTarget.value, pMin + STEP);
                    setF({ ...f, priceMax: v >= hi ? null : v });
                  }}
                />
              </div>
            </section>
          )}

          {hasBattery && (
            <section class="fs">
              <h3>Аккумулятор от</h3>
              <div class="seg">
                {[null, 80, 85, 90, 95].map((b) => (
                  <button class={f.batteryMin === b ? 'on' : ''} onClick={() => set({ batteryMin: b })}>
                    {b ? `${b}%` : 'Любой'}
                  </button>
                ))}
              </div>
            </section>
          )}

          {conditions.length > 1 && (
            <section class="fs">
              <h3>Состояние</h3>
              <div class="chips wrap">
                {conditions.map((c) => (
                  <button class={`chip ${f.conditions.includes(c) ? 'on' : ''}`} onClick={() => set({ conditions: toggle(f.conditions, c) })}>
                    {c}
                  </button>
                ))}
              </div>
            </section>
          )}

          {hasSim && (
            <section class="fs">
              <h3>SIM</h3>
              <div class="seg">
                {([
                  ['any', 'Любая'],
                  ['physical', 'Физическая'],
                  ['esim', 'Только eSIM'],
                ] as const).map(([k, label]) => (
                  <button class={f.sim === k ? 'on' : ''} onClick={() => set({ sim: k })}>
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div class="sheet-foot">
          <button class="btn ghost" onClick={() => set({ ...EMPTY, category: f.category, model_id: f.model_id })}>
            Сбросить
          </button>
          <button class="btn primary" style={{ flexGrow: 1 }} onClick={() => (haptic.tap(), onApply(f))} disabled={!count}>
            {count ? `Показать ${count}` : 'Ничего не найдено'}
          </button>
        </div>
      </div>
    </div>
  );
}
