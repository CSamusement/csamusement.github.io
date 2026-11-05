// =====================================================================
//  Funzione "notifica": invia le email automatiche con Resend
//   - evento "nuova"     : avviso a CS Amusement per una nuova proposta (dal modulo pubblico)
//   - evento "approvato" : email al venditore (solo l'admin può chiederla)
//   - evento "rifiutato" : email al venditore (solo l'admin può chiederla)
//  Da incollare in Supabase > Edge Functions > Deploy a new function > Via Editor
//  Nome della funzione: notifica
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const MITTENTE = Deno.env.get('MITTENTE') ?? 'CS Amusement <onboarding@resend.dev>';
const EMAIL_ADMIN = Deno.env.get('EMAIL_ADMIN') ?? 'ricambi@csamusement.it';
const SITO = (Deno.env.get('SITO_URL') ?? 'https://csamusement.github.io').replace(/\/$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (dati: unknown, stato = 200) =>
  new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TIPI: Record<string, string> = { adulti: 'Adulti', midi: 'Midi', mini: 'Mini' };
const CONDIZIONI: Record<string, string> = { ottimo: 'Ottimo', buono: 'Buono', da_revisionare: 'Da revisionare' };
const PAESI: Record<string, string> = { italia: 'Italia', estero: 'Estero' };

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

const pulsante = (href: string, testo: string) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#e1251b;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px;display:inline-block">${testo}</a></p>`;

async function inviaEmail(a: string, oggetto: string, html: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MITTENTE, to: [a], subject: oggetto, html, reply_to: EMAIL_ADMIN }),
  });
  if (!r.ok) throw new Error(`Resend: ${r.status} ${await r.text()}`);
}

function riepilogo(a: any) {
  const modello = a.modelli?.nome ?? a.modello_altro ?? 'Modello';
  return `<table role="presentation" cellpadding="6" style="border-collapse:collapse;font-size:15px;margin:8px 0">
    <tr><td style="color:#5a6582">Codice</td><td><b>${esc(a.codice)}</b></td></tr>
    <tr><td style="color:#5a6582">Modello</td><td>${esc(modello)} (${TIPI[a.tipo] ?? ''})</td></tr>
    <tr><td style="color:#5a6582">Anno</td><td>${esc(a.anno)}</td></tr>
    <tr><td style="color:#5a6582">Quantità</td><td>${esc(a.quantita)}</td></tr>
    <tr><td style="color:#5a6582">Stato</td><td>${CONDIZIONI[a.condizione] ?? ''}</td></tr>
    <tr><td style="color:#5a6582">Dove</td><td>${PAESI[a.paese] ?? ''}</td></tr>
  </table>`;
}

async function eAdmin(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (!email) return false;
  const { data: riga } = await db.from('amministratori').select('email').ilike('email', email).maybeSingle();
  return !!riga;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ errore: 'Metodo non consentito' }, 405);

  let corpo: any;
  try { corpo = await req.json(); } catch { return risposta({ errore: 'Richiesta non valida' }, 400); }
  const campi = 'id, codice, tipo, anno, quantita, condizione, paese, modello_altro, stato, creato_il, avviso_admin_il, modelli(nome), contatti_venditori(nome, email)';

  try {
    // ---------- Nuova proposta → avviso a CS Amusement ----------
    if (corpo.evento === 'nuova') {
      const { data: a } = await db.from('annunci').select(campi).eq('codice', String(corpo.codice ?? '')).maybeSingle();
      const recente = a && Date.now() - new Date(a.creato_il).getTime() < 60 * 60 * 1000;
      if (!a || a.stato !== 'in_attesa' || a.avviso_admin_il || !recente) return risposta({ ok: true, inviata: false });
      const { count } = await db.from('foto').select('id', { count: 'exact', head: true }).eq('annuncio_id', a.id);
      await inviaEmail(EMAIL_ADMIN, `Nuova proposta ${a.codice} da approvare`, impagina(
        `Nuova proposta: ${esc(a.codice)}`,
        `<p>È arrivata una nuova proposta di vendita. Non è ancora visibile al pubblico.</p>
         ${riepilogo(a)}<p style="color:#5a6582">Foto caricate: ${count ?? 0}</p>
         ${pulsante(`${SITO}/admin.html`, 'Apri l\'area admin')}`,
      ));
      await db.from('annunci').update({ avviso_admin_il: new Date().toISOString() }).eq('id', a.id);
      return risposta({ ok: true, inviata: true });
    }

    // ---------- Approvato / rifiutato → email al venditore ----------
    if (corpo.evento === 'approvato' || corpo.evento === 'rifiutato') {
      if (!(await eAdmin(req))) return risposta({ errore: 'Non autorizzato' }, 401);
      const { data: a } = await db.from('annunci').select(campi).eq('id', Number(corpo.id)).maybeSingle();
      const c: any = Array.isArray(a?.contatti_venditori) ? a?.contatti_venditori[0] : a?.contatti_venditori;
      if (!a || !c?.email) return risposta({ ok: true, inviata: false });
      const saluto = `<p>Ciao ${esc(c.nome)},</p>`;

      if (corpo.evento === 'approvato') {
        await inviaEmail(c.email, `Il tuo annuncio ${a.codice} è online`, impagina(
          'Il tuo annuncio è stato pubblicato 🎉',
          `${saluto}<p>CS Amusement ha approvato la tua proposta: ora è visibile nel catalogo degli autoscontri usati.</p>
           ${riepilogo(a)}
           ${pulsante(`${SITO}/annuncio.html?c=${encodeURIComponent(a.codice)}`, 'Guarda l\'annuncio')}
           <p>Gli interessati contatteranno CS Amusement, che ti terrà aggiornato. Se le vetture non sono più disponibili, rispondi a questa email.</p>`,
        ));
      } else {
        await inviaEmail(c.email, `La tua proposta ${a.codice}`, impagina(
          'Esito della tua proposta',
          `${saluto}<p>Grazie per aver proposto le tue vetture. Questa volta CS Amusement non può pubblicare la proposta <b>${esc(a.codice)}</b>.</p>
           <p>Per qualsiasi domanda puoi rispondere direttamente a questa email.</p>`,
        ));
      }
      return risposta({ ok: true, inviata: true });
    }

    return risposta({ errore: 'Evento sconosciuto' }, 400);
  } catch (err) {
    console.error(err);
    return risposta({ errore: 'Invio non riuscito' }, 500);
  }
});
