#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRONTEND_URL = process.env.KOMA_FRONTEND_URL || 'https://app.komafood.com.br';
const DEFAULT_API_URL = process.env.KOMA_API_URL || 'https://sistema-gourmet-bistro-production.up.railway.app';

export function shaMatches(actual, expected) {
  const a = String(actual || '').trim().toLowerCase();
  const e = String(expected || '').trim().toLowerCase();
  if (!a || !e) return false;
  return a === e || a.startsWith(e) || e.startsWith(a);
}

export function isShaPublishedOrSuperseded(liveSha, targetSha, isAncestorFn = isGitAncestor) {
  if (shaMatches(liveSha, targetSha)) return { matched: true, superseded: false };
  if (!liveSha || !targetSha) return { matched: false, superseded: false };
  if (isAncestorFn(targetSha, liveSha)) return { matched: true, superseded: true };
  return { matched: false, superseded: false };
}

function isGitAncestor(ancestorSha, descendantSha) {
  try {
    const res = spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
      stdio: 'ignore',
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function sanitizeScope(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function parsePreflightArgs(argv = []) {
  const opts = {
    watchDeploy: null,
    startScope: null,
    cleanupScope: null,
    ship: false,
    title: '',
    body: '',
    expectBackend: false,
    runSmoke: false,
    timeoutSec: 240,
    intervalMs: 4000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--backend') opts.expectBackend = true;
    else if (arg === '--smoke') opts.runSmoke = true;
    else if (arg === '--ship') opts.ship = true;
    else if (arg === '--watch-deploy' && i + 1 < argv.length) opts.watchDeploy = argv[++i].trim();
    else if (arg.startsWith('--watch-deploy=')) opts.watchDeploy = arg.slice('--watch-deploy='.length).trim();
    else if (arg === '--start' && i + 1 < argv.length) opts.startScope = sanitizeScope(argv[++i]);
    else if (arg.startsWith('--start=')) opts.startScope = sanitizeScope(arg.slice('--start='.length));
    else if (arg === '--cleanup' && i + 1 < argv.length) opts.cleanupScope = sanitizeScope(argv[++i]);
    else if (arg.startsWith('--cleanup=')) opts.cleanupScope = sanitizeScope(arg.slice('--cleanup='.length));
    else if (arg === '--title' && i + 1 < argv.length) opts.title = argv[++i].trim();
    else if (arg.startsWith('--title=')) opts.title = arg.slice('--title='.length).trim();
    else if (arg === '--body' && i + 1 < argv.length) opts.body = argv[++i].trim();
    else if (arg.startsWith('--body=')) opts.body = arg.slice('--body='.length).trim();
    else if (arg === '--timeout' && i + 1 < argv.length) opts.timeoutSec = Math.max(15, Number(argv[++i]) || 240);
    else if (arg.startsWith('--timeout=')) opts.timeoutSec = Math.max(15, Number(arg.slice('--timeout='.length)) || 240);
  }
  return opts;
}

export function evaluateWorkspaceDrift({ headSha, originMainSha, branch, dirtyCount }) {
  const behindMain = Boolean(headSha && originMainSha && !shaMatches(headSha, originMainSha));
  const useIsolatedWorktree = behindMain || dirtyCount > 0 || branch !== 'main';
  return {
    branch: branch || 'unknown',
    headSha: headSha || null,
    originMainSha: originMainSha || null,
    dirtyCount: Number(dirtyCount) || 0,
    behindMain,
    useIsolatedWorktree,
  };
}

async function fetchJson(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache' },
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, durationMs: Date.now() - startedAt, data };
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, error: err?.message || String(err), data: null };
  } finally {
    clearTimeout(timer);
  }
}

function safeGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function listOpenPrs() {
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,headRefName,isDraft'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function collectBaseline() {
  const startedAt = Date.now();
  const [frontendRes, apiRes] = await Promise.all([
    fetchJson(`${DEFAULT_FRONTEND_URL}/meta.json`),
    fetchJson(`${DEFAULT_API_URL}/api/contracts/readiness`),
  ]);

  const branch = safeGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = safeGit(['rev-parse', 'HEAD']);
  const originMainSha = safeGit(['rev-parse', 'origin/main']);
  const porcelain = safeGit(['status', '--porcelain']);
  const dirtyCount = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
  const openPrs = listOpenPrs();

  return {
    collectedInMs: Date.now() - startedAt,
    production: {
      frontendUrl: DEFAULT_FRONTEND_URL,
      frontendSha: frontendRes.data?.sha || null,
      frontendBuiltAt: frontendRes.data?.builtAt || null,
      frontendHttp: frontendRes.status,
      apiUrl: DEFAULT_API_URL,
      apiSha: apiRes.data?.deploymentGitSha || null,
      apiReady: Boolean(apiRes.data?.ready),
      apiHttp: apiRes.status,
    },
    workspace: evaluateWorkspaceDrift({ headSha, originMainSha, branch, dirtyCount }),
    openPrs,
  };
}

async function watchDeploy(opts) {
  const startedAt = Date.now();
  const deadline = startedAt + opts.timeoutSec * 1000;
  const targetSha = opts.watchDeploy;

  let frontendLiveSec = null;
  let apiLiveSec = null;
  let lastFrontendSha = null;
  let lastApiSha = null;

  while (Date.now() < deadline) {
    const [fe, api] = await Promise.all([
      fetchJson(`${DEFAULT_FRONTEND_URL}/meta.json`),
      fetchJson(`${DEFAULT_API_URL}/api/contracts/readiness`),
    ]);

    lastFrontendSha = fe.data?.sha || lastFrontendSha;
    lastApiSha = api.data?.deploymentGitSha || lastApiSha;

    if (frontendLiveSec === null) {
      const feMatch = isShaPublishedOrSuperseded(lastFrontendSha, targetSha);
      if (feMatch.matched) {
        frontendLiveSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
        if (feMatch.superseded) {
          console.log(`ℹ Frontend já avançou para commit mais novo (${lastFrontendSha}) contendo ${targetSha.slice(0, 12)}.`);
        }
      }
    }
    if (opts.expectBackend && apiLiveSec === null && api.data?.ready) {
      const apiMatch = isShaPublishedOrSuperseded(lastApiSha, targetSha);
      if (apiMatch.matched) {
        apiLiveSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
        if (apiMatch.superseded) {
          console.log(`ℹ Backend já avançou para commit mais novo (${lastApiSha?.slice(0, 12)}) contendo ${targetSha.slice(0, 12)}.`);
        }
      }
    }

    const feDone = frontendLiveSec !== null;
    const apiDone = !opts.expectBackend || apiLiveSec !== null;
    if (feDone && apiDone) {
      const summary = {
        ok: true,
        targetSha,
        frontendSha: lastFrontendSha,
        apiSha: lastApiSha,
        frontendLiveSec,
        apiLiveSec: opts.expectBackend ? apiLiveSec : null,
        totalWaitSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      };
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`✓ Deploy confirmado para ${targetSha.slice(0, 12)}:`);
        console.log(`  - Frontend Cloudflare Pages: ${lastFrontendSha} (${frontendLiveSec}s)`);
        console.log(
          opts.expectBackend
            ? `  - Backend Railway: ${lastApiSha?.slice(0, 12)} (${apiLiveSec}s)`
            : `  - Backend Railway (inalterado): ${lastApiSha?.slice(0, 12)}`,
        );
      }

      if (opts.runSmoke) {
        const smokeEnv = {
          ...process.env,
          KOMA_EXPECTED_FRONTEND_SHA: lastFrontendSha || targetSha,
          KOMA_EXPECTED_API_SHA: opts.expectBackend ? (lastApiSha || targetSha) : (lastApiSha || ''),
        };
        const res = spawnSync('node', ['scripts/production-smoke.mjs'], { stdio: 'inherit', env: smokeEnv });
        process.exit(res.status ?? 1);
      }
      return;
    }

    await new Promise(r => setTimeout(r, opts.intervalMs));
  }

  console.error(
    `✗ Timeout (${opts.timeoutSec}s) aguardando deploy ${targetSha}. Atual: frontend=${lastFrontendSha}, api=${lastApiSha}`,
  );
  process.exit(1);
}

async function startWorktree(scope) {
  if (!scope) {
    console.error('Informe um escopo válido: npm run ops:preflight -- --start <escopo>');
    process.exit(1);
  }
  const wtDir = `/tmp/koma-fix-${scope}`;
  const branch = `fix/${scope}`;
  const [baseline] = await Promise.all([
    collectBaseline(),
    Promise.resolve().then(() => {
      execFileSync('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });
    }),
  ]);
  execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' });
  if (!existsSync(wtDir)) {
    execFileSync('git', ['worktree', 'add', '-b', branch, wtDir, 'origin/main'], { stdio: 'inherit' });
    const srcNodeModules = path.resolve(process.cwd(), 'node_modules');
    const dstNodeModules = path.join(wtDir, 'node_modules');
    if (existsSync(srcNodeModules) && !existsSync(dstNodeModules)) {
      symlinkSync(srcNodeModules, dstNodeModules);
    }
  }
  console.log(`\n✓ Worktree pronto: ${wtDir} (branch ${branch})`);
  console.log(`  PREV_FRONTEND_SHA : ${baseline.production.frontendSha || 'indisponível'}`);
  console.log(`  PREV_API_SHA      : ${baseline.production.apiSha || 'indisponível'}`);
  console.log(`  STARTED_AT        : ${new Date().toISOString()}`);
}

function cleanupWorktree(scope) {
  if (!scope) {
    console.error('Informe o escopo: npm run ops:preflight -- --cleanup <escopo>');
    process.exit(1);
  }
  const wtDir = `/tmp/koma-fix-${scope}`;
  if (existsSync(wtDir)) {
    execFileSync('git', ['worktree', 'remove', '--force', wtDir], { stdio: 'inherit' });
  }
  execFileSync('git', ['worktree', 'prune'], { stdio: 'inherit' });
  console.log(`✓ Worktree ${wtDir} removido com segurança.`);
}

function shipBranch(opts) {
  const branch = safeGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'main' || branch === 'HEAD') {
    console.error('✗ Recusado: --ship não pode ser executado diretamente em main ou detached HEAD.');
    process.exit(1);
  }
  if (!opts.title) {
    console.error('✗ Informe --title "<título do PR>" ao usar --ship.');
    process.exit(1);
  }
  execFileSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });
  const prArgs = ['pr', 'create', '--base', 'main', '--title', opts.title, '--body', opts.body || opts.title];
  execFileSync('gh', prArgs, { stdio: 'inherit' });
  execFileSync('gh', ['pr', 'merge', '--auto', '--squash', '--delete-branch'], { stdio: 'inherit' });
}

async function main() {
  const opts = parsePreflightArgs(process.argv.slice(2));
  if (opts.startScope) {
    await startWorktree(opts.startScope);
    return;
  }
  if (opts.cleanupScope) {
    cleanupWorktree(opts.cleanupScope);
    return;
  }
  if (opts.ship) {
    shipBranch(opts);
    return;
  }
  if (opts.watchDeploy) {
    await watchDeploy(opts);
    return;
  }
  const baseline = await collectBaseline();
  if (opts.json) {
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }
  console.log(`KÔMA Support Preflight (${baseline.collectedInMs}ms)`);
  console.log(`  PREV_FRONTEND_SHA : ${baseline.production.frontendSha || 'indisponível'} (HTTP ${baseline.production.frontendHttp})`);
  console.log(`  PREV_API_SHA      : ${baseline.production.apiSha || 'indisponível'} (ready=${baseline.production.apiReady})`);
  console.log(`  Workspace         : branch=${baseline.workspace.branch} dirty=${baseline.workspace.dirtyCount} behindMain=${baseline.workspace.behindMain}`);
  if (baseline.workspace.useIsolatedWorktree) {
    console.log('  Recomendação      : criar worktree isolado de origin/main (/tmp/koma-support-<escopo>)');
  }
  if (baseline.openPrs.length > 0) {
    console.log(`  PRs abertos (${baseline.openPrs.length})  : ${baseline.openPrs.map(p => `#${p.number}`).join(', ')}`);
  }
}

if (process.argv[1]?.endsWith('support-preflight.mjs')) {
  main();
}
