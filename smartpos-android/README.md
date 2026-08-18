# Kôma SmartPOS Android Bridge

Núcleo Kotlin isolado do futuro app Android da SmartPOS. Ele existe para testar o domínio do terminal sem depender do Android Framework nem do SDK PlugPag.

## Garantias atuais

- `charge` ocorre no máximo uma vez por `operationKey`;
- a operação local é vinculada a `intentId + provider + operationKey + terminalId`;
- a reserva é persistida antes da chamada ao bridge;
- reinício/retry de operação existente usa `reconcile`, nunca uma nova cobrança;
- resultados finais (`approved`/`declined`) são cacheados e podem ser reenviados ao backend sem tocar novamente no SDK;
- `FileOperationStore` persiste a operação em disco com troca atômica de arquivo;
- `KomaTerminalBackendApi` implementa o protocolo HTTP `preparar-terminal -> executar/reconciliar -> resultado-terminal`;
- `JdkHttpTransport` é apenas o transporte do harness JVM; no APK Android ele será substituído por um transporte Android mantendo o mesmo contrato;
- nenhum dado sensível de cartão é armazenado pelo core.

## Ainda fora de escopo

- SDK PlugPag real;
- UI/APK Android final;
- terminal físico/homologação;
- criação de `Pagamento`, ledger, baixa de item ou fechamento de comanda.
