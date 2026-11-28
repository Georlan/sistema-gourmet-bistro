// Mount on POST /introspect in the authorization Worker. RESOURCE is issuer-owned.
const encoder = new TextEncoder();
const noStore = { 'Cache-Control': 'no-store' };

function digest(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

export async function introspect(request, env, server) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...noStore, Allow: 'POST' } });
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!env.INTROSPECTION_SECRET || !crypto.subtle.timingSafeEqual(
    await digest(authorization), await digest('Bearer ' + env.INTROSPECTION_SECRET),
  )) {
    return new Response(null, { status: 401, headers: noStore });
  }

  const token = (await request.formData()).get('token');
  const grant = typeof token === 'string' && await server.validateToken(env.RESOURCE, token, env);
  if (!grant) return Response.json({ active: false }, { headers: noStore });

  return Response.json({
    active: true,
    iss: env.ISSUER,
    aud: grant.audience,
    sub: grant.userId,
    client_id: grant.clientId,
    exp: grant.expiresAt,
    scope: grant.scope.join(' '),
  }, { headers: noStore });
}
