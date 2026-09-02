import type { BaseCard } from "./types";

export function filterPrompts<T extends BaseCard>(
  cards: T[],
  query: string,
  category: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();

  return cards.filter((card) => {
    const inCategory = category === "All" || card.category === category;
    const searchableText = [
      card.title,
      card.description,
      card.category,
      ...card.tags,
    ]
      .join(" ")
      .toLowerCase();

    return inCategory && searchableText.includes(normalizedQuery);
  });
}

export function toggleFavorite(favorites: string[], id: string): string[] {
  return favorites.includes(id)
    ? favorites.filter((favoriteId) => favoriteId !== id)
    : [...favorites, id];
}
