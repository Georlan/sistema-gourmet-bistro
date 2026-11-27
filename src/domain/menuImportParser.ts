export interface ParsedMenuItem {
  clientId: string;
  id: string;
  nome: string;
  preco: number;
  categoriaNome: string;
  categoriaId: string;
  destinoImpressao: 'COZINHA' | 'BAR' | 'NENHUM';
  descricao: string;
  needsReview: boolean;
  reviewReason?: string;
  selected: boolean;
}

export interface ParsedMenuResult {
  format: 'tabular' | 'whatsapp_text' | 'empty';
  items: ParsedMenuItem[];
  categories: Array<{ id: string; nome: string; destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' }>;
  warnings: string[];
}

const BEVERAGE_TERMS = [
  'bebida', 'suco', 'refri', 'refrigerante', 'cerveja', 'agua', 'água',
  'drink', 'cha', 'chá', 'cafe', 'café', 'vinho', 'energetico', 'energético', 'milkshake',
];

export function slugifyCategoryId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `cat-${normalized || 'geral'}`;
}

export function inferCategoryPrintDestination(categoryName: string): 'COZINHA' | 'BAR' | 'NENHUM' {
  const lower = categoryName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (BEVERAGE_TERMS.some((term) => lower.includes(term.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')))) {
    return 'NENHUM';
  }
  return 'COZINHA';
}

function stableShortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}

export function buildDeterministicImportProductId(nome: string, categoriaId: string): string {
  const slug = nome
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'item';
  const hash = stableShortHash(`${categoriaId}::${nome.trim().toLowerCase()}`);
  return `imp-${slug}-${hash}`;
}

function parseBrlNumber(raw: string): number | null {
  let cleaned = raw.trim().replace(/^r\$\s*/i, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0 || num > 100_000) return null;
  return Math.round(num * 100) / 100;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map((col) => col.trim());
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function detectTabularDelimiter(lines: string[]): string | null {
  const sample = lines.slice(0, Math.min(lines.length, 6));
  const candidates = ['\t', ';', ','];
  for (const delim of candidates) {
    const counts = sample.map((line) => splitDelimitedLine(line, delim).length);
    if (counts.length >= 1 && counts.every((count) => count >= 2) && new Set(counts).size <= 2) {
      return delim;
    }
  }
  return null;
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.map((c) => c.toLowerCase()).join('|');
  return /(nome|produto|item|prato)/.test(joined) && /(preco|preço|valor|price)/.test(joined);
}

function parseTabularLines(lines: string[], delimiter: string, defaultCategory: string): ParsedMenuResult {
  const firstCells = splitDelimitedLine(lines[0], delimiter);
  let nameIdx = 0;
  let priceIdx = 1;
  let categoryIdx = -1;
  let descIdx = -1;
  let startIndex = 0;

  if (isHeaderRow(firstCells)) {
    startIndex = 1;
    firstCells.forEach((rawHeader, idx) => {
      const h = rawHeader.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (/^(nome|produto|item|prato)$/.test(h)) nameIdx = idx;
      else if (/^(preco|valor|price)$/.test(h)) priceIdx = idx;
      else if (/^(categoria|grupo|secao|setor)$/.test(h)) categoryIdx = idx;
      else if (/^(descricao|detalhes|ingredientes|obs)$/.test(h)) descIdx = idx;
    });
  } else if (firstCells.length >= 3) {
    // Heurística comum: Categoria ; Produto ; Preço ; Descrição OR Nome ; Preço ; Categoria ; Descrição
    const secondPrice = parseBrlNumber(firstCells[1] || '');
    const thirdPrice = parseBrlNumber(firstCells[2] || '');
    if (secondPrice !== null) {
      nameIdx = 0;
      priceIdx = 1;
      categoryIdx = 2;
      if (firstCells.length >= 4) descIdx = 3;
    } else if (thirdPrice !== null) {
      categoryIdx = 0;
      nameIdx = 1;
      priceIdx = 2;
      if (firstCells.length >= 4) descIdx = 3;
    }
  }

  const items: ParsedMenuItem[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (let i = startIndex; i < lines.length; i += 1) {
    const cells = splitDelimitedLine(lines[i], delimiter);
    const nome = (cells[nameIdx] || '').trim();
    if (!nome) continue;

    const rawPrice = cells[priceIdx] || '';
    const parsedPrice = parseBrlNumber(rawPrice);
    const categoriaNome = (categoryIdx >= 0 ? cells[categoryIdx] : '')?.trim() || defaultCategory;
    const categoriaId = slugifyCategoryId(categoriaNome);
    const descricao = (descIdx >= 0 ? cells[descIdx] : '')?.trim() || '';
    const destinoImpressao = inferCategoryPrintDestination(categoriaNome);

    let id = buildDeterministicImportProductId(nome, categoriaId);
    if (seenIds.has(id)) {
      id = `${id}-${i + 1}`;
    }
    seenIds.add(id);

    const needsReview = parsedPrice === null;
    items.push({
      clientId: `${id}-${i}`,
      id,
      nome,
      preco: parsedPrice ?? 0,
      categoriaNome,
      categoriaId,
      destinoImpressao,
      descricao,
      needsReview,
      reviewReason: needsReview ? 'Preço não identificado na linha; revise antes de publicar.' : undefined,
      selected: true,
    });
  }

  if (items.some((item) => item.needsReview)) {
    warnings.push('Algumas linhas estavam sem preço válido e foram marcadas para revisão.');
  }

  const categories = buildCategorySummaries(items);
  return { format: 'tabular', items, categories, warnings };
}

function looksLikeCategoryHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/R\$\s*\d|\d+[,.]\d{2}\b/.test(trimmed)) return null;

  // *CATEGORIA* or === CATEGORIA === or --- CATEGORIA ---
  const wrapped = trimmed.match(/^(?:[*_=-]{1,4}\s*)([^*_=-]{2,48}?)(?:\s*[*_=-]{1,4})$/);
  if (wrapped) return wrapped[1].trim();

  // CATEGORIA: (termina com dois pontos e sem preço)
  const colonHeading = trimmed.match(/^([^:]{2,45}):$/);
  if (colonHeading) return colonHeading[1].trim();

  // Linha curta toda em maiúsculas (ex: HAMBURGUERES, BEBIDAS)
  const cleanLetters = trimmed.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (
    cleanLetters.length >= 3
    && cleanLetters.length <= 36
    && cleanLetters === cleanLetters.toUpperCase()
    && /[A-ZÀ-Ú]/.test(cleanLetters)
    && !/^\d+$/.test(cleanLetters)
  ) {
    return cleanLetters.charAt(0) + cleanLetters.slice(1).toLowerCase();
  }
  return null;
}

function extractPriceFromTextLine(line: string): { nome: string; preco: number | null; descricao: string } {
  const cleaned = line.replace(/^[-•*]\s+/, '').trim();
  // Match R$ 25,00 or R$25 or 25,00 at end or separated by -, |, :, dots
  const endPriceMatch = cleaned.match(/^(.*?)(?:\s*[-–|:.·]+\s*|\s+)(?:R\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*$/i);
  if (endPriceMatch) {
    const rawNamePart = endPriceMatch[1].trim().replace(/[-–.:·|]+$/, '').trim();
    const candidatePrice = parseBrlNumber(endPriceMatch[2]);
    const hasExplicitCurrencyOrDecimal = /R\$|[.,]\d{2}/i.test(cleaned.slice(endPriceMatch[1].length));
    if (rawNamePart && candidatePrice !== null && hasExplicitCurrencyOrDecimal) {
      const parenDesc = rawNamePart.match(/^(.+?)\s*\(([^()]{3,120})\)$/);
      return {
        nome: parenDesc ? parenDesc[1].trim() : rawNamePart,
        preco: candidatePrice,
        descricao: parenDesc ? parenDesc[2].trim() : '',
      };
    }
  }
  // Match price at start: "25,00 - X-Bacon"
  const startPriceMatch = cleaned.match(/^(?:R\$\s*)?(\d{1,5}[.,]\d{2})\s*[-–|:]\s*(.+)$/i);
  if (startPriceMatch) {
    const candidatePrice = parseBrlNumber(startPriceMatch[1]);
    if (candidatePrice !== null) {
      return {
        nome: startPriceMatch[2].trim(),
        preco: candidatePrice,
        descricao: '',
      };
    }
  }
  return { nome: cleaned, preco: null, descricao: '' };
}

function looksLikeIngredientDescription(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (/^(ingredientes|acompanha|contém|contem|obs|descrição|descricao)\s*:/i.test(trimmed)) {
    return true;
  }
  if (trimmed.includes(',')) return true;
  const firstChar = trimmed.charAt(0);
  if (firstChar && firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase()) {
    return true;
  }
  return false;
}
function buildCategorySummaries(items: ParsedMenuItem[]) {
  const map = new Map<string, { id: string; nome: string; destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' }>();
  for (const item of items) {
    if (!map.has(item.categoriaId)) {
      map.set(item.categoriaId, {
        id: item.categoriaId,
        nome: item.categoriaNome,
        destino_impressao: item.destinoImpressao,
      });
    }
  }
  return Array.from(map.values());
}

export function parseMenuImportText(rawText: string, defaultCategory = 'Geral'): ParsedMenuResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { format: 'empty', items: [], categories: [], warnings: [] };
  }

  const tabularDelimiter = detectTabularDelimiter(lines);
  if (tabularDelimiter) {
    return parseTabularLines(lines, tabularDelimiter, defaultCategory);
  }

  const items: ParsedMenuItem[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  let currentCategory = defaultCategory;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = looksLikeCategoryHeading(line);
    if (heading) {
      currentCategory = heading;
      continue;
    }

    const extracted = extractPriceFromTextLine(line);
    // Check if next line is an ingredient/description line without price
    let descricao = extracted.descricao;
    if (
      !descricao
      && extracted.preco !== null
      && i + 1 < lines.length
      && !looksLikeCategoryHeading(lines[i + 1])
      && extractPriceFromTextLine(lines[i + 1]).preco === null
      && !/^[-•*]/.test(lines[i + 1])
      && looksLikeIngredientDescription(lines[i + 1])
    ) {
      descricao = lines[i + 1];
      i += 1;
    }

    const categoriaId = slugifyCategoryId(currentCategory);
    let id = buildDeterministicImportProductId(extracted.nome, categoriaId);
    if (seenIds.has(id)) {
      id = `${id}-${i + 1}`;
    }
    seenIds.add(id);

    const needsReview = extracted.preco === null;
    items.push({
      clientId: `${id}-${i}`,
      id,
      nome: extracted.nome,
      preco: extracted.preco ?? 0,
      categoriaNome: currentCategory,
      categoriaId,
      destinoImpressao: inferCategoryPrintDestination(currentCategory),
      descricao,
      needsReview,
      reviewReason: needsReview ? 'Preço não encontrado; preencha antes de publicar.' : undefined,
      selected: true,
    });
  }

  if (items.some((item) => item.needsReview)) {
    warnings.push('Linhas sem preço foram preservadas como pendentes de revisão (nenhum preço foi inventado).');
  }

  return {
    format: 'whatsapp_text',
    items,
    categories: buildCategorySummaries(items),
    warnings,
  };
}
