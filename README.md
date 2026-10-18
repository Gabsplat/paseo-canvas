# Lienzo

Plugin local de Paseo para construir documentos visuales junto a una conversación con un agente.
Los agentes usan MCP y la interfaz usa RPC; ambas entradas comparten el mismo servicio y almacenamiento.

Probado con Paseo 0.10.3 y tipado contra el SDK 0.11.0 (el plugin declara `>=0.10.3 <0.12.0`). Tras instalarlo, elige
**Abrir Lienzo** en el Command Center de cualquier workspace, o escribe `/lienzo` en el chat de un agente.

## Instalar

En la máquina donde corre el daemon de Paseo, con **Settings → Plugins → Enable plugins** activado:

```sh
paseo plugin add Gabsplat/paseo-canvas:plugin
paseo plugin ls        # debe mostrar `canvas` como running
```

También se puede pegar `Gabsplat/paseo-canvas:plugin` en **Settings → Plugins → Plugin source**.
Los plugins de Paseo son código de confianza sin sandbox: instálalo solo si confías en este repositorio.

La rama `aprendizaje` incorpora arrastre libre, resize guardado, medios interactivos,
seis bloques de aprendizaje y una pizarra con texto, formas, trazos anclados y SVG.
Los pasos para probarla y el alcance de las comprobaciones están en
[`docs/probar-aprendizaje.md`](docs/probar-aprendizaje.md).

Los agentes nuevos reciben las herramientas de Lienzo de forma predeterminada. Desde el
diálogo de agente puedes desactivarlas o fijar qué agente trabaja en un lienzo. Los agentes que
ya existían necesitan la configuración manual que ofrece ese diálogo.

Los contratos publicados están en
[`plugin/shared/model.ts`](plugin/shared/model.ts) y [`plugin/shared/rpc.ts`](plugin/shared/rpc.ts).

## Qué contiene

- Bloques tipados y grupos anidados con instrucciones de comunicación.
- Nodos, enlaces y grupos en grafo que el agente puede ampliar durante una explicación.
- Catálogo local de tipos de bloque y extensiones (herramientas que escribís vos o tu agente), que se comparten como archivos.
- Pantallas de Lienzos (con miniaturas), guía animada, Ajustes, Extensiones e Historial.
- Revisiones, transacciones y una selección que el agente lee cuando se la mencionas.
- Referencias a medios y previews web, con enlaces en clientes nativos.
- Pizarra con herramientas flotantes, texto libre, formas y SVG importado o de biblioteca.
- Trazos a mano alzada que acompañan a su tarjeta.

Un documento guardado como ejemplo antes conserva su etiqueta. El documento persistido es la fuente del contenido;
la interfaz no simula actividad ni respuestas del agente.

## Arquitectura interactiva

Abrir `architecture/index.html` permite explorar componentes y reproducir los flujos paso a paso.
La vista Multijugador distingue el comportamiento actual de las funciones futuras.
No requiere CDN ni una licencia de tldraw.

## App de escritorio

`apps/desktop` ejecuta Lienzo fuera de Paseo como app de Electron, con el mismo núcleo, panel, herramientas MCP y
formato de estado que el plugin. Los agentes se conectan por MCP sobre HTTP en `http://127.0.0.1:7421/mcp`. Le
hablas al agente en su terminal; cuando dices «mirá lo que seleccioné», lo lee con `canvas_selection`.

```sh
pnpm --dir apps/desktop dev      # abrir la app
pnpm --dir apps/desktop build    # AppImage de Linux sin firmar en apps/desktop/release/
claude mcp add lienzo --transport http http://127.0.0.1:7421/mcp
```

Diferencias con el plugin, cómo copiar un estado de Paseo y límites conocidos: [`docs/desktop.md`](docs/desktop.md).

## Desarrollo

Requiere pnpm y Paseo 0.10.3 o 0.11.x. El rango del plugin es `>=0.10.3 <0.12.0`.

```sh
pnpm install
pnpm typecheck
pnpm test
```

Para instalar desde un clon local, usar la ruta absoluta del directorio `plugin`:

```sh
paseo plugin install /ruta/absoluta/a/paseo-canvas/plugin
paseo plugin ls
```

Los cambios posteriores se cargan con `paseo plugin reload canvas`; no hace falta reiniciar Paseo.
La instalación requiere que el host tenga los plugins habilitados.

## Flujo de uso

Una vez instalado el plugin:

1. Abre un workspace de Paseo y busca **Abrir Lienzo** en el Command Center. El comando
   `/lienzo` también abre el panel.
2. Crea un Lienzo vacío (menú → New Lienzo) o elegí uno en la pantalla Lienzos, que los
   muestra con su miniatura.
3. Inserta bloques desde el `+` de la barra de herramientas. La barra de selección permite editar
   propiedades e instrucciones de bloques y grupos. Más acciones abre los ajustes del documento.
4. No hace falta conectar nada: los agentes que crees después de instalar el plugin reciben
   las herramientas de Lienzo, y el agente que usa un lienzo queda conectado a él.
   Desde el diálogo de agente puedes fijar ese agente, desactivar las herramientas
   para agentes nuevos o elegir entre lienzos compartidos y un lienzo por agente. Un agente
   creado antes de instalar el plugin necesita la guía manual del mismo diálogo.
5. Lienzo es de una sola vía: el lienzo nunca le envía nada al agente. Selecciona algo y dile
   «mirá lo que seleccioné» en la conversación de Paseo; el agente lee la selección, sus
   instrucciones y lo que hiciste en cada bloque (respuestas, controles, el estado de una mini app).
6. Agregá o exportá extensiones desde la pantalla Extensions (menú → Extensions). Un archivo
   se revisa antes de instalarse. Lienzo ya no trae ejemplos, plantillas ni colecciones.

El acceso a documentos por MCP se autoriza por workspace. Con «Uno por agente», cada agente
alcanza solo los lienzos que creó, los que tiene conectados y los que nadie reclamó todavía.

## Contratos y diseño

- [`docs/mcp.md`](docs/mcp.md) describe los contratos del backend y la integración con agentes.
- [`docs/design.md`](docs/design.md) define la interfaz, los grafos y las alternativas nativas.
- [`design/tokens.json`](design/tokens.json) contiene los colores y medidas aprobados por diseño.
- [`docs/architecture.md`](docs/architecture.md) separa el contrato actual de las propuestas originales.

Cada documento pertenece a un workspace. La conexión indica qué agente trabaja en él;
el MCP está ligado a la identidad del agente y su workspace. El catálogo pertenece al host.

Compartir un host permite compartir los documentos. Presencia, cursores de equipo,
identidades de personas, CRDT y sincronización entre hosts son trabajo futuro.
