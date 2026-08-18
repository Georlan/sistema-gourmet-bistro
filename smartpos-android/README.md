# Kôma SmartPOS Android Bridge

Núcleo Kotlin + shell Android de desenvolvimento da SmartPOS. A Fase 8 mantém o domínio de pagamento independente do SDK PagBank e permite testar o ciclo do terminal sem hardware físico.

## Garantias atuais

- `charge` ocorre no máximo uma vez por `operationKey`;
- a operação local é vinculada a `intentId + provider + operationKey + terminalId`;
- a reserva é persistida antes da chamada ao bridge;
- reinício/retry de operação existente usa `reconcile`, nunca uma nova cobrança;
- resultados finais (`approved`/`declined`) são cacheados e podem ser reenviados ao backend sem tocar novamente no SDK;
- `FileOperationStore` persiste a operação em disco com troca atômica de arquivo;
- `KomaTerminalBackendApi` implementa o protocolo HTTP `preparar-terminal -> executar/reconciliar -> resultado-terminal`;
- o transporte HTTP usa `HttpURLConnection`, compatível com o harness JVM e com Android;
- o módulo `app` gera um APK `debug` instalável com `FakeTerminalPaymentBridge`;
- login reutiliza `/auth/login` e o contexto oficial `/auth/smartpos/contexto`;
- o token da sessão permanece somente em memória e é descartado no logout/process death;
- a fila do terminal contém apenas intents `provider_integrado` ativos, do tenant atual, livres ou já vinculados ao mesmo terminal;
- a `operationKey` é derivada de forma estável de `provider + terminal + intent`, sem entrada manual do operador;
- nenhum dado sensível de cartão é armazenado pelo core.

## APK de desenvolvimento

O APK parte da raiz da API do Kôma, autentica e carrega restaurante, operador e estado do caixa. Depois lista os recebimentos integrados disponíveis para aquele terminal. O resultado do hardware ainda é escolhido no `FakeBridge` (`approved`, `declined`, `pending`, `timeout`, `error`) para exercitar o fluxo completo sem maquininha.

O `terminalId` é derivado do Android ID e o estado operacional fica no diretório privado do aplicativo. Retry ou reinício preservam a mesma chave de operação e entram em reconciliação.

O build de CI executa os testes do core e `:app:assembleDebug`, publicando o APK como artifact `koma-smartpos-dev-apk`.

## Ainda fora de escopo

- SDK PlugPag real;
- UX final da SmartPOS;
- terminal físico/homologação PagBank;
- criação de `Pagamento`, ledger, baixa de item ou fechamento de comanda;
- F9/liquidação.
