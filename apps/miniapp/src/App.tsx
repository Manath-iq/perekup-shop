import { useEffect, useRef, useState } from 'preact/hooks';
import type { Facets, Listing } from '@vitrina/core/types';
import { api, type StoreInfo } from './api';
import { EMPTY, type Filters } from './filters';
import { copyText, haptic, inTelegram, openTgLink, startListing, tg } from './tg';
import { Catalog } from './components/Catalog';
import { FilterSheet } from './components/FilterSheet';
import { Detail } from './components/Detail';
import { Subscriptions } from './components/Subscriptions';
import { About } from './components/About';
import { IconBell, IconGrid, IconStore } from './icons';

type Tab = 'catalog' | 'subs' | 'about';
const BOT_USERNAME = 'iphone_marketraxi_bot';
const FILTERS_KEY = 'raxi:filters';

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
  const [error, setError] = useState(false);
  const [filters, setFiltersRaw] = useState<Filters>(loadFilters);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<Tab>('catalog');
  const [detailId, setDetailId] = useState<number | null>(startListing);
  const [subPreset, setSubPreset] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const scrollByTab = useRef<Record<Tab, number>>({ catalog: 0, subs: 0, about: 0 });

  const setFilters = (f: Filters) => {
    setFiltersRaw(f);
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
    } catch {}
  };

  const toast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  };

  const load = () => {
    setError(false);
    Promise.all([api.listings(), api.facets()])
      .then(([l, f]) => (setItems(l), setFacets(f)))
      .catch(() => setError(true));
  };

  useEffect(() => {
    load();
    api.store().then(setStore).catch(() => {});
    api.event('app_open');
  }, []);

  // если выбранной модели больше нет в наличии — сбросить чип
  useEffect(() => {
    if (facets && filters.family && !facets.families.some((f) => f.family === filters.family)) setFilters({ ...filters, family: null });
  }, [facets]);

  const goTab = (t: Tab) => {
    if (t === tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
    haptic.select();
    scrollByTab.current[tab] = window.scrollY;
    setTab(t);
    requestAnimationFrame(() => window.scrollTo(0, scrollByTab.current[t] ?? 0));
  };

  const openSubscribe = (family: string | null) => {
    setSubPreset(family);
    setDetailId(null);
    goTab('subs');
  };

  // Кнопка «Назад» Telegram: карточка → каталог (фильтры и прокрутка сохраняются), вкладка → каталог
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

  const buy = async (l: Listing) => {
    haptic.medium();
    let url: string;
    let text: string;
    try {
      ({ url, text } = await api.buy(l.id));
    } catch {
      // вне Telegram заявка не уходит, но чат продавца откроем
      text = `Здравствуйте! Хочу iPhone ${l.family} за ${l.price_rub} ₽ (пост ${l.channel_msg_id})`;
      url = `https://t.me/${store?.seller ?? 'manath'}?text=${encodeURIComponent(text)}`;
    }
    // не все клиенты подставляют ?text= — страхуемся буфером обмена
    const copied = await copyText(text);
    haptic.success();
    if (copied) toast('Текст скопирован — если чат открылся пустым, вставьте его');
    setTimeout(() => openTgLink(url), copied ? 700 : 0);
  };

  const preview = detailId !== null ? items?.find((i) => i.id === detailId) ?? null : null;

  return (
    <div class="app">
      <main class={`tabs tab-${tab}`}>
        <div class="tab-pane" hidden={tab !== 'catalog'}>
          <Catalog
            items={items}
            facets={facets}
            filters={filters}
            setFilters={setFilters}
            storeName={store?.name ?? 'Каталог'}
            error={error}
            onOpen={(l) => (haptic.tap(), setDetailId(l.id))}
            onOpenFilters={() => setSheet(true)}
            onSubscribe={openSubscribe}
            onRetry={load}
          />
        </div>
        <div class="tab-pane" hidden={tab !== 'subs'}>
          <Subscriptions preset={subPreset} available={facets?.families.map((f) => f.family) ?? []} toast={toast} />
        </div>
        <div class="tab-pane" hidden={tab !== 'about'}>
          <About store={store} />
        </div>
      </main>

      <nav class={`tabbar glass-strong ${detailId !== null ? 'away' : ''}`}>
        {([
          ['catalog', 'Каталог', IconGrid],
          ['subs', 'Подписки', IconBell],
          ['about', 'Магазин', IconStore],
        ] as const).map(([t, label, Icon]) => (
          <button class={tab === t ? 'on' : ''} onClick={() => goTab(t)}>
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <FilterSheet
        open={sheet}
        items={items ?? []}
        facets={facets}
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
            botUsername={BOT_USERNAME}
            onClose={() => setDetailId(null)}
            onBuy={buy}
            toast={toast}
          />
        </div>
      )}

      <div class={`toast glass-strong ${toastMsg ? 'show' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  );
}
