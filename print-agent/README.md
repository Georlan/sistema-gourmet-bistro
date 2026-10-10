# Kôma Print Agent

Serviço local que recebe da fila do Kôma e envia cupons ESC/POS para a
impressora térmica. Ele funciona sem depender do navegador permanecer aberto.

## Distribuição pública do agente (sem publicar o KÔMA principal)

O código principal pode ser **privado**; apenas o pacote do agente de
impressão precisa estar disponível para download público. A distribuição será
feita por **GitHub Releases de um repositório público separado**, configurado
pelo responsável de infraestrutura. Este repositório de distribuição não
pode ser um fork ou cópia do repositório SaaS e não deve receber acesso ao
backend, frontend, histórico Git privado nem credenciais.

O workflow interno `Publish public Print Agent release` cria o pacote usando
um manifesto fechado de arquivos e publica **somente**:

- `KOMA-print-agent.zip` (instaladores e agente executável)
- `KOMA-print-agent.zip.sha256` (verificação de integridade)

A equipe deve configurar `KOMA_PRINT_AGENT_DISTRIBUTION_REPO` como `OWNER/REPO`
de um repositório público realmente criado, e
`KOMA_PRINT_AGENT_DISTRIBUTION_TOKEN` com permissão **Contents: write
somente no repositório público de distribuição**, preferencialmente no
environment `print-agent-public-release`. Nenhum token é enviado ao cliente.
Veja `docs/operations/private-repository-cutover.md`.

**O repositório público ainda precisa ser criado e a primeira release
publicada e validada antes de privar o projeto principal.** Até lá, o
workflow interno `Print agent` produz um ZIP que só pode ser baixado por
alguém com acesso ao repositório. Não confundir artefatos privados de Actions
com downloads públicos de Releases.

Depois da publicação, a equipe obterá os dois arquivos em
`https://github.com/OWNER/REPO/releases/latest/download/`, substituindo
OWNER/REPO pelo endereço público real e verificando o SHA-256 recebido.
Não usar o antigo `raw.githubusercontent.com/Georlan/sistema-gourmet-bistro`.

Os instaladores executam **apenas a partir do ZIP completo extraído**.
A atualização não apaga o pareamento. Nunca divulgar
`config.json`, `credentials.json`, ZIP de código completo do SaaS nem
credenciais ou tokens de GitHub.

## Instalação no Linux

O agente roda silenciosamente em segundo plano como serviço `systemd --user`.
USB, Bluetooth SPP/RFCOMM e impressoras de rede seguem suportados.

Extraia o ZIP e execute a partir da pasta que contém `print-agent/`:

```bash
bash print-agent/install-linux.sh
```

Para atualizar com um **novo ZIP** extraído:

```bash
bash print-agent/install-linux.sh --update
```

Para desinstalar preservando dados de pareamento:

```bash
bash print-agent/install-linux.sh --uninstall
```

O instalador cria um virtualenv dedicado em
`~/.local/share/koma-print-agent`, registra o serviço e preserva
credenciais/configuração durante atualizações. `--purge` apaga esses dados
locais e só deve ser usado quando isso for realmente solicitado.

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

O agente roda em segundo plano por tarefa agendada do Windows com
`pythonw.exe`, iniciada no logon do usuário. A atualização preserva
configuração e credenciais.

Extraia o ZIP oficial completo no computador e execute:

```text
INSTALAR-KOMA-WINDOWS.cmd
```

Para atualizar, obtenha o **ZIP da versão nova**, extraia todo o conteúdo
em pasta própria e execute `ATUALIZAR-KOMA-WINDOWS.cmd`.
Para desinstalar preservando o pareamento, execute
`DESINSTALAR-KOMA-WINDOWS.cmd`. Não faça `irm ... | iex` nem baixe
arquivos da branch `main` por URL pública.

Se Python 3.10+ não estiver disponível, o instalador tenta instalar Python
3.12 para o usuário via `winget`.

O cliente não precisa escolher CUPS, RFCOMM, Spooler ou URI. Essas informações
ficam restritas ao diagnóstico técnico; para operação, o KÔMA apresenta a
impressora pelo nome e estado, com USB/Bluetooth/Rede apenas como detalhe.

### Fonte canônica e projeções por impressora

O backend gera **um único documento canônico** para pedido, reimpressão, Conta
da Mesa e demais vias. O agente não mantém um formatter por modelo de
impressora. Em vez disso, cada `PrinterEndpoint` declara capabilities físicas
e de apresentação, e o mesmo documento é projetado para o equipamento:

- largura de papel e colunas seguras;
- layout normal ou compacto;
- suporte a corte e quantidade de feed;
- uso ou não de double-height;
- política de caracteres (`native_cp860` ou `ascii_safe`);
- projeção semântica (`standard` ou `compact_58`).

Assim, uma G250/80 mm preserva o documento rico já homologado, enquanto uma
térmica compacta pode economizar papel, remover redundâncias e usar labels mais
claros sem criar uma segunda implementação de negócio. Presets de modelos
conhecidos apenas fornecem defaults; endpoints futuros podem informar suas
capabilities sem alterar o renderer canônico.

Na Marmitaria, a projeção `compact_58` preserva a disposição já homologada da
KA-1445/KA7: Proteínas → Guarnições → Saladas → demais grupos, sem altura dupla
e sem os respiros adicionais usados na comanda de 80 mm. A G250/80 mm mantém a
hierarquia rica Guarnições → Proteínas → Saladas.

A partir da versão `2026.09.20.1`, o agente também instala a ponte local do
simulador térmico em `127.0.0.1:17654-17664`. Ela só é usada pela bancada
interna de engenharia e nunca envia bytes ao CUPS/USB durante a simulação.

Na versão `2026.09.20.2`, a bancada pode ativar **simulação automática em modo
sombra**. O agente observa PrintJobs novos pelo feed tenant-scoped e pelo mesmo
wake-up usado pela impressão real, converte o payload com o pipeline ESC/POS e
mede a latência. Esse modo não faz claim, não confirma o job e não escreve no
CUPS/USB; portanto não falsifica uma impressão física.

### Verificação no Windows

Guia de campo com instalação/atualização pelo ZIP do suporte, pareamento,
preflight, teste físico, reinício/logon e diagnóstico:
[`docs/operations/onboarding/windows-printing.md`](../docs/operations/onboarding/windows-printing.md).

Depois de instalar, execute no PowerShell:

```powershell
& "$env:LOCALAPPDATA\KomaPrintAgent\check-windows.ps1"
& "$env:LOCALAPPDATA\KomaPrintAgent\.venv\Scripts\python.exe" "$env:LOCALAPPDATA\KomaPrintAgent\hardware_preflight.py" --report "$env:TEMP\koma-hardware-preflight.json"
```

O diagnóstico mostra tarefa, fila memorizada e impressora padrão. O preflight
exige hardware presente; nenhum dos dois substitui a conferência do papel.

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

Diagnóstico Linux:

```bash
systemctl --user status koma-print-agent.service
journalctl --user -u koma-print-agent.service -f
lpstat -p -d
```

No Windows use o guia acima. No Linux/com o repositório, antes de homologar
a impressão do primeiro cliente, execute o preflight que
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
