// =====================================================================
//  Funzione "giornaliero": lavori automatici, chiamata ogni mattina da GitHub
//   1. Annunci pubblicati da 6 mesi → email al venditore + riepilogo a CS Amusement
//   2. Proposte rifiutate, annunci venduti o archiviati da oltre 12 mesi → cancellati con dati e foto
//   3. Foto caricate da moduli abbandonati (oltre 24 ore) → cancellate
//  Da incollare in Supabase > Edge Functions > Deploy a new function > Via Editor
//  Nome della funzione: giornaliero
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const MITTENTE = Deno.env.get('MITTENTE') ?? 'CS Amusement <onboarding@resend.dev>';
const EMAIL_ADMIN = Deno.env.get('EMAIL_ADMIN') ?? 'ricambi@csamusement.it';
const SITO = (Deno.env.get('SITO_URL') ?? 'https://csamusement.github.io').replace(/\/$/, '');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function impagina(titolo: string, corpo: string) {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f5f6fb;font-family:Arial,Helvetica,sans-serif;color:#0d1b3e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
    <tr><td style="background:#0d1b3e;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">CS Amusement <span style="color:#e1251b">·</span> Usato</td></tr>
    <tr><td style="padding:24px;font-size:16px;line-height:1.55">
      <h1 style="font-size:22px;margin:0 0 14px">${titolo}</h1>
      ${corpo}
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f5f6fb;font-size:12px;color:#5a6582">
      CS Amusement · <a href="mailto:${EMAIL_ADMIN}" style="color:#5a6582">${EMAIL_ADMIN}</a> · <a href="${SITO}/privacy.html" style="color:#5a6582">Informativa privacy</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

async function inviaEmail(a: string, oggetto: string, html: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MITTENTE, to: [a], subject: oggetto, html, reply_to: EMAIL_ADMIN }),
  });
  if (!r.ok) throw new Error(`Resend: ${r.status} ${await r.text()}`);
}

const fa = (mesi: number) => { const d = new Date(); d.setMonth(d.getMonth() - mesi); return d.toISOString(); };

// ---------- 1. Scadenza 6 mesi ----------
async function scadenze() {
  const { data } = await db.from('annunci')
    .select('id, codice, modello_altro, modelli(nome), contatti_venditori(nome, email)')
    .eq('stato', 'approvato').is('scadenza_avvisata_il', null).lte('pubblicato_il', fa(6));
  const avvisati: string[] = [];
  for (const a of data ?? []) {
    const c: any = Array.isArray(a.contatti_venditori) ? a.contatti_venditori[0] : a.contatti_venditori;
    const modello = (a as any).modelli?.nome ?? a.modello_altro ?? '';
    try {
      if (c?.email) {
        await inviaEmail(c.email, `Il tuo annuncio ${a.codice} è ancora disponibile?`, impagina(
          'Le tue vetture sono ancora disponibili?',
          `<p>Ciao ${esc(c.nome)},</p>
           <p>il tuo annuncio <b>${esc(a.codice)}</b> ${modello ? `(${esc(modello)}) ` : ''}è online da 6 mesi.</p>
           <p><b>Le vetture sono ancora disponibili?</b> Rispondi a questa email con un semplice "sì" oppure "no, vendute": aggiorneremo noi l'annuncio.</p>
           <p><a href="${SITO}/annuncio.html?c=${encodeURIComponent(a.codice)}" style="color:#e1251b;font-weight:bold">Guarda l'annuncio</a></p>`,
        ));
      }
      await db.from('annunci').update({ scadenza_avvisata_il: new Date().toISOString() }).eq('id', a.id);
      avvisati.push(a.codice);
    } catch (err) { console.error('Scadenza', a.codice, err); }
  }
  if (avvisati.length) {
    await inviaEmail(EMAIL_ADMIN, `${avvisati.length} annunci online da 6 mesi da verificare`, impagina(
      'Annunci da verificare',
      `<p>Questi annunci sono online da 6 mesi. Abbiamo scritto ai venditori per chiedere se sono ancora disponibili:</p>
       <p><b>${avvisati.map(esc).join(', ')}</b></p>
       <p>Nell'area admin li trovi in <b>"Da verificare (6 mesi)"</b>.</p>
       <p><a href="${SITO}/admin.html" style="color:#e1251b;font-weight:bold">Apri l'area admin</a></p>`,
    ));
  }
  return avvisati.length;
}

// ---------- 2. Rifiutati, venduti e archiviati da oltre 12 mesi ----------
async function cancellaVecchi(stato: string, colonna: string) {
  const { data, error } = await db.from('annunci').select('id, foto(path_privato, path_pubblico)')
    .eq('stato', stato).lte(colonna, fa(12));
  if (error) throw error;
  for (const a of data ?? []) {
    const privati = (a.foto ?? []).map((f: any) => f.path_privato);
    const pubblici = (a.foto ?? []).map((f: any) => f.path_pubblico).filter(Boolean);
    if (privati.length) await db.storage.from('foto-private').remove(privati);
    if (pubblici.length) await db.storage.from('foto-pubbliche').remove(pubblici);
    await db.from('annunci').delete().eq('id', a.id);
  }
  return data?.length ?? 0;
}

// ---------- 3. Foto di moduli abbandonati ----------
async function pulisciFotoOrfane() {
  const { data: usate } = await db.from('foto').select('path_privato');
  const inUso = new Set((usate ?? []).map((f) => f.path_privato));
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  const daTogliere: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await db.storage.from('foto-private').list('incoming', { limit: 1000, offset });
    if (!data?.length) break;
    for (const o of data) {
      const percorso = `incoming/${o.name}`;
      if (!inUso.has(percorso) && o.created_at && new Date(o.created_at).getTime() < limite) daTogliere.push(percorso);
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < daTogliere.length; i += 100) {
    await db.storage.from('foto-private').remove(daTogliere.slice(i, i + 100));
  }
  return daTogliere.length;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Non autorizzato', { status: 401 });
  }
  const esito: Record<string, unknown> = {};
  for (const [nome, lavoro] of [
    ['scadenze_avvisate', scadenze],
    ['rifiutati_cancellati', () => cancellaVecchi('rifiutato', 'rifiutato_il')],
    ['venduti_cancellati', () => cancellaVecchi('venduto', 'venduto_il')],
    ['archiviati_cancellati', () => cancellaVecchi('archiviato', 'archiviato_il')],
    ['foto_orfane_cancellate', pulisciFotoOrfane],
  ] as const) {
    try { esito[nome] = await lavoro(); } catch (err) { console.error(nome, err); esito[nome] = 'errore'; }
  }
  return new Response(JSON.stringify(esito), { headers: { 'Content-Type': 'application/json' } });
});
