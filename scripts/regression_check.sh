#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
VENV_PYTHON="${BACKEND_DIR}/venv/bin/python"

if [ -x "$VENV_PYTHON" ]; then
  PYTHON_BIN="$VENV_PYTHON"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
else
  echo -e "${RED}Erro: Python não encontrado. Instale as dependências de backend antes de rodar a regressão.${NC}"
  exit 1
fi

if ! "$PYTHON_BIN" -c "import pytest" >/dev/null 2>&1; then
  echo -e "${RED}Erro: pytest não está instalado para ${PYTHON_BIN}.${NC}"
  echo "Instale com: pip install -r backend/requirements-dev.txt"
  exit 1
fi

if [ -n "${KOMA_REGRESSION_LOG:-}" ]; then
  LOG_FILE="$KOMA_REGRESSION_LOG"
  : >"$LOG_FILE"
else
  LOG_FILE="$(mktemp -t koma-regression-XXXXXX.log)"
  trap 'rm -f "$LOG_FILE"' EXIT
fi

FAIL_COUNT=0
PASS_COUNT=0

run_flow_test() {
  local flow_name="$1"
  shift

  echo -n "• ${flow_name} ... "
  local flow_log
  flow_log="$(mktemp -t koma-flow-XXXXXX.log)"
  if (
    cd "${BACKEND_DIR}"
    "$PYTHON_BIN" -m pytest "$@" -q --tb=short >"$flow_log" 2>&1
  ); then
    echo -e "${GREEN}${BOLD}[PASS]${NC}"
    {
      echo "===== PASS: ${flow_name} ====="
      cat "$flow_log"
      echo
    } >>"$LOG_FILE"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "${RED}${BOLD}[FAIL]${NC}"
    echo -e "${RED}Log de falha no fluxo '${flow_name}':${NC}"
    cat "$flow_log"
    {
      echo "===== FAIL: ${flow_name} ====="
      cat "$flow_log"
      echo
    } >>"$LOG_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  rm -f "$flow_log"
}

echo -e "${BLUE}${BOLD}========================================================================${NC}"
echo -e "${BLUE}${BOLD}      VERIFICAÇÃO DE REGRESSÃO DE FLUXOS CRÍTICOS - KÔMA SAAS           ${NC}"
echo -e "${BLUE}${BOLD}========================================================================${NC}"
echo ""

run_flow_test \
  "1. Cardápio Digital Público (Config, Categorias, Produtos, Pedido)" \
  "tests/test_critical_cardapio_flow.py"

run_flow_test \
  "2. Segmentação de Audiência do WebSocket (Público vs Interno)" \
  "tests/test_websocket_segmentation.py"

run_flow_test \
  "3. Isolamento Multi-Tenant & RLS (Garantia por restaurante_id)" \
  "tests/test_critical_multitenant_rls.py"

run_flow_test \
  "4. Operação de PDV e Caixa (Abertura, Resumo, Fechamento)" \
  "tests/test_critical_pdv_caixa_flow.py"

run_flow_test \
  "5. Autenticação e Autorização Interna (Login JWT, tenant e matriz RBAC)" \
  "tests/test_critical_auth_flow.py" \
  "tests/test_auth_tenant_session_hardening.py" \
  "tests/test_authorization.py"

run_flow_test \
  "6. Arquitetura, layout e snapshot da impressão" \
  "tests/test_printer_service_layout.py" \
  "tests/test_table_print_snapshot.py" \
  "tests/test_printing_architecture.py"

run_flow_test \
  "7. Fila de impressão (claim atômico, anti-duplicação e recuperação)" \
  "tests/test_print_agents.py"

run_flow_test \
  "8. Identidade operacional da mesa (famílias, bordas, HTTP, caixa, numeração e movimentos)" \
  "tests/test_atendimento_identity.py" \
  "tests/test_atendimento_edge_cases.py" \
  "tests/test_atendimento_http_flow.py" \
  "tests/test_atendimento_caixa_merge.py" \
  "tests/test_order_numbering_unified.py"

run_flow_test \
  "9. Hardening multi-tenant e RBAC (sessão, escrita, JWT, público e impressão)" \
  "tests/test_stage2_multitenant_rbac.py"

run_flow_test \
  "10. Consistência financeira (precisão, ledger, estornos e dia operacional)" \
  "tests/test_money_types.py" \
  "tests/test_financial_ledger_stage3.py"

echo ""
echo -e "${BLUE}${BOLD}========================================================================${NC}"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD} SUCCESS: ${PASS_COUNT} FLUXOS CRÍTICOS PASSARAM SEM REGRESSÃO.${NC}"
  echo -e "${GREEN} O gate crítico de backend está aprovado.${NC}"
  echo -e "${BLUE}${BOLD}========================================================================${NC}"
  exit 0
fi

echo -e "${RED}${BOLD} FALHA: ${FAIL_COUNT} FLUXO(S) CRÍTICO(S) APRESENTARAM REGRESSÃO.${NC}"
echo -e "${RED} BLOQUEIO DE DEPLOY: a alteração não deve ir para produção até o gate voltar a 100%.${NC}"
echo -e "${BLUE}${BOLD}========================================================================${NC}"
exit 1
