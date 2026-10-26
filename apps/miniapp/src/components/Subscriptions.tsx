import { useMemo, useState } from 'preact/hooks';
import type { Listing, Subscription } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/format';
import { parseQuery, queryChips, type SearchQuery } from '@vitrina/core/search';
import type { StoreInfo } from '../api';
import { IconBell, IconHeart, IconSearch, IconTrash } from '../icons';
import { inTelegram } from '../tg';
import { Emoji } from './Emoji';

interface Props {
  subs: Subscription[] | null;
  favorites: Listing[] | null;
  store: StoreInfo | null;
  onSubscribe: (q: SearchQuery) => Promise<boolean>;
  onUnsubscribe: (id: number) => void;
  onOpen: (l: Listing) => void;
  onToggleFav: (l: Listing) => void;
}

export function Subscriptions({ subs, favorites, store, onSubscribe, onUnsubscribe, onOpen, onToggleFav }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const q = useMemo(() => parseQuery(text, { defaultBrand: store?.default_brand ?? undefined }), [text, store?.default_brand]);
  const chips = queryChips(q).filter((c) => ['model', 'storage_gb', 'price_max'].includes(c.key));

  const save = async () => {
    setSaving(true);
    if (await onSubscribe(q)) setText('');
    setSaving(false);
  };

  return (
    <div class="page">
      <div class="glow" aria-hidden="true" />
      <div class="stack" style={{ gap: '6px' }}>
        <h1 class="d-title">Подписки</h1>
        <div class="muted">Напишем в Telegram, когда появится нужное или снизится цена</div>
      </div>

      {!inTelegram && (
        <div class="panel empty">
          <Emoji name="bell" size={52} />
          <h3>Откройте в Telegram</h3>
          <p>Подписки и избранное работают внутри Telegram — так бот сможет вам написать.</p>
        </div>
      )}

      {inTelegram && (
        <div class="panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Какую модель ждёте?</div>
          <label class="search">
            <IconSearch size={20} />
            <span class="sr">Модель для подписки</span>
            <input type="search" placeholder="16 Pro Max 256 до 90к" value={text} onInput={(e) => setText(e.currentTarget.value)} autoComplete="off" />
          </label>
          {text.trim() && (
            <div class="chips wrap">
              {chips.length ? chips.map((c) => <span class="chip soft" style={{ paddingRight: '14px' }}>{c.label}</span>) : <span class="muted" style={{ fontSize: '14px' }}>Не поняли модель — напишите, например, «14 Pro» или «S24 Ultra»</span>}
            </div>
          )}
          <button class="btn primary block" disabled={!q.model || saving} onClick={save}>
            <IconBell size={18} />
            Сообщить, когда появится
          </button>
        </div>
      )}

      {inTelegram && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="label">Жду модель</div>
          {subs === null ? (
            <div class="panel shimmer" style={{ height: '72px' }} />
          ) : subs.length === 0 ? (
            <div class="muted" style={{ fontSize: '14px' }}>
              Пока пусто. Найдите модель в поиске — если её нет, там будет кнопка «Сообщить».
            </div>
          ) : (
            <div class="panel list">
              {subs.map((s) => (
                <div class="row" style={{ padding: '14px 16px' }}>
                  <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600 }}>
                      {s.title}
                      {s.storage_gb ? ` ${formatStorage(s.storage_gb)}` : ''}
                    </span>
                    <span class="muted" style={{ fontSize: '13px' }}>
                      {s.max_price ? `до ${formatPrice(s.max_price)}` : 'любая цена'}
                    </span>
                  </span>
                  <button class="icon-btn" aria-label={`Отписаться от ${s.title}`} onClick={() => onUnsubscribe(s.id)}>
                    <IconTrash size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {inTelegram && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="label">Избранное</div>
          {favorites === null ? (
            <div class="panel shimmer" style={{ height: '72px' }} />
          ) : favorites.length === 0 ? (
            <div class="muted" style={{ fontSize: '14px' }}>
              Нажмите на сердечко в карточке — сообщим, если цена снизится.
            </div>
          ) : (
            <div class="panel list">
              {favorites.map((l) => (
                <div class="near" style={{ opacity: l.status === 'sold' ? 0.55 : 1 }}>
                  <button class="row" style={{ flexGrow: 1, minWidth: 0, textAlign: 'left', gap: '14px' }} onClick={() => onOpen(l)}>
                    {l.cover ? <img class="near-photo" style={{ width: '56px', height: '70px' }} src={l.cover} alt="" /> : <span class="near-photo" style={{ width: '56px', height: '70px' }} />}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                      <span style={{ fontSize: '15px', fontWeight: 600 }}>{l.title}</span>
                      <span class="muted" style={{ fontSize: '13px' }}>
                        {l.status === 'sold' ? 'Продан' : l.status === 'reserved' ? 'Забронирован' : l.price ? formatPrice(l.price) : ''}
                      </span>
                    </span>
                  </button>
                  <button class="icon-btn on" aria-label="Убрать из избранного" onClick={() => onToggleFav(l)}>
                    <IconHeart filled />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
