# Aprendizaje interactivo

La rama `aprendizaje` integra seis tarjetas de aprendizaje y Trazos sobre las capas
`wb-draw` de la pizarra. El conjunto pasa 285 pruebas headless y typecheck. Las acciones
contextuales y los popovers de la interfaz flotante están implementados e integrados.

| Función | Comportamiento implementado |
| --- | --- |
| Gráfica de funciones | Variables compartidas, respuesta durante el arrastre, huecos de dominio y lectura de traza. |
| Figura por pasos | Parches declarativos validados, avance y retroceso, descripción y reproducción opcional. |
| Flujo animado | Eventos sobre nodos y conexiones reales, referencias ausentes visibles y pausa fuera de vista. |
| Shader GLSL | Uniforms declarados, variables compartidas, errores de compilación visibles y alternativa sin WebGL. |
| Imagen/texto anotado | Hotspots, detalles accesibles y anclas que se invalidan si cambia el contenido. |
| Secuenciador | Escala fija, patrón y tempo; audio tras pulsar Reproducir y silencio al salir; ningún evento por paso. |
| Trazos | Capas persistentes, autor distinguible, anclaje a una tarjeta, Borrar mis trazos y resumen asentado al salir. |

Trazos extiende el renderer de pizarra existente. Conserva los límites de puntos y
de 1 MiB por documento, las transacciones y el deshacer. Las copias remapean el
anclaje cuando también copian la tarjeta. Borrar mis trazos conserva las capas del
asistente y del documento original. La estimación de tamaño cuenta una capa
reemplazada una sola vez.

La marca de escucha del Secuenciador corresponde a la música que completó un ciclo
real. Cambiar el patrón o el tempo y pausar enseguida no acredita el patrón nuevo.
El scheduler cuenta los pasos que alcanzó el reloj de audio; las notas en cola aún
no cuentan. El contador por paso no es una región viva para lectores de pantalla.

## Validación

La suite headless usa los contratos, reducer, servicio y store de runtime reales.
Cubre persistencia, conflictos, grupos, packs, límites, referencias remapeadas,
resultados ocultos y callbacks tardíos después de cambiar de documento.

La comprobación en navegador se hizo dentro de omabox aislado:

- Siete escenarios de aprendizaje con componentes RN-web, incluidos WebGL real y
  carga de hotspots. [Informe](../design/qa-learning-2026-10-06/report.md).
- Veinticuatro casos de pizarra con el Panel y useCanvas reales, texto, formas,
  resize, SVG, iframes, compacto claro/oscuro y 150 bloques.
  [Informe](../design/qa-whiteboard-2026-10-06/report.md).
- Catorce casos del Secuenciador con señal Web Audio medida tras el clic, sin
  dispositivo de audio físico. El rechazo de audio y la pestaña oculta se simularon.
  [Resultados](../design/qa-cierre-2026-10-06/sequencer-results.json).
- Doce casos posteriores con el Panel real comprobaron trazos anclados,
  identificación del autor, borrado propio, teclado y escucha del patrón final.
  [Resultados](../design/qa-cierre-2026-10-06/cierre-results.json).

La comprobación final del conjunto volvió a ejecutar 18 casos de acciones contextuales,
12 de convivencia de Trazos y Secuenciador y cinco de la guía. Incluye instrucciones
heredadas, conexiones, foco, compacto de 48 px y reset contextual con rechazo visible.
El reset contextual usa un AudioHost instrumentado; la convivencia usa Web Audio del
navegador. [Informe final](../design/qa-final-integration-2026-10-06/report.md).

El host y transporte de los arneses son sustitutos. No equivalen a instalar el
plugin en Paseo, probar dispositivos nativos o enviar feedback a un agente real.
En nativo, las tarjetas de aprendizaje muestran una descripción estática; el
Secuenciador no abre un contexto de audio.

## Contratos y forma de trabajo

Los datos y eventos están descritos en [learning-blocks.md](learning-blocks.md).
Los contratos de pizarra están en [whiteboard-spec.md](../design/whiteboard-spec.md)
y las decisiones visuales en [design.md](design.md).

Arquitectura y diseño corresponden a Claude Opus 5.5 con pensamiento Medium;
la implementación de ingeniería usa GPT 6.1 Sol con High. Cada agente trabaja
en un checkout aislado con ownership explícito. El coordinador integra las
entregas limpias, repite las comprobaciones tras cambios y publica la rama de
prueba. El checkout principal conserva los cambios previos del usuario.

Los renderers usan JSON declarativo. GLSL es la excepción explícita y sus errores
los muestra el bloque. La respuesta gráfica sigue al gesto y el asistente recibe
solo acciones asentadas. Los trazos permanecen en el documento, sin usar el canal
runtime para eludir sus límites.

Los pasos para cargar y probar la rama están en
[probar-aprendizaje.md](probar-aprendizaje.md).
