import { useEffect, useRef, useState } from 'preact/hooks';
import type { AnimationItem } from 'lottie-web';

/**
 * Анимированный эмодзи из набора Telegram RestrictedEmoji (Lottie JSON в /emoji, см. scripts/fetch-emoji.ts).
 * Плеер грузится отдельным чанком, пока он не готов — виден обычный эмодзи.
 */
export type EmojiName =
  | 'phone' | 'search' | 'shrug' | 'retry' | 'bell' | 'fire' | 'star' | 'map'
  | 'car' | 'check' | 'money' | 'megaphone' | 'chat' | 'party' | 'sparkles' | 'gem';

const CHARS: Record<EmojiName, string> = {
  phone: '📱', search: '🔍', shrug: '🤷', retry: '🔄', bell: '🔔', fire: '🔥', star: '⭐️', map: '🗺',
  car: '🚗', check: '✅', money: '💸', megaphone: '📣', chat: '💬', party: '🎉', sparkles: '✨', gem: '💎',
};

let player: Promise<typeof import('lottie-web/build/player/lottie_light').default> | null = null;
const data = new Map<string, Promise<string>>();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const loadPlayer = () => (player ??= import('lottie-web/build/player/lottie_light').then((m) => m.default));
const loadData = (name: string) => {
  if (!data.has(name)) data.set(name, fetch(`/emoji/${name}.json`).then((r) => (r.ok ? r.text() : Promise.reject())));
  return data.get(name)!;
};

interface Props {
  name: EmojiName;
  size?: number;
  /** зациклить — только для крупных акцентов; мелкие проигрываются один раз и по тапу */
  loop?: boolean;
  class?: string;
}

export function Emoji({ name, size = 24, loop = false, class: cls = '' }: Props) {
  const box = useRef<HTMLSpanElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  // грузим анимацию, только когда эмодзи рядом с экраном
  useEffect(() => {
    const el = box.current;
    if (!el || !('IntersectionObserver' in window)) return setVisible(true);
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && (setVisible(true), io.disconnect()), {
      rootMargin: '200px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    Promise.all([loadPlayer(), loadData(name)])
      .then(([lottie, json]) => {
        if (!alive || !box.current) return;
        anim.current = lottie.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: loop && !reduced,
          autoplay: !reduced,
          // плеер меняет переданный объект, поэтому каждому экземпляру — своя копия
          animationData: JSON.parse(json),
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
        });
        anim.current.addEventListener('DOMLoaded', () => alive && setReady(true));
      })
      .catch(() => {});
    return () => {
      alive = false;
      anim.current?.destroy();
      anim.current = null;
    };
  }, [name, loop, visible]);

  const replay = () => {
    const a = anim.current;
    if (a && !loop && !reduced && a.isPaused) a.goToAndPlay(0, true);
  };

  return (
    <span
      class={`emoji-anim ${ready ? 'ready' : ''} ${cls}`}
      style={{ width: size, height: size, fontSize: size * 0.82 }}
      onPointerEnter={replay}
      onClick={replay}
      aria-hidden="true"
    >
      <span class="emoji-fallback">{CHARS[name]}</span>
      <span class="emoji-player" ref={box} />
    </span>
  );
}
