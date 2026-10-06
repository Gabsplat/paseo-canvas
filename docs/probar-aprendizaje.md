# Probar aprendizaje

La rama `aprendizaje` incluye el arrastre libre, resize guardado, onboarding, medios
interactivos y la pizarra con herramientas flotantes. También incluye Apuesta, Gráfica,
Figura por pasos, Flujo animado, Shader GLSL e Imagen/texto anotado, además del
Secuenciador y las anotaciones con Trazos. Es una rama de
desarrollo para probar el progreso.

## Cargarla en Paseo

Ejecuta los comandos en la máquina donde corre el daemon que usas en Paseo. Si entras
desde una Mac a un daemon Linux, ejecútalos en Linux. Requiere Paseo 0.10.3 y plugins
habilitados. No hace falta reiniciar el daemon ni resetear los documentos.

Si ya tienes la instalación `canvas`, desactívala y agrega la versión de prueba con un
ID distinto. Paseo rechaza instalar encima de un ID existente. Conserva la instalación
anterior y sus preferencias:

```sh
paseo plugin disable canvas
paseo plugin install github:Gabsplat/paseo-canvas:plugin --ref aprendizaje --id canvas-aprendizaje
paseo plugin ls canvas-aprendizaje
```

Si todavía no tenías Lienzo, omite el primer comando. La última salida debe indicar
`running`. Luego abre el workspace en Paseo y elige **Abrir Lienzo** en el Command Center,
o escribe `/lienzo` en un chat. Si tenías el panel abierto, ciérralo y vuelve a abrirlo.

Mantén una sola instalación de Lienzo habilitada. El plugin guarda los documentos en
`$PASEO_HOME/canvas`, o `~/.paseo/canvas` cuando no hay un home personalizado. Esa ruta
es compartida por las instalaciones del plugin en el mismo daemon; la versión nueva
lee los documentos existentes. Las preferencias del onboarding pertenecen al ID de
instalación, por lo que la guía aparece al estrenar `canvas-aprendizaje`.

Para actualizar después esta instalación Git a la rama de desarrollo:

```sh
paseo plugin update canvas-aprendizaje --ref aprendizaje --yes
```

Especifica `--ref aprendizaje`: una actualización Git sin esa opción consulta la rama
predeterminada del repositorio.

## Probar las interacciones

Abre un lienzo existente o crea uno. Arrastra una tarjeta desde cualquier zona pasiva
de su cuerpo, agrupa tarjetas y prueba el resize desde la esquina. Un clic corto conserva
la acción de los controles; mover más de 4 px inicia el arrastre. Los sliders, los puertos
de enlaces y las asas de resize conservan sus propios gestos.

Prueba las herramientas de la pizarra desde la barra flotante:

- Texto libre: elige Texto, pulsa en el lienzo y guarda el borrador. Escape permite
  cancelarlo. Selecciona el texto para cambiar color, tamaño, fuente o alineación.
- Formas: elige Forma y arrastra para fijar sus dimensiones. Cambia relleno y trazo desde
  el panel de estilo; prueba resize y deshacer.
- Lápiz y goma: dibuja varios trazos en la misma capa. La goma quita trazos completos;
  deshacer recupera el último cambio. Empieza sobre una tarjeta para anclar el dibujo:
  al moverla, sus trazos la acompañan. Tus trazos son continuos y los del asistente son
  discontinuos, con un rótulo. Borrar mis trazos conserva los del asistente y los del
  documento original. Escape sale del lápiz y envía un resumen asentado.
- SVG: abre la biblioteca de arquitectura o importa código, un archivo o una URL. El
  servidor rechaza contenido activo de forma atómica. La carga por URL necesita CORS.
- Medios y webs: mueve el bloque mientras está pasivo. Usa Interactuar para seleccionar
  texto o usar el contenido embebido y el chip de salida para volver al lienzo. Los eventos
  dentro de un iframe activo pertenecen a esa web.

El botón central y la rueda permiten panear también sobre bloques pasivos. Los atajos
de herramientas son V para seleccionar, H para mano, T para texto, R para forma, D para
lápiz y E para goma. Los controles enfocados conservan sus teclas. La ayuda del onboarding
reúne los controles de cámara, selección, enlaces, medios y posiciones automáticas.

Los siete bloques nuevos están en el catálogo. Para armar un ejemplo con variables,
enlaces y resultados referenciados, crea un agente nuevo después de cargar esta versión
y pídele:

> Crea un lienzo de ejemplo de aprendizaje. Consulta canvas_catalog y arma una Gráfica
> con una variable y un bloque Controles para moverla. Agrega una Apuesta que oculte el
> resultado hasta que confirme mi respuesta. Incluye Figura por pasos, un Flujo animado
> sobre enlaces reales, un Shader GLSL sencillo e Imagen/texto anotado con texto de
> ejemplo. Añade un Secuenciador en La menor con seis filas y ocho pasos para experimentar
> con notas y tempo. Etiqueta el documento como ejemplo y crea todo con transacciones confirmadas.

En el Secuenciador, pulsa las celdas para activar notas y Reproducir para habilitar el
audio. Prueba Pausar, Reiniciar y cambiar de documento mientras suena. El sonido debe
detenerse al salir del documento o sacar la rejilla de vista. Los pasos en cola todavía
no cuentan como escuchados; después de editar, la música nueva necesita su propio ciclo.
El asistente recibe el patrón y tempo finales, sin eventos por cada paso.

Los contratos y ejemplos de datos están en [learning-blocks.md](learning-blocks.md).
Las declaraciones de variables son parte del documento; su valor durante la interacción
usa el canal runtime. El asistente recibe acciones asentadas, sin un evento por frame.
En clientes nativos los bloques de aprendizaje ofrecen una descripción estática.

## Estado de la entrega

El núcleo integrado pasa typecheck y 289 pruebas headless. Cubren persistencia,
conflictos, packs, runtime, protección de resultados y validación de los cuatro tipos de
pizarra. Pasan 24 casos de navegador con el Panel, useCanvas, reducer y esquemas RPC reales
bajo RN-web en omabox aislado. El host y el transporte son sustitutos. Se probaron texto,
formas, resize, lápiz/goma, SVG, iframes, compacto claro/oscuro y arrastre de 150 bloques.
[Informe de pizarra y capturas](../design/qa-whiteboard-2026-10-06/report.md).

Los bloques de aprendizaje conservan la QA anterior de siete escenarios RN-web, incluidos
controles compartidos, reinicio de Apuesta, enlaces en movimiento y hotspots. Shader se
comprobó con WebGL real del navegador.
[Informe de aprendizaje y capturas](../design/qa-learning-2026-10-06/report.md).

Secuenciador y Trazos están integrados. La QA del Secuenciador pasó 14 casos con señal
Web Audio medida en Chromium bajo RN-web, sin escuchar un dispositivo físico. Otra pasada
de 12 casos con el Panel real comprobó su
convivencia con los trazos, los controles de teclado y el crédito de escucha después de
editar. [Resultados y capturas](../design/qa-cierre-2026-10-06/).

El cierre de las acciones contextuales de la interfaz flotante continúa en revisión.
Paseo instalado, dispositivos nativos y nuevas interacciones con un agente real siguen
sin verificarse. Las pruebas de navegador usan un host y transporte sustitutos, sin
instalar ni recargar el plugin.
