import { avviaPagina, AUTOSCONTRO_SVG } from './layout.js';
import { supabase } from './supabase.js';
import { TIPI, CONDIZIONI, PAESI, escapa as e, data, euro } from './dati.js';
import { urlFoto, etichetteCaratteristiche, disponibilita, nomeTransizione } from './pubblico.js';

const venduti = new URLSearchParams(location.search).get('vista') === 'venduti';
avviaPagina({ attiva: venduti ? 'venduti' : 'catalogo' });

const $ = (id) => document.getElementById(id);
const form = $('form-filtri');
let annunci = [];
let modelli = [];
let caratteristiche = [];

// Macchinine nell'arena
document.querySelectorAll('.arena__auto').forEach((el) => { el.innerHTML = AUTOSCONTRO_SVG; });

// Scheda attiva
$(venduti ? 'tab-venduti' : 'tab-disponibili').classList.add('is-attiva');
$(venduti ? 'tab-venduti' : 'tab-disponibili').setAttribute('aria-selected', 'true');
$('titolo-vetrina').textContent = venduti ? 'Già vendute' : 'Le vetture';

// Filtri aperti di default su schermi grandi
if (matchMedia('(min-width: 900px)').matches) $('filtri').open = true;

async function carica() {
  $('griglia').innerHTML = Array.from({ length: 3 }, () => '<div class="carta carta--fantasma"></div>').join('');
  const [cat, mod, car] = await Promise.all([
    supabase.from('catalogo').select('*'),
    supabase.from('modelli').select('id,nome,tipo,ordine').order('ordine'),
    supabase.from('caratteristiche').select('id,nome,attivo,ordine').order('ordine'),
  ]);
  if (cat.error) {
    $('griglia').innerHTML = '<p class="vuoto">Catalogo momentaneamente non disponibile. Riprova tra poco.</p>';
    return;
  }
  annunci = cat.data;
  modelli = mod.data ?? [];
  caratteristiche = car.data ?? [];

  $('n-disponibili').textContent = annunci.filter((a) => a.stato === 'approvato').reduce((s, a) => s + a.quantita, 0);
  $('n-venduti').textContent = annunci.filter((a) => a.stato === 'venduto').reduce((s, a) => s + a.quantita, 0);

  preparaFiltri();
  disegna();
}

function preparaFiltri() {
  const anni = [...new Set(annunci.map((a) => a.anno))].sort((x, y) => y - x);
  $('f-anno').innerHTML = '<option value="">Qualsiasi</option>' +
    anni.map((n) => `<option value="${n}">dal ${n} in poi</option>`).join('');
  $('f-caratteristiche').innerHTML = caratteristiche.filter((k) => k.attivo).map((k) =>
    `<label class="scelta"><input type="checkbox" name="caratteristiche" value="${k.id}"><span>${e(k.nome)}</span></label>`).join('');
  aggiornaModelli();
}

function aggiornaModelli() {
  const tipo = new FormData(form).get('tipo');
  const sel = $('f-modello');
  const prima = sel.value;
  const nomi = [...new Set(annunci.filter((a) => !tipo || a.tipo === tipo).map((a) => a.modello))].sort();
  sel.innerHTML = '<option value="">Tutti</option>' + nomi.map((n) => `<option>${e(n)}</option>`).join('');
  if (nomi.includes(prima)) sel.value = prima;
}

function filtrati() {
  const f = new FormData(form);
  const oggi = new Date().toISOString().slice(0, 10);
  const caratt = f.getAll('caratteristiche').map(Number);
  let attivi = 0;
  ['tipo', 'modello', 'anno', 'condizione', 'paese', 'disponibilita'].forEach((k) => { if (f.get(k)) attivi++; });
  attivi += caratt.length;
  $('n-filtri').textContent = attivi ? `(${attivi})` : '';

  return annunci
    .filter((a) => (venduti ? a.stato === 'venduto' : a.stato === 'approvato'))
    .filter((a) => !f.get('tipo') || a.tipo === f.get('tipo'))
    .filter((a) => !f.get('modello') || a.modello === f.get('modello'))
    .filter((a) => !f.get('anno') || a.anno >= Number(f.get('anno')))
    .filter((a) => !f.get('condizione') || a.condizione === f.get('condizione'))
    .filter((a) => !f.get('paese') || a.paese === f.get('paese'))
    .filter((a) => !f.get('disponibilita')
      || (f.get('disponibilita') === 'subito' ? a.disponibile_da <= oggi : a.disponibile_da > oggi))
    .filter((a) => caratt.every((id) => a.caratteristiche.includes(id)))
    .sort((x, y) => venduti
      ? String(y.venduto_il).localeCompare(String(x.venduto_il))
      : String(y.pubblicato_il).localeCompare(String(x.pubblicato_il)));
}

function carta(a, i) {
  const foto = a.foto[0];
  return `
  <a class="carta" href="/annuncio.html?c=${encodeURIComponent(a.codice)}" style="--ritardo:${Math.min(i, 8) * 60}ms">
    <div class="carta__foto">
      ${foto ? `<img src="${urlFoto(foto)}" alt="${e(a.modello)}" loading="${i < 3 ? 'eager' : 'lazy'}" style="view-transition-name:${nomeTransizione(a.codice)}">` : ''}
      <span class="carta__codice">${e(a.codice)}</span>
      ${a.stato === 'venduto' ? `<span class="timbro">VENDUTO<small>${data(a.venduto_il)}</small></span>` : ''}
      ${a.foto.length > 1 ? `<span class="carta__nfoto">📷 ${a.foto.length}</span>` : ''}
    </div>
    <div class="carta__corpo">
      <p class="carta__tipo">${TIPI[a.tipo]} · ${a.anno}</p>
      <h3 class="carta__titolo">${e(a.modello)}</h3>
      <ul class="carta__dati">
        <li><b>${a.quantita}</b> ${a.quantita === 1 ? 'vettura' : 'vetture'}</li>
        <li>${CONDIZIONI[a.condizione]}</li>
        <li>${PAESI[a.paese]}</li>
      </ul>
      <div class="carta__etichette">${etichetteCaratteristiche(a, caratteristiche)}</div>
      <div class="carta__piede">
        <span class="carta__prezzo">${a.prezzo != null ? `${euro(a.prezzo)} <small>cad.</small>` : 'Trattativa riservata'}</span>
        <span class="carta__disp">${a.stato === 'venduto' ? '' : disponibilita(a)}</span>
      </div>
    </div>
  </a>`;
}

function disegna() {
  const lista = filtrati();
  $('risultati').textContent = lista.length === 1 ? '1 annuncio' : `${lista.length} annunci`;
  $('griglia').innerHTML = lista.length ? lista.map(carta).join('') : `
    <div class="vuoto vuoto--grande">
      <div class="vuoto__auto">${AUTOSCONTRO_SVG}</div>
      <p>${annunci.length ? 'Nessuna vettura con questi filtri.' : venduti ? 'Ancora nessuna vendita da mostrare.' : 'Al momento non ci sono vetture disponibili.'}</p>
      <p><a class="pulsante pulsante--secondario" href="https://wa.me/393332424570?text=${encodeURIComponent('Ciao, sto cercando degli autoscontri usati')}" target="_blank" rel="noopener">Dicci cosa cerchi</a></p>
    </div>`;
}

form.addEventListener('change', (ev) => {
  if (ev.target.name === 'tipo') aggiornaModelli();
  disegna();
});
form.addEventListener('reset', () => setTimeout(() => { aggiornaModelli(); disegna(); }));

carica();
