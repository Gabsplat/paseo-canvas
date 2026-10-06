# Lienzo

Plugin local de Paseo para construir documentos visuales junto a una conversación con un agente.
Los agentes usan MCP y la interfaz usa RPC; ambas entradas comparten el mismo servicio y almacenamiento.

Probado con Paseo 0.10.3 (el plugin declara `>=0.10.3 <0.11.0`). Tras instalarlo, elige
**Abrir Lienzo** en el Command Center de cualquier workspace, o escribe `/lienzo` en el chat de un agente.

## Instalar

En la máquina donde corre el daemon de Paseo, con **Settings → Plugins → Enable plugins** activado:

```sh
paseo plugin add Gabsplat/paseo-canvas:plugin
paseo plugin ls        # debe mostrar `canvas` como running
```

También se puede pegar `Gabsplat/paseo-canvas:plugin` en **Settings → Plugins → Plugin source**.
Los plugins de Paseo son código de confianza sin sandbox: instálalo solo si confías en este repositorio.

La rama `aprendizaje` incorpora arrastre libre, medios interactivos, seis bloques de
aprendizaje y una pizarra con texto, formas, lápiz, goma y SVG. Los pasos para probarla,
las comprobaciones realizadas y el trabajo pendiente están en
[`docs/probar-aprendizaje.md`](docs/probar-aprendizaje.md).

Los agentes nuevos reciben las herramientas de Lienzo de forma predeterminada. Desde el
diálogo de agente puedes desactivarlas o fijar quién recibe las acciones. Los agentes que
ya existían necesitan la configuración manual que ofrece ese diálogo.

Los contratos publicados están en
[`plugin/shared/model.ts`](plugin/shared/model.ts) y [`plugin/shared/rpc.ts`](plugin/shared/rpc.ts).

## Qué contiene

- Bloques tipados y grupos anidados con instrucciones de comunicación.
- Diagramas con nodos y conexiones que el agente puede ampliar durante una explicación.
- Catálogo local de tipos, plantillas y packs JSON portables.
- Documentos de ejemplo para revisión de frontend y enseñanza progresiva.
- Revisiones, transacciones, selección y feedback explícito al agente.
- Referencias a medios y previews web, con enlaces en clientes nativos.
- Pizarra con herramientas flotantes, texto libre, formas y SVG importado o de biblioteca.

Los ejemplos están identificados como ejemplos. El documento persistido es la fuente del contenido;
la interfaz no simula actividad ni respuestas del agente.

## Arquitectura interactiva

Abrir `architecture/index.html` permite explorar componentes y reproducir los flujos paso a paso.
La vista Multijugador distingue el comportamiento actual de las funciones futuras.
No requiere CDN ni una licencia de tldraw.

## Desarrollo

Requiere pnpm y Paseo 0.10.3. El rango del plugin es `>=0.10.3 <0.11.0`.

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
2. Crea un documento vacío o usa un ejemplo de frontend o aprendizaje. Los ejemplos
   llevan una etiqueta visible.
3. Inserta bloques o plantillas desde el catálogo. Selecciona un bloque, grupo o el documento
   para editar contenido e instrucciones de comunicación en el inspector.
4. No hace falta conectar nada: los agentes que crees después de instalar el plugin reciben
   las herramientas de Lienzo, y el agente que usa un lienzo pasa a recibir tus acciones.
   Desde el diálogo de agente puedes fijar un destinatario, desactivar las herramientas
   para agentes nuevos o elegir entre lienzos compartidos y un lienzo por agente. Un agente
   creado antes de instalar el plugin necesita la guía manual del mismo diálogo.
5. Envía una acción explícita para pedir cambios, responder o consultar un paso. La selección
   por sí sola no inicia un turno. La interfaz muestra el estado real de entrega.
6. Importa y exporta packs desde el catálogo. Los ejemplos integrados se pueden copiar a
   un pack portable propio; la referencia original está protegida.

El acceso a documentos por MCP se autoriza por workspace. Con «Uno por agente», cada agente
alcanza solo los lienzos que creó, los que recibe y los que nadie reclamó todavía. La conexión
elige el destinatario del feedback.

## Contratos y diseño

- [`docs/mcp.md`](docs/mcp.md) describe los contratos del backend y la integración con agentes.
- [`docs/design.md`](docs/design.md) define la interfaz, los diagramas y las alternativas nativas.
- [`design/tokens.json`](design/tokens.json) contiene los colores y medidas aprobados por diseño.
- [`docs/architecture.md`](docs/architecture.md) separa el contrato actual de las propuestas originales.

Cada documento pertenece a un workspace. La conexión selecciona el destinatario del feedback;
el MCP está ligado a la identidad del agente y su workspace. El catálogo pertenece al host.

Compartir un host permite compartir los documentos. Presencia, cursores de equipo,
identidades de personas, CRDT y sincronización entre hosts son trabajo futuro.
