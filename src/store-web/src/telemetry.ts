import { ApplicationInsights, DistributedTracingModes } from '@microsoft/applicationinsights-web';
import { ReactPlugin } from '@microsoft/applicationinsights-react-js';
import { ClickAnalyticsPlugin } from '@microsoft/applicationinsights-clickanalytics-js';
import { fetchConfig, journeyId } from './api';

export type TelemetryStatus = 'enabled' | 'disabled';
export interface BootstrapSettings {
  telemetryStatus: TelemetryStatus;
  demoFailureEnabled: boolean;
}
export const reactPlugin = new ReactPlugin();
let client: ApplicationInsights | undefined;

const stripQueryAndHash = (value: string) => value.split(/[?#]/, 1)[0];

function sanitizeTechnicalFields(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(sanitizeTechnicalFields);
    return;
  }
  const fields = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(fields)) {
    if (/^(?:(?:request|response)?(?:headers|body)|responseText|serverTiming)$/i.test(key)) {
      delete fields[key];
    } else if (typeof entry === 'string' && /(?:url|uri|referrer|referer)$/i.test(key)) {
      fields[key] = stripQueryAndHash(entry);
    } else {
      sanitizeTechnicalFields(entry);
    }
  }
}

export async function initializeTelemetry(): Promise<BootstrapSettings> {
  const config = await fetchConfig();
  if (!config.telemetryEnabled || !config.applicationInsightsConnectionString.trim()) {
    return { telemetryStatus: 'disabled', demoFailureEnabled: config.demoFailureEnabled };
  }
  const clicks = new ClickAnalyticsPlugin();
  client = new ApplicationInsights({
    config: {
      connectionString: config.applicationInsightsConnectionString,
      extensions: [reactPlugin, clicks],
      extensionConfig: {
        [clicks.identifier]: {
          autoCapture: true,
          dropInvalidEvents: true,
          dataTags: {
            customDataPrefix: 'data-ai-',
            aiBlobAttributeTag: 'blob',
            useDefaultContentNameOrId: false,
            captureAllMetaDataContent: false,
            metaDataPrefix: 'app-market-telemetry-',
          },
        },
      },
      // Page views are emitted by the SPA router, never by a second history listener.
      enableAutoRouteTracking: false,
      enableUnhandledPromiseRejectionTracking: true,
      disableExceptionTracking: false,
      disableAjaxTracking: false,
      disableFetchTracking: false,
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      enableAjaxErrorStatusText: false,
      cookieCfg: { enabled: true },
      distributedTracingMode: DistributedTracingModes.W3C,
      enableCorsCorrelation: false,
      samplingPercentage: 100,
      enableAjaxPerfTracking: true,
      disablePageUnloadEvents: [],
    },
  });
  client.addTelemetryInitializer((item) => {
    sanitizeTechnicalFields(item);
    const trace = item.ext?.trace;
    if (trace && typeof trace.name === 'string') {
      trace.name = stripQueryAndHash(trace.name);
    }
    if (item.baseType === 'RemoteDependencyData' && item.baseData) {
      for (const key of ['name', 'data', 'target']) {
        if (typeof item.baseData[key] === 'string') {
          item.baseData[key] = stripQueryAndHash(item.baseData[key]);
        }
      }
    }
    item.tags = item.tags || [];
    if (typeof item.tags['ai.operation.name'] === 'string') {
      item.tags['ai.operation.name'] = stripQueryAndHash(item.tags['ai.operation.name']);
    }
    item.tags['ai.cloud.role'] = 'app-market-web';
    item.baseData = item.baseData || {};
    item.baseData.properties = { ...item.baseData.properties, journeyId };
    item.data = { ...item.data, journeyId };
  });
  client.loadAppInsights();
  return { telemetryStatus: 'enabled', demoFailureEnabled: config.demoFailureEnabled };
}

export function trackPage(path: string) {
  const route = stripQueryAndHash(path);
  client?.trackPageView({ name: route === '/' ? 'Catalogo' : route, uri: `${location.origin}${route}` });
}

export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}) {
  client?.trackEvent({ name }, { ...properties, journeyId });
}

export function trackHandledError(error: Error, source: string) {
  client?.trackException({ exception: error, properties: { source, handled: true, journeyId } });
}
