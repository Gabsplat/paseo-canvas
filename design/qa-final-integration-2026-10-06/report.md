# Comprobación final de la integración

La rama `aprendizaje` reúne pizarra, aprendizaje, Secuenciador, Trazos y las
acciones contextuales del Panel. El coordinador integró `583bdbb`, preservó el
onboarding y las correcciones de anclajes y tamaño, y corrigió la salida de
anotaciones desde grupos. El código funcional está en `29c10b2`; `d0b459b`
actualiza el texto de la guía y la preparación reproducible de navegador.

## Resultado

- `pnpm test`: 302/302, sin fallos, cancelaciones ni pruebas omitidas. [Log](tests.log).
- `pnpm typecheck`: correcto para plugin, cliente y pruebas. [Log](typecheck.log).
- 35/35 casos RN-web, divididos en acciones contextuales, convivencia y guía.
- `git diff --check` y sintaxis de los scripts: correctos.

| Comprobación | Casos | Evidencia |
| --- | ---: | --- |
| Toolbar, instrucciones/herencia, grupos, conexiones, JSON, foco, reset con rechazo y compacto | 18 | [Resultados](panel-results.json), [log](panel-gui.log), [toolbar](panel-node-toolbar.png), [compacto](panel-compact-data.png), [rechazo](panel-sequencer-reset-rejected.png) |
| Autor, anclaje, arrastre, borrado propio, undo, teclado y escucha del patrón final | 12 | [Resultados](cierre-result.json), [log](coexistence-gui.log), [captura](cierre-sequencer-annotated.png) |
| Apertura de la guía, búsqueda de Secuenciador y Trazos, compacto oscuro y ausencia de errores | 5 | [Resultados](guide-results.json), [log](guide-gui.log), [guía](guide-sequencer.png), [compacto](guide-compact.png) |

El reset contextual pulsa el único Reiniciar del renderer dentro del root vigente
del Panel. Las pruebas comprueban cierre de todos sus contextos, cancelación de
ediciones pendientes y exactamente un evento `step-sequencer.reset`. Un rechazo
conserva el runtime del servidor, muestra el error y no genera un evento de éxito.

## Regresiones corregidas al integrar

Dos pruebas nuevas fallaron contra la acción anterior de Sacar del grupo. La
selección de tarjeta y dibujo sobrescribía el desplazamiento relativo del dibujo;
seleccionar sólo el dibujo lo dejaba en el grupo original. La acción ahora mueve
la tarjeta una sola vez y conserva su anotación. Un dibujo que sale por separado
se desvincula en la misma transacción y conserva su posición. El reducer y los
schemas reales verifican ambos casos. La resolución de solapamientos existente
puede desplazar la tarjeta; su anotación conserva el desplazamiento relativo.

La suite completa también detectó imports ausentes en el arnés headless anterior
del Panel. El arnés ahora ejecuta SelectionActions real y comprueba que Más abra
acciones contextuales. Conserva las pruebas de creación, título, instrucciones,
errores y nombres de catálogo; no se omitieron pruebas.

El primer intento de convivencia heredó el viewport de 390 px del escenario
compacto. El script ahora fija su propio viewport de 1920×1080 antes de preparar
la página. La repetición completa pasó 12/12, con los mismos asserts.

## Entorno y alcance

Omabox propia `box-1`, `--net isolated`, sin puertos host permitidos. Pantalla
virtual 1920×1080 a 60 Hz, escala 1, Omarchy 4.0.3-1, tema del box blueridge-dark.
La metadata no reportó versión de Hyprland. Chromium usó viewports 1440×1000,
1920×1080 y 390×844, con los temas de Panel lienzo-papel/lienzo-tinta y GPU
deshabilitada. [Metadata y hashes de bundles](environment.json). El box se cerró
después de copiar la evidencia.

Los scripts montan Panel, useCanvas, Canvas, renderers y scheduler de producción.
El transporte usa schemas RPC y reducer reales con documentos de ejemplo en
memoria. Iconos, Modal, settings, toasts y entrega al asistente son sustitutos.
El caso de reset contextual usa un AudioHost instrumentado; la convivencia usa
Web Audio del navegador y registra los contextos. No se escuchó un dispositivo
físico. Las capturas de la guía y la toolbar también se inspeccionaron.

No se probó el plugin dentro de Paseo instalado, un dispositivo nativo, audio
físico, proveedores remotos de medios ni nuevas entregas a un agente real. La
muestra anterior de 150 bloques sigue documentada en el
[informe de pizarra](../qa-whiteboard-2026-10-06/report.md); esta pasada no repitió
ese benchmark. La suite headless conserva persistencia, conflictos y packs reales.

No se instaló ni recargó el plugin, no se reinició Paseo ni se alteró Tailscale.

## Reproducción

Con pnpm en PATH, ejecutar `pnpm test`, `pnpm typecheck` y
`bash design/qa-panel-close-2026-10-06/build.sh`. Dentro de una omabox propia y
aislada, servir `dist/panel-qa` en 8765 y abrir Chromium con CDP en 9222. Ejecutar,
en este orden, `panel-close.cjs`, `cierre.cjs` y
`design/whiteboard-harness/guide.cjs`. Copiar sus resultados antes de cerrar ese box.
