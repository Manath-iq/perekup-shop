import { useEffect, useRef, useState } from 'preact/hooks';
import type { Facets, Listing, Subscription } from '@vitrina/core/types';
import type { SearchQuery } from '@vitrina/core/search';
import { api, type StoreInfo } from './api';
import { applyFilters, EMPTY, type Filters } from './filters';
import { applyAccent } from './theme';
import { copyText, haptic, inTelegram, openTgLink, requestWriteAccess, startListing, tg } from './tg';
import { Storefront } from './components/Storefront';
import { FilterSheet } from './components/FilterSheet';
import { Detail } from './components/Detail';
import { Subscriptions } from './components/Subscriptions';
import { About } from './components/About';
import { Cabinet } from './components/Cabinet';
import { IconBell, IconChart, IconGrid, IconStore } from './icons';
import { Emoji } from './components/Emoji';

type Tab = 'catalog' | 'subs' | 'about' | 'cabinet';
const FILTERS_KEY = 'vitrina:filters';

function loadFilters(): Filters {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? '{}') };
  } catch {
    return EMPTY;
  }
}

export function App() {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState(false);
  // демо-деплой открыли без ссылки на магазин
  const [noStore, setNoStore] = useState(false);
  const [filters, setFiltersRaw] = useState<Filters>(loadFilters);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<Tab>('catalog');
  const [detailId, setDetailId] = useState<number | null>(startListing);
  const [subs, setSubs] = useState<Subscription[] | null>(inTelegram ? null : []);
  const [favorites, setFavorites] = useState<Listing[] | null>(inTelegram ? null : []);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const scrollByTab = useRef<Record<Tab, number>>({ catalog: 0, subs: 0, about: 0, cabinet: 0 });

  const setFilters = (f: Filters) => {
    setFiltersRaw(f);
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
    } catch {}
  };

  const toast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2800);
  };

  const load = () => {
    setError(false);
    Promise.all([api.listings(), api.facets()])
      .then(([l, f]) => (setItems(l), setFacets(f)))
      .catch((e: { status?: number }) => (e.status === 404 ? setNoStore(true) : setError(true)));
  };

  useEffect(() => {
    load();
    api
      .store()
      .then((s) => (setStore(s), applyAccent(s.theme?.accent)))
      .catch(() => {});
    api.event('app_open');
    if (inTelegram) {
      api.me().then((m) => setAdmin(m.is_admin)).catch(() => {});
      api.subscriptions().then(setSubs).catch(() => setSubs([]));
      api.favorites().then(setFavorites).catch(() => setFavorites([]));
    }
  }, []);

  // выбранной модели больше нет в наличии — снимаем выбор
  useEffect(() => {
    if (facets && filters.model_id && !facets.models.some((m) => m.model_id === filters.model_id)) setFilters({ ...filters, model_id: null });
  }, [facets]);

  const goTab = (t: Tab) => {
    if (t === tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
    haptic.select();
    scrollByTab.current[tab] = window.scrollY;
    setTab(t);
    requestAnimationFrame(() => window.scrollTo(0, scrollByTab.current[t] ?? 0));
  };

  // Кнопка «Назад» Telegram: шторка → карточка → вкладка каталога
  const back = () => {
    if (sheet) return setSheet(false);
    if (detailId !== null) return setDetailId(null);
    if (tab !== 'catalog') goTab('catalog');
  };
  const backRef = useRef(back);
  backRef.current = back;
  const canGoBack = sheet || detailId !== null || tab !== 'catalog';
  useEffect(() => {
    if (!inTelegram || !tg!.isVersionAtLeast('6.1')) return;
    const handler = () => backRef.current();
    tg!.BackButton.onClick(handler);
    return () => tg!.BackButton.offClick(handler);
  }, []);
  useEffect(() => {
    if (!inTelegram || !tg!.isVersionAtLeast('6.1')) return;
    canGoBack ? tg!.BackButton.show() : tg!.BackButton.hide();
  }, [canGoBack]);
  useEffect(() => {
    document.documentElement.classList.toggle('lock', detailId !== null || sheet);
  }, [detailId, sheet]);

  const contact = async (l: Listing, kind: 'buy' | 'ask') => {
    haptic.medium();
    let url: string;
    let text: string;
    try {
      ({ url, text } = await api.contact(l.id, kind));
    } catch {
      // вне Telegram заявка не уходит, но чат продавца откроем
      text = kind === 'buy' ? `Здравствуйте! Хочу ${l.title} (пост ${l.msg_id})` : `Здравствуйте! Вопрос по ${l.title} (пост ${l.msg_id}): `;
      url = `https://t.me/${store?.seller ?? ''}?text=${encodeURIComponent(text)}`;
    }
    // не все клиенты подставляют ?text= — страхуемся буфером обмена
    const copied = await copyText(text);
    haptic.success();
    if (copied) toast('Текст скопирован — если чат открылся пустым, вставьте его');
    setTimeout(() => openTgLink(url), copied ? 700 : 0);
  };

  const subscribe = async (q: SearchQuery): Promise<boolean> => {
    if (!q.model) return false;
    if (!inTelegram) return toast('Подписка работает внутри Telegram'), false;
    if (!(await requestWriteAccess())) return toast('Без разрешения бот не сможет вам написать'), false;
    try {
      setSubs(await api.subscribe({ model_id: q.model.id, title: q.model.title, storage_gb: q.storage_gb ?? null, max_price: q.price_max ?? null }));
      haptic.success();
      toast('Готово! Напишем, как только появится');
      return true;
    } catch {
      toast('Не получилось сохранить, попробуйте ещё раз');
      return false;
    }
  };

  const unsubscribe = async (id: number) => {
    haptic.medium();
    setSubs(await api.unsubscribe(id).catch(() => subs));
  };

  const favIds = new Set((favorites ?? []).map((f) => f.id));
  const toggleFav = async (l: Listing) => {
    if (!inTelegram) return toast('Избранное работает внутри Telegram');
    const on = !favIds.has(l.id);
    if (on && !(await requestWriteAccess())) return toast('Без разрешения бот не сможет сообщить о снижении цены');
    setFavorites((prev) => (on ? [l, ...(prev ?? [])] : (prev ?? []).filter((f) => f.id !== l.id)));
    if (on) toast('В избранном — сообщим, если цена снизится');
    api.favorite(l.id, on).catch(() => toast('Не получилось сохранить'));
  };

  const open = (l: Listing) => (haptic.tap(), setDetailId(l.id));
  const preview = detailId !== null ? (items?.find((i) => i.id === detailId) ?? favorites?.find((i) => i.id === detailId) ?? null) : null;
  const scoped = items ? applyFilters(items, { ...EMPTY, category: filters.category, model_id: filters.model_id }) : [];

  const tabs: [Tab, string, typeof IconGrid][] = [
    ['catalog', 'Каталог', IconGrid],
    ['subs', 'Подписки', IconBell],
    ['about', 'О магазине', IconStore],
    ...(admin ? ([['cabinet', 'Кабинет', IconChart]] as [Tab, string, typeof IconGrid][]) : []),
  ];

  if (noStore)
    return (
      <div class="app">
        <div class="page">
          <div class="glow" aria-hidden="true" />
          <div class="panel empty" style={{ marginTop: '40px' }}>
            <Emoji name="sparkles" size={56} />
            <h3>Витрина</h3>
            <p>Магазин внутри Telegram для каналов с техникой. Откройте ссылку на магазин, которую вам прислали.</p>
          </div>
        </div>
      </div>
    );

  return (
    <div class="app">
      <main>
        <div hidden={tab !== 'catalog'}>
          <Storefront
            items={items}
            facets={facets}
            store={store}
            filters={filters}
            setFilters={setFilters}
            error={error}
            onRetry={load}
            onOpen={open}
            onOpenFilters={() => setSheet(true)}
            onSubscribe={subscribe}
            onGoSubs={() => goTab('subs')}
          />
        </div>
        <div hidden={tab !== 'subs'}>
          <Subscriptions subs={subs} favorites={favorites} store={store} onSubscribe={subscribe} onUnsubscribe={unsubscribe} onOpen={open} onToggleFav={toggleFav} />
        </div>
        <div hidden={tab !== 'about'}>
          <About store={store} />
        </div>
        {admin && tab === 'cabinet' && <Cabinet store={store} toast={toast} />}
      </main>

      <nav class={`tabbar ${detailId !== null ? 'away' : ''}`} aria-label="Разделы">
        {tabs.map(([t, label, Icon]) => (
          <button class={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => goTab(t)}>
            <Icon size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <FilterSheet
        open={sheet}
        items={scoped}
        filters={filters}
        onApply={(f) => (setFilters(f), setSheet(false), window.scrollTo({ top: 0 }))}
        onClose={() => setSheet(false)}
      />

      {detailId !== null && (
        <div class="overlay">
          <Detail
            key={detailId}
            id={detailId}
            preview={preview}
            items={items ?? []}
            store={store}
            fav={favIds.has(detailId)}
            onToggleFav={toggleFav}
            onClose={() => setDetailId(null)}
            onOpen={(l) => setDetailId(l.id)}
            onContact={contact}
            onSubscribe={(q) => void subscribe(q)}
            toast={toast}
          />
        </div>
      )}

      <div class={`toast ${toastMsg ? 'show' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  );
}
