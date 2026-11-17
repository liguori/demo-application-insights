import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  construct: vi.fn(),
  load: vi.fn(),
  initializer: vi.fn(),
  page: vi.fn(),
  event: vi.fn(),
  exception: vi.fn(),
}));
vi.mock('@microsoft/applicationinsights-web', () => ({
  DistributedTracingModes: { W3C: 2 },
  ApplicationInsights: class {
    constructor(config: unknown) { sdk.construct(config); }
    loadAppInsights = sdk.load;
    addTelemetryInitializer = sdk.initializer;
    trackPageView = sdk.page;
    trackEvent = sdk.event;
    trackException = sdk.exception;
  },
}));
vi.mock('@microsoft/applicationinsights-react-js', () => ({ ReactPlugin: class { identifier = 'ReactPlugin'; } }));
vi.mock('@microsoft/applicationinsights-clickanalytics-js', () => ({ ClickAnalyticsPlugin: class { identifier = 'ClickAnalyticsPlugin'; } }));

beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
const configResponse = (telemetryEnabled: boolean, applicationInsightsConnectionString = 'InstrumentationKey=00000000-0000-4000-8000-000000000000') =>
  new Response(JSON.stringify({ telemetryEnabled, applicationInsightsConnectionString, demoFailureEnabled: true }), { status: 200 });

describe('bootstrap telemetria', () => {
  it('attende la configurazione prima di caricare SDK e correla tutte le chiamate', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn((_path: string, _options?: RequestInit) => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const telemetry = await import('./telemetry');
    const pending = telemetry.initializeTelemetry();
    expect(sdk.construct).not.toHaveBeenCalled();
    expect(sdk.load).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config');
    resolve(configResponse(true));
    expect(await pending).toEqual({ telemetryStatus: 'enabled', demoFailureEnabled: true });
    expect(sdk.load).toHaveBeenCalledOnce();
    const config = sdk.construct.mock.calls[0][0].config;
    expect(config).toMatchObject({
      enableAutoRouteTracking: false,
      enableUnhandledPromiseRejectionTracking: true,
      disableExceptionTracking: false,
      disableAjaxTracking: false,
      disableFetchTracking: false,
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      enableAjaxErrorStatusText: false,
      cookieCfg: { enabled: true },
      samplingPercentage: 100,
      distributedTracingMode: 2,
      enableAjaxPerfTracking: true,
    });
    expect(config.extensions).toHaveLength(2);
    expect(config.extensionConfig.ClickAnalyticsPlugin).toMatchObject({
      autoCapture: true,
      dropInvalidEvents: true,
      dataTags: { customDataPrefix: 'data-ai-', aiBlobAttributeTag: 'blob', useDefaultContentNameOrId: false, captureAllMetaDataContent: false, metaDataPrefix: 'app-market-telemetry-' },
    });
    const { journeyId } = await import('./api');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(headers.get('X-Demo-Journey')).toBe(journeyId);
    const envelope = { baseData: { properties: { original: true } } };
    sdk.initializer.mock.calls[0][0](envelope);
    expect(envelope).toMatchObject({ tags: { 'ai.cloud.role': 'app-market-web' }, baseData: { properties: { journeyId, original: true } }, data: { journeyId } });
    telemetry.trackPage('/products/1');
    telemetry.trackEvent('CartItemAdded', { productId: 1 });
    telemetry.trackHandledError(new Error('demo'), 'demo.browser');
    expect(sdk.page).toHaveBeenCalledOnce();
    expect(sdk.event).toHaveBeenCalledWith({ name: 'CartItemAdded' }, { productId: 1, journeyId });
    expect(sdk.exception.mock.calls[0][0].properties).toMatchObject({ source: 'demo.browser', handled: true, journeyId });
  });

  it.each([[false, 'test'], [true, ''], [true, '   ']])('disattiva senza caricare SDK (%s, %s)', async (enabled, connection) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(configResponse(enabled as boolean, connection as string)));
    const { initializeTelemetry, trackEvent } = await import('./telemetry');
    expect(await initializeTelemetry()).toEqual({ telemetryStatus: 'disabled', demoFailureEnabled: true });
    trackEvent('ignored');
    expect(sdk.construct).not.toHaveBeenCalled();
    expect(sdk.event).not.toHaveBeenCalled();
  });

  it('propaga errori HTTP della configurazione senza fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'Configurazione assente' }), { status: 503 })));
    const { initializeTelemetry } = await import('./telemetry');
    await expect(initializeTelemetry()).rejects.toThrow('Configurazione assente');
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it('rifiuta configurazioni malformate senza fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ telemetryEnabled: 'true' }), { status: 200 })));
    const { initializeTelemetry } = await import('./telemetry');
    await expect(initializeTelemetry()).rejects.toThrow('non è valida');
    expect(sdk.load).not.toHaveBeenCalled();
  });

  it('rimuove query, hash, referrer e header/body da pagine e dipendenze', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(configResponse(true)));
    const { initializeTelemetry, trackPage } = await import('./telemetry');
    await initializeTelemetry();
    const initialize = sdk.initializer.mock.calls[0][0];
    const page = {
      baseType: 'PageviewData',
      baseData: {
        uri: 'https://market.test/products/1?secret=query#private',
        properties: {
          refUri: 'https://previous.test/path?secret=ref#private',
          referrer: 'https://previous.test/path?secret=ref',
          nested: { requestUrl: '/api/products?secret=query#private' },
        },
      },
      tags: { 'ai.operation.name': '/products/1?secret=query#private' },
      ext: { trace: { name: '/products/1?secret=query#private' } },
    };
    const dependency = {
      baseType: 'RemoteDependencyData',
      baseData: {
        name: 'POST /api/orders?secret=query#private',
        data: 'https://market.test/api/orders?secret=query#private',
        target: 'market.test?secret=query',
        properties: {
          requestHeaders: { Authorization: 'private-header' },
          responseHeaders: { 'X-Private': 'private-header' },
          requestBody: 'private-body',
          responseBody: 'private-body',
          responseText: 'private-body',
          ajaxPerf: { duration: 10, serverTiming: { private: { description: 'private-header' } } },
          HttpMethod: 'POST',
        },
      },
    };
    initialize(page);
    initialize(dependency);
    expect(page.baseData.uri).toBe('https://market.test/products/1');
    expect(page.baseData.properties).toMatchObject({
      refUri: 'https://previous.test/path',
      referrer: 'https://previous.test/path',
      nested: { requestUrl: '/api/products' },
    });
    expect(dependency.baseData).toMatchObject({
      name: 'POST /api/orders', data: 'https://market.test/api/orders', target: 'market.test',
    });
    expect(dependency.baseData.properties).toMatchObject({ HttpMethod: 'POST' });
    expect(JSON.stringify([page, dependency])).not.toMatch(/secret|private/);
    trackPage('/products/1?secret=query#private');
    expect(sdk.page).toHaveBeenCalledWith({ name: '/products/1', uri: `${location.origin}/products/1` });
  });
});
