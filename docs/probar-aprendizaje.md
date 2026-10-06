# Probar aprendizaje

La rama `aprendizaje` incluye el arrastre libre, resize guardado, onboarding y medios
interactivos, además de Apuesta, Gráfica, Figura por pasos, Flujo animado, Shader GLSL e
Imagen/texto anotado. Es una rama de desarrollo para probar el progreso.

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

Abre un lienzo existente o crea uno. Arrastra una tarjeta desde su encabezado, agrupa
tarjetas y prueba el resize desde la esquina. Usa la ayuda del onboarding para consultar
los controles de cámara, selección, enlaces, medios y posiciones automáticas.

Los seis bloques nuevos están en el catálogo. Para armar un ejemplo con variables,
enlaces y resultados referenciados, crea un agente nuevo después de cargar esta versión
y pídele:

> Crea un lienzo de ejemplo de aprendizaje. Consulta canvas_catalog y arma una Gráfica
> con una variable y un bloque Controles para moverla. Agrega una Apuesta que oculte el
> resultado hasta que confirme mi respuesta. Incluye Figura por pasos, un Flujo animado
> sobre enlaces reales, un Shader GLSL sencillo e Imagen/texto anotado con texto de
> ejemplo. Etiqueta el documento como ejemplo y crea todo con transacciones confirmadas.

Los contratos y ejemplos de datos están en [learning-blocks.md](learning-blocks.md).
Las declaraciones de variables son parte del documento; su valor durante la interacción
usa el canal runtime. El asistente recibe acciones asentadas, sin un evento por frame.
En clientes nativos los bloques de aprendizaje ofrecen una descripción estática.

## Estado de la entrega

La integración hasta `1039c03` pasa typecheck y 207 pruebas headless. Estas pruebas
cubren persistencia, conflictos, packs, runtime y protección de resultados, entre otros
casos. La revisión de interacciones en navegador está en curso. El host real de Paseo,
los clientes nativos y la GPU real requieren comprobaciones separadas.

Trazos, Secuenciador y la implementación completa de la interfaz flotante siguen
pendientes. El diseño de esa interfaz ya está documentado; esta rama todavía conserva
parte de los paneles actuales.
