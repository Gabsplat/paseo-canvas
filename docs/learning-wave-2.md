# Aprendizaje interactivo

La rama `aprendizaje` integra las tarjetas de aprendizaje Controles, Flujo animado y
Shader GLSL, y Trazos sobre las capas `wb-draw` de la pizarra. El conjunto pasa las
pruebas headless (`pnpm test`) y typecheck. Las acciones
contextuales y los popovers de la interfaz flotante están implementados e integrados.

| Función | Comportamiento implementado |
| --- | --- |
| Controles | Deslizadores para las variables compartidas del grupo o documento, con Reiniciar. |
| Flujo animado | Eventos sobre nodos y conexiones reales, referencias ausentes visibles y pausa fuera de vista. |
| Shader GLSL | Uniforms declarados, variables compartidas, errores de compilación visibles y alternativa sin WebGL. |
| Trazos | Capas persistentes, autor distinguible, anclaje a una tarjeta, Borrar mis trazos y resumen asentado al salir. |

Trazos extiende el renderer de pizarra existente. Conserva los límites de puntos y
de 1 MiB por documento, las transacciones y el deshacer. Las copias remapean el
anclaje cuando también copian la tarjeta. Borrar mis trazos conserva las capas del
asistente y del documento original. La estimación de tamaño cuenta una capa
reemplazada una sola vez.

## Validación

La suite headless usa los contratos, reducer, servicio y store de runtime reales.
Cubre persistencia, conflictos, grupos, packs, límites, referencias remapeadas,
resultados ocultos y callbacks tardíos después de cambiar de documento.

La comprobación en navegador se hizo dentro de omabox aislado:

- Escenarios de aprendizaje con componentes RN-web, incluido WebGL real.
  [Informe](../design/qa-learning-2026-10-06/report.md).
- Veinticuatro casos de pizarra con el Panel y useCanvas reales, texto, formas,
  resize, SVG, iframes, compacto claro/oscuro y 150 bloques.
  [Informe](../design/qa-whiteboard-2026-10-06/report.md).
- Casos posteriores con el Panel real comprobaron trazos anclados,
  identificación del autor, borrado propio y teclado.
  [Resultados](../design/qa-cierre-2026-10-06/cierre-results.json).

La comprobación final del conjunto volvió a ejecutar las acciones contextuales, los
trazos anclados y la guía. Incluye instrucciones heredadas, conexiones, foco, compacto
de 48 px y reset contextual con rechazo visible.
[Informe final](../design/qa-final-integration-2026-10-06/report.md).

El host y transporte de los arneses son sustitutos. No equivalen a instalar el
plugin en Paseo, probar dispositivos nativos o enviar feedback a un agente real.
En nativo, las tarjetas de aprendizaje muestran una descripción estática.

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
