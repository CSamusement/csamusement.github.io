// Etichette e funzioni comuni a catalogo e admin

export const TIPI = { adulti: 'Adulti', midi: 'Midi', mini: 'Mini' };
export const CONDIZIONI = { ottimo: 'Ottimo', buono: 'Buono', da_revisionare: 'Da revisionare' };
export const PAESI = { italia: 'Italia', estero: 'Estero' };
export const STATI = {
  in_attesa: 'In attesa',
  approvato: 'Pubblicato',
  rifiutato: 'Rifiutato',
  venduto: 'Venduto',
  archiviato: 'Archiviato',
};

export const MESI_SCADENZA = 6;

export function escapa(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function data(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function euro(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function prezzoTesto(a) {
  return a.mostra_prezzo && a.prezzo != null ? `${euro(a.prezzo)} cad.` : 'Trattativa riservata';
}

export function nomeModello(a, modelli) {
  if (a.modello_id) return modelli.find((m) => m.id === a.modello_id)?.nome ?? a.modello_altro ?? 'Modello';
  return a.modello_altro || 'Modello non indicato';
}

export function inScadenza(a) {
  if (a.stato !== 'approvato' || !a.pubblicato_il) return false;
  const limite = new Date(a.pubblicato_il);
  limite.setMonth(limite.getMonth() + MESI_SCADENZA);
  return new Date() >= limite;
}
