import type { Listing } from '@vitrina/core/types';
import { formatPrice } from '@vitrina/core/format';
import { batteryTone, cardMeta, isNew } from '../filters';
import { Img } from './Img';
import { Emoji } from './Emoji';

export function Card({ l, onOpen, index }: { l: Listing; onOpen: (l: Listing) => void; index: number }) {
  const bat = l.attrs.battery_pct;
  return (
    <button class="card" style={{ '--i': Math.min(index, 8) }} onClick={() => onOpen(l)}>
      <span class="card-photo">
        {l.cover_blur && <i class="card-blur" style={{ backgroundImage: `url(${l.cover_blur})` }} />}
        {l.cover ? (
          <Img src={l.cover} alt={l.title} eager={index < 4} />
        ) : (
          <span class="card-empty">
            <Emoji name="phone" size={44} />
          </span>
        )}
        {bat !== undefined && (
          <span class="on-photo bat-chip" style={{ '--tone': batteryTone(bat) }}>
            <i aria-hidden="true" />
            АКБ {bat}%
          </span>
        )}
        {l.status === 'reserved' ? (
          <span class="on-photo badge reserved">Бронь</span>
        ) : (
          isNew(l) && <span class="on-photo badge">Новое</span>
        )}
      </span>
      <span class="card-body">
        <span class="card-title">{l.title}</span>
        <span class="card-meta">{cardMeta(l) || ' '}</span>
        <span class="price">
          {l.price ? formatPrice(l.price) : 'Цена по запросу'}
          {l.old_price && <s>{formatPrice(l.old_price)}</s>}
        </span>
      </span>
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
        <div class="sk-line shimmer" style={{ width: '58%', height: '17px', marginTop: '4px' }} />
      </div>
    </div>
  );
}
