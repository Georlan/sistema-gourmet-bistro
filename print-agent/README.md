# Kôma Print Agent

Serviço local que recebe da fila do Kôma e envia cupons ESC/POS para a
impressora térmica. Ele funciona sem depender do navegador permanecer aberto.

## Instalação no Linux

Pré-requisitos: Python 3.10+, CUPS e a impressora instalada no sistema.

```bash
bash print-agent/install-linux.sh
```

O instalador:

1. abre o Kôma para autorizar este computador;
2. guarda a credencial localmente, sem exigir cópia de token;
3. instala e inicia `koma-print-agent.service` na sessão do usuário;
4. configura reinício automático.

Para atualizar uma instalação após baixar uma versão nova do repositório,
execute o instalador novamente. A credencial já pareada é reutilizada.

```bash
git pull --ff-only origin main
bash print-agent/install-linux.sh
```

Diagnóstico:

```bash
systemctl --user status koma-print-agent.service
journalctl --user -u koma-print-agent.service -f
lpstat -p -d
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
| `--hb-sec` | `KOMA_HB_SEC` | `30` | Intervalo do heartbeat |

O argumento `--token` existe para diagnóstico e automação técnica, mas não faz
parte do fluxo normal do cliente.

## Garantias do fluxo

- A conexão HTTP é reutilizada entre consultas.
- Enquanto houver fila, o próximo cupom é buscado sem pausa.
- O journal SQLite local impede uma segunda impressão após falha de conexão.
- Trabalhos impressos e ainda não confirmados são reconciliados com o backend.
- Falha real de CUPS/Spooler não é registrada como impressão concluída.
- O backend libera claims abandonados e limita cada trabalho a três tentativas.

Rotas usadas pelo agente:

| Método | Rota |
|---|---|
| `GET` | `/api/print-agents/jobs/next` |
| `POST` | `/api/print-agents/jobs/{id}/claim` |
| `POST` | `/api/print-agents/jobs/{id}/complete` |
| `POST` | `/api/print-agents/jobs/{id}/fail` |
| `POST` | `/api/print-agents/heartbeat` |

## Windows

O adaptador RAW para o Spooler já existe e usa a impressora padrão ou a fila
configurada. Ainda falta empacotar o instalador do Windows e o serviço de
inicialização automática antes da distribuição comercial.
