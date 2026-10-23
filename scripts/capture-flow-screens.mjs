import { chromium } from 'playwright';
import path from 'path';

const OUT_DIR = '/home/testuser/.gemini/antigravity/brain/76b1291a-adf2-4293-a519-b621dfb7301a';
const BASE_URL = 'http://localhost:3000/c/preview-ui';

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ==========================================
  // 1. Mobile Dark (390x844)
  // ==========================================
  console.log('--- Step 1: Mobile Dark ---');
  const mobileDarkContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await mobileDarkContext.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Burger clássico artesanal', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Home screen Dark
  await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-home-390-dark.png') });
  console.log('Saved artistic-flow-home-390-dark.png');

  // Store Info Drawer
  console.log('Opening store info drawer...');
  const storeTrigger = page.locator('#header-brand-info-trigger').first();
  if (await storeTrigger.isVisible()) {
    await storeTrigger.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-store-info-390-dark.png') });
    console.log('Saved artistic-flow-store-info-390-dark.png');
    // Close store info
    const closeStoreBtn = page.locator('#btn-close-store-info').first();
    if (await closeStoreBtn.isVisible()) {
      await closeStoreBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // Auth Modal
  console.log('Opening auth modal...');
  const authTrigger = page.locator('#btn-login-trigger, #btn-user-profile').first();
  if (await authTrigger.isVisible()) {
    await authTrigger.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-auth-390-dark.png') });
    console.log('Saved artistic-flow-auth-390-dark.png');
    // Close auth modal
    const closeAuthBtn = page.locator('#auth-modal-overlay button[aria-label="Fechar"]').first();
    if (await closeAuthBtn.isVisible()) {
      await closeAuthBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // Footer / Attribution
  console.log('Capturing footer attribution...');
  const footerEl = page.locator('.koma-art-footer').first();
  if (await footerEl.isVisible()) {
    await footerEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-footer-390-dark.png') });
    console.log('Saved artistic-flow-footer-390-dark.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }

  // Open Product Modal (Burger clássico artesanal)
  console.log('Opening product modal with modifiers...');
  const burgerCard = page.locator('text=Burger clássico artesanal').first();
  await burgerCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await burgerCard.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-modal-390-dark.png') });
  console.log('Saved artistic-flow-modal-390-dark.png');

  // Select modifier options
  const optionPonto = page.getByLabel('Selecionar Ao ponto (rosado e suculento)').first();
  if (await optionPonto.isVisible()) {
    await optionPonto.check();
    await page.waitForTimeout(200);
  }
  const optionBacon = page.getByLabel('Selecionar Bacon artesanal crocante').first();
  if (await optionBacon.isVisible()) {
    await optionBacon.check();
    await page.waitForTimeout(200);
  }

  // Add to cart with precise ID
  const addBtn = page.locator('#btn-add-to-cart-action').first();
  if (await addBtn.isVisible()) {
    await addBtn.click();
    await page.waitForTimeout(600);
  }

  // Open Cart Drawer with Items
  console.log('Opening cart drawer with items...');
  const openCartBtn = page.locator('.koma-art-dock-btn--bag, .koma-art-action-pill--cart').first();
  if (await openCartBtn.isVisible()) {
    await openCartBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-cart-items-390-dark.png') });
    console.log('Saved artistic-flow-cart-items-390-dark.png');

    // Click Continuar para recebimento
    const continueToReceive = page.locator('button:has-text("Continuar para recebimento")').first();
    if (await continueToReceive.isVisible()) {
      await continueToReceive.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-cart-delivery-390-dark.png') });
      console.log('Saved artistic-flow-cart-delivery-390-dark.png');
    }

    // Click Continuar para identificação then pagamento
    const continueToIdent = page.locator('button:has-text("Continuar para identificação")').first();
    if (await continueToIdent.isVisible()) {
      await continueToIdent.click();
      await page.waitForTimeout(400);
      // Fill name & phone
      const nameInput = page.locator('input#client-name, input[placeholder*="nome" i]').first();
      if (await nameInput.isVisible()) await nameInput.fill('Maria Oliveira');
      const phoneInput = page.locator('input#client-phone, input[placeholder*="whatsapp" i]').first();
      if (await phoneInput.isVisible()) await phoneInput.fill('11999998888');

      const continueToPay = page.locator('button:has-text("Continuar para pagamento")').first();
      if (await continueToPay.isVisible()) {
        await continueToPay.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-cart-payment-390-dark.png') });
        console.log('Saved artistic-flow-cart-payment-390-dark.png');
      }
    }

    // Close Cart
    const closeCartBtn = page.locator('#btn-close-cart').first();
    if (await closeCartBtn.isVisible()) {
      await closeCartBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // ==========================================
  // 2. Mobile Light (390x844)
  // ==========================================
  console.log('--- Step 2: Mobile Light ---');
  const lightContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const lightPage = await lightContext.newPage();
  await lightPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await lightPage.waitForSelector('text=Burger clássico artesanal', { timeout: 10000 });
  await lightPage.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-koma-theme', 'light');
    document.documentElement.setAttribute('data-cardapio-tone', 'light');
  });
  await lightPage.waitForTimeout(600);
  await lightPage.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-home-390-light.png') });
  console.log('Saved artistic-flow-home-390-light.png');

  // Light Product Modal
  const lightBurger = lightPage.locator('text=Burger clássico artesanal').first();
  await lightBurger.scrollIntoViewIfNeeded();
  await lightBurger.click();
  await lightPage.waitForTimeout(600);
  await lightPage.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-modal-390-light.png') });
  console.log('Saved artistic-flow-modal-390-light.png');

  // Add to cart in light mode & view cart
  const lightOptionPonto = lightPage.getByLabel('Selecionar Ao ponto (rosado e suculento)').first();
  if (await lightOptionPonto.isVisible()) {
    await lightOptionPonto.check();
    await lightPage.waitForTimeout(200);
  }
  const lightAddBtn = lightPage.locator('#btn-add-to-cart-action').first();
  if (await lightAddBtn.isVisible()) {
    await lightAddBtn.click();
    await lightPage.waitForTimeout(600);
    const lightOpenCart = lightPage.locator('.koma-art-dock-btn--bag, .koma-art-action-pill--cart').first();
    if (await lightOpenCart.isVisible()) {
      await lightOpenCart.click();
      await lightPage.waitForTimeout(800);
      await lightPage.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-cart-items-390-light.png') });
      console.log('Saved artistic-flow-cart-items-390-light.png');
    }
  }

  // ==========================================
  // 3. Desktop Dark (1280x800)
  // ==========================================
  console.log('--- Step 3: Desktop Dark ---');
  const deskContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  const deskPage = await deskContext.newPage();
  await deskPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await deskPage.waitForSelector('text=Burger clássico artesanal', { timeout: 10000 });
  await deskPage.waitForTimeout(600);
  await deskPage.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-home-1280-dark.png') });
  console.log('Saved artistic-flow-home-1280-dark.png');

  // ==========================================
  // 4. Empty Cart State
  // ==========================================
  console.log('--- Step 4: Empty Cart State ---');
  const emptyContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await emptyPage.waitForSelector('text=Burger clássico artesanal', { timeout: 10000 });
  await emptyPage.waitForTimeout(600);
  const emptyCartTrigger = emptyPage.locator('.koma-art-dock-btn--bag, .koma-art-action-pill--cart').first();
  if (await emptyCartTrigger.isVisible()) {
    await emptyCartTrigger.click();
    await emptyPage.waitForTimeout(600);
    await emptyPage.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-cart-empty-390-dark.png') });
    console.log('Saved artistic-flow-cart-empty-390-dark.png');
  }

  // ==========================================
  // 5. Mobile 360x780 Dark
  // ==========================================
  console.log('--- Step 5: Mobile 360x780 Dark ---');
  const mobile360Context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page360 = await mobile360Context.newPage();
  await page360.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page360.waitForSelector('text=Burger clássico artesanal', { timeout: 10000 });
  await page360.waitForTimeout(600);
  await page360.screenshot({ path: path.join(OUT_DIR, 'artistic-flow-home-360-dark.png') });
  console.log('Saved artistic-flow-home-360-dark.png');

  await browser.close();
  console.log('ALL SCREEN CAPTURES COMPLETE!');
}

main().catch(err => {
  console.error('Error running capture:', err);
  process.exit(1);
});
