import { AuthorizationError, OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import { introspect } from '../introspect.mjs';
import { githubAccount, startGitHub } from './github.mjs';

const scope = 'mcp:ops:read';
const escape = (value) => String(value).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

function error(status, headers = {}) {
  const result = new Headers(headers);
  result.set('Cache-Control', 'no-store');
  return new Response(null, { status, headers: result });
}

async function authorize(req, env, oauth) {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('client_id') !== env.MCP_CLIENT_ID) return error(403);
    const auth = await oauth.parseAuthRequest(req);
    if (auth.clientId !== env.MCP_CLIENT_ID || auth.redirectUri !== env.MCP_REDIRECT_URI ||
        auth.resource !== env.RESOURCE || url.searchParams.get('resource') !== env.RESOURCE ||
        auth.scope.length !== 1 || auth.scope[0] !== scope || auth.codeChallengeMethod !== 'S256' || !auth.codeChallenge) return error(403);
    const { handle, headers } = await oauth.beginConsent(auth);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>Autorizar KÔMA Engenharia</title><h1>Compartilhar o contrato do produto com o ChatGPT Business?</h1>
<p>Permissão de leitura: mcp:ops:read. Destino: ${escape(new URL(auth.redirectUri).host)}.</p>
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
<button name="decision" value="approve">Continuar com GitHub</button>
<button name="decision" value="deny">Cancelar</button></form></html>`, { headers });
  }
  if (req.method !== 'POST') return error(405, { Allow: 'GET, POST' });
  const form = await req.formData();
  const handle = String(form.get('handle') || '');
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(req, handle);
    return new Response(null, { status: 303, headers: denied.headers });
  }
  return startGitHub(env, oauth, await oauth.approveConsent(req, handle));
}

export default {
  async fetch(req, env, ctx) {
    if (![env.ISSUER, env.RESOURCE, env.MCP_CLIENT_ID, env.MCP_REDIRECT_URI, env.GITHUB_CLIENT_ID,
          env.GITHUB_CLIENT_SECRET, env.GITHUB_OPERATOR_ID, env.INTROSPECTION_SECRET, env.OAUTH_KV].every(Boolean)) return error(503);
    const url = new URL(req.url);
    if (url.origin !== env.ISSUER) return error(404);
    const server = new OAuthAuthorizationServer({
      issuer: env.ISSUER, resources: [env.RESOURCE], scopesSupported: [scope],
      authorizeEndpoint: '/authorize', tokenEndpoint: '/token', accessTokenTTL: 600,
      refreshTokenTTL: 3600, clientIdMetadataDocumentEnabled: true,
    });
    const oauth = server.getOAuthApi(env);
    try {
      if (url.pathname === '/introspect') return await introspect(req, env, server);
      if (url.pathname === '/authorize') return await authorize(req, env, oauth);
      if (url.pathname === '/github/callback') {
        if (req.method !== 'GET') return error(405, { Allow: 'GET' });
        const { request, data, headers } = await oauth.finishUpstream(req);
        const code = url.searchParams.get('code');
        if (!code || url.searchParams.has('error')) return error(403, headers);
        const subject = await githubAccount(env, code, data.verifier);
        if (!subject || request.clientId !== env.MCP_CLIENT_ID || request.redirectUri !== env.MCP_REDIRECT_URI ||
            request.resource !== env.RESOURCE) return error(403, headers);
        const grant = await oauth.completeAuthorization({
          request, userId: subject, scope: [scope], metadata: {}, props: {},
        });
        headers.set('Location', grant.redirectTo);
        return new Response(null, { status: 303, headers });
      }
      return await server.fetch(req, env, ctx);
    } catch (err) {
      if (err instanceof AuthorizationError) return error(400);
      return error(503);
    }
  },
};
