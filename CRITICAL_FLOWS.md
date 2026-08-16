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

### 6. Arquitetura de impressão de mesa
- Layouts térmicos críticos continuam renderizando os campos esperados.
- Impressão automática representa apenas o lançamento novo.
- Extrato/fechamento continuam representando a mesa/Conta completa sem duplicar itens.

### 7. Fila e agente de impressão
- Claim de job é atômico.
- Dois agentes não podem assumir o mesmo job.
- Reprocessamento e reconexão não podem causar impressão duplicada de jobs expirados ou já assumidos.

### 8. Identidade operacional da mesa
- Mesa continua sendo localização física e Atendimento/Conta continua sendo identidade financeira/histórica.
- Transferências e mesclagens não renumeram pedidos existentes.
- Famílias, sequências e movimentos permanecem consistentes após transferências, mesclagens e pagamentos.

### 9. Hardening multi-tenant e RBAC
- `TenantSession`, ContextVar, filtros ORM, `before_flush` e PostgreSQL RLS precisam concordar sobre o tenant.
- Escritas cross-tenant falham fechado.
- O papel persistido do usuário prevalece sobre claim adulterado de JWT.
- Rotas públicas resolvem tenant sem furar RLS e rotas de impressão respeitam permissões.

### 10. Consistência financeira
- Faturamento nasce de `Pagamento.status == "aprovado"`, não de item lançado ou comanda fechada.
- Pagamento parcial entra no faturamento na proporção efetivamente aprovada.
- Um pagamento distribuído por várias comandas continua sendo um único recebimento, com alocações auditáveis.
- Venda bruta, estorno e venda líquida permanecem grandezas separadas.
- Estorno não apaga nem reescreve o pagamento original e nunca pode ultrapassar seu saldo estornável.
- Sangria e suprimento movimentam caixa físico sem alterar faturamento.
- O dia operacional é atribuído pelo turno de caixa, podendo atravessar a meia-noite civil.
- Relatórios e Dashboard selecionam primeiro os turnos pertencentes ao período operacional e só então seus pagamentos/estornos.
- Atendimento/Conta é o grão preferencial de leitura financeira; delivery, balcão e legado sem Atendimento usam fallback explícito por comanda.
- Uma Conta paga em mais de um turno continua sendo uma única Conta no período consolidado.
- Um pagamento dividido entre duas famílias financeiras não duplica receita: a soma das alocações precisa reconciliar com o pagamento.
- Ledger parcialmente conhecido conserva parcelas válidas e deixa o residual sem atribuição; ledger sobrealocado falha de forma segura para o valor exato do pagamento.
- Métricas de produto representam consumo operacional e nunca são usadas como fonte de faturamento reconhecido.
- Valores monetários persistidos usam precisão decimal fixa; inputs monetários usam centavos automáticos no padrão brasileiro.
- Caixa, Relatórios, Dashboard e Fechamento devem convergir para os mesmos totais financeiros no mesmo recorte operacional.

#### Invariantes de estorno e caixa — Etapa 3C
- `PagamentoEstorno.metodo` preserva o meio ORIGINAL do recebimento para análise de receita; `PagamentoEstornoLiquidacao.metodo_devolucao` registra por onde a devolução realmente saiu no turno atual.
- Venda em cartão devolvida em dinheiro reduz receita de cartão nos relatórios e reduz espécie no caixa atual, sem reclassificar a venda original.
- Venda em um turno pode ser estornada em outro turno: a venda continua no dia original e a saída pertence ao turno/dia da devolução.
- Dinheiro físico esperado nunca pode ficar negativo por estorno. Se não houver espécie suficiente, a devolução em dinheiro falha antes de criar evento financeiro.
- Pix/cartão líquidos podem ficar negativos quando um turno processa devoluções de vendas antigas; o fechamento precisa aceitar e reconciliar esse cenário.
- Estorno parcial de pagamento com múltiplas Contas exige origem explícita. Estorno integral do saldo remanescente pode distribuir exatamente os resíduos conhecidos sem inferência.
- Um estorno parcial nunca reabre Conta/Comanda, altera itens ou reduz retroativamente `Pagamento.valor`; ele acrescenta um evento imutável ao ledger.
- `PagamentoEstornoAlocacao` preserva a origem por Conta/comanda de cada parcela devolvida.
- Estornos legados sem origem materializada só podem ser absorvidos automaticamente quando existe uma única origem possível. Em pagamento multi-Conta, a operação falha fechada para revisão financeira.
- O saldo estornável exibido e o saldo validado no POST usam a mesma leitura protegida; a UI não pode oferecer valor que o ledger histórico já consumiu.
- A mesma `idempotency_key` com o mesmo conteúdo retorna o mesmo estorno, inclusive após um estorno integral deixar saldo restante igual a zero. Reutilização com conteúdo diferente falha com conflito.
- Estornos concorrentes do mesmo pagamento são serializados pelo lock do pagamento. Estorno e fechamento concorrentes são serializados pelo lock do turno.
- O feed de atividade registra estorno como saída pelo meio efetivo da devolução.
- Resumo do turno, sangria, fechamento e comprovante impresso consomem a mesma fonte reconciliada de totais; não existe fórmula financeira separada para impressão.
- Identidades técnicas permanecem internas; ao escolher origem de estorno o operador vê `Conta #N`, Mesa/Pedido/Retirada/Delivery quando aplicável.

---

## Simulações financeiras obrigatórias da Etapa 3

O fluxo financeiro crítico deve cobrir, além dos casos normais:

- pagamento após 00:00 pertencendo ao turno aberto no dia anterior;
- pagamento parcial e aprovação posterior de pagamento pendente;
- uma Conta com múltiplas comandas sem multiplicar a quantidade de vendas;
- um único pagamento alocado entre múltiplas Contas/famílias sem duplicar receita;
- a mesma Conta recebendo parcelas em dois dias operacionais diferentes;
- estorno em turno posterior afetando o dia da devolução, sem reescrever o dia da venda original;
- relatório e Dashboard reconciliando bruto, estornos, líquido e meios de pagamento;
- produto de R$ 100 com apenas R$ 20 pagos permanecendo R$ 100 de consumo operacional e apenas R$ 20 de receita reconhecida;
- ledger historicamente corrompido/sobrealocado nunca fazendo a soma dos detalhes ultrapassar o Pagamento aprovado;
- venda em cartão devolvida em dinheiro, distinguindo meio original e meio efetivo da saída;
- devolução Pix/cartão de venda antiga produzindo líquido digital negativo no turno atual sem gerar diferença falsa no fechamento;
- tentativa de devolução em dinheiro maior que a espécie disponível;
- pagamento multi-Conta com estorno parcial sem origem, com origem explícita e com estorno integral do residual;
- estorno legado sem origem em pagamento multi-Conta falhando fechado, sem inventar distribuição retroativa;
- histórico já estornado acima do pagamento bloqueando novas operações;
- três estornos de R$ 0,01 fechando exatamente R$ 0,03 sem resíduo binário;
- devolução exatamente do último centavo físico disponível seguida de tentativa de mais R$ 0,01;
- meio de devolução inválido falhando antes de qualquer mutação;
- mesma chave idempotente reaplicada ao mesmo evento e reaplicada com outro conteúdo/pagamento;
- retry de rede após estorno integral retornando o evento já persistido mesmo com saldo estornável restante igual a zero;
- estorno não reabrindo Conta/Comanda nem alterando o estado operacional do consumo;
- feed do caixa exibindo o meio efetivo da devolução;
- fechamento e estorno concorrentes não produzindo saída em turno já encerrado.

### Achado transversal monitorado

A fidelidade é creditada no fluxo de pagamento concluído. A política de reversão de pontos após estorno precisa ser tratada como regra própria porque pontos ganhos podem já ter sido utilizados em outra compra. O ledger financeiro não apaga nem altera pontos por suposição; essa decisão não pode ser embutida silenciosamente no estorno de caixa.

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

O backend é dividido em **10 fluxos críticos**. Uma falha em qualquer grupo bloqueia a mudança.

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
- `backend/tests/test_auth_tenant_session_hardening.py`
- `backend/tests/test_authorization.py`
- `backend/tests/test_printer_service_layout.py`
- `backend/tests/test_table_print_snapshot.py`
- `backend/tests/test_printing_architecture.py`
- `backend/tests/test_print_agents.py`
- `backend/tests/test_atendimento_identity.py`
- `backend/tests/test_atendimento_edge_cases.py`
- `backend/tests/test_atendimento_http_flow.py`
- `backend/tests/test_atendimento_caixa_merge.py`
- `backend/tests/test_order_numbering_unified.py`
- `backend/tests/test_stage2_multitenant_rbac.py`
- `backend/tests/test_money_types.py`
- `backend/tests/test_financial_ledger_stage3.py`
- `backend/tests/test_financial_allocation_stage3.py`
- `backend/tests/test_financial_read_stage3b.py`
- `backend/tests/test_product_read_stage3b.py`
- `backend/tests/test_financial_read_adversarial_stage3b.py`
- `backend/tests/test_financial_cash_stage3c.py`
- `backend/tests/test_financial_refund_history_stage3c.py`
- `backend/tests/test_financial_cash_extreme_stage3c.py`
- `backend/tests/test_financial_refund_retry_stage3c.py`

---

## Baseline e evolução

A Etapa 0 foi iniciada a partir do commit `db80168ec599133a412299d54464b5ef8add591c` da `main`, na branch `audit/100-commits-hardening`.

Desde então o gate foi ampliado para proteger a arquitetura de impressão, identidade operacional, hardening multi-tenant/RBAC e, na Etapa 3, consistência financeira. Mudanças estruturais só devem chegar à `main` com os dez grupos verdes.
