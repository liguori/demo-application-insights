import { useEffect, useReducer, useRef, useState } from 'react';
import { AppInsightsContext } from '@microsoft/applicationinsights-react-js';
import { api, ApiError, journeyId } from './api';
import { cartReducer, cartTotal, maxCartQuantity } from './cart';
import { Link, navigate, usePath } from './router';
import { reactPlugin, trackEvent, trackHandledError, trackPage } from './telemetry';
import type { TelemetryStatus } from './telemetry';
import type { CartItem } from './cart';
import { money } from './types';
import type { Order, Product } from './types';

const tag = (id: string) => ({
  'data-ai-id': id,
  'data-ai-contentname': id,
  'data-ai-blob': JSON.stringify({ id, contentName: id }),
});
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Qualcosa non ha funzionato. Riprova.';

function ProductArt({ product, large = false }: { product: Product; large?: boolean }) {
  const images: Record<string, string> = { mug: '☕', coffee: '☕', vase: '🏺', lamp: '💡', notebook: '📓', bag: '👜', backpack: '🎒', keyboard: '⌨️', bottle: '🥤', tote: '👜', plant: '🪴', candle: '🕯️', headphones: '🎧', tshirt: '👕', book: '📚', blanket: '🧶' };
  const image = /\p{Extended_Pictographic}/u.test(product.image)
    ? product.image : Object.entries(images).find(([key]) => product.image.toLowerCase().includes(key))?.[1] || '✦';
  return <div className={`product-art art-${product.id % 5} ${large ? 'large' : ''}`} aria-hidden="true">
    <span className="art-circle" /><span className="product-emoji">{image}</span>
    <span className="art-label">APP MARKET / SELEZIONE {String(product.id).padStart(2, '0')}</span>
  </div>;
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}

function TelemetryPanel({ status, demoFailureEnabled }: { status: TelemetryStatus; demoFailureEnabled: boolean }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  function browserError() {
    try {
      throw new Error('App Market: errore browser gestito, generato intenzionalmente.');
    } catch (error) {
      trackHandledError(error as Error, 'demo.browser');
      setMessage(status === 'enabled' ? 'Errore browser gestito e inviato alla telemetria. Il mercato continua a funzionare.' : 'Errore browser gestito. Nessun invio: telemetria disattivata.');
    }
  }
  async function backendError() {
    if (!demoFailureEnabled) {
      setMessage('La generazione di errori backend è disabilitata dalla configurazione del server.');
      return;
    }
    setBusy(true);
    setMessage('');
    trackEvent('DemoBackendFailureRequested');
    try {
      await api('/api/demo/failure');
      setMessage('Il server ha risposto senza errore: questo endpoint dovrebbe restituire HTTP 500.');
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 500
        ? 'HTTP 500 ricevuto come previsto. La dipendenza fallita è correlata al journey corrente.'
        : `Risposta inattesa: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }
  return <details className="telemetry-panel">
    <summary {...tag('telemetry.toggle')}><span className={`status-dot ${status}`} /> Laboratorio di telemetria <span className="summary-hint">Segui il viaggio ↗</span></summary>
    <div className="telemetry-body">
      <div><h3>Un acquisto finto. Segnali veri.</h3><p>Ogni chiamata API porta lo stesso <code>X-Demo-Journey</code>. Esplora pagine, clic, prestazioni, dipendenze ed errori correlati.</p></div>
      <div className="journey"><span>JOURNEY DI QUESTA SESSIONE</span><code>{journeyId}</code></div>
      <p className="privacy">Nessun keylogging o session replay. Nessuna acquisizione del testo dei moduli, dei body o degli header HTTP: solo etichette di clic esplicite e dati tecnici. Query e frammenti degli URL, anche del referrer, vengono rimossi dalla telemetria. I cookie SDK usano ID anonimi casuali. Non inserire dati personali; questa demo non li richiede.</p>
      <div className="button-row">
        <button className="button secondary small" onClick={browserError} {...tag('demo.browser-error')}>Genera errore browser gestito</button>
        <button className="button secondary small" disabled={busy || !demoFailureEnabled} aria-describedby={!demoFailureEnabled ? 'backend-demo-disabled' : undefined} onClick={backendError} {...tag('demo.backend-error')}>{busy ? 'Chiamata in corso…' : 'Genera errore backend (500)'}</button>
      </div>
      {!demoFailureEnabled && <p id="backend-demo-disabled" className="privacy">La generazione di errori backend è disabilitata dalla configurazione del server.</p>}
      {message && <Notice>{message}</Notice>}
    </div>
  </details>;
}

function ProductDetail({ id, add, items }: { id: number; add: (product: Product) => void; items: CartItem[] }) {
  const [product, setProduct] = useState<Product>();
  const [error, setError] = useState('');
  const [attempt, retry] = useReducer(n => n + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    setProduct(undefined);
    setError('');
    api<Product>(`/api/products/${id}`, { signal: controller.signal }).then(value => {
      setProduct(value);
      trackEvent('ProductViewed', { productId: value.id, category: value.category });
    }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [id, attempt]);
  if (error) return <section className="section"><h1>Questo prodotto si fa attendere</h1><Notice error>{error}</Notice><button className="button secondary" onClick={retry} {...tag('product.retry')}>Riprova</button><Link className="text-link" href="/">Torna al catalogo</Link></section>;
  if (!product) return <div className="loading" role="status">Prepariamo i dettagli…</div>;
  const inCart = items.find(item => item.product.id === id)?.quantity || 0;
  return <section className="section">
    <Link className="text-link back-link" href="/" {...tag('product.back')}>← Tutta la selezione</Link>
    <div className="detail-grid">
      <ProductArt product={product} large />
      <div className="detail-copy"><span className="eyebrow">{product.category}</span><h1>{product.name}</h1><p className="detail-description">{product.description}</p>
        <p className="detail-price">{money(product.price)}</p>
        <p className="stock">{product.stock > 0 ? `${product.stock} disponibili · massimo ${maxCartQuantity(product)} per ordine · ${inCart} nel carrello` : 'Momentaneamente esaurito'}</p>
        <button className="button" disabled={inCart >= maxCartQuantity(product)} onClick={() => add(product)} {...tag(`product.add.${id}`)}>{inCart >= maxCartQuantity(product) ? 'Limite quantità raggiunto' : 'Aggiungi al carrello'} <span aria-hidden="true">↗</span></button>
        <div className="detail-note"><span aria-hidden="true">✧</span><div><strong>Solo il piacere di provare.</strong><p>Nessun pagamento, nessuna spedizione. Questo è un prodotto di un negozio dimostrativo.</p></div></div>
      </div>
    </div>
  </section>;
}

export function App({ telemetryStatus, demoFailureEnabled = false }: { telemetryStatus: TelemetryStatus; demoFailureEnabled?: boolean }) {
  const path = usePath();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [attempt, retry] = useReducer(n => n + 1, 0);
  const [category, setCategory] = useState('Tutti');
  const [items, dispatch] = useReducer(cartReducer, []);
  const [notice, setNotice] = useState('');
  const [order, setOrder] = useState<Order>();
  const [orderError, setOrderError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef<string | undefined>(undefined);
  const total = cartTotal(items);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    if (previousPath.current === path) return;
    const initial = previousPath.current === undefined;
    previousPath.current = path;
    trackPage(path);
    document.title = `${path === '/' ? 'La selezione' : path === '/cart' ? 'Carrello' : path === '/checkout' ? 'Checkout demo' : path === '/success' ? 'Ordine completato' : 'Scopri il mercato'} · App Market`;
    setNotice('');
    if (!initial) main.current?.focus();
    if (path === '/checkout') trackEvent('CheckoutStarted', { quantity: count, total });
  }, [path, count, total]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setCatalogError('');
    api<Product[]>('/api/products', { signal: controller.signal })
      .then(setProducts)
      .catch(error => { if (!controller.signal.aborted) setCatalogError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  function add(product: Product) {
    if ((items.find(item => item.product.id === product.id)?.quantity || 0) >= maxCartQuantity(product)) return;
    dispatch({ type: 'add', product });
    trackEvent('CartItemAdded', { productId: product.id, quantity: 1, unitPrice: product.price });
    setNotice(`${product.name} aggiunto al carrello.`);
  }

  async function checkout() {
    if (submittingRef.current || items.length === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    setOrderError('');
    trackEvent('CheckoutSubmitted', { quantity: count, total });
    try {
      const result = await api<Order>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ items: items.map(item => ({ productId: item.product.id, quantity: item.quantity })), journeyId }),
      });
      setOrder(result);
      dispatch({ type: 'clear' });
      trackEvent('CheckoutCompleted', { orderId: result.id, total: result.total });
      navigate('/success');
    } catch (error) {
      setOrderError(errorText(error));
      trackEvent('CheckoutFailed', { status: error instanceof ApiError ? error.status : 0 });
      trackHandledError(error instanceof Error ? error : new Error('Checkout failed'), 'checkout');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function changeQuantity(item: CartItem, quantity: number) {
    dispatch({ type: 'quantity', productId: item.product.id, quantity });
    trackEvent('CartQuantityChanged', { productId: item.product.id, quantity });
  }

  const categories = ['Tutti', ...new Set(products.map(product => product.category))];
  const filtered = products.filter(product => category === 'Tutti' || product.category === category);
  const productMatch = /^\/products\/(\d+)$/.exec(path);
  let page: React.ReactNode;

  if (path === '/') {
    page = <>
      <section className="hero">
        <div className="hero-copy"><span className="eyebrow"><span aria-hidden="true">✳</span> IL TUO QUOTIDIANO, UN PO’ PIÙ BELLO</span>
          <h1>Piccole cose.<br />Belle <em>storie.</em></h1>
          <p>Oggetti da scoprire, dettagli da amare.<br />Una selezione speciale, per curiosità autentiche.</p>
          <a href="#catalogo" className="button" {...tag('hero.catalog')}>Esplora la selezione <span aria-hidden="true">↗</span></a>
          <div className="hero-footnote"><span className="mini-stars" aria-hidden="true">✦ ✦ ✦</span> Fatto per esplorare. Senza acquistare davvero.</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit" /><div className="hero-stamp">COSE BELLE<br /><span>✳</span><br />BUONE STORIE</div>
          <div className="hero-card hero-card-back"><span>🪴</span><small>UN TOCCO DI VERDE</small></div>
          <div className="hero-card hero-card-front"><span>☕</span><small>IL TUO PICCOLO RITUALE</small></div>
          <span className="hero-spark spark-one">✧</span><span className="hero-spark spark-two">✳</span>
          <div className="hero-caption">La bellezza è nelle cose semplici. <span>↗</span></div>
        </div>
      </section>
      <div className="values-strip"><span><b aria-hidden="true">✧</b> Una selezione, infinite scoperte</span><span><b aria-hidden="true">◉</b> Zero pagamenti reali</span><span><b aria-hidden="true">↗</b> Ogni interazione racconta</span></div>
      <section className="section catalog" id="catalogo" aria-labelledby="catalog-title">
        <div className="section-heading"><div><span className="eyebrow">IL MERCATO DELLE POSSIBILITÀ</span><h2 id="catalog-title">Trova la tua prossima bella cosa.</h2></div><span className="result-count">{filtered.length} prodotti</span></div>
        <div className="filters" aria-label="Filtra per categoria">{categories.map(value =>
          <button key={value} aria-pressed={category === value} className={`filter ${category === value ? 'active' : ''}`} onClick={() => { setCategory(value); trackEvent('CatalogCategorySelected', { category: value }); }} {...tag(`catalog.category.${value}`)}>{value}</button>)}</div>
        {loading ? <div className="loading" role="status">Stiamo allestendo il mercato…</div> : catalogError ? <><Notice error>{catalogError}</Notice><button className="button secondary" onClick={retry} {...tag('catalog.retry')}>Riprova a caricare</button></> :
          filtered.length === 0 ? <Notice>La selezione è momentaneamente vuota. Torna presto a curiosare.</Notice> :
            <div className="product-grid">{filtered.map(product => {
              const full = (items.find(item => item.product.id === product.id)?.quantity || 0) >= maxCartQuantity(product);
              return <article className="product-card" key={product.id}>
                <Link href={`/products/${product.id}`} className="product-image-link" aria-label={`Scopri ${product.name}`} {...tag(`catalog.product.${product.id}`)}><ProductArt product={product} />{product.stock === 0 && <span className="sold-out">Esaurito</span>}</Link>
                <div className="product-info"><span className="product-category">{product.category}</span><div className="product-title-row"><h3><Link href={`/products/${product.id}`} {...tag(`catalog.title.${product.id}`)}>{product.name}</Link></h3><span className="price">{money(product.price)}</span></div>
                  <p>{product.description}</p><button className="add-button" disabled={full} aria-label={`Aggiungi ${product.name} al carrello`} onClick={() => add(product)} {...tag(`catalog.add.${product.id}`)}>{full ? 'Limite quantità raggiunto' : 'Aggiungi al carrello'}<span aria-hidden="true">+</span></button>
                </div>
              </article>;
            })}</div>}
      </section>
      <section className="story-banner"><span className="story-symbol" aria-hidden="true">✳</span><div><span className="eyebrow">DIETRO OGNI CLIC, UNA STORIA</span><h2>Un piccolo mercato.<br />Un mondo di connessioni.</h2><p>Questo negozio è una demo: i prodotti sono fittizi,<br />il viaggio dei dati è tutto da esplorare.</p></div><span className="story-arrow" aria-hidden="true">↗</span></section>
    </>;
  } else if (productMatch) {
    page = <ProductDetail key={productMatch[1]} id={Number(productMatch[1])} add={add} items={items} />;
  } else if (path === '/cart' || path === '/checkout') {
    page = <section className="section cart-page"><span className="eyebrow">IL TUO PICCOLO BOTTINO</span><h1>{path === '/cart' ? 'Le tue belle cose.' : 'L’ultimo passo, per finta.'}</h1>
      {items.length === 0 ? <div className="empty-state"><span aria-hidden="true">👜</span><h2>Qui c’è spazio per una bella scoperta.</h2><p>Il tuo carrello è vuoto. Inizia dalla nostra selezione.</p><Link href="/" className="button" {...tag('cart.empty.catalog')}>Esplora il catalogo ↗</Link></div> :
        <div className="cart-grid"><div>
          {path === '/checkout' && <Notice>Checkout dimostrativo: non chiediamo nome, email, indirizzo o carta. Non verrà effettuato alcun addebito né spedito alcun prodotto.</Notice>}
          <ul className="cart-list">{items.map(item => <li className="cart-item" key={item.product.id}>
            <ProductArt product={item.product} /><div className="cart-item-copy"><Link href={`/products/${item.product.id}`} {...tag(`cart.product.${item.product.id}`)}><h2>{item.product.name}</h2></Link><p>{money(item.product.price)} / pezzo</p>
              {path === '/cart' ? <div className="quantity-row"><div className="quantity-control" role="group" aria-label={`Quantità ${item.product.name}`}>
                <button disabled={item.quantity <= 1} aria-label={`Riduci quantità di ${item.product.name}`} onClick={() => changeQuantity(item, item.quantity - 1)} {...tag(`cart.decrease.${item.product.id}`)}>−</button><output aria-label={`Quantità di ${item.product.name}`}>{item.quantity}</output>
                <button disabled={item.quantity >= maxCartQuantity(item.product)} aria-label={`Aumenta quantità di ${item.product.name}`} onClick={() => changeQuantity(item, item.quantity + 1)} {...tag(`cart.increase.${item.product.id}`)}>+</button>
              </div><button className="remove-button" aria-label={`Rimuovi ${item.product.name}`} onClick={() => { dispatch({ type: 'remove', productId: item.product.id }); trackEvent('CartItemRemoved', { productId: item.product.id, quantity: item.quantity }); setNotice(`${item.product.name} rimosso dal carrello.`); }} {...tag(`cart.remove.${item.product.id}`)}>Rimuovi</button></div> : <p>Quantità: {item.quantity}</p>}
            </div><strong>{money(item.product.price * item.quantity)}</strong>
          </li>)}</ul>
          <Link href={path === '/cart' ? '/' : '/cart'} className="text-link" {...tag('cart.back')}>← {path === '/cart' ? 'Continua a esplorare' : 'Modifica il carrello'}</Link>
        </div><aside className="order-summary" aria-label="Riepilogo ordine"><h2>Il tuo riepilogo</h2><div><span>Prodotti ({count})</span><span>{money(total)}</span></div><div><span>Spedizione</span><span>Non prevista</span></div><div className="summary-total"><span>Totale demo</span><span>{money(total)}</span></div><p>Nessun costo reale. Solo un’esperienza da scoprire.</p>
          {orderError && <Notice error>{orderError}</Notice>}
          {path === '/cart' ? <Link href="/checkout" className="button" {...tag('cart.checkout')}>Vai al checkout demo ↗</Link> : <button className="button" disabled={submitting} onClick={checkout} {...tag('checkout.submit')}>{submitting ? 'Creazione ordine…' : 'Conferma ordine fittizio ↗'}</button>}
        </aside></div>}
    </section>;
  } else if (path === '/success') {
    page = <section className="section success-page">{order ? <>
      <div className="success-icon" aria-hidden="true">✓</div><span className="eyebrow">IL VIAGGIO CONTINUA</span><h1>Una bella storia,<br /><em>appena iniziata.</em></h1><p>Il tuo ordine dimostrativo è stato creato.<br />Nessun addebito, nessuna spedizione. Grazie per aver esplorato.</p>
      <div className="order-receipt"><h2>Ordine {order.id}</h2><p>{new Date(order.createdAt).toLocaleString('it-IT')}</p><ul>{order.items.map(item => <li key={item.productId}><span>{item.name} × {item.quantity}</span><strong>{money(item.unitPrice * item.quantity)}</strong></li>)}</ul><div className="receipt-total"><span>Totale demo</span><strong>{money(order.total)}</strong></div><span className="eyebrow">JOURNEY CORRELATO</span><code>{order.journeyId}</code></div>
      <Link className="button" href="/" {...tag('success.catalog')}>Ancora un po’ di curiosità ↗</Link>
    </> : <><h1>Ogni storia parte da una scoperta.</h1><p>Non ci sono ordini in questa visita. Gli ordini demo non vengono conservati nel browser dopo un aggiornamento.</p><Link className="button" href="/">Torna al mercato</Link></>}</section>;
  } else {
    page = <section className="section empty-state"><span className="eyebrow">404 · FUORI DAL MERCATO</span><h1>Questa strada non porta a uno scaffale.</h1><Link className="button" href="/" {...tag('notfound.catalog')}>Torna alla selezione</Link></section>;
  }

  return <AppInsightsContext.Provider value={reactPlugin}>
    <a href="#main-content" className="skip-link">Salta al contenuto</a>
    <div className="demo-ribbon" role="region" aria-label="Avviso negozio dimostrativo">UN NEGOZIO DEMO, UNA CURIOSITÀ REALE <span>·</span> Nessun acquisto o pagamento reale <span aria-hidden="true">↗</span></div>
    <header className="site-header"><Link className="brand" href="/" aria-label="App Market, pagina iniziale" {...tag('nav.home')}><span aria-hidden="true">✳</span> app<span className="brand-market">market</span><span className="brand-period">.</span></Link>
      <nav aria-label="Navigazione principale"><Link href="/" aria-current={path === '/' ? 'page' : undefined} {...tag('nav.catalog')}>La selezione</Link><a className="about-link" href="#about" {...tag('nav.about')}>Il progetto</a></nav>
      <Link className="cart-link" href="/cart" aria-label={`Carrello, ${count} prodotti`} aria-current={path === '/cart' ? 'page' : undefined} {...tag('nav.cart')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></svg><span>Carrello</span><b>{count}</b></Link>
    </header>
    {telemetryStatus === 'disabled' && <div className="disabled-banner" role="status">Telemetria disattivata: invio non abilitato o connection string assente. Il negozio demo resta utilizzabile.</div>}
    {telemetryStatus === 'enabled' && <div className="enabled-banner" role="status">Demo: la telemetria parte automaticamente. Cookie SDK con ID anonimi casuali; nessuna acquisizione del testo dei moduli, nessun keylogging o session replay.</div>}
    <div className="global-notice" aria-live="polite" aria-atomic="true">{notice && <div>{notice} <Link href="/cart" {...tag('notice.cart')}>Vedi carrello →</Link></div>}</div>
    <main id="main-content" tabIndex={-1} ref={main}>{page}</main>
    <aside className="telemetry-wrap" aria-label="Laboratorio di telemetria"><TelemetryPanel status={telemetryStatus} demoFailureEnabled={demoFailureEnabled} /></aside>
    <footer id="about"><div><Link className="brand footer-brand" href="/" {...tag('footer.home')}><span aria-hidden="true">✳</span> app market.</Link><p>Piccole cose, belle storie.<br />Un’esperienza fittizia, progettata per imparare.</p></div><div className="footer-note"><strong>Una demo, non un negozio reale.</strong><p>Niente dati personali. Niente pagamenti.<br />Solo un viaggio nella telemetria di Application Insights.</p><span>APP MARKET · DEMO E-COMMERCE</span></div></footer>
  </AppInsightsContext.Provider>;
}
