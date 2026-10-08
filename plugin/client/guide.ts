import type { SettingsState } from '@getpaseo/plugin/client';
import type { canvasPreferences } from '../shared/preferences';

// Save before opening: two clients with the same revision cannot both show the tour.
export async function claimFirstGuide(settings: SettingsState<typeof canvasPreferences.schema>): Promise<boolean> {
  if (settings.status !== 'ready' || settings.values.guideSeen || settings.saving || settings.saveError) return false;
  return settings.save({ ...settings.values, guideSeen: true }, settings.revision);
}

export type GuideAction = 'documents' | 'catalog' | 'templates' | 'packs' | 'inspector' | 'agents' | 'communication' | 'history' | 'activity';
export type GuideFeature = { title: string; detail: string; keywords?: string; action?: GuideAction; button?: string };
export const guideSections: readonly { id: string; title: string; icon: string; intro: string; features: readonly GuideFeature[] }[] = [
  { id: 'start', title: 'Empezá con un lienzo', icon: 'Frame', intro: 'Un espacio compartido para organizar ideas, revisar una interfaz o aprender con tu asistente.', features: [
    { title: 'Documentos', detail: 'Creá uno vacío, abrí los que ya tenés o duplicá uno. Documentos abre la lista. Nuevo lienzo crea uno vacío sin preguntas y el título se edita en la barra.', action: 'documents', button: 'Abrir documentos' },
    { title: 'Ejemplos y plantillas', detail: 'Probá los ejemplos de frontend, aprendizaje y arquitectura. Están marcados como ejemplos. Las plantillas añaden una estructura reutilizable.', action: 'templates', button: 'Ver plantillas' },
    { title: 'Catálogo', detail: 'Añadí nodos, notas, código, listas, medios y vistas web. También podés definir tipos propios.', action: 'catalog', button: 'Explorar catálogo' },
  ] },
  { id: 'arrange', title: 'Acomodalo a tu gusto', icon: 'Group', intro: 'Arrastrá desde cualquier parte de un bloque. Un clic corto sigue activando sus controles; los deslizadores y gráficos conservan su propio arrastre.', features: [
    { title: 'Arrastrar y redimensionar', keywords: 'resize dimensiones tamaño', detail: 'Mové bloques y grupos, también entre grupos. Seleccioná un bloque y arrastrá su esquina inferior derecha para cambiar su tamaño. Shift conserva la proporción.' },
    { title: 'Mover o usar contenido', detail: 'Doble clic, Enter o Interactuar permite seleccionar texto, usar una web o manejar un reproductor. Mientras interactuás, mové la tarjeta por el título. Esc o el chip Interactuando sale de ese modo. Dentro de una web incrustada, usá el chip para salir.' },
    { title: 'Seleccionar y agrupar', detail: 'Shift + clic suma elementos. Arrastrá la selección junta o agrupala. Los grupos pueden anidarse, contraerse y tener instrucciones propias.' },
    { title: 'Disposiciones automáticas', detail: 'Seleccioná un grupo y abrí Disposición para elegir grafo, pila, cuadrícula, flujo o libre. La disposición del documento está en Ajustes del lienzo, dentro de Más acciones. Arrastrar fija una posición. Soltar posición devuelve ese elemento al orden automático; Reordenar automáticamente libera todo el contenedor. El tamaño propio se conserva.', action: 'inspector', button: 'Ver opciones' },
    { title: 'Navegar', detail: 'Arrastrá el fondo o usá el botón central del mouse para desplazar el lienzo, incluso encima de un bloque. Espacio activa Mano mientras lo mantenés pulsado. La rueda desplaza; Ctrl/⌘ + rueda acerca. Ajustá todo o la selección con los controles de zoom. Solo lienzo oculta los paneles.' },
  ] },
  { id: 'whiteboard', title: 'Escribí y dibujá libremente', icon: 'PenTool', intro: 'La isla Herramientas ofrece texto, formas, lápiz, goma y una biblioteca de arquitectura. El estilo se cambia en su propia isla.', features: [
    { title: 'Texto y formas', keywords: 'pizarra rótulos flecha círculo rectángulo rombo', detail: 'Texto crea un rótulo sin tarjeta. Doble clic o Enter edita texto y etiquetas de formas; Ctrl/⌘ + Enter confirma y Esc cancela. Un texto nuevo vacío no se guarda. Forma ofrece ocho geometrías y flechas; arrastrá para fijar su tamaño, con Shift para proporción o ángulos de 15°.' },
    { title: 'Lápiz y goma', keywords: 'trazos aprendiz asistente ancla anotación', detail: 'Cada trazo completo se guarda como un cambio. Si empezás sobre una tarjeta, el dibujo la sigue cuando se mueve. Tus trazos son continuos; los del asistente son discontinuos y llevan su rótulo. La goma quita trazos enteros y Deshacer los recupera. Borrar mis trazos conserva los del asistente y los del documento original. Esc cancela el trazo en curso y sale del lápiz; al salir se envía un resumen, sin la lista de puntos.' },
    { title: 'Biblioteca SVG', detail: 'Elegí un icono Tabler de arquitectura para insertarlo en el centro o arrastralo al lienzo. Importar SVG acepta código pegado; en web también archivo o URL de hasta 64 KiB. Los SVG con scripts o recursos externos se rechazan.' },
    { title: 'Dentro de grupos', detail: 'Texto, formas, SVG y dibujos mantienen su posición dentro del grupo incluso en una disposición automática. Se pueden mover, duplicar, eliminar y exportar con el documento. Las formas tienen ocho asas; el texto cambia de ancho y el SVG conserva su proporción.' },
    { title: 'Herramienta fija y móvil', detail: 'Texto y Forma vuelven a Seleccionar después de crear. Doble clic sobre la herramienta activa la fija; Lápiz y Goma siguen activos hasta Esc o V. En compacto, Herramientas abre una hoja: un dedo crea y dos dedos desplazan; Listo vuelve a Seleccionar.' },
  ] },
  { id: 'connect', title: 'Conectá las ideas', icon: 'Spline', intro: 'Las flechas unen bloques y grupos. Siguen los elementos cuando los movés o cambiás su tamaño.', features: [
    { title: 'Unir con el +', keywords: 'magnet imán flechas puertos', detail: 'Seleccioná o acercate a un bloque y arrastrá su + hacia otro. Cerca de un puerto, la punta se atrae y una señal breve confirma el destino. Soltá para crear el enlace.' },
    { title: 'Editar una conexión', detail: 'Pulsá la flecha: Etiqueta edita su texto en el lienzo y Tipo permite elegir flujo, dependencia o referencia. La misma barra ofrece Color, Invertir y Eliminar. Escape cancela la etiqueta sin guardarla.' },
    { title: 'Conectar con teclado', detail: 'Seleccioná dos elementos y pulsá L. Más ofrece Conectar con… para buscar destinos y Enter conecta el primer resultado. Las conexiones de grupos contraídos siguen visibles en su marco.' },
  ] },
  { id: 'material', title: 'Usá tu material acá', icon: 'Image', intro: 'Pegá enlaces HTTP o HTTPS en un bloque multimedia o en una vista previa.', features: [
    { title: 'Imágenes', detail: 'Pulsá la imagen para ampliarla. Usá + y − para acercar y arrastrá para explorar. Abrir referencia lleva al archivo original.' },
    { title: 'Video y audio', detail: 'Se reconocen enlaces directos y videos de YouTube o Vimeo. Doble clic o Interactuar habilita los controles para reproducir, pausar y buscar. Pulsá Cargar reproductor para abrir YouTube o Vimeo en el bloque. No hay reproducción automática.' },
    { title: 'Webs', detail: 'En Vista previa pegá la URL de un sitio. Doble clic o Interactuar habilita sus controles y su scroll. Fuera de ese modo podés mover el bloque y desplazar el lienzo encima de la web. Si el sitio bloquea la incrustación, Abrir vista previa lo abre en el navegador.' },
    { title: 'Contenido editable', detail: 'La barra de selección ofrece opciones según el tipo; Más → Datos… abre sus propiedades. En compacto, Editar abre una hoja. Las listas se pueden marcar; las preguntas y formularios envían tus respuestas al asistente. El código se puede copiar.' },
    { title: 'Flujo animado', keywords: 'timeline enlaces nodos', detail: 'Seguí eventos sobre los nodos y enlaces reales del lienzo. Sus recorridos acompañan el movimiento de los bloques y se detienen cuando dejan de verse.' },
    { title: 'Shader GLSL', keywords: 'WebGL uniforms', detail: 'Explorá una imagen calculada con variables compartidas. Los errores de compilación se muestran en el bloque; sin WebGL aparece una alternativa estática.' },
    { title: 'En móvil', detail: 'Lista facilita leer y seleccionar. El visor de imágenes también está disponible. Los videos y las webs se abren en el navegador; los bloques de aprendizaje muestran una descripción estática.' },
  ] },
  { id: 'agent', title: 'Trabajá con tu asistente', icon: 'Bot', intro: 'Elegís qué contexto compartir y cuándo enviar una acción.', features: [
    { title: 'Conectar un asistente', detail: 'Elegí el asistente del workspace desde la barra. Su estado muestra si está trabajando, inactivo o no disponible.', action: 'agents', button: 'Ver asistentes' },
    { title: 'Dar instrucciones', detail: 'Seleccioná un bloque o grupo y abrí Instrucción. También podés consultar las instrucciones heredadas; Vaciar borra las propias y Deshacer las recupera. Las del documento se encuentran en Más acciones. El asistente recibe esas instrucciones juntas, empezando por las más específicas.', action: 'communication', button: 'Indicaciones para el asistente' },
    { title: 'Enviar la selección', detail: 'Seleccioná el contexto, escribí tu pedido en la bandeja y enviá. Las respuestas y los formularios generan feedback real; seleccionar por sí solo no envía un pedido.' },
    { title: 'Seguir la entrega', detail: 'Actividad distingue en cola, enviado, recibido y fallido. Podés reintentar una entrega fallida. Enviado indica entrega, no trabajo terminado.', action: 'activity', button: 'Ver actividad' },
  ] },
  { id: 'keep', title: 'Guardá y compartí', icon: 'Package', intro: 'Cada cambio confirmado queda en una revisión. Podés volver atrás y reutilizar el contenido.', features: [
    { title: 'Historial, deshacer y rehacer', detail: 'Consultá las revisiones y usá Deshacer o Rehacer para volver sobre cambios de contenido, posiciones, tamaños y enlaces.', action: 'history', button: 'Ver historial' },
    { title: 'Plantillas y colecciones', detail: 'Seleccioná un grupo y abrí Más → Guardar como plantilla… para reutilizarlo. Exportá la selección o el documento como colección JSON, e importá colecciones de tipos, plantillas y documentos. El catálogo muestra qué incluye cada colección.', action: 'packs', button: 'Abrir colecciones' },
    { title: 'Cambios simultáneos', detail: 'Si el documento cambió mientras editabas, el aviso permite releer, reaplicar tu cambio o descartarlo. Un fallo de guardado se muestra y devuelve el gesto al estado confirmado.' },
    { title: 'Volver a esta guía', detail: 'Guía de Lienzo está en la barra y en Más acciones. Todas las opciones incluye una búsqueda y los atajos de teclado.' },
  ] },
];
export const guideShortcuts = [
  ['Ctrl/⌘ + K', 'Abrir y buscar en el catálogo'], ['Ctrl/⌘ + Z', 'Deshacer'], ['Ctrl/⌘ + Shift + Z', 'Rehacer'], ['Ctrl/⌘ + G', 'Agrupar selección'], ['Ctrl/⌘ + Enter', 'Enviar pedido'],
  ['Shift + clic', 'Sumar o quitar de la selección'], ['Flechas / Shift + flechas', 'Mover 8 / 32 px'], ['L', 'Conectar dos seleccionados'], ['Enter / F2', 'Editar texto o interactuar con contenido'], ['Tab / Shift + Tab', 'Recorrer elementos'], ['Delete / Backspace', 'Eliminar selección o enlace'],
  ['V / H / T / R / D / E', 'Seleccionar / Mano / Texto / Forma / Lápiz / Goma'], ['Espacio mantenido', 'Mano temporal fuera de controles de aprendizaje'],
  ['1 / 2 / 0', 'Ajustar todo / selección / 100%'], ['+ / −', 'Acercar / alejar'], ['F / Escape', 'Solo lienzo / salir o quitar selección'],
] as const;
