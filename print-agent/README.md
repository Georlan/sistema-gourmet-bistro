# Agente de Impressão Local — Kôma Bistrô

Daemon Python que roda no computador do restaurante e imprime tickets
diretamente na impressora térmica USB, sem depender de drivers de rede.

---

## Pré-requisitos

| Sistema | Requisito |
|---|---|
| Windows | Python 3.10+, impressora instalada no Spooler |
| Linux   | Python 3.10+ (modo simulação; sem driver necessário) |

---

## Instalação

```bash
# Entre no diretório do agente
cd print-agent

# Crie e ative o ambiente virtual
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate

# Instale as dependências
pip install -r requirements.txt
```

---

## Uso

```bash
# Forma básica (Linux — modo simulação)
python agent.py --api-url http://localhost:8000 --token MEU_TOKEN

# Windows com impressora explícita
python agent.py \
  --api-url https://api.seurestaurante.com \
  --token   MEU_TOKEN \
  --printer "EPSON TM-T20III"

# Via variáveis de ambiente (ideal para produção)
KOMA_API_URL=https://api.seurestaurante.com \
KOMA_TOKEN=MEU_TOKEN \
KOMA_PRINTER="EPSON TM-T20III" \
python agent.py
```

### Parâmetros

| Argumento   | Env Var        | Padrão              | Descrição |
|---|---|---|---|
| `--api-url` | `KOMA_API_URL` | `http://localhost:8000` | URL base do backend |
| `--token`   | `KOMA_TOKEN`   | —                   | Bearer token (obrigatório) |
| `--printer` | `KOMA_PRINTER` | impressora padrão do SO | Nome exato no Spooler |
| `--poll-sec`| `KOMA_POLL_SEC`| `2`                 | Intervalo de polling (seg) |
| `--hb-sec`  | `KOMA_HB_SEC`  | `30`                | Intervalo de heartbeat (seg) |

---

## Fluxo de funcionamento

```
┌─────────────────────────────────────────────┐
│              Loop principal                  │
│                                              │
│  A cada 2s  ─►  GET /api/print-agents/jobs/next
│                      │                       │
│                 job encontrado?               │
│                 ├── NÃO ──► aguarda 2s       │
│                 └── SIM ──► processa job     │
│                      │                       │
│             imprimir_raw(printer, bytes)     │
│                 ├── Windows: win32print RAW  │
│                 └── Linux:   log simulado    │
│                      │                       │
│         POST /api/print-agents/jobs/{id}/status
│           {"status": "printed" | "failed"}  │
│                                              │
│  A cada 30s ─►  POST /api/print-agents/heartbeat
└─────────────────────────────────────────────┘
```

---

## Rotas da API consumidas

| Método | Rota | Descrição |
|---|---|---|
| `GET`  | `/api/print-agents/jobs/next` | Próximo job pendente (204 se vazio) |
| `POST` | `/api/print-agents/jobs/{id}/status` | Confirma impressão |
| `POST` | `/api/print-agents/heartbeat` | Mantém agente ativo |

### Formato esperado do job (`GET .../jobs/next`)

```json
{
  "id": "uuid-do-job",
  "printer_name": "EPSON TM-T20III",
  "raw_data": "<base64 dos bytes ESC/POS>"
}
```

### Payload de confirmação (`POST .../jobs/{id}/status`)

```json
{
  "status": "printed",
  "error": "",
  "printed_at": "2026-07-23T20:00:00+00:00"
}
```

---

## Executar como serviço (Windows)

```bat
:: Instale como serviço com NSSM (https://nssm.cc)
nssm install KomaPrintAgent "C:\Python311\python.exe" "C:\koma\print-agent\agent.py"
nssm set KomaPrintAgent AppEnvironmentExtra KOMA_API_URL=https://api.seurestaurante.com
nssm set KomaPrintAgent AppEnvironmentExtra KOMA_TOKEN=SEU_TOKEN
nssm set KomaPrintAgent AppEnvironmentExtra KOMA_PRINTER="EPSON TM-T20III"
nssm start KomaPrintAgent
```

## Executar como serviço (Linux — systemd)

```ini
# /etc/systemd/system/koma-print-agent.service
[Unit]
Description=Kôma Print Agent
After=network.target

[Service]
User=koma
WorkingDirectory=/opt/koma/print-agent
Environment=KOMA_API_URL=https://api.seurestaurante.com
Environment=KOMA_TOKEN=SEU_TOKEN
ExecStart=/opt/koma/print-agent/.venv/bin/python agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now koma-print-agent
```
