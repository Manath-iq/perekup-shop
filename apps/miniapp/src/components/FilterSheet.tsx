import { useEffect, useState } from 'preact/hooks';
import type { Facets, Listing } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { applyFilters, EMPTY, type Filters } from '../filters';
import { haptic } from '../tg';
import { IconClose } from '../icons';

interface Props {
  open: boolean;
  items: Listing[];
  facets: Facets | null;
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
}

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const STEP = 1000;

export function FilterSheet({ open, items, facets, filters, onApply, onClose }: Props) {
  const [f, setF] = useState(filters);
  useEffect(() => {
    if (open) setF(filters);
  }, [open]);

  const lo = Math.floor((facets?.price_min ?? 0) / STEP) * STEP;
  const hi = Math.ceil((facets?.price_max ?? 100000) / STEP) * STEP || STEP;
  const pMin = f.priceMin ?? lo;
  const pMax = f.priceMax ?? hi;
  const count = applyFilters(items, f).length;
  const set = (patch: Partial<Filters>) => (haptic.select(), setF({ ...f, ...patch }));

  return (
    <div class={`sheet-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class="sheet glass-strong" role="dialog" aria-label="Фильтры">
        <div class="sheet-grabber" />
        <div class="sheet-head">
          <h2>Фильтры</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>

        <div class="sheet-scroll">
          <section class="fs">
            <h3>Память</h3>
            <div class="chips wrap">
              {(facets?.storages ?? []).map((gb) => (
                <button class={`chip ${f.storages.includes(gb) ? 'on' : ''}`} onClick={() => set({ storages: toggle(f.storages, gb) })}>
                  {formatStorage(gb)}
                </button>
              ))}
            </div>
          </section>

          <section class="fs">
            <h3>
              Цена <span class="fs-value">{formatPrice(pMin)} — {formatPrice(pMax)}</span>
            </h3>
            <div class="range" style={{ '--a': (pMin - lo) / (hi - lo || 1), '--b': (pMax - lo) / (hi - lo || 1) }}>
              <div class="range-track" />
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

          <section class="fs">
            <h3>АКБ от</h3>
            <div class="segmented">
              {[null, 80, 85, 90, 95].map((b) => (
                <button class={f.batteryMin === b ? 'on' : ''} onClick={() => set({ batteryMin: b })}>
                  {b ? `${b}%` : 'Любая'}
                </button>
              ))}
            </div>
          </section>

          {(facets?.conditions.length ?? 0) > 0 && (
            <section class="fs">
              <h3>Состояние</h3>
              <div class="chips wrap">
                {facets!.conditions.map((c) => (
                  <button class={`chip ${f.conditions.includes(c) ? 'on' : ''}`} onClick={() => set({ conditions: toggle(f.conditions, c) })}>
                    {c}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section class="fs">
            <h3>SIM</h3>
            <div class="segmented">
              {([
                ['any', 'Любая'],
                ['physical', 'Есть физическая'],
                ['esim', 'Только eSIM'],
              ] as const).map(([k, label]) => (
                <button class={f.sim === k ? 'on' : ''} onClick={() => set({ sim: k })}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div class="sheet-foot">
          <button class="btn-ghost" onClick={() => set({ ...EMPTY, family: f.family, sort: f.sort })}>
            Сбросить
          </button>
          <button class="btn-primary grow" onClick={() => (haptic.tap(), onApply(f))}>
            {count ? `Показать ${count}` : 'Ничего не найдено'}
          </button>
        </div>
      </div>
    </div>
  );
}
