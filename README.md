# Lienzo

Plugin local de Paseo para construir documentos visuales junto a una conversación con un agente.
Los agentes usan MCP y la interfaz usa RPC; ambas entradas comparten el mismo servicio y almacenamiento.

Instalado y verificado en Paseo 0.10.3. La suite pasa 42 pruebas y el typecheck completo.
Abrir el [workspace de Lienzo](https://omarchy.tailff08b5.ts.net:15443/h/srv_T1b7PG6C2vvD/workspace/wks_5d51b3a95e377433)
por Tailscale y elegir **Abrir Lienzo** en el Command Center. El documento **Lienzo en vivo**
contiene una explicación, un diagrama ampliado por un agente real y una preview interactiva.

Los contratos publicados están en
[`plugin/shared/model.ts`](plugin/shared/model.ts) y [`plugin/shared/rpc.ts`](plugin/shared/rpc.ts).

## Qué contiene

- Bloques tipados y grupos anidados con instrucciones de comunicación.
- Diagramas con nodos y conexiones que el agente puede ampliar durante una explicación.
- Catálogo local de tipos, plantillas y packs JSON portables.
- Documentos de ejemplo para revisión de frontend y enseñanza progresiva.
- Revisiones, transacciones, selección y feedback explícito al agente.
- Referencias a medios y previews web, con enlaces en clientes nativos.

Los ejemplos están identificados como ejemplos. El documento persistido es la fuente del contenido;
la interfaz no simula actividad ni respuestas del agente.

## Arquitectura interactiva

Abrir `architecture/index.html` permite explorar componentes y reproducir los flujos paso a paso.
La vista Multijugador distingue el comportamiento actual de las funciones futuras.
No requiere CDN ni una licencia de tldraw.

La versión de revisión en esta máquina está disponible por Tailscale:
[Explorar arquitectura](https://omarchy.tailff08b5.ts.net:37443/architecture/index.html).

## Desarrollo

Requiere pnpm y Paseo 0.10.3. El rango del plugin es `>=0.10.3 <0.11.0`.

```sh
pnpm install
pnpm typecheck
pnpm test
```

Para instalar en otro host con plugins habilitados, usar el directorio `plugin`:

```sh
paseo plugin install /home/gabsplat/Labs/paseo-canvas/plugin
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
4. Conecta el agente que debe recibir tus acciones. Para agentes nuevos, habilita las
   herramientas de Lienzo en ese workspace antes de crearlos. Para agentes existentes,
   consulta su configuración MCP desde el panel y sigue la guía manual.
5. Envía una acción explícita para pedir cambios, responder o consultar un paso. La selección
   por sí sola no inicia un turno. La interfaz muestra el estado real de entrega.
6. Importa y exporta packs desde el catálogo. Los ejemplos integrados se pueden copiar a
   un pack portable propio; la referencia original está protegida.

El acceso a documentos por MCP se autoriza por workspace. Conectar un agente elige el
destinatario del feedback. Cambiar esa conexión no cambia el alcance de las herramientas.

## Contratos y diseño

- [`docs/mcp.md`](docs/mcp.md) describe los contratos del backend y la integración con agentes.
- [`docs/design.md`](docs/design.md) define la interfaz, los diagramas y las alternativas nativas.
- [`design/tokens.json`](design/tokens.json) contiene los colores y medidas aprobados por diseño.
- [`docs/architecture.md`](docs/architecture.md) separa el contrato actual de las propuestas originales.

Cada documento pertenece a un workspace. La conexión selecciona el destinatario del feedback;
el MCP está ligado a la identidad del agente y su workspace. El catálogo pertenece al host.

Compartir un host permite compartir los documentos. Presencia, cursores de equipo,
identidades de personas, CRDT y sincronización entre hosts son trabajo futuro.
