import type { StoreInfo } from '../api';
import { initials } from '../filters';
import { haptic, openTgLink } from '../tg';
import { IconChat, IconChevron, IconPin, IconShield, IconTruck, IconWallet } from '../icons';
import { Emoji } from './Emoji';

export function About({ store }: { store: StoreInfo | null }) {
  if (!store) return <div class="page" />;
  const { about, reviews } = store;
  const rows = [
    [IconPin, 'Город', about.city],
    [IconTruck, 'Доставка', about.delivery],
    [IconShield, 'Гарантия', about.warranty],
    [IconWallet, 'Оплата', about.payment],
  ] as const;
  const filled = rows.filter(([, , v]) => v);
  return (
    <div class="page">
      <div class="glow" aria-hidden="true" />
      <div class="stack" style={{ alignItems: 'center', textAlign: 'center', gap: '12px', paddingTop: '12px' }}>
        <div class="avatar" style={{ width: '84px', height: '84px', fontSize: '28px' }}>
          {store.avatar ? <img src={store.avatar} alt="" /> : initials(store.name)}
        </div>
        <h1 class="d-title">{store.name}</h1>
        <div class="muted" style={{ maxWidth: '300px' }}>
          Только то, что есть в наличии. У каждого товара — честное описание и реальные фото.
        </div>
      </div>

      {filled.length > 0 && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="between">
            <div class="label">О магазине</div>
            {about.demo && <span class="tag warn sm">демо-текст</span>}
          </div>
          <div class="panel list">
            {filled.map(([Icon, label, value]) => (
              <div class="info-row">
                <Icon size={20} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span class="muted" style={{ fontSize: '13px' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: '15px', lineHeight: 1.4 }}>{value}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviews && (
        <div class="stack" style={{ gap: '12px' }}>
          <button class="between" style={{ textAlign: 'left' }} onClick={() => (haptic.tap(), openTgLink(reviews.url))}>
            <span class="row">
              <Emoji name="star" size={28} />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span class="h2">Отзывы</span>
                {reviews.subscribers && (
                  <span class="muted" style={{ fontSize: '13px' }}>
                    {reviews.subscribers}
                  </span>
                )}
              </span>
            </span>
            <IconChevron size={18} />
          </button>
          {reviews.photos.length > 0 && (
            <div class="reviews">
              {reviews.photos.map((src) => (
                <button onClick={() => openTgLink(reviews.url)} aria-label="Открыть отзывы">
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div class="stack" style={{ gap: '10px' }}>
        <button class="btn primary block" onClick={() => openTgLink(`https://t.me/${store.seller}`)}>
          <IconChat size={20} />
          Написать продавцу
        </button>
        <button class="btn ghost block" onClick={() => openTgLink(`https://t.me/${store.channel}`)}>
          Канал @{store.channel}
        </button>
      </div>
    </div>
  );
}
