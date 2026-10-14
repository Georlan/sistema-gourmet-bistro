# Evidências PagBank Connect OAuth Sandbox — Chamado 1462968488

**Analista PagBank:** Gabriel Santos  
**Plataforma:** KÔMA (SaaS Multi-tenant para Restaurantes)  
**Restaurante QA:** KÔMA QA — PagBank Sandbox (ID 9)  
**Ambiente:** Sandbox (`https://sandbox.api.pagseguro.com`)  
**Data:** 14/10/2026  

---

## 1. Escopo da Demonstração

Conforme alinhado expressamente com Gabriel Santos no chamado 1462968488, a bateria anterior de 11 trocas HTTP da API Order Pix com estados, consultas e idempotência já foi aprovada na triagem.

Esta etapa cobre exclusivamente o **fluxo Connect OAuth no Sandbox**, desde a identificação da aplicação até a autorização e obtenção do `access_token`.

---

## 2. Inventário de Evidências

### A. Aplicação Connect (`01_consult_application.json`)
- **Operação:** `consult_application`
- **Método / Endpoint:** `GET https://sandbox.api.pagseguro.com/oauth2/application/c555229e-d90a-4e32-b28c-814f0f19c793`
- **Autenticação:** `Bearer [REDACTED]` (App Token da aplicação Sandbox KÔMA)
- **Status HTTP:** `200 OK`
- **Validação:** confirma o cadastro ativo da aplicação, client_id, tipo `confidential`, account_id proprietária `ACCO_1A624D03-01FE-43D0-A85A-5DF579EBB36A` e redirect_uri HTTPS cadastrada.

### B. Início da Autorização (`02_initiate_authorization.json`)
- **Operação:** `initiate_authorization`
- **Método / Endpoint:** `GET https://connect.sandbox.pagbank.com.br/oauth2/authorize`
- **Escopos solicitados:** `payments.read payments.create payments.refund accounts.read`
- **Redirect URI:** `https://sistema-gourmet-bistro-production.up.railway.app/payments/pagbank/oauth/callback`
- **Proteção do `state`:** gerado com HMAC assinado e validade de 10 minutos, criptograficamente vinculado ao restaurante ID 9 e ao administrador autenticado, mantendo o limite estrito de 128 caracteres do PagBank.

### C & D. Autorização do Vendedor e Troca de Código por Token
- O comando automatizado para captura do token exchange está pronto em `scripts/pagbank-sandbox-evidence.py token --output docs/payments/evidence/1462968488/04_exchange_token.json`.
- A chamada realiza `POST https://sandbox.api.pagseguro.com/oauth2/token` com `grant_type: authorization_code`, `Authorization: Bearer <PAGBANK_APP_TOKEN>`, `X_CLIENT_ID` e `X_CLIENT_SECRET`.
- A validação de endpoint contra o Sandbox PagBank já foi confirmada com resposta técnica HTTP 400 (`code: 41001, parameter_name: code`), comprovando a conectividade com a API oficial sem mocks.
- A conclusão com sucesso exige o consentimento humano de uma conta de vendedor de testes Sandbox no portal do PagBank.
