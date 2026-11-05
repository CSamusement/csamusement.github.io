import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './stile.css';
import './stile-catalogo.css';
import { supabase } from './supabase.js';

const SITO = 'https://www.csamusement.it';

// Piccolo autoscontro disegnato in SVG (antenna con scintilla, paraurti in gomma)
export const AUTOSCONTRO_SVG = `
<svg class="autoscontro" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
  <g class="autoscontro__antenna">
    <line x1="78" y1="34" x2="92" y2="4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <circle class="autoscontro__scintilla" cx="92" cy="4" r="4"/>
  </g>
  <g class="autoscontro__corpo">
    <rect x="6" y="46" width="108" height="20" rx="10" class="autoscontro__gomma"/>
    <path d="M18 48 Q20 30 40 28 L86 28 Q104 30 104 48 Z" class="autoscontro__carrozzeria"/>
    <path d="M44 28 Q48 16 60 16 L70 16 Q78 16 80 28 Z" class="autoscontro__sedile"/>
    <circle cx="96" cy="40" r="3.5" class="autoscontro__faro"/>
    <rect x="30" y="34" width="22" height="5" rx="2.5" class="autoscontro__striscia"/>
  </g>
</svg>`;

function applicaTema(tema) {
  document.documentElement.dataset.tema = tema === 'B' ? 'B' : 'A';
}

async function caricaTema() {
  // Anteprima: ?tema=A oppure ?tema=B nell'indirizzo
  const prova = new URLSearchParams(location.search).get('tema');
  if (prova) return applicaTema(prova.toUpperCase());
  const salvato = sessionStorage.getItem('tema');
  if (salvato) applicaTema(salvato);
  const { data } = await supabase.from('impostazioni').select('tema').eq('id', 1).maybeSingle();
  if (data?.tema) {
    sessionStorage.setItem('tema', data.tema);
    applicaTema(data.tema);
  }
}

function intestazione(attiva) {
  const voce = (href, testo, id) =>
    `<a href="${href}" class="nav__voce${attiva === id ? ' is-attiva' : ''}"${attiva === id ? ' aria-current="page"' : ''}>${testo}</a>`;
  return `
  <div class="barra-sito"><a href="${SITO}">← Torna al sito CS Amusement</a></div>
  <header class="testata">
    <a class="marchio" href="/">
      <img src="/logo-piccolo.png" alt="CS Amusement" width="48" height="48">
      <span class="marchio__testo">Usato<br><small>Autoscontri</small></span>
    </a>
    <nav class="nav" aria-label="Menu principale">
      ${voce('/', 'Catalogo', 'catalogo')}
      ${voce('/?vista=venduti', 'Venduti', 'venduti')}
      ${voce('/proponi.html', 'Vendi la tua vettura', 'proponi')}
    </nav>
    <div class="pista" aria-hidden="true">${AUTOSCONTRO_SVG}</div>
  </header>`;
}

function piede() {
  return `
  <footer class="piede">
    <img src="/logo-piccolo.png" alt="" width="40" height="40">
    <nav aria-label="Informazioni legali">
      <a href="/privacy.html">Informativa Privacy</a>
      <a href="/cookie.html">Cookie Policy</a>
      <a href="/condizioni.html">Condizioni d'uso</a>
    </nav>
    <p>© ${new Date().getFullYear()} CS Amusement · Nessun cookie di tracciamento, nessuna statistica.</p>
  </footer>`;
}

export function avviaPagina({ attiva } = {}) {
  document.body.insertAdjacentHTML('afterbegin', intestazione(attiva));
  document.body.insertAdjacentHTML('beforeend', piede());
  caricaTema();
}
