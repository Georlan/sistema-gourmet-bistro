#!/usr/bin/env bash
set -e

# Colors for clear terminal reporting
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}${BOLD}========================================================================${NC}"
echo -e "${BLUE}${BOLD}      VERIFICAÇÃO DE REGRESSÃO DE FLUXOS CRÍTICOS - KÔMA SAAS           ${NC}"
echo -e "${BLUE}${BOLD}========================================================================${NC}"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
PYTHON_VENV="${BACKEND_DIR}/venv/bin/pytest"

if [ ! -f "$PYTHON_VENV" ]; then
  echo -e "${RED}Erro: Ambiente virtual python não encontrado em ${BACKEND_DIR}/venv${NC}"
  exit 1
fi

FAIL_COUNT=0

run_flow_test() {
  local flow_name="$1"
  local test_file="$2"

  echo -n "• ${flow_name} ... "
  if cd "${BACKEND_DIR}" && "${PYTHON_VENV}" "${test_file}" -q --tb=short > /tmp/pytest_flow_output.log 2>&1; then
    echo -e "${GREEN}${BOLD}[PASS]${NC}"
  else
    echo -e "${RED}${BOLD}[FAIL]${NC}"
    echo -e "${RED}Log de falha no fluxo '${flow_name}':${NC}"
    cat /tmp/pytest_flow_output.log
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# Run tests per critical flow module mapped in CRITICAL_FLOWS.md
run_flow_test "1. Cardápio Digital Público (Config, Categorias, Produtos, Pedido)" "tests/test_critical_cardapio_flow.py"
run_flow_test "2. Segmentação de Audiência do WebSocket (Público vs Interno)" "tests/test_websocket_segmentation.py"
run_flow_test "3. Isolamento Multi-Tenant & RLS (Garantia por restaurante_id)" "tests/test_critical_multitenant_rls.py"
run_flow_test "4. Operação de PDV e Caixa (Abertura, Resumo, Fechamento)" "tests/test_critical_pdv_caixa_flow.py"
run_flow_test "5. Autenticação e Autorização Interna (Login JWT & Permissões)" "tests/test_critical_auth_flow.py"

echo ""
echo -e "${BLUE}${BOLD}========================================================================${NC}"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD} SUCCESS: TODOS OS 5 FLUXOS CRÍTICOS PASSARAM SEM REGRESSÃO!${NC}"
  echo -e "${GREEN} O sistema está seguro para deploy em produção.${NC}"
  echo -e "${BLUE}${BOLD}========================================================================${NC}"
  exit 0
else
  echo -e "${RED}${BOLD} FALHA: ${FAIL_COUNT} FLUXO(S) CRÍTICO(S) APRESENTARAM REGRESSÃO!${NC}"
  echo -e "${RED} BLOQUEIO DE DEPLOY: A alteração NÃO pode ir para produção.${NC}"
  echo -e "${BLUE}${BOLD}========================================================================${NC}"
  exit 1
fi
