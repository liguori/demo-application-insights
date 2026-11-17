import { expect, test } from '@playwright/test';
import type { Product } from '../src/types';

interface Envelope {
  tags: Record<string, string>;
  data: {
    baseType: string;
    baseData: {
      name?: string;
      uri?: string;
      url?: string;
      data?: string;
      resultCode?: string;
      success?: boolean;
      properties?: Record<string, unknown>;
    };
  };
}

test('SDK reale: privacy payload, clic espliciti, eccezioni, prestazioni e correlazione W3C', async ({ page, baseURL, context }) => {
  test.setTimeout(45_000);
  if (!baseURL) throw new Error('PLAYWRIGHT_BASE_URL deve essere configurato.');
  const origin = new URL(baseURL).origin;
  const envelopes: Envelope[] = [];
  const dependencies: { path: string; journey?: string; traceparent?: string }[] = [];
  const canaries = ['CANARY_QUERY', 'CANARY_HASH', 'CANARY_REFERRER', 'CANARY_FORM_TEXT', 'CANARY_HEADER', 'CANARY_BODY', 'CANARY_RESPONSE'];

  await page.route('**/api/config', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      telemetryEnabled: true,
      demoFailureEnabled: true,
      applicationInsightsConnectionString: `InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=${origin}/__telemetry`,
    }),
  }));
  await page.route('**/__telemetry/v2/track', async route => {
    const batch: Envelope[] = JSON.parse(route.request().postData() || '[]');
    envelopes.push(...batch);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ itemsReceived: batch.length, itemsAccepted: batch.length, errors: [] }),
    });
  });
  await page.route('**/api/demo/failure', route => route.fulfill({
    status: 500, contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Errore controllato dal test SDK', status: 500 }),
  }));
  await page.route('**/api/privacy-probe**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'X-Demo-Private': 'CANARY_RESPONSE', 'Server-Timing': 'privacy;desc="CANARY_RESPONSE"' },
    body: JSON.stringify({ test: 'CANARY_RESPONSE' }),
  }));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && path !== '/api/config') {
      dependencies.push({
        path,
        journey: request.headers()['x-demo-journey'],
        traceparent: request.headers().traceparent,
      });
    }
  });

  const catalogResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products');
  await page.goto('/?test=CANARY_QUERY#CANARY_HASH', { referer: `${origin}/previous?test=CANARY_REFERRER` });
  const products: Product[] = await (await catalogResponse).json();
  const product = products.find(item => item.stock > 0);
  if (!product) throw new Error('Il test SDK richiede un prodotto disponibile.');
  await expect(page.getByText(/Demo: la telemetria parte automaticamente/)).toBeVisible();
  await page.getByRole('link', { name: `Scopri ${product.name}`, exact: true }).click();
  await page.locator(`[data-ai-id="product.add.${product.id}"]`).click();
  await page.locator('.telemetry-panel summary').click();
  const journey = await page.locator('.journey code').textContent();
  expect(journey).toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByRole('button', { name: 'Genera errore browser gestito' }).click();
  await page.getByRole('button', { name: 'Genera errore backend (500)' }).click();
  await expect(page.getByText(/HTTP 500 ricevuto come previsto/)).toBeVisible();

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Campo sintetico privacy E2E');
    document.body.appendChild(input);
    const button = document.createElement('button');
    button.textContent = 'CANARY_FORM_TEXT';
    document.body.appendChild(button);
  });
  await page.getByRole('textbox', { name: 'Campo sintetico privacy E2E' }).fill('CANARY_FORM_TEXT');
  await page.getByRole('button', { name: 'CANARY_FORM_TEXT', exact: true }).click();
  await page.evaluate(async journeyId => {
    await fetch('/api/privacy-probe?test=CANARY_QUERY#CANARY_HASH', {
      method: 'POST',
      headers: { 'X-Demo-Journey': journeyId || '', 'X-Demo-Private': 'CANARY_HEADER' },
      body: 'CANARY_BODY',
    });
    void Promise.reject(new Error('Errore promise sintetico E2E'));
  }, journey);

  await expect.poll(() => envelopes.filter(item => item.data.baseType === 'ExceptionData').length, { timeout: 25_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => envelopes.some(item => item.data.baseData.name === 'POST /api/privacy-probe'), { timeout: 10_000 }).toBe(true);
  const pages = envelopes.filter(item => item.data.baseType === 'PageviewData');
  expect(pages.map(item => item.data.baseData.name)).toEqual(['Catalogo', `/products/${product.id}`]);
  expect(pages.map(item => item.data.baseData.url)).toEqual([`${origin}/`, `${origin}/products/${product.id}`]);
  expect(envelopes.some(item => item.data.baseType === 'PageviewPerformanceData')).toBe(true);
  expect(envelopes.some(item => item.data.baseData.name === 'CartItemAdded')).toBe(true);
  expect(envelopes.some(item => item.data.baseData.name === 'ProductViewed')).toBe(true);
  expect(envelopes.some(item =>
    item.data.baseData.name === `product.add.${product.id}` &&
    String(item.data.baseData.properties?.content).includes(`"contentName":"product.add.${product.id}"`),
  )).toBe(true);
  expect(envelopes.some(item =>
    item.data.baseType === 'RemoteDependencyData' &&
    item.data.baseData.name === 'GET /api/demo/failure' &&
    item.data.baseData.success === false &&
    String(item.data.baseData.resultCode) === '500',
  )).toBe(true);
  expect(envelopes.some(item =>
    item.data.baseType === 'ExceptionData' && item.data.baseData.properties?.source === 'demo.browser',
  )).toBe(true);
  for (const item of envelopes) {
    expect(item.tags['ai.cloud.role']).toBe('app-market-web');
    expect(item.data.baseData.properties?.journeyId).toBe(journey);
  }
  expect(dependencies.length).toBeGreaterThanOrEqual(4);
  for (const request of dependencies) {
    expect(request.journey).toBe(journey);
    expect(request.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  }
  const payload = JSON.stringify(envelopes);
  for (const canary of canaries) expect(payload).not.toContain(canary);
  const cookies = await context.cookies();
  expect(cookies.map(cookie => cookie.name)).toEqual(expect.arrayContaining(['ai_user', 'ai_session']));
});
