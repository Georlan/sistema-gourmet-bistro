# Status por modalidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mostrar estado e próximo passo corretos para retirada, entrega e consumo local em todas as superfícies do pedido, preservando a política de mensagens existente.

**Architecture:** O contrato canônico do backend e o fallback frontend apresentam rótulos compatíveis por modalidade. Descrições e marcos usam a mesma semântica, sem alterar estados nem pagamento. WhatsApp existente permanece limitado aos eventos e consentimentos atuais.

**Tech Stack:** FastAPI, React, TypeScript, pytest, node:test.

**Spec:** docs/superpowers/specs/2026-11-02-status-modalidade-design.md

## Global Constraints

Sem novas notificações, infraestrutura, dados financeiros, envios reais ou escrita em tenants. Main atual; manter #1244. Não presumir preparo, entrega ou pagamento.

## Review Focus

- Retirada pronta versus entrega pronta e despachada: testes de contrato e frontend por modalidade.
- Consumo local nunca orienta retirar: teste específico.
- Concluído não altera saldo financeiro: contrato preserva dimensões e testes existentes.
- Pix pendente e agendamento têm precedência: testes backend existentes e frontend.
- Contratos legados e dados persistidos: fallback e telas com resumos antigos, testes de frontend.

### Task 1: Contrato e apresentação

**Files:** `backend/app/services/order_state_contract.py`, `src/cardapio/orderTracking.ts`, testes de contrato e apresentação.

- [ ] Criar testes que provem textos distintos de pronto/concluído para as três modalidades e preservem estados financeiros.
- [ ] Executar testes, verificar falhas e implementar a menor alteração.
- [ ] Testar fallback, progressão, contratos e estados atuais.

### Task 2: Avisos e revisão

**Files:** testes de política WhatsApp, push e chat existentes; apresentação de telas quando necessário.

- [ ] Verificar que retirada pronta e entrega despachada são selecionadas pela política atual sem duplicar mensagens.
- [ ] Executar testes focados, lint/build, revisão do diff e CI em PR; comparar main antes de merge.
