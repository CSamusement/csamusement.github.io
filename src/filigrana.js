// Applica il logo CS Amusement come filigrana in basso a destra.
let logo;

async function caricaLogo() {
  if (logo) return logo;
  const img = new Image();
  img.src = '/logo.png';
  await img.decode();
  logo = img;
  return logo;
}

export async function conFiligrana(blob) {
  const [foto, marchio] = await Promise.all([createImageBitmap(blob), caricaLogo()]);
  const tela = document.createElement('canvas');
  tela.width = foto.width;
  tela.height = foto.height;
  const ctx = tela.getContext('2d');
  ctx.drawImage(foto, 0, 0);
  foto.close?.();

  const lato = Math.round(Math.min(tela.width, tela.height) * 0.16);
  const margine = Math.round(lato * 0.25);
  ctx.globalAlpha = 0.85;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = lato * 0.08;
  ctx.drawImage(marchio, tela.width - lato - margine, tela.height - lato - margine, lato, lato);

  const risultato = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', 0.85));
  if (!risultato) throw new Error('Filigrana non riuscita');
  return risultato;
}
