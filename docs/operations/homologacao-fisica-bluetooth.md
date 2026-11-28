# Roteiro Objetivo de Homologação Física — Impressão Térmica Bluetooth (Android)

> **Regra de evidência:** testes unitários, emuladores, HTTP 200 e build verde **não** comprovam impressão física. Somente declarar homologado após cumprir cada item em dispositivo Android real com impressora Bluetooth real.

> [!WARNING]
> **Versão obrigatória do APK antes de testar em campo:** a release pública `android-print-v1.1.0-preview` (commit `d9f6d0c4`, publicada em 2026-11-14) **é anterior** às correções do `#1470` (`31e83485` — autenticação do agente) e da Wave 1 (`87aeadc0` — suporte 58 mm / 80 mm e vinculação mobile). **Não distribuir esse APK antigo para cliente.** Antes da homologação física, baixar o artifact mais recente `koma-print-android-debug-apk` do workflow `KOMA Print Android` no GitHub Actions ou publicar nova tag de release com o código atual de `main`.

## 1. Pré-requisitos de hardware e sistema
- [ ] Celular Android (Android 8.0+ / API 26+) com o build atualizado do **KÔMA Print Android** instalado e permissão **Dispositivos próximos** (`BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN`) concedida.
- [ ] Confirmar no card de status do app que a versão instalada corresponde ao build pós-Wave 1 (com seleção de largura 58 mm / 80 mm visível).
- [ ] Impressora térmica Bluetooth Classic SPP (58 mm, ex.: Kapbom KA-1445 / MPT-II / Goojprt, ou 80 mm compatível) ligada e com bobina carregada.
- [ ] Confirmar que a impressora já aparece como **pareada** em *Configurações → Bluetooth* do Android (PIN padrão geralmente `0000` ou `1234`).

## 2. Vinculação 1-toque e primeira impressão
- [ ] No navegador do celular (ou desktop), abrir **Caixa → Configurações → Impressão → Celular Android**.
- [ ] Tocar em **Conectar Celular** e confirmar a vinculação no app **KÔMA Print** (sem digitar token manual).
- [ ] Verificar no painel **Impressora principal do restaurante** que o agente do celular está marcado como **principal** (caso haja outro agente antigo, tocar em **Usar este aparelho como principal**).
- [ ] No app KÔMA Print, selecionar a impressora pareada e tocar em **Imprimir Teste**.
- [ ] **Evidência física:** conferir no papel impresso se a largura (32 col. em 58 mm ou 48 col. em 80 mm), acentuação, preço alinhado à direita e corte/avanço estão íntegros.

## 3. Fluxo real de pedido no celular
- [ ] Realizar um pedido de teste (Retirada ou Delivery) em tenant de teste/homologação (**nunca no tenant ID 6**).
- [ ] Aceitar o pedido no Caixa mobile e verificar se o cupom sai automaticamente na térmica Bluetooth.
- [ ] Acionar **Reimprimir** no card/detalhe do pedido e confirmar que sai apenas 1 via de reimpressão marcada como `REIMPRESSÃO`.

## 4. Resiliência de expediente (obrigatório antes de declarar pronto para operação)
- [ ] **Alternância WhatsApp ↔ KÔMA:** abrir o WhatsApp por 60 segundos, retornar ao KÔMA e confirmar reconciliação imediata da fila de pedidos e impressão.
- [ ] **Tela bloqueada:** bloquear a tela do Android por 2 minutos e enviar um pedido; verificar se o `KomaPrintForegroundService` imprime sem exigir desbloqueio. (Se o fabricante suspender, aplicar *Liberar Bateria do Fabricante* na seção Avançada do app e repetir o teste.)
- [ ] **Desconexão física:** desligar a impressora térmica durante um expediente simulado, enviar 2 pedidos, religar a impressora e confirmar:
  - [ ] Os 2 pedidos pendentes são impressos após reconexão RFCOMM automática.
  - [ ] Um pedido já impresso **não** é impresso em duplicidade (`PrintJournalStore` + backend ACK).

## 5. Registro de homologação
- Modelo do celular e versão do Android: `____________________________`
- Modelo da impressora térmica (58 mm / 80 mm): `____________________________`
- Data / responsável / resultado: `____________________________`
