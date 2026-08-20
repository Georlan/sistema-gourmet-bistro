# Kôma SmartPOS Android Bridge

Núcleo Kotlin + aplicativo Android de desenvolvimento do SmartPOS. O core F8–F12 mantém o domínio de pagamento independente do SDK PagBank e permite validar o ciclo completo de uma operação simulada. Este módulo ainda não processa cobranças reais.

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
- aprovações confirmadas pelo simulador são liquidadas no backend, criando `Pagamento`, alocações financeiras e projeção no Caixa;
- dinheiro, PIX e cartões manuais, split de pagamentos, reservas, cancelamento seguro e recuperação manual de estorno são cobertos pelo backend F9–F12.

## APK de desenvolvimento

O APK parte da raiz da API do Kôma, autentica e carrega restaurante, operador e estado do caixa. Depois lista os recebimentos integrados disponíveis para aquele terminal. O resultado do hardware ainda é escolhido no `FakeBridge` (`approved`, `declined`, `pending`, `timeout`, `error`) para exercitar o fluxo completo sem maquininha.

O `terminalId` é derivado do Android ID e o estado operacional fica no diretório privado do aplicativo. Retry ou reinício preservam a mesma chave de operação e entram em reconciliação.

O workflow Android executa os testes do core e `:app:assembleDebug`, publicando o APK como artifact `koma-smartpos-dev-apk`. O artifact é exclusivo para desenvolvimento e homologação interna.

## Ainda fora de escopo

- SDK PlugPag real;
- adapter de provider real no backend;
- estorno físico confirmado pelo adquirente;
- UX final e processo de atualização do aplicativo;
- APK release assinado e distribuição controlada;
- terminal físico/homologação PagBank;
- testes de campo, observabilidade e runbook de suporte.

## Ativação segura

O backend usa `KOMA_SMARTPOS_PROVIDER=disabled` por padrão. Somente ambientes de desenvolvimento/teste devem definir `pagbank_simulator`. A existência do APK ou da capability `smartpos` não transforma o simulador em meio de pagamento real.
