# Cierre funcional del Panel, 2026-10-06

El cierre sigue las acciones aprobadas de `docs/design.md` v7, §§3.4, 5.1–5.3 y
20, sin modificar el diseño, los tokens ni el núcleo de Secuenciador/Trazos.
Base de la rama: `b322a35`. Incluye el cherry-pick `c6c6b03` del fix de anclajes
`5ed4ef2978d1f37f4dc4363da34d33655d7cd439`. El código verificado es el cierre
incluido en el commit que contiene este informe.

## Cobertura funcional

| Área | Implementación y comprobación |
| --- | --- |
| Bloque | Preguntar enfoca el compositor sin enviar; slot por renderer; Instrucción, Duplicar, Eliminar y Más. Estado usa `block.update` y conserva los demás datos. |
| Grupo y selección múltiple | Añadir dentro conserva destino; Disposición cambia layout; Agrupar/Desagrupar usan reducer real; Más mantiene variables, plantilla, exportación, plegado, posiciones y orden. |
| Instrucciones | Guarda `communication.instructions`, conserva intención/audiencia, permite abrir instrucciones heredadas del grupo/documento; Vaciar limpia tres campos y Deshacer los restaura. |
| Conexión | Etiqueta escribe `link.update`; Escape no escribe. Tipo, color automático e inversión conservan etiqueta y endpoints válidos. Buscar admite texto y Enter sin que el menú robe las teclas del input. |
| Popovers | Campos acotados por selección, sin inspector genérico. Datos valida JSON antes de escribir; número usa teclado numérico. Los menús respetan viewport y foco. |
| Compacto | Deshacer/Añadir en cabecera; barra de acciones de 48 px directamente encima del compositor; Editar abre los datos en un host Modal. |
| Pizarra | Toolbar separada con medición/clamp, retraso de 120 ms, entrada de 100 ms/4 px y ocultación durante gestos/edición. Canvas conserva sus handlers y pasa catálogo a sus tres consultas de anclaje. |
| Runtime | Reiniciar web activa el único handler del renderer dentro del root de este Panel, tras comprobar identidad y selección vigentes. No añade reset genérico. Nativo limita el fallback a controls/prediction-gate; otros resets quedan deshabilitados. |

Los tests dirigidos prueban operaciones con schemas, reducer, CanvasService y
persistencia reales. Cubren herencia, geometría al salir del grupo, congelación
al pasar a Libre, orden y límites, conexiones, pack de selección, undo/redo,
conflicto de revisión y preservación de authored data y scopes. El test del
adaptador comprueba root propio, identidades que cambian entre comprobaciones,
botón deshabilitado, renderer ausente, root desmontado y plataforma nativa.

## Resultados

- 104/104 tests dirigidos, exit 0. Véase `directed.log`.
- `pnpm typecheck`, exit 0. Véase `typecheck.log`.
- QA de navegador 18/18, sin excepciones de la aplicación. Véase `results.json` y `gui.log`.
- `git diff --check`, exit 0.

La QA usa Panel, useCanvas, renderers registrados, scheduler, adaptador web,
schemas RPC y reducer de producción. `host-client.ts` es una copia acotada del
transporte de QA existente con rechazo de runtime e instrumentación adicional;
las mutaciones y las acciones se disparan desde la UI. `seed` sólo prepara
precondiciones de otro autor mediante el reducer real.

El caso de Secuenciador modifica una celda, inicia reproducción y pulsa Reiniciar
en la toolbar. Comprueba que cierren todos los contextos locales, que se cancelen
los cambios pendientes, que se limpie runtime, que haya exactamente un
`step-sequencer.reset` y ninguna transacción de contenido adicional. El rechazo
simulado conserva el runtime del servidor, muestra el error del renderer,
no entrega un evento de éxito y deja cero contextos vivos. El AudioHost está
instrumentado y no produce sonido: **esta QA no certifica audio físico**.

## Entorno y límites

La GUI corrió únicamente en la omabox propia
`lienzo-cierre-panel-sol-8e2b2030`, con `--net isolated` y sin puertos host
permitidos. Pantalla virtual 1920×1080 a 60 Hz, escala 1, Omarchy 4.0.3-1,
tema del box blueridge-dark. El catálogo omabox no reportó versión Hyprland,
por lo que no se infiere una. Chromium usó viewports 1440×1000 y 390×844 y los
temas de Panel lienzo-papel/lienzo-tinta. `environment.json` contiene el hash del
bundle y la metadata disponible. El box se cerró al terminar.

Iconos, host Modal, transporte, entrega al asistente y AudioHost son stand-ins.
No se certifica el Paseo instalado, dispositivo nativo, sonido físico, media
remota ni entrega a un agente real. El script no cubre las RPC de guardado de
plantillas/importación de catálogo; esas acciones conservan sus manejadores
existentes. El servicio real sí participa en los tests dirigidos de persistencia,
selección exportable y conflictos. El SDK 0.10.3 no permite una acción en Toast;
Panel muestra un recibo con un botón Deshacer funcional.

No se instaló ni recargó el plugin, no se tocó el desktop real, no se reinició el
daemon ni se modificaron servicios compartidos, Tailscale o worktrees ajenos.
La suite integrada completa corresponde al coordinador después de integrar sus
commits del núcleo y onboarding.

## Reproducción

Desde este worktree, con pnpm en PATH:

```sh
pnpm exec tsx --test tests/panel-actions.test.ts tests/frontend.test.ts tests/strokes-frontend.test.ts tests/whiteboard-frontend.test.ts tests/step-sequencer.test.ts
pnpm typecheck
bash design/qa-panel-close-2026-10-06/build.sh
```

Dentro de una omabox propia y aislada, servir `dist/panel-qa` en 8765 y abrir
Chromium con perfil temporal y depuración CDP en 9222. Con esa página ya abierta:

```sh
pnpm exec omabox -b NOMBRE run -- node /RUTA/DEL/WORKTREE/dist/panel-qa/panel-close.cjs
```

El script escribe resultados y capturas en `/tmp/lienzo-panel-*` dentro del box.
Copiar esos artefactos antes de cerrar exclusivamente ese box. No ejecutar
Chromium, capturas o automatización en el desktop del usuario.
