import { useEffect, useState } from 'preact/hooks';
import type { CabinetData, CabinetMetric } from '@vitrina/core/types';
import { formatPrice } from '@vitrina/core/format';
import { api, type StoreInfo } from '../api';
import { ago, initials, plural } from '../filters';
import { haptic, openTgLink } from '../tg';
import { IconAlert } from '../icons';
import { Emoji } from './Emoji';

const PERIODS = [
  [1, 'Сегодня'],
  [7, '7 дней'],
  [30, '30 дней'],
] as const;

const MISSING: Record<string, string> = { model: 'модель', price: 'цена', storage_gb: 'память' };
const LEAD_STATUS = {
  new: { label: 'Новая', cls: 'accent' },
  work: { label: 'В работе', cls: 'plain' },
  sold: { label: 'Продал', cls: 'good' },
} as const;

function delta(m: CabinetMetric): { text: string; up: boolean } {
  if (!m.prev) return { text: m.value ? 'новое за период' : '—', up: m.value > 0 };
  const pct = Math.round(((m.value - m.prev) / m.prev) * 100);
  return { text: `${pct >= 0 ? '+' : ''}${pct}% к прошлому`, up: pct >= 0 };
}

export function Cabinet({ store, toast }: { store: StoreInfo | null; toast: (m: string) => void }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<CabinetData | null>(null);
  const [error, setError] = useState(false);
  const [openLead, setOpenLead] = useState<number | null>(null);

  const load = () =>
    api
      .cabinet(days)
      .then((d) => (setData(d), setError(false)))
      .catch(() => setError(true));
  useEffect(() => {
    setData(null);
    load();
  }, [days]);

  const act = async (id: number, action: 'confirm' | 'hide') => {
    haptic.medium();
    await api.listingAction(id, action);
    toast(action === 'confirm' ? 'Карточка в каталоге' : 'Карточка скрыта');
    load();
  };
  const leadTo = async (id: number, status: 'work' | 'sold') => {
    haptic.medium();
    await api.leadStatus(id, status);
    if (status === 'sold') toast('Отмечено как проданное — карточка снята');
    setOpenLead(null);
    load();
  };

  const k = data?.kpis;
  const kpis: [string, CabinetMetric | undefined][] = [
    ['Открыли каталог', k?.app_open],
    ['Смотрели карточки', k?.card_view],
    ['Нажали «Купить»', k?.buy_click],
    ['Подписались', k?.subscribe],
  ];
  const maxDemand = Math.max(1, ...(data?.demand ?? []).map((d) => d.searches + d.waiting * 2));
  const maxViews = Math.max(1, ...(data?.top ?? []).map((t) => t.views));

  return (
    <div class="page">
      <div class="stack" style={{ gap: '14px' }}>
        <div class="stack" style={{ gap: '4px' }}>
          <h1 class="d-title">Кабинет</h1>
          <span class="muted" style={{ fontSize: '14px' }}>
            {store?.name} · видите только вы
            {data ? ` · в наличии ${data.in_stock}, продано ${data.sold}` : ''}
          </span>
        </div>
        <div class="seg">
          {PERIODS.map(([d, label]) => (
            <button class={days === d ? 'on' : ''} onClick={() => (haptic.select(), setDays(d))}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div class="panel empty">
          <Emoji name="retry" size={52} />
          <h3>Не загрузилось</h3>
          <button class="btn primary block" onClick={load}>
            Обновить
          </button>
        </div>
      )}

      <div class="kpis">
        {kpis.map(([label, m]) => {
          const d = m ? delta(m) : null;
          return (
            <div class={`tile ${m ? '' : 'shimmer'}`} style={{ gap: '8px', minHeight: '108px' }}>
              <span class="tile-label">{label}</span>
              {m && <span class="kpi-value">{m.value.toLocaleString('ru-RU')}</span>}
              {d && <span class={`delta ${d.up ? '' : 'down'}`}>{d.text}</span>}
            </div>
          );
        })}
      </div>

      {data && data.pending.length > 0 && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="row" style={{ gap: '8px' }}>
            <h2 class="h2">Ждёт проверки</h2>
            <span class="count-pill">{data.pending.length}</span>
          </div>
          <div class="muted" style={{ fontSize: '14px', marginTop: '-4px' }}>
            Покупатели увидят эти карточки после «Всё верно»
          </div>
          {data.pending.map((p) => (
            <div class="panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div class="between" style={{ alignItems: 'baseline' }}>
                <span style={{ fontSize: '17px', fontWeight: 700 }}>
                  {p.title}
                  {p.attrs.storage_gb ? ` ${p.attrs.storage_gb} ГБ` : ''}
                </span>
                <span style={{ fontSize: '17px', fontWeight: 700, flexShrink: 0 }}>{p.price ? formatPrice(p.price) : '—'}</span>
              </div>
              {(p.attrs.battery_pct || p.attrs.condition) && (
                <div class="muted" style={{ fontSize: '14px' }}>
                  {[p.attrs.battery_pct && `АКБ ${p.attrs.battery_pct}%`, p.attrs.condition && `состояние «${p.attrs.condition}»`].filter(Boolean).join(' · ')}
                </div>
              )}
              <div class="quote">{p.text}</div>
              <div class="row" style={{ gap: '8px', fontSize: '13px', color: 'var(--warn)' }}>
                <IconAlert size={16} />
                {p.parsed_by === 'llm'
                  ? 'Разобрано нейросетью — проверьте цифры'
                  : `Не нашлось: ${p.missing.map((m) => MISSING[m] ?? m).join(', ') || 'часть полей'}`}
              </div>
              <div class="row" style={{ gap: '8px' }}>
                <button class="btn primary sm" style={{ flexGrow: 1 }} onClick={() => act(p.id, 'confirm')}>
                  Всё верно
                </button>
                <button class="btn ghost sm" onClick={() => openTgLink(p.post_url)}>
                  Исправить
                </button>
                <button class="btn ghost sm" onClick={() => act(p.id, 'hide')}>
                  Скрыть
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div class="stack" style={{ gap: '12px' }}>
          <div class="stack" style={{ gap: '4px' }}>
            <h2 class="h2">Спрос без товара</h2>
            <span class="muted" style={{ fontSize: '14px' }}>
              Ищут и ждут, а у вас сейчас нет — что закупать
            </span>
          </div>
          {data.demand.length === 0 ? (
            <div class="muted" style={{ fontSize: '14px' }}>
              Пока тихо: всё, что искали, было в наличии.
            </div>
          ) : (
            <div class="panel list">
              {data.demand.map((d) => (
                <div class="row" style={{ padding: '14px 16px' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '15px', fontWeight: 600 }}>{d.title}</span>
                    <span class="muted" style={{ fontSize: '13px' }}>
                      {[
                        d.searches && `${d.searches} ${plural(d.searches, 'поиск', 'поиска', 'поисков')}`,
                        d.waiting && `${d.waiting} ${plural(d.waiting, 'ждёт', 'ждут', 'ждут')} уведомления`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span style={{ width: '64px', flexShrink: 0 }}>
                    <span class="bar accent" style={{ display: 'block', height: '6px' }}>
                      <i style={{ width: `${((d.searches + d.waiting * 2) / maxDemand) * 100}%` }} />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data && (
        <div class="stack" style={{ gap: '12px' }}>
          <h2 class="h2">Заявки</h2>
          {data.leads.length === 0 ? (
            <div class="muted" style={{ fontSize: '14px' }}>
              Когда покупатель нажмёт «Купить», заявка появится здесь и придёт вам в бота.
            </div>
          ) : (
            <div class="panel list">
              {data.leads.map((l) => (
                <div class="lead">
                  <button class="row" style={{ textAlign: 'left', width: '100%' }} aria-expanded={openLead === l.id} onClick={() => setOpenLead(openLead === l.id ? null : l.id)}>
                    <span class="avatar sm" style={{ background: 'var(--fill-2)', color: 'var(--text)' }}>
                      {initials(l.who.replace('@', ''))}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexGrow: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '15px', fontWeight: 600 }}>{l.who}</span>
                      <span class="muted" style={{ fontSize: '13px' }}>
                        {l.title} · {ago(l.created_at)}
                      </span>
                    </span>
                    <span class={`tag sm ${LEAD_STATUS[l.status].cls}`}>{LEAD_STATUS[l.status].label}</span>
                  </button>
                  {openLead === l.id && (
                    <div class="row" style={{ gap: '8px' }}>
                      {l.username && (
                        <button class="btn primary sm" style={{ flexGrow: 1 }} onClick={() => openTgLink(`https://t.me/${l.username}`)}>
                          Написать
                        </button>
                      )}
                      {l.status === 'new' && (
                        <button class="btn ghost sm" onClick={() => leadTo(l.id, 'work')}>
                          В работе
                        </button>
                      )}
                      {l.status !== 'sold' && (
                        <button class="btn ghost sm" onClick={() => leadTo(l.id, 'sold')}>
                          Продал
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data && data.top.length > 0 && (
        <div class="stack" style={{ gap: '12px' }}>
          <h2 class="h2">Что смотрят</h2>
          <div class="panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data.top.map((t) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span class="between" style={{ fontSize: '14px' }}>
                  <span>{t.title}</span>
                  <span class="muted">{t.views}</span>
                </span>
                <span class="bar" style={{ display: 'block' }}>
                  <i style={{ width: `${(t.views / maxViews) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
