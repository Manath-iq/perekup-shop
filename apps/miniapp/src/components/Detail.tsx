import { useEffect, useRef, useState } from 'preact/hooks';
import type { Listing, MediaItem } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { startParam } from '@vitrina/core/store';
import type { SearchQuery } from '@vitrina/core/search';
import type { StoreInfo } from '../api';
import { api } from '../api';
import { batteryTone, batteryWord, initials } from '../filters';
import { haptic, inTelegram, openTgLink, storeId, supports, tg } from '../tg';
import { IconAlert, IconBack, IconCheck, IconClose, IconHeart, IconPlay, IconShare } from '../icons';
import { Emoji } from './Emoji';

interface Props {
  id: number;
  preview: Listing | null;
  items: Listing[];
  store: StoreInfo | null;
  fav: boolean;
  onToggleFav: (l: Listing) => void;
  onClose: () => void;
  onOpen: (l: Listing) => void;
  onContact: (l: Listing, kind: 'buy' | 'ask') => Promise<void>;
  onSubscribe: (q: SearchQuery) => void;
  toast: (msg: string) => void;
}

const gb = (n: number) => (n >= 1024 ? `${n / 1024} ТБ` : `${n} ГБ`);

/** Плитки «паспорта» — только то, что нашлось в посте, в порядке важности для категории */
function passport(l: Listing): { label: string; value: string }[] {
  const a = l.attrs;
  const out: { label: string; value: string }[] = [];
  if (a.storage_gb) out.push({ label: 'Память', value: gb(a.storage_gb) });
  if (a.chip) out.push({ label: 'Процессор', value: a.chip });
  if (a.ram_gb) out.push({ label: 'Оперативная', value: `${a.ram_gb} ГБ` });
  if (a.screen_in) out.push({ label: 'Экран', value: `${a.screen_in}″` });
  if (a.case_mm) out.push({ label: 'Корпус', value: `${a.case_mm} мм` });
  if (a.original !== undefined) out.push({ label: 'Подлинность', value: a.original ? 'Оригинал' : 'Реплика' });
  if (a.sim) out.push({ label: 'SIM', value: a.sim });
  if (a.kit) out.push({ label: 'Комплект', value: a.full_kit ? 'Полный' : a.kit });
  if (a.battery_cycles) out.push({ label: 'Циклы зарядки', value: String(a.battery_cycles) });
  if (a.os_version) out.push({ label: l.brand === 'apple' ? 'iOS' : 'Версия ОС', value: a.os_version });
  if (a.color) out.push({ label: 'Цвет', value: a.color });
  return out;
}

export function Detail({ id, preview, items, store, fav, onToggleFav, onClose, onOpen, onContact, onSubscribe, toast }: Props) {
  const [l, setL] = useState<Listing | null>(preview);
  const [missing, setMissing] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const sold = l?.status === 'sold';
  const secondary = inTelegram && supports('7.10') && !!tg?.SecondaryButton;

  useEffect(() => {
    api
      .listing(id)
      .then(setL)
      .catch(() => setMissing(true));
    api.event('card_view', { listing_id: id });
  }, [id]);

  const subscribeSimilar = () =>
    l?.model_id && onSubscribe({ model: { id: l.model_id, title: l.line && l.short ? `${l.line} ${l.short}` : l.title, short: l.short ?? '', line: l.line ?? '', category: l.category } });

  // Нативные кнопки Telegram: «Купить · 45 990 ₽» и «Спросить»
  useEffect(() => {
    if (!inTelegram || !l) return;
    const mb = tg!.MainButton;
    const sb = secondary ? tg!.SecondaryButton! : null;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const main = async () => {
      if (sold) return subscribeSimilar();
      mb.showProgress(true);
      await onContact(l, 'buy');
      mb.hideProgress();
    };
    const ask = () => onContact(l, 'ask');
    mb.setParams({
      text: sold ? 'Сообщить о похожем' : l.price ? `Купить · ${formatPrice(l.price)}` : 'Написать продавцу',
      color: accent || undefined,
      text_color: '#140a05',
      is_visible: true,
      is_active: true,
      has_shine_effect: !sold,
    });
    mb.onClick(main);
    if (sb && !sold) {
      sb.setParams({ text: 'Спросить', position: 'left', is_visible: true, is_active: true });
      sb.onClick(ask);
    }
    return () => {
      mb.offClick(main);
      mb.hide();
      if (sb) (sb.offClick(ask), sb.hide());
    };
  }, [l?.id, l?.price, l?.status]);

  const share = () => {
    if (!l || !store) return;
    haptic.tap();
    const link = `https://t.me/${store.bot_username}?start=${startParam(storeId || null, l.id)}`;
    const text = `${l.title}${l.attrs.storage_gb ? ' ' + formatStorage(l.attrs.storage_gb) : ''}${l.price ? ' — ' + formatPrice(l.price) : ''}`;
    if (inTelegram) openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else navigator.clipboard?.writeText(link).then(() => toast('Ссылка скопирована'));
  };

  if (missing && !l)
    return (
      <div class="detail page">
        <button class="icon-btn" aria-label="Назад" onClick={onClose}>
          <IconBack />
        </button>
        <div class="panel empty">
          <Emoji name="shrug" size={56} />
          <h3>Товар не найден</h3>
          <p>Возможно, продавец удалил пост. Посмотрите, что есть в наличии.</p>
          <button class="btn primary block" onClick={onClose}>
            В каталог
          </button>
        </div>
      </div>
    );

  const media: MediaItem[] = l?.media ?? (l?.cover ? [{ id: 0, kind: 'photo', url: l.cover, poster: null, width: null, height: null, position: 0 }] : []);
  const tiles = l ? passport(l) : [];
  const bat = l?.attrs.battery_pct;
  const similar = l
    ? items
        .filter((x) => x.id !== l.id && (x.model_id === l.model_id || (x.line && x.line === l.line)))
        .sort((a, b) => Math.abs((a.price ?? 0) - (l.price ?? 0)) - Math.abs((b.price ?? 0) - (l.price ?? 0)))
        .slice(0, 4)
    : [];

  return (
    <div class={`detail ${inTelegram ? 'in-tg' : ''}`}>
      <Gallery media={media} title={l?.title ?? ''} onOpen={(i) => (haptic.tap(), setViewer(i))}>
        <div class="gallery-top">
          <button class="icon-btn scrim" aria-label="Назад" onClick={onClose}>
            <IconBack />
          </button>
          <div class="row" style={{ gap: '8px' }}>
            {l && (
              <button class={`icon-btn scrim ${fav ? 'on' : ''}`} aria-label={fav ? 'Убрать из избранного' : 'В избранное'} aria-pressed={fav} onClick={() => (haptic.tap(), onToggleFav(l))}>
                <IconHeart filled={fav} />
              </button>
            )}
            <button class="icon-btn scrim" aria-label="Поделиться" onClick={share}>
              <IconShare />
            </button>
          </div>
        </div>
      </Gallery>

      {l && (
        <>
          <div class="section" style={{ gap: '10px', paddingTop: '20px' }}>
            {sold && (
              <div class="sold-banner">
                <Emoji name="party" size={28} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <b>Уже продан</b>
                  <span class="muted" style={{ fontSize: '14px' }}>
                    Похожие — ниже, а о новых можем сообщить
                  </span>
                </span>
              </div>
            )}
            <div class="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
              {l.status === 'reserved' && <span class="tag warn">Забронирован</span>}
              {l.attrs.condition && <span class="tag good">{l.attrs.condition}</span>}
              {l.pluses.some((p) => /не вскрывал/i.test(p)) && <span class="tag plain">Не вскрывался</span>}
            </div>
            <h1 class="d-title">{l.title}</h1>
            {(l.attrs.storage_gb || l.attrs.sim) && (
              <div class="muted" style={{ fontSize: '15px' }}>
                {[l.attrs.storage_gb && gb(l.attrs.storage_gb), l.attrs.chip, l.attrs.sim].filter(Boolean).join(' · ')}
              </div>
            )}
            <div class="d-price" style={sold ? { color: 'var(--muted)' } : undefined}>
              {l.price ? formatPrice(l.price) : 'Цена по запросу'}
              {l.old_price && <s>{formatPrice(l.old_price)}</s>}
            </div>
            {inTelegram && !secondary && !sold && (
              <button class="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onContact(l, 'ask')}>
                Задать вопрос продавцу
              </button>
            )}
          </div>

          {(bat !== undefined || tiles.length > 0) && (
            <div class="section" style={{ paddingTop: '22px' }}>
              <div class="passport">
                {bat !== undefined && <BatteryTile pct={bat} />}
                {tiles.map((t) => (
                  <div class="tile">
                    <span class="tile-label">{t.label}</span>
                    <span class={`tile-value ${t.value.length > 12 ? 'long' : ''}`}>{t.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(l.nuances.length > 0 || l.pluses.length > 0) && (
            <div class="section">
              <h2 class="h2">Честно о состоянии</h2>
              {l.nuances.map((n) => (
                <div class="nuance">
                  <span style={{ color: 'var(--warn)', marginTop: '1px' }}>
                    <IconAlert />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--warn)' }}>Нюанс</span>
                    <span style={{ fontSize: '15px', lineHeight: 1.4 }}>{n}</span>
                  </span>
                </div>
              ))}
              {l.pluses.length > 0 && (
                <div class="panel list">
                  {l.pluses.map((p) => (
                    <div class="point">
                      <IconCheck />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {store && (
            <div class="section">
              <div class="panel seller row">
                <div class="avatar sm">{store.avatar ? <img src={store.avatar} alt="" /> : initials(store.name)}</div>
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>{store.name}</div>
                  <div class="muted" style={{ fontSize: '13px' }}>
                    {[store.about.city, store.about.delivery && 'есть доставка'].filter(Boolean).join(' · ') || '@' + store.seller}
                  </div>
                </div>
                <a class="btn ghost sm" href={l.post_url} onClick={(e) => (e.preventDefault(), openTgLink(l.post_url))}>
                  Пост
                </a>
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div class="section">
              <h2 class="h2">{sold ? 'Есть похожие' : 'Похожие в наличии'}</h2>
              <div class="grid">
                {similar.map((s) => (
                  <button class="card" style={{ animation: 'none' }} onClick={() => onOpen(s)}>
                    <span class="card-photo">{s.cover && <img class="loaded" src={s.cover} alt={s.title} loading="lazy" />}</span>
                    <span class="card-body">
                      <span class="card-title">{s.title}</span>
                      <span class="price">{s.price ? formatPrice(s.price) : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!inTelegram && (
            <div class="bottom-bar">
              {sold ? (
                <button class="btn primary" style={{ flexGrow: 1 }} onClick={subscribeSimilar}>
                  Сообщить о похожем
                </button>
              ) : (
                <>
                  <button class="btn ghost" style={{ flex: '0 0 120px' }} onClick={() => onContact(l, 'ask')}>
                    Спросить
                  </button>
                  <button class="btn primary" style={{ flexGrow: 1 }} onClick={() => onContact(l, 'buy')}>
                    {l.price ? `Купить · ${formatPrice(l.price)}` : 'Написать продавцу'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {viewer !== null && <Viewer media={media} start={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function BatteryTile({ pct }: { pct: number }) {
  const r = 48;
  const len = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(t);
  }, [pct]);
  const tone = batteryTone(pct);
  return (
    <div class="tile ring">
      <span class="tile-label">Аккумулятор</span>
      <span class="ring-box">
        <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label={`Ёмкость аккумулятора ${pct} процентов`}>
          <circle cx="56" cy="56" r={r} fill="none" stroke="var(--fill-2)" stroke-width="10" />
          <circle cx="56" cy="56" r={r} fill="none" stroke={tone} stroke-width="10" stroke-linecap="round" stroke-dasharray={`${(shown / 100) * len} ${len}`} transform="rotate(-90 56 56)" />
        </svg>
        <span>{pct}%</span>
      </span>
      <span style={{ fontSize: '13px', textAlign: 'center', color: tone }}>{batteryWord(pct)}</span>
    </div>
  );
}

function Gallery({ media, title, onOpen, children }: { media: MediaItem[]; title: string; onOpen: (i: number) => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx) (setIdx(i), haptic.select());
  };
  const go = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <>
      <div class={`gallery ${media.length ? '' : 'shimmer'}`}>
        <div class="gallery-track" ref={ref} onScroll={onScroll}>
          {media.map((m, i) => (
            <div class="slide" key={m.id} onClick={() => onOpen(i)}>
              {m.kind === 'video' ? (
                <>
                  <video src={m.url} poster={m.poster ?? undefined} muted playsInline preload="metadata" />
                  <span class="play">
                    <IconPlay size={26} />
                  </span>
                </>
              ) : (
                <img
                  src={m.url}
                  alt={`${title}, фото ${i + 1}`}
                  decoding="async"
                  loading={i < 2 ? 'eager' : 'lazy'}
                  onLoad={(e) => (e.currentTarget as HTMLImageElement).classList.add('loaded')}
                />
              )}
            </div>
          ))}
        </div>
        <div class="gallery-fade" aria-hidden="true" />
        {children}
        {media.length > 1 && (
          <div class="counter">
            {idx + 1} / {media.length}
          </div>
        )}
      </div>
      {media.length > 1 && (
        <div class="thumbs">
          {media.map((m, i) => (
            <button class={`thumb ${i === idx ? 'on' : ''}`} aria-label={`Фото ${i + 1}`} onClick={() => (haptic.select(), go(i))}>
              {m.kind === 'video' ? (
                <>
                  {m.poster && <img src={m.poster} alt="" loading="lazy" />}
                  <span class="vid">
                    <IconPlay size={16} />
                  </span>
                </>
              ) : (
                <img src={m.url} alt="" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Viewer({ media, start, onClose }: { media: MediaItem[]; start: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(start);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, []);
  return (
    <div class="viewer" role="dialog" aria-label="Фото и видео">
      <div class="viewer-track" ref={ref} onScroll={(e) => setIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {media.map((m, i) => (
          <div class="viewer-slide" key={m.id} onClick={m.kind === 'photo' ? onClose : undefined}>
            {m.kind === 'video' ? <video src={m.url} poster={m.poster ?? undefined} controls playsInline autoPlay={i === start} /> : <img src={m.url} alt="" />}
          </div>
        ))}
      </div>
      <div class="viewer-top">
        <span>
          {idx + 1} из {media.length}
        </span>
        <button class="icon-btn scrim" onClick={onClose} aria-label="Закрыть">
          <IconClose size={18} />
        </button>
      </div>
    </div>
  );
}
