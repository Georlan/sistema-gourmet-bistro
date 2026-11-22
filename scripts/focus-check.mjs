#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FRONTEND_PATTERN = /^(src|tests|public|functions|scripts)\/|^package(-lock)?\.json$|^vite\.config\.ts$|^tsconfig.*\.json$|^index\.html$|^product-contract\.json$/;
const BACKEND_PATTERN = /^backend\//;
const ALEMBIC_PATTERN = /^backend\/(alembic\/|app\/.*models\.py$)/;

const BACKEND_DOMAIN_TESTS = [
  {
    match: /^backend\/app\/(routes\/(auth|onboarding|saas|signup|super_admin)|services\/(saas|signup|onboarding|plan_entitlements)|security\.py|permissions\.py)/,
    tests: ['backend/tests/test_critical_auth_flow.py', 'backend/tests/test_plan_entitlements.py'],
  },
  {
    match: /^backend\/app\/(application\/orders\/|adapters\/orders\/|domain\/orders\/|routes\/(orders|orders_core|caixa|estoque|atendimentos|cardapio|cardapio_digital)|services\/(inventory|atendimentos))/,
    tests: ['backend/tests/test_order_lifecycle_authority.py', 'backend/tests/test_atendimento_identity.py'],
  },
  {
    match: /^backend\/app\/(routes\/(direct_pix|saas_pix|online_payments|online_order_control)|services\/(online_payments|online_order|direct_pix|saas_mercadopago))/,
    tests: ['backend/tests/test_online_payment_gate.py', 'backend/tests/test_online_payment_cash_close.py'],
  },
  {
    match: /^backend\/app\/(application\/printing\/|routes\/(print_agents|print_agent_events))/,
    tests: ['backend/tests/test_print_agents.py'],
  },
];

const E2E_DOMAIN_SPECS = [
  { match: /^src\/(cardapio|components\/cardapio)\//, specs: ['e2e/public-menu-order.spec.ts', 'e2e/cardapio-promotions.spec.ts'] },
  { match: /^src\/components\/caixa\/(pdv|checkout)\//, specs: ['e2e/cashier-pdv-product-card.spec.ts', 'e2e/cashier-mixed-payment.spec.ts'] },
  { match: /^src\/components\/(caixa\/orders|courier)\//, specs: ['e2e/cashier-fulfillment-workspaces.spec.ts', 'e2e/cashier-delivery-stages.spec.ts'] },
  { match: /^src\/components\/(mesas|Mesa)/, specs: ['e2e/waiter-salon-wave1.spec.ts', 'e2e/waiter-projections.spec.ts'] },
  { match: /^src\/components\/(auth|onboarding)\//, specs: ['e2e/auth-persistence.spec.ts', 'e2e/onboarding-first-client-ux.spec.ts'] },
  { match: /Pix|pagbank/i, specs: ['e2e/direct-pix.spec.ts', 'e2e/pagbank-connect.spec.ts'] },
];

export function selectBackendTests(files, fileExists = existsSync) {
  const selected = new Set();
  for (const file of files) {
    if (/^backend\/tests\/(.+\/)?test_[^/]+\.py$/.test(file) && !/_postgres\.py$|_pg17.*\.py$/.test(file) && fileExists(file)) {
      selected.add(file);
    }
    for (const rule of BACKEND_DOMAIN_TESTS) {
      if (rule.match.test(file)) {
        for (const t of rule.tests) {
          if (fileExists(t)) selected.add(t);
        }
      }
    }
  }
  return [...selected].sort();
}

export function selectE2eSpecs(files, fileExists = existsSync) {
  const direct = [];
  const domain = [];
  for (const file of files) {
    if (/^e2e\/.+\.spec\.ts$/.test(file) && fileExists(file) && !direct.includes(file)) {
      direct.push(file);
    }
    for (const rule of E2E_DOMAIN_SPECS) {
      if (rule.match.test(file)) {
        for (const spec of rule.specs) {
          if (fileExists(spec) && !domain.includes(spec)) domain.push(spec);
        }
      }
    }
  }
  const merged = [...direct];
  for (const spec of domain) {
    if (merged.length >= Math.max(4, direct.length)) break;
    if (!merged.includes(spec)) merged.push(spec);
  }
  return merged;
}

export function classifyChangedFiles(files, fileExists = existsSync) {
  const clean = [...new Set(files.map(f => f.trim()).filter(Boolean))];
  const frontend = clean.some(f => FRONTEND_PATTERN.test(f));
  const backend = clean.some(f => BACKEND_PATTERN.test(f));
  const alembic = clean.some(f => ALEMBIC_PATTERN.test(f));
  const backendTests = selectBackendTests(clean, fileExists);
  const e2eSpecs = selectE2eSpecs(clean, fileExists);
  return { files: clean, frontend, backend, alembic, backendTests, e2eSpecs };
}

function getChangedFiles() {
  const changed = new Set();
  for (const args of [
    ['diff', '--name-only', 'origin/main...HEAD'],
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
  ]) {
    try {
      const out = execFileSync('git', args, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (line.trim()) changed.add(line.trim());
      }
    } catch {
      // Fallback when origin/main is absent in shallow clones.
    }
  }
  try {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    for (const line of untracked.split('\n')) {
      if (line.trim()) changed.add(line.trim());
    }
  } catch {
    // Ignore when executed outside git worktree.
  }
  return [...changed];
}

function resolvePythonBin() {
  const candidates = [
    path.resolve('backend/.venv/bin/python'),
    path.resolve('.venv/bin/python'),
    '/home/testuser/Projetos/sistema-gourmet-bistro/.venv/bin/python',
  ];
  return candidates.find(p => existsSync(p)) || 'python3';
}

function runStep(label, cmd, args, extraEnv = {}) {
  console.log(`\n▶ ${label}: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

function main() {
  const argv = new Set(process.argv.slice(2));
  const dryRun = argv.has('--dry-run');
  const runE2e = argv.has('--e2e');
  const fastMode = argv.has('--fast');

  const plan = classifyChangedFiles(getChangedFiles());
  console.log('Focus check plan:', JSON.stringify({
    changedCount: plan.files.length,
    frontend: plan.frontend,
    backend: plan.backend,
    alembic: plan.alembic,
    backendTests: plan.backendTests,
    e2eSpecs: plan.e2eSpecs,
  }, null, 2));

  if (dryRun) return;

  if (plan.frontend) {
    runStep('TypeScript lint', 'npm', ['run', 'lint']);
    runStep('Frontend unit tests', 'npm', ['run', 'test:unit']);
    if (!fastMode) {
      runStep('Frontend production build', 'npm', ['run', 'build']);
    }
  }

  if (plan.backend) {
    const py = resolvePythonBin();
    runStep('Backend syntax check', py, ['-m', 'compileall', '-q', 'backend/app']);
    if (plan.alembic) {
      runStep('Alembic single head', py, ['-m', 'alembic', '-c', 'backend/alembic.ini', 'heads']);
    }
    if (plan.backendTests.length > 0) {
      runStep(
        'Focused backend pytest',
        py,
        ['-m', 'pytest', ...plan.backendTests, '-n', '4', '--dist', 'loadfile', '-q', '-ra'],
        {
          ENVIRONMENT: 'test',
          SECRET_KEY: process.env.SECRET_KEY || 'focus-check-local-test-secret-key',
          ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
          PYTHONPATH: 'backend',
        },
      );
    }
  }

  if ((runE2e || plan.files.some(f => f.startsWith('e2e/'))) && plan.e2eSpecs.length > 0) {
    runStep(
      'Focused Playwright E2E (mobile-390 + desktop-1366)',
      'npm',
      ['run', 'test:e2e', '--', ...plan.e2eSpecs, '--project=mobile-390', '--project=desktop-1366', '--workers=4'],
      { KOMA_E2E_PORT: process.env.KOMA_E2E_PORT || '4283' },
    );
  }

  console.log('\n✓ Focus check concluído sem falhas.');
}

if (process.argv[1]?.endsWith('focus-check.mjs')) {
  main();
}
