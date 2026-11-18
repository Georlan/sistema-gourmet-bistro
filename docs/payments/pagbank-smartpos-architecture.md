# Arquitetura KÔMA SmartPOS — Garçom, Sessão e PagBank PlugPag

Documento técnico de referência para o aplicativo Android nativo (`smartpos-android/`) e integração de liquidação SmartPOS com o backend KÔMA.

---

## 1. Fontes Oficiais Consultadas (data: 2026-11-18)

| Fonte | Versão / Escopo | Observações críticas extraídas |
|---|---|---|
| Repositório oficial `pagseguro/pagseguro-sdk-plugpagservicewrapper` (`github.com/pagseguro/pagseguro-sdk-plugpagservicewrapper`) | Wrapper `v1.35.0` (AAR `br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0`) | Repositório Maven `github.com/pagseguro/PlugPagServiceWrapper/raw/master`; exemplos Android, `PlugPag`, `PlugPagPaymentData`, `PlugPagActivationData`, `PlugPagVoidData`, `PlugPagPrinterData`, `PlugPagTransactionResult`. |
| Documentação Dokka do PlugPag (`pagseguro.github.io/pagseguro-sdk-plugpagservicewrapper/`) | Referência da API `PlugPag` | Métodos síncronos/bloqueantes (exigem thread dedicada fora da UI), `initializeAndActivatePinpad`, `initPagBankActivation`, `doPayment`, `getLastApprovedTransaction`, `voidPayment`, `abort`, `isAuthenticated`, `isServiceBusy`, `printFromFile`, `reprintCustomerReceipt`. |
| Portal PagBank Developers — SmartPOS & FAQ (`developer.pagbank.com.br/docs/integracao-smartpos-1`, `developer.pagbank.com.br/docs/faq-smartpos`) | Integração presencial SmartPOS e homologação | Modelos, processo de homologação via chamado com APK release assinado V1+V2, vídeo demonstrativo, credenciamento comercial e prazo operacional. |

---

## 2. Compatibilidade de Hardware e Android

Os terminais PagBank rodam Android personalizado pelo fabricante sem Google Play Services padrão:

- **PAX A930 / Moderninha Smart e P2-B**: Android 7.x (**API 25**). Por esse motivo, `smartpos-android/app/build.gradle.kts` preserva **`minSdk = 25`** e evita APIs exclusivas da API 26+ sem fallback (`java.nio.file.Files` e `java.time.*` não são usados na camada Android `app`).
- **PAX A50**: Android 8.x (API 26–27).
- **Sunmi P2 (lotes mais recentes) / GPOS 780**: Android 11+ (conforme FAQ oficial).
- **SK800 Totem**: Android 6.x (API 23 — legado fora de `minSdk = 25`).

Requisitos de Manifesto (`smartpos-android/app/src/main/AndroidManifest.xml`):
- Permissão `<uses-permission android:name="br.com.uol.pagseguro.permission.MANAGE_PAYMENTS" />`
- Visibilidade de pacotes Android 11+ (`<queries><package android:name="br.com.uol.pagseguro.plugpagservice" /></queries>`)
- `intent-filter` de pagamento (`br.com.uol.pagseguro.PAYMENT` / `DEFAULT`) para descoberta no launcher SmartPOS quando distribuído em terminal físico.

---

## 3. Contrato do SDK PlugPag e Limites Reais

1. **Valor mínimo e unidade**: `PlugPagPaymentData.amount` é inteiro em **centavos**; valor mínimo presencial = **R$ 1,00 (`100` centavos)**.
2. **Limite de `userReference`**: `PlugPagPaymentData.userReference` aceita no máximo **10 caracteres ASCII alfanuméricos**.
   - Solução no KÔMA: `StableOperationKey.forIntent(intentId, terminalId, "pagbank")` gera a chave longa determinística do backend (`smartpos-<sha256[:48]>`), enquanto `StableOperationKey.userReference10(operationKey)` deriva exatamente **10 caracteres base-36 `[A-Z0-9]`** usados no pinpad e validados na reconciliação.
3. **Execução fora da UI thread**: `AndroidPlugPagClient` e `PlugPagTerminalPaymentBridge` executam no pool assíncrono (`ExecutorService`), nunca na main thread.
4. **Build sem AAR obrigatório no CI/celular padrão**: `AndroidPlugPagClient` detecta `br.com.uol.pagseguro.plugpagservice` e instancia `PlugPag` por reflexão quando o `.aar` oficial da PagBank estiver empacotado num terminal físico. Em celulares Android comuns (ou builds sem AAR proprietário), `isServiceAvailable()` retorna `false` sem `NoClassDefFoundError` e a opção integrada permanece claramente marcada como indisponível (ou usa explicitamente o simulador de backend quando configurado em desenvolvimento).

---

## 4. Fluxo Financeiro, Idempotência e Recuperação Após Interrupção

Caminho canônico backend (`backend/app/routes/smartpos.py`, `smartpos_provider.py`, `backend/app/services/smartpos_settlement.py`):

1. **Prévia / Intenção**: `POST /auth/smartpos/payment-intents` cria `SmartPosPaymentIntent` (`valor` validado no servidor contra o saldo aberto real da mesa/itens selecionados).
2. **Reserva local antes da maquininha**: `TerminalCoordinator` grava `LocalOperation` em `AndroidOperationStore` (`AtomicFile`) antes de chamar `bridge.charge(command)`.
3. **Cobrança e retorno**:
   - **Aprovado (`RET_OK` = `0`)**: registra `outcome = "approved"` com `transactionCode` / `reference` no `/resultado-terminal`.
   - **Recusado / Cancelado pelo cliente**: `outcome = "declined"`.
   - **Timeout (`TIMEOUT_REACHED`) ou queda de rede**: `SmartPosPaymentIntent` permanece em `processando`; o próximo passo (`TerminalCoordinator` -> `bridge.reconcile`) **não chama `doPayment` novamente**.
4. **Recuperação por última transação aprovada**: `PlugPagTerminalPaymentBridge.reconcile()` consulta `client.getLastApprovedTransaction()` e só converte em `APPROVED` se `result == RET_OK`, `userReference == StableOperationKey.userReference10(operationKey)` e `amountMinor == command.amountMinor`. Caso contrário retorna `ERROR` seguro sem duplicar cobrança.
5. **Liquidação por itens, multi-comanda e liberação de mesa**:
   - Quando `escopo == "itens"`, `smartpos_settlement.py` aloca `valor_pago` especificamente nas comandas donas dos `item_ids` selecionados (evitando quitar uma segunda comanda diferente da mesa antes da dona do item) e fecha apenas as comandas quitadas.
   - Antes do `commit`, `reconcile_table_principal()` recalcula o atendimento (`AtendimentoMesa.status = "fechado"` ou promove comanda sobrevivente) e as rotas retornam `mesa_liberada: true` além de emitir WebSocket `MESA_ATUALIZADA` (`status: "livre"`).
6. **Pagamentos manuais / externos / dinheiro**:
   - `capture = null` (`dinheiro_pendente`) ou `"registro_externo"` seguem para `POST /auth/smartpos/payment-intents/{id}/confirmar-manual` com `idempotency_key` estável e cálculo de troco no backend.

---

## 5. Vínculo de Terminal, Operadores e Segurança de Sessão

Implementado em `TerminalSessionStore.kt`:

- **Vínculo terminal -> restaurante**: o aparelho gera um `terminalId` persistente (`POS-<12 hex>`) no primeiro uso e vincula ao `restaurante` retornado por `/auth/smartpos/contexto`. Trocar de restaurante exige confirmação explícita (`Desvincular terminal`) que limpa sessões e rascunhos locais do restaurante anterior.
- **Multi-operador e troca rápida**: cada operador autenticado no mesmo restaurante tem sua entrada criptografada via **AndroidKeyStore AES-256-GCM** (`AndroidKeyStoreCipher`, AAD = URL base da API). Outros garçons no turno podem alternar em 1 toque no seletor de operadores.
- **Revogação e perda do aparelho**:
  - O JWT do KÔMA carrega `tv` (`user_session_versions.token_version`) validado no backend a cada requisição além de checagem de usuário ativo.
  - Ao receber `HTTP 401`, o app invalida imediatamente apenas o token do operador revogado (`invalidateOperatorToken`), preservando o `username` para reautenticação rápida ou troca para outro operador válido.
  - Em caso de perda/roubo do terminal, o administrador revoga os tokens dos operadores afetados no KÔMA (incrementando `token_version` / inativando usuário) e ninguém consegue reabrir sessão sem senha nova.
- **Rascunhos locais**: `DraftStore.kt` persiste rascunhos por restaurante e mesa usando `AtomicFile`, exibindo claramente no Salão quais mesas têm rascunhos não enviados e restaurando após fechamento do app.

---

## 6. Matriz Honesta de Verificação e Pendências PagBank

| Camada | Estado Atual | Evidência / Condição |
|---|---|---|
| **App Android Garçom (Salão, Consumo, Cardápio, Modificadores, Rascunho, Caixa/Externo/Dinheiro, Histórico, Troca de Operador)** | Implementado e compilado via CI (`assembleDebug`) | Testes unitários JUnit + validação em celular Android real conectado via USB |
| **Correções de Liquidação Backend (`escopo="itens"`, reconciliação de `AtendimentoMesa` e `mesa_liberada`)** | Implementado e integrado | Suíte `pytest` (`test_smartpos*.py`) verde |
| **Bridge PagBank PlugPag (`PlugPagTerminalPaymentBridge`, `userReference10`, `reconcile` por `getLastApprovedTransaction`)** | Implementado + coberto em testes unitários com fake client | Testado apenas com cliente fake em JVM (`PlugPagTerminalPaymentBridgeTest`); `AndroidPlugPagClient` usa reflexão segura |
| **Execução física em maquininha PagBank (Moderninha Smart / PAX A930 / P2)** | **Pendente de hardware, AAR comercial e credenciais PagBank** | Requer: (1) incorporar `br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0` num flavor/release após obtenção de terminal de desenvolvimento, (2) código de ativação sandbox PagBank, (3) execução de cobrança/cancelamento/impressão presencial |
| **Homologação oficial PagBank e publicação na loja PagBank** | **Pendente** | Requer abertura de chamado "Homologação de App" com APK release assinado V1+V2, vídeo demonstrativo do fluxo de UI + cobrança PlugPag, aprovação técnica (~7 dias úteis) e vinculação via Painel do Revendedor |
