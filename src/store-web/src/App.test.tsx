import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { App } from './App';
import { journeyId } from './api';
import { trackEvent, trackHandledError, trackPage } from './telemetry';
import type { Product } from './types';

vi.mock('./telemetry', () => ({
  reactPlugin: {},
  trackEvent: vi.fn(),
  trackPage: vi.fn(),
  trackHandledError: vi.fn(),
}));

const products: Product[] = [
  { id: 1, name: 'Tazza Alba', description: 'Un piccolo rituale quotidiano.', category: 'Casa', price: 18, image: '☕', stock: 3 },
  { id: 2, name: 'Taccuino Verde', description: 'Spazio alle idee.', category: 'Accessori', price: 12, image: 'notebook', stock: 2 },
  { id: 3, name: 'Vaso Sole', description: 'Un vaso speciale.', category: 'Casa', price: 25, image: '🏺', stock: 0 },
];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  history.replaceState({}, '', '/');
  vi.clearAllMocks();
  fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/products') return json(products);
    if (path === '/api/products/1') return json(products[0]);
    if (path === '/api/demo/failure') return json({ title: 'Errore intenzionale', status: 500 }, 500);
    if (path === '/api/orders') return json({ id: 'demo-001', createdAt: '2026-01-01T12:00:00Z', total: 36, items: [{ productId: 1, name: 'Tazza Alba', quantity: 2, unitPrice: 18 }], journeyId }, 201);
    return json({ title: 'Non trovato' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('esperienza del mercato', () => {
  it('filtra categorie, mostra dettagli e traccia una sola page view per navigazione', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="disabled" />);
    await screen.findByText('Tazza Alba');
    expect(screen.getByText(/Telemetria disattivata:/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aggiungi Vaso Sole al carrello' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Accessori' }));
    expect(screen.queryByText('Tazza Alba')).not.toBeInTheDocument();
    expect(screen.getByText('Taccuino Verde')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tutti' }));
    await user.click(screen.getByRole('link', { name: 'Scopri Tazza Alba' }));
    await screen.findByRole('heading', { name: 'Tazza Alba', level: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/products/1', expect.anything());
    expect(trackEvent).toHaveBeenCalledWith('ProductViewed', { productId: 1, category: 'Casa' });
    expect(trackPage).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: /Aggiungi al carrello/ }));
    expect(screen.getByRole('link', { name: 'Carrello, 1 prodotti' })).toBeVisible();
    expect(trackPage).toHaveBeenCalledTimes(2);
  });

  it('completa carrello e checkout senza PII, con ordine correlato', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="enabled" />);
    await user.click(await screen.findByRole('button', { name: 'Aggiungi Tazza Alba al carrello' }));
    await user.click(screen.getByRole('link', { name: 'Carrello, 1 prodotti' }));
    await user.click(screen.getByRole('button', { name: 'Aumenta quantità di Tazza Alba' }));
    expect(screen.getByLabelText('Quantità di Tazza Alba')).toHaveTextContent('2');
    await user.click(screen.getByRole('link', { name: /Vai al checkout demo/ }));
    expect(screen.getByText(/non chiediamo nome, email/)).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Conferma ordine fittizio/ }));
    await screen.findByRole('heading', { name: 'Ordine demo-001' });
    const call = fetchMock.mock.calls.find(call => call[0] === '/api/orders')!;
    expect(JSON.parse(call[1].body)).toEqual({ items: [{ productId: 1, quantity: 2 }], journeyId });
    expect(call[1].headers.get('X-Demo-Journey')).toBe(journeyId);
    expect(screen.getByRole('link', { name: 'Carrello, 0 prodotti' })).toBeVisible();
    expect(trackEvent).toHaveBeenCalledWith('CheckoutCompleted', { orderId: 'demo-001', total: 36 });
  });

  it('rimuove prodotti e presenta lo stato vuoto', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="disabled" />);
    await user.click(await screen.findByRole('button', { name: 'Aggiungi Tazza Alba al carrello' }));
    await user.click(screen.getByRole('link', { name: 'Carrello, 1 prodotti' }));
    expect(screen.getByRole('button', { name: 'Riduci quantità di Tazza Alba' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Rimuovi Tazza Alba' }));
    expect(screen.getByText(/Il tuo carrello è vuoto/)).toBeVisible();
  });

  it('disabilita incrementi e aggiunte al limite server di 20 pezzi', async () => {
    fetchMock.mockResolvedValue(json([{ ...products[0], stock: 50 }]));
    const user = userEvent.setup();
    render(<App telemetryStatus="disabled" />);
    await user.click(await screen.findByRole('button', { name: 'Aggiungi Tazza Alba al carrello' }));
    await user.click(screen.getByRole('link', { name: 'Carrello, 1 prodotti' }));
    const increment = screen.getByRole('button', { name: 'Aumenta quantità di Tazza Alba' });
    for (let i = 1; i < 20; i++) await user.click(increment);
    expect(screen.getByLabelText('Quantità di Tazza Alba')).toHaveTextContent('20');
    expect(increment).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'La selezione' }));
    expect(screen.getByRole('button', { name: 'Aggiungi Tazza Alba al carrello' })).toBeDisabled();
  });

  it('mantiene il carrello quando il checkout fallisce e permette di riprovare', async () => {
    fetchMock.mockImplementation(async (path: string) => path === '/api/orders' ? json({ title: 'Stock insufficiente', detail: 'La quantità non è più disponibile.' }, 409) : json(products));
    const user = userEvent.setup();
    render(<App telemetryStatus="enabled" />);
    await user.click(await screen.findByRole('button', { name: 'Aggiungi Tazza Alba al carrello' }));
    await user.click(screen.getByRole('link', { name: 'Carrello, 1 prodotti' }));
    await user.click(screen.getByRole('link', { name: /Vai al checkout demo/ }));
    await user.click(screen.getByRole('button', { name: /Conferma ordine fittizio/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La quantità non è più disponibile.');
    expect(screen.getByRole('link', { name: 'Carrello, 1 prodotti' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Conferma ordine fittizio/ })).toBeEnabled();
  });

  it('mostra errori del catalogo e ricarica esplicitamente', async () => {
    fetchMock.mockResolvedValueOnce(json({ title: 'Mercato non disponibile' }, 503));
    const user = userEvent.setup();
    render(<App telemetryStatus="disabled" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Mercato non disponibile');
    await user.click(screen.getByRole('button', { name: 'Riprova a caricare' }));
    expect(await screen.findByText('Tazza Alba')).toBeVisible();
  });

  it('genera un errore browser gestito e una vera dipendenza backend fallita', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="enabled" demoFailureEnabled />);
    await screen.findByText('Tazza Alba');
    await user.click(screen.getByText('Laboratorio di telemetria'));
    await user.click(screen.getByRole('button', { name: 'Genera errore browser gestito' }));
    expect(trackHandledError).toHaveBeenCalledWith(expect.any(Error), 'demo.browser');
    await user.click(screen.getByRole('button', { name: 'Genera errore backend (500)' }));
    expect(await screen.findByText(/HTTP 500 ricevuto come previsto/)).toBeVisible();
    expect(fetchMock.mock.calls.find(call => call[0] === '/api/demo/failure')![1].headers.get('X-Demo-Journey')).toBe(journeyId);
  });

  it('disabilita la generazione di errori backend quando il flag è falso', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="enabled" demoFailureEnabled={false} />);
    await screen.findByText('Tazza Alba');
    await user.click(screen.getByText('Laboratorio di telemetria'));
    const button = screen.getByRole('button', { name: 'Genera errore backend (500)' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(fetchMock.mock.calls.some(call => call[0] === '/api/demo/failure')).toBe(false);
    expect(screen.getByText(/generazione di errori backend è disabilitata/)).toBeVisible();
  });

  it('offre landmark, etichette e controlli accessibili su catalogo e carrello', async () => {
    const user = userEvent.setup();
    render(<App telemetryStatus="disabled" />);
    await screen.findByText('Tazza Alba');
    await user.click(screen.getByText('Laboratorio di telemetria'));
    const options = { rules: { 'color-contrast': { enabled: false } } };
    expect((await axe.run(document, options)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Aggiungi Tazza Alba al carrello' }));
    await user.click(screen.getByRole('link', { name: 'Carrello, 1 prodotti' }));
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent('Le tue belle cose.');
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    expect((await axe.run(document, options)).violations).toEqual([]);
  });
});
