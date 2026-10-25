import type { StoreInfo } from '../api';
import { haptic, openTgLink } from '../tg';
import { IconChevron } from '../icons';
import { Emoji, type EmojiName } from './Emoji';

export function About({ store }: { store: StoreInfo | null }) {
  if (!store) return <div class="screen page" />;
  const { about, reviews } = store;
  const rows: [EmojiName, string, string][] = [
    ['map', 'Город', about.city],
    ['car', 'Доставка', about.delivery],
    ['check', 'Гарантия', about.warranty],
    ['money', 'Оплата', about.payment],
  ];
  return (
    <div class="screen page">
      <div class="page-hero">
        <div class="brand-mark big" aria-hidden="true">
          <span>R</span>
        </div>
        <h1>{store.name}</h1>
        <p>Техника с проверкой. У каждого товара — честное описание и реальные фото.</p>
      </div>

      {reviews && (
        <section class="group reviews">
          <button class="reviews-head" onClick={() => (haptic.tap(), openTgLink(reviews.url))}>
            <span class="row-icon star">
              <Emoji name="star" size={24} />
            </span>
            <div>
              <b>Отзывы покупателей</b>
              {reviews.subscribers && <span class="muted">{reviews.subscribers}</span>}
            </div>
            <IconChevron size={16} />
          </button>
          {reviews.photos.length > 0 && (
            <div class="review-strip">
              {reviews.photos.map((src) => (
                <button class="review-shot" onClick={() => openTgLink(reviews.url)}>
                  <img src={src} alt="Отзыв" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section class="group">
        <h3>
          О магазине {about.demo && <span class="req">демо-текст</span>}
        </h3>
        <ul class="list info">
          {rows.map(([icon, label, value]) => (
            <li>
              <Emoji name={icon} size={28} />
              <div>
                <span class="muted">{label}</span>
                {value}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section class="group links">
        <button class="row" onClick={() => openTgLink(`https://t.me/${store.channel}`)}>
          <span class="row-icon">
            <Emoji name="megaphone" size={24} />
          </span>
          Канал @{store.channel}
          <span class="row-tail">
            <IconChevron size={16} />
          </span>
        </button>
        <button class="row" onClick={() => openTgLink(`https://t.me/${store.seller}`)}>
          <span class="row-icon">
            <Emoji name="chat" size={24} />
          </span>
          Написать продавцу
          <span class="row-tail">
            <IconChevron size={16} />
          </span>
        </button>
      </section>
    </div>
  );
}
