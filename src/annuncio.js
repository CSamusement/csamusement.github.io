import { avviaPagina } from './layout.js';
import { supabase } from './supabase.js';
import { TIPI, CONDIZIONI, PAESI, escapa as e, data, euro } from './dati.js';
import {
  urlFoto, linkWhatsApp, linkEmail, etichetteCaratteristiche, disponibilita, nomeTransizione, ICONA_WHATSAPP,
} from './pubblico.js';

avviaPagina({ attiva: 'catalogo' });
const box = document.getElementById('dettaglio');
const codice = new URLSearchParams(location.search).get('c') ?? '';

async function carica() {
  const [cat, car] = await Promise.all([
    supabase.from('catalogo').select('*').eq('codice', codice).maybeSingle(),
    supabase.from('caratteristiche').select('id,nome'),
  ]);
  const a = cat.data;
  if (!a) {
    box.innerHTML = `
      <div class="vuoto vuoto--grande">
        <h1>Annuncio non trovato</h1>
        <p>Potrebbe essere stato rimosso o il codice non è corretto.</p>
        <p><a class="pulsante" href="/">Vai al catalogo</a></p>
      </div>`;
    return;
  }
  document.title = `${a.codice} · ${a.modello} · Autoscontri usati CS Amusement`;
  disegna(a, car.data ?? []);
}

function disegna(a, caratteristiche) {
  const venduto = a.stato === 'venduto';
  const foto = a.foto;
  const righe = [
    ['Tipo', TIPI[a.tipo]],
    ['Anno', a.anno],
    ['Quantità', `${a.quantita} ${a.quantita === 1 ? 'vettura' : 'vetture'}`],
    ['Stato', CONDIZIONI[a.condizione]],
    ['Disponibilità', venduto ? `Venduto il ${data(a.venduto_il)}` : disponibilita(a)],
    ['Dove si trova', PAESI[a.paese]],
  ];

  box.innerHTML = `
  <a class="indietro" href="/${venduto ? '?vista=venduti' : ''}#vetrina">← Tutte le vetture</a>

  <div class="dettaglio__griglia">
    <section class="galleria" aria-label="Foto">
      <div class="galleria__nastro" id="nastro" tabindex="0">
        ${foto.map((p, i) => `
          <figure class="galleria__foto">
            <img src="${urlFoto(p)}" alt="${e(a.modello)} – foto ${i + 1} di ${foto.length}"
              ${i === 0 ? `style="view-transition-name:${nomeTransizione(a.codice)}"` : 'loading="lazy"'}>
          </figure>`).join('')}
      </div>
      ${venduto ? `<span class="timbro timbro--grande">VENDUTO<small>${data(a.venduto_il)}</small></span>` : ''}
      ${foto.length > 1 ? `
        <span class="galleria__contatore" id="contatore">1 / ${foto.length}</span>
        <button class="galleria__freccia galleria__freccia--sx" data-verso="-1" aria-label="Foto precedente">‹</button>
        <button class="galleria__freccia galleria__freccia--dx" data-verso="1" aria-label="Foto successiva">›</button>
        <div class="galleria__miniature">
          ${foto.map((p, i) => `<button data-indice="${i}" aria-label="Vai alla foto ${i + 1}"${i === 0 ? ' class="is-attiva"' : ''}><img src="${urlFoto(p)}" alt="" loading="lazy"></button>`).join('')}
        </div>` : ''}
    </section>

    <section class="scheda-pubblica">
      <p class="occhiello">Annuncio ${e(a.codice)}</p>
      <h1>${e(a.modello)}</h1>
      <p class="scheda-pubblica__prezzo">${a.prezzo != null ? `${euro(a.prezzo)} <small>per vettura</small>` : 'Trattativa riservata'}</p>

      <dl class="specifiche">
        ${righe.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join('')}
      </dl>

      ${a.caratteristiche.length ? `<div class="carta__etichette carta__etichette--grandi">${etichetteCaratteristiche(a, caratteristiche)}</div>` : ''}
      ${a.note ? `<div class="note"><h2>Note</h2><p>${e(a.note).replace(/\n/g, '<br>')}</p></div>` : ''}

      <div class="contatto">
        ${venduto ? `
          <p><strong>Questa vettura è già stata venduta.</strong> Cerchi qualcosa di simile? Scrivici, ti aiutiamo a trovarla.</p>
          <a class="pulsante pulsante--whatsapp" href="https://wa.me/393332424570?text=${encodeURIComponent(`Ciao, cerco qualcosa di simile all'annuncio ${a.codice}`)}" target="_blank" rel="noopener">${ICONA_WHATSAPP} Scrivici su WhatsApp</a>` : `
          <p>Ti interessa? Contatta <strong>CS Amusement</strong> indicando il codice <strong>${e(a.codice)}</strong>.</p>
          <a class="pulsante pulsante--whatsapp" href="${linkWhatsApp(a.codice)}" target="_blank" rel="noopener">${ICONA_WHATSAPP} Scrivici su WhatsApp</a>
          <a class="pulsante pulsante--secondario" href="${linkEmail(a.codice)}">✉️ Scrivici un'email</a>`}
      </div>
    </section>
  </div>

  ${venduto ? '' : `
  <div class="barra-contatto">
    <a class="pulsante pulsante--whatsapp" href="${linkWhatsApp(a.codice)}" target="_blank" rel="noopener">${ICONA_WHATSAPP} WhatsApp</a>
    <a class="pulsante pulsante--secondario" href="${linkEmail(a.codice)}">✉️ Email</a>
  </div>`}`;

  attivaGalleria(foto.length);
}

function attivaGalleria(n) {
  const nastro = document.getElementById('nastro');
  if (!nastro || n < 2) return;
  const vai = (i) => {
    const ridotto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    nastro.scrollTo({ left: nastro.clientWidth * Math.max(0, Math.min(n - 1, i)), behavior: ridotto ? 'auto' : 'smooth' });
  };
  const attuale = () => Math.round(nastro.scrollLeft / nastro.clientWidth);

  nastro.addEventListener('scroll', () => {
    const i = attuale();
    document.getElementById('contatore').textContent = `${i + 1} / ${n}`;
    document.querySelectorAll('.galleria__miniature button').forEach((b, k) => b.classList.toggle('is-attiva', k === i));
  }, { passive: true });

  document.querySelectorAll('.galleria__freccia').forEach((b) =>
    b.addEventListener('click', () => vai(attuale() + Number(b.dataset.verso))));
  document.querySelectorAll('.galleria__miniature button').forEach((b) =>
    b.addEventListener('click', () => vai(Number(b.dataset.indice))));
  nastro.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') vai(attuale() + 1);
    if (ev.key === 'ArrowLeft') vai(attuale() - 1);
  });
}

carica();
