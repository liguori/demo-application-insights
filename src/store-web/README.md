# App Market — frontend

Negozio dimostrativo italiano, React + TypeScript + Vite. Prodotti e ordini sono
fittizi: nessuna raccolta di nome, email, indirizzo, carta o altri campi personali.
Il carrello e la ricevuta vivono in memoria; un refresh li azzera. Il journey
UUID casuale resta in `sessionStorage` per la scheda, senza identificare persone.

## Esecuzione

```sh
npm ci
npm run dev
npm test
npm run build
```

Node 24 LTS, almeno 24.15.0. Il dev server inoltra `/api` a `http://localhost:5080`.
Le dipendenze sono fissate nel lockfile per installazioni riproducibili con `npm ci`.
In produzione il backend serve `dist/` e applica il fallback SPA alle rotte
non API (`/products/:id`, `/cart`, `/checkout`, `/success`).
Non è presente un catalogo di ripiego: il server è la sorgente dei prodotti.
Le categorie sono dinamiche (il seed usa Tecnologia, Casa e Accessori), senza
dipendenze da nomi specifici nel frontend. Lo stock della demo è fisso: il
carrello limita ogni prodotto a `min(20, stock)` ma gli ordini non esauriscono
il seed. Prezzi e totale dell'ordine sono sempre autorevoli nella risposta server.

## API e avvio

Prima di inizializzare l'SDK viene atteso `GET /api/config`, con validazione di
`telemetryEnabled: boolean`, `applicationInsightsConnectionString: string` e
`demoFailureEnabled: boolean`.
Una risposta non valida o fallita blocca l'avvio e mostra un errore esplicito
con pulsante Riprova; non viene applicata alcuna configurazione alternativa.
Flag disabilitato o stringa vuota consentono l'uso del negozio ma mostrano un
banner permanente di telemetria disattivata e non caricano l'SDK.
Il pulsante di errore backend è abilitato soltanto con `demoFailureEnabled: true`,
indipendentemente dall'invio di telemetria. Quando il flag è falso viene mostrata
una spiegazione accessibile e non viene chiamato l'endpoint.

Tutte le richieste inviano `X-Demo-Journey`. Il checkout invia soltanto
`{ items: [{ productId, quantity }], journeyId }` a `POST /api/orders`; usa il
totale e le righe della risposta 201. Gli errori ProblemDetails sono visibili,
il carrello viene conservato in caso di errore e i doppi invii sono bloccati
durante la richiesta (non sono previste ripetizioni automatiche del POST).

## Telemetria

- `ApplicationInsights`, `ReactPlugin` (provider React) e `ClickAnalyticsPlugin`.
- Click Analytics: `autoCapture: true`, prefisso `data-ai-`, etichette esplicite
  `data-ai-id` / `data-ai-contentname`, con `data-ai-blob` JSON per il campo
  canonico `contentName` (`aiBlobAttributeTag: blob`);
  `useDefaultContentNameOrId: false`, `captureAllMetaDataContent: false` e
  `dropInvalidEvents: true`. Il prefisso metadati è limitato a
  `app-market-telemetry-` (nessun metatag generico). Nessuna estrazione
  automatica del testo.
- Page view iniziale e navigazioni SPA manuali in un unico effetto di routing;
  `enableAutoRouteTracking: false`; nessuna `history` passata al ReactPlugin.
  Le variazioni del carrello non producono nuove page view.
- Eccezioni automatiche e promise non gestite abilitate; fetch/XHR e relative
  prestazioni abilitati; metriche di prestazioni pagina del browser tramite
  il tracking page view dell'SDK; campionamento al 100%.
- `distributedTracingMode: W3C`, dipendenze same-origin, senza correlazione
  CORS verso domini esterni.
- Initializer comune: `ai.cloud.role = app-market-web` e proprietà `journeyId`
  su ogni elemento di telemetria. La richiesta config precede volutamente
  l'SDK: ha l'header journey ma non genera una dipendenza browser SDK.
- Lo stesso initializer elimina query e frammenti da URL/URI, `refUri`,
  `referrer` e campi URL annidati; pulisce anche nome/data/target delle dipendenze
  e nome operazione. Non vengono acquisiti header o body HTTP:
  `enableRequestHeaderTracking: false`, `enableResponseHeaderTracking: false`,
  `enableAjaxErrorStatusText: false`, con rimozione difensiva di eventuali campi
  header/body dall'envelope. Sono escluse anche le descrizioni `Server-Timing`
  provenienti da header; restano le normali misure di prestazioni del browser.
- `cookieCfg.enabled: true`: i cookie SDK standard `ai_user` e `ai_session`
  conservano ID casuali senza nomi o email. Non sono stati disabilitati: sono
  utili alla correlazione anonima della demo. L'avvio e il banner permanente
  avvisano esplicitamente che, se abilitata, la telemetria parte automaticamente.
- Eventi custom: `CatalogCategorySelected`, `ProductViewed`, `CartItemAdded`,
  `CartQuantityChanged`, `CartItemRemoved`, `CheckoutStarted`,
  `CheckoutSubmitted`, `CheckoutCompleted`, `CheckoutFailed`,
  `DemoBackendFailureRequested`. Proprietà: ID/categoria di prodotto,
  quantità/prezzo/totale, ID ordine o stato HTTP, secondo l'evento; sempre journey.
- Il laboratorio genera un'eccezione **gestita** (`source: demo.browser`) e
  chiama realmente `GET /api/demo/failure`, il cui HTTP 500 viene mostrato come
  intenzionale e acquisito come dipendenza fallita. Gli errori checkout
  gestiti sono registrati con `source: checkout`.

Il backend usa il ruolo distinto `app-market-api` ed emette `OrderPlaced`.
Il frontend non duplica questo evento server: registra invece `CheckoutCompleted`.

Non è keylogging né session replay: l'app non registra tasti o testo libero dei
moduli, non cattura video/DOM e non contiene campi per dati personali.
I clic usano esclusivamente metadati espliciti, mai il testo o il valore dei
controlli. Le richieste reali mantengono naturalmente i dati necessari all'API;
è la copia inviata alla telemetria a essere ripulita. Application Insights
raccoglie comunque percorsi URL, normali metadati tecnici del browser e
messaggi/stack diagnostici delle eccezioni. Non inserire informazioni personali
nei percorsi o nei messaggi di errore. La configurazione privacy/cookie e gli
eventuali requisiti di consenso vanno valutati prima di usi reali.

## Test

Vitest: inizializzazione e disattivazione telemetria, configurazione fallita,
initializer e opzioni SDK, reducer carrello/stock, filtri/dettagli, page view
senza duplicati, checkout e ProblemDetails, generazione errori, correlazione API.
Test `axe-core` su catalogo e carrello con laboratorio aperto; contrasto colori
escluso perché jsdom non effettua layout/rendering. Navigazione da tastiera,
focus dopo cambio rotta, etichette e stati ARIA sono inclusi nel frontend.

Verificato: `npm ci` con cache vuota, build di produzione e
20 test Vitest superati.
Smoke test su build reale: ordine con due pezzi e carrello svuotato; SDK reale
con ingestione intercettata localmente (nessun invio ad Azure), due page view
per due rotte, prestazioni pagina, clic con `contentName` esplicito, eccezione
gestita e dipendenza HTTP 500. Verificati header W3C `traceparent`, journey e
ruolo su tutti i segnali. Axe nel browser, anche con contrasto abilitato, non
ha rilevato violazioni sul catalogo con laboratorio aperto a 390 e 1280 px;
nessun overflow orizzontale.

### Playwright E2E

Sette test Chromium coprono filtri/dettagli, ordine reale dimostrativo senza PII,
correlazione journey, rimozione dal carrello, axe con contrasto su desktop/mobile,
errore config senza fallback, gating `demoFailureEnabled`, errore backend 500
e recupero da ProblemDetails del catalogo. I test leggono il catalogo dal server,
senza dipendere da ID o nomi specifici.
Un test usa l'SDK reale e intercetta soltanto configurazione, ingestione locale
e risposte sintetiche di errore/privacy: verifica payload effettivi (non mock
di `trackEvent`), due page view senza duplicati, prestazioni, clic con contentName
esplicito, eccezione gestita e promise non gestita, dipendenza fallita,
`traceparent` W3C, journey/ruolo e cookie SDK. Canary sintetici inseriti in
query/hash/referrer, campi di testo, header e body devono essere assenti
dall'intero payload acquisito. Nessun dato del test viene inviato ad Azure.
Verifica locale completata: 7/7 E2E superati con Chromium di sistema, frontend
su porta 5173 e backend su porta 5080.

Dopo aver pubblicato e avviato il backend con SPA su porta 5080:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Per verificare Vite con backend già avviato su porta 5080:

```sh
# Terminale 1
npm run dev -- --port 5173 --strictPort
# Terminale 2
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

`PLAYWRIGHT_BASE_URL` ha default `http://127.0.0.1:5080`; non vengono avviati
backend o browser scaricati automaticamente. Senza executable path, Playwright
usa il proprio Chromium già installato. Report, screenshot e trace di test
falliti restano nelle cartelle ignorate dal controllo versione. Questi trace
sono solo artefatti del test locale, non session replay dell'applicazione.
