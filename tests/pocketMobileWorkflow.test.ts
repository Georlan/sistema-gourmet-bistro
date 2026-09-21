import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildWhatsAppOrderReceipt, buildWhatsAppShiftReceipt } from '../src/components/caixa/digital-receipt/digitalReceipt';
import { CashierMobileBottomBar } from '../src/components/caixa/navigation/CashierMobileBottomBar';
import { CheckoutDialog, type CheckoutDialogProps } from '../src/components/caixa/checkout/CheckoutDialog';

test('buildWhatsAppOrderReceipt formats a clean digital bill with restaurant info, items and total', () => {
  const receipt = buildWhatsAppOrderReceipt(
    {
      mesaId: 4,
      numeroPedido: 12,
      itens: [
        { id: '1', nome: 'Hambúrguer Gourmet', preco: 35.0, quantidade: 2 } as any,
        { id: '2', nome: 'Refrigerante Lata', preco: 7.0, quantidade: 1 } as any,
      ],
      valorPago: 84.7,
    },
    {
      nome: 'Bistrô Pocket Kôma',
      chave_pix: 'contato@komafood.com.br',
    },
    {
      taxaServicoAtiva: true,
      serviceTaxRate: 10,
    }
  );

  assert.match(receipt, /\*Bistrô Pocket Kôma\*/);
  assert.match(receipt, /Conta — Mesa 04/);
  assert.match(receipt, /2× Hambúrguer Gourmet/);
  assert.match(receipt, /1× Refrigerante Lata/);
  assert.match(receipt, /Subtotal: R\$\s*77,00/);
  assert.match(receipt, /Taxa de serviço \(10%\): R\$\s*7,70/);
  assert.match(receipt, /\*Total: R\$\s*84,70\*/);
  assert.match(receipt, /Valor já pago: R\$\s*84,70/);
  assert.match(receipt, /contato@komafood\.com\.br/);
  assert.match(receipt, /Agradecemos a preferência!/);
});

test('buildWhatsAppShiftReceipt formats shift summary for manager review without physical printing', () => {
  const receipt = buildWhatsAppShiftReceipt(
    {
      turno_id: 101,
      operador_nome: 'Carlos',
      status: 'fechado',
      aberto_em: '2026-09-21T12:00:00Z',
      saldo_inicial: 100.0,
      total_vendas: 1540.5,
      total_pix: 850.0,
      total_cartao: 490.5,
      total_dinheiro: 200.0,
      total_sangrias: 50.0,
      total_suprimentos: 0.0,
      saldo_esperado_dinheiro: 250.0,
      tempo_aberto_minutos: 600,
      total_pedidos_pagos: 42,
    } as any,
    'Bistrô Pocket Kôma'
  );

  assert.match(receipt, /Fechamento de Caixa — Bistrô Pocket Kôma/);
  assert.match(receipt, /Turno: #101 · Operador: Carlos/);
  assert.match(receipt, /Total de Vendas: R\$\s*1\.540,50/);
  assert.match(receipt, /Pix: R\$\s*850,00/);
  assert.match(receipt, /Cartão: R\$\s*490,50/);
  assert.match(receipt, /Dinheiro: R\$\s*200,00/);
  assert.match(receipt, /Saldo Inicial: R\$\s*100,00/);
  assert.match(receipt, /Sangrias \(-\): R\$\s*50,00/);
  assert.match(receipt, /Dinheiro Esperado em Gaveta: R\$\s*250,00/);
});

test('CheckoutDialog hides physical print button and shows WhatsApp share button when hasPrinting is false', () => {
  const dummyController = {
    isProcessingPayment: false,
    selectedOrder: { id: 'order-1', mesaId: 5, total: 50, criadoEm: '2026-09-21T12:00:00Z', itens: [] },
    setSelectedOrder: () => {},
    showCheckoutModal: true,
    setShowCheckoutModal: () => {},
    identifiedCustomer: null,
    checkoutServiceTax: 10,
    setCheckoutServiceTax: () => {},
    splitPeople: 1,
    setSplitPeople: () => {},
    paymentMetodo: 'dinheiro',
    setPaymentMetodo: () => {},
    paymentValor: '50.00',
    setPaymentValor: () => {},
    selectedItemIds: [],
    setSelectedItemIds: () => {},
    paymentCPF: '',
    setPaymentCPF: () => {},
    handleProcessPayment: async () => {},
    isItemReadyForCheckout: () => true,
    getCheckoutTotals: () => ({ subtotal: 50, taxa: 5, total: 55, pago: 0, aPagar: 55 }),
    getCheckoutBalance: () => 55,
    getSelectedItemsTotal: () => 50,
    handleConfirmPendingCashPayment: async () => {},
    handleRejectPendingCashPayment: async () => {},
    printCheckoutReceipt: () => {},
    printCheckoutValues: () => {},
    shareCheckoutBill: () => {},
    handleOpenTablePayment: () => {},
    handleFinalizeDigitalOrder: async () => true,
    handleReceiveSalonTable: () => {},
  };

  const dummySmartPos = {
    getSmartPosCardState: () => null,
    smartPosRecoveryError: '',
    isReconcilingSmartPos: false,
    handleReconcileSmartPosPayment: async () => {},
    setSmartPosRecoveryError: () => {},
    refreshSmartPosCashProjection: () => {},
  };

  const propsPocket: CheckoutDialogProps = {
    controller: dummyController as any,
    smartPos: dummySmartPos as any,
    errorMsg: '',
    taxaServicoAtiva: true,
    serviceTaxRate: 10,
    hasPrinting: false,
    restaurantInfo: { nome: 'Restaurante Pocket' } as any,
  };

  const pocketMarkup = renderToStaticMarkup(createElement(CheckoutDialog, propsPocket));
  assert.doesNotMatch(pocketMarkup, /Imprimir Comprovante Físico/);
  assert.match(pocketMarkup, /Compartilhar Conta \(WhatsApp\)/);

  const propsStandard: CheckoutDialogProps = {
    ...propsPocket,
    hasPrinting: true,
  };

  const standardMarkup = renderToStaticMarkup(createElement(CheckoutDialog, propsStandard));
  assert.match(standardMarkup, /Reimpressão total/);
  assert.match(standardMarkup, /Imprimir Conta/);
});

test('CashierMobileBottomBar renders 5 standard tabs with operational status', () => {
  const calls: string[] = [];
  let menuOpened = false;

  const view = createElement(CashierMobileBottomBar, {
    activeTab: 'operacao',
    activeSubTab: 'pedidos',
    onNavigate: (tab, subTab) => calls.push(`${tab}/${subTab}`),
    onOpenMenu: () => { menuOpened = true; },
    orderCount: 3,
    kitchenCount: 2,
    shiftOpen: true,
  });

  const markup = renderToStaticMarkup(view);
  assert.match(markup, /Pedidos/);
  assert.match(markup, /\+ Pedido/);
  assert.match(markup, /Cozinha/);
  assert.match(markup, /Caixa/);
  assert.match(markup, /Mais/);
  assert.match(markup, />3<\/span>/); // Badge de pedidos
  assert.match(markup, />2<\/span>/); // Badge de cozinha
});
