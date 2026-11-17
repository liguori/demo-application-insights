export interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  stock: number;
}

export interface Order {
  id: string;
  createdAt: string;
  total: number;
  items: { productId: number; name: string; quantity: number; unitPrice: number }[];
  journeyId: string;
}

export interface TelemetryConfig {
  applicationInsightsConnectionString: string;
  telemetryEnabled: boolean;
  demoFailureEnabled: boolean;
}

export const money = (value: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value);
