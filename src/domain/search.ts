/**
 * Normalizes text by removing diacritics (accents) and converting to lowercase.
 */
export function normalizeText(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

/**
 * Damerau-Levenshtein distance calculation for typo tolerance.
 * Handles substitutions, insertions, deletions, and transpositions.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        const del = matrix[i - 1][j] + 1;
        const ins = matrix[i][j - 1] + 1;
        const sub = matrix[i - 1][j - 1] + 1;
        let dist = Math.min(del, ins, sub);

        if (i > 1 && j > 1 && b.charAt(i - 1) === a.charAt(j - 2) && b.charAt(i - 2) === a.charAt(j - 1)) {
          dist = Math.min(dist, matrix[i - 2][j - 2] + 1);
        }
        matrix[i][j] = dist;
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Smart Search Matching:
 * 1. Accent & diacritics insensitivity ("por do" -> "pôr do sol")
 * 2. Case insensitive
 * 3. Typo-tolerant fuzzy matching ("burgurr" -> "burguer", "chese" -> "cheese", "pasrel" -> "pastel")
 * 4. Multi-word search with stopword handling ("pasrel de frango" -> "Pastel de Frango")
 */
export function smartSearchMatch(text: string | undefined | null, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!text) return false;

  const normText = normalizeText(text);
  const normQuery = normalizeText(query);

  // 1. Direct normalized substring match (handles accents & full phrases instantly)
  if (normText.includes(normQuery)) return true;

  const rawQueryTokens = normQuery.split(/\s+/).filter(Boolean);
  const textTokens = normText.split(/\s+/).filter(Boolean);

  if (rawQueryTokens.length === 0) return true;

  // Filter out 1-2 letter connective stopwords ("de", "do", "da", "e", "a", "o") unless query is only short words
  const mainQueryTokens = rawQueryTokens.filter((t) => t.length > 2);
  const queryTokens = mainQueryTokens.length > 0 ? mainQueryTokens : rawQueryTokens;

  // 2. Token-by-token check: every relevant query token must match at least one text token
  return queryTokens.every((qToken) => {
    // Exact or substring match (e.g. "pas" matches "pastel", "frango" matches "hamburguer-frango")
    if (textTokens.some((tToken) => tToken.includes(qToken) || (tToken.length >= 3 && qToken.startsWith(tToken)))) {
      return true;
    }

    // Fuzzy typo match
    const qLen = qToken.length;
    if (qLen < 4) return false; // Don't fuzzy match 1-3 char words to avoid noise

    const maxDistance = qLen >= 8 ? 2 : 1;

    return textTokens.some((tToken) => {
      // 1. Full word fuzzy match
      if (Math.abs(tToken.length - qLen) <= maxDistance && levenshteinDistance(qToken, tToken) <= maxDistance) {
        return true;
      }
      // 2. Partial prefix fuzzy match (e.g. "pasr" matching "pastel", "burgr" matching "burguer")
      if (tToken.length >= qLen) {
        const tPrefix = tToken.slice(0, qLen);
        if (levenshteinDistance(qToken, tPrefix) <= maxDistance) {
          return true;
        }
      }
      return false;
    });
  });
}
