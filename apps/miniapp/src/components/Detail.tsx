import { useEffect, useRef, useState } from 'preact/hooks';
import type { Listing, MediaItem } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { batteryTone, isNew } from '../filters';
import { api } from '../api';
import { haptic, inTelegram, tg, openTgLink } from '../tg';
import { Emoji } from './Emoji';
import { IconCheck, IconChevron, IconClose, IconInfo, IconPaper, IconPlay, IconShare } from '../icons';

interface Props {
  id: number;
  preview: Listing | null;
  botUsername: string;
  onClose: () => void;
  onBuy: (l: Listing) => Promise<void>;
  toast: (msg: string) => void;
}

export function Detail({ id, preview, botUsername, onClose, onBuy, toast }: Props) {
  const [l, setL] = useState<Listing | null>(preview);
  const [missing, setMissing] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    api.listing(id).then(setL).catch(() => setMissing(true));
    api.event('card_view', id);
  }, [id]);

  // Главная кнопка Telegram: «Купить — 43 990 ₽»
  useEffect(() => {
    if (!inTelegram || !l || l.status !== 'active') return;
    const mb = tg!.MainButton;
    const click = async () => {
      mb.showProgress(true);
      await onBuy(l);
      mb.hideProgress();
    };
    mb.setParams({
      text: l.price_rub ? `Купить — ${formatPrice(l.price_rub)}` : 'Написать продавцу',
      is_visible: true,
      is_active: true,
      has_shine_effect: true,
    });
    mb.onClick(click);
    return () => {
      mb.offClick(click);
      mb.hide();
    };
  }, [l?.id, l?.price_rub, l?.status]);

  const share = () => {
    if (!l) return;
    haptic.tap();
    const link = `https://t.me/${botUsername}?start=l_${l.id}`;
    const text = `iPhone ${l.family} ${l.storage_gb ? formatStorage(l.storage_gb) : ''} — ${l.price_rub ? formatPrice(l.price_rub) : ''}`;
    if (inTelegram) openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else navigator.clipboard?.writeText(link).then(() => toast('Ссылка скопирована'));
  };

  const media = l?.media ?? (l?.cover ? [{ id: 0, kind: 'photo', url: l.cover, width: null, height: null, position: 0 } as MediaItem] : []);
  const sold = l && l.status !== 'active';

  return (
    <div class="screen detail">
      {!inTelegram && (
        <button class="float-close glass-btn" onClick={onClose} aria-label="Назад">
          <IconClose />
        </button>
      )}

      <Gallery media={media} onOpen={(i) => (haptic.tap(), setViewer(i))} />

      {missing && !l ? (
        <div class="empty">
          <Emoji name="shrug" size={72} class="empty-emoji" />
          <div class="empty-title">Этот телефон уже продан</div>
          <button class="btn-primary" onClick={onClose}>
            Смотреть другие
          </button>
        </div>
      ) : l ? (
        <div class="detail-body">
          <div class="detail-head">
            {isNew(l) && (
              <span class="badge-new inline">
                <Emoji name="fire" size={15} />
                Новое
              </span>
            )}
            {sold && <span class="badge-sold">Продан</span>}
            <h1>
              iPhone {l.family ?? l.model_raw}
              {l.storage_gb ? <span class="muted"> {formatStorage(l.storage_gb)}</span> : null}
            </h1>
            <div class="detail-price">
              {l.price_rub ? formatPrice(l.price_rub) : 'Цена по запросу'}
              {l.old_price_rub && <s>{formatPrice(l.old_price_rub)}</s>}
            </div>
          </div>

          <div class="specs">
            <Spec label="Состояние" value={l.condition} />
            <Spec
              label="Аккумулятор"
              value={l.battery_pct !== null ? `${l.battery_pct}%` : null}
              hint={l.battery_cycles ? `${l.battery_cycles} циклов` : undefined}
              tone={batteryTone(l.battery_pct)}
              meter={l.battery_pct}
            />
            <Spec label="SIM" value={l.sim} />
            <Spec label="Память" value={l.storage_gb ? formatStorage(l.storage_gb) : null} />
            {l.ios && <Spec label="iOS" value={l.ios} />}
            <Spec label="Комплект" value={l.kit ?? (l.full_kit ? 'Полный' : null)} wide={!!l.kit && l.kit.length > 16} />
          </div>

          {l.pluses.length > 0 && (
            <section class="group">
              <h3>Плюсы</h3>
              <ul class="list">
                {l.pluses.map((p) => (
                  <li>
                    <span class="li-icon ok">
                      <IconCheck size={16} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {l.nuances.length > 0 && (
            <section class="group">
              <h3>Нюансы</h3>
              <ul class="list nuance">
                {l.nuances.map((p) => (
                  <li>
                    <span class="li-icon note">
                      <IconInfo size={16} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              <p class="group-foot">Честно показываем всё, что стоит знать до покупки.</p>
            </section>
          )}

          <section class="group links">
            <button class="row" onClick={() => (haptic.tap(), openTgLink(l.post_url))}>
              <span class="row-icon">
                <IconPaper size={18} />
              </span>
              Пост в канале
              <span class="row-tail">
                {l.media?.some((m) => m.kind === 'video') ? '' : 'видео там'} <IconChevron size={16} />
              </span>
            </button>
            <button class="row" onClick={share}>
              <span class="row-icon">
                <IconShare size={18} />
              </span>
              Поделиться
              <span class="row-tail">
                <IconChevron size={16} />
              </span>
            </button>
          </section>

          {!inTelegram && !sold && (
            <div class="buy-bar glass">
              <button class="btn-primary grow big" disabled={buying} onClick={async () => (setBuying(true), await onBuy(l), setBuying(false))}>
                {l.price_rub ? `Купить — ${formatPrice(l.price_rub)}` : 'Написать продавцу'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div class="detail-body">
          <div class="sk-line shimmer" style={{ width: '70%', height: '28px' }} />
          <div class="sk-line shimmer" style={{ width: '40%', height: '30px', marginTop: '12px' }} />
        </div>
      )}

      {viewer !== null && <Viewer media={media} start={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Spec({ label, value, hint, tone, meter, wide }: { label: string; value: string | null; hint?: string; tone?: string; meter?: number | null; wide?: boolean }) {
  if (!value) return null;
  return (
    <div class={`spec ${wide ? 'wide' : ''}`}>
      <div class="spec-label">{label}</div>
      <div class={`spec-value ${tone ? 'tone-' + tone : ''}`}>{value}</div>
      {meter != null && (
        <div class={`meter tone-${tone}`}>
          <i style={{ width: `${meter}%` }} />
        </div>
      )}
      {hint && <div class="spec-hint">{hint}</div>}
    </div>
  );
}

function Gallery({ media, onOpen }: { media: MediaItem[]; onOpen: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx) (setIdx(i), haptic.select());
  };
  if (!media.length) return <div class="gallery empty-gallery shimmer" />;
  return (
    <div class="gallery">
      <div class="gallery-track" ref={ref} onScroll={onScroll}>
        {media.map((m, i) => (
          <div class="slide" key={m.id} onClick={() => onOpen(i)}>
            {m.kind === 'video' ? (
              <>
                <video src={m.url} muted playsInline preload="metadata" />
                <span class="play glass-btn">
                  <IconPlay size={22} />
                </span>
              </>
            ) : (
              <img src={m.url} alt="" decoding="async" loading={i < 2 ? 'eager' : 'lazy'} onLoad={(e) => (e.currentTarget as HTMLImageElement).classList.add('loaded')} />
            )}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <div class="dots glass">
          {media.map((m, i) => (
            <i class={`${i === idx ? 'on' : ''} ${m.kind === 'video' ? 'vid' : ''}`} />
          ))}
        </div>
      )}
      <div class="counter glass">
        {idx + 1} / {media.length}
      </div>
    </div>
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
    <div class="viewer" role="dialog" aria-label="Фото">
      <div class="viewer-track" ref={ref} onScroll={(e) => setIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {media.map((m, i) => (
          <div class="viewer-slide" key={m.id} onClick={m.kind === 'photo' ? onClose : undefined}>
            {m.kind === 'video' ? (
              <video src={m.url} controls playsInline autoPlay={i === start} />
            ) : (
              <img src={m.url} alt="" />
            )}
          </div>
        ))}
      </div>
      <div class="viewer-top">
        <span>
          {idx + 1} из {media.length}
        </span>
        <button class="icon-btn glass-btn dark" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>
      </div>
    </div>
  );
}
