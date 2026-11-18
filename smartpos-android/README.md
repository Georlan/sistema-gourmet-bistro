# KÔMA Garçom & Pagamento para SmartPOS (`smartpos-android`)

Aplicativo Android nativo para operação de garçom em salão e integração de pagamento SmartPOS (PagBank PlugPag / registro externo / dinheiro) com o backend KÔMA.

Consulte a documentação completa da arquitetura, sessão, liquidação e homologação PagBank em [`../docs/payments/pagbank-smartpos-architecture.md`](../docs/payments/pagbank-smartpos-architecture.md).

## Funcionalidades implementadas

- **Salão e projeções operacionais**: exibição de mesas livres, ocupadas, prontas para servir (respeitando `perm_garcom_status`), aguardando pagamento (`aguardando_pagamento`), juntas (`MERGED`), número do pedido persistido, saldo em aberto e tempo decorrido; filtros `Todas`, `Livres`, `Ocupadas` e `Prontas`; atalho direto `Lançar` / `Novo pedido` / `Rascunho`.
- **Consumo e cozinha**: resumo financeiro (`Consumo`, `Pago`, `Em aberto`), filtro por comanda, bloco destacado de itens prontos com `Servir` / `Servir todos`, solicitação de conta (`PUT /comandas/{id}/pedir-conta`), atalho `+1` e botão `Cobrar`.
- **Cardápio touch-first**: categorias, famílias/variações declaradas (`familia_id`), regras de grupos obrigatórios/opcionais/porções/escolha única, chips rápidos de observações (`VIAGEM`, `PRA MESA`, presets da categoria e ingredientes), revisão com edição/remoção + desfazer e envio idempotente (`PendingOrderStore`).
- **Rascunhos persistentes (`DraftStore`)**: rascunhos salvos por restaurante e mesa com `AtomicFile`, exibidos claramente no Salão entre reinícios.
- **Vínculo de terminal e sessão segura (`TerminalSessionStore`)**: vínculo persistente terminal -> restaurante com tokens cifrados via `AndroidKeyStore` (AES-256-GCM), troca rápida entre operadores autenticados no mesmo terminal, revogação imediata em `HTTP 401` e desvinculação explícita.
- **Pagamentos e bridge PagBank (`PlugPagTerminalPaymentBridge` / `AndroidPlugPagClient`)**:
  - Cobrança por valor (teclado numérico em centavos + atalhos `Total`, `1/2`, `1/3`, `1/4`) ou por seleção de itens (`escopo="itens"`).
  - Formas `Crédito`, `Débito`, `Pix` e `Dinheiro` (cálculo automático de troco).
  - Integração via `TerminalRuntime` + `TerminalCoordinator` + `PlugPagTerminalPaymentBridge` (`userReference10`, reconciliação via `getLastApprovedTransaction` e recuperação de estado `processando`). Quando o serviço `br.com.uol.pagseguro.plugpagservice` não está presente no aparelho, a cobrança física PagBank é marcada explicitamente como indisponível (com suporte separado apenas para simulador quando ativo no backend).
- **Histórico recente**: consulta às 5 últimas operações (`/auth/smartpos/payment-intents/recentes`) com visualização e compartilhamento de comprovante textual.

## Desenvolvimento e build

No Android SDK 36 com `minSdk = 25` (compatível com terminais PagBank Android 7+ como PAX A930):

```sh
gradle -p smartpos-android test :app:testDebugUnitTest :app:assembleDebug
```

O workflow `.github/workflows/smartpos-android-bridge.yml` executa os testes unitários dos módulos `:` (bridge) e `:app`, além de publicar o artefato `koma-garcom-smartpos-apk` (`versionCode = 5`, `versionName = "0.3.0"`).

Para apontar um build debug para backend local no emulador: `-PkomaApiUrl=http://10.0.2.2:8000`. Builds padrão apontam para a API HTTPS configurada no projeto.

## Fontes oficiais PagBank consultadas (2026-11-18)

- [PagBank PlugPagServiceWrapper — GitHub (`v1.35.0`)](https://github.com/pagseguro/pagseguro-sdk-plugpagservicewrapper)
- [PlugPag API Reference (Dokka)](https://pagseguro.github.io/pagseguro-sdk-plugpagservicewrapper/)
- [PagBank SmartPOS — Integração](https://developer.pagbank.com.br/docs/integracao-smartpos-1)
- [PagBank SmartPOS — FAQ](https://developer.pagbank.com.br/docs/faq-smartpos)
