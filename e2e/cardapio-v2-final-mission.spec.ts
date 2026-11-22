import { expect, test, type Page } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

type MenuConfig = {
  restaurantId?: number;
  slug?: string;
  name?: string;
  primaryColor?: string;
  promotions?: Array<Record<string, unknown>>;
  products?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown>>;
  accountRequired?: boolean;
};

function buildMenuPayload(config: MenuConfig = {}) {
  const restaurantId = config.restaurantId ?? 2;
  const slug = config.slug ?? `rest-${restaurantId}`;
  const name = config.name ?? 'Pizzeria Bella Italia';
  const primaryColor = config.primaryColor ?? '#ec4899';

  const defaultCategories = config.categories ?? [
    { id: 10, nome: 'Pizzas Artesanais' },
    { id: 20, nome: 'Bebidas' },
  ];

  const defaultProducts = config.products ?? [
    {
      id: 101,
      nome: 'Pizza Margherita Especial',
      descricao: 'Molho San Marzano, muçarela de búfala fresca e manjericão.',
      preco: 48,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 10,
      destaque: true,
      grupos_modificadores: [
        {
          id: 'grp-massa',
          nome: 'Massa',
          min_selecoes: 1,
          max_selecoes: 1,
          tipo: 'obrigatorio',
          opcoes: [
            { id: 'massa-trad', nome: 'Massa Tradicional', preco_adicional: 0, ativo: true },
            { id: 'massa-integral', nome: 'Massa Integral', preco_adicional: 4, ativo: true },
            { id: 'massa-ferm', nome: 'Fermentação 48h', preco_adicional: 6, ativo: true },
          ],
        },
        {
          id: 'grp-adicionais',
          nome: 'Adicionais da Pizza',
          min_selecoes: 0,
          max_selecoes: 4,
          tipo: 'opcional',
          opcoes: [
            { id: 'add-bacon', nome: 'Bacon Crocante', preco_adicional: 6, ativo: true },
            { id: 'add-cebola', nome: 'Cebola Caramelizada', preco_adicional: 4, ativo: true },
            { id: 'add-cheddar', nome: 'Cheddar Cremoso', preco_adicional: 5, ativo: true },
            { id: 'add-rucula', nome: 'Rúcula Fresca', preco_adicional: 3, ativo: true },
            { id: 'add-parmesao', nome: 'Parmesão Ralado', preco_adicional: 5, ativo: true },
          ],
        },
        {
          id: 'grp-molhos',
          nome: 'Molhos Extras',
          min_selecoes: 0,
          max_selecoes: 3,
          tipo: 'opcional',
          opcoes: [
            { id: 'molho-pesto', nome: 'Molho Pesto', preco_adicional: 4, ativo: true },
            { id: 'molho-alho', nome: 'Azeite de Alho', preco_adicional: 2, ativo: true },
            { id: 'molho-pimenta', nome: 'Geleia de Pimenta', preco_adicional: 3, ativo: true },
            { id: 'molho-trufa', nome: 'Azeite Trufado', preco_adicional: 7, ativo: true },
          ],
        },
        {
          id: 'grp-talheres',
          nome: 'Talheres e Embalagem',
          min_selecoes: 0,
          max_selecoes: 2,
          tipo: 'opcional',
          opcoes: [
            { id: 'talher-sim', nome: 'Enviar talheres descartáveis', preco_adicional: 0, ativo: true },
            { id: 'guardanapo', nome: 'Guardanapos extras', preco_adicional: 0, ativo: true },
            { id: 'caixa-termica', nome: 'Selo térmico reforçado', preco_adicional: 2, ativo: true },
          ],
        },
      ],
    },
    {
      id: 201,
      nome: 'Refrigerante Lata 350ml',
      descricao: 'Bem gelado para acompanhar.',
      preco: 7,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 20,
      grupos_modificadores: [],
    },
    {
      id: 202,
      nome: 'Suco Natural de Laranja',
      descricao: 'Espremido na hora.',
      preco: 12,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 20,
      grupos_modificadores: [],
    },
  ];

  return {
    restaurante: {
      id: restaurantId,
      nome: name,
      slug,
      logo_url: '',
      banner_url: '',
      subtitulo: 'Forno a lenha & massa artesanal',
      sobre_nos: 'Receitas artesanais preparadas na hora.',
      endereco: 'Av. Principal, 100 - Centro',
      google_maps_url: '',
      status_override: 'Forçado Aberto',
      aceitando_pedidos: true,
      delivery_ativo: true,
      retirada_ativa: true,
      taxa_entrega_fixa: 6,
      pagamento_online_ativo: false,
      conta_cliente_obrigatoria: Boolean(config.accountRequired),
      formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito'],
      cor_primaria: primaryColor,
      beneficios: { coupons: false, loyalty: false, cashback: false },
    },
    categorias: defaultCategories,
    produtos: defaultProducts,
    promocoes: config.promotions ?? [],
  };
}

async function setupMockBackend(
  page: Page,
  options: {
    menusByIdentifier?: Record<string, ReturnType<typeof buildMenuPayload>>;
    defaultMenu?: ReturnType<typeof buildMenuPayload>;
    ordersById?: Record<string, Record<string, unknown>>;
    onCreateOrder?: (body: Record<string, unknown>) => Record<string, unknown>;
  } = {},
) {
  await page.routeWebSocket('**/ws/**', () => {});

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/cardapio-digital/public') {
      const idParam = url.searchParams.get('restaurante_id') || '';
      const slugParam = url.searchParams.get('slug') || '';
      const matched =
        (idParam && options.menusByIdentifier?.[idParam]) ||
        (slugParam && options.menusByIdentifier?.[slugParam]) ||
        options.defaultMenu ||
        buildMenuPayload({ restaurantId: Number(idParam || 2) || 2 });
      return route.fulfill({ status: 200, json: matched });
    }

    if (pathname === '/api/cardapio-digital/populares') {
      return route.fulfill({ status: 200, json: { produtos: [{ produto_id: '101', escolhas: 15 }] } });
    }

    if (pathname === '/cardapio/clientes/me') {
      return route.fulfill({ status: 401, json: { detail: 'Visitante sem sessão' } });
    }

    if (pathname === '/cardapio/clientes/reconhecer') {
      return route.fulfill({ status: 200, json: { found: false } });
    }

    if (pathname === '/cardapio/pedidos' && request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const created = options.onCreateOrder?.(payload) ?? {
        comanda_id: 'ord-501',
        numero_pedido: 501,
        total: 55,
        delivery_receipt_code: '9104',
        tracking_token: 'tok-ord-501',
      };
      if (options.ordersById && typeof created.comanda_id === 'string') {
        options.ordersById[created.comanda_id] = {
          id: created.comanda_id,
          numero_pedido: created.numero_pedido,
          status: 'aceito',
          tipo: payload.tipo_pedido === 'Delivery' ? 'Delivery' : 'Retirada',
          total: created.total,
          delivery_receipt_code: created.delivery_receipt_code ?? '9104',
          fechada: false,
          itens: [{ id: 'item-1', nome: 'Item do pedido', quantidade: 1 }],
        };
      }
      return route.fulfill({ status: 201, json: created });
    }

    if (pathname.startsWith('/cardapio/pedidos/') && pathname.endsWith('/status')) {
      const orderId = pathname.split('/')[3];
      const match = options.ordersById?.[orderId];
      if (!match) {
        return route.fulfill({ status: 404, json: { detail: 'Pedido não encontrado' } });
      }
      return route.fulfill({ status: 200, json: match });
    }

    if (pathname.startsWith('/api/cardapio/pedidos/acompanhar/') && pathname.endsWith('/summary')) {
      const token = pathname.split('/')[5];
      const match = Object.values(options.ordersById ?? {}).find(
        (entry) => entry.tracking_token === token || `tok-${entry.id}` === token,
      );
      if (!match) {
        return route.fulfill({ status: 404, json: { detail: 'Resumo não encontrado' } });
      }
      return route.fulfill({ status: 200, json: match });
    }

    if (pathname.startsWith('/api/cardapio/pedidos/acompanhar/') && pathname.endsWith('/feed')) {
      return route.fulfill({ status: 200, json: { items: [], latest_seq: 0 } });
    }

    return route.fulfill({ status: 200, json: {} });
  });
}

async function openBag(page: Page) {
  const cart = page.locator('#cart-drawer-container');
  if (!(await cart.isVisible())) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  }
  await expect(cart).toBeVisible();
  return cart;
}

test.describe('Missão Final Cardápio V2', () => {
  test('dock permanente: navega entre todas as abas sem colisão e oculta apenas em modais bloqueantes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Dock mobile permanente existe apenas abaixo de 768px');

    const ordersById: Record<string, Record<string, unknown>> = {
      'ord-dock-1': {
        id: 'ord-dock-1',
        numero_pedido: 701,
        status: 'aceito',
        tipo: 'Retirada',
        total: 48,
        delivery_receipt_code: '3312',
        fechada: false,
        itens: [{ id: '101', nome: 'Pizza Margherita Especial', quantidade: 1 }],
      },
    };

    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload(),
      ordersById,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');

    const dock = page.locator('#koma-art-dock');
    await expect(dock).toBeVisible();
    await expect(page.locator('#mobile-nav-home')).toHaveAttribute('aria-current', 'page');

    const assertDockAboveTarget = async (targetLocator: ReturnType<Page['locator']>, label: string) => {
      const dockBox = await dock.boundingBox();
      const targetBox = await targetLocator.boundingBox();
      expect(dockBox, 'Dock precisa ter boundingBox').not.toBeNull();
      expect(targetBox, `${label} precisa ter boundingBox`).not.toBeNull();
      expect(
        targetBox!.y + targetBox!.height,
        `${label} não pode colidir com o topo do #koma-art-dock`,
      ).toBeLessThanOrEqual(dockBox!.y + 1);
    };

    const assertDockClickable = async (tabSelector: string) => {
      const hitInsideDock = await page.locator(tabSelector).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return Boolean(hit && el.closest('#koma-art-dock')?.contains(hit));
      });
      expect(hitInsideDock, `${tabSelector} precisa estar clicável acima do backdrop`).toBe(true);
    };

    // 1. Fluxo visitante, sacola vazia: Início → Pedidos → Sacola → Conta → Início
    await page.locator('#mobile-nav-orders').click();
    const ordersPanel = page.locator('#orders-drawer-panel');
    await expect(ordersPanel).toBeVisible();
    await expect(dock).toBeVisible();
    await expect(page.locator('#mobile-nav-orders')).toHaveAttribute('aria-current', 'page');
    await assertDockAboveTarget(ordersPanel.getByRole('button', { name: 'Explorar cardápio' }), 'Botão Explorar cardápio em Pedidos');
    await assertDockClickable('#mobile-nav-cart');

    await page.locator('#mobile-nav-cart').click();
    const cartDrawer = page.locator('#cart-drawer-container');
    await expect(cartDrawer).toBeVisible();
    await expect(ordersPanel).toBeHidden();
    await expect(dock).toBeVisible();
    await expect(page.locator('#mobile-nav-cart')).toHaveAttribute('aria-current', 'page');
    await assertDockAboveTarget(cartDrawer.getByRole('button', { name: 'Ver cardápio' }), 'Botão Ver cardápio na Sacola vazia');
    await assertDockClickable('#mobile-nav-account');

    await page.locator('#mobile-nav-account').click();
    const authCard = page.locator('#auth-modal-card');
    await expect(authCard).toBeVisible();
    await expect(cartDrawer).toBeHidden();
    await expect(dock).toBeVisible();
    await expect(page.locator('#mobile-nav-account')).toHaveAttribute('aria-current', 'page');
    await assertDockAboveTarget(authCard.getByRole('button', { name: 'Continuar como visitante' }), 'Botão Continuar como visitante em Conta');
    await assertDockClickable('#mobile-nav-home');

    await page.locator('#mobile-nav-home').click();
    await expect(authCard).toBeHidden();
    await expect(dock).toBeVisible();
    await expect(page.locator('#mobile-nav-home')).toHaveAttribute('aria-current', 'page');

    // 2. Com sacola cheia + pedido em andamento: fluxo Sacola → Pedidos → Sacola
    await page.evaluate(() => {
      sessionStorage.setItem(
        'koma_active_orders',
        JSON.stringify([
          {
            id: 'ord-dock-1',
            numero_pedido: '701',
            timestamp: Date.now(),
            restaurante_id: 2,
            tipo: 'Retirada',
            total: 48,
            status: 'aceito',
            idempotency_key: 'idem-dock-1',
          },
        ]),
      );
    });
    await page.reload();
    await expect(page.locator('#active-order-banner')).toBeVisible();

    await page.locator('#btn-fast-add-201').click();
    await page.locator('#mobile-nav-cart').click();
    await expect(cartDrawer).toBeVisible();
    await expect(dock).toBeVisible();
    await assertDockAboveTarget(cartDrawer.locator('#btn-confirm-order'), 'CTA checkout #btn-confirm-order');
    await assertDockClickable('#mobile-nav-orders');

    await page.locator('#mobile-nav-orders').click();
    await expect(ordersPanel).toBeVisible();
    await expect(cartDrawer).toBeHidden();
    await expect(dock).toBeVisible();
    await assertDockAboveTarget(ordersPanel.getByRole('button', { name: /Fixar no topo|Fixado no topo/i }).first(), 'Botão de ação do pedido em Pedidos');
    await assertDockClickable('#mobile-nav-cart');

    await page.locator('#mobile-nav-cart').click();
    await expect(cartDrawer).toBeVisible();
    await expect(ordersPanel).toBeHidden();
    await expect(dock).toBeVisible();
    await assertDockAboveTarget(cartDrawer.locator('#btn-confirm-order'), 'CTA checkout após retorno de Pedidos → Sacola');

    // 3. Dock oculto somente ao abrir ProductModal ou Checkout
    await page.locator('#mobile-nav-home').click();
    await expect(dock).toBeVisible();
    await page.locator('#product-card-101').click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await expect(dock).toHaveCount(0);
    await page.locator('#btn-close-modal').click();
    await expect(dock).toBeVisible();

    await page.locator('#mobile-nav-cart').click();
    await cartDrawer.locator('#btn-confirm-order').click();
    await cartDrawer.getByRole('button', { name: /Retirada/i }).first().click();
    await cartDrawer.locator('#btn-confirm-order').click();
    await cartDrawer.locator('#btn-confirm-order').click();
    await cartDrawer.locator('#input-guest-phone').fill('85999991111');
    await cartDrawer.locator('#input-guest-name').fill('Maria Dock');
    await cartDrawer.locator('#btn-confirm-order').click();
    await expect(page.locator('#checkout-card')).toBeVisible();
    await expect(dock).toHaveCount(0);
  });

  test('modificadores: barra fixa, zero colisão, scroll-spy, navegação sem erro falso, erro real e contador 3/4 · 4 un.', async ({ page }) => {
    await setupMockBackend(page, { defaultMenu: buildMenuPayload() });
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');

    await page.locator('#product-card-101').click();
    const modal = page.locator('#product-details-modal');
    await expect(modal).toBeVisible();

    const stepsBar = modal.getByTestId('modifier-steps-bar');
    const scroller = modal.getByTestId('product-modal-scroll');
    await expect(stepsBar).toBeVisible();

    // Aguarda fim da transição de entrada (animate-slide-up) antes de comparar coordenadas fixas
    await expect.poll(async () => stepsBar.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(350);

    const barRectBefore = await stepsBar.evaluate((el) => el.getBoundingClientRect().toJSON());
    const scrollerRect = await scroller.evaluate((el) => el.getBoundingClientRect().toJSON());
    expect(barRectBefore.bottom).toBeLessThanOrEqual(scrollerRect.top + 1);

    // Verifica ausência de colisão interna entre cabeçalho e steppers nos grupos expandidos
    const geometryOk = await modal.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('#product-details-modal section[aria-label]'));
      for (const sec of sections) {
        const heading = sec.querySelector('h3')?.getBoundingClientRect();
        const firstOption = sec.querySelector('[id^="modifier-options-"] > :not([hidden])');
        if (heading && firstOption) {
          const optRect = firstOption.getBoundingClientRect();
          if (optRect.height > 0 && heading.bottom > optRect.top + 2) {
            return { ok: false, reason: 'heading overlapped option' };
          }
        }
        const rows = Array.from(sec.querySelectorAll('.koma-art-stepper-pill'));
        for (const pill of rows) {
          const pillRect = pill.getBoundingClientRect();
          const rowLabel = pill.previousElementSibling?.getBoundingClientRect();
          if (pillRect.width > 0 && rowLabel && rowLabel.right > pillRect.left + 1) {
            return { ok: false, reason: 'row label overlapped stepper pill' };
          }
        }
      }
      return { ok: true };
    });
    expect(geometryOk).toEqual({ ok: true });

    // Scroll-spy atualiza etapa ativa quando rola até os últimos grupos
    const initialActive = await stepsBar.locator('[aria-current="step"]').textContent();
    expect(initialActive).toContain('Massa');

    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(async () => (await stepsBar.locator('[aria-current="step"]').textContent()) || '')
      .not.toContain('Massa');

    const barRectAfter = await stepsBar.evaluate((el) => el.getBoundingClientRect().toJSON());
    expect(Math.abs(barRectAfter.top - barRectBefore.top)).toBeLessThanOrEqual(1);
    expect(barRectAfter.bottom).toBeLessThanOrEqual(scrollerRect.top + 1);

    // Clique em grupo opcional NÃO aplica erro (--km-alert-dot / data-focus-state="error")
    await stepsBar.getByRole('button', { name: /Adicionais da Pizza/i }).click();
    const optionalSection = modal.locator('section[aria-label="Adicionais da Pizza"]');
    await expect(optionalSection).toHaveAttribute('data-focus-state', 'navigate');
    const optionalInlineShadow = await optionalSection.evaluate((el) => (el as HTMLElement).style.boxShadow);
    expect(optionalInlineShadow).toBe('');
    await expect(modal.locator('#modifier-options-grp-adicionais')).toBeVisible();

    // Contador semântico: 1 Bacon + 1 Cebola + 2 Cheddar => "3/4 · 4 un."
    await modal.getByRole('button', { name: 'Adicionar uma unidade de Bacon Crocante' }).click();
    await modal.getByRole('button', { name: 'Adicionar uma unidade de Cebola Caramelizada' }).click();
    await modal.getByRole('button', { name: 'Adicionar uma unidade de Cheddar Cremoso' }).click();
    await modal.getByRole('button', { name: 'Adicionar uma unidade de Cheddar Cremoso' }).click();
    await expect(modal.getByTestId('modifier-counter-grp-adicionais')).toHaveText('3/4 · 4 un.');

    // Falha real no obrigatório ao tentar adicionar sem escolher Massa -> ativa errorGroupId com --km-alert-dot
    await modal.locator('#btn-add-to-cart-action').click();
    const requiredSection = modal.locator('section[aria-label="Massa"]');
    await expect(requiredSection).toHaveAttribute('data-focus-state', 'error');
    const errorBoxShadow = await requiredSection.evaluate((el) => (el as HTMLElement).style.boxShadow);
    expect(errorBoxShadow).toContain('--km-alert-dot');
    await expect(modal).toContainText(/Massa/);
  });

  test('pedidos e código de entrega: accepted não avança para preparing, alterna 2 pedidos e resolve tema laranja #ea580c', async ({ page }) => {
    const ordersById: Record<string, Record<string, unknown>> = {
      'ord-101': {
        id: 'ord-101',
        numero_pedido: 101,
        status: 'aceito',
        tipo: 'Delivery',
        total: 64.5,
        delivery_receipt_code: '4819',
        fechada: false,
        itens: [{ id: '101', nome: 'Pizza Margherita Especial', quantidade: 1 }],
      },
      'ord-102': {
        id: 'ord-102',
        numero_pedido: 102,
        status: 'pronto',
        tipo: 'Retirada',
        total: 39.0,
        delivery_receipt_code: '7392',
        fechada: false,
        itens: [{ id: '201', nome: 'Refrigerante Lata 350ml', quantidade: 2 }],
      },
    };

    await page.addInitScript(() => {
      sessionStorage.setItem(
        'koma_active_orders',
        JSON.stringify([
          {
            id: 'ord-101',
            numero_pedido: '101',
            timestamp: Date.now(),
            restaurante_id: 2,
            tipo: 'Delivery',
            total: 64.5,
            status: 'aceito',
            idempotency_key: 'idem-101',
          },
          {
            id: 'ord-102',
            numero_pedido: '102',
            timestamp: Date.now() - 1000,
            restaurante_id: 2,
            tipo: 'Retirada',
            total: 39.0,
            status: 'pronto',
            idempotency_key: 'idem-102',
          },
        ]),
      );
    });

    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload({ primaryColor: '#ea580c' }),
      ordersById,
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    const banner = page.locator('#active-order-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-order-phase', 'accepted');

    // Trilha de "accepted" mantém passo 1 ativo e NÃO avança para passo 2 ("Em preparo")
    const progressWrap = banner.locator('.km-order-card__progress');
    await expect(progressWrap).toHaveAttribute('data-progress-current', '1');
    const step1 = banner.locator('.km-order-card__step[data-step-index="1"]');
    const step2 = banner.locator('.km-order-card__step[data-step-index="2"]');
    await expect(step1).toHaveAttribute('data-step-state', 'active');
    await expect(step1).toHaveAttribute('aria-current', 'step');
    await expect(step2).toHaveAttribute('data-step-state', 'upcoming');
    await expect(banner).toContainText('Aceito pela loja · próximo: preparo');
    await expect(banner).toContainText('R$ 64,50');
    await expect(banner.locator('.k-delivery-receipt strong')).toHaveText('4819');

    // DeliveryReceiptCode resolve cor do tema da loja (#ea580c laranja != verde fixo)
    const receiptPalette = await banner.locator('.k-delivery-receipt strong').evaluate((el) => {
      const color = getComputedStyle(el).color;
      const rootAccentText = getComputedStyle(document.documentElement).getPropertyValue('--km-accent-text').trim();
      const rgb = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
      return { color, rootAccentText, r: rgb[0], g: rgb[1], b: rgb[2] };
    });
    expect(receiptPalette.color).not.toBe('rgb(5, 196, 157)');
    expect(receiptPalette.color).not.toBe('rgb(0, 135, 95)');
    expect(receiptPalette.r).toBeGreaterThan(receiptPalette.g);
    expect(receiptPalette.r).toBeGreaterThan(receiptPalette.b);

    // Alternar para pedido #102 atualiza status, código, total e progresso
    await banner.getByRole('button', { name: '#102' }).click();
    await expect(banner).toHaveAttribute('data-order-id', 'ord-102');
    await expect(banner).toHaveAttribute('data-order-phase', 'ready');
    await expect(progressWrap).toHaveAttribute('data-progress-current', '2');
    await expect(step1).toHaveAttribute('data-step-state', 'done');
    await expect(step2).toHaveAttribute('data-step-state', 'active');
    await expect(banner).toContainText('Pronto para retirar');
    await expect(banner).toContainText('Retirada · Total: R$ 39,00');
    await expect(banner.locator('.k-delivery-receipt strong')).toHaveText('7392');
    await expect(banner).not.toContainText('4819');

    // Voltar para #101 restaura estado anterior sem vazamento
    await banner.getByRole('button', { name: '#101' }).click();
    await expect(banner).toHaveAttribute('data-order-phase', 'accepted');
    await expect(banner.locator('.k-delivery-receipt strong')).toHaveText('4819');
    await expect(banner).toContainText('R$ 64,50');
  });

  test('promoções variáveis: 0, 1, 2, 3 e 5 ofertas, concordância e largura editorial responsiva', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Matriz de quantidades e viewports executada uma vez');

    const makePromos = (count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `promo-${idx + 1}`,
        nome: `Combo Oferta ${idx + 1}`,
        descricao: 'Pizza selecionada com bebida gelada.',
        tipo: idx === 0 ? 'compre_ganhe' : 'combo',
        preco: 42 + idx * 5,
        componentes: [['101'], ['201']],
        quantidades: [1, 1],
      }));

    // 0 promoções -> nenhuma seção renderizada
    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload({ promotions: [] }),
    });
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await expect(page.locator('#koma-artistic-canvas')).toBeVisible();
    await expect(page.locator('#cardapio-promotions-home')).toHaveCount(0);

    // 1 promoção -> "1 oferta" e largura editorial completa em 320..1366px
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload({ primaryColor: '#ec4899', promotions: makePromos(1) }),
    });
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    const showcase = page.locator('#cardapio-promotions-home');
    await expect(showcase).toHaveAttribute('data-promo-layout', 'single');
    await expect(showcase.locator('.km-promo-showcase__count')).toHaveText('1 oferta');

    for (const width of [320, 360, 390, 412, 430, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      const metrics = await showcase.evaluate(() => {
        const inner = document.querySelector('#cardapio-promotions-home .km-promo-showcase__inner')!.getBoundingClientRect();
        const card = document.querySelector('#cardapio-promotions-home .km-promo-card--single')!.getBoundingClientRect();
        const media = document.querySelector('#cardapio-promotions-home .km-promo-card__media')!.getBoundingClientRect();
        const body = document.querySelector('#cardapio-promotions-home .km-promo-card__body')!.getBoundingClientRect();
        return {
          ratio: card.width / inner.width,
          scrollOverflow: document.documentElement.scrollWidth > window.innerWidth,
          cardHeight: card.height,
          mediaRight: media.right,
          bodyLeft: body.left,
        };
      });
      expect(metrics.ratio, `Largura ${width}px sem vazio lateral`).toBeGreaterThanOrEqual(0.95);
      expect(metrics.scrollOverflow, `Zero overflow horizontal em ${width}px`).toBe(false);
      if (width >= 520) {
        expect(metrics.mediaRight).toBeLessThanOrEqual(metrics.bodyLeft + 2);
        expect(metrics.cardHeight).toBeLessThanOrEqual(320);
      }
    }

    // 2 promoções -> "2 ofertas" e layout pair (grid 2 colunas em desktop)
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload({ promotions: makePromos(2) }),
    });
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await expect(showcase).toHaveAttribute('data-promo-layout', 'pair');
    await expect(showcase.locator('.km-promo-showcase__count')).toHaveText('2 ofertas');
    const pairCards = await showcase.locator('.km-promo-card--pair').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON()),
    );
    expect(pairCards).toHaveLength(2);
    expect(Math.abs(pairCards[0].width - pairCards[1].width)).toBeLessThanOrEqual(2);
    expect(Math.abs(pairCards[0].top - pairCards[1].top)).toBeLessThanOrEqual(2);

    // 3 e 5 promoções -> layout carousel com contagem exata
    for (const total of [3, 5]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await setupMockBackend(page, {
        defaultMenu: buildMenuPayload({ promotions: makePromos(total) }),
      });
      await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
      await expect(showcase).toHaveAttribute('data-promo-layout', 'carousel');
      await expect(showcase.locator('.km-promo-showcase__count')).toHaveText(`${total} ofertas`);
      await expect(showcase.locator('.km-promo-card--carousel')).toHaveCount(total);
    }
  });

  test('promoções dinâmicas: remoção em tempo real 2 → 1 → 0 com concordância correta', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-22T12:00:00Z') });
    await setupMockBackend(page, {
      defaultMenu: buildMenuPayload({
        promotions: [
          {
            id: 'promo-short',
            nome: 'Oferta Relâmpago',
            descricao: 'Expira primeiro.',
            tipo: 'combo',
            preco: 35,
            componentes: [['201']],
            quantidades: [1],
            fim_em: '2026-11-22T12:00:30Z',
          },
          {
            id: 'promo-long',
            nome: 'Oferta Principal',
            descricao: 'Fica em destaque único.',
            tipo: 'combo',
            preco: 49,
            componentes: [['101']],
            quantidades: [1],
            fim_em: '2026-11-22T12:01:00Z',
          },
        ],
      }),
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    const showcase = page.locator('#cardapio-promotions-home');
    await expect(showcase).toHaveAttribute('data-promo-layout', 'pair');
    await expect(showcase.locator('.km-promo-showcase__count')).toHaveText('2 ofertas');

    await page.clock.fastForward(31_000);
    await expect(showcase).toHaveAttribute('data-promo-layout', 'single');
    await expect(showcase.locator('.km-promo-showcase__count')).toHaveText('1 oferta');
    await expect(showcase).toContainText('Oferta Principal');
    await expect(showcase).not.toContainText('Oferta Relâmpago');

    await page.clock.fastForward(31_000);
    await expect(showcase).toHaveCount(0);
  });

  test('persistência anônima (sem login): reload mantém sacola completa, pedido ativo e isola restaurantes A e B', async ({ page }) => {
    const ordersById: Record<string, Record<string, unknown>> = {};
    const menuA = buildMenuPayload({
      restaurantId: 101,
      slug: 'restaurante-a',
      name: 'Cantina A',
      promotions: [
        {
          id: 'promo-a',
          nome: 'Combo Pizza + Refri',
          descricao: 'Combo promocional A.',
          tipo: 'combo',
          preco: 51,
          componentes: [['101'], ['201']],
          quantidades: [1, 1],
        },
      ],
    });
    const menuB = buildMenuPayload({
      restaurantId: 202,
      slug: 'restaurante-b',
      name: 'Bistrô B',
      categories: [{ id: 50, nome: 'Pratos B' }],
      products: [
        {
          id: 901,
          nome: 'Prato Exclusivo B',
          descricao: 'Exclusivo do restaurante B.',
          preco: 33,
          imagem_url: '',
          imagens_galeria: [],
          categoria_id: 50,
          grupos_modificadores: [],
        },
      ],
      promotions: [],
    });

    await setupMockBackend(page, {
      menusByIdentifier: {
        '101': menuA,
        'restaurante-a': menuA,
        '202': menuB,
        'restaurante-b': menuB,
      },
      ordersById,
      onCreateOrder: () => ({
        comanda_id: 'ord-a-501',
        numero_pedido: 501,
        total: 103,
        delivery_receipt_code: '9104',
        tracking_token: 'tok-ord-a-501',
      }),
    });

    // 1. Restaurante A: monta produto com adicionais + promoção + escolhe Retirada na sacola
    await page.goto('/cardapio?restaurante_id=101&vitrine=artistic-total');
    await page.locator('#product-card-101').click();
    const modal = page.locator('#product-details-modal');
    await modal.getByRole('checkbox', { name: 'Selecionar Massa Integral' }).check();
    await modal.getByTestId('modifier-steps-bar').getByRole('button', { name: /Adicionais da Pizza/i }).click();
    await modal.getByRole('button', { name: 'Adicionar uma unidade de Bacon Crocante' }).click();
    await modal.locator('#btn-add-to-cart-action').click();

    // Fecha cart se auto-abriu no desktop/mobile antes de adicionar promoção
    if (await page.locator('#cart-drawer-container').isVisible().catch(() => false)) {
      await page.locator('#btn-close-cart').click();
    }

    await page.locator('#cardapio-promotions-home').getByRole('button', { name: /Montar promoção Combo Pizza \+ Refri/ }).click();
    await expect(modal.locator('#modal-product-name')).toHaveText('Pizza Margherita Especial');
    await modal.getByRole('checkbox', { name: 'Selecionar Massa Tradicional' }).check();
    await modal.getByRole('button', { name: 'Continuar para Refrigerante Lata 350ml' }).click();
    await modal.getByRole('button', { name: 'Revisar promoção' }).click();
    await page.getByRole('button', { name: 'Adicionar promoção' }).click();

    let cart = await openBag(page);
    await cart.locator('#btn-confirm-order').click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();

    // Reload mantendo sacola completa (item com adicionais, promoção e modalidade Retirada) sem login
    await page.reload();
    cart = await openBag(page);
    await expect(cart).toContainText('Pizza Margherita Especial');
    await expect(cart).toContainText('Massa Integral');
    await expect(cart).toContainText('Bacon Crocante');
    await expect(cart).toContainText('Combo Pizza + Refri');
    await expect(cart).toContainText('Retirada');

    // Conclui pedido anônimo para testar persistência de pedido ativo após reload
    await cart.locator('#btn-confirm-order').click();
    await cart.locator('#btn-confirm-order').click();
    await cart.locator('#btn-confirm-order').click();
    await cart.locator('#input-guest-phone').fill('85999990000');
    await cart.locator('#input-guest-name').fill('Visitante Persistente');
    await cart.locator('#btn-confirm-order').click();
    await page.locator('#btn-place-order-final').click();
    await expect(page.locator('#checkout-card')).toContainText('Pedido #501');
    await page.locator('#btn-track-created-order').click();
    await expect(page.locator('#orders-drawer-panel')).toBeVisible();
    await page.locator('#orders-drawer-panel button[aria-label="Fechar"]').click();
    await expect(page.locator('#orders-drawer-panel')).toBeHidden();

    // Adiciona item novo à sacola e recarrega -> pedido ativo + nova sacola preservados
    await page.locator('#btn-fast-add-201').click();
    if (await page.locator('#cart-drawer-container').isVisible().catch(() => false)) {
      await page.locator('#btn-close-cart').click();
    }

    await page.reload();
    await expect(page.locator('#active-order-banner')).toBeVisible();
    await expect(page.locator('#active-order-banner')).toContainText('Pedido #501');
    cart = await openBag(page);
    await expect(cart).toContainText('Refrigerante Lata 350ml');
    await page.locator('#btn-close-cart').click();

    // Isolamento estrito entre Restaurante A (101) e Restaurante B (202)
    await page.goto('/cardapio?restaurante_id=202&vitrine=artistic-total');
    await expect(page.locator('#product-card-901')).toBeVisible();
    await expect(page.locator('#active-order-banner')).toHaveCount(0);
    const cartB = await openBag(page);
    await expect(cartB).toContainText('Sua sacola está vazia');
    await expect(cartB).not.toContainText('Refrigerante Lata 350ml');
    await expect(cartB).not.toContainText('Combo Pizza + Refri');

    // Retorno para Restaurante A preserva os dados de A intactos
    await page.goto('/cardapio?restaurante_id=101&vitrine=artistic-total');
    await expect(page.locator('#active-order-banner')).toContainText('Pedido #501');
    const cartA = await openBag(page);
    await expect(cartA).toContainText('Refrigerante Lata 350ml');
  });
});
