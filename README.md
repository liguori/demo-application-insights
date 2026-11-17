# App Market: telemetria con Application Insights

Demo e-commerce in italiano con **React + TypeScript** e **ASP.NET Core 10**, pensata
per mostrare come Application Insights raccoglie telemetria da browser e backend
e come correlarla con un `journeyId` e un `OperationId` W3C.

Il catalogo, il carrello e il checkout sono fittizi: non servono database esterni,
account o sistemi di pagamento.

## Architettura

```text
Browser (React + Application Insights JS SDK)
   | HTTPS /api/* + traceparent + X-Demo-Journey
   v
Azure App Service (ASP.NET Core 10 + Azure Monitor OpenTelemetry)
   |
   v
Application Insights (workspace-based) --> Log Analytics (tabelle App*)
```

`azd up` crea un resource group nuovo con App Service, Log Analytics e Application
Insights. Il frontend viene compilato e incluso nel publish .NET: un solo deploy e
un solo dominio.

Per vedere dove e come viene inserita la telemetria nel codice (SDK browser, OpenTelemetry
lato server, eventi custom, metriche e span), leggere [ESEMPI-NEL-CODICE.md](ESEMPI-NEL-CODICE.md).
## Prerequisiti

- .NET SDK 10 e Node.js 24 LTS.
- [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
  e [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).
- Una subscription con quota per App Service Linux B1 e permessi di creazione
  risorse e role assignment (Owner, oppure Contributor + Role Based Access Control
  Administrator).

Il [dev container](.devcontainer/devcontainer.json) include gli strumenti necessari.

## Avvio locale

```bash
dotnet restore AppMarket.slnx
dotnet run --project src/Store.Api
```

In un secondo terminale:

```bash
cd src/store-web
npm ci
npm run dev
```

Aprire `http://localhost:5173`. Senza connection string il sito funziona, ma indica
esplicitamente che la telemetria è disabilitata. Per usare una risorsa reale:

```bash
export APPLICATIONINSIGHTS_CONNECTION_STRING='InstrumentationKey=...;IngestionEndpoint=https://...'
dotnet run --project src/Store.Api
```

Non committare connection string o altri segreti. La connection string del browser
viene letta a runtime da `/api/config`: è un identificatore di ingestione pubblico,
non una credenziale di lettura.

## Deployment

Scegliere un nome ambiente univoco nella subscription:

```bash
az login
az account set --subscription "<subscription-id>"
azd auth login
azd env new appmarket-demo
azd env set AZURE_SUBSCRIPTION_ID "<subscription-id>"
azd env set AZURE_LOCATION westeurope

azd up
```

Dopo il deploy, verificare l'endpoint:

```bash
curl --fail "$(azd env get-value SERVICE_WEB_ENDPOINT)/health"
curl --fail "$(azd env get-value SERVICE_WEB_ENDPOINT)/api/config"
```

Per modifiche al codice basta `azd deploy`; per modifiche all'infrastruttura
`azd provision` oppure `azd up`.

## Cosa viene raccolto

**Browser** (Application Insights JavaScript SDK con React plug-in e Click Analytics):
page view e navigazioni SPA, performance, chiamate `fetch`/XHR, errori JavaScript,
click sui controlli marcati `data-ai-*` ed eventi business (`ProductViewed`,
`CartItemAdded`, `CheckoutStarted`, `CheckoutCompleted`, …).

**Backend** (Azure Monitor OpenTelemetry): richieste API, eccezioni, log `ILogger`,
span `store.create_order`, metriche `store.orders` e l'evento `OrderPlaced` con
`orderId`, `journeyId` e `total`.

Non vengono registrati keylogging, registrazioni di sessione, contenuti dei moduli,
password, header di autorizzazione o corpi delle richieste. I click usano solo metadati
scelti dall'app.

Il sampling è al 100% per la dimostrazione, ma Application Insights può comunque
perdere dati (ad blocker, consenso negato, chiusura della scheda, quote). Per contare
gli ordini usare `OrderPlaced` lato server, non `CheckoutCompleted` lato browser.

## Verificare in Log Analytics

1. Nel sito, navigare, aggiungere articoli al carrello e completare un acquisto.
2. Annotare il valore di **JOURNEY DI QUESTA SESSIONE** mostrato nella pagina.
3. Nel portale, aprire il workspace Log Analytics → **Logs** ed eseguire le query di
   [azure-queries.kql](docs/azure-queries.kql), con intervallo di un'ora.
4. Cercare il `journeyId` in `AppEvents`, `AppRequests` e `AppDependencies` e
   verificare che browser e API condividano la stessa operazione.

Le query usano lo schema workspace (`App*`), diverso dallo schema classico di
Application Insights (`customEvents`, `requests`). Attendere qualche minuto per
l'ingestione.

## Test

```bash
dotnet test AppMarket.slnx

cd src/store-web
npm ci
npm test
npm run build
```

I test API coprono prezzi calcolati dal server, validazione del carrello, gli
ProblemDetails, la propagazione W3C e l'invio di telemetria verso un collector locale.
I test end-to-end con Playwright (`npm run test:e2e`) si collegano a `http://127.0.0.1:5080` (oppure a `PLAYWRIGHT_BASE_URL`): avviare prima l'app.

## Costi e pulizia

- App Service B1 ha un costo anche senza traffico.
- Application Insights e Log Analytics addebitano ingestione e retention. Il template
  non imposta un daily cap: un budget notifica ma non ferma la spesa.
- Per eliminare le risorse dell'ambiente:

```bash
azd env select appmarket-demo
azd down
```

## Licenza

Distribuito con licenza MIT, vedi [LICENSE](LICENSE).

## Riferimenti

- [Application Insights JavaScript SDK](https://learn.microsoft.com/azure/azure-monitor/app/javascript-sdk)
- [Click Analytics Auto-Collection plug-in](https://learn.microsoft.com/azure/azure-monitor/app/javascript-feature-extensions)
- [Azure Monitor OpenTelemetry](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable)
- [Custom events, metriche e span](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-add-modify)
- [Esempi nel codice](ESEMPI-NEL-CODICE.md)

## Disclaimer

Progetto dimostrativo, fornito senza garanzie. Non è un prodotto Microsoft né
un'offerta ufficiale, e non è una reference architecture per la produzione.
