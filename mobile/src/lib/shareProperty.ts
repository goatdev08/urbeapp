/**
 * shareProperty.ts — compartir una propiedad como link al video (Share nativo).
 *
 * Comparte la signed URL del mp4 (ya minteada por mint-video-url EF). El link
 * abre el video directo en el navegador SIN necesidad de cuenta en Urbea.
 *
 * ponytail: usa la signed URL vigente del feed/detalle (TTL 3600s de la EF).
 * Para un link durable (7 días) mint-video-url debe aceptar un expires_in mayor
 * — cambio de backend diferido; para la demo se comparte el link en vivo.
 */
import { Share } from 'react-native';

export interface SharePropertyInput {
  /** Signed URL reproducible del mp4 (de la EF mint-video-url). */
  signedUrl: string;
  /** Dirección de la propiedad para el texto del mensaje. */
  address: string;
  /** Precio en MXN (opcional) para enriquecer el mensaje. */
  price?: number;
}

function format_price(price: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * Abre la hoja de compartir del SO con un mensaje + el link al video.
 * No lanza: cancelar la hoja o un error se ignoran (fire-and-forget UX).
 */
export async function share_property(input: SharePropertyInput): Promise<void> {
  const price_line = input.price !== undefined ? `\n${format_price(input.price)}` : '';
  const message = `🏠 ${input.address}${price_line}\n\nMira el video de esta propiedad en Urbea:\n${input.signedUrl}`;

  try {
    await Share.share({ message, url: input.signedUrl });
  } catch {
    // Usuario canceló o el SO falló — sin ruido en la demo.
  }
}
