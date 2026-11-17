import { describe, expect, it } from 'vitest';
import { cartReducer, cartTotal, maxCartQuantity } from './cart';
import type { Product } from './types';

const product: Product = { id: 1, name: 'Tazza', description: 'Una tazza', category: 'Casa', price: 12.5, image: '☕', stock: 3 };

describe('carrello', () => {
  it('aggiunge, incrementa e calcola il totale senza duplicare righe', () => {
    const first = cartReducer([], { type: 'add', product });
    const second = cartReducer(first, { type: 'add', product });
    expect(first[0].quantity).toBe(1);
    expect(second).toHaveLength(1);
    expect(second[0].quantity).toBe(2);
    expect(cartTotal(second)).toBe(25);
  });
  it('rispetta lo stock per aggiunte e quantità e rifiuta quantità invalide', () => {
    const state = [{ product, quantity: 3 }];
    expect(cartReducer(state, { type: 'add', product })[0].quantity).toBe(3);
    expect(cartReducer(state, { type: 'quantity', productId: 1, quantity: 100 })[0].quantity).toBe(3);
    for (const quantity of [0, -1, 1.5, NaN]) {
      expect(cartReducer(state, { type: 'quantity', productId: 1, quantity })).toEqual(state);
    }
    expect(cartReducer([], { type: 'add', product: { ...product, stock: 0 } })).toEqual([]);
  });
  it('modifica, rimuove e svuota il carrello', () => {
    const state = [{ product, quantity: 3 }];
    expect(cartReducer(state, { type: 'quantity', productId: 1, quantity: 1 })[0].quantity).toBe(1);
    expect(cartReducer(state, { type: 'remove', productId: 1 })).toEqual([]);
    expect(cartReducer(state, { type: 'clear' })).toEqual([]);
    expect(cartTotal([])).toBe(0);
  });
  it('limita ogni prodotto a min(20, stock), sia aggiungendo che modificando quantità', () => {
    const abundant = { ...product, stock: 50 };
    expect(maxCartQuantity(abundant)).toBe(20);
    expect(maxCartQuantity({ ...product, stock: 18 })).toBe(18);
    let state = [{ product: abundant, quantity: 1 }];
    for (let i = 0; i < 30; i++) state = cartReducer(state, { type: 'add', product: abundant });
    expect(state[0].quantity).toBe(20);
    expect(cartReducer(state, { type: 'quantity', productId: 1, quantity: 21 })[0].quantity).toBe(20);
    const limited = { ...product, stock: 18 };
    expect(cartReducer([{ product: limited, quantity: 1 }], { type: 'quantity', productId: 1, quantity: 20 })[0].quantity).toBe(18);
  });
});
