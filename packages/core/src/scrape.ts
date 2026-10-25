/** Разбор публичной ленты t.me/s/<channel>. Без зависимостей — работает и в Workers, и в Node. */

export interface ScrapedMedia {
  kind: 'photo' | 'video';
  url: string;
  /** превью для видео */
  thumb?: string;
  msg_id: number;
  ratio: number | null;
}

export interface ScrapedPost {
  msg_id: number;
  text: string;
  date: number;
  media: ScrapedMedia[];
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');

export function htmlToText(fragment: string): string {
  return decode(
    fragment
      .replace(/<br\s*\/?>/gi, '\n')
      // эмодзи в ленте — <i class="emoji"><b>🔥</b></i>
      .replace(/<i class="emoji"[^>]*><b>(.*?)<\/b><\/i>/g, '$1')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Фото и видео из куска HTML ленты или embed-страницы. У фото альбома своя ссылка `…/<id>?single`. */
export function extractMedia(block: string, postId: number): ScrapedMedia[] {
  const media: ScrapedMedia[] = [];
  const re = /<a class="tgme_widget_message_(photo_wrap|video_player)[^"]*"([^>]*)>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const attrs = m[2];
    const inner = m[3];
    const href = attrs.match(/href="[^"]*\/(\d+)\?single"/);
    const ratio = attrs.match(/data-ratio="([\d.]+)"/);
    const msg_id = href ? +href[1] : postId;
    if (m[1] === 'photo_wrap') {
      const bg = attrs.match(/background-image:url\('([^']+)'\)/);
      if (bg) media.push({ kind: 'photo', url: bg[1], msg_id, ratio: ratio ? +ratio[1] : null });
    } else {
      const src = inner.match(/<video[^>]*src="([^"]+)"/);
      const thumb = inner.match(/background-image:url\('([^']+)'\)/);
      if (src) media.push({ kind: 'video', url: decode(src[1]), thumb: thumb?.[1], msg_id, ratio: ratio ? +ratio[1] : null });
    }
  }
  // одиночное фото без альбома
  if (!media.length) {
    const single = block.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*background-image:url\('([^']+)'\)/);
    if (single) media.push({ kind: 'photo', url: single[1], msg_id: postId, ratio: null });
  }
  return media.sort((a, c) => a.msg_id - c.msg_id);
}

const messageText = (block: string) => {
  const m = block.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);
  return m ? htmlToText(m[1]).trim() : '';
};

export function parseFeed(html: string, channel: string): ScrapedPost[] {
  const posts: ScrapedPost[] = [];
  const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const idm = b.match(new RegExp(`data-post="${channel}/(\\d+)"`, 'i'));
    if (!idm) continue;
    const datem = b.match(/datetime="([^"]+)"/);
    posts.push({
      msg_id: +idm[1],
      text: messageText(b),
      date: datem ? Math.floor(Date.parse(datem[1]) / 1000) : Math.floor(Date.now() / 1000),
      media: extractMedia(b, +idm[1]),
    });
  }
  return posts;
}

/** Страница одного поста `t.me/<канал>/<id>?embed=1`: текст и свежие ссылки на медиа */
export function parseEmbed(html: string, msgId: number): { text: string; media: ScrapedMedia[] } {
  return { text: messageText(html), media: extractMedia(html, msgId) };
}

/** Есть ли пост на публичной странице (для cron-проверки удалений) */
export function embedHasPost(html: string): boolean {
  return /tgme_widget_message_text|tgme_widget_message_photo|tgme_widget_message_video/.test(html) &&
    !/tgme_widget_message_error/.test(html);
}
