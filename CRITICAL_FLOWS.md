# MAPA DE FLUXOS CRÍTICOS E PROTOCOLO DE REGRESSÃO (KÔMA SAAS)

> **AVISO DE PRODUÇÃO:** Este repositório atende a um restaurante real operando diariamente com PDV e Cardápio Digital. Qualquer regressão que afete o atendimento ao cliente ou a operação de caixa é considerada incidente crítico P0.

---

## 📋 Mapeamento dos Fluxos Críticos Negociais

### 1. Cardápio Digital Público (`/cardapio`)
- **Carregamento de Configurações Whitelabel:** A rota `GET /api/cardapio-digital/config` deve retornar dinamicamente os dados do restaurante (`nome`, `subtitulo`, `logo_url`, `banner_url`, `endereco`, `google_maps_url`, `socials`).
- **Listagem de Categorias e Produtos:** As rotas públicas `GET /api/cardapio-digital/categorias` e `GET /api/cardapio-digital/produtos` devem listar exclusivamente os itens ativos do restaurante requisitado.
- **Montagem do Carrinho e Lançamento de Pedidos:** Abertura e envio de comandas de mesa/delivery sem exigir autenticação interna de funcionário.

### 2. Segmentação e Segurança do WebSocket (`/ws/cliente` vs `/ws/{garcom_id}`)
- **Privacidade do Cliente:** O WebSocket público do Cardápio Digital (`/ws/cliente`) **NUNCA** deve receber eventos operacionais internos (presença de garçons `waiter_connected`/`waiter_disconnected`, alteração de rascunho `draft_status`, atualização de mesas).
- **Operação da Equipe:** O WebSocket interno (`/ws/{garcom_id}`) deve continuar recebendo todos os eventos de presença, comandas e sincronização da equipe de atendimento.

### 3. Isolamento Multi-Tenant e Políticas RLS (PostgreSQL / Supabase)
- **Isolamento Estrito por Tenant:** As consultas de um `restaurante_id` (Tenant A) jamais podem vazar dados ou produtos de outro `restaurante_id` (Tenant B).
- **Integridade de Acesso:** Nenhuma tabela multitenant deve ficar acidentalmente exposta sem permissão ou indevidamente bloqueada (erros `401`/`42501`) para requisições legítimas.

### 4. Operação de PDV e Caixa (`/view-caixa`)
- **Ciclo de Turno do Caixa:** Abertura de turno (`POST /caixa/turno/abrir`), verificação de turno ativo (`GET /caixa/turno/atual`) e fechamento de turno (`POST /caixa/turno/fechar`).
- **Lançamento de Comandas:** Criação e adição de itens em comandas de mesa/balcão.
- **Processamento de Pagamentos:** Registro de pagamentos via Pix, Cartão de Crédito/Débito ou Dinheiro (`POST /caixa/pagamentos`).

### 5. Autenticação e Controle de Acesso Interno (`/auth/login`)
- **Login de Funcionários:** O endpoint `POST /auth/login` deve autenticar usuários ativos (admin, caixa, garçom) e emitir tokens JWT válidos contendo `restaurante_id` e `role`.
- **Rejeição de Credenciais Inválidas:** Senhas incorretas ou usuários inativos devem ser rejeitados com código HTTP `401 Unauthorized`.

---

## 🛠️ Protocolo Obrigatório de Deploy em Produção

Antes de aplicar qualquer alteração ou merge no branch principal (`main`) para produção, siga estritamente o protocolo abaixo:

1. **Pré-Alteração:** Execute a suíte crítica de regressão antes de iniciar as modificações:
   ```bash
   ./scripts/regression_check.sh
   ```
   *Certifique-se de que todos os fluxos retornem `[PASS]`.*

2. **Desenvolvimento:** Realize a alteração do código ou adição da funcionalidade.

3. **Pós-Alteração:** Execute novamente a suíte crítica de regressão:
   ```bash
   ./scripts/regression_check.sh
   ```

4. **Regra de Ouro (Bloqueio de Deploy):**
   > ⚠️ **SE QUALQUER TESTE QUE PASSAVA ANTES PASSAR A FALHAR, A ALTERAÇÃO NÃO PODE IR PARA PRODUÇÃO EM HIPÓTESE ALGUMA.** O problema deve ser corrigido até que 100% dos testes da suíte crítica passem.

---

## 🧪 Estrutura de Arquivos da Suíte de Regressão

- `scripts/regression_check.sh` — Script executor da verificação de regressão (tempo de execução < 1 minuto).
- `backend/tests/test_critical_cardapio_flow.py` — Testes E2E do Cardápio Digital Público.
- `backend/tests/test_websocket_segmentation.py` — Testes de segmentação de audiência do WebSocket.
- `backend/tests/test_critical_multitenant_rls.py` — Testes de isolamento estrito de dados multi-tenant.
- `backend/tests/test_critical_pdv_caixa_flow.py` — Testes E2E do fluxo de Caixa e PDV.
- `backend/tests/test_critical_auth_flow.py` — Testes de autenticação e tokens JWT.
