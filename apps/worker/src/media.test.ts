import { describe, expect, it } from 'vitest';
import { parseRange, pickPhotoSizes } from './media';
import { parseEmbed } from '@vitrina/core/scrape';

describe('размеры фото Telegram', () => {
  const sizes = [
    { file_id: 's', width: 90, height: 68 },
    { file_id: 'm', width: 320, height: 240 },
    { file_id: 'x', width: 800, height: 600 },
    { file_id: 'y', width: 1280, height: 960 },
    { file_id: 'w', width: 2560, height: 1920 },
  ];
  it('галерея ≤1600, обложка от 640, превью — самое маленькое', () => {
    const p = pickPhotoSizes(sizes);
    expect([p.gallery.file_id, p.cover.file_id, p.blur?.file_id]).toEqual(['y', 'x', 's']);
  });
  it('одно маленькое фото — оно и галерея, и обложка, без превью', () => {
    const p = pickPhotoSizes([{ file_id: 'm', width: 320, height: 240 }]);
    expect([p.gallery.file_id, p.cover.file_id, p.blur]).toEqual(['m', 'm', null]);
  });
});

describe('Range', () => {
  it.each([
    ['bytes=0-1', { start: 0, end: 1 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
    ['bytes=2000-', null],
    ['items=0-1', null],
    [null, null],
  ])('%s', (h, out) => expect(parseRange(h, 1000)).toEqual(out));
});

describe('embed-страница поста', () => {
  it('находит фото альбома по их собственным id', () => {
    const html = `<div class="tgme_widget_message_text js-message_text">iPhone 16<br/>💰 43 990 ₽</div>
      <a class="tgme_widget_message_photo_wrap grouped_media_wrap" style="background-image:url('https://cdn/a.jpg')" href="https://t.me/ch/10?single"></a>
      <a class="tgme_widget_message_photo_wrap grouped_media_wrap" style="background-image:url('https://cdn/b.jpg')" href="https://t.me/ch/11?single"></a>
      <a class="tgme_widget_message_video_player" href="https://t.me/ch/12?single"><i style="background-image:url('https://cdn/p.jpg')"></i><video src="https://cdn/v.mp4?token=1&amp;x=2"></video></a>`;
    const e = parseEmbed(html, 10);
    expect(e.text).toBe('iPhone 16\n💰 43 990 ₽');
    expect(e.media.map((m) => [m.msg_id, m.kind, m.url])).toEqual([
      [10, 'photo', 'https://cdn/a.jpg'],
      [11, 'photo', 'https://cdn/b.jpg'],
      [12, 'video', 'https://cdn/v.mp4?token=1&x=2'],
    ]);
    expect(e.media[2].thumb).toBe('https://cdn/p.jpg');
  });
});

describe('файлы Bot API', () => {
  it('переспрашивает getFile, если file_path протух, и не светит токен наружу', async () => {
    const { fetchSource } = await import('./media');
    const calls: string[] = [];
    let getFileCalls = 0;
    const fake = async (url: string) => {
      calls.push(url);
      if (url.includes('/getFile')) {
        getFileCalls++;
        return Response.json({ ok: true, result: { file_path: getFileCalls === 1 ? 'old/path.jpg' : 'new/path.jpg' } });
      }
      return url.endsWith('old/path.jpg') ? new Response('gone', { status: 404 }) : new Response('JPEG');
    };
    const orig = globalThis.fetch;
    globalThis.fetch = fake as unknown as typeof fetch;
    try {
      const res = await fetchSource({ BOT_TOKEN: '123:SECRET' } as never, 'tg:FILE_A');
      expect(await res?.text()).toBe('JPEG');
      expect(getFileCalls).toBe(2);
      expect(calls.every((u) => u.startsWith('https://api.telegram.org/'))).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
