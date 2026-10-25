import { useEffect, useState } from 'preact/hooks';
import type { Subscription } from '@vitrina/core/types';
import { formatPrice, formatStorage } from '@vitrina/core/parser';
import { api } from '../api';
import { ALL_FAMILIES, STORAGE_OPTIONS } from '../filters';
import { haptic, inTelegram, requestWriteAccess } from '../tg';
import { IconTrash } from '../icons';
import { Emoji } from './Emoji';

interface Props {
  preset: string | null;
  available: string[];
  toast: (msg: string) => void;
}

export function Subscriptions({ preset, available, toast }: Props) {
  const [family, setFamily] = useState<string | null>(preset);
  const [storage, setStorage] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setFamily(preset), [preset]);
  useEffect(() => {
    if (inTelegram) api.subscriptions().then(setSubs).catch(() => setSubs([]));
    else setSubs([]);
  }, []);

  // сначала те модели, что сейчас есть, потом остальные
  const families = [...available, ...ALL_FAMILIES.filter((f) => !available.includes(f))];

  const save = async () => {
    if (!family) return;
    if (!inTelegram) return toast('Подписка работает внутри Telegram');
    setSaving(true);
    haptic.tap();
    const ok = await requestWriteAccess();
    if (!ok) {
      setSaving(false);
      return toast('Без разрешения бот не сможет написать вам');
    }
    try {
      const price = parseInt(maxPrice.replace(/\D/g, ''), 10) || null;
      setSubs(await api.subscribe({ family, storage_gb: storage, max_price: price }));
      haptic.success();
      toast('Готово! Напишем, как только появится');
      setStorage(null);
      setMaxPrice('');
    } catch {
      toast('Не получилось сохранить, попробуйте ещё раз');
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    haptic.medium();
    setSubs(await api.unsubscribe(id));
  };

  return (
    <div class="screen page">
      <div class="page-hero">
        <Emoji name="bell" size={84} loop class="hero-emoji" />
        <h1>Сообщить, когда появится</h1>
        <p>Выберите модель — бот пришлёт сообщение, как только такой телефон появится в наличии.</p>
      </div>

      <section class="group">
        <h3>
          Модель <span class="req">обязательно</span>
        </h3>
        <div class="chips wrap">
          {families.map((f) => (
            <button class={`chip ${family === f ? 'on' : ''} ${available.includes(f) ? 'has' : ''}`} onClick={() => (haptic.select(), setFamily(f))}>
              {f}
            </button>
          ))}
        </div>
      </section>

      <section class="group">
        <h3>Память</h3>
        <div class="segmented">
          {[null, ...STORAGE_OPTIONS].map((gb) => (
            <button class={storage === gb ? 'on' : ''} onClick={() => (haptic.select(), setStorage(gb))}>
              {gb ? formatStorage(gb) : 'Любая'}
            </button>
          ))}
        </div>
      </section>

      <section class="group">
        <h3>Цена до</h3>
        <label class="field">
          <input
            inputMode="numeric"
            placeholder="Например, 50 000"
            value={maxPrice}
            onInput={(e) => {
              const d = e.currentTarget.value.replace(/\D/g, '').slice(0, 7);
              setMaxPrice(d ? (+d).toLocaleString('ru-RU') : '');
            }}
          />
          <span>₽</span>
        </label>
      </section>

      <button class="btn-primary big block" disabled={!family || saving} onClick={save}>
        {family ? `Подписаться на iPhone ${family}` : 'Выберите модель'}
      </button>

      {subs && subs.length > 0 && (
        <section class="group">
          <h3>Мои подписки</h3>
          <ul class="list subs">
            {subs.map((s) => (
              <li>
                <div>
                  <b>iPhone {s.family}</b>
                  <span class="muted">
                    {[s.storage_gb ? formatStorage(s.storage_gb) : 'любая память', s.max_price ? `до ${formatPrice(s.max_price)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <button class="icon-btn danger" onClick={() => remove(s.id)} aria-label="Удалить подписку">
                  <IconTrash size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
