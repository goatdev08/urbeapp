/**
 * Ruta dummy — reserva el slot central de la tab bar para el botón [+].
 * Nunca se navega aquí: el tabBarButton custom (PublishTabButton en _layout)
 * intercepta el tap y empuja /publish/step1 encima de las tabs.
 */
export default function PublishTabPlaceholder() {
  return null;
}
