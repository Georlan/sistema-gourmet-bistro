import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

type PendingItem = {
  id: string;
  comanda_id: string;
  order_number: number;
  amount: string;
  created_at: string;
  created_at_local: string;
  provider: 'pagbank' | 'mercado_pago' | 'direct_pix';
  provider_label: string;
  status: string;
  comanda_open: boolean;
  turno_id: number;
  shift_scope: 'current_shift' | 'previous_shift';
  situation: 'awaiting_payment' | 'creation_failed' | 'uncertain' | 'provider_query_failed' | 'approved' | 'closed_after_review';
  situation_label: string;
  blocks_disconnect: boolean;
  reason_title: string;
  reason_detail: string;
  evidence_code: string;
  evidence_summary: string;
  provider_code: string | null;
  provider_request_id: string | null;
  http_status: number | null;
  has_external_id: boolean;
  external_payment_id_ref: string | null;
  reconciliation_attempted_at: string | null;
  expires_at: string | null;
  can_reconcile: boolean;
  can_close_creation_failure: boolean;
  can_direct_pix_confirm: boolean;
  can_direct_pix_cancel: boolean;
  requires_manual_escalation: boolean;
  escalation_guidance: string | null;
  allowed_actions: string[];
  recommended_action: string;
  review_history: Array<{
    id: number;
    action: string;
    reason: string;
    actor_user_id: string;
    actor_name: string;
    created_at: string;
    created_at_local: string;
    status_before: string;
    status_after: string;
    evidence_code: string | null;
  }>;
};

function buildSummary(items: PendingItem[], activeReceiver: 'pagbank' | 'direct_pix' | null) {
  const sum = (list: PendingItem[]) =>
    list.reduce((acc, item) => acc + Number(item.amount), 0).toFixed(2);
  const current = items.filter(item => item.shift_scope === 'current_shift');
  const prev = items.filter(item => item.shift_scope === 'previous_shift');
  const pagbankBlocking = items.filter(item => item.provider === 'pagbank').length;
  return {
    blocking_count: items.length,
    blocking_total_amount: sum(items),
    current_shift_id: 43,
    current_shift_blocking_count: current.length,
    current_shift_blocking_total_amount: sum(current),
    previous_shift_blocking_count: prev.length,
    previous_shift_blocking_total_amount: sum(prev),
    by_situation: {
      awaiting_payment: items.filter(item => item.situation === 'awaiting_payment').length,
      creation_failed: items.filter(item => item.situation === 'creation_failed').length,
      uncertain: items.filter(item => item.situation === 'uncertain').length,
      provider_query_failed: items.filter(item => item.situation === 'provider_query_failed').length,
    },
    by_provider: {
      pagbank: pagbankBlocking,
      mercado_pago: 0,
      direct_pix: 0,
    },
    can_disconnect_pagbank: pagbankBlocking === 0,
    can_disconnect_mercado_pago: true,
    can_switch_receiver: items.length === 0,
    active_receiver: activeReceiver,
  };
}

for (const theme of ['dark', 'light'] as const) {
  test(`central de pendências resolve bloqueio de desconexão e libera Pix próprio (${theme})`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('@koma:theme', selectedTheme);
    }, theme);

    let pagbankConnected = true;
    let directPixEnabled = false;
    let activeItems: PendingItem[] = [
      {
        id: 'intent-116',
        comanda_id: 'cmd-116',
        order_number: 116,
        amount: '4.50',
        created_at: '2026-11-22T13:30:00Z',
        created_at_local: '2026-11-22T10:30:00-03:00',
        provider: 'pagbank',
        provider_label: 'PagBank',
        status: 'error',
        comanda_open: true,
        turno_id: 43,
        shift_scope: 'current_shift',
        situation: 'creation_failed',
        situation_label: 'Falha na criação da cobrança',
        blocks_disconnect: true,
        reason_title: 'Dados da tentativa recusados antes de gerar o Pix',
        reason_detail: 'PagBank recusou a criação da cobrança (HTTP 400, código 40002). Nenhum QR Code ou identificador externo foi emitido.',
        evidence_code: 'pagbank_http_400_creation_refused',
        evidence_summary: 'PagBank recusou a criação com HTTP 400 (código 40002); sem QR Code, webhook ou pagamento.',
        provider_code: '40002',
        provider_request_id: 'req-116-uuid',
        http_status: 400,
        has_external_id: false,
        external_payment_id_ref: null,
        reconciliation_attempted_at: null,
        expires_at: null,
        can_reconcile: false,
        can_close_creation_failure: true,
        can_direct_pix_confirm: false,
        can_direct_pix_cancel: false,
        requires_manual_escalation: false,
        escalation_guidance: null,
        allowed_actions: ['close_creation_failure'],
        recommended_action: 'close_creation_failure',
        review_history: [],
      },
      {
        id: 'intent-120',
        comanda_id: 'cmd-120',
        order_number: 120,
        amount: '6.00',
        created_at: '2026-11-22T13:35:00Z',
        created_at_local: '2026-11-22T10:35:00-03:00',
        provider: 'pagbank',
        provider_label: 'PagBank',
        status: 'error',
        comanda_open: true,
        turno_id: 42,
        shift_scope: 'previous_shift',
        situation: 'uncertain',
        situation_label: 'Pagamento em situação incerta',
        blocks_disconnect: true,
        reason_title: 'Resultado financeiro ainda indeterminado',
        reason_detail: 'O provedor ficou indisponível durante a criação e não há prova segura de inexistência de cobrança.',
        evidence_code: 'uncertain_provider_outcome',
        evidence_summary: 'Instabilidade de rede impediu confirmar a criação.',
        provider_code: null,
        provider_request_id: null,
        http_status: 503,
        has_external_id: false,
        external_payment_id_ref: null,
        reconciliation_attempted_at: null,
        expires_at: null,
        can_reconcile: false,
        can_close_creation_failure: false,
        can_direct_pix_confirm: false,
        can_direct_pix_cancel: false,
        requires_manual_escalation: true,
        escalation_guidance: 'Confira diretamente no painel PagBank antes de baixar manualmente.',
        allowed_actions: ['escalate_manual_review'],
        recommended_action: 'escalate_manual_review',
        review_history: [],
      },
      {
        id: 'intent-121',
        comanda_id: 'cmd-121',
        order_number: 121,
        amount: '8.00',
        created_at: '2026-11-22T13:40:00Z',
        created_at_local: '2026-11-22T10:40:00-03:00',
        provider: 'pagbank',
        provider_label: 'PagBank',
        status: 'pending',
        comanda_open: true,
        turno_id: 43,
        shift_scope: 'current_shift',
        situation: 'awaiting_payment',
        situation_label: 'Aguardando pagamento',
        blocks_disconnect: true,
        reason_title: 'Aguardando pagamento do comprador',
        reason_detail: 'Cobrança emitida no PagBank aguardando confirmação ou expiração.',
        evidence_code: 'external_charge_awaiting_confirmation',
        evidence_summary: 'Cobrança ativa no PagBank.',
        provider_code: null,
        provider_request_id: null,
        http_status: null,
        has_external_id: true,
        external_payment_id_ref: 'ORDE_121',
        reconciliation_attempted_at: null,
        expires_at: '2026-11-22T14:10:00Z',
        can_reconcile: true,
        can_close_creation_failure: false,
        can_direct_pix_confirm: false,
        can_direct_pix_cancel: false,
        requires_manual_escalation: false,
        escalation_guidance: null,
        allowed_actions: ['reconcile'],
        recommended_action: 'reconcile',
        review_history: [],
      },
    ];
    let historyItems: PendingItem[] = [];

    await page.route('**/payments/mercado-pago/status', route =>
      route.fulfill({
        json: {
          connected: false,
          status: 'disconnected',
          receiver_provider: pagbankConnected ? 'pagbank' : (directPixEnabled ? 'direct_pix' : null),
          connection_blocked: pagbankConnected || directPixEnabled,
        },
      }),
    );

    await page.route('**/payments/pagbank/status', route =>
      route.fulfill({
        json: {
          provider: 'pagbank',
          configured: true,
          connected: pagbankConnected,
          environment: 'production',
          status: pagbankConnected ? 'active' : 'disconnected',
          receiver_provider: pagbankConnected ? 'pagbank' : (directPixEnabled ? 'direct_pix' : null),
          connection_blocked: directPixEnabled,
        },
      }),
    );

    await page.route('**/payments/direct-pix/settings', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            available: true,
            enabled: directPixEnabled,
            key_type: 'email',
            pix_key: 'loja@example.test',
            holder_name: 'LOJA EXEMPLO',
            city: 'FORTALEZA',
          },
        });
        return;
      }
      if (activeItems.length > 0) {
        await route.fulfill({
          status: 409,
          json: {
            detail: {
              code: 'RECEIVER_SWITCH_BLOCKED',
              message: 'Resolva os Pix pendentes ou incertos antes de trocar a conta de recebimento.',
              blocking_count: activeItems.length,
              blocking_total_amount: buildSummary(activeItems, 'pagbank').blocking_total_amount,
              blocking_items: activeItems.map(i => ({
                id: i.id,
                comanda_id: i.comanda_id,
                order_number: i.order_number,
                amount: i.amount,
                provider: i.provider,
                provider_label: i.provider_label,
                situation: i.situation,
                situation_label: i.situation_label,
                reason_title: i.reason_title,
                can_close_creation_failure: i.can_close_creation_failure,
                can_reconcile: i.can_reconcile,
                requires_manual_escalation: i.requires_manual_escalation,
              })),
            },
          },
        });
        return;
      }
      directPixEnabled = true;
      await route.fulfill({
        json: {
          available: true,
          enabled: true,
          key_type: 'email',
          pix_key: 'loja@example.test',
          holder_name: 'LOJA EXEMPLO',
          city: 'FORTALEZA',
        },
      });
    });

    await page.route('**/payments/pending-review*', route => {
      const receiver = pagbankConnected ? 'pagbank' : (directPixEnabled ? 'direct_pix' : null);
      return route.fulfill({
        json: {
          summary: buildSummary(activeItems, receiver),
          items: activeItems,
          history_items: historyItems,
        },
      });
    });

    await page.route('**/payments/pending-review/intent-116/close-creation-failure', async route => {
      const body = route.request().postDataJSON() as { reason: string; confirmed_no_charge: boolean };
      expect(body.confirmed_no_charge).toBe(true);
      expect(body.reason.length).toBeGreaterThanOrEqual(5);
      const closed = activeItems.find(item => item.id === 'intent-116')!;
      activeItems = activeItems.filter(item => item.id !== 'intent-116');
      historyItems = [
        {
          ...closed,
          status: 'cancelled',
          situation: 'closed_after_review',
          situation_label: 'Operação encerrada após revisão',
          blocks_disconnect: false,
          can_close_creation_failure: false,
          review_history: [
            {
              id: 1,
              action: 'online_payment_creation_failure_closed',
              reason: body.reason,
              actor_user_id: 'caixa-e2e',
              actor_name: 'Caixa E2E',
              created_at: '2026-11-22T14:00:00Z',
              created_at_local: '2026-11-22T11:00:00-03:00',
              status_before: 'error',
              status_after: 'cancelled',
              evidence_code: 'pagbank_http_400_creation_refused',
            },
          ],
        },
        ...historyItems,
      ];
      await route.fulfill({ json: { status: 'cancelled', already_closed: false, intent_id: 'intent-116' } });
    });

    await page.route('**/payments/pending-review/intent-121/reconcile', async route => {
      const resolved = activeItems.find(item => item.id === 'intent-121')!;
      activeItems = activeItems.filter(item => item.id !== 'intent-121');
      historyItems = [
        {
          ...resolved,
          status: 'approved',
          situation: 'approved',
          situation_label: 'Pagamento aprovado',
          blocks_disconnect: false,
          can_reconcile: false,
        },
        ...historyItems,
      ];
      await route.fulfill({ json: { status: 'approved', queried: true, approved: true, item: historyItems[0] } });
    });

    await page.route('**/payments/pagbank/disconnect', async route => {
      if (activeItems.length > 0) {
        await route.fulfill({
          status: 409,
          json: {
            detail: {
              code: 'PAYMENT_DISCONNECT_BLOCKED',
              message: 'Resolva os Pix pendentes antes de desconectar.',
              blocking_count: activeItems.length,
              blocking_total_amount: buildSummary(activeItems, 'pagbank').blocking_total_amount,
              blocking_items: activeItems.map(i => ({
                id: i.id,
                comanda_id: i.comanda_id,
                order_number: i.order_number,
                amount: i.amount,
                provider: i.provider,
                provider_label: i.provider_label,
                situation: i.situation,
                situation_label: i.situation_label,
                reason_title: i.reason_title,
                can_close_creation_failure: i.can_close_creation_failure,
                can_reconcile: i.can_reconcile,
                requires_manual_escalation: i.requires_manual_escalation,
              })),
            },
          },
        });
        return;
      }
      pagbankConnected = false;
      await route.fulfill({ json: { status: 'disconnected' } });
    });

    await page.goto('/?view=caixa&pagbank=cancelled');
    const pagbankCard = page.getByRole('region', { name: 'PagBank', exact: true });
    await expect(pagbankCard.getByText('Conectado', { exact: true })).toBeVisible();
    await expect(page.getByText('PagBank — confirmação automática')).toBeVisible();

    // Try disconnecting while 3 items block it -> structured 409 + exact blocking order references
    await pagbankCard.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(pagbankCard.getByRole('status')).toContainText('Resolva os Pix pendentes');
    await expect(pagbankCard.getByText(/Pedido #116/)).toBeVisible();
    await expect(pagbankCard.getByText('3 pendências bloqueiam a operação')).toBeVisible();

    // Open Central de pendências from the card blocker
    await pagbankCard.getByRole('button', { name: 'Revisar pendências', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Central de pendências financeiras' });
    await expect(dialog).toBeVisible();

    // Distinct situations shown per order and total in review separated
    const item116 = dialog.getByTestId('pending-review-item-116');
    const item120 = dialog.getByTestId('pending-review-item-120');
    const item121 = dialog.getByTestId('pending-review-item-121');
    await expect(item116.getByText('Falha na criação da cobrança', { exact: true })).toBeVisible();
    await expect(item120.getByText('Pagamento em situação incerta', { exact: true })).toBeVisible();
    await expect(item121.getByText('Aguardando pagamento', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/não somam nas vendas recebidas/)).toBeVisible();

    // Uncertain item (#120) must show manual escalation guidance and NEVER offer blind closure
    await expect(item120.getByText('Conferência manual obrigatória no banco')).toBeVisible();
    await expect(item120.getByRole('button', { name: 'Encerrar falha de criação' })).toHaveCount(0);

    // Close proven creation-failure item (#116) via audited workflow
    await item116.getByRole('button', { name: 'Encerrar falha de criação' }).click();
    await item116.getByRole('checkbox').check();
    await item116.getByRole('button', { name: 'Confirmar encerramento' }).click();
    await expect(dialog.getByText(/Pedido #116 encerrado com auditoria/)).toBeVisible();

    // Reconcile genuinely pending item (#121) -> approved by bank
    await item121.getByRole('button', { name: 'Consultar no banco' }).click();
    await expect(dialog.getByText(/Pedido #121 confirmado pelo banco/)).toBeVisible();

    // Check audited history tab shows #116 closure
    await dialog.getByRole('tab', { name: /Histórico revisado/ }).click();
    await expect(dialog.getByTestId('pending-review-item-116')).toBeVisible();

    // Simulate #120 resolved externally so remaining blocker clears, reload queue, close modal
    activeItems = [];
    await dialog.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect(dialog.getByText('Liberada')).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar central de pendências financeiras' }).click();

    // Disconnect PagBank and activate Pix com chave própria
    await pagbankCard.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(pagbankCard.getByText('Não conectado', { exact: true })).toBeVisible();

    const directPixSection = page.getByRole('region', { name: 'Pix com chave própria' });
    await directPixSection.getByRole('checkbox').check();
    await directPixSection.getByRole('button', { name: 'Ativar Pix próprio' }).click();
    await expect(directPixSection.getByRole('status')).toContainText('Pix próprio ativo');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test(`fechamento distingue contas operacionais abertas de pendências de Pix do turno e anteriores (${theme})`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('@koma:theme', selectedTheme);
      sessionStorage.setItem('koma_active_tab', 'financeiro');
      sessionStorage.setItem('koma_active_subtab', 'fechamento');
    }, theme);

    await page.route('**/caixa/turno-atual/resumo', route =>
      route.fulfill({
        json: {
          turno_id: 43,
          status: 'aberto',
          operador_id: 'caixa-e2e',
          operador_nome: 'Caixa E2E',
          aberto_em: '2026-11-22T12:00:00Z',
          tempo_aberto_minutos: 45,
          turno_esquecido: false,
          saldo_inicial: 100,
          total_vendas: 71.9,
          total_dinheiro: 0,
          total_pix: 71.9,
          total_cartao: 0,
          total_sangrias: 0,
          total_suprimentos: 0,
          saldo_esperado_dinheiro: 100,
          total_pedidos_pagos: 2,
          comandas_abertas_count: 1,
          pendencias_financeiras_count: 2,
          pendencias_financeiras_turno_atual_count: 1,
          pendencias_financeiras_anteriores_count: 1,
          pendencias_financeiras_total: 10.5,
          pendencias_financeiras_turno_atual_total: 4.5,
          atividades_recentes: [],
          ultima_movimentacao: null,
          resumo_dia: { total_vendas: 71.9, pedidos_pagos: 2 },
        },
      }),
    );

    await page.route('**/payments/pending-review*', route =>
      route.fulfill({
        json: {
          summary: {
            blocking_count: 2,
            blocking_total_amount: '10.50',
            current_shift_id: 43,
            current_shift_blocking_count: 1,
            current_shift_blocking_total_amount: '4.50',
            previous_shift_blocking_count: 1,
            previous_shift_blocking_total_amount: '6.00',
            by_situation: { awaiting_payment: 0, creation_failed: 2, uncertain: 0, provider_query_failed: 0 },
            by_provider: { pagbank: 2, mercado_pago: 0, direct_pix: 0 },
            can_disconnect_pagbank: false,
            can_disconnect_mercado_pago: true,
            can_switch_receiver: false,
            active_receiver: 'pagbank',
          },
          items: [
            {
              id: 'intent-102',
              comanda_id: 'cmd-102',
              order_number: 102,
              amount: '4.50',
              created_at: '2026-11-22T13:00:00Z',
              created_at_local: '2026-11-22T10:00:00-03:00',
              provider: 'pagbank',
              provider_label: 'PagBank',
              status: 'error',
              comanda_open: true,
              turno_id: 43,
              shift_scope: 'current_shift',
              situation: 'creation_failed',
              situation_label: 'Falha na criação da cobrança',
              blocks_disconnect: true,
              reason_title: 'PagBank recusou permissão para criar a cobrança',
              reason_detail: 'PagBank respondeu HTTP 403 antes de gerar cobrança.',
              evidence_code: 'pagbank_http_403_creation_refused',
              evidence_summary: 'HTTP 403 sem QR Code nem pagamento.',
              provider_code: null,
              provider_request_id: null,
              http_status: 403,
              has_external_id: false,
              external_payment_id_ref: null,
              reconciliation_attempted_at: null,
              expires_at: null,
              can_reconcile: false,
              can_close_creation_failure: true,
              can_direct_pix_confirm: false,
              can_direct_pix_cancel: false,
              requires_manual_escalation: false,
              escalation_guidance: null,
              allowed_actions: ['close_creation_failure'],
              recommended_action: 'close_creation_failure',
              review_history: [],
            },
          ],
          history_items: [],
        },
      }),
    );

    await page.goto('/?view=caixa');
    await expect(page.getByText('Contas ainda abertas')).toBeVisible();
    await expect(page.getByText('Pendências de Pix do turno')).toBeVisible();
    await expect(page.getByText('Pendências de turnos anteriores')).toBeVisible();
    await expect(page.getByText(/não contabilizado como recebido/)).toBeVisible();

    await page.getByRole('button', { name: 'Ver em Integrações' }).first().click();
    await expect(page.getByRole('heading', { name: 'Pagamentos online' })).toBeVisible();
    // A revisão acontece exclusivamente em Integrações, não em um modal do Caixa.
    await expect(page.getByRole('dialog', { name: 'Central de pendências financeiras' })).toHaveCount(0);
    await page.getByRole('button', { name: /Central de pendências/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Central de pendências financeiras' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('pending-review-item-102')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`Vendas mantém apenas conferência de Pix manual (${theme})`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('@koma:theme', selectedTheme);
      sessionStorage.setItem('koma_active_tab', 'operacao');
      sessionStorage.setItem('koma_active_subtab', 'pedidos');
    }, theme);
    await page.route('**/caixa/turno-atual/resumo', route => route.fulfill({
      json: {
        turno_id: 43, status: 'aberto', operador_id: 'caixa-e2e', operador_nome: 'Caixa E2E',
        aberto_em: '2026-11-22T12:00:00Z', tempo_aberto_minutos: 45, turno_esquecido: false,
        saldo_inicial: 100, total_vendas: 0, total_dinheiro: 0, total_pix: 0, total_cartao: 0,
        total_sangrias: 0, total_suprimentos: 0, saldo_esperado_dinheiro: 100,
        total_pedidos_pagos: 0, comandas_abertas_count: 0,
        pendencias_financeiras_count: 2, pendencias_financeiras_turno_atual_count: 2,
        pendencias_financeiras_anteriores_count: 0, pendencias_financeiras_total: 10.5,
        pendencias_financeiras_turno_atual_total: 10.5,
        atividades_recentes: [], ultima_movimentacao: null,
        resumo_dia: { total_vendas: 0, pedidos_pagos: 0 },
      },
    }));
    await page.route('**/payments/direct-pix/pending', route => route.fulfill({
      json: [{
        id: 'manual-pix-47', order_number: '47', customer: 'Cliente teste',
        amount: '10.00', status: 'aguardando_aprovacao_pix',
      }],
    }));

    await page.goto('/?view=caixa');
    const conferir = page.getByRole('button', { name: /Conferir Pix/ });
    await expect(conferir).toBeVisible();
    await expect(page.getByRole('button', { name: /Revisar Pix/ })).toHaveCount(0);
    await conferir.click();
    const dialog = page.getByRole('dialog', { name: /Pix manual/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Conferir pedido #47/)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Central de pendências financeiras' })).toHaveCount(0);
  });
}
