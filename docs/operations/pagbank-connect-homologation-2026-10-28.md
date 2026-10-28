# PagBank Connect / Order Pix — decisões de homologação e diagnóstico (2026-10-28)

## Evidência confirmada pelo suporte

Fonte privada: correspondências com o time Integrações PagBank, chamados **1462968488** e **1461335012** (10–26/10/2026). Não copiar credenciais, senhas, documentos pessoais ou conteúdos de e-mail para o repositório.

- 12/10: a triagem aceitou o escopo e o schema dos logs reais da API Order; exigiu request/response reais e sanitizados, IDs emitidos pelo provedor, sem valores de cartão/CVV ou exemplos como evidência.
- 15/10: Connect Sandbox aceita conta principal com CPF/CNPJ; vendedor Sandbox antigo sem documento não é válido; ao enfrentar o erro de login do Sandbox, entrar no portal do desenvolvedor antes da autorização.
- 16/10: Connect Sandbox foi comprovado com troca `/oauth2/token` HTTP 200, mas em modo de evidência, sem transformar a conta proprietária da aplicação em recebedora.
- 16/10: o suporte alertou que conta PF perfil V pode enfrentar restrições de risco no Connect; em 26/10 foi enviada a **confirmação de homologação concluída em produção**. Não reutilizar restrições antigas como prova de rejeição atual.
- 20/10: criar a aplicação Connect com o **token de produção** e preservar os dados retornados; a liberação comercial do Connect é vinculada ao `client_id` de produção. Não recriar a aplicação automaticamente ao resolver OAuth.
- 21/10: token de produção gerado no iBanking em Vendas > Plataformas e Checkout > Integrações; é necessária chave Pix cadastrada. O suporte recomendou criar chave pública de produção, **sem confirmar no e-mail qual tipo (card ou webhook)**.
- 22–23/10: foi informado ao suporte que Pix real foi recebido, mas o webhook havia retornado HTTP 401; foi **solicitada** confirmação do token correto da assinatura para Order + OAuth Connect, do modelo ECDSA e dos identificadores `ORDE_`/`CHAR_`. **Não foi identificada resposta resolvendo essas três perguntas.**
- 28/10 (02:13–02:14 UTC-3): produção registrou `41012` no token exchange (`POST /oauth2/token`), `40002` no `customer.email`, e notificações não autenticadas HTTP 401 para o pedido #127 de R$ 18,90 (`candidate_count=3`).
- 28/10 (análise e comprovação técnica):
  - **Problema A (OAuth 41012):** O endpoint `GET /oauth2/application/{client_id}` com o token configurado responde `HTTP 403`, e o token exchange respondeu `41012`. Esses resultados não identificam, por si, a causa do 403 nem provam que o token da aplicação foi revogado. A documentação associa 41012 a access/refresh token já utilizado ou que não pertence ao usuário atual; a relação entre credenciais e contas requer confirmação. A conta anterior permaneceu ativa.
  - **Problema B (Webhook 401):** Os eventos observados usaram `x-authenticity-token` e nenhum candidato validou. A documentação geral descreve SHA256 do token da conta fornecido no iBanking e do corpo bruto, mas não esclarece qual conta assina especificamente Order com Connect. A variável opcional do piloto estava ausente. Não se comprovou que o token configurado esteja inativo nem qual token assinou o evento.
  - **Problema C (customer.email):** Teste real executado contra a API Sandbox comprovou que omitir `customer.email` resulta em `HTTP 400 code 40001 (must not be null, parameter_name: customer.email)`. Portanto, o e-mail do comprador é estritamente obrigatório pelo contrato da API Order. A validação local foi corrigida para aceitar e-mails a partir de 6 caracteres (ex.: `a@b.cd`, `a@usp.br`, aceitos com HTTP 201 no PagBank) em vez do piso anterior de 10 caracteres, e falhas de formato/ausência agora retornam HTTP 422 para que o cliente possa corrigir o dado no checkout sem perder o pedido.

## Credenciais com papéis diferentes (não misturar)

| Credencial | Uso | Não usar para |
| --- | --- | --- |
| `PAGBANK_PRODUCTION_APP_TOKEN` | Bearer de **aplicação** nos endpoints OAuth Connect no código atual | Assumir automaticamente que é o token do recebedor que assina Order |
| `PAGBANK_PRODUCTION_CLIENT_ID` + `CLIENT_SECRET` | Identificação e segredo da aplicação Connect de produção | Criar chave Pix ou substituir token de conta |
| `RestaurantPaymentAccount.access_token` | OAuth delegado do restaurante, após autorização | Usar o token de plataforma para outro tenant |
| `PAGBANK_PRODUCTION_PILOT8_WEBHOOK_IBANKING_TOKEN` | **Opcional**; token da **conta recebedora** para validar SHA256 do webhook Order apenas do tenant 8, quando autorizado para o piloto | Chamar `/orders`, `/oauth2/token`, atribuir a outros restaurantes ou declarar webhook homologado antes de evento real |
| `PAGBANK_WEBHOOK_PUBLIC_KEY` | Chave pública X.509 Base64 do serviço **webhook**, apenas se origem/tipo confirmados | Usar uma chave `card`, `3DS` ou de recorrência como verificador |
| Chave pública `card` | Criptografia dos dados de cartão | Verificar `x-payload-signature` |

Fontes públicas: [códigos Connect](https://developer.pagbank.com.br/reference/codigos-de-erro-connect), [assinatura SHA256 tradicional](https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao), [assinatura ECDSA e type=webhook](https://developer.pagbank.com.br/reference/validacao-de-autenticidade), [tipos de chaves](https://developer.pagbank.com.br/reference/consultar-chave-publica).

A documentação ECDSA exemplifica o endpoint Sandbox `/public-keys?type=webhook`, mas orienta confirmar a URL de produção do serviço novo antes de usá-la. **Não implementar GET automático para URL de produção não homologada.** A configuração manual de chave deve vir de fonte oficial validada e não de captura de e-mail com chave genérica.

## Procedimento seguro no próximo incidente

1. Conferir SHA do deploy Railway vs main; pesquisar por código de suporte e janela UTC, mas **nunca** imprimir valor de variável, bearer, OAuth code/state, corpo de webhook nem dados do comprador.
2. `41012` ou `41008` durante `POST /oauth2/token`: registrar o código e verificar com PagBank as credenciais e a relação entre aplicação, conta e autorização. Não concluir apenas pelo código que o `APP_TOKEN` foi revogado. Se uma credencial deve mudar, avaliar dependências e recuperação; verificar `client_id`, callback, scopes e ambiente. Não apagar a conta anteriormente conectada.
3. `40001` ou `40002` em `customer.email`: o backend informa 422 com orientação de revisar o e-mail. Existe relato público de conflito com e-mail do recebedor, e o campo é obrigatório pelo provedor. Não inventar e-mail e não repetir cobrança automaticamente.
4. Webhook 401: usar apenas telemetria do **piloto 8** (`origin`, formato da assinatura, presença de chave pública e número de candidatos). A documentação geral de `x-authenticity-token` usa o token da conta no iBanking e o corpo bruto; confirmar com o PagBank qual conta se aplica ao Order com Connect antes de configurar a variável opcional. Para `x-payload-signature`, utilizar exclusivamente chave pública `type=webhook` verificada. Ausência/divergência continuam HTTP 401.
5. Se pedido for pago, provar o caminho de confirmação (webhook autenticado **ou** worker de reconciliação) e conferir idempotência: uma cobrança, um pagamento, nenhum lançamento duplicado, tenant correto. O polling da página do comprador é caminho independente.
6. Enviar ao suporte sanitizados: horário UTC, endpoint, status HTTP, código de erro permitido, tipo de assinatura, request ID permitido e impacto. Nunca compartilhar senha, CPF, endereço, tokens, assinatura real ou corpo original contendo PII.

## Portões de liberação

- Testes automatizados, CI de segurança e `Merge verdict` verdes antes do merge.
- Deploy Railway/Cloudflare confirmado na versão correta, sem mudança de credenciais automática.
- A simples criação de QR Code não homologa o webhook. Até o método de assinatura ser confirmado, executar testes de geração de cobrança **sem pagar** e não repetir pagamentos reais.
- **Segurança operacional:** credenciais temporárias de login de homologação foram compartilhadas por e-mail em 20/10; solicitar revogação/rotação e verificar acessos desse usuário, fora da PR e sem publicar senha no repositório.
