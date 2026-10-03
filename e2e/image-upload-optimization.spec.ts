import {expect, test} from '@playwright/test';

test('large camera images are reduced before the authenticated multipart upload', async ({page}) => {
  await page.goto('/e2e/fixtures/image-upload.html');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 123;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = seed & 255; pixels.data[i+1] = (seed >>> 8) & 255;
      pixels.data[i+2] = (seed >>> 16) & 255; pixels.data[i+3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    return await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
  });
  const source = Buffer.from(bytes, 'base64');
  expect(source.length).toBeGreaterThan(5 * 1024 * 1024);
  let sentBytes = 0;
  await page.route('**/api/cardapio-digital/assets/banner', async route => {
    const request = route.request(); const body = request.postDataBuffer()!;
    sentBytes = body.length;
    expect(body.toString('latin1')).toContain('Content-Type: image/webp');
    expect(body.includes(Buffer.from('WEBP'))).toBeTruthy();
    await route.fulfill({json: {banner_url: 'https://mock.local/banner.webp'}});
  });
  await page.locator('input[type=file]').setInputFiles({name: 'camera.png', mimeType: 'image/png', buffer: source});
  await expect(page.getByText('Imagem atualizada e publicada.')).toBeVisible();
  expect(sentBytes).toBeLessThan(5 * 1024 * 1024);
  expect(sentBytes).toBeLessThan(source.length / 3);
});

test('logos retain transparent pixels and never upscale', async ({page}) => {
  await page.goto('/e2e/fixtures/image-upload.html');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(400, 100, 400, 400);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const prepare = (window as unknown as {prepareImageUpload: (file: File, kind: string) => Promise<File>}).prepareImageUpload;
    const output = await prepare(new File([blob], 'logo.png', {type: 'image/png'}), 'logo');
    const bitmap = await createImageBitmap(output);
    const decoded = document.createElement('canvas'); decoded.width = bitmap.width; decoded.height = bitmap.height;
    const dctx = decoded.getContext('2d')!; dctx.drawImage(bitmap, 0, 0);
    return {width: bitmap.width, height: bitmap.height, alpha: dctx.getImageData(0,0,1,1).data[3], size: output.size, source: blob.size};
  });
  // Very small lossless input may be kept unchanged to avoid making the request larger.
  expect(result.width <= 512 || result.size === result.source).toBeTruthy();
  expect(result.width / result.height).toBe(2);
  expect(result.alpha).toBe(0);
});

test('corrupt files fail visibly without a Storage upload', async ({page}) => {
  let requests = 0;
  await page.route('**/api/cardapio-digital/assets/**', route => {requests += 1; return route.abort();});
  await page.goto('/e2e/fixtures/image-upload.html');
  await page.locator('input[type=file]').setInputFiles({name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>')});
  await expect(page.getByText('O conteúdo do arquivo não corresponde ao formato informado.')).toBeVisible();
  expect(requests).toBe(0);
});
