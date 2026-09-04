# KÔMA — Roadmap para o Primeiro Cliente Piloto Pago

**Objetivo:** Levar o KÔMA ao primeiro cliente real pagante em 7 dias com máxima confiabilidade operacional, segurança financeira e processos estruturados de suporte e implantação.

---

## 🧭 Visão Geral

```text
DIAS 1-2                    DIAS 3-4                    DIAS 5-6                    DIA 7
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│ Bloco 1: Hardening    │   │ Bloco 2: Smoke E2E    │   │ Bloco 3: Infra &      │   │ Bloco 4: Onboarding,  │
│ Técnico (5B.1)        │──►│ Operacional & Hardware│──►│ Backup/Observabilidade│──►│ Comercial & Suporte   │
│ • Mesa fechada        │   │ • Simulação completa  │   │ • Prova de Restore    │   │ • Kit de Implantação  │
│ • Concorrência cupom  │   │ • Teste impressora    │   │ • Runbook operacional │   │ • Treinamento (30min) │
│ • Merge & CI verde    │   │ • Cenários de caos    │   │ • Branch Protection   │   │ • Contrato / LGPD     │
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘   └───────────────────────┘
                                                                                                │
                                                                                                ▼
                                                                                    ┌───────────────────────┐
                                                                                    │ PILOTO PAGO NO AR 🚀  │
                                                                                    └───────────────────────┘
                                                                                                │
                                                                                                ▼
                                                                                    ┌───────────────────────┐
                                                                                    │ Pós-Piloto:           │
                                                                                    │ • Fase 5C (cleanup)   │
                                                                                    │ • Fase 6 (iFood/Apps) │
                                                                                    │ • Fase 7 (UI/Caixa)   │
                                                                                    └───────────────────────┘
```

---

## 📋 Lista Ordenada de Tarefas

### Bloco 1: Hardening Técnico & Fechamento de Riscos P1 (Dia 1) — CONCLUÍDO ✅
*Meta: Eliminar os riscos críticos identificados na `main` e consolidar o fluxo presencial.*

- [x] **Task 1.1 — Hotfix 5B.1: Resolução de Comanda Fechada no WaiterAdapter**
  - **Contexto:** Comanda de mesa já encerrada não deve ser reutilizada para novos lançamentos.
  - **Ação:** Garantir que o `WaiterAdapter` verifique o status da comanda ativa, abrindo uma nova se a comanda anterior estiver fechada.
  - **Critério:** Testes unitários e de caracterização cobrindo comanda aberta vs. fechada.

- [x] **Task 1.2 — Hotfix 5B.1: Recálculo Seguro de Cupom sob Concorrência**
  - **Contexto:** Evitar que pedidos concorrentes utilizem desconto de cupom após esgotamento de cota no lock.
  - **Ação:** Revalidar/recalcular regras e descontos de cupom dentro do lock transacional no `OrderApplicationService`.
  - **Critério:** Teste de concorrência com 1 uso restante garantindo zero descontos indevidos.

- [x] **Task 1.3 — Quality Gate & PR #130**
  - **Ação:** Executar `pytest`, typecheck, lint e build frontend. Abrir PR da branch `feature/fase-5b-1-hotfix` e mergear na `main`.
  - **Critério:** CI 100% verde no GitHub Actions.

---

### Bloco 2: Simulação de Restaurante Real & Hardware (Dias 2 e 3)
*Meta: Validar o ciclo operacional completo em condições reais de salão, balcão e cozinha.*

- [ ] **Task 2.1 — Criação do Tenant de Homologação Completo**
  - **Roteiro e evidência:** `docs/operations/first-client-acceptance.md` e `docs/operations/first-client-acceptance-report-template.md`.
  - **Ação:** Cadastrar ambiente completo:
    - 4 Usuários (1 Admin, 1 Caixa, 2 Garçons).
    - 10 Mesas, 5 Categorias, 20 Produtos com Fichas Técnicas (baixa de estoque) e adicionais.
    - Meios de pagamento (Dinheiro, PIX, Cartão Débito/Crédito), Taxa de serviço (10%) e Bairros de entrega.
  - **Critério:** Tenant pronto para rodar expediente completo.

- [ ] **Task 2.2 — Simulação Manual do Ciclo de Turno Completo**
  - **Ação:** Executar jornada ponta a ponta:
    1. Abertura do Caixa (fundo de troco).
    2. Pedido Cardápio Web (Retirada e Delivery).
    3. Pedido PDV/Balcão (venda rápida).
    4. Pedido Mesa Garçom 1 (Mesa 5 -> Pedido 5-A).
    5. Segundo pedido Garçom (Mesa 5 -> Pedido 5-B).
    6. Cancelamento/estorno parcial de item.
    7. KDS Cozinha (Pronto -> Entregue).
    8. Solicitação de Conta.
    9. Pagamento parcial / divisão no Caixa.
    10. Emissão de comprovante.
    11. Fechamento de mesa e Fechamento cego de Caixa.
  - **Critério:** Valores e estoque conferidos sem divergência.

- [ ] **Task 2.3 — Teste em Hardware de Impressão Real**
  - **Preflight obrigatório:** `python3 print-agent/hardware_preflight.py`; uma fila configurada sem equipamento presente mantém esta task bloqueada.
  - **Ação:** Testar `FastAPI -> PrintJob -> Print Agent -> Impressora Térmica (ESC/POS)`:
    - Impressão de cupom de cozinha e bar com adicionais e observações.
    - Impressão de conferência de conta.
    - Teste de resiliência: impressora desligada, falta de papel, reconexão e reimpressão.
  - **Critério:** Zero pedidos travados ou perdidos no spooler de impressão.

- [ ] **Task 2.4 — Chaos Testing Operacional**
  - **Ação:** Testar cenários hostis:
    - Queda de conexão / envio duplicado (idempotência).
    - Produto sem estoque tentando ser vendido.
    - Operação com caixa fechado.
    - Token JWT expirado durante a venda.
    - F5/Recarregar tela no meio de transações.
  - **Critério:** Mensagens claras para o operador sem corrupção de dados.

---

### Bloco 3: Infraestrutura, Backup & Confiabilidade (Dias 4 e 5)
*Meta: Ter garantias de restauração rápida e monitoramento proativo da saúde do sistema.*

- [ ] **Task 3.1 — Backup Automatizado e Teste Prático de Restore**
  - **Ação:**
    - Configurar backup diário automatizado do PostgreSQL (`pg_dump` retido por 15 dias).
    - **Executar restore real** em banco isolado validando integridade de dados.
  - **Critério:** Procedimento de restore testado e com RTO < 15 min documentado.

- [ ] **Task 3.2 — Runbook de Operação e Incidentes (2 a 3 páginas)**
  - **Ação:** Documentar passos claros para:
    - Rollback de deploy (Cloudflare Pages / Railway / servidor).
    - Restauração de emergência do banco.
    - Reinicialização e diagnóstico do Print Agent.
    - Tratamento de migrations com falha.
  - **Critério:** Guia objetivo pronto para consulta em caso de falha.

- [ ] **Task 3.3 — Observabilidade Mínima e Alertas**
  - **Ação:**
    - Log centralizado estruturado de erro 500 (`restaurant_id`, `route`, `request_id`, `timestamp`, `stack_trace`).
    - Alerta configurado (Sentry/BetterStack/Healthcheck) para backend offline ou taxa alta de erros.
  - **Critério:** Você é notificado antes do cliente em caso de instabilidade.

- [ ] **Task 3.4 — Proteção da Branch `main` no GitHub**
  - **Ação:** Habilitar regras de branch protection para `main`:
    - Bloquear commits diretos.
    - Exigir PR aprovada e Quality Gate (CI) verde.
  - **Critério:** Proteção ativa no repositório.

---

### Bloco 4: Onboarding, Treinamento & Comercial (Dias 6 e 7)
*Meta: Estrutura pronta para fechar, implantar e cobrar de forma profissional.*

- [ ] **Task 4.1 — Kit de Implantação e Formulário de Onboarding**
  - **Ação:** Criar checklist de implantação com dados cadastrais, cardápio, layout de mesas, perfis de usuários e impressoras.
  - **Critério:** Setup de novo restaurante realizado em até 1 hora.

- [ ] **Task 4.2 — Roteiro de Treinamento Rápido (30 min por perfil)**
  - **Ação:** Roteiro prático para Garçom (mesas/pedidos), Caixa (venda/fechamento) e Gestor (preços/estoque/relatórios).
  - **Critério:** Equipe do restaurante operando autonomamente no primeiro turno.

- [ ] **Task 4.3 — Pacote Comercial, Jurídico & Suporte Mínimo**
  - **Ação:**
    - Proposta Comercial & Termo de Adesão ao Piloto (valores acordados, cobrança manual via PIX/Boleto).
    - Termos de Uso e Política de Privacidade compatíveis com LGPD.
    - Canal de Suporte (WhatsApp dedicado) com horários e SLA de prioridade.
  - **Critério:** Documentação pronta e alinhada com o cliente.

---

## 🚀 Dia da Implantação & Pós-Piloto

```text
IMPLANTAÇÃO PILOTO (Acompanhamento presencial no 1º turno)
                           │
                           ▼
              OPERAÇÃO ESTÁVEL & RECEITA
                           │
                           ▼
RETOMADA DO ROADMAP DE ENGENHARIA:
• Fase 5C: Limpeza final de writers legados (Comanda/Lancamento/Item)
• Fase 6: Marketplaces (iFood, 99Food, Keeta) com Outbox Pattern
• Fase 7: Unificação visual de Mesa e modularização de CaixaPanel/App
```
