# Lienzo · pizarra libre: contrato (v1)

Autoría: Claude Opus 5.5 Medium (arquitectura y diseño visual). Normativo para backend
(`plugin/shared/whiteboard.ts`, `plugin/shared/svg.ts`, servidor), frontend (`plugin/client/`) e
integrador (`Panel.tsx`). `docs/design.md` §20 detalla el aspecto y `design/tokens.json` → `whiteboard` los números; **este archivo manda en IDs,
campos, límites y semántica de gestos**. Nada de dependencias nuevas; RN + `web.ts`.

## 0. Decisión de arquitectura

Los elementos de pizarra son **bloques ordinarios**: `blockSchema` no cambia de forma, se usan
`position`, `size`, `parentGroupId`, `block.create/update/delete`, `entity.move`,
`entity.duplicate`, links, plantillas, packs, undo/redo y `canvas_apply` tal cual. **No hay
herramientas MCP nuevas ni operaciones nuevas.** Se añaden cuatro renderers registrados
(`RendererSpec`, `interactive: false`) con tipo integrado de igual id:

| typeId = renderer | Nombre (catálogo) | Icono | Tamaño por defecto | Mínimo |
| --- | --- | --- | --- | --- |
| `wb-text` | Texto libre | `Type` | automático (sin `size`) | ancho 24 |
| `wb-shape` | Forma | `Shapes` | 160 × 104 | 24 × 24 (`line`: 8 × 8) |
| `wb-svg` | Imagen SVG | `ImagePlus` | lado mayor 96, proporción del `viewBox` | 24 × 24 |
| `wb-draw` | Dibujo | `Pencil` | caja de los trazos | 8 × 8 |

- **`blockSizeSchema`:** aprobado bajar el sobre global a `min 8` en ambos ejes (máx. 4096 se
  queda). El servidor aplica mínimos por tipo: los cuatro de arriba y, para todo lo demás, los
  actuales (160 × 104 como suelo; `spec.minSize` cuando exista). Ninguna tarjeta existente cambia.
- `title` va vacío (`""`) al crearlos desde la interfaz; sigue siendo válido y editable por MCP y
  sirve de nombre accesible ("Texto libre", "Forma: rombo"… cuando está vacío).
- `properties` del tipo: declarar cada campo de `data` (kind `text`/`number`/`json`) para que la
  validación de "propiedad no declarada" siga pasando; el `dataSchema` estricto es la autoridad.
- `shared/whiteboard.ts` exporta: los cuatro `dataSchema` y tipos, `WB_LIMITS`, `WB_COLORS`,
  `WB_SHAPES`, `isWhiteboardRenderer(id)`, `whiteboardMinSize(typeId, data)`,
  `simplifyStroke(points, tolerance)`, `appendStroke(...)` (§1.4) y reexporta `sanitizeSvg`.
- `guidance` para el asistente (texto del spec): "Usa wb-text para rótulos sueltos, wb-shape para
  cajas y flechas simples, wb-svg con iconos de la biblioteca para arquitectura. Para explicar
  relaciones usa links, no flechas dibujadas. No generes wb-draw salvo petición explícita."

## 1. Datos (`data`, todos `.strict()`)

Vocabulario común:

```ts
WB_COLORS = ['tinta','gris','azul','turquesa','verde','naranja','rojo','violeta'] as const  // por defecto 'tinta'
WB_SCALE  = ['s','m','l','xl'] as const                                                       // por defecto 'm'
```

Los colores son **roles**, nunca hex en el documento (§4 da el valor por tema).

### 1.1 `wb-text`
```ts
{ text: string,                 // ≤ 4000, puede ser "" solo mientras se edita (ver §3.4)
  color: WB_COLORS = 'tinta',
  scale: WB_SCALE = 'm',
  font: 'sans'|'serif'|'mono' = 'sans',
  align: 'left'|'center'|'right' = 'left',
  width?: number }              // 24..4096; ausente = se ajusta al texto (máx. 480 y luego parte línea)
```
`size` del bloque **no se usa** (siempre ausente/null; el servidor lo rechaza con VALIDATION si
llega). El alto es siempre el medido. `defaults: { text: '' }`.

### 1.2 `wb-shape`
```ts
WB_SHAPES = ['rect','rounded','ellipse','diamond','triangle','hexagon','cylinder','line'] as const
{ shape: WB_SHAPES = 'rect',
  color: WB_COLORS = 'tinta',                    // trazo y, atenuado, relleno
  fill: 'none'|'wash'|'solid' = 'none',          // ignorado en 'line'
  stroke: 'solid'|'dashed'|'dotted' = 'solid',
  weight: WB_SCALE = 'm',                        // grosor
  text: string = '',                             // ≤ 1000, centrado dentro; ignorado en 'line'
  from?: 'nw'|'ne'|'sw'|'se',                    // solo 'line': esquina de origen; por defecto 'nw'
  heads?: 'none'|'end'|'start'|'both' }          // solo 'line': por defecto 'none'. Flecha = line + heads 'end'
```
Una línea va de la esquina `from` a la opuesta de su caja; si un eje mide ≤ 8 se dibuja centrada
en ese eje (línea horizontal/vertical exacta). `from`/`heads` en otra forma → VALIDATION.

### 1.3 `wb-svg`
```ts
{ svg: string,                                   // canónico, salida de sanitizeSvg; ≤ 64 KiB UTF-8
  viewBox: [x, y, width, height],                // finitos, width/height > 0; lo fija el servidor
  color: WB_COLORS = 'tinta',                    // sustituye a `currentColor`
  caption: string = '',                          // ≤ 200; nombre accesible y rótulo opcional bajo la imagen
  source?: string,                               // ≤ 200, p. ej. "tabler:server"
  license?: string }                             // ≤ 200, p. ej. "MIT · Tabler Icons"
```
**Frontera de saneado (la implementa backend, aquí solo el borde):** entra texto SVG en línea; el
servidor lo analiza con lista de permitidos y **reescribe** `svg` y `viewBox` en cada
`block.create`/`block.update`/`canvas_create`/import de pack (el cliente nunca es de fiar). Se
rechaza con VALIDATION y mensaje en español, sin guardar nada, si hay: `script`, `foreignObject`,
`style` con `url(`/`@import`, atributos `on*`, `href`/`xlink:href` no fragmento (`#id`), `image`,
`use` externo, `iframe`/`object`/`embed`, entidades/DOCTYPE, `data:`/`http(s):`/`javascript:` en
cualquier valor, más de 64 KiB o más de 2000 elementos. Permitidos: `svg g path rect circle
ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask
title desc` y atributos de presentación. `currentColor` se conserva. El cliente **no** inserta el
SVG en el DOM: lo pinta como `Image` con URI `data:image/svg+xml` (un `<img>` no ejecuta nada),
tras sustituir `currentColor` por el color del tema. Nativo sin soporte SVG: marco discontinuo con
`caption` y "Imagen SVG; se ve en la versión web".

### 1.4 `wb-draw`
```ts
{ extent: { width, height },                     // 1..4096: espacio de referencia de los puntos
  strokes: Array<{ points: number[],             // x0,y0,x1,y1… en unidades de `extent`, redondeo 0.5; 2..512 puntos
                   color: WB_COLORS, weight: WB_SCALE }> }   // 1..32 trazos, ≤ 4000 puntos en total
```
Se pinta escalado `size / extent` (así redimensionar no reescribe puntos; el grosor **no** escala).
`size` siempre presente. `simplifyStroke` (Ramer-Douglas-Peucker, tolerancia 0.75 unidades de
mundo) se aplica en cliente antes de guardar y otra vez en servidor; si aún supera 512 puntos el
servidor remuestrea uniforme. `appendStroke({ position, size, data }, worldPoints, style)` →
`{ position, size, data }` con la caja unida y los puntos previos desplazados (puro, compartido).

## 2. Capas, grupos, layout y enlaces

- **Orden de pintura** (de abajo arriba): marcos de grupo · `wb-shape` y `wb-svg` · conexiones ·
  tarjetas · `wb-text` · `wb-draw` · guías/asas. Dentro de un nivel, orden del array `blocks`.
  No hay campo z en v1.
- **Grupos:** `parentGroupId` normal. Se crean dentro del grupo abierto más interno bajo el
  puntero (mismo `dropTarget`), con posición relativa al grupo. El marco del grupo los abarca.
- **Layout:** un bloque de pizarra **siempre lleva `position`** y es *superposición*: en cualquier
  modo (`stack`, `grid`, `flow`, `graph`, `free`) se queda donde está, **no entra** en la
  colocación automática ni en `resolveOverlaps` (ni empuja ni es empujado) y no muestra el
  alfiler "Soltar posición". Puede solaparse con tarjetas: es el propósito.
- **Enlaces:** `wb-text`, `wb-shape` (salvo `line`) y `wb-svg` son extremos normales de `link`
  (asa de conexión y tecla `L`). `wb-draw` y `line` no muestran asa.
- **Lista/outline y compacto:** fila de una línea: icono del tipo + `text`/`caption`/"Dibujo (N
  trazos)"/"Forma: rombo". Sin lienzo en miniatura.
- **Acciones al asistente:** ninguna automática. La selección entra en el contexto como cualquier
  bloque; de `wb-draw` se resume `{ strokes: N, extent }`, nunca los puntos; de `wb-svg` solo
  `caption/source`.

## 3. Gestos e interacción

### 3.1 Herramientas (`CanvasTool`, ya publicado en `whiteboard-tools.ts`)
`'select' | 'hand' | 'text' | 'shape' | 'draw' | 'eraser' | 'svg'`. Estado controlado por `Panel`
(`tool`, `onToolChange`) más estilo:

```ts
type ToolStyle = { color: WbColor; scale: WbScale; fill: 'none'|'wash'|'solid'; stroke: 'solid'|'dashed'|'dotted';
                   shape: WbShape; heads: 'none'|'end' ; font: 'sans'|'serif'|'mono' };
// Canvas props nuevas: tool, onToolChange, toolStyle, toolLocked (boolean)
// CanvasApi: setTool, getTool, cancelGesture, viewportCenter, insertSvg(svg, { caption?, source?, license?, at? })
```
`toolStyle` es preferencia local (no documento). Con selección de bloques de pizarra, cambiar un
valor en el panel de estilo además escribe **una** transacción sobre los seleccionados ("Cambiar
color", "Cambiar grosor"…). Tras crear un texto, forma o SVG la herramienta vuelve a `select` con
lo creado seleccionado, salvo `toolLocked` (doble clic en el botón; muestra un punto bajo el
icono). `draw` y `eraser` son persistentes hasta `Esc`/`V`. Atajos: `V` seleccionar · `H` mano ·
`T` texto · `R` forma · `D` lápiz · `E` goma · `Esc` → `select`. Sin atajo para SVG.

| Herramienta | Clic en vacío | Arrastre | Cursor |
| --- | --- | --- | --- |
| `select` | deselecciona | sobre vacío: desplaza la cámara · sobre elemento: lo mueve | `default` / `grab` |
| `hand` | nada | siempre desplaza, también sobre elementos; nada se selecciona | `grab`/`grabbing` |
| `text` | crea `wb-text` ahí y entra a editar | caja ≥ 24 de ancho fija `width` | `text` |
| `shape` | crea la forma por defecto 160 × 104 centrada en el punto | de esquina a esquina (Shift: proporción 1:1; `line`: Shift ajusta a 15°) | `crosshair` |
| `draw` | punto | trazo; un trazo = una transacción "Dibujar trazo" | `crosshair` |
| `eraser` | borra el trazo bajo el puntero | borra los trazos que cruza; una transacción al soltar "Borrar trazos" | `cell` |
| `svg` | no es modo de puntero: abre el popover Biblioteca (§5.4) y vuelve a `select` | | |

Con una herramienta de creación activa (`text`/`shape`/`draw`/`eraser`) **todo el lienzo es
superficie de esa herramienta**: las tarjetas no reciben pulsaciones ni se arrastran.

**Sesión de lápiz:** los trazos consecutivos van al mismo bloque `wb-draw` (`block.update` con
`appendStroke`) mientras no se cambie de herramienta, de grupo destino, ni se llegue a 32 trazos o
4000 puntos; entonces empieza otro bloque. Cada trazo es su propia entrada de deshacer. La goma
quita trazos enteros (no parte trazos); un bloque que queda sin trazos se elimina con
`block.delete` en la misma transacción.

### 3.2 Botón central (y barra espaciadora)
El botón central **siempre** desplaza la cámara, empiece donde empiece: tarjeta, control, texto,
escenario interactivo, bloque de pizarra. Se quitan las exenciones `lienzo-interactive-*` de
`attachMiddlePan`; se mantiene `preventDefault` de autoscroll/`auxclick`. Mantener `Espacio`
equivale a `hand` temporal. **Frontera honesta:** si el puntero baja *dentro del documento de un
`iframe`* (vista previa, reproductor incrustado), el navegador no entrega el evento al lienzo y no
hay forma legítima de capturarlo. Solución visible: mientras no esté en *modo interacción* (§3.3)
el iframe está cubierto por un escudo transparente (`pointerEvents` del iframe `none`), así que
arrastre, botón central y rueda funcionan encima.

### 3.3 Arrastrar desde cualquier punto frente a controles
Regla única en `select`: **pulsación corta activa; movimiento > 4 px (`canvas.dragThreshold`)
antes de soltar mueve.** Se aplica a toda la tarjeta, no solo a la cabecera (`isDragHandle` deja
de limitar el inicio).

| Empieza sobre | Clic corto | Arrastre > 4 px |
| --- | --- | --- |
| Cuerpo, título, texto no seleccionable, imagen | selecciona | **mueve** |
| Botón, casilla, opción, chip, fila de conexión | activa el control (y no selecciona de más) | **mueve**; el control no se activa (`swallowClick`) |
| Deslizador, scrub, `WebRange`, superficie de dibujo/shader/gráfica con puntero propio, asa de redimensionar, asa de conexión | el control | **el control** (necesitan el arrastre). Marcados `lienzo-interactive-range-*` / `-surface-*` / `-resize-*` |
| Texto en edición (`input`, `textarea`, `InlineText` activo) | caret | selección de texto; la tarjeta no se mueve |
| Texto seleccionable de solo lectura (código, pasajes anotables) | selecciona la tarjeta | **mueve** mientras la tarjeta no esté en modo interacción |
| `iframe`, vídeo/audio con controles | selecciona la tarjeta (escudo) | **mueve** (escudo) |
| Área con desplazamiento propio (`lienzo-scroll-*`) | selecciona | mueve; la rueda desplaza su contenido solo en modo interacción |

**Modo interacción** (para rangos de texto, anotaciones de pasaje, iframes, reproductores y
desplazamiento interno): se entra con **doble clic** en ese contenido, o `Enter` con la tarjeta
seleccionada, o el botón "Interactuar" (`MousePointerClick`) de la barra contextual, que solo
aparece en tarjetas que lo necesitan. En modo interacción: anillo `accent` de 2 px *por dentro*
del borde, chip "Interactuando · Esc" (`label`, `surface1`, sombra `elevation.island`) pegado
arriba-derecha por fuera de la tarjeta; el escudo se retira; texto e iframe reciben el puntero; la
tarjeta solo se mueve por su fila de título. Se sale con `Esc`, clic fuera o al seleccionar otra
cosa. No es estado del documento. `Esc` dentro de un iframe enfocado no llega: por eso el chip es
también botón.

Los controles de aprendizaje de un clic (apuesta, opción, transporte, capas) no necesitan modo
interacción: clic corto los activa siempre.

### 3.4 Texto libre: editar
- Crear o **doble clic** (o `Enter`/`F2` con uno seleccionado, o escribir) → edición en el sitio
  con el mismo `InlineText`, multilínea: `Enter` línea nueva, `⌘/Ctrl Enter` o clic fuera
  confirma, `Esc` cancela.
- Sin texto al confirmar: un bloque recién creado no se llega a guardar (no hay transacción); uno
  existente se elimina ("Eliminar texto"). Nunca queda un `wb-text` vacío guardado.
- Clic simple selecciona; arrastre mueve (no hay selección de rango fuera de edición).
- El texto de una forma se edita igual (doble clic en la forma).

### 3.5 Selección, mover, redimensionar
- Selección: caja `accent` 1.5 px a 4 px por fuera, **sin** halo ni fondo. Ocho asas cuadradas
  (8 × 8 pantalla, `surface1`, borde `accent` 1.5, zona 20; táctil 44) en `wb-shape`, `wb-svg` y
  `wb-draw`; solo este/oeste en `wb-text` (cambian `width`); en `line`, dos asas redondas en los
  extremos (reescriben `position`, `size`, `from`). Shift = proporción; `wb-svg` siempre
  proporcional. Una transacción al soltar ("Redimensionar forma"…). Asas ocultas bajo 25 % zoom.
- Mover, multiselección, guías de alineación, soltar en grupo, duplicar, eliminar, deshacer:
  exactamente el camino de las tarjetas. Al mover no se elevan con sombra (no son tarjetas):
  opacidad 0.85 mientras se arrastran.
- **Zona de impacto:** `wb-text`, `wb-svg` y formas con relleno: su caja. Formas `fill: 'none'`:
  banda de 8 px de pantalla sobre el contorno más su texto; el interior deja pasar el puntero.
  `wb-draw` y `line`: a ≤ 8 px de pantalla de un trazo (función pura sobre los puntos); el resto
  de la caja deja pasar. Así un garabato grande no tapa las tarjetas de debajo.
- Barra contextual (§5 de `design.md`) para pizarra: solo Duplicar · Eliminar · Más; el estilo
  vive en la isla Estilo (§5.2) y no se duplica. "Interactuar", "Datos" e instrucciones no aparecen para `wb-draw`.

## 4. Aspecto (resumen normativo; números en `tokens.whiteboard`)

- **Sin cromo de tarjeta:** ninguno de los cuatro lleva fondo, borde, espina, cabecera, etiqueta
  de tipo, pie ni sombra. Hover: caja `foregroundMuted`@0.35 de 1 px a 4 px por fuera.
- **Color (rol → valor):** `tinta` = `foreground` · `gris` = `foregroundMuted` · `rojo` =
  `statusDanger` · `azul`,`turquesa`,`verde`,`naranja`,`violeta` = `tokens.viz.series[id]`
  claro/oscuro según `isDark(surface0)`. Relleno `wash` = color@0.14; `solid` = color@1 con texto
  `surface0`. Trazos y texto siempre color@1.
- **Grosor (`weight`, unidades de mundo):** s 1.5 · m 2.5 · l 4 · xl 7. Discontinuo `6 5`,
  punteado `1 6` con extremo redondo, ambos × (grosor/2.5).
- **Texto (`scale`, tamaño/interlínea):** s 14/20 · m 18/26 · l 28/36 · xl 44/52. `sans` peso
  400, `serif` 400 (la voz de títulos de Lienzo), `mono` 400 un punto menor. Texto de forma:
  `scale` m fijo 15/21 peso 500 centrado, margen interior 12.
- **Formas:** `rounded` radio 16 · `cylinder` tapa elíptica de alto 18 % (máx. 28) · `hexagon`
  plano arriba, corte 22 % · `triangle` isósceles punta arriba · cabeza de flecha abierta en V,
  11 + 2 × grosor de largo, 28° por lado. Uniones y extremos redondos.
- **Pintura:** `rect`, `rounded`, `ellipse` con `View` (borde/radio). El resto y `wb-draw` con
  `WebCanvasSurface` de `web.ts`; en nativo: `diamond` = cuadrado girado 45°, `line` = `View`
  girada, y para `triangle`/`hexagon`/`cylinder`/`wb-draw` un marco discontinuo con el nombre
  ("Dibujo; se ve en la versión web"). Sin fingir.

## 5. Interfaz flotante: delta sobre `docs/design.md` §3

Todo flota **sobre el lienzo a panel completo**: `Panel` pinta `Canvas` con `position: absolute;
inset: 0` y las islas como hermanos posteriores absolutos con `pointerEvents: "box-none"` en su
capa. Ningún `flex` reserva franjas; no hay barra superior, carril ni inspector acoplados fuera de
compacto. Islas A (lienzo), C (asistente) y D (zoom) quedan como en §3.1.

### 5.1 Isla B → **Herramientas** (arriba-centro)
`Island` horizontal, botones `tool` 40 (táctil 44), icono 20, separación 2, en este orden:

`MousePointer2` Seleccionar `V` · `Hand` Mano `H` · ┃ · `Type` Texto `T` · `Shapes` Forma `R`
(con `ChevronDown` 10 en la esquina; pulsar el botón ya activo abre §5.3) · `Pencil` Lápiz `D` · `Eraser` Goma `E` · ┃ ·
`Library` Biblioteca (§5.4) · `Plus` Añadir bloque (selector §9.1; ahí siguen nota, nodo, grupo y
todos los bloques de aprendizaje).

Herramienta activa: relleno `accent`@0.14, icono `accent` (estado *active* de §4). Fijada: punto
`accent` de 4 px centrado 3 px bajo el icono.

### 5.2 Isla E → **Estilo** (derecha, centrada en vertical; nueva)
Visible solo cuando la herramienta es `text`/`shape`/`draw` o la selección contiene bloques de
pizarra. Columna, ancho 168, relleno 8, separación 8, `Island` + `elevation.island`, a 12 del
borde derecho; entra con `motion.popover`. Secciones separadas por divisor de 1 px, solo las que
aplican:

1. **Color:** rejilla 4 × 2 de muestras; botón 32 (táctil 40), disco 18; elegido: anillo `accent`
   2 px con hueco 2. Nombre accesible = rol ("Tinta", "Gris", "Azul"…).
2. **Tamaño** (`scale`/`weight`): segmentado `S M L XL`, 4 × 36 × 32, `label` peso 600.
3. **Relleno** (formas no `line`): tres botones 32 con una miniatura propia de 16 × 16
   radio 4 hecha con `View` (no icono host): Sin relleno = solo borde 1.5 · Suave = borde +
   color@0.14 · Sólido = color@1. Usan el color elegido.
4. **Trazo** (formas y línea): Continuo `Minus` · Discontinuo `MoreHorizontal` · Punteado `Ellipsis`.
5. **Fuente** (texto): `Sans` · `Serif` · `Mono`, cada rótulo en su familia; y alineación
   `AlignLeft` `AlignCenter` `AlignRight`.
6. **Puntas** (línea): `Minus` Sin punta · `ArrowRight` Flecha · `ArrowLeftRight` Doble.

### 5.3 Popover **Formas** (bajo el botón Forma)
Rejilla 4 × 2 de botones 40 con miniatura dibujada de 20: Rectángulo · Redondeado · Elipse ·
Rombo · Triángulo · Hexágono · Cilindro · Línea; debajo, fila "Flecha" (`line` + `heads: 'end'`).
Elegir fija `toolStyle.shape`, activa `shape` y cierra. Iconos host: `Square`, `SquareRoundCorner`
(si falta: `Square`), `Circle`, `Diamond`, `Triangle`, `Hexagon`, `Cylinder`, `Minus`,
`MoveUpRight`.

### 5.4 Popover **Biblioteca** (bajo el botón Biblioteca; ancho 304)
- Cabecera `label` "Arquitectura". Rejilla 4 columnas, celda 68 × 64: icono 28 trazo `foreground`
  + nombre `small` muted una línea. **Los doce Tabler aprobados, en este orden y con estos
  rótulos:** `server` Servidor · `database` Base de datos · `cloud` Nube · `network` Red ·
  `api` API · `browser` Navegador · `device-laptop` Portátil · `device-mobile` Móvil ·
  `stack-2` Capas · `box` Paquete · `file` Archivo · `users` Personas.
- Pulsar inserta un `wb-svg` (96 de lado mayor, `color: 'tinta'`, `caption` = rótulo, `source:
  "tabler:<id>"`, `license: "MIT · Tabler Icons"`) en el centro visible o dentro del grupo
  seleccionado, y lo deja seleccionado; arrastrar desde la celda lo suelta donde caiga.
- Pie: botón "Importar SVG…" (`Upload`; web: selector de archivo `.svg` ≤ 64 KiB en `web.ts`;
  nativo: campo "Pegar código SVG") y línea `small` muted "Iconos Tabler · licencia MIT".
- Rechazo del servidor: banner en el popover con el motivo en español ("Este SVG contiene
  contenido activo o enlaces externos y no se puede importar."). No se inserta nada.
- Los datos SVG y la licencia viven en el cliente (`plugin/client/`, texto incluido en el
  paquete); sin red en ejecución. Pasan por el mismo saneado del servidor al insertarse.

### 5.5 Estrechamientos y compacto
- `w` 560–879: isla E pasa a horizontal, centrada abajo, encima de C (separación 8); una fila
  desplazable con Color y Tamaño y un botón `SlidersHorizontal` "Más estilo" que abre el resto en un
  `Modal` del host (aprobado: el SDK no ofrece popover anclado fiable a ese ancho), título "Estilo",
  mismas secciones y orden que la isla vertical.
- `w` < 560: isla B muestra `MousePointer2` · `Hand` · `Pencil` · `Type` · `Plus`; Forma, Goma y
  Biblioteca van dentro del selector de `Plus`, primeros.
- **Compacto:** la barra superior gana un botón `PenTool` "Herramientas" que abre una hoja (host
  `Modal`) con las mismas herramientas, estilo y biblioteca, y cambia a "Ver como lienzo". Con una
  herramienta de creación activa en compacto sí se permite crear y dibujar con un dedo (dos dedos
  desplazan); una píldora "Listo" (`accent`) arriba-centro vuelve a `select`. Mover y
  redimensionar siguen desactivados en compacto.

## 6. Props para el integrador (`Panel.tsx`) y frontend

```ts
// plugin/client/FloatingTools.tsx (frontend), sin controlador: solo estado de herramienta
<ToolIsland tool onToolChange locked onLockChange shape onOpenShapes onOpenLibrary onOpenPicker
            width /* ancho del panel, para §5.5 */ touch disabled /* offline */ />
<StyleIsland tool selectionKinds /* Set<'wb-text'|'wb-shape'|'wb-svg'|'wb-draw'|'line'> */
             value: ToolStyle onChange(patch: Partial<ToolStyle>) orientation: 'vertical'|'horizontal' />
<ShapePopover value: WbShape heads onPick(shape, heads) onClose />
<LibraryPopover onInsert(svg, meta) onImport() error?: string busy onClose />
```
`Panel` guarda `tool`, `toolLocked`, `toolStyle`; pasa `tool/onToolChange/toolStyle/toolLocked` a
`Canvas`; en `StyleIsland.onChange` actualiza `toolStyle` y, si hay bloques de pizarra
seleccionados, llama a `controller.edit` con un `block.update` por bloque (parche `data` mínimo,
solo campos válidos para ese tipo) y etiqueta en español. `LibraryPopover.onInsert` →
`canvasApi.insertSvg`. Capas (z, de abajo arriba): `Canvas` · barra contextual · islas A/B/C/D/E ·
banners · popover/menú · tooltip · modal.

## 7. Validación mínima esperada
Persistencia y deshacer de los cuatro tipos; mínimos por tipo sin tocar tarjetas; SVG activo
rechazado y SVG válido canonicalizado; trazo simplificado y acotado; `wb-*` dentro de grupo
`stack`/`graph` sin recolocarse; pack/plantilla con `wb-*` ida y vuelta; clic corto frente a
arrastre sobre botón; botón central sobre tarjeta interactiva.
