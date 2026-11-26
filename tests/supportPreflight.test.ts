import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateWorkspaceDrift,
  isShaPublishedOrSuperseded,
  lockfilesMatch,
  parsePreflightArgs,
  requiresManualApproval,
  sanitizeScope,
  shaMatches,
} from '../scripts/support-preflight.mjs';

test('shaMatches compares full and abbreviated git SHAs safely', () => {
  const full = 'b8085d1a0043e0fc17238832afe44223ac7778cf';
  assert.equal(shaMatches('b8085d1a0043', full), true);
  assert.equal(shaMatches(full, 'B8085D1A'), true);
  assert.equal(shaMatches('deadbeef', full), false);
  assert.equal(shaMatches('', full), false);
});

test('evaluateWorkspaceDrift recommends isolated worktree when behind main or dirty', () => {
  const cleanMain = evaluateWorkspaceDrift({
    headSha: 'b8085d1a0043',
    originMainSha: 'b8085d1a0043',
    branch: 'main',
    dirtyCount: 0,
  });
  assert.equal(cleanMain.behindMain, false);
  assert.equal(cleanMain.useIsolatedWorktree, false);

  const staleBranch = evaluateWorkspaceDrift({
    headSha: '7c8d5e36',
    originMainSha: 'b8085d1a',
    branch: 'feat/old',
    dirtyCount: 2,
  });
  assert.equal(staleBranch.behindMain, true);
  assert.equal(staleBranch.useIsolatedWorktree, true);
});

test('parsePreflightArgs handles watch-deploy, start, cleanup, ship and timeout flags', () => {
  const opts = parsePreflightArgs(['--watch-deploy', 'abc1234', '--backend', '--smoke', '--timeout=120', '--json']);
  assert.equal(opts.watchDeploy, 'abc1234');
  assert.equal(opts.expectBackend, true);
  assert.equal(opts.runSmoke, true);
  assert.equal(opts.timeoutSec, 120);
  assert.equal(opts.json, true);

  const startOpts = parsePreflightArgs(['--start', 'Botao Despacho!!']);
  assert.equal(startOpts.startScope, 'botao-despacho');
  assert.equal(sanitizeScope('Fix_Pix/123'), 'fix-pix-123');
});

test('isShaPublishedOrSuperseded accepts exact match and newer descendant commits', () => {
  assert.deepEqual(isShaPublishedOrSuperseded('abc123456789', 'abc1234', () => false), {
    matched: true,
    superseded: false,
  });
  assert.deepEqual(isShaPublishedOrSuperseded('def9999', 'abc1234', () => true), {
    matched: true,
    superseded: true,
  });
  assert.deepEqual(isShaPublishedOrSuperseded('def9999', 'abc1234', () => false), {
    matched: false,
    superseded: false,
  });
});

test('requiresManualApproval flags critical paths and allows low-risk UI fixes', () => {
  assert.deepEqual(requiresManualApproval(['src/cardapio/v2/MenuBottomDock.tsx']), {
    required: false,
    matched: [],
  });
  const critical = requiresManualApproval([
    'backend/alembic/versions/20261126_test.py',
    'backend/app/routes/direct_pix.py',
    'src/App.tsx',
  ]);
  assert.equal(critical.required, true);
  assert.equal(critical.matched.length, 2);
});

test('lockfilesMatch detects identical directory lockfile', () => {
  assert.equal(lockfilesMatch(process.cwd(), process.cwd()), true);
  assert.equal(lockfilesMatch(process.cwd(), '/nonexistent-dir-koma'), false);
});

test('parsePreflightArgs handles --no-auto-merge and --confirm-auto-merge flags', () => {
  const noAuto = parsePreflightArgs(['--ship', '--no-auto-merge', '--title', 'fix: ui']);
  assert.equal(noAuto.ship, true);
  assert.equal(noAuto.noAutoMerge, true);
  assert.equal(noAuto.confirmAutoMerge, false);

  const confirm = parsePreflightArgs(['--ship', '--confirm-auto-merge', '--title', 'fix: ci']);
  assert.equal(confirm.confirmAutoMerge, true);
});
