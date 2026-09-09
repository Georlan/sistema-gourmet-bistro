import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/production-smoke.yml', 'utf8');
const smoke = readFileSync('scripts/production-smoke.mjs', 'utf8');
const readiness = readFileSync('backend/app/routes/contract_readiness.py', 'utf8');

test('production smoke runs after the main quality gate and waits for the exact backend revision', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Koma Quality Gate"\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /KOMA_EXPECTED_API_SHA:/);
  assert.match(workflow, /workflow_run\.head_sha/);
  assert.match(workflow, /max_attempts=24/);
  assert.match(workflow, /group: production-smoke-\$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);

  assert.match(readiness, /RAILWAY_GIT_COMMIT_SHA/);
  assert.match(readiness, /"deploymentGitSha": deployment_git_sha/);
  assert.match(smoke, /KOMA_EXPECTED_API_SHA/);
  assert.match(smoke, /payload\?\.deploymentGitSha !== expectedApiSha/);
});

test('production smoke remains non-destructive', () => {
  assert.doesNotMatch(smoke, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(smoke, /method:\s*['"]PUT['"]/);
  assert.doesNotMatch(smoke, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(smoke, /method:\s*['"]DELETE['"]/);
  assert.match(smoke, /method:\s*['"]GET['"]/);
  assert.match(smoke, /method:\s*['"]OPTIONS['"]/);
});

test('public readiness exposes deployment identity without provider secrets', () => {
  assert.doesNotMatch(readiness, /KOMA_LEGAL_PROVIDER_TAX_ID/);
  assert.doesNotMatch(readiness, /KOMA_LEGAL_PROVIDER_ADDRESS/);
  assert.doesNotMatch(readiness, /KOMA_LEGAL_PROVIDER_NAME/);
  assert.doesNotMatch(readiness, /KOMA_LEGAL_PROVIDER_LOCATION/);
});
