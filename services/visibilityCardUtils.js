/** Predicate scheda visibilità usabile in dialer / batch (nessuna dipendenza Serp/Claude). */

export function isUsableVisibilityCard(card) {
  if (!card || typeof card !== 'object') return false;
  const place = card.place;
  if (!place || place.error) return false;
  if (!place.placeId && !place.name) return false;
  if (card.ranking?.error === 'no place' || card.velocity?.error === 'no place') return false;
  return true;
}

export default { isUsableVisibilityCard };
