import type { TelemetryConfig } from './types';

function sessionJourney(): string {
  try {
    const saved = sessionStorage.getItem('app-market-journey');
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem('app-market-journey', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const journeyId = sessionJourney();

export class ApiError extends Error {
  constructor(public status: number, public title: string, detail?: string) {
    super(detail || title);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Demo-Journey', journeyId);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Connessione non disponibile', 'Non riusciamo a raggiungere il mercato. Controlla la connessione e riprova.');
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { title?: string; detail?: string };
    throw new ApiError(response.status, problem.title || 'Richiesta non riuscita', problem.detail);
  }
  return response.json() as Promise<T>;
}

export async function fetchConfig(): Promise<TelemetryConfig> {
  const config = await api<unknown>('/api/config');
  if (!config || typeof config !== 'object' ||
    !('telemetryEnabled' in config) || typeof config.telemetryEnabled !== 'boolean' ||
    !('demoFailureEnabled' in config) || typeof config.demoFailureEnabled !== 'boolean' ||
    !('applicationInsightsConnectionString' in config) || typeof config.applicationInsightsConnectionString !== 'string') {
    throw new Error('La configurazione ricevuta dal server non è valida.');
  }
  return config as TelemetryConfig;
}
