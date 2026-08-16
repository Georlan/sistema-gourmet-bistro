# MAPA DE FLUXOS CRÍTICOS E PROTOCOLO DE REGRESSÃO (KÔMA SAAS)

> **AVISO DE PRODUÇÃO:** Este repositório atende operação real de PDV, salão, cardápio digital, caixa e impressão. Qualquer regressão que afete atendimento, faturamento, isolamento multi-tenant ou emissão física é incidente crítico.

---

## Fluxos críticos protegidos

### 1. Cardápio Digital Público (`/cardapio`)
- Configurações whitelabel devem pertencer ao restaurante correto.
- Categorias e produtos devem listar exclusivamente itens ativos do tenant requisitado.
- O pedido público deve chegar ao fluxo interno sem depender de autenticação de funcionário.

### 2. Segmentação do WebSocket (`/ws/cliente` vs `/ws/{garcom_id}`)
- O canal público nunca recebe eventos operacionais internos.
- O canal interno continua recebendo presença, comandas e sincronização da equipe.

### 3. Isolamento Multi-Tenant e RLS
- Tenant A nunca pode ler ou alterar recursos do Tenant B.
- Requisições legítimas do próprio restaurante continuam autorizadas.

### 4. Operação de PDV e Caixa
- Abrir turno, consultar resumo e fechar turno.
- Criar comandas e lançar itens.
- Registrar recebimentos pelos meios suportados sem duplicar faturamento.

### 5. Autenticação e autorização interna
- Login válido emite JWT com `restaurante_id` e `role` corretos.
- Credenciais inválidas e ações sem permissão são rejeitadas.

### 6. Impressão de mesa
- Layouts térmicos críticos continuam renderizando os campos financeiros esperados.
- O snapshot da mesa não pode perder nem duplicar itens ao combinar estado persistido e lançamento corrente.

### 7. Fila e agente de impressão
- Claim de job é atômico.
- Dois agentes não podem assumir o mesmo job.
- Reprocessamento e reconexão não podem causar impressão duplicada de jobs expirados ou já assumidos.

---

## Quality Gate automático

O workflow `.github/workflows/quality-gate.yml` executa em Pull Requests para `main`, pushes em `main`, pushes em `audit/**` e manualmente por `workflow_dispatch`.

Ele possui dois gates independentes:

1. **Frontend**
   ```bash
   npm ci
   npm run lint
   npm run build
   ```

2. **Backend crítico**
   ```bash
   python -m pip install -r backend/requirements-dev.txt
   bash scripts/regression_check.sh
   ```

As dependências exclusivas de teste ficam em `backend/requirements-dev.txt`; elas não são adicionadas à imagem de produção.

---

## Protocolo obrigatório antes de alterar arquitetura

1. Execute o gate crítico no estado anterior à mudança:
   ```bash
   bash scripts/regression_check.sh
   ```
2. Faça a alteração em branch de trabalho.
3. Execute novamente o gate local.
4. Abra PR e aguarde o **Koma Quality Gate**.
5. Se um teste que passava anteriormente falhar, a alteração não deve entrar na `main` até a regressão ser explicada e corrigida.

O script local aceita tanto `backend/venv/bin/python` quanto um `python3/python` do ambiente que tenha `pytest` instalado.

---

## Arquivos da suíte crítica

- `scripts/regression_check.sh`
- `backend/tests/test_critical_cardapio_flow.py`
- `backend/tests/test_websocket_segmentation.py`
- `backend/tests/test_critical_multitenant_rls.py`
- `backend/tests/test_critical_pdv_caixa_flow.py`
- `backend/tests/test_critical_auth_flow.py`
- `backend/tests/test_printer_service_layout.py`
- `backend/tests/test_table_print_snapshot.py`
- `backend/tests/test_print_agents.py`

---

## Baseline da auditoria dos 100 commits

A Etapa 0 foi iniciada a partir do commit `db80168ec599133a412299d54464b5ef8add591c` da `main`, na branch `audit/100-commits-hardening`.

Nenhuma regra de negócio deve ser refatorada nesta etapa. O objetivo é estabelecer uma linha de base reproduzível antes das Etapas 1–4.
