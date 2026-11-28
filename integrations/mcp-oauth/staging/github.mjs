const callback = (env) => new URL('/github/callback', env.ISSUER).href;

export async function startGitHub(env, oauth, approval) {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const { state, headers } = await oauth.beginUpstream(approval.request, {
    data: { verifier }, headers: approval.headers,
  });
  const target = new URL('https://github.com/login/oauth/authorize');
  target.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback(env), state,
    scope: '', code_challenge: challenge, code_challenge_method: 'S256',
  });
  headers.set('Location', target.href);
  return new Response(null, { status: 303, headers });
}

export async function githubAccount(env, code, verifier, request = fetch) {
  const exchange = await request('https://github.com/login/oauth/access_token', {
    method: 'POST', redirect: 'manual', headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
      redirect_uri: callback(env), code, code_verifier: verifier,
    }),
  });
  if (!exchange.ok) throw new Error('GitHub token endpoint unavailable');
  const data = await exchange.json();
  if (data.error || !data.access_token) return null;
  const user = await request('https://api.github.com/user', {
    redirect: 'manual', headers: { Authorization: 'Bearer ' + data.access_token,
      Accept: 'application/vnd.github+json', 'User-Agent': 'koma-mcp-staging' },
  });
  if (user.status === 401) return null;
  if (!user.ok) throw new Error('GitHub identity endpoint unavailable');
  const { id, type } = await user.json();
  if (type !== 'User' || !Number.isSafeInteger(id) || id <= 0 || String(id) !== env.GITHUB_OPERATOR_ID) return null;
  return String(id);
}
