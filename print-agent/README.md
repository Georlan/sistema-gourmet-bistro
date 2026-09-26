# Kôma Print Agent

Serviço local que recebe da fila do Kôma e envia cupons ESC/POS para a
impressora térmica. Ele funciona sem depender do navegador permanecer aberto.

## Instalação no Linux

O agente roda silenciosamente em segundo plano como serviço `systemd --user`.
A instalação normal não exige que o cliente mantenha terminal aberto e o
transporte da impressora pode ser USB, Bluetooth SPP/RFCOMM ou uma fila/rede
suportada pelo sistema.

Na raiz do repositório:

```bash
bash print-agent/install-linux.sh
```

Também é possível instalar sem clonar o projeto:

```bash
curl -fsSL https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-linux.sh | bash
```

O instalador baixa os arquivos quando necessário, prepara um virtualenv
dedicado em `~/.local/share/koma-print-agent`, abre o KÔMA uma única vez para
autorizar o computador, registra `koma-print-agent.service`, habilita restart
automático e preserva credenciais/configuração em atualizações.

Atualização:

```bash
curl -fsSL https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-linux.sh | bash -s -- --update
```

Desinstalação preservando configuração:

```bash
curl -fsSL https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-linux.sh | bash -s -- --uninstall
```

Use `--purge` somente quando também quiser apagar credenciais e dados locais.

### Bluetooth no Linux

Bluetooth Classic SPP é um transporte operacional de primeira classe. Uma
impressora pareada com SPP normalmente permanece com `Connected=no` no BlueZ
quando ociosa. O diagnóstico periódico respeita esse estado e **não** abre
sockets RFCOMM apenas para testar presença, evitando notificações repetidas de
"conectado/desconectado" no desktop. Pareamento + SPP significam que o endpoint
está configurado para uma tentativa sob demanda; presença física e conexão
atual continuam sendo estados separados. Quando existe uma impressão real, o
socket RFCOMM é aberto, transmite o payload ESC/POS e fecha ao final. Não há
dependência obrigatória de `/dev/rfcomm0`, `sudo` ou fila CUPS para esse
caminho.

## Instalação no Windows

O agente roda em segundo plano por uma tarefa agendada do Windows usando
`pythonw.exe`, sem janela permanente. A tarefa inicia no logon do usuário,
é recriada em atualizações e preserva credenciais e configuração.

Com o projeto extraído, clique duas vezes em:

```text
INSTALAR-KOMA-WINDOWS.cmd
```

Ou instale diretamente pelo PowerShell, sem clonar o repositório:

```powershell
irm https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-windows.ps1 | iex
```

Se Python 3.10+ não estiver disponível, o instalador tenta instalar Python
3.12 para o usuário via `winget`.

Atualização remota:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-windows.ps1'))) -Update
```

Desinstalação preservando credenciais/configuração:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Georlan/sistema-gourmet-bistro/main/print-agent/install-windows.ps1'))) -Uninstall
```

Quando o repositório estiver extraído, `ATUALIZAR-KOMA-WINDOWS.cmd` e
`DESINSTALAR-KOMA-WINDOWS.cmd` oferecem os mesmos fluxos com duplo clique.

O cliente não precisa escolher CUPS, RFCOMM, Spooler ou URI. Essas informações
ficam restritas ao diagnóstico técnico; para operação, o KÔMA apresenta a
impressora pelo nome e estado, com USB/Bluetooth/Rede apenas como detalhe.

A partir da versão `2026.09.20.1`, o agente também instala a ponte local do
simulador térmico em `127.0.0.1:17654-17664`. Ela só é usada pela bancada
interna de engenharia e nunca envia bytes ao CUPS/USB durante a simulação.

Na versão `2026.09.20.2`, a bancada pode ativar **simulação automática em modo
sombra**. O agente observa PrintJobs novos pelo feed tenant-scoped e pelo mesmo
wake-up usado pela impressão real, converte o payload com o pipeline ESC/POS e
mede a latência. Esse modo não faz claim, não confirma o job e não escreve no
CUPS/USB; portanto não falsifica uma impressão física.

## Instalação no Windows

Pré-requisitos: a impressora disponível no Spooler do Windows. Se Python 3.10+
não estiver instalado, o instalador usa o `winget` para instalar Python 3.12 no
perfil do usuário.
Extraia o projeto e clique duas vezes em:

```text
INSTALAR-KOMA-WINDOWS.cmd
```

O atalho abre o instalador, faz o pareamento e valida a tarefa local. Como
alternativa, abra o PowerShell na raiz do projeto e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\print-agent\install-windows.ps1
```

O instalador pareia o computador, instala o adaptador RAW, registra a tarefa
`KomaPrintAgent` para iniciar no logon e configura o atalho `koma-print://`.

Depois, `VERIFICAR-KOMA-WINDOWS.cmd` mostra em uma tela curta se o agente está
instalado, se a tarefa está ativa, qual fila o Kôma memorizou e qual continua
sendo a impressora padrão do Windows.

### Convivência com Anota AI e outros sistemas

- O Kôma memoriza o nome exato da fila escolhida e não altera a impressora
  padrão do Windows.
- Se já existir uma única fila USB pronta (por exemplo, instalada para o Anota
  AI), o Kôma a seleciona automaticamente em até alguns segundos.
- Quando os dois sistemas usam a mesma fila do Spooler, o Windows serializa os
  trabalhos: um cupom termina antes do próximo começar.
- Não crie duas filas diferentes apontando para a mesma porta `USB00x`. Use a
  fila já instalada pelo fabricante/Anota AI sempre que ela aparecer no Kôma.
- Se o Anota AI usa acesso USB/serial direto e não o Spooler, reserve outra
  impressora ou valide os dois simultaneamente; dois processos acessando a
  mesma porta diretamente podem disputar o dispositivo.

Checklist antes da operação:

1. Execute `INSTALAR-KOMA-WINDOWS.cmd` e autorize o computador no navegador.
2. Aguarde o diagnóstico final sem fechar a janela.
3. Abra **Salão e impressão** e confirme a fila USB pronta.
4. Imprima um teste do Anota AI e, logo em seguida, um teste do Kôma.
5. Confirme que saíram dois cupons completos, sem mistura ou duplicidade.
6. Reinicie o Windows e execute `VERIFICAR-KOMA-WINDOWS.cmd`.

Diagnóstico:

```bash
systemctl --user status koma-print-agent.service
journalctl --user -u koma-print-agent.service -f
lpstat -p -d
```

Antes de homologar a impressão do primeiro cliente, execute o preflight que
distingue uma fila antiga de uma impressora fisicamente presente:

```bash
python3 print-agent/hardware_preflight.py \
  --report /tmp/koma-hardware-preflight.json
```

Somente `status: PASSED` permite iniciar os testes em papel. O roteiro completo
e o critério de evidência estão em
`docs/operations/first-client-acceptance.md`.

Cada impressão concluída registra uma linha `[LATÊNCIA]` com quatro medidas:

- `fila`: tempo entre a criação do job no backend e sua reserva pelo agente;
- `reserva_api`: chamada ao Railway que busca e reserva o próximo job;
- `envio_cups`: entrega local do cupom ao CUPS/Spooler;
- `confirmacao_api`: confirmação posterior, que não atrasa a impressão física.

Para acompanhar somente essas medidas:

```bash
journalctl --user -u koma-print-agent.service -f | grep --line-buffered LATÊNCIA
```

## Execução manual

Útil apenas durante desenvolvimento:

```bash
python3 -m venv print-agent/.venv
print-agent/.venv/bin/pip install -r print-agent/requirements.txt
print-agent/.venv/bin/python print-agent/main.py
```

Na primeira execução, o navegador é aberto para pareamento. As seguintes usam a
credencial armazenada em `~/.config/koma-print-agent/credentials.json`.

## Configuração

| Argumento | Variável de ambiente | Padrão | Descrição |
|---|---|---:|---|
| `--api-url` | `KOMA_API_URL` | API de produção | URL do backend |
| `--agent-id` | `KOMA_AGENT_ID` | `agent-local` | Identificador local |
| `--adapter` | `KOMA_ADAPTER` | `auto` | `auto`, `linux`, `windows` ou `file` |
| `--output-dir` | `KOMA_OUTPUT_DIR` | `print_output` | Saída do simulador `file` |
| `--poll-sec` | `KOMA_POLL_SEC` | `0.5` | Espera somente quando a fila está vazia |
| `--hb-sec` | `KOMA_HB_SEC` | `5` | Intervalo do heartbeat e dos comandos do painel |
| `--batch-size` | `KOMA_CLAIM_BATCH_SIZE` | `10` | Trabalhos reservados por ida à nuvem |
| `--parallel-printers` | `KOMA_MAX_PARALLEL_PRINTERS` | `2` | Impressoras processadas em paralelo (máximo 4) |

O argumento `--token` existe para diagnóstico e automação técnica, mas não faz
parte do fluxo normal do cliente.

## Garantias do fluxo

- A conexão HTTP é reutilizada entre consultas.
- A busca e a reserva do próximo cupom ocorrem em uma chamada atômica.
- Enquanto houver fila, o próximo cupom é buscado sem pausa.
- Diagnóstico físico é reaproveitado no lote, sem repetir CUPS/PowerShell para cada cupom.
- Cada impressora preserva FIFO; destinos diferentes são submetidos em paralelo.
- O journal SQLite local impede uma segunda impressão após falha de conexão.
- Trabalhos impressos e ainda não confirmados são reconciliados com o backend.
- Falha real de CUPS/Spooler não é registrada como impressão concluída.
- O backend libera claims abandonados e limita cada trabalho a três tentativas.
- O botão **Conectar USB** reescaneia somente hardware físico, reativa a fila
  existente ou cria uma fila RAW quando há um único dispositivo compatível.
- Filas virtuais, PDF e computadores com o agente não aparecem como
  impressoras USB disponíveis.
- Uma busca sem resposta é encerrada automaticamente; quando não há hardware
  físico no USB, o painel recebe um erro em vez de manter carregamento infinito.
- O heartbeat anuncia a capacidade `connect_usb`, permitindo que o painel
  rejeite imediatamente versões antigas do agente.

Rotas usadas pelo agente:

| Método | Rota |
|---|---|
| `POST` | `/api/print-agents/jobs/claim-next` |
| `POST` | `/api/print-agents/jobs/{id}/complete` |
| `POST` | `/api/print-agents/jobs/{id}/fail` |
| `POST` | `/api/print-agents/heartbeat` |
| `POST` | `/api/print-agents/actions/{id}/complete` |

As rotas legadas `GET /jobs/next` e `POST /jobs/{id}/claim` permanecem
disponíveis durante a atualização de instalações antigas.
