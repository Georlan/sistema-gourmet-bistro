export type ExpressOperationProfile = 'generic' | 'pizzaria' | 'acai' | 'churrasco' | 'marmitaria';

export type ExpressOrderType = 'delivery' | 'retirada' | 'consumo_local';

export interface ExpressParsedHourRow {
  days: string;
  hours: string;
}

export interface ExpressParsedMenuItem {
  name: string;
  price: number;
  category: string;
  categoryId: string;
  printDestination: 'COZINHA' | 'BAR' | 'NENHUM';
  description: string;
}

export interface ExpressParsedResult {
  fields: {
    name: string;
    slug: string;
    plan: 'pocket' | 'pro' | 'black';
    segmentLabel: string | null;
    operationProfile: ExpressOperationProfile;
    segmentPreset: string | null;
    adminName: string;
    adminEmail: string;
    phone: string | null;
    address: string | null;
    orderTypes: ExpressOrderType[];
    operatingHours: ExpressParsedHourRow[];
  };
  menuItems: ExpressParsedMenuItem[];
  categories: Array<{ id: string; nome: string; destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' }>;
  missingRequiredFields: string[];
  warnings: string[];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const PROFILE_KEYWORDS: ReadonlyArray<readonly [string, ExpressOperationProfile, string]> = [
  ['pizz', 'pizzaria', 'pizzaria'],
  ['marmit', 'marmitaria', 'marmitaria'],
  ['quentinha', 'marmitaria', 'marmitaria'],
  ['prato feito', 'marmitaria', 'marmitaria'],
  ['pf', 'marmitaria', 'marmitaria'],
  ['acai', 'acai', 'acaiteria'],
  ['sorvet', 'acai', 'acaiteria'],
  ['churras', 'churrasco', 'restaurante'],
  ['espet', 'churrasco', 'restaurante'],
  ['hamburg', 'generic', 'hamburgueria'],
  ['burger', 'generic', 'hamburgueria'],
  ['lanch', 'generic', 'hamburgueria'],
  ['pastel', 'generic', 'pastelaria'],
  ['restaurante', 'generic', 'restaurante'],
  ['bistro', 'generic', 'restaurante'],
];

const DAY_TOKEN_NORMALIZATION: ReadonlyArray<readonly [string, string]> = [
  ['todos os dias', 'Todos os dias'],
  ['todo dia', 'Todos os dias'],
  ['diariamente', 'Todos os dias'],
  ['segunda a domingo', 'Segunda a Domingo'],
  ['seg a dom', 'Segunda a Domingo'],
  ['segunda a sabado', 'Segunda a Sábado'],
  ['seg a sab', 'Segunda a Sábado'],
  ['segunda a sexta', 'Segunda a Sexta'],
  ['seg a sex', 'Segunda a Sexta'],
  ['segunda a quinta', 'Segunda a Quinta'],
  ['seg a qui', 'Segunda a Quinta'],
  ['quarta a domingo', 'Quarta a Domingo'],
  ['qua a dom', 'Quarta a Domingo'],
  ['quinta a domingo', 'Quinta a Domingo'],
  ['qui a dom', 'Quinta a Domingo'],
  ['sexta a domingo', 'Sexta a Domingo'],
  ['sex a dom', 'Sexta a Domingo'],
  ['sexta e sabado', 'Sexta e Sábado'],
  ['sabado e domingo', 'Sábado e Domingo'],
  ['sab e dom', 'Sábado e Domingo'],
  ['fim de semana', 'Sábado e Domingo'],
];

const KEY_ALIASES: Record<string, string> = {
  nome: 'name',
  restaurante: 'name',
  'nome do restaurante': 'name',
  estabelecimento: 'name',
  loja: 'name',
  slug: 'slug',
  subdominio: 'slug',
  segmento: 'segment',
  tipo: 'segment',
  perfil: 'segment',
  'tipo de operacao': 'segment',
  'categoria do negocio': 'segment',
  responsavel: 'adminName',
  administrador: 'adminName',
  admin: 'adminName',
  dono: 'adminName',
  proprietario: 'adminName',
  'seu nome': 'adminName',
  contato: 'adminName',
  email: 'adminEmail',
  'e mail': 'adminEmail',
  'email admin': 'adminEmail',
  'email do administrador': 'adminEmail',
  whatsapp: 'phone',
  telefone: 'phone',
  celular: 'phone',
  fone: 'phone',
  endereco: 'address',
  local: 'address',
  logradouro: 'address',
  atendimento: 'orderTypes',
  modalidades: 'orderTypes',
  modalidade: 'orderTypes',
  'tipos de pedido': 'orderTypes',
  horario: 'operatingHours',
  horarios: 'operatingHours',
  'horario de funcionamento': 'operatingHours',
  funcionamento: 'operatingHours',
  plano: 'plan',
  plan: 'plan',
  cardapio: 'menu',
  menu: 'menu',
  produtos: 'menu',
  itens: 'menu',
};

const BEVERAGE_TERMS = [
  'bebida',
  'suco',
  'refri',
  'refrigerante',
  'cerveja',
  'agua',
  'drink',
  'cha',
  'cafe',
  'vinho',
  'energetico',
  'milkshake',
];

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(rawKey: string): string {
  return stripAccents(rawKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugifyRestaurantName(name: string): string {
  const clean = stripAccents(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return clean || 'restaurante';
}

function slugifyCategoryId(name: string): string {
  const clean = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `cat-${clean || 'geral'}`;
}

function inferCategoryDestination(name: string): 'COZINHA' | 'BAR' | 'NENHUM' {
  const lower = normalizeKey(name);
  if (BEVERAGE_TERMS.some((term) => lower.includes(term))) {
    return 'NENHUM';
  }
  return 'COZINHA';
}

function resolveSegment(rawSegment?: string | null): {
  operationProfile: ExpressOperationProfile;
  segmentPreset: string | null;
  segmentLabel: string | null;
} {
  const cleaned = (rawSegment || '').trim();
  if (!cleaned) {
    return { operationProfile: 'generic', segmentPreset: null, segmentLabel: null };
  }
  const normalized = normalizeKey(cleaned);
  for (const [keyword, operationProfile, segmentPreset] of PROFILE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return { operationProfile, segmentPreset, segmentLabel: cleaned };
    }
  }
  return { operationProfile: 'generic', segmentPreset: 'restaurante', segmentLabel: cleaned };
}

function parseOrderTypes(rawValue: unknown): ExpressOrderType[] {
  const tokens = Array.isArray(rawValue)
    ? rawValue.map((item) => String(item))
    : String(rawValue || '').split(/[,;/|+]+|\be\b/i);

  const out: ExpressOrderType[] = [];
  for (const token of tokens) {
    const norm = normalizeKey(token);
    if (!norm) continue;
    let mapped: ExpressOrderType | null = null;
    if (norm.includes('delivery') || norm.includes('entrega') || norm.includes('tele')) {
      mapped = 'delivery';
    } else if (
      norm.includes('retirada')
      || norm.includes('balcao')
      || norm.includes('takeaway')
      || norm.includes('take away')
      || norm.includes('buscar')
    ) {
      mapped = 'retirada';
    } else if (
      norm.includes('salao')
      || norm.includes('mesa')
      || norm.includes('consumo')
      || norm.includes('local')
      || norm.includes('presencial')
    ) {
      mapped = 'consumo_local';
    }
    if (mapped && !out.includes(mapped)) {
      out.push(mapped);
    }
  }
  return out;
}

function formatHhmm(hourRaw: string, minuteRaw?: string): string | null {
  const h = Number.parseInt(hourRaw, 10);
  const m = Number.parseInt(minuteRaw || '0', 10);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseExpressOperatingHours(rawValue: unknown): ExpressParsedHourRow[] {
  if (Array.isArray(rawValue)) {
    return rawValue
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .map((entry) => ({
        days: String(entry.days ?? entry.dias ?? '').trim(),
        hours: String(entry.hours ?? entry.horas ?? entry.horario ?? '').trim(),
      }))
      .filter((row) => row.days.length > 0 && row.hours.length > 0);
  }

  const rawText = String(rawValue || '').trim();
  if (!rawText) return [];

  const chunks = rawText
    .split(/[;\n]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const norm = normalizeKey(chunk);
    let daysLabel = 'Todos os dias';
    for (const [pattern, label] of DAY_TOKEN_NORMALIZATION) {
      if (norm.includes(pattern)) {
        daysLabel = label;
        break;
      }
    }

    const matches = [...chunk.toLowerCase().matchAll(/\b([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\s*h?\b/g)];
    const validTimes = matches
      .map((match) => formatHhmm(match[1], match[2]))
      .filter((item): item is string => Boolean(item));

    if (validTimes.length >= 2) {
      return { days: daysLabel, hours: `${validTimes[0]} - ${validTimes[1]}` };
    }
    if (norm.includes('24h') || norm.includes('24 horas') || norm.includes('24hrs')) {
      return { days: daysLabel, hours: '00:00 - 23:59' };
    }
    return { days: daysLabel, hours: chunk };
  });
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
  const num = Math.round(Number(cleaned) * 100) / 100;
  if (!Number.isFinite(num) || num < 0 || num > 100_000) return null;
  return num;
}

function looksLikeCategoryHeading(line: string): string | null {
  const trimmed = line.trim().replace(/^[-•*]+\s*/, '').trim();
  if (!trimmed) return null;
  if (/r\$\s*\d|\d+[,.]\d{2}\b/i.test(trimmed)) return null;
  if (trimmed.endsWith(':')) {
    const candidate = trimmed.slice(0, -1).trim();
    if (candidate.length >= 2 && candidate.length <= 60) {
      return candidate;
    }
  }
  const wrapped = trimmed.match(/^(?:[*_=-]{1,4}\s*)([^*_=-]{2,48}?)(?:\s*[*_=-]{1,4})$/);
  return wrapped ? wrapped[1].trim() : null;
}

function parseMenuLines(
  lines: string[],
  defaultCategory = 'Cardápio',
): { items: ExpressParsedMenuItem[]; warnings: string[] } {
  const items: ExpressParsedMenuItem[] = [];
  const warnings: string[] = [];
  let currentCategory = defaultCategory;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const heading = looksLikeCategoryHeading(trimmed);
    if (heading) {
      currentCategory = heading;
      continue;
    }

    const cleaned = trimmed.replace(/^[-•*]\s+/, '').trim();
    let handledDelimited = false;
    for (const delim of ['\t', ';', '|']) {
      if (!cleaned.includes(delim)) continue;
      const parts = cleaned
        .split(delim)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const secondPrice = parseBrlNumber(parts[1]);
        if (secondPrice !== null) {
          items.push({
            name: parts[0],
            price: secondPrice,
            category: currentCategory,
            categoryId: slugifyCategoryId(currentCategory),
            printDestination: inferCategoryDestination(currentCategory),
            description: parts[2] || '',
          });
          handledDelimited = true;
          break;
        }
        const thirdPrice = parts.length >= 3 ? parseBrlNumber(parts[2]) : null;
        if (thirdPrice !== null) {
          const catName = parts[0];
          items.push({
            name: parts[1],
            price: thirdPrice,
            category: catName,
            categoryId: slugifyCategoryId(catName),
            printDestination: inferCategoryDestination(catName),
            description: parts[3] || '',
          });
          handledDelimited = true;
          break;
        }
      }
    }
    if (handledDelimited) continue;

    const endMatch = cleaned.match(
      /^(.*?)(?:\s*[-–|:.·]+\s*|\s+)(?:R\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*$/i,
    );
    if (endMatch) {
      const rawName = endMatch[1].trim().replace(/[-–.:·|]+$/, '').trim();
      const suffix = cleaned.slice(endMatch[1].length);
      const hasCurrencyOrDecimals = /r\$|[.,]\d{2}/i.test(suffix);
      const price = hasCurrencyOrDecimals ? parseBrlNumber(endMatch[2]) : null;
      if (rawName && price !== null) {
        const paren = rawName.match(/^(.+?)\s*\(([^()]{3,160})\)$/);
        items.push({
          name: paren ? paren[1].trim() : rawName,
          price,
          category: currentCategory,
          categoryId: slugifyCategoryId(currentCategory),
          printDestination: inferCategoryDestination(currentCategory),
          description: paren ? paren[2].trim() : '',
        });
        continue;
      }
    }

    warnings.push(`Linha de cardápio sem preço identificável e ignorada sem invenção: '${cleaned}'.`);
  }

  return { items, warnings };
}

export function parseExpressOnboardingText(
  rawInput: string,
  options?: { requireAdminCredentials?: boolean },
): ExpressParsedResult {
  const requireAdminCredentials = options?.requireAdminCredentials ?? true;
  const warnings: string[] = [];
  const fields: Record<string, unknown> = {};
  const menuLines: string[] = [];
  let rawJson: Record<string, unknown> | null = null;

  const trimmed = (rawInput || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rawJson = parsed as Record<string, unknown>;
      } else {
        warnings.push('O JSON estruturado precisa ser um objeto na raiz.');
      }
    } catch {
      warnings.push('JSON inválido informado no texto estruturado.');
    }
  } else if (trimmed) {
    let inMenuBlock = false;
    for (const rawLine of trimmed.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      if (!inMenuBlock) {
        const kvMatch = rawLine.match(/^\s*([^:]{2,48}):\s*(.*)$/);
        if (kvMatch) {
          const canonicalKey = KEY_ALIASES[normalizeKey(kvMatch[1])];
          const rawVal = kvMatch[2].trim();
          if (canonicalKey === 'menu') {
            inMenuBlock = true;
            if (rawVal) {
              menuLines.push(
                ...rawVal
                  .split(/\s*;\s*/)
                  .map((part) => part.trim())
                  .filter(Boolean),
              );
            }
            continue;
          }
          if (canonicalKey) {
            fields[canonicalKey] = rawVal;
            continue;
          }
        }
        if (looksLikeCategoryHeading(rawLine) || /r\$\s*\d|\d+[,.]\d{2}\b/i.test(rawLine)) {
          inMenuBlock = true;
          menuLines.push(rawLine);
        } else {
          warnings.push(`Linha não reconhecida e preservada fora dos campos: '${rawLine.trim()}'.`);
        }
      } else {
        const kvMatch = rawLine.match(/^\s*([^:]{2,48}):\s*(.+)$/);
        if (kvMatch) {
          const maybeKey = KEY_ALIASES[normalizeKey(kvMatch[1])];
          if (maybeKey && maybeKey !== 'menu') {
            inMenuBlock = false;
            fields[maybeKey] = kvMatch[2].trim();
            continue;
          }
        }
        menuLines.push(rawLine);
      }
    }
  }

  if (rawJson) {
    for (const [key, value] of Object.entries(rawJson)) {
      if (value == null || value === '') continue;
      const mapped = KEY_ALIASES[normalizeKey(key)];
      if (mapped) {
        fields[mapped] = value;
      } else if (key === 'subdomain') {
        fields.slug = value;
      } else {
        fields[key] = value;
      }
    }
  }

  const name = String(fields.name || '').trim();
  const slugRaw = String(fields.slug || '').trim().toLowerCase();
  const slug = slugRaw ? slugifyRestaurantName(slugRaw) : name ? slugifyRestaurantName(name) : '';

  const segment = resolveSegment(fields.segment ? String(fields.segment) : null);
  const rawOpProfile = String(fields.operation_profile || fields.operationProfile || segment.operationProfile).trim().toLowerCase();
  const operationProfile: ExpressOperationProfile = (
    rawOpProfile === 'pizzaria'
    || rawOpProfile === 'acai'
    || rawOpProfile === 'churrasco'
    || rawOpProfile === 'marmitaria'
    || rawOpProfile === 'generic'
  )
    ? rawOpProfile
    : 'generic';

  const rawPlan = String(fields.plan || 'pro').trim().toLowerCase();
  const plan: 'pocket' | 'pro' | 'black' =
    rawPlan === 'pocket' || rawPlan === 'pro' || rawPlan === 'black' ? rawPlan : 'pro';

  const adminName = String(fields.adminName || fields.admin_name || '').trim();
  const adminEmail = String(fields.adminEmail || fields.admin_email || '').trim().toLowerCase();
  if (adminEmail && !EMAIL_RE.test(adminEmail)) {
    warnings.push('O e-mail informado não tem formato válido.');
  }

  const phoneDigits = String(fields.phone || '').replace(/\D+/g, '');
  const address = String(fields.address || '').trim() || null;
  const orderTypes = parseOrderTypes(fields.orderTypes ?? fields.order_types);
  const operatingHours = parseExpressOperatingHours(fields.operatingHours ?? fields.operating_hours);

  const extraMenuText = String(fields.menu_text || fields.menuText || '').trim();
  if (extraMenuText) {
    menuLines.push(...extraMenuText.split(/\r?\n/).filter((line) => line.trim()));
  }

  const parsedMenu = parseMenuLines(menuLines);
  const items = [...parsedMenu.items];
  warnings.push(...parsedMenu.warnings);

  const rawItems = fields.menu_items ?? fields.menuItems;
  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const itemName = String(record.name ?? record.nome ?? '').trim();
      const rawPrice = record.price ?? record.preco;
      const numericPrice = typeof rawPrice === 'number' ? rawPrice : parseBrlNumber(String(rawPrice ?? ''));
      if (!itemName || numericPrice === null || numericPrice < 0) continue;
      const catName = String(record.category ?? record.categoria ?? 'Cardápio').trim() || 'Cardápio';
      items.push({
        name: itemName,
        price: Math.round(numericPrice * 100) / 100,
        category: catName,
        categoryId: slugifyCategoryId(catName),
        printDestination: inferCategoryDestination(catName),
        description: String(record.description ?? record.descricao ?? '').trim(),
      });
    }
  }

  const categoriesMap = new Map<string, { id: string; nome: string; destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' }>();
  for (const item of items) {
    if (!categoriesMap.has(item.categoryId)) {
      categoriesMap.set(item.categoryId, {
        id: item.categoryId,
        nome: item.category,
        destino_impressao: item.printDestination,
      });
    }
  }

  const missingRequiredFields: string[] = [];
  if (name.length < 2) missingRequiredFields.push('name');
  if (requireAdminCredentials) {
    if (adminName.length < 2) missingRequiredFields.push('admin_name');
    if (!adminEmail || !EMAIL_RE.test(adminEmail)) missingRequiredFields.push('admin_email');
  }

  return {
    fields: {
      name,
      slug,
      plan,
      segmentLabel: segment.segmentLabel,
      operationProfile,
      segmentPreset: String(fields.segment_preset || fields.segmentPreset || segment.segmentPreset || '') || null,
      adminName,
      adminEmail,
      phone: phoneDigits || null,
      address,
      orderTypes,
      operatingHours,
    },
    menuItems: items,
    categories: [...categoriesMap.values()],
    missingRequiredFields,
    warnings,
  };
}
