export const formatPrice = (rub: number) => rub.toLocaleString('ru-RU').replace(/ | /g, ' ') + ' ₽';

export const formatStorage = (gb: number) => (gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`);

/** «iPhone 15 Pro Max 256GB» */
export const listingTitle = (l: { title: string | null; storage_gb?: number | null }) =>
  `${l.title ?? 'Товар'}${l.storage_gb ? ' ' + formatStorage(l.storage_gb) : ''}`;
