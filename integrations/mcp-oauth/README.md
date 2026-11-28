# Introspecção do MCP de engenharia

O backend oferece uma única ferramenta de leitura do contrato de produto. Com a
configuração padrão, `/mcp` e `/.well-known/oauth-protected-resource/mcp`
retornam 404. O processo usa o mesmo ponto de entrada ASGI do KÔMA.

Para homologação isolada, o emissor deve ter um cliente pré-registrado, um operador
autenticado e autorizado no consentimento, PKCE S256 e a audiência HTTPS exata
do recurso. A montagem de `introspect.mjs` no Worker usa a instância de
`OAuthAuthorizationServer` do pacote `@cloudflare/workers-oauth-provider`,
testado na versão 1.4.0. Encaminhe apenas o caminho `/introspect` para
`introspect(request, env, server)`. Configure o KV do emissor, `ISSUER`,
`RESOURCE` e o segredo de serviço `INTROSPECTION_SECRET`. A aplicação de
login e consentimento pertence ao emissor.

| Configuração do backend | Valor em homologação |
| --- | --- |
| `KOMA_MCP_ENABLED` | `true` para habilitar no início do processo. O padrão é `false`. |
| `KOMA_MCP_RESOURCE` | URL HTTPS canônica do serviço terminada em `/mcp`, igual a `RESOURCE` no Worker. |
| `KOMA_MCP_ISSUER` | Identificador HTTPS exato do emissor. O backend envia o token apenas para o caminho `/introspect` sob esse endereço. |
| `KOMA_MCP_CLIENT_ID` | Identificador do cliente OAuth registrado. |
| `KOMA_MCP_OPERATOR_SUB` | Identificador estável do operador autorizado nesse emissor. |
| `KOMA_MCP_INTROSPECTION_SECRET` | Segredo exclusivo compartilhado com o Worker para autenticar o serviço na introspecção. |

O backend verifica cada chamada. Token inativo, vencido ou com divergência de
emissor, audiência, cliente ou operador recebe 401. Escopo insuficiente recebe
403. Falha na comunicação ou na autenticação do serviço de introspecção recebe
503. Para desativar o MCP, remova a flag ou use `false` e reinicie o processo.
