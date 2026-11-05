import { avviaPagina, AUTOSCONTRO_SVG } from './layout.js';
import { supabase } from './supabase.js';
import { comprimiFoto } from './foto.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

avviaPagina({ attiva: 'proponi' });

const MAX_FOTO = 20;
const inizio = Date.now();
const $ = (id) => document.getElementById(id);
const modulo = $('modulo');
const fotoScelte = []; // { id, blob, url }

// Icone autoscontro nei pulsanti Adulti / Mini
document.querySelectorAll('.ico-tipo').forEach((svg) => {
  svg.outerHTML = AUTOSCONTRO_SVG.replace('class="autoscontro"', 'class="autoscontro-ico"');
});
$('conferma-auto').innerHTML = AUTOSCONTRO_SVG;

// Valori predefiniti
const annoCorrente = new Date().getFullYear();
$('anno').max = annoCorrente + 1;
$('disponibile_da').value = new Date().toISOString().slice(0, 10);

// ---------- Liste dall'archivio ----------
let elencoModelli = [];

function riempiModelli() {
  const tipo = modulo.querySelector('input[name="tipo"]:checked')?.value;
  const sel = $('modello');
  const prima = sel.value;
  if (!tipo) {
    sel.innerHTML = '<option value="">Scegli prima il tipo di vettura</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    const delTipo = elencoModelli.filter((m) => m.tipo === tipo);
    sel.innerHTML = '<option value="">Scegli il modello…</option>' +
      delTipo.map((m) => `<option value="${m.id}">${escapa(m.nome)}</option>`).join('') +
      '<option value="altro">Altro (scrivilo tu)</option>';
    if (delTipo.length === 0) sel.value = 'altro'; // nessun modello in lista: si scrive a mano
    else if ([...sel.options].some((o) => o.value === prima)) sel.value = prima;
  }
  sel.dispatchEvent(new Event('change'));
}

modulo.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', riempiModelli));

async function caricaListe() {
  const [modelli, caratteristiche] = await Promise.all([
    supabase.from('modelli').select('id,nome,tipo').eq('attivo', true).order('ordine').order('nome'),
    supabase.from('caratteristiche').select('id,nome').eq('attivo', true).order('ordine').order('nome'),
  ]);

  elencoModelli = modelli.data ?? [];
  riempiModelli();

  $('caratteristiche').innerHTML = (caratteristiche.data ?? [])
    .map((c) => `<label class="scelta"><input type="checkbox" name="caratteristiche" value="${c.id}"><span>${escapa(c.nome)}</span></label>`)
    .join('');

  if (modelli.error || caratteristiche.error) {
    mostraErrore('Problema di collegamento. Ricarica la pagina tra qualche istante.');
  }
}
caricaListe();

$('modello').addEventListener('change', (e) => {
  const altro = e.target.value === 'altro';
  $('campo-modello-altro').hidden = !altro;
  $('modello_altro').required = altro;
  if (altro) $('modello_altro').focus();
});

$('prezzo').addEventListener('input', (e) => {
  const vuoto = e.target.value === '';
  $('mostra_prezzo').disabled = vuoto;
  if (vuoto) $('mostra_prezzo').checked = false;
});

// ---------- Foto ----------
const inputFoto = $('foto');
const zona = $('zona-foto');

inputFoto.addEventListener('change', () => {
  aggiungiFoto([...inputFoto.files]);
  inputFoto.value = '';
});
['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('is-sopra'); }));
['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('is-sopra')));
zona.addEventListener('drop', (e) => { e.preventDefault(); aggiungiFoto([...e.dataTransfer.files]); });

async function aggiungiFoto(files) {
  nascondiErrore();
  const spazio = MAX_FOTO - fotoScelte.length;
  if (files.length > spazio) mostraErrore(`Puoi caricare al massimo ${MAX_FOTO} foto: ho tenuto le prime ${Math.max(spazio, 0)}.`);
  for (const file of files.slice(0, Math.max(spazio, 0))) {
    const voce = { id: crypto.randomUUID(), blob: null, url: null };
    fotoScelte.push(voce);
    disegnaAnteprime();
    try {
      voce.blob = await comprimiFoto(file);
      voce.url = URL.createObjectURL(voce.blob);
    } catch (err) {
      fotoScelte.splice(fotoScelte.indexOf(voce), 1);
      mostraErrore(err.message);
    }
    disegnaAnteprime();
  }
}

function disegnaAnteprime() {
  $('anteprime').innerHTML = fotoScelte.map((f, i) => `
    <div class="anteprima${f.url ? '' : ' is-lavorazione'}">
      ${f.url ? `<img src="${f.url}" alt="Foto ${i + 1}">` : ''}
      ${i === 0 && f.url ? '<span class="anteprima__prima">Copertina</span>' : ''}
      <button type="button" class="anteprima__togli" data-id="${f.id}" aria-label="Togli la foto ${i + 1}">✕</button>
    </div>`).join('');
}

$('anteprime').addEventListener('click', (e) => {
  const id = e.target.closest('.anteprima__togli')?.dataset.id;
  if (!id) return;
  const i = fotoScelte.findIndex((f) => f.id === id);
  if (i >= 0) {
    if (fotoScelte[i].url) URL.revokeObjectURL(fotoScelte[i].url);
    fotoScelte.splice(i, 1);
    disegnaAnteprime();
  }
});

// ---------- Invio ----------
modulo.addEventListener('submit', async (e) => {
  e.preventDefault();
  nascondiErrore();

  if (!modulo.checkValidity()) {
    const primo = modulo.querySelector(':invalid');
    mostraErrore(messaggioCampo(primo));
    primo?.focus();
    return;
  }
  if (fotoScelte.length === 0) return mostraErrore('Aggiungi almeno una foto della vettura.');
  if (fotoScelte.some((f) => !f.blob)) return mostraErrore('Attendi che le foto finiscano di caricarsi.');

  const dati = new FormData(modulo);
  const bottone = $('invia');
  bottone.disabled = true;

  try {
    // 1. Carica le foto nel deposito privato
    const percorsi = [];
    for (let i = 0; i < fotoScelte.length; i++) {
      stato(`Carico le foto… ${i + 1} di ${fotoScelte.length}`);
      const percorso = `incoming/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('foto-private')
        .upload(percorso, fotoScelte[i].blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error('Caricamento delle foto non riuscito. Controlla la connessione e riprova.');
      percorsi.push(percorso);
    }

    // 2. Invia la proposta
    stato('Invio la proposta…');
    const modello = dati.get('modello');
    const prezzo = dati.get('prezzo');
    const { data: codice, error } = await supabase.rpc('invia_proposta', {
      p_tipo: dati.get('tipo'),
      p_modello_id: modello === 'altro' ? null : Number(modello),
      p_modello_altro: modello === 'altro' ? dati.get('modello_altro') : null,
      p_anno: Number(dati.get('anno')),
      p_quantita: Number(dati.get('quantita')),
      p_condizione: dati.get('condizione'),
      p_disponibile_da: dati.get('disponibile_da'),
      p_paese: dati.get('paese'),
      p_prezzo: prezzo === '' ? null : Number(prezzo),
      p_mostra_prezzo: dati.get('mostra_prezzo') === 'on',
      p_caratteristiche: dati.getAll('caratteristiche').map(Number),
      p_note: dati.get('note'),
      p_nome: dati.get('nome'),
      p_email: dati.get('email'),
      p_telefono: dati.get('telefono'),
      p_consenso: dati.get('consenso') === 'on',
      p_foto: percorsi,
      p_trappola: dati.get('sito_web'),
      p_secondi: Math.round((Date.now() - inizio) / 1000),
    });
    if (error) throw new Error(error.message || 'Invio non riuscito. Riprova.');

    // 3. Avviso a CS Amusement (se non riesce, la proposta resta comunque salvata)
    fetch(`${SUPABASE_URL}/functions/v1/notifica`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ evento: 'nuova', codice }),
      keepalive: true,
    }).catch(() => {});

    // 4. Conferma
    $('codice').textContent = codice;
    $('pagina-modulo').hidden = true;
    $('pagina-conferma').hidden = false;
    $('pagina-conferma').focus();
    scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    mostraErrore(err.message);
  } finally {
    bottone.disabled = false;
    stato('');
  }
});

// ---------- Utilità ----------
function messaggioCampo(campo) {
  if (!campo) return 'Controlla i campi del modulo.';
  const nomi = {
    tipo: 'Scegli il tipo di vettura: adulti, midi o mini.',
    modello: 'Scegli il modello.',
    modello_altro: 'Scrivi il nome del modello.',
    anno: `Inserisci un anno tra 1950 e ${annoCorrente + 1}.`,
    quantita: 'Inserisci quante vetture vendi (almeno 1).',
    condizione: 'Scegli lo stato della vettura.',
    disponibile_da: 'Indica da quando è disponibile.',
    paese: 'Indica se si trova in Italia o all\'estero.',
    prezzo: 'Il prezzo deve essere un numero positivo.',
    nome: 'Inserisci il tuo nome.',
    email: 'Inserisci un indirizzo email valido.',
    consenso: 'Per inviare devi accettare Informativa Privacy e Condizioni d\'uso.',
  };
  return nomi[campo.name] ?? 'Controlla i campi evidenziati.';
}

function mostraErrore(testo) {
  const box = $('errore');
  box.textContent = testo;
  box.hidden = false;
}
function nascondiErrore() { $('errore').hidden = true; }
function stato(testo) { $('stato-invio').textContent = testo; }
function escapa(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
