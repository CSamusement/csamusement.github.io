import { zipSync, strToU8 } from 'fflate';
import { avviaPagina } from './layout.js';
import { supabase } from './supabase.js';
import { comprimiFoto } from './foto.js';
import { conFiligrana } from './filigrana.js';
import {
  TIPI, CONDIZIONI, PAESI, STATI, escapa as e, data, prezzoTesto, nomeModello, inScadenza,
} from './dati.js';

avviaPagina({ attiva: 'admin' });

const app = document.getElementById('app');
const BUCKET_PRIVATO = 'foto-private';
const BUCKET_PUBBLICO = 'foto-pubbliche';

const stato = {
  vista: 'proposte',     // proposte | scheda | liste | impostazioni
  filtro: 'in_attesa',   // in_attesa | approvato | scadenza | venduto | rifiutato | archiviato | tutti
  schedaId: null,
  annunci: [],
  modelli: [],
  caratteristiche: [],
  miniature: new Map(),  // percorso privato -> indirizzo temporaneo
  tema: 'A',
};

// =====================================================================
//  Accesso
// =====================================================================
async function avvio() {
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') mostraNuovaPassword();
  });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return mostraAccesso();
  const { data: ok } = await supabase.rpc('is_admin');
  if (!ok) {
    await supabase.auth.signOut();
    return mostraAccesso('Questo account non è autorizzato all\'area admin.');
  }
  await ricarica();
}

function mostraAccesso(messaggio = '') {
  app.innerHTML = `
  <section class="accesso">
    <h1>Area admin</h1>
    <p class="tenue">Riservata a CS Amusement.</p>
    <form id="form-accesso" class="riquadro campi">
      <div class="campo"><label for="acc-email">Email</label>
        <input type="email" id="acc-email" autocomplete="username" required></div>
      <div class="campo"><label for="acc-password">Password</label>
        <input type="password" id="acc-password" autocomplete="current-password" required></div>
      ${messaggio ? `<p class="errore">${e(messaggio)}</p>` : ''}
      <button class="pulsante" type="submit">Entra</button>
      <button class="link" type="button" id="password-dimenticata">Password dimenticata?</button>
    </form>
  </section>`;

  app.querySelector('#form-accesso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({
      email: app.querySelector('#acc-email').value.trim(),
      password: app.querySelector('#acc-password').value,
    });
    if (error) return mostraAccesso('Email o password non corretti.');
    avvio();
  });

  app.querySelector('#password-dimenticata').addEventListener('click', async () => {
    const email = app.querySelector('#acc-email').value.trim();
    if (!email) return avviso('Scrivi prima la tua email nel campo qui sopra.');
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin.html` });
    avviso('Se l\'email è corretta, ti abbiamo inviato un link per creare una nuova password.');
  });
}

function mostraNuovaPassword() {
  app.innerHTML = `
  <section class="accesso">
    <h1>Nuova password</h1>
    <form id="form-nuova" class="riquadro campi">
      <div class="campo"><label for="nuova-pw">Nuova password (almeno 12 caratteri)</label>
        <input type="password" id="nuova-pw" minlength="12" autocomplete="new-password" required></div>
      <button class="pulsante" type="submit">Salva password</button>
    </form>
  </section>`;
  app.querySelector('#form-nuova').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: app.querySelector('#nuova-pw').value });
    if (error) return avviso('Password non salvata: ' + error.message);
    avviso('Password aggiornata.');
    ricarica();
  });
}

// =====================================================================
//  Dati
// =====================================================================
async function ricarica() {
  const [annunci, modelli, caratteristiche, impostazioni] = await Promise.all([
    supabase.from('annunci').select('*, contatti_venditori(*), foto(*)').order('id', { ascending: false }),
    supabase.from('modelli').select('*').order('tipo').order('ordine').order('nome'),
    supabase.from('caratteristiche').select('*').order('ordine').order('nome'),
    supabase.from('impostazioni').select('*').eq('id', 1).maybeSingle(),
  ]);
  const errore = annunci.error || modelli.error || caratteristiche.error;
  if (errore) {
    app.innerHTML = `<p class="errore">Errore nel caricamento: ${e(errore.message)}</p>`;
    return;
  }
  stato.annunci = annunci.data.map((a) => ({
    ...a,
    contatto: Array.isArray(a.contatti_venditori) ? a.contatti_venditori[0] : a.contatti_venditori,
    foto: (a.foto ?? []).sort((x, y) => x.ordine - y.ordine),
  }));
  stato.modelli = modelli.data;
  stato.caratteristiche = caratteristiche.data;
  stato.tema = impostazioni.data?.tema ?? 'A';
  await preparaMiniature();
  disegna();
}

async function preparaMiniature() {
  const percorsi = [];
  for (const a of stato.annunci) {
    const lista = stato.vista === 'scheda' && a.id === stato.schedaId ? a.foto : a.foto.slice(0, 1);
    for (const f of lista) if (!stato.miniature.has(f.path_privato)) percorsi.push(f.path_privato);
  }
  if (!percorsi.length) return;
  const { data: firmati } = await supabase.storage.from(BUCKET_PRIVATO).createSignedUrls(percorsi, 3600);
  (firmati ?? []).forEach((x) => x.signedUrl && stato.miniature.set(x.path, x.signedUrl));
}

const annuncio = (id) => stato.annunci.find((a) => a.id === Number(id));

// =====================================================================
//  Disegno pagine
// =====================================================================
function disegna() {
  const schede = [
    ['proposte', 'Annunci'], ['liste', 'Modelli e caratteristiche'], ['impostazioni', 'Impostazioni e backup'],
  ];
  const vistaMenu = stato.vista === 'scheda' ? 'proposte' : stato.vista;
  app.innerHTML = `
  <div class="admin-testa">
    <h1>Area admin</h1>
    <button class="pulsante pulsante--secondario pulsante--piccolo" data-azione="esci">Esci</button>
  </div>
  ${promemoriaBackup()}
  <nav class="admin-schede" aria-label="Sezioni admin">
    ${schede.map(([id, t]) => `<button class="admin-scheda${vistaMenu === id ? ' is-attiva' : ''}" data-azione="vista" data-vista="${id}">${t}</button>`).join('')}
  </nav>
  <div id="contenuto">${
    stato.vista === 'proposte' ? vistaProposte()
      : stato.vista === 'scheda' ? vistaScheda(annuncio(stato.schedaId))
        : stato.vista === 'liste' ? vistaListe()
          : vistaImpostazioni()
  }</div>`;
}

function promemoriaBackup() {
  const ultimo = localStorage.getItem('ultimoBackup');
  const giorni = ultimo ? (Date.now() - new Date(ultimo)) / 86400000 : Infinity;
  if (giorni < 30) return '';
  return `<div class="avviso"><span class="avviso__icona" aria-hidden="true">💾</span>
    <span>${ultimo ? `Ultimo backup: ${data(ultimo)}.` : 'Non hai ancora fatto un backup da questo computer.'}
    Ricordati di scaricarlo una volta al mese. <button class="link" data-azione="vista" data-vista="impostazioni">Vai al backup →</button></span></div>`;
}

// ---------- Elenco annunci ----------
function filtra(a, f) {
  if (f === 'tutti') return true;
  if (f === 'scadenza') return inScadenza(a);
  return a.stato === f;
}

function vistaProposte() {
  const filtri = [
    ['in_attesa', 'In attesa'], ['scadenza', 'Da verificare (6 mesi)'], ['approvato', 'Pubblicati'],
    ['venduto', 'Venduti'], ['rifiutato', 'Rifiutati'], ['archiviato', 'Archiviati'], ['tutti', 'Tutti'],
  ];
  const lista = stato.annunci.filter((a) => filtra(a, stato.filtro));
  return `
  <div class="filtri-stato">
    ${filtri.map(([id, t]) => {
    const n = stato.annunci.filter((a) => filtra(a, id)).length;
    return `<button class="filtro${stato.filtro === id ? ' is-attivo' : ''}${id === 'scadenza' && n ? ' filtro--allarme' : ''}" data-azione="filtro" data-filtro="${id}">${t} <b>${n}</b></button>`;
  }).join('')}
  </div>
  ${lista.length ? `<div class="elenco-admin">${lista.map(cartaAdmin).join('')}</div>`
    : '<p class="vuoto">Nessun annuncio in questa sezione.</p>'}`;
}

function cartaAdmin(a) {
  const copertina = a.foto[0] && stato.miniature.get(a.foto[0].path_privato);
  return `
  <button class="carta-admin" data-azione="apri" data-id="${a.id}">
    <span class="carta-admin__foto">${copertina ? `<img src="${copertina}" alt="" loading="lazy">` : '<span>📷</span>'}</span>
    <span class="carta-admin__testo">
      <span class="carta-admin__riga">
        <strong>${e(a.codice)}</strong>
        <span class="badge badge--${a.stato}">${STATI[a.stato]}</span>
        ${inScadenza(a) ? '<span class="badge badge--scadenza">6 mesi: verificare</span>' : ''}
      </span>
      <span class="carta-admin__titolo">${e(nomeModello(a, stato.modelli))} · ${TIPI[a.tipo] ?? ''}</span>
      <span class="tenue">${a.anno} · ${a.quantita} ${a.quantita === 1 ? 'vettura' : 'vetture'} · ${CONDIZIONI[a.condizione]} · ${PAESI[a.paese]}</span>
      <span class="tenue">Ricevuto il ${data(a.creato_il)}${a.contatto ? ` da ${e(a.contatto.nome)}` : ''} · ${a.foto.length} foto</span>
    </span>
  </button>`;
}

// ---------- Scheda singolo annuncio ----------
function opzioniModelli(a) {
  const gruppi = Object.entries(TIPI).map(([tipo, etichetta]) => {
    const voci = stato.modelli.filter((m) => m.tipo === tipo && (m.attivo || m.id === a.modello_id));
    if (!voci.length) return '';
    return `<optgroup label="${etichetta}">${voci.map((m) =>
      `<option value="${m.id}"${m.id === a.modello_id ? ' selected' : ''}>${e(m.nome)}${m.attivo ? '' : ' (disattivato)'}</option>`).join('')}</optgroup>`;
  }).join('');
  return `${gruppi}<option value="altro"${a.modello_id ? '' : ' selected'}>Altro (testo libero)</option>`;
}

function radio(nome, valori, scelto) {
  return `<div class="scelte">${Object.entries(valori).map(([v, t]) =>
    `<label class="scelta"><input type="radio" name="${nome}" value="${v}"${v === scelto ? ' checked' : ''} required><span>${t}</span></label>`).join('')}</div>`;
}

function vistaScheda(a) {
  if (!a) return '<p class="vuoto">Annuncio non trovato.</p>';
  const c = a.contatto;
  const pubblico = a.stato === 'approvato' || a.stato === 'venduto';
  const oggi = new Date().toISOString().slice(0, 10);

  return `
  <button class="link" data-azione="vista" data-vista="proposte">← Torna all'elenco</button>
  <div class="scheda-testa">
    <h2>${e(a.codice)} <span class="badge badge--${a.stato}">${STATI[a.stato]}</span>
      ${inScadenza(a) ? '<span class="badge badge--scadenza">6 mesi: verificare</span>' : ''}</h2>
    <p class="tenue">Ricevuto il ${data(a.creato_il)}${a.pubblicato_il ? ` · Pubblicato il ${data(a.pubblicato_il)}` : ''}${a.venduto_il ? ` · Venduto il ${data(a.venduto_il)}` : ''}${a.rifiutato_il ? ` · Rifiutato il ${data(a.rifiutato_il)}` : ''}</p>
  </div>

  <div class="azioni-scheda">
    ${a.stato === 'in_attesa' ? `
      <button class="pulsante" data-azione="approva" data-id="${a.id}">✓ Approva e pubblica</button>
      <button class="pulsante pulsante--pericolo" data-azione="rifiuta" data-id="${a.id}">✕ Rifiuta</button>` : ''}
    ${a.stato === 'approvato' ? `
      <span class="gruppo-venduto">
        <input type="date" id="data-vendita" value="${oggi}" aria-label="Data di vendita">
        <button class="pulsante" data-azione="venduto" data-id="${a.id}">Segna come VENDUTO</button>
      </span>
      ${inScadenza(a) ? `<button class="pulsante pulsante--secondario" data-azione="disponibile" data-id="${a.id}">Ancora disponibile (rinnova 6 mesi)</button>` : ''}
      <button class="pulsante pulsante--secondario" data-azione="archivia" data-id="${a.id}">Archivia (togli dal catalogo)</button>` : ''}
    ${a.stato === 'venduto' ? `
      <button class="pulsante pulsante--secondario" data-azione="archivia" data-id="${a.id}">Archivia (togli dai Venduti)</button>` : ''}
    ${['rifiutato', 'archiviato', 'venduto'].includes(a.stato) ? `
      <button class="pulsante pulsante--secondario" data-azione="in_attesa" data-id="${a.id}">Rimetti in attesa</button>` : ''}
  </div>

  <div class="scheda-griglia">
    <form id="form-annuncio" class="riquadro campi" novalidate>
      <h3>Dati della vettura</h3>
      <div class="campo"><span class="etichetta">Tipo</span>${radio('tipo', TIPI, a.tipo)}</div>
      <div class="campi campi--due">
        <div class="campo"><label for="s-modello">Modello</label>
          <select id="s-modello" name="modello">${opzioniModelli(a)}</select></div>
        <div class="campo"><label for="s-altro">Modello scritto a mano <span class="facoltativo">(se "Altro")</span></label>
          <input type="text" id="s-altro" name="modello_altro" maxlength="80" value="${e(a.modello_altro)}"></div>
      </div>
      <div class="campi campi--due">
        <div class="campo"><label for="s-anno">Anno</label>
          <input type="number" id="s-anno" name="anno" min="1950" max="2100" value="${a.anno}" required></div>
        <div class="campo"><label for="s-qta">Quantità</label>
          <input type="number" id="s-qta" name="quantita" min="1" max="500" value="${a.quantita}" required></div>
      </div>
      <div class="campo"><span class="etichetta">Stato</span>${radio('condizione', CONDIZIONI, a.condizione)}</div>
      <div class="campi campi--due">
        <div class="campo"><label for="s-disp">Disponibile da</label>
          <input type="date" id="s-disp" name="disponibile_da" value="${a.disponibile_da}" required></div>
        <div class="campo"><span class="etichetta">Dove si trova</span>${radio('paese', PAESI, a.paese)}</div>
      </div>
      <div class="campi campi--due">
        <div class="campo"><label for="s-prezzo">Prezzo per vettura (€)</label>
          <input type="number" id="s-prezzo" name="prezzo" min="0" step="1" value="${a.prezzo ?? ''}"></div>
        <label class="casella casella--centrata"><input type="checkbox" name="mostra_prezzo"${a.mostra_prezzo ? ' checked' : ''}>
          <span>Mostra il prezzo <span class="facoltativo">(ora: ${e(prezzoTesto(a))})</span></span></label>
      </div>
      <div class="campo"><span class="etichetta">Caratteristiche</span>
        <div class="scelte">${stato.caratteristiche.filter((k) => k.attivo || a.caratteristiche.includes(k.id)).map((k) =>
    `<label class="scelta"><input type="checkbox" name="caratteristiche" value="${k.id}"${a.caratteristiche.includes(k.id) ? ' checked' : ''}><span>${e(k.nome)}</span></label>`).join('')}</div></div>
      <div class="campo"><label for="s-note">Altre note</label>
        <textarea id="s-note" name="note" maxlength="2000">${e(a.note)}</textarea></div>

      <h3>Venditore <span class="facoltativo">(mai pubblicato)</span></h3>
      ${c ? `
      <div class="campi campi--due">
        <div class="campo"><label for="s-nome">Nome</label>
          <input type="text" id="s-nome" name="nome" maxlength="100" value="${e(c.nome)}" required></div>
        <div class="campo"><label for="s-email">Email</label>
          <input type="email" id="s-email" name="email" maxlength="200" value="${e(c.email)}" required></div>
      </div>
      <div class="campo"><label for="s-tel">Telefono</label>
        <input type="tel" id="s-tel" name="telefono" maxlength="40" value="${e(c.telefono)}"></div>
      <p class="contatti-rapidi">
        <a href="mailto:${e(c.email)}?subject=${encodeURIComponent(`Annuncio ${a.codice}`)}">✉️ Scrivi email</a>
        ${c.telefono ? `<a href="tel:${e(c.telefono)}">📞 Chiama</a>` : ''}
      </p>
      <p class="tenue piccolo">Consenso privacy dato il ${new Date(c.consenso_il).toLocaleString('it-IT')}</p>`
    : '<p class="tenue">Dati del venditore cancellati.</p>'}

      <button class="pulsante" type="button" data-azione="salva" data-id="${a.id}">Salva modifiche</button>
    </form>

    <section class="riquadro">
      <h3>Foto (${a.foto.length})</h3>
      <p class="tenue piccolo">${pubblico ? 'Nel catalogo compaiono con il logo in filigrana.' : 'Il logo in filigrana viene aggiunto quando approvi.'} La prima è la copertina.</p>
      <div class="foto-admin">
        ${a.foto.map((f, i) => `
        <figure class="foto-admin__voce">
          <a href="${stato.miniature.get(f.path_privato) ?? '#'}" target="_blank" rel="noopener">
            <img src="${stato.miniature.get(f.path_privato) ?? ''}" alt="Foto ${i + 1}" loading="lazy"></a>
          <figcaption>
            <button type="button" data-azione="sposta" data-id="${f.id}" data-verso="-1" ${i === 0 ? 'disabled' : ''} aria-label="Sposta prima">◀</button>
            <span>${i === 0 ? 'Copertina' : i + 1}</span>
            <button type="button" data-azione="sposta" data-id="${f.id}" data-verso="1" ${i === a.foto.length - 1 ? 'disabled' : ''} aria-label="Sposta dopo">▶</button>
            <button type="button" data-azione="togli-foto" data-id="${f.id}" aria-label="Elimina foto">🗑</button>
          </figcaption>
        </figure>`).join('')}
      </div>
      <label class="pulsante pulsante--secondario pulsante--piccolo aggiungi-foto">
        + Aggiungi foto
        <input type="file" id="aggiungi-foto" data-id="${a.id}" accept="image/*" multiple class="solo-lettori">
      </label>
    </section>
  </div>

  <section class="riquadro zona-pericolo">
    <h3>Cancellazione definitiva</h3>
    <p class="tenue">Non si può annullare.</p>
    <button class="pulsante pulsante--pericolo pulsante--piccolo" data-azione="elimina" data-id="${a.id}">Elimina questo annuncio e le sue foto</button>
    ${c ? `<button class="pulsante pulsante--pericolo pulsante--piccolo" data-azione="oblio" data-email="${e(c.email)}">Cancella il venditore e TUTTI i suoi annunci (diritto all'oblio)</button>` : ''}
  </section>`;
}

// ---------- Liste modificabili ----------
function vistaListe() {
  const rigaModello = (m) => `
    <tr>
      <td><input type="text" value="${e(m.nome)}" data-campo="nome" maxlength="80" aria-label="Nome modello"></td>
      <td><select data-campo="tipo" aria-label="Tipo">${Object.entries(TIPI).map(([v, t]) => `<option value="${v}"${m.tipo === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="number" value="${m.ordine}" data-campo="ordine" class="corto" aria-label="Ordine"></td>
      <td><input type="checkbox" data-campo="attivo"${m.attivo ? ' checked' : ''} aria-label="Attivo"></td>
      <td><button class="pulsante pulsante--piccolo" data-azione="salva-voce" data-tabella="modelli" data-id="${m.id}">Salva</button></td>
    </tr>`;
  const rigaCaratt = (k) => `
    <tr>
      <td><input type="text" value="${e(k.nome)}" data-campo="nome" maxlength="60" aria-label="Nome caratteristica"></td>
      <td><input type="number" value="${k.ordine}" data-campo="ordine" class="corto" aria-label="Ordine"></td>
      <td><input type="checkbox" data-campo="attivo"${k.attivo ? ' checked' : ''} aria-label="Attiva"></td>
      <td><button class="pulsante pulsante--piccolo" data-azione="salva-voce" data-tabella="caratteristiche" data-id="${k.id}">Salva</button></td>
    </tr>`;

  return `
  <section class="riquadro">
    <h3>Modelli</h3>
    <p class="tenue piccolo">"Ordine" decide la posizione nel menu (numero più basso = più in alto). Togli la spunta "Attivo" per nascondere un modello dal modulo senza perdere gli annunci vecchi.</p>
    <div class="tabella-scorre"><table class="tabella">
      <thead><tr><th>Nome</th><th>Tipo</th><th>Ordine</th><th>Attivo</th><th></th></tr></thead>
      <tbody>${stato.modelli.map(rigaModello).join('')}</tbody>
      <tfoot><tr>
        <td><input type="text" id="nuovo-modello" placeholder="Nuovo modello…" maxlength="80"></td>
        <td><select id="nuovo-modello-tipo">${Object.entries(TIPI).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></td>
        <td colspan="3"><button class="pulsante pulsante--piccolo" data-azione="aggiungi-modello">+ Aggiungi</button></td>
      </tr></tfoot>
    </table></div>
  </section>

  <section class="riquadro">
    <h3>Caratteristiche</h3>
    <div class="tabella-scorre"><table class="tabella">
      <thead><tr><th>Nome</th><th>Ordine</th><th>Attiva</th><th></th></tr></thead>
      <tbody>${stato.caratteristiche.map(rigaCaratt).join('')}</tbody>
      <tfoot><tr>
        <td><input type="text" id="nuova-caratt" placeholder="Nuova caratteristica…" maxlength="60"></td>
        <td colspan="3"><button class="pulsante pulsante--piccolo" data-azione="aggiungi-caratt">+ Aggiungi</button></td>
      </tr></tfoot>
    </table></div>
  </section>`;
}

// ---------- Impostazioni ----------
function vistaImpostazioni() {
  const ultimo = localStorage.getItem('ultimoBackup');
  return `
  <section class="riquadro">
    <h3>Tema del sito</h3>
    <p class="tenue piccolo">Vale per tutti i visitatori.</p>
    <div class="scelte">
      <label class="scelta"><input type="radio" name="tema" value="A"${stato.tema === 'A' ? ' checked' : ''}><span>Tema A · Blu notte e rosso</span></label>
      <label class="scelta"><input type="radio" name="tema" value="B"${stato.tema === 'B' ? ' checked' : ''}><span>Tema B · Luna park di notte</span></label>
    </div>
    <p><button class="pulsante pulsante--piccolo" data-azione="salva-tema">Salva tema</button></p>
  </section>

  <section class="riquadro">
    <h3>Backup</h3>
    <p>Scarica un file ZIP con tutti gli annunci, i dati dei venditori e le foto. <strong>Fallo una volta al mese</strong> e conservalo in un posto sicuro (contiene dati personali).</p>
    <p class="tenue piccolo">${ultimo ? `Ultimo backup da questo computer: ${data(ultimo)}` : 'Nessun backup ancora fatto da questo computer.'}</p>
    <button class="pulsante" data-azione="backup">💾 Scarica backup</button>
    <p class="invio__stato" id="stato-backup" aria-live="polite"></p>
  </section>

  <section class="riquadro zona-pericolo">
    <h3>Diritto all'oblio</h3>
    <p>Se un venditore chiede di cancellare i suoi dati, scrivi qui la sua email: verranno cancellati definitivamente lui, tutti i suoi annunci e tutte le foto.</p>
    <div class="campo"><label for="oblio-email">Email del venditore</label>
      <input type="email" id="oblio-email"></div>
    <p><button class="pulsante pulsante--pericolo" data-azione="oblio-cerca">Cerca e cancella…</button></p>
  </section>`;
}

// =====================================================================
//  Operazioni sulle foto
// =====================================================================
async function pubblicaFoto(f, annuncioId) {
  const { data: blob, error } = await supabase.storage.from(BUCKET_PRIVATO).download(f.path_privato);
  if (error) throw new Error('Non riesco a leggere una foto: ' + error.message);
  const marcata = await conFiligrana(blob);
  const percorso = `${annuncioId}/${crypto.randomUUID()}.jpg`;
  const su = await supabase.storage.from(BUCKET_PUBBLICO).upload(percorso, marcata, { contentType: 'image/jpeg' });
  if (su.error) throw new Error('Pubblicazione foto non riuscita: ' + su.error.message);
  const ag = await supabase.from('foto').update({ path_pubblico: percorso }).eq('id', f.id);
  if (ag.error) throw ag.error;
}

async function pubblicaTutteLeFoto(a) {
  const mancanti = a.foto.filter((f) => !f.path_pubblico);
  for (let i = 0; i < mancanti.length; i++) {
    attesa(`Applico il logo alle foto… ${i + 1} di ${mancanti.length}`);
    await pubblicaFoto(mancanti[i], a.id);
  }
}

async function ritiraFotoPubbliche(a) {
  const percorsi = a.foto.map((f) => f.path_pubblico).filter(Boolean);
  if (!percorsi.length) return;
  await supabase.storage.from(BUCKET_PUBBLICO).remove(percorsi);
  await supabase.from('foto').update({ path_pubblico: null }).eq('annuncio_id', a.id);
}

async function eliminaAnnuncio(a) {
  const privati = a.foto.map((f) => f.path_privato);
  const pubblici = a.foto.map((f) => f.path_pubblico).filter(Boolean);
  if (privati.length) await supabase.storage.from(BUCKET_PRIVATO).remove(privati);
  if (pubblici.length) await supabase.storage.from(BUCKET_PUBBLICO).remove(pubblici);
  const { error } = await supabase.from('annunci').delete().eq('id', a.id);
  if (error) throw error;
}

// =====================================================================
//  Email (attivate nel passo dedicato: per ora non fanno nulla)
// =====================================================================
async function notifica(evento, id) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/notifica', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ evento, id }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// =====================================================================
//  Azioni (pulsanti)
// =====================================================================
function leggiScheda() {
  const f = app.querySelector('#form-annuncio');
  if (!f.reportValidity()) return null;
  const d = new FormData(f);
  const modello = d.get('modello');
  const prezzo = d.get('prezzo');
  const annuncioDati = {
    tipo: d.get('tipo'),
    modello_id: modello === 'altro' ? null : Number(modello),
    modello_altro: (d.get('modello_altro') || '').trim() || null,
    anno: Number(d.get('anno')),
    quantita: Number(d.get('quantita')),
    condizione: d.get('condizione'),
    disponibile_da: d.get('disponibile_da'),
    paese: d.get('paese'),
    prezzo: prezzo === '' ? null : Number(prezzo),
    mostra_prezzo: d.get('mostra_prezzo') === 'on' && prezzo !== '',
    caratteristiche: d.getAll('caratteristiche').map(Number),
    note: (d.get('note') || '').trim() || null,
  };
  if (annuncioDati.modello_id === null && !annuncioDati.modello_altro) {
    avviso('Scegli un modello o scrivilo nel campo "Modello scritto a mano".');
    return null;
  }
  const contatto = d.has('nome') ? {
    nome: d.get('nome').trim(), email: d.get('email').trim().toLowerCase(), telefono: d.get('telefono').trim() || null,
  } : null;
  return { annuncioDati, contatto };
}

async function salvaScheda(a) {
  const letti = leggiScheda();
  if (!letti) return false;
  const r1 = await supabase.from('annunci').update(letti.annuncioDati).eq('id', a.id);
  if (r1.error) throw r1.error;
  if (letti.contatto) {
    const r2 = await supabase.from('contatti_venditori').update(letti.contatto).eq('annuncio_id', a.id);
    if (r2.error) throw r2.error;
  }
  return true;
}

async function cambiaStato(a, campi) {
  const { error } = await supabase.from('annunci').update(campi).eq('id', a.id);
  if (error) throw error;
}

const azioni = {
  async esci() { await supabase.auth.signOut(); mostraAccesso(); },
  vista(b) { stato.vista = b.dataset.vista; disegna(); scrollTo(0, 0); },
  filtro(b) { stato.filtro = b.dataset.filtro; disegna(); },
  async apri(b) {
    stato.vista = 'scheda'; stato.schedaId = Number(b.dataset.id);
    await preparaMiniature(); disegna(); scrollTo(0, 0);
  },

  async salva(b) {
    if (await salvaScheda(annuncio(b.dataset.id))) { avviso('Modifiche salvate ✓'); await ricarica(); }
  },

  async approva(b) {
    const a = annuncio(b.dataset.id);
    if (!(await salvaScheda(a))) return;
    await pubblicaTutteLeFoto(a);
    await cambiaStato(a, {
      stato: 'approvato', pubblicato_il: a.pubblicato_il ?? new Date().toISOString(),
      rifiutato_il: null, archiviato_il: null,
    });
    const email = await notifica('approvato', a.id);
    avviso(`${a.codice} pubblicato nel catalogo ✓${email ? ' · Email inviata al venditore' : ' · (email al venditore non ancora attiva)'}`);
    await ricarica();
  },

  async rifiuta(b) {
    const a = annuncio(b.dataset.id);
    if (!confirm(`Rifiutare ${a.codice}? Il venditore riceverà un'email.`)) return;
    await ritiraFotoPubbliche(a);
    await cambiaStato(a, { stato: 'rifiutato', rifiutato_il: new Date().toISOString() });
    const email = await notifica('rifiutato', a.id);
    avviso(`${a.codice} rifiutato${email ? ' · Email inviata al venditore' : ' · (email al venditore non ancora attiva)'}`);
    await ricarica();
  },

  async venduto(b) {
    const a = annuncio(b.dataset.id);
    const giorno = app.querySelector('#data-vendita').value;
    if (!giorno) return avviso('Indica la data di vendita.');
    await cambiaStato(a, { stato: 'venduto', venduto_il: giorno });
    avviso(`${a.codice} segnato come VENDUTO ✓`);
    await ricarica();
  },

  async disponibile(b) {
    const a = annuncio(b.dataset.id);
    await cambiaStato(a, { pubblicato_il: new Date().toISOString(), scadenza_avvisata_il: null });
    avviso('Rinnovato per altri 6 mesi ✓');
    await ricarica();
  },

  async archivia(b) {
    const a = annuncio(b.dataset.id);
    if (!confirm(`Archiviare ${a.codice}? Sparirà dal sito pubblico.`)) return;
    await ritiraFotoPubbliche(a);
    await cambiaStato(a, { stato: 'archiviato', archiviato_il: new Date().toISOString() });
    avviso(`${a.codice} archiviato`);
    await ricarica();
  },

  async in_attesa(b) {
    const a = annuncio(b.dataset.id);
    await ritiraFotoPubbliche(a);
    await cambiaStato(a, { stato: 'in_attesa', venduto_il: null, rifiutato_il: null, archiviato_il: null });
    avviso(`${a.codice} rimesso in attesa`);
    await ricarica();
  },

  async elimina(b) {
    const a = annuncio(b.dataset.id);
    if (prompt(`Per eliminare DEFINITIVAMENTE ${a.codice} scrivi ELIMINA`) !== 'ELIMINA') return;
    await eliminaAnnuncio(a);
    avviso(`${a.codice} eliminato definitivamente`);
    stato.vista = 'proposte';
    await ricarica();
  },

  async oblio(b) { await eseguiOblio(b.dataset.email); },
  async 'oblio-cerca'() {
    const email = app.querySelector('#oblio-email').value.trim().toLowerCase();
    if (!email) return avviso('Scrivi l\'email del venditore.');
    await eseguiOblio(email);
  },

  async sposta(b) {
    const a = stato.annunci.find((x) => x.foto.some((f) => f.id === Number(b.dataset.id)));
    const i = a.foto.findIndex((f) => f.id === Number(b.dataset.id));
    const j = i + Number(b.dataset.verso);
    if (j < 0 || j >= a.foto.length) return;
    const nuovo = [...a.foto];
    [nuovo[i], nuovo[j]] = [nuovo[j], nuovo[i]];
    await Promise.all(nuovo.map((f, k) => supabase.from('foto').update({ ordine: k + 1 }).eq('id', f.id)));
    await ricarica();
  },

  async 'togli-foto'(b) {
    const a = stato.annunci.find((x) => x.foto.some((f) => f.id === Number(b.dataset.id)));
    const f = a.foto.find((x) => x.id === Number(b.dataset.id));
    if (a.foto.length === 1) return avviso('Un annuncio deve avere almeno una foto.');
    if (!confirm('Eliminare questa foto?')) return;
    await supabase.storage.from(BUCKET_PRIVATO).remove([f.path_privato]);
    if (f.path_pubblico) await supabase.storage.from(BUCKET_PUBBLICO).remove([f.path_pubblico]);
    await supabase.from('foto').delete().eq('id', f.id);
    await ricarica();
  },

  async 'salva-voce'(b) {
    const riga = b.closest('tr');
    const valori = {};
    riga.querySelectorAll('[data-campo]').forEach((el) => {
      valori[el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    });
    if (!valori.nome) return avviso('Il nome non può essere vuoto.');
    const { error } = await supabase.from(b.dataset.tabella).update(valori).eq('id', b.dataset.id);
    if (error) throw new Error(error.code === '23505' ? 'Esiste già una voce con questo nome.' : error.message);
    avviso('Salvato ✓');
    await ricarica();
  },

  async 'aggiungi-modello'() {
    const nome = app.querySelector('#nuovo-modello').value.trim();
    if (!nome) return avviso('Scrivi il nome del nuovo modello.');
    const tipo = app.querySelector('#nuovo-modello-tipo').value;
    const ordine = Math.max(0, ...stato.modelli.filter((m) => m.tipo === tipo).map((m) => m.ordine)) + 1;
    const { error } = await supabase.from('modelli').insert({ nome, tipo, ordine });
    if (error) throw new Error(error.code === '23505' ? 'Questo modello esiste già.' : error.message);
    avviso(`Modello "${nome}" aggiunto ✓`);
    await ricarica();
  },

  async 'aggiungi-caratt'() {
    const nome = app.querySelector('#nuova-caratt').value.trim();
    if (!nome) return avviso('Scrivi il nome della nuova caratteristica.');
    const ordine = Math.max(0, ...stato.caratteristiche.map((k) => k.ordine)) + 1;
    const { error } = await supabase.from('caratteristiche').insert({ nome, ordine });
    if (error) throw new Error(error.code === '23505' ? 'Questa caratteristica esiste già.' : error.message);
    avviso(`Caratteristica "${nome}" aggiunta ✓`);
    await ricarica();
  },

  async 'salva-tema'() {
    const tema = app.querySelector('input[name="tema"]:checked')?.value;
    const { error } = await supabase.from('impostazioni').update({ tema }).eq('id', 1);
    if (error) throw error;
    sessionStorage.setItem('tema', tema);
    document.documentElement.dataset.tema = tema;
    avviso(`Tema ${tema} attivo per tutti i visitatori ✓`);
    stato.tema = tema;
  },

  async backup() { await scaricaBackup(); },
};

async function eseguiOblio(email) {
  const suoi = stato.annunci.filter((a) => a.contatto && a.contatto.email.toLowerCase() === email.toLowerCase());
  if (!suoi.length) return avviso('Nessun annuncio trovato con questa email.');
  const elenco = suoi.map((a) => a.codice).join(', ');
  if (prompt(`Verranno cancellati DEFINITIVAMENTE il venditore ${email} e ${suoi.length} annunci (${elenco}) con tutte le foto.\n\nPer confermare scrivi CANCELLA`) !== 'CANCELLA') return;
  for (const a of suoi) await eliminaAnnuncio(a);
  avviso(`Cancellati il venditore e ${suoi.length} annunci ✓`);
  stato.vista = 'proposte';
  await ricarica();
}

// ---------- Backup ZIP ----------
function csv(righe) {
  const cella = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + righe.map((r) => r.map(cella).join(';')).join('\r\n');
}

async function scaricaBackup() {
  const scritta = app.querySelector('#stato-backup');
  const file = {};
  const a = stato.annunci;

  file['annunci.csv'] = strToU8(csv([
    ['Codice', 'Stato', 'Tipo', 'Modello', 'Anno', 'Quantità', 'Condizione', 'Disponibile da', 'Paese',
      'Prezzo per vettura', 'Prezzo visibile', 'Caratteristiche', 'Note', 'Ricevuto', 'Pubblicato', 'Venduto il',
      'Venditore', 'Email', 'Telefono', 'Consenso privacy'],
    ...a.map((x) => [x.codice, STATI[x.stato], TIPI[x.tipo], nomeModello(x, stato.modelli), x.anno, x.quantita,
      CONDIZIONI[x.condizione], x.disponibile_da, PAESI[x.paese], x.prezzo, x.mostra_prezzo ? 'sì' : 'no',
      x.caratteristiche.map((id) => stato.caratteristiche.find((k) => k.id === id)?.nome).join(', '), x.note,
      x.creato_il, x.pubblicato_il, x.venduto_il, x.contatto?.nome, x.contatto?.email, x.contatto?.telefono,
      x.contatto?.consenso_il]),
  ]));
  file['dati-completi.json'] = strToU8(JSON.stringify({
    esportato_il: new Date().toISOString(), annunci: a, modelli: stato.modelli, caratteristiche: stato.caratteristiche,
  }, null, 2));

  const tutte = a.flatMap((x) => x.foto.map((f, i) => ({ x, f, i })));
  for (let n = 0; n < tutte.length; n++) {
    const { x, f, i } = tutte[n];
    scritta.textContent = `Scarico le foto… ${n + 1} di ${tutte.length}`;
    const { data: blob } = await supabase.storage.from(BUCKET_PRIVATO).download(f.path_privato);
    if (blob) file[`foto/${x.codice}/${String(i + 1).padStart(2, '0')}.jpg`] = new Uint8Array(await blob.arrayBuffer());
  }

  scritta.textContent = 'Preparo il file ZIP…';
  const zip = zipSync(file, { level: 0 });
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `backup-usati-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  localStorage.setItem('ultimoBackup', new Date().toISOString());
  scritta.textContent = `Backup scaricato ✓ (${a.length} annunci, ${tutte.length} foto). Lo trovi nella cartella Download.`;
}

// ---------- Aggiunta foto dalla scheda ----------
app.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'aggiungi-foto') return;
  const a = annuncio(ev.target.dataset.id);
  const files = [...ev.target.files];
  try {
    let ordine = Math.max(0, ...a.foto.map((f) => f.ordine));
    for (let i = 0; i < files.length; i++) {
      attesa(`Carico la foto ${i + 1} di ${files.length}…`);
      const blob = await comprimiFoto(files[i]);
      const percorso = `admin/${a.id}/${crypto.randomUUID()}.jpg`;
      const su = await supabase.storage.from(BUCKET_PRIVATO).upload(percorso, blob, { contentType: 'image/jpeg' });
      if (su.error) throw su.error;
      const { data: nuova, error } = await supabase.from('foto')
        .insert({ annuncio_id: a.id, path_privato: percorso, ordine: ++ordine }).select().single();
      if (error) throw error;
      if (a.stato === 'approvato' || a.stato === 'venduto') await pubblicaFoto(nuova, a.id);
    }
    avviso('Foto aggiunte ✓');
  } catch (err) {
    avviso('Errore: ' + (err.message ?? err));
  } finally {
    fineAttesa();
    await ricarica();
  }
});

// ---------- Gestione clic con blocco durante le operazioni ----------
let occupato = false;
app.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-azione]');
  if (!b || occupato || !azioni[b.dataset.azione]) return;
  ev.preventDefault();
  occupato = true;
  b.disabled = true;
  try {
    await azioni[b.dataset.azione](b);
  } catch (err) {
    avviso('Errore: ' + (err.message ?? err));
  } finally {
    occupato = false;
    b.disabled = false;
    fineAttesa();
  }
});

// ---------- Messaggi ----------
let tavola;
function avviso(testo) {
  tavola ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast', role: 'status' }));
  tavola.textContent = testo;
  tavola.classList.add('is-visibile');
  clearTimeout(tavola._t);
  tavola._t = setTimeout(() => tavola.classList.remove('is-visibile'), 4500);
}
function attesa(testo) { avviso('⏳ ' + testo); clearTimeout(tavola._t); }
function fineAttesa() { if (tavola?.textContent.startsWith('⏳')) tavola.classList.remove('is-visibile'); }

avvio();
