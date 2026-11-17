import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import axe from 'axe-core';
import type { Product, TelemetryConfig } from '../src/types';

async function catalog(page: Page): Promise<Product[]> {
  const response = page.waitForResponse(response => response.url().endsWith('/api/products'));
  await page.goto('/');
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const products: Product[] = await loaded.json();
  expect(products.length).toBeGreaterThan(0);
  await expect(page.locator('.product-card')).toHaveCount(products.length);
  return products;
}

test('filtri, dettagli e ordine reale demo conservano il journey senza PII', async ({ page }) => {
  const products = await catalog(page);
  const product = products.find(product => product.stock >= 2);
  expect(product, 'Il catalogo demo deve avere almeno un prodotto con stock >= 2').toBeDefined();
  if (!product) throw new Error('Nessun prodotto disponibile per il percorso E2E.');
  await page.getByRole('button', { name: product.category, exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(products.filter(item => item.category === product.category).length);
  await page.getByRole('link', { name: `Scopri ${product.name}`, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible();
  await page.locator(`[data-ai-id="product.add.${product.id}"]`).click();
  await page.getByRole('link', { name: 'Carrello, 1 prodotti' }).click();
  await page.getByRole('button', { name: `Aumenta quantità di ${product.name}`, exact: true }).click();
  await expect(page.getByLabel(`Quantità di ${product.name}`, { exact: true })).toHaveText('2');
  await page.locator('[data-ai-id="cart.checkout"]').click();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  const requestPromise = page.waitForRequest(request => request.url().endsWith('/api/orders') && request.method() === 'POST');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/orders'));
  await page.locator('[data-ai-id="checkout.submit"]').click();
  const request = await requestPromise;
  const body = request.postDataJSON();
  expect(body).toEqual({ items: [{ productId: product.id, quantity: 2 }], journeyId: expect.any(String) });
  expect(body.journeyId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(request.headers()['x-demo-journey']).toBe(body.journeyId);
  expect((await responsePromise).status()).toBe(201);
  await expect(page).toHaveURL(/\/success$/);
  await expect(page.locator('.order-receipt')).toContainText(`${product.name} × 2`);
  await expect(page.locator('.order-receipt code')).toHaveText(body.journeyId);
  await expect(page.getByRole('link', { name: 'Carrello, 0 prodotti' })).toBeVisible();
});

test('rimuove articoli e conserva l’accessibilità su desktop e mobile', async ({ page }) => {
  const products = await catalog(page);
  await page.locator('.telemetry-panel summary').click();
  await page.addScriptTag({ content: axe.source });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 960 });
    const results: axe.AxeResults = await page.evaluate('axe.run(document)');
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const product = products.find(product => product.stock > 0);
  if (!product) throw new Error('Nessun prodotto disponibile per il percorso E2E.');
  await page.locator(`[data-ai-id="catalog.add.${product.id}"]`).click();
  await page.getByRole('link', { name: 'Carrello, 1 prodotti' }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('button', { name: `Rimuovi ${product.name}`, exact: true }).click();
  await expect(page.getByText(/Il tuo carrello è vuoto/)).toBeVisible();
});

test('mostra il fallimento config senza applicare un fallback', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({
    status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Configurazione non disponibile' }),
  }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Nessuna configurazione di ripiego');
  await expect(page.getByRole('button', { name: 'Riprova', exact: true })).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(0);
});

test('rispetta demoFailureEnabled=false anche con telemetria disattivata', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ telemetryEnabled: false, applicationInsightsConnectionString: '', demoFailureEnabled: false }),
  }));
  let backendCalls = 0;
  page.on('request', request => { if (request.url().endsWith('/api/demo/failure')) backendCalls++; });
  await catalog(page);
  await page.locator('.telemetry-panel summary').click();
  await expect(page.getByRole('button', { name: 'Genera errore backend (500)' })).toBeDisabled();
  await expect(page.getByText(/generazione di errori backend è disabilitata/)).toBeVisible();
  await page.getByRole('button', { name: 'Genera errore browser gestito' }).click();
  await expect(page.getByText(/Errore browser gestito. Nessun invio/)).toBeVisible();
  expect(backendCalls).toBe(0);
});

test('genera HTTP 500 solo quando il server abilita il laboratorio', async ({ page }) => {
  const configResponse = page.waitForResponse(response => response.url().endsWith('/api/config'));
  await catalog(page);
  const config: TelemetryConfig = await (await configResponse).json();
  await page.locator('.telemetry-panel summary').click();
  const button = page.getByRole('button', { name: 'Genera errore backend (500)' });
  if (!config.demoFailureEnabled) {
    await expect(button).toBeDisabled();
    return;
  }
  const response = page.waitForResponse(response => response.url().endsWith('/api/demo/failure'));
  await button.click();
  expect((await response).status()).toBe(500);
  await expect(page.getByText(/HTTP 500 ricevuto come previsto/)).toBeVisible();
});

test('mostra ProblemDetails del catalogo e permette di riprovare', async ({ page }) => {
  await page.route('**/api/products', route => route.fulfill({
    status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Catalogo temporaneamente indisponibile' }),
  }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Catalogo temporaneamente indisponibile');
  await page.unroute('**/api/products');
  await page.getByRole('button', { name: 'Riprova a caricare' }).click();
  await expect(page.locator('.product-card').first()).toBeVisible();
});
