import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateWorkspaceDrift, parsePreflightArgs, shaMatches } from '../scripts/support-preflight.mjs';

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

test('parsePreflightArgs handles watch-deploy, backend, smoke and timeout flags', () => {
  const opts = parsePreflightArgs(['--watch-deploy', 'abc1234', '--backend', '--smoke', '--timeout=120', '--json']);
  assert.equal(opts.watchDeploy, 'abc1234');
  assert.equal(opts.expectBackend, true);
  assert.equal(opts.runSmoke, true);
  assert.equal(opts.timeoutSec, 120);
  assert.equal(opts.json, true);
});
