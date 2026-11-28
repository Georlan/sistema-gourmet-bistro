import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const issuer = 'https://issuer.example.com';
const client = 'https://client.example.com/oauth/metadata';
const callback = 'https://client.example.com/oauth/callback';
const resource = 'https://resource.example.com/mcp';
const scope = 'mcp:ops:read';
const allowedId = 73123; // Fictitious, configured just like the staging operator.
const s256 = value => createHash('sha256').update(value).digest('base64url');

test('consent, GitHub identity, PKCE, introspection and grant revocation', async t => {
  const script = await build({ entryPoints: ['worker.mjs'], bundle: true, external: ['cloudflare:*'], format: 'esm', write: false });
  const serviceSecret = randomBytes(32).toString('hex');
  let accountId = allowedId;
  let challenge;
  const mf = new Miniflare({
    workers: [{
      config: {
        name: 'issuer',
        compatibilityDate: '2026-07-01',
        compatibilityFlags: ['global_fetch_strictly_public'],
        manifest: {
          mainModule: 'worker.mjs',
          modules: { 'worker.mjs': { type: 'esm', contents: script.outputFiles[0].text } },
        },
        env: {
          OAUTH_KV: { type: 'kv', id: 'OAUTH_KV' },
          ISSUER: { type: 'text', value: issuer },
          RESOURCE: { type: 'text', value: resource },
          MCP_CLIENT_ID: { type: 'text', value: client },
          MCP_REDIRECT_URI: { type: 'text', value: callback },
          GITHUB_OPERATOR_ID: { type: 'text', value: String(allowedId) },
          GITHUB_CLIENT_ID: { type: 'text', value: 'fixture' },
          GITHUB_CLIENT_SECRET: { type: 'text', value: 'fixture' },
          INTROSPECTION_SECRET: { type: 'text', value: serviceSecret },
        },
      },
      dev: {
        outboundService: {
          type: 'fetcher',
          handler: async req => {
            if (req.url === client) return Response.json({ client_id: client, client_name: 'Workspace fixture',
              redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'] });
            if (req.url === 'https://github.com/login/oauth/access_token') {
              const body = new URLSearchParams(await req.text());
              assert.equal(s256(body.get('code_verifier')), challenge);
              assert.equal(body.get('redirect_uri'), issuer + '/github/callback');
              return Response.json({ access_token: 'fixture-github-token' });
            }
            assert.equal(req.url, 'https://api.github.com/user');
            assert.equal(req.headers.get('Authorization'), 'Bearer fixture-github-token');
            return Response.json({ id: accountId, login: 'same-name-on-both-accounts', type: 'User' });
          },
        },
      },
    }],
  });
  t.after(() => mf.dispose());
  const dispatch = (path, options = {}) => mf.dispatchFetch(issuer + path, { redirect: 'manual', ...options });
  const verifier = randomBytes(40).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: callback,
    state: 'client-state', resource, scope, code_challenge_method: 'S256', code_challenge: s256(verifier) });
  async function consent(decision) {
    const page = await dispatch('/authorize?' + params);
    assert.equal(page.status, 200);
    const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)[1];
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    return dispatch('/authorize', { method: 'POST', headers: { Cookie: cookie },
      body: new URLSearchParams({ decision, handle }) });
  }
  const denied = await consent('deny');
  assert.equal(new URL(denied.headers.get('Location')).searchParams.get('error'), 'access_denied');
  async function login(id) {
    accountId = id;
    const step = await consent('approve');
    assert.equal(step.status, 303);
    const github = new URL(step.headers.get('Location'));
    assert.equal(github.origin, 'https://github.com');
    challenge = github.searchParams.get('code_challenge');
    const headers = { Cookie: step.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
    return dispatch('/github/callback?' + new URLSearchParams({ code: 'fixture', state: github.searchParams.get('state') }), { headers });
  }
  assert.equal((await login(allowedId + 1)).status, 403);
  const admitted = await login(allowedId);
  assert.equal(admitted.status, 303);
  const result = new URL(admitted.headers.get('Location'));
  assert.equal(result.searchParams.get('iss'), issuer);
  const tokenRequest = values => dispatch('/token', { method: 'POST', body: new URLSearchParams({client_id: client, ...values}) });
  const exchange = await tokenRequest({grant_type:'authorization_code', redirect_uri: callback,
    code: result.searchParams.get('code'), code_verifier: verifier, resource});
  assert.equal(exchange.status, 200);
  const pair = await exchange.json();
  assert.equal(pair.expires_in, 600);
  const inspect = async key => {
    const reply = await dispatch('/introspect', {method:'POST', headers: {'Authorization': 'Bearer ' + key},
      body: new URLSearchParams({token:pair.access_token})});
    return reply;
  };
  assert.equal((await inspect('bad')).status,401);
  const claims = await (await inspect(serviceSecret)).json();
  assert.equal(claims.active,true);
  assert.equal(claims.sub,String(allowedId));
  assert.equal(claims.aud,resource);
  assert.equal(claims.scope,scope);
  assert.equal((await tokenRequest({token:pair.refresh_token,token_type_hint:'refresh_token'})).status,200);
  assert.equal((await (await inspect(serviceSecret)).json()).active,false);
  const refused = await tokenRequest({grant_type:'refresh_token',refresh_token:pair.refresh_token,resource});
  assert.equal((await refused.json()).error,'invalid_grant');
});
