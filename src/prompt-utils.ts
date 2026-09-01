import type { PromptCard } from "./types";

export function filterPrompts(
  cards: PromptCard[],
  query: string,
  category: string,
): PromptCard[] {
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

export function buildPrompt(
  template: string,
  answers: Record<string, string>,
): string {
  return template.replace(/{{(\w+)}}/g, (_match, key: string) => {
    const answer = answers[key]?.trim();
    return answer || `[${key.replace(/_/g, " ").toUpperCase()} NEEDED]`;
  });
}

export function toggleFavorite(favorites: string[], id: string): string[] {
  return favorites.includes(id)
    ? favorites.filter((favoriteId) => favoriteId !== id)
    : [...favorites, id];
}
