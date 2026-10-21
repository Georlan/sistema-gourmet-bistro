import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const ARTIFACT_DIR = '/home/testuser/.gemini/antigravity/brain/d3c82d13-1434-4f58-af84-4bcbc114ecc6';

test.describe('CRM Visual Evidence Capture', () => {
  test('Capture all 5 CRM tabs and Drawer in desktop and mobile', async ({ page }, testInfo) => {
    // Only capture once on desktop-1440 and once on mobile-390
    const isDesktop = testInfo.project.name === 'desktop-1440';
    const isMobile = testInfo.project.name === 'mobile-390';
    if (!isDesktop && !isMobile) return;

    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));

    // Mock enriched config with loyalty and coupons enabled
    await page.route('**/caixa/config', route => route.fulfill({
      json: {
        plano: 'pro',
        plano_efetivo: 'pro',
        entitlements: {
          printing: true,
          kds: true,
          waiter_app: true,
          loyalty: true,
          coupons: true,
          courier_app: true,
          inventory: true,
          advanced_reports: true,
        },
        taxa_servico_ativa: true,
        taxa_servico_padrao: 10,
      }
    }));

    // Mock Fidelity config
    await page.route('**/fidelidade/config', route => route.fulfill({
      json: {
        ativo: true,
        tipo_recompensa: 'PONTOS',
        taxa_conversao: 1,
        pontos_por_real: 1,
        resgate_minimo: 100,
        recompensa_valor: 10,
      }
    }));

    // Mock Cupons
    await page.route('**/cupons', route => route.fulfill({
      json: [
        {
          id: 'cupom-1',
          codigo: 'BEMVINDO15',
          descricao: '15% de desconto no 2º pedido',
          tipo: 'PERCENTUAL',
          valor: 15,
          valor_minimo_pedido: 40,
          valido_ate: '2026-11-30T23:59:59Z',
          ativo: true,
          limite_usos_total: 100,
          usos_realizados: 23,
          limite_por_cliente: 1,
          canais_permitidos: ['SALAO', 'CARDAPIO_DIGITAL', 'DELIVERY'],
          publico_elegivel: 'NOVOS_CLIENTES',
        },
        {
          id: 'cupom-2',
          codigo: 'VOLTA10',
          descricao: 'R$ 10 OFF para matar a saudade',
          tipo: 'VALOR_FIXO',
          valor: 10,
          valor_minimo_pedido: 50,
          valido_ate: '2026-12-15T23:59:59Z',
          ativo: true,
          limite_usos_total: 50,
          usos_realizados: 12,
          limite_por_cliente: 1,
          canais_permitidos: ['TODOS'],
          publico_elegivel: 'RECORRENTES_INATIVOS',
        }
      ]
    }));

    // Mock Customers list
    const mockCustomers = [
      {
        id: 'c-1',
        nome: 'Ana Frequente',
        telefone: '85999998888',
        pedidos_concluidos: 14,
        valor_pago_total: 840,
        ticket_medio_pago: 60,
        primeira_compra_em: '2026-08-10T19:00:00Z',
        ultima_compra_em: '2026-10-12T20:30:00Z',
        intervalo_medio_dias: 4,
        dias_sem_comprar: 4,
        segmento_relacionamento: 'ATIVO',
        saldo_pontos: 150,
        saldo_cashback: 0,
        status_beneficio: 'RESGATAVEL',
        elegivel_resgate: true,
        valor_resgatavel_brl: 15,
        contatado_recentemente: false,
        dias_ultimo_contato: 28,
        produtos_favoritos: [
          { produto_id: 'p1', nome: 'Burger Artesanal Defumado', unidades: 12 },
          { produto_id: 'p2', nome: 'Batata Rústica Alecrim', unidades: 8 }
        ]
      },
      {
        id: 'c-2',
        nome: 'Bruno Ausente',
        telefone: '85988887777',
        pedidos_concluidos: 5,
        valor_pago_total: 290,
        ticket_medio_pago: 58,
        primeira_compra_em: '2026-06-05T12:00:00Z',
        ultima_compra_em: '2026-08-15T19:45:00Z',
        intervalo_medio_dias: 14,
        dias_sem_comprar: 62,
        segmento_relacionamento: 'REATIVAR',
        saldo_pontos: 60,
        saldo_cashback: 0,
        status_beneficio: 'SALDO_EM_FORMACAO',
        elegivel_resgate: false,
        valor_resgatavel_brl: 0,
        contatado_recentemente: false,
        dias_ultimo_contato: null,
        produtos_favoritos: [
          { produto_id: 'p3', nome: 'Pizza Margherita Especial', unidades: 4 }
        ]
      },
      {
        id: 'c-3',
        nome: 'Carlos Segunda Compra',
        telefone: '85977776666',
        pedidos_concluidos: 1,
        valor_pago_total: 75,
        ticket_medio_pago: 75,
        primeira_compra_em: '2026-10-09T21:00:00Z',
        ultima_compra_em: '2026-10-09T21:00:00Z',
        intervalo_medio_dias: null,
        dias_sem_comprar: 7,
        segmento_relacionamento: 'ATIVO',
        saldo_pontos: 75,
        saldo_cashback: 0,
        status_beneficio: 'SALDO_EM_FORMACAO',
        elegivel_resgate: false,
        valor_resgatavel_brl: 0,
        contatado_recentemente: false,
        dias_ultimo_contato: null,
        produtos_favoritos: [
          { produto_id: 'p4', nome: 'Risoto de Cogumelos', unidades: 1 }
        ]
      },
      {
        id: 'c-4',
        nome: 'Daniela Contato Recente',
        telefone: '85966665555',
        pedidos_concluidos: 6,
        valor_pago_total: 410,
        ticket_medio_pago: 68.33,
        primeira_compra_em: '2026-07-20T20:00:00Z',
        ultima_compra_em: '2026-09-25T13:00:00Z',
        intervalo_medio_dias: 12,
        dias_sem_comprar: 21,
        segmento_relacionamento: 'ATENCAO',
        saldo_pontos: 120,
        saldo_cashback: 0,
        status_beneficio: 'RESGATAVEL',
        elegivel_resgate: true,
        valor_resgatavel_brl: 12,
        contatado_recentemente: true,
        dias_ultimo_contato: 3,
        produtos_favoritos: [
          { produto_id: 'p5', nome: 'Salmão Grelhado com Legumes', unidades: 5 }
        ]
      },
      {
        id: 'c-5',
        nome: 'Eduardo Sem Compras',
        telefone: '85955554444',
        pedidos_concluidos: 0,
        valor_pago_total: 0,
        ticket_medio_pago: 0,
        primeira_compra_em: null,
        ultima_compra_em: null,
        intervalo_medio_dias: null,
        dias_sem_comprar: null,
        segmento_relacionamento: 'SEM_COMPRA',
        saldo_pontos: 0,
        saldo_cashback: 0,
        status_beneficio: 'SEM_SALDO',
        elegivel_resgate: false,
        valor_resgatavel_brl: 0,
        contatado_recentemente: false,
        dias_ultimo_contato: null,
        produtos_favoritos: []
      }
    ];

    await page.route(/\/fidelidade\/clientes(?:\?.*)?$/, route => route.fulfill({ json: mockCustomers }));

    // Mock individual customer profile for drawer
    await page.route('**/fidelidade/clientes/c-1/perfil', route => route.fulfill({
      json: {
        cliente_id: 'c-1',
        dados_declarados: {
          nome: 'Ana Frequente',
          telefone: '85999998888',
          observacoes_atendimento: 'Prefere mesa no salão interno climatizado. Alérgica a camarão.',
          permite_marketing: true,
        },
        comportamento_observado: {
          pedidos_concluidos: 14,
          pedidos_cancelados_ou_estornados: 0,
          valor_liquido_pago_total: 840,
          ticket_medio_liquido: 60,
          primeira_compra_em: '2026-08-10T19:00:00Z',
          ultima_compra_em: '2026-10-12T20:30:00Z',
          intervalo_medio_dias: 4,
          dias_sem_comprar: 4,
          dias_atraso_vs_habito: 0,
          status_frequencia: 'EM_DIA',
          segmento_relacionamento: 'ATIVO',
          produtos_mais_pedidos: [
            { produto_id: 'p1', nome: 'Burger Artesanal Defumado', unidades: 12, valor_total: 480 },
            { produto_id: 'p2', nome: 'Batata Rústica Alecrim', unidades: 8, valor_total: 160 }
          ],
          canais_utilizados: ['SALAO', 'CARDAPIO_DIGITAL'],
          meios_pagamento_frequentes: ['PIX', 'CARTAO_CREDITO'],
        },
        beneficios: {
          programa_ativo: true,
          tipo_recompensa: 'PONTOS',
          saldo_acumulado: 150,
          unidade: 'pontos',
          saldo_resgatavel_brl: 15,
          elegivel_resgate: true,
          resgate_minimo_exigido: 100,
          cupons_disponiveis: [
            { id: 'cupom-1', codigo: 'BEMVINDO15', descricao: '15% no 2º pedido', valido_ate: '2026-11-30T23:59:59Z' }
          ]
        },
        historico_recente: [
          {
            pedido_id: 'ped-101',
            display_number: '101',
            criado_em: '2026-10-12T20:30:00Z',
            valor_liquido: 65,
            itens_resumo: '1x Burger Artesanal Defumado, 1x Suco Natural de Laranja',
            canal: 'SALAO',
            forma_pagamento: 'PIX'
          },
          {
            pedido_id: 'ped-094',
            display_number: '094',
            criado_em: '2026-10-08T19:15:00Z',
            valor_liquido: 58,
            itens_resumo: '1x Burger Artesanal Defumado, 1x Batata Rústica Alecrim',
            canal: 'CARDAPIO_DIGITAL',
            forma_pagamento: 'CARTAO_CREDITO'
          }
        ],
        historico_contatos: [
          {
            id: 'cont-1',
            canal: 'WHATSAPP',
            origem: 'MANUAL',
            assunto: 'Agradecimento e pontos acumulados',
            registrado_em: '2026-09-18T14:10:00Z',
            responsavel: 'Gerente KÔMA',
            observacao: 'Cliente respondeu agradecendo o atendimento.'
          }
        ]
      }
    }));

    // Mock CRM Resumo endpoint
    await page.route('**/crm/resumo**', route => route.fulfill({
      json: {
        restaurante_id: 99001,
        periodo_dias: 30,
        atualizado_em: new Date().toISOString(),
        metodologia_nota: 'Receita associada registra compras com cupom ou link rastreado no período e não comprova receita incremental.',
        resumo_clientes: {
          total_cadastrados: 5,
          com_ao_menos_uma_compra: 4,
          sem_compras_identificadas: 1,
          novos_periodo: 2,
          ativos: 2,
          em_atencao: 1,
          para_reativar: 1,
        },
        oportunidades: [
          {
            id: 'SEGUNDA_COMPRA',
            titulo: 'Incentivar a 2ª compra',
            subtitulo: 'Clientes com exatamente 1 pedido concluído na janela ideal de recompra.',
            elegiveis_count: 1,
            retidos_contato_recente_count: 0,
            abordagem_recomendada: 'SEM_DESCONTO',
            dica_acao: 'Agradeça a primeira visita e recomende uma sobremesa ou o prato mais elogiado do cardápio.',
            criterios: '1 pedido concluído entre 3 e 21 dias atrás, sem contato nos últimos 7 dias.',
            limitacoes: 'Não aplicável a cadastros sem compra identificada ou pedidos cancelados.',
          },
          {
            id: 'RECUPERAR_RECORRENTES',
            titulo: 'Recuperar recorrentes fora do ritmo habitual',
            subtitulo: 'Clientes frequentes que ultrapassaram o dobro do intervalo médio habitual.',
            elegiveis_count: 1,
            retidos_contato_recente_count: 0,
            abordagem_recomendada: 'SEM_DESCONTO',
            dica_acao: 'Envie uma mensagem pessoal lembrando o prato favorito do cliente e novidades da semana.',
            criterios: '2 ou mais pedidos, intervalo atual > 2x o intervalo histórico ou sem compras há mais de 45 dias.',
            limitacoes: 'Clientes já contatados na semana são protegidos contra insistência comercial.',
          },
          {
            id: 'LEMBRAR_BENEFICIO',
            titulo: 'Lembrar benefícios disponíveis para resgate',
            subtitulo: 'Clientes com saldo de pontos ou cashback suficiente para resgatar agora.',
            elegiveis_count: 1,
            retidos_contato_recente_count: 1,
            abordagem_recomendada: 'FIDELIDADE',
            dica_acao: 'Lembre o saldo resgatável real (R$ 15,00) que pode ser abatido na próxima conta.',
            criterios: 'Saldo acumulado >= resgate mínimo do restaurante. 1 cliente retido por contato há 3 dias.',
            limitacoes: 'Diferencia saldo resgatável de saldo em formação para evitar frustração no caixa.',
          },
          {
            id: 'RECONHECER_FREQUENTES',
            titulo: 'Reconhecer clientes frequentes e fiéis',
            subtitulo: 'Top clientes recorrentes com compras em dia e alto valor de relacionamento.',
            elegiveis_count: 1,
            retidos_contato_recente_count: 0,
            abordagem_recomendada: 'SEM_DESCONTO',
            dica_acao: 'Mensagem de valorização VIP e agradecimento de quem faz a casa acontecer todo mês.',
            criterios: '5 ou mais pedidos com frequência em dia nos últimos 30 dias.',
            limitacoes: 'Não necessita desconto financeiro; valorize o relacionamento e atendimento.',
          },
          {
            id: 'RECUPERAR_POS_OCORRENCIA',
            titulo: 'Retomar relacionamento após ocorrência ou estorno',
            subtitulo: 'Clientes com estorno/cancelamento recente ou avaliação crítica registrada.',
            elegiveis_count: 0,
            retidos_contato_recente_count: 0,
            abordagem_recomendada: 'SEM_DESCONTO',
            dica_acao: 'Contato humanizado da gerência ouvindo o cliente e restabelecendo a confiança.',
            criterios: 'Estorno parcial/total nos últimos 30 dias ou avaliação <= 3 estrelas.',
            limitacoes: 'Acionado apenas quando há dados auditados de ocorrência na operação.',
          }
        ],
        indicadores_decisao: {
          taxa_segunda_compra_pct: 66.7,
          clientes_com_segunda_compra: 2,
          base_elegivel_segunda_compra: 3,
          retorno_observado_apos_contato_pct: 50.0,
          clientes_retornaram_apos_contato: 1,
          total_clientes_contatados_janela: 2,
          pedidos_associados_campanhas: 8,
          valor_liquido_pedidos_associados: 520.00,
          descontos_utilizados_reais: 45.00,
        },
        campanhas_recentes: [
          {
            id: 'camp-1',
            nome: 'Segunda Compra — Cardápio Especial',
            objetivo: 'SEGUNDA_COMPRA',
            publico_alvo: 'Clientes com 1 compra (7-14 dias)',
            tipo_abordagem: 'SEM_DESCONTO',
            total_destinatarios: 12,
            contatados_count: 10,
            retorno_observado_count: 4,
            pedidos_associados_count: 4,
            receita_associada_brl: 260.00,
            desconto_concedido_brl: 0.00,
            criado_em: '2026-10-01T15:00:00Z',
            status: 'CONCLUIDA'
          },
          {
            id: 'camp-2',
            nome: 'Resgate de Pontos Fidelidade',
            objetivo: 'LEMBRAR_BENEFICIO',
            publico_alvo: 'Clientes com saldo resgatável >= R$ 10',
            tipo_abordagem: 'FIDELIDADE',
            total_destinatarios: 8,
            contatados_count: 7,
            retorno_observado_count: 3,
            pedidos_associados_count: 3,
            receita_associada_brl: 195.00,
            desconto_concedido_brl: 30.00,
            criado_em: '2026-10-08T11:00:00Z',
            status: 'CONCLUIDA'
          }
        ]
      }
    }));

    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();

    if (isMobile) {
      await page.getByRole('button', { name: 'Abrir menu completo' }).click();
    }
    await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();

    if (isDesktop) {
      // 1. OPORTUNIDADES
      await expect(page.getByRole('heading', { name: 'Recuperar recorrentes fora do ritmo habitual' })).toBeVisible();
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-tab-1-oportunidades.png`, fullPage: false });

      // 2. CLIENTES
      await page.getByRole('tab', { name: /2\. Clientes/ }).click();
      await expect(page.getByRole('button', { name: 'Ver perfil', exact: true }).first()).toBeVisible();
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-tab-2-clientes.png`, fullPage: false });

      // FICHA INDIVIDUAL (DRAWER)
      await page.getByRole('button', { name: 'Ver perfil', exact: true }).first().click();
      await expect(page.getByRole('dialog', { name: /Ficha individual de Ana Frequente/ })).toBeVisible();
      await page.waitForTimeout(500); // allow animations
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-drawer-ficha-individual.png`, fullPage: false });
      await page.getByRole('button', { name: 'Fechar ficha do cliente' }).click();
      await expect(page.getByRole('dialog', { name: /Ficha individual de Ana Frequente/ })).toHaveCount(0);

      // 3. CAMPANHAS
      await page.getByRole('tab', { name: /3\. Campanhas/ }).click();
      await expect(page.getByRole('heading', { name: /1\. Objetivo → 2\. Público/ })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-tab-3-campanhas.png`, fullPage: false });

      // 4. BENEFÍCIOS
      await page.getByRole('tab', { name: /4\. Benefícios/ }).click();
      await expect(page.getByRole('heading', { name: /Condições legíveis e separação entre saldo/ })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-tab-4-beneficios.png`, fullPage: false });

      // 5. RESULTADOS
      await page.getByRole('tab', { name: /5\. Resultados/ }).click();
      await expect(page.getByRole('heading', { name: /O cliente voltou\? Qual resultado consigo comprovar\?/ })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-tab-5-resultados.png`, fullPage: false });
    }

    if (isMobile) {
      // MOBILE OVERVIEW
      await expect(page.getByRole('tab', { name: /1\. Oportunidades/ })).toBeVisible();
      await page.screenshot({ path: `${ARTIFACT_DIR}/crm-mobile-view.png`, fullPage: false });
    }
  });
});
