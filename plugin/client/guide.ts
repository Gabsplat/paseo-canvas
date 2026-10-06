export type GuideAction = 'documents' | 'catalog' | 'templates' | 'packs' | 'inspector' | 'agents' | 'communication' | 'history' | 'activity';
export type GuideFeature = { title: string; detail: string; keywords?: string; action?: GuideAction; button?: string };
export const guideSections: readonly { id: string; title: string; icon: string; intro: string; features: readonly GuideFeature[] }[] = [
  { id: 'start', title: 'Empezá con un lienzo', icon: 'Frame', intro: 'Un espacio compartido para organizar ideas, revisar una interfaz o aprender con tu agente.', features: [
    { title: 'Documentos', detail: 'Creá uno vacío, abrí los que ya tenés o duplicá uno. El título de la barra abre la lista.', action: 'documents', button: 'Abrir documentos' },
    { title: 'Ejemplos y plantillas', detail: 'Probá los ejemplos de frontend, aprendizaje y arquitectura. Están marcados como ejemplos. Las plantillas añaden una estructura reutilizable.', action: 'templates', button: 'Ver plantillas' },
    { title: 'Catálogo', detail: 'Añadí nodos, notas, código, listas, preguntas, progreso, diagramas, medios y vistas web. También podés definir tipos propios.', action: 'catalog', button: 'Explorar catálogo' },
  ] },
  { id: 'arrange', title: 'Acomodalo a tu gusto', icon: 'Group', intro: 'Agarrá un bloque por el encabezado. El contenido queda libre para leer, escribir y reproducir.', features: [
    { title: 'Arrastrar y redimensionar', keywords: 'resize dimensiones tamaño', detail: 'Mové bloques y grupos, también entre grupos. Seleccioná un bloque y arrastrá su esquina inferior derecha para cambiar su tamaño. Shift conserva la proporción.' },
    { title: 'Seleccionar y agrupar', detail: 'Shift + clic suma elementos. Arrastrá la selección junta o agrupala. Los grupos pueden anidarse, contraerse y tener instrucciones propias.' },
    { title: 'Disposiciones automáticas', detail: 'Elegí grafo, pila, cuadrícula, flujo o libre en el inspector. Arrastrar fija una posición. Soltar posición devuelve ese elemento al orden automático; Reordenar automáticamente libera todo el contenedor. El tamaño propio se conserva.', action: 'inspector', button: 'Abrir inspector' },
    { title: 'Navegar', detail: 'Arrastrá el fondo o usá el botón central del mouse para desplazar el lienzo. La rueda desplaza; Ctrl/⌘ + rueda acerca. Ajustá todo o la selección con los controles de zoom. Solo lienzo oculta los paneles.' },
  ] },
  { id: 'connect', title: 'Conectá las ideas', icon: 'Spline', intro: 'Las flechas unen bloques y grupos. Siguen los elementos cuando los movés o cambiás su tamaño.', features: [
    { title: 'Unir con el +', keywords: 'magnet imán flechas puertos', detail: 'Seleccioná o acercate a un bloque y arrastrá su + hacia otro. Cerca de un puerto, la punta se atrae y una señal breve confirma el destino. Soltá para crear el enlace.' },
    { title: 'Editar una conexión', detail: 'Pulsá la flecha para cambiar su texto, color o tipo: flujo, dependencia o referencia. También podés invertir su dirección o eliminarla desde el inspector.' },
    { title: 'Conectar con teclado', detail: 'Seleccioná dos elementos y pulsá L. El inspector ofrece Conexiones para buscar destinos. Las conexiones de grupos contraídos siguen visibles en su marco.' },
  ] },
  { id: 'material', title: 'Usá tu material acá', icon: 'Image', intro: 'Pegá enlaces HTTP o HTTPS en un bloque multimedia o en una vista previa.', features: [
    { title: 'Imágenes', detail: 'Pulsá la imagen para ampliarla. Usá + y − para acercar y arrastrá para explorar. Abrir referencia lleva al archivo original.' },
    { title: 'Video y audio', detail: 'Se reconocen enlaces directos y videos de YouTube o Vimeo. Los controles permiten reproducir, pausar y buscar. Pulsá Cargar reproductor para abrir YouTube o Vimeo en el bloque. No hay reproducción automática.' },
    { title: 'Webs', detail: 'En Vista previa pegá la URL de un sitio. Usá sus controles y su scroll directamente. Si el sitio bloquea la incrustación, Abrir vista previa lo abre en el navegador.' },
    { title: 'Contenido editable', detail: 'El inspector edita los datos de cada tipo. Las listas se pueden marcar; las preguntas y formularios envían tus respuestas al agente. El código se puede copiar y los diagramas ofrecen acciones sobre sus nodos.' },
    { title: 'En móvil', detail: 'Esquema facilita leer y seleccionar. El visor de imágenes y las medidas del inspector también están disponibles. Los videos y las webs se abren en el navegador; el lienzo compacto conserva la vista de lectura.' },
  ] },
  { id: 'agent', title: 'Trabajá con tu agente', icon: 'Bot', intro: 'Elegís qué contexto compartir y cuándo enviar una acción.', features: [
    { title: 'Conectar un agente', detail: 'Elegí el agente del workspace desde la barra. Su estado muestra si está trabajando, inactivo o no disponible.', action: 'agents', button: 'Ver agentes' },
    { title: 'Dar instrucciones', detail: 'Definí intención, audiencia e instrucciones para el documento, un grupo o un bloque. El agente recibe esas instrucciones juntas, empezando por las más específicas.', action: 'communication', button: 'Acuerdo de comunicación' },
    { title: 'Enviar la selección', detail: 'Seleccioná el contexto, escribí tu pedido en la bandeja y enviá. Las respuestas, formularios y acciones de diagramas generan feedback real; seleccionar por sí solo no envía un pedido.' },
    { title: 'Seguir la entrega', detail: 'Actividad distingue en cola, enviado, recibido y fallido. Podés reintentar una entrega fallida. Enviado indica entrega, no trabajo terminado.', action: 'activity', button: 'Ver actividad' },
  ] },
  { id: 'keep', title: 'Guardá y compartí', icon: 'Package', intro: 'Cada cambio confirmado queda en una revisión. Podés volver atrás y reutilizar el contenido.', features: [
    { title: 'Historial, deshacer y rehacer', detail: 'Consultá las revisiones y usá Deshacer o Rehacer para volver sobre cambios de contenido, posiciones, tamaños y enlaces.', action: 'history', button: 'Ver historial' },
    { title: 'Plantillas y packs', detail: 'Guardá un grupo como plantilla desde el inspector. Exportá la selección o el documento como pack JSON, e importá packs de tipos, plantillas y documentos. El catálogo muestra qué incluye cada pack.', action: 'packs', button: 'Abrir packs' },
    { title: 'Cambios simultáneos', detail: 'Si el documento cambió mientras editabas, el aviso permite releer, reaplicar tu cambio o descartarlo. Un fallo de guardado se muestra y devuelve el gesto al estado confirmado.' },
    { title: 'Volver a esta guía', detail: 'Guía de Lienzo está en la barra y en Más acciones. Todas las opciones incluye una búsqueda y los atajos de teclado.' },
  ] },
];
export const guideShortcuts = [
  ['Ctrl/⌘ + K', 'Abrir y buscar en el catálogo'], ['Ctrl/⌘ + Z', 'Deshacer'], ['Ctrl/⌘ + Shift + Z', 'Rehacer'], ['Ctrl/⌘ + G', 'Agrupar selección'], ['Ctrl/⌘ + Enter', 'Enviar pedido'],
  ['Shift + clic', 'Sumar o quitar de la selección'], ['Flechas / Shift + flechas', 'Mover 8 / 32 px'], ['L', 'Conectar dos seleccionados'], ['Enter', 'Abrir inspector'], ['Tab / Shift + Tab', 'Recorrer elementos'], ['Delete / Backspace', 'Eliminar selección o enlace'],
  ['1 / 2 / 0', 'Ajustar todo / selección / 100%'], ['+ / −', 'Acercar / alejar'], ['F / Escape', 'Solo lienzo / salir o quitar selección'],
] as const;
