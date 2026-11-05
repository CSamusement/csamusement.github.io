// Funzioni comuni a catalogo e pagina di dettaglio
import { SUPABASE_URL } from './config.js';
import { escapa as e } from './dati.js';

export const WHATSAPP = '393332424570';
export const EMAIL_CS = 'ricambi@csamusement.it';

export const urlFoto = (percorso) =>
  `${SUPABASE_URL}/storage/v1/object/public/foto-pubbliche/${percorso}`;

export const linkWhatsApp = (codice) =>
  `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Ciao, mi interessa l'annuncio ${codice}`)}`;

export const linkEmail = (codice) =>
  `mailto:${EMAIL_CS}?subject=${encodeURIComponent(`Annuncio ${codice}`)}&body=${encodeURIComponent(`Ciao, mi interessa l'annuncio ${codice}.\n\n`)}`;

export const nomeTransizione = (codice) => `foto-${codice.replace(/[^a-zA-Z0-9-]/g, '')}`;

export function etichetteCaratteristiche(a, caratteristiche) {
  return a.caratteristiche
    .map((id) => caratteristiche.find((k) => k.id === id)?.nome)
    .filter(Boolean)
    .map((n) => `<span class="etichetta-auto">${e(n)}</span>`)
    .join('');
}

export function disponibilita(a) {
  const oggi = new Date().toISOString().slice(0, 10);
  if (a.disponibile_da <= oggi) return 'Disponibile subito';
  return `Disponibile dal ${new Date(a.disponibile_da).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export const ICONA_WHATSAPP = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5.1 5.24-1.37A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.1.82.83-3.03-.2-.31a8.2 8.2 0 1 1 6.95 3.85Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.17.25-.64.8-.78.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-3.34-2.92c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43l-.75-1.8c-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.75 2.75 0 0 0-.86 2.04 4.8 4.8 0 0 0 1 2.54c.12.16 1.73 2.64 4.2 3.7 1.56.67 2.17.73 2.95.62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.29Z"/></svg>`;
