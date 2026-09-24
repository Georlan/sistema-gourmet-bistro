import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('receipt uses the persisted charge for discounts, delivery, partial payments and reopened orders', () => {
  const items = [{ id: '1', produtoId: '1', nome: 'Pedido', preco: 100, quantidade: 1, observacao: '', clienteNome: '', status: 'pronto' as const }];
  for (const [total, paid, balance] of [[90, 90, 0], [115, 40, 75], [90, 30, 60]]) {
    const receipt = buildWhatsAppOrderReceipt(
      { itens: items, total, valorPago: paid }, null,
      { taxaServicoAtiva: true, serviceTaxRate: 10 },
    );
    assert.match(receipt, new RegExp(`\\*Total: R\\$\\s*${total},00\\*`));
    assert.match(receipt, new RegExp(`Saldo a pagar: R\\$\\s*${balance},00`));
    assert.match(receipt, /Subtotal: R\$\s*100,00/);
  }
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


test('all plans share the mobile shell while Pocket keeps its plan-specific refinements', () => {
  const caixaPanel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
  const cashierCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(caixaPanel, /data-koma-plan=\{currentPlanId\}/);
  assert.match(caixaPanel, /<CashierMobileBottomBar/);
  assert.match(caixaPanel, /label: hasPrinting \? 'Preparo e impressão' : 'Preparo'/);
  assert.match(cashierCss, /\.cashier-shell \.cashier-content/);
  assert.match(cashierCss, /padding-bottom: calc\(6\.5rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(cashierCss, /\.cashier-shell\[data-koma-plan="pocket"\] \.cashier-salon-grid/);
});


test('mobile operation subnav avoids duplicating actions already pinned to the bottom bar', () => {
  const caixaPanel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');

  assert.match(caixaPanel, /isPrimaryMobileBottomAction = \['vendas_novo_pedido', 'vendas_cozinha'\]\.includes\(sub\.id\)/);
  assert.match(caixaPanel, /isPrimaryMobileBottomAction && 'hidden lg:inline-flex'/);
});


test('mobile menu avoids duplicated owner shortcuts and keeps the compact touch-first shell', () => {
  const mobileSidebar = readFileSync(new URL('../src/components/caixa/navigation/CashierMobileSidebar.tsx', import.meta.url), 'utf8');
  const cashierCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.doesNotMatch(mobileSidebar, /cashier-mobile-quick-actions|mobileQuickActions/);
  assert.match(mobileSidebar, /CashierSidebarSearch/);
  assert.match(mobileSidebar, /CashierSidebarNavigation/);
  assert.match(cashierCss, /\.cashier-sidebar--mobile/);
  assert.match(cashierCss, /\.cashier-sidebar__footer--mobile/);
});

test('mobile orders prioritize actionable controls above the fold', () => {
  const cashierCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(cashierCss, /\.orders-workspace > \.operational-header \.orders-hero__copy > p:last-child/);
  assert.match(cashierCss, /\.orders-search__input \{[\s\S]*min-height: 2\.75rem/);
  assert.match(cashierCss, /\.orders-new-orders \{[\s\S]*min-height: 2\.75rem/);
});


test('mobile catalog prioritizes create preview and bulk actions', () => {
  const products = readFileSync(new URL('../src/components/cardapio/CardapioProdutosTab.tsx', import.meta.url), 'utf8');
  const cashierCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(products, /cardapio-products-actions/);
  assert.match(products, /cardapio-products-create/);
  assert.match(products, /cardapio-products-preview/);
  assert.match(cashierCss, /\.cardapio-products-create/);
  assert.match(cashierCss, /grid-column: 1 \/ -1/);
});

test('online menu mobile exposes the edit publish customer-preview loop', () => {
  const editor = readFileSync(new URL('../src/components/cardapio/CardapioDigitalSettingsPanel.tsx', import.meta.url), 'utf8');
  const onlineShell = readFileSync(new URL('../src/components/caixa/online-menu/CashierOnlineMenu.tsx', import.meta.url), 'utf8');
  const cashierCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(onlineShell, /Editar → Publicar → Conferir/);
  assert.match(onlineShell, /Link e QR Code/);
  assert.match(onlineShell, /3\. Conferir/);
  assert.match(editor, /Ver como cliente/);
  assert.match(editor, /online-menu-editor__publish/);
  assert.match(editor, /Salvar e publicar/);
  assert.match(cashierCss, /\.online-menu-editor__publish/);
  assert.match(cashierCss, /position: sticky/);
});


test('mobile information architecture avoids duplicated deep navigation', () => {
  const mobileSidebar = readFileSync(new URL('../src/components/caixa/navigation/CashierMobileSidebar.tsx', import.meta.url), 'utf8');
  const sidebarNavigation = readFileSync(new URL('../src/components/caixa/navigation/CashierSidebarNavigation.tsx', import.meta.url), 'utf8');
  const caixaPanel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');

  assert.match(mobileSidebar, /expandActiveChildren=\{false\}/);
  assert.match(sidebarNavigation, /expandActiveChildren = true/);
  assert.match(caixaPanel, /activeTab === 'cardapio_digital' && onlineMenuSubnavItems\.map/);
  assert.match(caixaPanel, /if \(sub\.requiredFeature\) return subscriptionHasFeature\(currentPlanId, sub\.requiredFeature, planEntitlements\)/);
  assert.match(caixaPanel, /'Cardápio online'/);
});

test('product editor keeps context and primary actions reachable on phones', () => {
  const catalog = readFileSync(new URL('../src/components/caixa/catalog/CashierCatalog.tsx', import.meta.url), 'utf8');

  assert.match(catalog, /h-\[100dvh\]/);
  assert.match(catalog, /sticky top-0/);
  assert.match(catalog, /safe-area-inset-bottom/);
  assert.match(catalog, /text-base sm:text-xs/);
});
