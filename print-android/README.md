# KÔMA Print Android (Bluetooth Classic SPP 58 mm)

Agente Android nativo em Kotlin para impressão direta em impressoras térmicas **58 mm Bluetooth Classic SPP** (como a **Kapbom KA-1445**), sem computador e sem RawBT.

Reutiliza integralmente o **Core Universal de Impressão** e os endpoints oficiais `/api/print-agents/*` do backend KÔMA (`register`, `heartbeat`, `actions/{id}/complete`, `jobs/claim-batch`, `jobs/complete-batch`, `jobs/release-batch` e `jobs/{id}/fail`).

## Arquitetura e Módulos

- `:koma-print-android-core` (`print-android/src/main/kotlin/br/com/koma/print/core/`):
  - `Models.kt`: contratos de `BluetoothPrinterDevice` (`dispatchable`, `ready`, UUID SPP `00001101-0000-1000-8000-00805F9B34FB`), `PrinterPaperProfile` (detecção automática da **Kapbom KA-1445**: 58 mm, 32 colunas, 384 dots, sem guilhotina, `compact_58`, `ascii_safe`) e estágios de entrega (`RECEBIDO_LOCAL`, `ENVIADO_TRANSPORTE`, `CONFIRMADO_BACKEND`, `IMPRESSO_FISICAMENTE_VERIFICADO`).
  - `EscPos58Renderer.kt`: projeção fiel de 48 para 32 colunas (`ESC @`, `ESC t 3`, remoção de `[CUT]` e sem emissão de `GS V B 0` em bobinas sem corte automático).
  - `PrintJournalStore.kt`: diário local persistido em disco com escrita atômica (`FilePrintJournal`), garantindo que nenhum pedido que já atingiu `ENVIADO_TRANSPORTE` seja reimpresso fisicamente caso a rede oscile antes do retorno de `complete-batch`.
  - `BluetoothSppTransport.kt`: política de reconexão RFCOMM em 3 estratégias (`SECURE_SPP_UUID`, `INSECURE_SPP_UUID`, `RFCOMM_CHANNEL_1_FALLBACK`), escrita fatiada em blocos de 256 bytes (`writeChunked`) para evitar truncamento no buffer serial da KA-1445 e matriz multi-marca (`OemCompatibilityPolicy`) para Android 8.0+ (API 26+).
  - `KomaPrintAgentApi.kt`: cliente HTTP oficial para `/auth/login` e `/api/print-agents/*`.
  - `AndroidPrintWorker.kt`: ciclo completo de reconciliação de ACKs pendentes, execução de comando remoto `test_bluetooth`, reivindicação em lote (`claim-batch`) e liberação imediata de jobs não tocados (`release-batch`) se o Bluetooth desconectar no meio do lote.
- `:app` (`print-android/app/`):
  - `AndroidBluetoothSppAdapter.kt`: integração com `BluetoothAdapter` e `BluetoothSocket` Android.
  - `KomaPrintForegroundService.kt`: serviço em primeiro plano (`connectedDevice|dataSync`) com `PARTIAL_WAKE_LOCK` durante o envio para imprimir automaticamente com a tela bloqueada.
  - `BootCompletedReceiver.kt`: retomada automática após reinicialização do celular.
  - `MainActivity.kt`: tela do operador para pareamento KÔMA, seleção da impressora Bluetooth 58 mm, botão **Imprimir Teste 58mm** e guia de bateria por marca (Samsung One UI, Xiaomi MIUI/HyperOS, Motorola, Realme/OPPO).

## Testes e Build

```bash
gradle -p print-android test :app:assembleDebug --no-daemon
```


## Instalação rápida no restaurante (v1.1.0)

1. Ligue a impressora e pareie com o Android em Configurações → Bluetooth.
   O app trabalha com dispositivos pareados e não exige busca/localização.
2. Instale o APK e abra KÔMA Print. No Android 12+, permita Dispositivos próximos.
3. No Caixa KÔMA da loja, abra Configurações → Impressão → Conectar celular.
   Confirme o nome da loja no app; não digite tokens manualmente.
4. Em Impressora Bluetooth, escolha a impressora de 58 mm. Se houver mais
   de uma, toque em Salvar impressora escolhida.
5. Toque em Imprimir Teste 58 mm e confira fisicamente o papel.
6. Confirme KÔMA online • monitorando pedidos. O serviço usa notificação de
   primeiro plano para continuar trabalhando com a tela bloqueada.

Bateria: a isenção de otimização não é pré-requisito de instalação.
Se o fabricante suspender a impressão com a tela bloqueada, abra a seção
Configuração Manual (Avançada) e use Liberar Bateria, somente quando necessário.

Falha ou troca de impressora: se a preferida desaparecer, o KÔMA não desvia
comandas para outro dispositivo. Pareie novamente ou escolha e salve outra.
Confira a fila no Caixa antes de reconfigurar o agente. O diário local protege
contra reimpressões acidentais após oscilações de rede.

Atualizações: o APK precisa ser atualizado para instalar mudanças do aplicativo.
Alterações do texto da comanda no backend passam a valer para novos pedidos
sem nova instalação.

Sobre o APK de CI: app-debug.apk é um build de teste. A assinatura debug
pode mudar entre runners do GitHub e impedir atualização sobre outra build.
Não desinstale um agente com trabalhos pendentes: reconcilie a fila antes de
reinstalar e reconfigurar. A distribuição final precisa de assinatura de
release persistente controlada pelo projeto.
