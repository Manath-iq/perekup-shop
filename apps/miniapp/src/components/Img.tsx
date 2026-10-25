import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Картинка с мягким появлением. Учитывает уже закэшированные файлы, у которых onLoad мог пройти до подписки. */
export function Img({ src, eager, alt = '' }: { src: string; eager?: boolean; alt?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  useLayoutEffect(() => {
    const img = ref.current;
    setState(img?.complete && img.naturalWidth ? 'loaded' : 'loading');
  }, [src]);
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      class={state}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={() => setState('loaded')}
      onError={() => setState('error')}
    />
  );
}
