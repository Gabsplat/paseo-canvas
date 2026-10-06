# Revisión visual v7 (pizarra) · 2026-10-06

Autor: Claude Opus 5.5 Medium (diseño). Base: las siete capturas de esta carpeta (Panel/useCanvas
reales en RN-web, reducer real, RPC simulado, iconos y Modal del SDK sustituidos por marcadores
`▫`). No lancé GUI ni ejecuté pruebas; no pude juzgar iconos reales, hover, cursores ni animación.

**Veredicto: sin bloqueantes de diseño. Apto para commit con los ajustes 1 y 2 (una línea cada
uno); 3 y 4 recomendados, pueden ir en un commit posterior.**

## Conforme con whiteboard-spec y §20
- Superposición real: lienzo a panel completo, islas A/B/C/D/E flotando (features, frames, medium).
- Isla B: orden, divisores, botón activo `accent`@0.14, chevron en Forma, `+` al final. Ancho ≈ 366.
- Isla E: derecha, centrada, 168 de ancho, inset 12; solo las secciones que aplican (texto: Color,
  Tamaño, Fuente, Alineación; SVG: solo Color). Anillo de la muestra elegida correcto.
- Los cuatro elementos sin cromo de tarjeta, también dentro del grupo. Selección: caja `accent`,
  asas este/oeste en texto y ocho en SVG. Barra contextual de pizarra: dos acciones + Más.
- 760 px: isla E horizontal sobre el compositor con Color, Tamaño y "Más estilo".
- Compacto claro y oscuro: barra acoplada, texto libre legible en ambos temas.
- Rechazo/fallo de guardado: banner rojo bajo la isla B, nada insertado a medias (imports).

## Ajustes
| # | Captura | Qué se ve | Ajuste exacto | Gravedad |
| --- | --- | --- | --- | --- |
| 1 | features, frames, medium | Primeras tarjetas a y≈28–48, tapadas por las islas A y B (borde inferior de B en y=62). | `canvas.initialZoom.topInset`: **76** en no compacto (62 + 14 de aire); **48** en compacto (`topInsetCompact`, ya correcto). Ya está en `design/tokens.json`; falta transcribir a `plugin/client/tokens.ts` y que `initialCamera` elija según `compact`. Sin prop nueva en Panel. | Arreglar antes del commit |
| 2 | frames | Chip "Interactuando · Esc" (y = tarjeta −30…−6) y barra contextual (−56…−12) comparten franja y pueden solaparse a la derecha. | Ocultar la barra contextual mientras `interaction !== null` (igual que al editar texto). El chip no se mueve. | Arreglar antes del commit |
| 3 | compact-tools | La hoja Herramientas muestra una fila con barra de desplazamiento horizontal nativa (pista blanca en tema oscuro) y no se ven estilo ni biblioteca. | Rejilla 4 × 2 con `flexWrap`, botones 44, separación 8, sin divisores ni scroll horizontal. Debajo, secciones de estilo de la herramienta activa y fila "Biblioteca". | Recomendado |
| 4 | medium | A 760 px la isla D completa (− % + ajustar) queda parcialmente bajo el compositor. | Aplicar §3.3 ya vigente: entre 560 y 879 D muestra solo el porcentaje (≈56 de ancho); "Acercar", "Alejar" y "Ajustar" en su menú. | Recomendado |

## Decisiones
- "Más estilo" en ancho estrecho como `Modal` del host en vez de popover anclado: **aprobado**;
  spec §5.5 y design.md §20.6 actualizados.
- No hace falta contrato nuevo de relleno superior entre Panel y Canvas: basta el token.

## Observaciones menores, sin acción
- La barra contextual a 12 sobre un texto libre dentro de un grupo tapa el título del grupo
  mientras dura la selección (features, compact). Aceptable: es transitoria y sigue la regla general.
- En compacto la barra contextual flota en vez de acoplarse (§3.4 pedía barra de acción de 48);
  es anterior a v7 y queda fuera de esta revisión.
