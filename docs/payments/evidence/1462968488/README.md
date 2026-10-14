# Evidências PagBank Connect OAuth Sandbox — chamado 1462968488

**Escopo solicitado por Gabriel Santos:** fluxo Connect, desde o cadastro da aplicação até o retorno de `access_token` de uma conta vendedora Sandbox. O pacote anterior de API Order Pix já foi encaminhado. Não repetir pagamentos Pix nesta etapa.

**Tenant QA:** KÔMA QA — PagBank Sandbox (ID 9). **Não alterar** o D8 Burger (ID 8, piloto de produção) nem outros restaurantes.

## Evidências existentes — classificação obrigatória

- `01_consult_application.json`: **consulta HTTP real** `GET https://sandbox.api.pagseguro.com/oauth2/application/{client_id}` com status HTTP 200. Demonstra que uma aplicação Sandbox já cadastrada pode ser consultada. **Não é o log da criação original** `POST /oauth2/application`.
- `02_initiate_authorization.json`: **metadados de preparação** gerados pelo script anterior (URL, escopos e redirect URI previstos). Não é uma navegação realmente observada, não comprova consentimento e não deve ser rotulada como `genuine_sandbox_oauth_initiation` em uma entrega ao banco. O registro de autorização emitida pelo backend é coletado no fluxo novo abaixo.
- O teste HTTP 400 com `code` inválido prova apenas que o endpoint de troca respondeu. **Não comprova** autorização ou `access_token`.

## Como executar e capturar a autorização real

1. Confirmar que `GET /payments/pagbank/status` autenticado **no restaurante 9** informa `environment=sandbox`, `configured=true`, `connected=false`. A seleção efetiva de ambiente é feita pelo backend, e não pelo navegador.
2. No serviço **Kôma** do Railway, definir `PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS=9`. Essa flag não altera credenciais, recebedor ou ambiente; habilita **somente para o tenant 9 em Sandbox** logs sem valores secretos. Nenhum outro restaurante gera evidência.
3. Verificar que existe **um vendedor Sandbox separado do titular da aplicação**, autorizado pelo PagBank. Não utilizar conta de produção nem contornar o bloqueio de conta proprietária.
4. Entrar no KÔMA como administrador do restaurante 9, ir a Configurações → Integrações e clicar **Conectar PagBank**. Não copiar a URL completa; ela contém `state` assinado.
5. Concluir o consentimento no site Sandbox do PagBank e deixar o navegador retornar ao KÔMA **sem executar scripts de token separadamente**. O KÔMA realiza a troca do `code` automaticamente, uma única vez.
6. Filtrar logs do serviço Kôma no Railway por `PAGBANK_OAUTH_EVIDENCE`. A trilha esperada do mesmo `flow_id` (HMAC não reversível do state) é:
   - `authorization_url_issued`: comprova que KÔMA **emitiu** a URL de autorização Sandbox; não prova que o usuário navegou até lá.
   - `callback_received`: comprova que o callback chegou ao KÔMA com `code_present=true`; não inclui o código nem o state original.
   - `token_exchange`: **troca HTTP real**, com método, endpoint Sandbox, grant, status, presença de access/refresh token e account_id, tempo de validade e request ID quando seguro.
   - `connection_completed`: armazenamento validado e conexão concluída para o restaurante correto. Se o titular for rejeitado, aparece `connection_rejected_owner` após a troca de token.
7. Copiar apenas as quatro entradas de evidência necessárias, **revisá-las antes de enviá-las** e anexá-las em documento ou JSON sanitizado fora de quaisquer arquivos de credenciais. Não incluir screenshots de URLs de callback completas ou de abas com tokens.

A trilha é **metadado seguro emitido pelo backend**, e não corpo integral assinado do PagBank. Distinguir claramente logs do KÔMA de respostas bancárias. O log `token_exchange` só existe com sucesso quando o PagBank realmente retorna HTTP 2xx; falhas exibem HTTP real e nenhum token. Não declarar homologação concluída antes de obter uma resposta real e o aceite de Gabriel.

## Coletor de Sandbox

O script `scripts/pagbank-sandbox-evidence.py` continua disponível somente para `application`, `create` e `get`, sempre contra `https://sandbox.api.pagseguro.com`. Operações antigas `authorize`, `callback` e `token` foram removidas para não gerar logs sintéticos de consentimento nem consumir o código OAuth duas vezes. O script não é necessário para executar o Connect.

A variável de captura pode ser removida do Railway após a homologação. Não publicar novas credenciais no Git, em logs ou no ticket.
