#!/usr/bin/env node
const DEFAULT_FRONTEND = 'https://app.komafood.com.br';
const DEFAULT_API = 'https://sistema-gourmet-bistro-production.up.railway.app';
const STATE_NAME = 'KOMA_MONITOR_STATE';
const ISSUE_TITLE = '[KÔMA] Indisponibilidade de produção';

export function nextMonitorState(previous, healthy) {
  const state = { failures: 0, successes: 0, issue: null, ...previous };
  if (healthy) return { ...state, failures: 0, successes: state.successes + 1 };
  return { ...state, failures: state.failures + 1, successes: 0 };
}

async function check(url, expectedType) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${new URL(url).pathname || '/'} HTTP ${response.status}`);
  if (expectedType === 'html' && !(response.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('frontend sem HTML');
  }
  if (expectedType === 'ready') {
    const body = await response.json();
    if (body.database !== 'healthy') throw new Error('database unhealthy');
  }
}

export async function checkTargets(frontend = DEFAULT_FRONTEND, api = DEFAULT_API) {
  const failures = [];
  for (const [url, type] of [[frontend, 'html'], [`${api}/health/live`, 'live'], [`${api}/health/ready`, 'ready']]) {
    try { await check(url, type); } catch (error) { failures.push(`${url}: ${error.message}`); }
  }
  return failures;
}

export async function reconcileMonitor({ previous, failures, createIssue, updateIssue, closeIssue }) {
  const state = nextMonitorState(previous, failures.length === 0);
  if (failures.length && state.failures >= 2) {
    const body = `Monitor externo confirmou falha em 2 execuções consecutivas.\n\n${failures.join('\n')}\n\nDiagnóstico: \`npm run ops:doctor\`.\nÚltima verificação: ${new Date().toISOString()}`;
    if (state.issue) await updateIssue(state.issue, body);
    else state.issue = await createIssue(ISSUE_TITLE, body);
  } else if (!failures.length && state.issue && state.successes >= 2) {
    await closeIssue(state.issue, `Recuperação confirmada em 2 execuções consecutivas: ${new Date().toISOString()}`);
    state.issue = null;
  }
  return state;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY/GITHUB_TOKEN ausente');
  const root = `https://api.github.com/repos/${repo}`;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${root}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const variable = await api(`/actions/variables/${STATE_NAME}`);
  let previous = {};
  try { previous = JSON.parse(variable?.value || '{}'); } catch { /* reset malformed state */ }
  const failures = await checkTargets(process.env.KOMA_FRONTEND_URL || DEFAULT_FRONTEND, process.env.KOMA_API_URL || DEFAULT_API);
  const state = await reconcileMonitor({
    previous, failures,
    createIssue: async (title, body) => (await api('/issues', 'POST', { title, body }))?.number,
    updateIssue: async (number, body) => api(`/issues/${number}`, 'PATCH', { body }),
    closeIssue: async (number, body) => {
      await api(`/issues/${number}/comments`, 'POST', { body });
      await api(`/issues/${number}`, 'PATCH', { state: 'closed' });
    },
  });
  if (!state.issue && failures.length && state.failures >= 2) throw new Error('Falha ao criar issue');
  if (variable) await api(`/actions/variables/${STATE_NAME}`, 'PATCH', { name: STATE_NAME, value: JSON.stringify(state) });
  else await api('/actions/variables', 'POST', { name: STATE_NAME, value: JSON.stringify(state) });
  console.log(failures.length ? `Falha ${state.failures}: ${failures.join('; ')}` : `Saudável (${state.successes} verificações); issue ${state.issue || 'nenhuma'}`);
  if (failures.length && state.failures >= 2) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('ops-monitor.mjs')) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
