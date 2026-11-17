import type { Product } from './types';

export interface CartItem { product: Product; quantity: number }
export const maxCartQuantity = (product: Product) => Math.min(20, product.stock);
export type CartAction =
  | { type: 'add'; product: Product }
  | { type: 'quantity'; productId: number; quantity: number }
  | { type: 'remove'; productId: number }
  | { type: 'clear' };

export function cartReducer(state: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case 'add': {
      if (action.product.stock < 1) return state;
      const existing = state.find(item => item.product.id === action.product.id);
      return existing
        ? state.map(item => item.product.id === action.product.id
          ? { product: action.product, quantity: Math.min(item.quantity + 1, maxCartQuantity(action.product)) } : item)
        : [...state, { product: action.product, quantity: 1 }];
    }
    case 'quantity':
      if (!Number.isInteger(action.quantity) || action.quantity < 1) return state;
      return state.map(item => item.product.id === action.productId
        ? { ...item, quantity: Math.min(action.quantity, maxCartQuantity(item.product)) } : item);
    case 'remove': return state.filter(item => item.product.id !== action.productId);
    case 'clear': return [];
  }
}

export const cartTotal = (items: CartItem[]) =>
  items.reduce((total, item) => total + item.product.price * item.quantity, 0);
