import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializeTelemetry } from './telemetry';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="startup" role="status"><span aria-hidden="true">✳</span><h1>Apriamo il mercato…</h1><p>Caricamento della configurazione dal server. Se abilitata, la telemetria demo parte automaticamente e usa cookie SDK con ID anonimi casuali, senza acquisire il testo dei moduli.</p></div>);

initializeTelemetry().then(settings => {
  root.render(<App {...settings} />);
}).catch(() => {
  root.render(<main className="startup"><span aria-hidden="true">✳</span><h1>Il mercato non è ancora pronto.</h1><div className="notice notice-error" role="alert">Impossibile inizializzare la configurazione o la telemetria. Nessuna configurazione di ripiego è stata applicata. Verifica /api/config e riprova.</div><button className="button" onClick={() => location.reload()} data-ai-id="config.retry" data-ai-contentname="config.retry">Riprova</button></main>);
});
