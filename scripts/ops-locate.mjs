#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'que', 'nao', 'não', 'esta', 'está', 'estao', 'estão', 'quando', 'como',
  'funciona', 'funcionando', 'erro', 'bug', 'problema', 'botao', 'botão', 'tela', 'pagina', 'página',
  'clique', 'clicar', 'abrir', 'abre', 'corrija', 'corrigir', 'ajuste', 'ajustar', 'aparecendo', 'errada',
  'errado', 'restaurante', 'relatou', 'relatando', 'cliente', 'usuario', 'usuário', 'sistema', 'koma',
]);

const DOMAIN_SYNONYMS = [
  { match: /\b(despach\w*|entreg\w*|motoboy\w*|courier\w*|delivery)\b/i, terms: ['dispatch', 'despach', 'courier', 'motoboy', 'delivery', 'deliver'] },
  { match: /\b(sacola|carrinh\w*|dock|bag|cart)\b/i, terms: ['sacola', 'bag', 'dock', 'cart', 'cardapio'] },
  { match: /\b(cardapi\w*|vitrine|promoc\w*|oferta\w*)\b/i, terms: ['cardapio', 'promoc', 'catalog', 'menu'] },
  { match: /\b(caixa|pdv|balcao|kanban|comanda)\b/i, terms: ['caixa', 'cashier', 'pdv', 'kanban', 'comanda'] },
  { match: /\b(mesa\w*|salao|garcom|atendimento\w*|transfer\w*)\b/i, terms: ['mesa', 'waiter', 'salon', 'atendimento', 'transfer'] },
  { match: /\b(pix|pagbank|mercado\s*pago|pagamento\w*|checkout|troco|estorno|reembolso)\b/i, terms: ['pix', 'direct_pix', 'pagbank', 'online_payment', 'checkout', 'refund'] },
  { match: /\b(impress\w*|print\w*|termic\w*|cupom|bluetooth|usb)\b/i, terms: ['print', 'impress', 'print_agent', 'thermal', 'PrintIntent'] },
  { match: /\b(estoque|inventar\w*|esgotad\w*)\b/i, terms: ['estoque', 'inventory', 'stock'] },
  { match: /\b(login|senha|auth|sessao|token|cadastro|onboarding|trial|plano\w*)\b/i, terms: ['auth', 'onboarding', 'session', 'plan', 'entitlement'] },
  { match: /\b(fiscal|nfce|nfc-e|sefaz|nota)\b/i, terms: ['fiscal', 'nfce', 'sefaz'] },
  { match: /\b(chat|conversa\w*|mensagem|whatsapp)\b/i, terms: ['chat', 'conversa', 'order_chat', 'whatsapp'] },
  { match: /\b(marmit\w*|complement\w*|adiciona\w*|modificador\w*|tamanho\w*)\b/i, terms: ['marmitaria', 'modificador', 'addon', 'complement'] },
  { match: /\b(suporte|ajuda|feedback|triagem|diagnostico)\b/i, terms: ['support', 'triage', 'diagnostic', 'customer_satisfaction'] },
];

export function normalizeQuery(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractSearchTerms(query) {
  const norm = normalizeQuery(query);
  const rawTokens = norm
    .replace(/[^a-z0-9_/-]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));

  const expanded = new Set(rawTokens);
  for (const rule of DOMAIN_SYNONYMS) {
    if (rule.match.test(norm)) {
      for (const t of rule.terms) expanded.add(t);
    }
  }
  return [...expanded].slice(0, 12);
}

export function extractLiteralTerms(query) {
  return [
    ...new Set(
      normalizeQuery(query)
        .replace(/[^a-z0-9_/-]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runRgCount(pattern, dirs, cwd) {
  const existing = dirs.filter(d => existsSync(`${cwd}/${d}`));
  if (!existing.length || !pattern) return [];
  try {
    const out = execFileSync(
      'rg',
      ['--count-matches', '--ignore-case', '--no-heading', '--color=never', pattern, ...existing],
      { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const idx = line.lastIndexOf(':');
        return { file: line.slice(0, idx), hits: Number(line.slice(idx + 1)) || 1 };
      });
  } catch {
    return [];
  }
}

export function rankMatches(entries, terms, limit = 6, literalTerms = [], wantsStyle = false) {
  const literalSet = new Set(literalTerms.map(t => t.toLowerCase()));
  const scored = entries.map(({ file, hits }) => {
    const fl = file.toLowerCase();
    let pathBonus = 0;
    for (const t of terms) {
      const tl = t.toLowerCase();
      if (fl.includes(tl)) {
        pathBonus += literalSet.has(tl) ? 30 : 10;
      }
    }
    const stylePenalty = !wantsStyle && fl.endsWith('.css') ? -15 : 0;
    return { file, hits, score: Math.min(hits, 35) + pathBonus + stylePenalty };
  });
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored.slice(0, limit);
}

export function extractFastApiRoutes(filePath, cwd, maxRoutes = 6) {
  try {
    const content = readFileSync(`${cwd}/${filePath}`, 'utf8');
    const routes = [];
    const rx = /@router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
    let m;
    while ((m = rx.exec(content)) !== null) {
      routes.push(`${m[1].toUpperCase()} ${m[2]}`);
      if (routes.length >= maxRoutes) break;
    }
    return routes;
  } catch {
    return [];
  }
}

export function locateFeature(query, cwd = process.cwd()) {
  const startedAt = Date.now();
  const terms = extractSearchTerms(query);
  const literalTerms = extractLiteralTerms(query);
  const wantsStyle = /\b(css|layout|cor|cores|estilo|tema|margem|espacamento|alinhamento|responsiv)/i.test(normalizeQuery(query));
  if (!terms.length) {
    return {
      query,
      terms: [],
      durationMs: Date.now() - startedAt,
      frontend: [],
      backend: [],
      endpoints: [],
      tests: { unit: [], backend: [], e2e: [] },
    };
  }

  const pattern = terms.map(escapeRegex).join('|');
  const [feRaw, beRaw, unitRaw, beTestRaw, e2eRaw] = [
    runRgCount(pattern, ['src'], cwd),
    runRgCount(pattern, ['backend/app'], cwd),
    runRgCount(pattern, ['tests'], cwd),
    runRgCount(pattern, ['backend/tests'], cwd),
    runRgCount(pattern, ['e2e'], cwd),
  ];

  const frontend = rankMatches(feRaw, terms, 6, literalTerms, wantsStyle);
  const backend = rankMatches(beRaw, terms, 6, literalTerms, wantsStyle);
  const unit = rankMatches(unitRaw, terms, 4, literalTerms, wantsStyle);
  const backendTests = rankMatches(beTestRaw, terms, 4, literalTerms, wantsStyle);
  const e2e = rankMatches(e2eRaw, terms, 4, literalTerms, wantsStyle);

  const endpoints = [];
  for (const b of backend) {
    if (b.file.includes('/routes/')) {
      const found = extractFastApiRoutes(b.file, cwd, 5);
      for (const ep of found) {
        endpoints.push({ file: b.file, endpoint: ep });
      }
    }
  }

  return {
    query,
    terms,
    durationMs: Date.now() - startedAt,
    frontend,
    backend,
    endpoints: endpoints.slice(0, 10),
    tests: {
      unit,
      backend: backendTests,
      e2e,
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const query = argv.filter(a => a !== '--json').join(' ').trim();
  if (!query) {
    console.error('Uso: npm run ops:locate -- "<relato ou termo>" [--json]');
    process.exit(1);
  }
  const result = locateFeature(query, process.cwd());
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`KÔMA Feature Locator (${result.durationMs}ms) — termos: ${result.terms.join(', ')}`);
  const printGroup = (label, items) => {
    console.log(`\n${label}:`);
    if (!items.length) {
      console.log('  (nenhum match direto)');
      return;
    }
    for (const it of items) {
      console.log(`  - ${it.file} (hits=${it.hits}, score=${it.score})`);
    }
  };
  printGroup('Frontend (src/)', result.frontend);
  printGroup('Backend (backend/app/)', result.backend);
  if (result.endpoints.length) {
    console.log('\nEndpoints FastAPI relacionados:');
    for (const ep of result.endpoints) {
      console.log(`  - ${ep.endpoint}  [${ep.file}]`);
    }
  }
  printGroup('Testes unitários (tests/)', result.tests.unit);
  printGroup('Testes backend (backend/tests/)', result.tests.backend);
  printGroup('Specs E2E (e2e/)', result.tests.e2e);
}

if (process.argv[1]?.endsWith('ops-locate.mjs')) {
  main();
}
