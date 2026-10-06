# Ola 2 de aprendizaje

Estado: autorizado por el dueño; piloto Apuesta + Gráfica integrado y revisado.
Prerequisito cumplido: cimientos integrado en `aprendizaje`; baseline `17203e5`,
typecheck y 116/116 pruebas verdes. Flujo integrado; en curso Figura por pasos, Shader e
Imagen/texto anotado. Trazos, Secuenciador y la implementación de UI flotante siguen pendientes.

| Renderer | Rama / worktree | Agente Sol High |
| --- | --- | --- |
| Apuesta, integrada `b883b9d` | `lienzo/apuesta` · `lienzo-apuesta` | `e22e6698-4a82-4ca6-94e3-084bfc12a498`, finalizado |
| Gráfica, integrada `51e8021` | `lienzo/grafica-funciones` · `lienzo-grafica-funciones` | `12de1ffe-f370-456d-9d91-064cbc1b7816`, finalizado |
| Figura por pasos, en curso | `lienzo/figura-pasos` · `lienzo-figura-pasos` | `ed71567b-4481-4fcb-9fca-5307193521f1` |
| Flujo animado, integrado con puente Canvas/Links | `lienzo/flujo-animado` · `lienzo-flujo-animado`, entrega `781173b` | `20b41949-b66f-4a7f-a5bd-1681b68e3fd4`, finalizado |
| Shader GLSL, en curso | `lienzo/shader-glsl` · `lienzo-shader-glsl` | `796bd056-4cca-4bcc-a0c4-dbce9ff2763e` |
| Imagen/texto anotado, integrado | `lienzo/anotaciones` · `lienzo-anotaciones`, entrega `81cff72` | `9ea8513e-bc77-4784-a062-2983b03aa109`, finalizado |

Los worktrees están bajo `/home/gabsplat/.paseo/worktrees/0q8wzdvy/`.
El coordinador integra la visibilidad del resultado de Apuesta en el núcleo y registra
los renderers; los ingenieros conservan la propiedad exclusiva de su módulo y pruebas.

Integración preparatoria confirmada: `f279278` añade el hook de visibilidad y el ID opcional
de eventos settled; `adeee27` conecta Canvas, Lista, Detalles y chips de selección.
Typecheck y 122/122 pruebas verdes tras esta preparación. El piloto integrado pasa
typecheck y 152/152 pruebas. La integración de Apuesta detectó y corrigió defaults de
elección que contaminaban la variante numérica; datos completos válidos ahora reemplazan
una variante incompatible, y las actualizaciones parciales conservan JSON merge patch.
Duplicación, inserción de plantillas y packs verifican referencias internas remapeadas,
referencias externas conservadas y runtime excluido. Revisión GUI/native real pendiente.
La tanda actual parte de `25092f0`, con typecheck y 153/153 pruebas verdes. El adaptador
expone `onVisibilityChange` para detener reproducción oculta y `maxPixelSize` para limitar
resolución física. Flujo está registrado y su puente dibuja tokens sobre paths reales,
incluyendo enlaces paralelos y geometría durante arrastre. Filtra resultados ocultos de
Apuesta y limita el dibujo a 256 tokens por frame; no guarda ni envía frames. Las pruebas
de integración verifican runtime optimista, ocultamiento, duplicación de referencias,
pausa/visibilidad y limpieza; la inspección browser/native real continúa pendiente.
La integración de Flujo pasa typecheck y 169/169 pruebas, sin omitidas. Los primeros
fallos del coordinador fueron de fixtures headless y del esquema del test de duplicación;
se corrigieron antes de la validación completa.
Puente y registro committed en `b60ff74`. Imagen/texto anotado ocupa la plaza libre
de Flujo; workspace `wks_f429ebc02f3b0382`, dependencias offline y configuración
explícita codex/gpt-6.1-sol, High, auto-review. Mantiene propiedad de sus tres archivos.
Anotaciones registrado pasa typecheck y 180/180 pruebas. La integración valida el esquema
real mediante CanvasService, edición de texto con el mismo ID/revisión sin reubicar anclas,
rollback ante offsets inválidos, packs sin runtime y cambio completo de texto a imagen.
Hotspots requieren carga y medida de la imagen. URLs mutables requieren actualizar la
revisión authored; no se descargan imágenes para comparar bytes. GUI/native real omitidas.

## Forma de trabajo

Un ingeniero GPT 6.1 Sol con pensamiento High por renderer, en un worktree propio creado desde
`aprendizaje`. Ramas bajo `lienzo/`; nunca `aprendizaje/`. Máximo tres ingenieros activos además
del coordinador. No agentes Claude, push, instalación del plugin, reinicio del daemon o cambios
de exposición. El checkout principal queda fuera del trabajo.

Cada ingeniero lee `AGENTS.md`, `docs/design.md` y `docs/learning-blocks.md`. Posee exclusivamente
su archivo compartido de renderer, su archivo cliente y sus pruebas. El coordinador añade las
líneas de registro, resuelve integraciones y conserva verde la rama después de cada fusión.
Si un renderer necesita un cambio de contrato, presenta una necesidad concreta antes de editar
el núcleo. No modifica archivos de otro renderer.

La especificación visual la terminó Sol con autorización del dueño, sobre material parcial de
Opus. No equivale a una implementación ni a una revisión final de Opus.

## Entregas en orden de prioridad

| Prioridad | Entrega | Comportamiento que debe probarse |
| --- | --- | --- |
| 1 | Apuesta | Compromiso previo de elección, estimación o curva; resultado oculto antes del compromiso; comparación y un evento settled por intento. Referencias ausentes y reinicio coherentes. |
| 2 | Gráfica de funciones | expr.ts, variables compartidas en vivo, huecos de dominio, familia opcional y lectura de traza. El slider vecino actualiza la figura sin esperar a la red. |
| 3 | Figura por pasos | Una figura con parches declarativos validados, avance/retroceso, descripción y cambios destacados; reproducción opcional. |
| 4 | Flujo animado | Eventos sobre nodos y conexiones reales, timeline y referencias ausentes. Signo/demora mediante un esquema explícito, sin claves ajenas al modelo de enlaces. |
| 5 | Shader GLSL | Uniforms declarados, binding de variables, errores de compilación visibles, recursos liberados y fallback sin WebGL. |
| 6 | Imagen/texto anotado | Un esquema de anclaje, hotspots accesibles, capas y anclas invalidadas por cambios del contenido. |
| 7 | Trazos | Puntos acotados, autor distinguible, dibujo aislado de gestos de cámara y límites de tamaño efectivos. |
| 8 | Secuenciador | Escala fija, patrón y tempo, audio tras gesto real y silencio al salir; ningún tick enviado al asistente. |

Después de los renderers: implementar las islas, toolbar de selección, edición en lugar y
popovers conforme a `docs/design.md`, reemplazando el inspector acoplado. Esta refactorización
es una novena entrega; no debe confundirse con la documentación de diseño ya terminada.

## Alcance y control de coste

Estimación de tamaño, antes de implementar: ocho módulos con sus pruebas y una refactorización
principal de UI; aproximadamente 4.000–7.000 líneas entre código y pruebas. La cifra no es un
presupuesto monetario ni una promesa de duración. Gate, flujo y trazos tienen la mayor incertidumbre
por visibilidad de resultados, integración con el grafo y límites de almacenamiento.

Propuesta económica: validar primero Apuesta y Gráfica, revisar el contrato con ese piloto y
continuar con los otros seis en tandas de hasta tres. Evitar ocho agentes simultáneos y reabrir
un renderer solo por un fallo concreto. Cada fusión pasa typecheck y la suite completa una vez;
se repiten pruebas solo si aparece un cambio o un fallo nuevo.

## Reglas de aceptación

- JSON declarativo; ningún JS ni HTML provisto por el asistente. La única excepción es el fragment
  shader GLSL, con errores de compilación capturados.
- Una pregunta u objetivo visible, pocos controles y Reiniciar visible por bloque manipulable.
- Respuesta gráfica en cada frame de interacción. El asistente recibe solo valores settled,
  intervalos explorados y apuesta frente a resultado; pistas antes que soluciones.
- Web/escritorio interactivo y alternativa native estática, identificada como tal.
- Respetar 1 MiB por documento y los límites explícitos del canal runtime. Los trazos no pueden
  usar ese canal para eludir los límites.
- Validación real de persistencia, conflictos, grupos, packs y comportamiento MCP conservada.
- Las pruebas de lógica son headless. GUI y capturas solo dentro de omabox. La inspección visual
  final es una comprobación separada y se reporta como omitida si no se realiza.
