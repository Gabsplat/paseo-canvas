# Pizarra y panel flotante · QA del 6 de octubre de 2026

La entrega reúne arrastre desde contenido pasivo, paneo con botón central, texto
libre, formas, SVG, dibujo/goma y las islas flotantes. Se validó el Panel real bajo
RN-web, además de los contratos del backend. La rama de integración es
`aprendizaje`; su base anterior era `a641fbb`.

## Resultado

- `pnpm test`: **257/257**, sin fallos, cancelaciones ni pruebas omitidas.
- `pnpm typecheck`: correcto para plugin, cliente y pruebas.
- **24/24 casos de navegador**: siete escenarios reproducibles, sin excepciones
  de ejecución sin manejar ni errores inesperados del transporte simulado.
- `git diff --check`, sintaxis de scripts y comparación de tokens diseño/cliente:
  correctos. Se conserva el proxy existente del registro de renderers.
- `design/floating/contrast.py`: correcto en claro y oscuro; `rojo` depende del
  `statusDanger` del tema del host y se declara fuera de esa comprobación.

## Qué se ejercitó

| Escenario | Casos | Evidencia |
| --- | ---: | --- |
| Panel y gestos | 4 | [basic.json](basic.json), [captura](basic.png) |
| Texto, formas, estilo, resize, varios trazos, goma, undo y grupos | 8 | [features.json](features.json), [captura](features.png) |
| SVG pegado, rechazo de contenido activo, URL y archivo | 4 | [imports.json](imports.json), [captura](imports.png) |
| Shield de iframe, arrastre, botón central, rueda, formulario y scroll | 3 | [frames.json](frames.json), [captura](frames.png) |
| Arrastre de biblioteca con un grupo distinto seleccionado | 1 | [library.json](library.json), [captura](library.png) |
| Compacto 390×844 claro/oscuro y panel 760×920 | 3 | [compact.json](compact.json), [claro](compact-light.png), [oscuro](compact-dark.png), [hoja](compact-tools.png), [760 px](medium.png) |
| Arrastre y una transacción en un documento de 150 bloques | 1 | [many.json](many.json), [captura](many.png), [tiempos](performance.json) |

Los gestos prueban clic sin movimiento, arrastre desde el cuerpo de una nota,
paneo sobre esa nota y un nuevo arrastre rechazado que vuelve a su posición
confirmada. El texto se conserva como borrador hasta confirmar; Escape cancela un
borrador vacío. Los SVG persistidos se pintan como imagen, sin insertar su markup
como DOM. La biblioteca elige el grupo bajo el punto de soltado. En la web de
prueba se escribió en un input y se pulsó un botón dentro del iframe real; luego
se salió de interacción y se restauró el shield.

La regresión de texto seleccionable reproduce el fallo del navegador: seleccionar
palabras podía iniciar su arrastre nativo y provocar `pointercancel`. Las tarjetas
pasivas ahora suprimen esa selección; el modo Interactuar y las vistas externas
conservan la selección de texto.

El backend ejercita persistencia/reapertura, grupos, packs, plantillas, conflictos,
undo/redo y validación atómica de los cuatro tipos. Una regresión de servicio
comprueba quitar un pack personalizado con objetos de 24×24, editar el documento
sin perderlos y reimportar el pack. Los mínimos y el saneado vuelven a aplicarse
cuando el tipo está disponible; las tarjetas conocidas conservan 160×104.

## Entorno y alcance

Omabox `paseo-canvas-aprendizaje-730b51c3`, `--net isolated`, escritorio privado
1920×1080 a 60 Hz; Chromium con `--disable-gpu`, React 19.1 y RN-web 0.21.3. El
[arnés](../whiteboard-harness/README.md) monta producción `LienzoPanel`,
`useCanvas`, Canvas y herramientas. El transporte, catálogo y documento de ejemplo
usan los esquemas RPC y el reducer reales, con memoria y 45 ms de latencia
simulada. Iconos (`▫`), Modal, toasts, settings e inyección de tema del host son
sustitutos. No hubo agente conectado ni entrega simulada presentada como real.

Los tiempos de 106 cuadros durante arrastre y asentamiento de 150 bloques fueron
**mediana 16,6 ms; p95 16,7 ms; máximo 66,7 ms**. Son una muestra local con GPU
deshabilitada, no una garantía de 60 fps ni un benchmark de Paseo instalado.

No se verificaron el Panel dentro de Paseo instalado, sus iconos/modales reales,
dispositivos nativos ni SVG complejo nativo. El renderer nativo muestra un fallback
explícito para geometría compleja. Las comprobaciones compactas son RN-web con
ratón; no certifican gestos en hardware táctil. La URL SVG de prueba es local; una
URL externa necesita CORS. Los iframes activos no entregan sus eventos al padre,
así que el chip de salida es la vía fiable para volver a mover el bloque.

## Revisión de diseño

[Opus revisó las capturas anteriores](visual-review.md). Sus cuatro ajustes están
aplicados en la entrega final: margen inicial 76/48, barra contextual oculta en
interacción, hoja de herramientas 4×2 y zoom estrecho de porcentaje con menú. La
pasada final vuelve a comprobar el iframe sin barra superpuesta, las ocho acciones
de la hoja en dos filas y el menú de zoom separado del compositor. Las capturas de
esta carpeta corresponden a esa pasada final.

No se instaló ni recargó el plugin, no se reinició Paseo ni se alteró Tailscale.
