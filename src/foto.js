// Compressione foto nel browser.
// Ridisegnare la foto su una "tela" e salvarla di nuovo come JPEG elimina
// TUTTI i metadati (posizione GPS, modello del telefono, data di scatto…).

const LATO_MAX = 1600;
const QUALITA = 0.82;

async function decodifica(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Alcuni browser non supportano le opzioni: si usa un'immagine normale
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function comprimiFoto(file) {
  let sorgente;
  try {
    sorgente = await decodifica(file);
  } catch {
    throw new Error(`Non riesco ad aprire "${file.name}". Prova con una foto in formato JPG.`);
  }
  const larghezza = sorgente.width;
  const altezza = sorgente.height;
  const scala = Math.min(1, LATO_MAX / Math.max(larghezza, altezza));
  const w = Math.round(larghezza * scala);
  const h = Math.round(altezza * scala);

  const tela = document.createElement('canvas');
  tela.width = w;
  tela.height = h;
  const ctx = tela.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(sorgente, 0, 0, w, h);
  sorgente.close?.();

  const blob = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', QUALITA));
  if (!blob) throw new Error(`Non riesco a elaborare "${file.name}".`);
  return blob;
}
