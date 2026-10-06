# Verificación de aprendizaje en RN-web, 2026-10-06

Los siete escenarios del navegador pasan. Se corrigió un fallo reproducible de carga
de Imagen anotada. Las 24 pruebas relevantes y el typecheck pasan. El resultado es
QA del Canvas real bajo RN-web con host simulado; no prueba el plugin instalado en Paseo.

## Fuente y entorno

Worktree exclusivo `lienzo-qa-interacciones`, rama `lienzo/qa-interacciones`, base
`1039c03`. Se aplicó el commit de integración `0f14fe7c96839c3657069acdcac1586be1a62bc1`
como `35d7648` antes del último rebuild. La corrección de Imagen está en `e6224df`.
No se editó el dispatcher después de ese cherry-pick.

Chromium 152.0.7977.82, React/react-dom 19.1.0 y react-native-web 0.21.3.
Omabox propio `lienzo-qa-learning`, red aislada sin puertos permitidos al host,
1920 × 1080 a 60 Hz, escala 1, viewport 1896 × 1030. Omarchy 4.0.3-1,
Hyprland 0.56.2, tema del box blueridge-dark. Las capturas del producto usan
los tokens existentes Lienzo Papel y Lienzo Tinta. No hubo nuevas decisiones visuales.

Servidor HTTP y CDP estuvieron exclusivamente dentro del box. El SVG de imagen es
el fixture sintético local existente. Se instalaron offline las dependencias del
lockfile del worktree con pnpm, sin cambios a manifests, dependencias o lockfile.
No se instaló/reloaded el plugin, reinició Paseo, modificó Tailscale, hizo push ni
escribió en el checkout principal. El box se cerró al terminar.

## Qué ejecuta el harness

`design/graph-harness/real/main.tsx` monta Canvas, Blocks, Links, los renderers
registrados, presentation y el `LearningRuntimeStore` de producción. El transporte
simulado valida los esquemas reales de runtime y aplica cambios a un estado en memoria.
Los cambios de contenido siguen el parser de transacciones y reducer reales.
No se usaron sliders ni figuras de reemplazo. CDP envió eventos de ratón y teclado
al navegador, y las comprobaciones leyeron DOM, bitmap, geometría SVG y runtime.

Los eventos asentados se registran como `simulated: true`. El ack simulado no
establece entrega a un agente. Reset externo y cambio de documento son entradas
de prueba explícitas que llaman la sincronización real del store, sin host RPC.

## Casos y evidencia

| Caso | Resultado comprobado | Captura |
| --- | --- | --- |
| Controles y Gráfica | Amplitud cambia el scope optimista y el bitmap antes del ack de 2000 ms. El slider no mueve el bloque ni crea transacciones. Reset elimina el override y conserva el valor declarado. El encabezado permite un arrastre con `entity.move`. | [Claro](controls-light.png), [oscuro](controls-dark.png) |
| Apuesta | Solución ausente del DOM en draft y committed. Guardar fija la elección; revelar muestra el resultado y registra una comparación. Reiniciar vuelve a ocultarlo sin editar contenido. | [Guardada](prediction-committed.png), [revelada](prediction-revealed.png), [reiniciada](prediction-reset.png) |
| Apuesta con callbacks tardíos | Después de emitir una comparación con ack demorado 1200 ms, reset externo o cambio a un documento con los mismos IDs ocultan el resultado. Después del ack, el runtime anterior sigue ausente. | [Reset externo](prediction-reset-late.png), [otro documento](prediction-document-late.png) |
| Figura | Siguiente y Anterior cambian el paso real. Play llega al paso declarado; Reiniciar vuelve a Paso 1 de 2. Sin transacciones de contenido. | [Figura](figure.png) |
| Flujo | Play crea el token sobre la conexión existente. Pausar fija el playhead. Arrastrar Destino modifica la posición del token sobre la geometría SVG actual antes de guardar. El playhead no avanza en pausa y reset conserva la conexión. | [Flujo pausado](flow-paused.png) |
| Shader | Contexto WebGL real del navegador. Mover Frecuencia cambia los píxeles capturados del stage, sin transacción. Un fragment inválido que pasa el esquema produce el diagnóstico real de compilación. | [Shader](shader.png), [error GLSL](shader-error.png) |
| Imagen y texto | Hotspots seleccionan la anotación real y muestran su explicación. Ocultar la capa retira el hotspot. Reset limpia exploración; Shift+Tab desde Reset enfoca el hotspot de texto y lo selecciona. Sin transacciones de contenido. | [Anotaciones](annotations.png) |

El contexto reportó `WebGL 1.0 (OpenGL ES 2.0 Chromium)` y
`ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL ES 3.2)`.
Esto verifica creación de contexto, compilación y salida visible en este navegador
dentro del box. No es un benchmark de GPU ni prueba de hardware/native/Paseo.

## Corrección de Imagen anotada

Antes del fix, el fixture local estaba completo con dimensiones 640 × 420, pero el
renderer lanzaba `TypeError: Cannot destructure property 'width' of event.nativeEvent.source
as it is undefined`. Seguía mostrando Cargando imagen y no montaba sus hotspots.

RN-web 0.21.3 entrega un evento de carga con el elemento en `nativeEvent.target`;
React Native entrega dimensiones en `nativeEvent.source`. `imageLoadDimensions` en
el adaptador `web.ts` admite ambas formas, usa dimensiones intrínsecas confirmadas,
rechaza tamaños nulos/no finitos y mantiene el acceso a propiedades del navegador
inactivo en native. El renderer conserva la comprobación de identidad del asset.
Se añadió una regresión del adaptador y se verificó el mismo SVG en Chromium.

## Checks ejecutados

- `design/graph-harness/real/build.sh` con PATH de pnpm. Bundle de desarrollo.
- `learning-smoke.cjs` dentro del box. Siete escenarios pasan y cero excepciones
  no capturadas. Resultado literal en [results.json](results.json).
- `pnpm exec tsx --test tests/learning-adapters.test.ts tests/annotated-content.test.ts tests/learning-publication.test.ts`.
  24/24 pasan, incluidas las seis regresiones del commit de integración.
- `pnpm typecheck` y `git diff --check` pasan.

El build inicial falló por ausencia de node_modules. Se resolvió con instalación
offline del lockfile. Los primeros scripts tenían selectores incorrectos y una
expectativa equivocada de operación de arrastre; se corrigió el script. La falla
de dimensiones de Imagen sí era de código de producción. No quedan bloqueadores
para estos escenarios después del cherry-pick y la corrección.

## Límites y puntos para integración

No se verificaron Paseo real, host modal/iconos, native, escala física, gestos táctiles,
transporte/polling, entrega al agente, persistencia de runtime en disco ni undo/conflictos
mediante el navegador. La barra del harness es un stand-in de prueba y no representa
el Panel del producto. El smoke claro/oscuro cubre Controles/Gráfica, no todos los
renderers en ambas paletas ni una auditoría completa de accesibilidad.

El shader inválido deja visible el último bitmap válido junto al error explícito de
compilación. Esa es la conducta observada; no se ensayó context loss ni fallback por
WebGL ausente en este navegador. Figura usa un único paso declarado y Flujo una sola
ruta; propagación extensa, paths paralelos y presupuestos no se ensayaron en GUI.

Para integrar, conservar primero `0f14fe7` en aprendizaje, después aplicar el commit
`e6224df` de Imagen y el commit de harness/evidencia de esta rama. No volver a aplicar
`35d7648` si aprendizaje ya tiene el commit original de integración.
