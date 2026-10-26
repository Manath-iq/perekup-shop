import { describe, expect, it } from 'vitest';
import { generateProfile } from './autoprofile';

const posts = [
  '📱 iPhone 16 128GB\n#вналичии\n✅ Акб 88%\n💰 43 990 ₽\nОтзывы',
  '❌ Продано ❌\n📱 iPhone 15 Pro 128GB\n✅ Акб 90%\n💰 45 990 ₽\nОтзывы',
  '📱 iPhone 13 128GB\n#вналичии\n✖️ Царапина\n💰 14 990 ₽\nОтзывы',
  'Друзья, сегодня работаем до 18:00',
];

/** Ответ Gemini подменяется: проверяем, что ошибки модели отсеиваются по реальным текстам */
const fakeGemini = (answer: object) =>
  (async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] })) as unknown as typeof fetch;

describe('автопрофиль', () => {
  it('отбрасывает «не объявление», которое стоит в каждом товарном посте', async () => {
    const g = await generateProfile(posts, {
      apiKey: 'x',
      fetch: fakeGemini({
        mode: 'active_marker',
        activeMarkers: ['#вналичии', '#несуществующий'],
        soldMarkers: ['❌ Продано ❌'],
        ignoreMarkers: ['Отзывы', 'работаем до'],
        priceMarkers: ['💰'],
        plusMarkers: ['✅'],
        nuanceMarkers: ['✖️'],
        conditionLabels: ['Состояние:'],
        defaultBrand: 'apple',
        explanation: 'тест',
      }),
    });
    expect(g.chosen).toBe('generated');
    expect(g.profile.mode).toBe('active_marker');
    expect(g.profile.activeMarkers).toEqual(['#вналичии']);
    expect(g.profile.ignoreMarkers).toContain('работаем до');
    expect(g.profile.ignoreMarkers).not.toContain('Отзывы');
    expect(g.report).toMatchObject({ active: 2, sold: 1, notListing: 1 });
  });
});
