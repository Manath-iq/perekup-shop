import type { Listing } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { batteryTone, isNew } from '../filters';
import { Emoji } from './Emoji';
import { Img } from './Img';

export function Card({ l, onOpen, index }: { l: Listing; onOpen: (l: Listing) => void; index: number }) {
  const meta = [l.storage_gb ? formatStorage(l.storage_gb) : null, l.condition].filter(Boolean).join(' · ');
  return (
    <button class="card" style={{ '--i': Math.min(index, 8) }} onClick={() => onOpen(l)}>
      <div class="card-photo">
        {l.cover ? (
          <Img src={l.cover} eager={index < 4} />
        ) : (
          <div class="card-photo-empty">
            <Emoji name="phone" size={48} />
          </div>
        )}
        {isNew(l) && (
          <span class="badge-new">
            <Emoji name="sparkles" size={14} />
            Новое
          </span>
        )}
        {l.battery_pct !== null && (
          <span class={`bat-chip bat-${batteryTone(l.battery_pct)}`}>
            <span class="bat-icon">
              <i style={{ width: `${l.battery_pct}%` }} />
            </span>
            {l.battery_pct}%
          </span>
        )}
      </div>
      <div class="card-body">
        <div class="card-title">iPhone {l.family ?? l.model_raw}</div>
        {meta && <div class="card-meta">{meta}</div>}
        <div class="card-price">
          <span>{l.price_rub ? formatPrice(l.price_rub) : 'Цена по запросу'}</span>
          {l.old_price_rub && <s>{formatPrice(l.old_price_rub)}</s>}
        </div>
      </div>
    </button>
  );
}

export function CardSkeleton() {
  return (
    <div class="card skeleton" aria-hidden="true">
      <div class="card-photo shimmer" />
      <div class="card-body">
        <div class="sk-line shimmer" style={{ width: '82%' }} />
        <div class="sk-line shimmer" style={{ width: '50%', height: '11px' }} />
        <div class="sk-line shimmer sk-price" style={{ width: '58%' }} />
      </div>
    </div>
  );
}
