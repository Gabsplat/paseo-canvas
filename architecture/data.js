/* Paseo Canvas — datos del explicador de arquitectura.
   Nombres y campos alineados con plugin/shared/model.ts y rpc.ts (autoritativos) y docs/mcp.md */
window.ARCH = (function () {
  const W = 210;
  const H = 60;

  const zones = [
    { id: "cliente", title: "App de Paseo · cliente del plugin", x: 40, y: 50, w: 260, h: 665 },
    { id: "plugin", title: "Subproceso del plugin · daemon", x: 470, y: 50, w: 740, h: 665 },
    { id: "agente", title: "Agente", x: 1245, y: 50, w: 260, h: 665 },
    { id: "futuro", title: "Futuro · no construido", x: 1535, y: 50, w: 260, h: 665 },
    { id: "disco", title: "Disco del host · $PASEO_HOME/canvas/", x: 470, y: 755, w: 740, h: 200 },
    { id: "modelo", title: "Modelo del documento", x: 1245, y: 755, w: 550, h: 200 },
  ];

  const nodes = [
    /* ───────── Cliente ───────── */
    {
      id: "user", zone: "cliente", x: 65, y: 100, icon: "user",
      title: "Persona", sub: "Lee, selecciona y actúa",
      what: "Quien conversa con el agente. No dibuja el lienzo a mano: lo lee, lo reordena, selecciona partes y responde a través de los bloques.",
      duties: [
        "Seleccionar bloques o grupos para dar contexto.",
        "Pulsar acciones declaradas por cada bloque (enviar, elegir, aprobar).",
        "Mover, agrupar y deshacer como en cualquier lienzo.",
      ],
      apis: [],
      contract: null,
      owner: "—",
    },
    {
      id: "panel", zone: "cliente", x: 65, y: 205, icon: "layout",
      title: "Panel Canvas", sub: "Panel de workspace",
      what: "La superficie visual. Es un panel de workspace (no de agente) porque el documento pertenece al workspace y sobrevive a cualquier agente concreto.",
      duties: [
        "Dibujar bloques y grupos con React Native: sin DOM ni SVG.",
        "Enviar una transacción al terminar cada gesto, nunca por fotograma.",
        "Sondear con canvas.watch y recibir la vista solo si algo cambió.",
        "Sumar las posiciones de los ancestros al dibujar: son relativas al grupo padre.",
        "Mostrar estados reales: vacío, cargando, error, conflicto, sin agente.",
      ],
      apis: ["client.addWorkspacePanel", "useRpc", "useAgent", "@tanstack/react-query"],
      contract: 'client.addWorkspacePanel({\n  id: "canvas",\n  title: "Canvas",\n  icon: "LayoutDashboard",\n  context: "workspace",\n  locations: ["workspace"],\n  Component: CanvasPanel,\n});',
      owner: "plugin/client/ · ingeniería frontend",
    },
    {
      id: "selection", zone: "cliente", x: 65, y: 310, icon: "cursor",
      title: "Selección visible", sub: "Contexto sin gastar turno",
      what: "Lo que la persona tiene seleccionado. Se comparte con el agente como contexto ambiental: seleccionar nunca inicia un turno.",
      duties: [
        "Informar la selección al servidor con un pequeño retardo (≈250 ms).",
        "Mostrar siempre un indicador de «esto es lo que el agente puede ver».",
        "Tener versión propia (selectionVersion), separada de la revisión del contenido.",
        "Queda en document.selectedIds: el agente la ve al leer el documento.",
      ],
      apis: ["RPC canvas.selection.set", "document.selectedIds"],
      contract: "canvas.selection.set({\n  workspaceId, documentId,\n  expectedSelectionVersion: 14,\n  ids: [\"login\", \"login-estados\"]\n})",
      owner: "plugin/client/ + plugin/server/",
    },
    {
      id: "composer", zone: "cliente", x: 65, y: 415, icon: "message",
      title: "Compositor del chat", sub: "Píldora y adjunto",
      what: "El cuadro de mensaje nativo de Paseo. El plugin añade una píldora para abrir el lienzo y una fuente de adjuntos «Selección del canvas».",
      duties: [
        "Adjuntar la selección como texto estable junto al mensaje de la persona.",
        "Abrir el panel desde la conversación (píldora y Command Center).",
      ],
      apis: ["client.addComposerPill", "client.addAttachmentSource", "client.addCommandCenterItem", "client.openPanel"],
      contract: 'defineAttachmentSource({\n  id: "canvas-selection",\n  title: "Selección del canvas",\n  icon: "MousePointerClick",\n  search: searchSelectionRpc,\n})',
      owner: "plugin/client/ · plugin/shared/",
    },
    {
      id: "catalogui", zone: "cliente", x: 65, y: 520, icon: "book",
      title: "Catálogo e inspector", sub: "Tipos, plantillas y packs",
      what: "Interfaz para explorar tipos de bloque y plantillas de grupo, editar propiedades e importar o exportar packs JSON.",
      duties: [
        "Formularios del inspector generados desde las propiedades declaradas por cada tipo.",
        "Importación con vista previa (dryRun): añadidos, reemplazados, sin cambios.",
        "En pantallas compactas se abre como Modal del host.",
      ],
      apis: ["RPC canvas.catalog.read", "RPC canvas.catalog.mutate", "RPC canvas.pack.validate", "RPC canvas.pack.import", "RPC canvas.pack.export", "RPC canvas.pack.instantiate", "Modal"],
      contract: "canvas.pack.import({ expectedRevision, pack, dryRun: true })\n→ { diff: { added, replaced, unchanged },\n    committed: false, catalog }",
      owner: "plugin/client/ · diseño en design/",
    },
    {
      id: "otros", zone: "cliente", x: 65, y: 625, icon: "users",
      title: "Otros clientes", sub: "Móvil, navegador, escritorio",
      what: "Cualquier otra app de Paseo conectada al mismo daemon. Ve el mismo documento porque el daemon es la única fuente de verdad.",
      duties: [
        "Sondea la misma revisión; la latencia es el intervalo de sondeo.",
        "Escribe con el mismo control optimista de revisión.",
        "No hay presencia ni cursores: eso es futuro.",
      ],
      apis: ["RPC canvas.watch"],
      contract: null,
      owner: "Mismo código de cliente",
    },

    /* ───────── Plugin (daemon) ───────── */
    {
      id: "hooks", zone: "plugin", x: 970, y: 100, icon: "hook",
      title: "Hooks", sub: "agent.create · session_open",
      what: "Puntos de extensión del daemon. Dan las herramientas del lienzo a los agentes nuevos, solo en los workspaces donde la persona lo activó.",
      duties: [
        "La inyección es opcional por workspace (canvas.injection). El puente exige una identidad de agente vinculada a ese workspace.",
        "before(\"agent.create\"): añade el servidor MCP y las instrucciones de uso.",
        "before(\"agent.session_open\"): vincula la sesión con el agentId real.",
        "Para agentes que ya existían: canvas.agent.setup entrega la configuración manual.",
        "Nunca bloquean: ante un error devuelven la petición intacta.",
      ],
      apis: ["server.before(\"agent.create\")", "server.before(\"agent.session_open\")", "RPC canvas.injection", "RPC canvas.agent.setup"],
      contract: 'mcpServers: {\n  ...request.config.mcpServers,\n  "paseo-canvas": {\n    type: "stdio",\n    command: process.execPath,\n    args: [shimPath, endpointPath, ownerPath],\n  },\n}',
      owner: "plugin/server/agent-integration.ts",
    },
    {
      id: "rpc", zone: "plugin", x: 500, y: 205, icon: "plug",
      title: "RPC del plugin", sub: "Contratos Zod compartidos",
      what: "La puerta de la interfaz. Contratos definidos una sola vez en shared/ y validados en ambos extremos.",
      duties: [
        "canvas.list · read · create · mutate · watch · undo · redo · history.",
        "canvas.selection.set · connect · agentAction · agentEvents(.flush).",
        "canvas.catalog.read / mutate · pack.validate / import / export / instantiate · group.export.",
        "Todos los RPC de documento exigen workspaceId.",
        "Llama a los mismos métodos de servicio que las herramientas MCP.",
      ],
      apis: ["defineRpc", "server.handle", "useRpc"],
      contract: 'export const watchDocument = defineRpc({\n  name: "canvas.watch",\n  input: readInputSchema.extend({\n    knownRevision, knownRuntimeVersion }),\n  output: z.object({ revision, runtimeVersion,\n    view: documentViewSchema.optional() }),\n});',
      owner: "plugin/shared/rpc.ts",
    },
    {
      id: "bridge", zone: "plugin", x: 970, y: 205, icon: "radio",
      title: "Puente MCP", sub: "HTTP en 127.0.0.1 + token",
      what: "La puerta del agente. Un servidor HTTP local en un puerto efímero, protegido con un token aleatorio guardado en un archivo 0600.",
      duties: [
        "Autenticar cada llamada y resolver qué agente llama.",
        "Limitar el alcance a los documentos del workspace vinculado a ese agente.",
        "Devolver errores con código estable: REVISION_CONFLICT, VALIDATION, INVARIANT, UNKNOWN_TYPE, NOT_FOUND, FORBIDDEN, TOO_LARGE, UNDO_BLOCKED, UNAVAILABLE.",
      ],
      apis: ["node:http", "bridge.json { port, token }"],
      contract: "canvas_apply  ≡  canvas.mutate\n{ documentId, expectedRevision, label, operations }\n→ vista confirmada  |  REVISION_CONFLICT",
      owner: "plugin/server/bridge.ts",
    },
    {
      id: "service", zone: "plugin", x: 735, y: 310, icon: "cpu",
      title: "CanvasService", sub: "Un servicio, dos puertas",
      what: "El núcleo. La interfaz y el agente entran por puertas distintas pero ejecutan exactamente las mismas operaciones: un arrastre de la persona y una edición del agente son el mismo tipo de transacción.",
      duties: [
        "Resolver documento, actor y alcance.",
        "Delegar toda mutación en el reductor.",
        "Calcular instrucciones efectivas al leer una entidad.",
        "Devolver siempre una DocumentView: documento, conexión, canUndo, canRedo y versiones.",
      ],
      apis: ["PluginHandlerContext.paseo", "DocumentView"],
      contract: "interface DocumentView {\n  document: CanvasDocument;\n  connection: { agentId, workspaceId } | null;\n  canUndo: boolean; canRedo: boolean;\n  selectionVersion: number;\n  runtimeVersion: number;\n}",
      owner: "plugin/server/service.ts",
    },
    {
      id: "reducer", zone: "plugin", x: 735, y: 415, icon: "layers",
      title: "Reductor", sub: "Transacciones todo o nada",
      what: "Función pura que aplica una lista de operaciones. Es el único lugar donde viven las invariantes del documento.",
      duties: [
        "Rechazar si expectedRevision no coincide (REVISION_CONFLICT).",
        "Aplicar las operaciones en orden; si una falla, no se aplica ninguna.",
        "Garantizar: ids únicos, un solo padre, sin ciclos, profundidad ≤ 4.",
        "Mantener los punteros de padre coherentes con blockIds y groupIds.",
        "Validar los datos de cada bloque contra las propiedades de su tipo.",
      ],
      apis: ["función pura", "12 tipos de operación"],
      contract: "reduce(document, operations, catalog)\n  → CanvasDocument\n\ndocument.update · communication.set · selection.set\nblock.create / update / delete\ngroup.create / update / delete\nentity.move · entity.duplicate · template.insert",
      owner: "plugin/server/reducer.ts",
    },
    {
      id: "history", zone: "plugin", x: 735, y: 520, icon: "history",
      title: "Historial", sub: "Deshacer sin reescribir",
      what: "El registro ordenado de transacciones. Deshacer no retrocede: queda anotado como una entrada nueva de tipo «undo» y la revisión sigue subiendo.",
      duties: [
        "Guardar etiqueta, actor, identidad del agente y entidades cambiadas o eliminadas de cada transacción.",
        "Exponer canUndo y canRedo en cada vista. Un agente solo deshace sus propias ediciones.",
        "Rechazar con UNDO_BLOCKED cuando deshacer no es seguro.",
      ],
      apis: ["RPC canvas.undo", "RPC canvas.redo", "RPC canvas.history"],
      contract: '{ id, revision: 23, actor: "user",\n  kind: "undo",          // edit | undo | redo\n  label: "Mover bloque", at,\n  changed: ["login-estados"], removed: [] }',
      owner: "plugin/server/service.ts",
    },
    {
      id: "store", zone: "plugin", x: 735, y: 625, icon: "database",
      title: "Almacén", sub: "Escritor único y atómico",
      what: "Persistencia en archivos del host. El subproceso del plugin es el único escritor y cada escritura es atómica.",
      duties: [
        "Serializar todas las escrituras del estado del plugin.",
        "Guardar contenido, historial, catálogo, selección y eventos juntos en state.json, con reemplazo atómico.",
        "Los detalles de disposición y límites están en docs/mcp.md.",
      ],
      apis: ["node:fs/promises"],
      contract: null,
      owner: "plugin/server/store.ts",
    },
    {
      id: "catalog", zone: "plugin", x: 500, y: 520, icon: "package",
      title: "Catálogo", sub: "Tipos · plantillas · packs",
      what: "La biblioteca local combina tipos integrados, packs instalados y definiciones locales. Las importaciones rechazan colisiones de nombres.",
      duties: [
        "Tiene su propia revisión: también se edita con expectedRevision.",
        "Cada tipo declara una lista de propiedades tipadas (text, number, boolean, json) y valores por defecto.",
        "Una plantilla es un conjunto de bloques y grupos listo para insertar con un prefijo de ids.",
        "Los packs son datos, nunca código: pueden elegir un renderizador integrado.",
      ],
      apis: ["MCP canvas_catalog", "type.put · template.put · pack.import · pack.remove"],
      contract: '{ "format": "paseo-canvas-pack", "version": 1,\n  "id": "aprender", "name": "Aprender",\n  "blockTypes": [...],\n  "templates": [...],\n  "documents": [...] }',
      owner: "plugin/server/catalog.ts",
    },
    {
      id: "feedback", zone: "plugin", x: 970, y: 415, icon: "send",
      title: "Despachador", sub: "Feedback hacia el agente",
      what: "Convierte acciones reales de la persona en mensajes para el agente conectado. Corre en el daemon, así funciona desde cualquier cliente.",
      duties: [
        "Persistir cada evento antes de intentar entregarlo.",
        "Entrega inmediata o por lotes; el lote se envía con canvas.agent.events.flush.",
        "El cliente genera un eventId estable para no duplicar el evento guardado. Cada tanda conserva destinatario, contenido e ID de envío al reintentarse.",
        "Cada evento lleva una copia del contexto del documento en ese instante.",
        "Sin agente conectado, el evento queda pendiente y la interfaz lo dice.",
      ],
      apis: ["RPC canvas.agent.action", "RPC canvas.agent.events", "RPC canvas.agent.events.flush", "paseo.agents.ref(id).send()"],
      contract: '{ id: "evt-5c", documentId, agentId, revision: 13,\n  action: { kind: "check", label: "Comprobar",\n    payload: { answer: "b" },\n    targetIds: ["leccion-pregunta"],\n    delivery: "immediate" },\n  context: { …documento… },\n  status: "pending" | "sent" | "failed" | "acked" }',
      owner: "plugin/server/feedback.ts",
    },

    /* ───────── Agente ───────── */
    {
      id: "shim", zone: "agente", x: 1270, y: 205, icon: "terminal",
      title: "Shim MCP", sub: "Proceso stdio generado",
      what: "Un script mínimo que el proveedor del agente lanza como servidor MCP por stdio. Solo reenvía llamadas al puente.",
      duties: [
        "Lee bridge.json en cada llamada: sobrevive a recargas del plugin.",
        "Identifica qué agente llama para aplicar su alcance.",
        "Funciona igual en claude, codex y opencode.",
      ],
      apis: ["MCP stdio", "canvas-mcp.cjs"],
      contract: "canvas_read      leer documento y selección\ncanvas_apply     transacción (≡ canvas.mutate)\ncanvas_catalog   tipos, plantillas y packs\n…                lista exacta en docs/mcp.md",
      owner: "plugin/server/bridge-source.ts",
    },
    {
      id: "agent", zone: "agente", x: 1270, y: 360, icon: "bot",
      title: "Agente conectado", sub: "Construye y lee el lienzo",
      what: "El agente que la persona conectó a este documento desde el panel. La conexión es explícita y elige quién recibe el feedback. Las herramientas acceden a los documentos del workspace autorizado.",
      duties: [
        "Leer primero el documento y su revisión.",
        "Escribir siempre con expectedRevision.",
        "Consultar el catálogo antes de crear: un tipo desconocido se rechaza.",
        "No afirmar contenido que las herramientas no confirmaron.",
      ],
      apis: ["RPC canvas.connect", "DocumentView.connection", "config.mcpServers"],
      contract: null,
      owner: "Proveedor del agente",
    },
    {
      id: "timeline", zone: "agente", x: 1270, y: 520, icon: "list",
      title: "Conversación", sub: "Línea de tiempo del agente",
      what: "El chat nativo de Paseo. El feedback del lienzo llega aquí como un mensaje real que inicia un turno real.",
      duties: [
        "Los mensajes de feedback aparecen como mensajes normales.",
        "El estado del agente (trabajando, en reposo) viene del host, nunca se simula.",
        "Previsto, no en v1: una tarjeta «Lienzo actualizado» dentro de la conversación.",
      ],
      apis: ["paseo.agents.ref(id).send()", "useAgent(id, a => a.status)"],
      contract: null,
      owner: "plugin/server/ + plugin/client/",
    },

    /* ───────── Futuro ───────── */
    {
      id: "push", zone: "futuro", x: 1560, y: 100, icon: "radio", status: "futuro",
      title: "Canal push", sub: "Servidor → cliente en vivo",
      what: "Actualizaciones empujadas por el servidor en lugar de sondeo. Paseo 0.10.3 no ofrece a los plugins un canal propio hacia los clientes.",
      duties: ["Sustituiría a canvas.watch.", "Requiere una API nueva del host."],
      apis: [], contract: null, owner: "No construido",
    },
    {
      id: "presence", zone: "futuro", x: 1560, y: 205, icon: "users", status: "futuro",
      title: "Presencia y cursores", sub: "Quién está y dónde",
      what: "Ver a otras personas y agentes en el lienzo, con su cursor y su selección.",
      duties: ["Selección por participante.", "Indicadores de «editando»."],
      apis: [], contract: null, owner: "No construido",
    },
    {
      id: "merge", zone: "futuro", x: 1560, y: 310, icon: "merge", status: "futuro",
      title: "Fusión por entidad", sub: "CRDT o rebase automático",
      what: "Combinar ediciones simultáneas sin rechazar ninguna. Hoy un escritor desactualizado recibe un conflicto y reintenta.",
      duties: ["Rebase del registro de operaciones.", "Edición sin conexión."],
      apis: [], contract: null, owner: "No construido",
    },
    {
      id: "identity", zone: "futuro", x: 1560, y: 415, icon: "id", status: "futuro",
      title: "Identidad por persona", sub: "Permisos y autoría",
      what: "Distinguir personas. Hoy el alcance del plugin es por host: todas las personas de un daemon son el mismo actor «user».",
      duties: ["Actor con userId.", "Permisos por documento."],
      apis: [], contract: null, owner: "No construido",
    },
    {
      id: "crosshost", zone: "futuro", x: 1560, y: 520, icon: "globe", status: "futuro",
      title: "Sincronía entre hosts", sub: "Un lienzo, varios daemons",
      what: "Compartir un documento entre daemons distintos. Hoy cada documento vive en un solo host.",
      duties: ["Replicación del journal."],
      apis: [], contract: null, owner: "No construido",
    },

    /* ───────── Disco ───────── */
    {
      id: "packsfs", zone: "disco", x: 500, y: 842, icon: "package",
      title: "Catálogo guardado", sub: "Tipos, plantillas y packs",
      what: "Los packs instalados y los tipos o plantillas guardados por la persona, dentro de state.json.",
      duties: ["Catálogo con revisión propia.", "Hasta 100 tipos, 100 plantillas y 20 documentos de ejemplo por pack."],
      apis: [], contract: null, owner: "plugin/server/catalog.ts",
    },
    {
      id: "docs", zone: "disco", x: 735, y: 842, icon: "file",
      title: "Documentos", sub: "Estado por documento",
      what: "El estado completo de cada documento en su última revisión, dentro del agregado state.json.",
      duties: ["Se reemplaza de forma atómica en cada transacción."],
      apis: [], contract: '{ "id": "login", "workspaceId": "…",\n  "revision": 23, "title": "…",\n  "blocks": [...], "groups": [...],\n  "selectedIds": [...], "communication": {...} }', owner: "plugin/server/",
    },
    {
      id: "journal", zone: "disco", x: 970, y: 842, icon: "history",
      title: "Historial y eventos", sub: "Transacciones y feedback",
      what: "Las últimas 50 entradas de historial por documento y los eventos persistidos dentro de state.json.",
      duties: ["Alimenta canvas.history, canUndo y canRedo.", "Los eventos conservan su estado de entrega."],
      apis: [], contract: null, owner: "plugin/server/",
    },

    /* ───────── Modelo ───────── */
    {
      id: "m-doc", zone: "modelo", x: 1270, y: 805, w: 215, icon: "file",
      title: "Documento", sub: "Revisión monótona",
      what: "Un lienzo persistente. Cada transacción confirmada suma uno a su revisión; nunca se reutiliza un número.",
      duties: ["Pertenece a un workspace.", "Bloques y grupos son listas; la pertenencia la definen los grupos.", "Los ejemplos llevan example: true y la interfaz siempre los etiqueta."],
      apis: [],
      contract: "interface CanvasDocument {\n  id; workspaceId; revision;\n  title; description;\n  example: boolean;\n  blocks: CanvasBlock[];\n  groups: CanvasGroup[];\n  selectedIds: string[];\n  communication: Communication;\n  createdAt; updatedAt;\n}",
      owner: "plugin/shared/model.ts",
    },
    {
      id: "m-instr", zone: "modelo", x: 1555, y: 805, w: 215, icon: "note",
      title: "Comunicación", sub: "Instrucciones en 3 niveles",
      what: "Le dice al agente cómo usar esta superficie con esta persona. Es el mismo objeto en documento, grupo y bloque, y se concatena desde la entidad más específica hacia sus ancestros.",
      duties: ["instructions: qué hacer aquí.", "intent: para qué existe esta parte.", "audience: a quién se dirige.", "Distinta de la guía fija de herramientas que recibe el agente."],
      apis: ["operación communication.set", "effectiveInstructions()"],
      contract: "interface Communication {\n  instructions: string;   // ≤ 8000\n  intent: string;         // ≤ 1000\n  audience: string;       // ≤ 500\n}",
      owner: "plugin/shared/model.ts",
    },
    {
      id: "m-group", zone: "modelo", x: 1270, y: 880, w: 215, icon: "group",
      title: "Grupo", sub: "Contenedor de primera clase",
      what: "No es un rectángulo de selección. Es dueño de sus hijos, tiene descripción y comunicación propias, y se opera como una unidad.",
      duties: ["blockIds y groupIds definen la pertenencia; el servidor mantiene los punteros de padre.", "layout guarda la intención de diseño (libre, pila, cuadrícula, flujo); la dibuja el cliente.", "Se mueve, pliega, duplica, borra y exporta como plantilla.", "Mover un grupo cambia solo su posición: los hijos conservan la suya, relativa.", "Anidable hasta 4 niveles."],
      apis: ["group.create / update / delete", "RPC canvas.group.export"],
      contract: "interface CanvasGroup {\n  id; title; description;\n  blockIds: string[];\n  groupIds: string[];\n  parentGroupId?; templateId?;\n  position?: { x, y };\n  collapsed?: boolean;\n  layout?: { mode, gap?, columns? };\n  communication?: Communication;\n}",
      owner: "plugin/shared/model.ts",
    },
    {
      id: "m-block", zone: "modelo", x: 1555, y: 880, w: 215, icon: "box",
      title: "Bloque", sub: "Unidad tipada y legible",
      what: "Una pieza de contenido con tipo. El agente puede volver a leerla y razonar sobre ella porque sus propiedades siguen un esquema.",
      duties: ["typeId apunta a un tipo del catálogo.", "data se valida contra las propiedades del tipo; no se aceptan claves sin declarar.", "position es opcional y relativa al grupo padre.", "Un tipo desconocido ya guardado se conserva; crear uno nuevo desconocido falla."],
      apis: ["block.create / update / delete"],
      contract: "interface CanvasBlock {\n  id; typeId; title;\n  data: Record<string, Json>;\n  position?: { x, y };\n  parentGroupId?: string | null;\n  communication?: Communication;\n}",
      owner: "plugin/shared/model.ts",
    },
  ];

  nodes.forEach((n) => {
    n.w = n.w || W;
    n.h = n.h || H;
    n.status = n.status || "real";
  });

  /* sides: [salida, llegada] con t|r|b|l. Sin sides, se elige automáticamente. */
  const edges = [
    { id: "user-panel", from: "user", to: "panel", label: "lee, arrastra, pulsa" },
    { id: "panel-selection", from: "panel", to: "selection", label: "selecciona" },
    { id: "selection-composer", from: "selection", to: "composer", label: "adjunta contexto" },
    { id: "panel-rpc", from: "panel", to: "rpc", label: "canvas.mutate · canvas.watch", both: true },
    { id: "selection-rpc", from: "selection", to: "rpc", label: "canvas.selection.set", sides: ["r", "l"] },
    { id: "catalogui-catalog", from: "catalogui", to: "catalog", label: "pack.import · catalog.read" },
    { id: "otros-rpc", from: "otros", to: "rpc", label: "misma revisión, por sondeo", sides: ["r", "b"] },

    { id: "rpc-service", from: "rpc", to: "service", sides: ["r", "t"] },
    { id: "bridge-service", from: "bridge", to: "service", sides: ["l", "t"] },
    { id: "service-reducer", from: "service", to: "reducer", label: "operations[]" },
    { id: "reducer-history", from: "reducer", to: "history", label: "registra" },
    { id: "history-store", from: "history", to: "store" },
    { id: "service-catalog", from: "service", to: "catalog", sides: ["l", "t"], label: "valida tipos" },
    { id: "service-feedback", from: "service", to: "feedback", sides: ["r", "t"], label: "evento" },

    { id: "hooks-shim", from: "hooks", to: "shim", sides: ["r", "t"], label: "inyecta al crear" },
    { id: "shim-bridge", from: "shim", to: "bridge", label: "HTTP + token" },
    { id: "agent-shim", from: "agent", to: "shim", label: "MCP stdio" },
    { id: "feedback-agent", from: "feedback", to: "agent", label: "send()" },
    { id: "agent-timeline", from: "agent", to: "timeline", label: "turno" },

    { id: "store-docs", from: "store", to: "docs" },
    { id: "store-journal", from: "store", to: "journal", sides: ["r", "t"] },
    { id: "catalog-packsfs", from: "catalog", to: "packsfs" },

    { id: "doc-group", from: "m-doc", to: "m-group", label: "contiene" },
    { id: "group-block", from: "m-group", to: "m-block", label: "blockIds" },
    { id: "doc-instr", from: "m-doc", to: "m-instr", label: "3 niveles" },
  ];

  /* Pasos: nodes = nodos resaltados; path = aristas recorridas en orden ("id" o "id<" en sentido inverso).
     Los ejemplos usan los nombres reales de plugin/shared/model.ts y rpc.ts. */
  const flows = [
    {
      id: "frontend",
      title: "Crear un frontend",
      icon: "layout",
      summary: "La persona pide una pantalla y el agente la construye en el lienzo con una sola transacción.",
      steps: [
        {
          title: "La petición llega por el chat",
          text: "Nada especial todavía: un mensaje normal al agente conectado. El lienzo no intercepta la conversación.",
          nodes: ["user", "composer", "agent"], path: [],
          code: "«Diseñemos la pantalla de inicio de sesión.\n Quiero ver estructura, estados y una lista de revisión.»",
        },
        {
          title: "El agente consulta el catálogo",
          text: "Antes de escribir descubre qué tipos de bloque y plantillas existen. Crear un bloque de un tipo desconocido se rechaza con UNKNOWN_TYPE.",
          nodes: ["agent", "shim", "bridge", "service", "catalog"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-catalog"],
          code: 'canvas_catalog\n→ { revision: 4,\n    blockTypes: [{ id: "nota", properties: [...] }, …],\n    templates:  [{ id: "pantalla", … }, …] }',
        },
        {
          title: "Lee el documento y su revisión",
          text: "La lectura devuelve el documento completo: bloques, grupos, selección actual y comunicación. Lo imprescindible es el número de revisión.",
          nodes: ["agent", "shim", "bridge", "service"],
          path: ["agent-shim", "shim-bridge", "bridge-service"],
          code: 'canvas_read { documentId: "login" }\n→ { document: { revision: 12, blocks: [...],\n      groups: [...], selectedIds: [] }, … }',
        },
        {
          title: "Envía una transacción",
          text: "Un grupo y sus bloques, todo junto, con ids concretos elegidos por el agente. El grupo declara a sus hijos en blockIds.",
          nodes: ["agent", "shim", "bridge", "service"],
          path: ["agent-shim", "shim-bridge", "bridge-service"],
          code: 'canvas_apply {\n  documentId: "login", expectedRevision: 12,\n  label: "Pantalla de inicio de sesión",\n  operations: [\n    { type: "block.create", block: { id: "login-estructura",\n        typeId: "note", title: "Estructura", data: {...} } },\n    { type: "block.create", block: { id: "login-estados",\n        typeId: "checklist", title: "Estados", data: {...} } },\n    { type: "group.create", group: { id: "login-pantalla",\n        title: "Inicio de sesión",\n        description: "Especificación de la pantalla",\n        blockIds: ["login-estructura", "login-estados"],\n        layout: { mode: "stack", gap: 16 } } }\n  ]\n}',
        },
        {
          title: "El reductor aplica todo o nada",
          text: "Comprueba la revisión, valida cada bloque contra su tipo y verifica el árbol: un solo padre, sin ciclos. Si algo falla no cambia nada.",
          nodes: ["service", "reducer", "catalog", "history", "store", "docs", "journal"],
          path: ["service-reducer", "reducer-history", "history-store", "store-journal", "store-docs"],
          code: "→ DocumentView {\n    document: { revision: 13, … },\n    canUndo: true, canRedo: false, … }",
        },
        {
          title: "El panel descubre la revisión nueva",
          text: "El cliente pregunta con las versiones que conoce. Si nada cambió recibe solo dos números; si cambió, la vista completa.",
          nodes: ["panel", "rpc", "service", "user"],
          path: ["panel-rpc", "rpc-service", "panel-rpc<", "user-panel<"],
          code: 'canvas.watch { workspaceId, documentId: "login",\n  knownRevision: 12, knownRuntimeVersion: 3 }\n→ { revision: 13, runtimeVersion: 3, view: {...} }',
        },
        {
          title: "La persona lo ve y puede seguir",
          text: "El grupo aparece como un marco con sus tarjetas. A partir de aquí puede moverlo, editarlo, deshacer o responder desde el propio lienzo.",
          nodes: ["user", "panel", "m-group", "m-block"], path: ["user-panel<", "group-block"],
          code: "Inicio de sesión            GRUPO · 2 bloques · rev 13\n ├ Estructura               nota\n └ Estados                  checklist",
        },
      ],
    },
    {
      id: "aprendizaje",
      title: "Enseñanza progresiva",
      icon: "book",
      summary: "Una lección que avanza según las respuestas reales de la persona, no según un guion fijo.",
      steps: [
        {
          title: "El agente inserta la plantilla de lección",
          text: "Una plantilla es un conjunto de bloques y grupos del catálogo. Al insertarla, sus ids se reasignan con el prefijo que da quien llama.",
          nodes: ["agent", "shim", "bridge", "service", "catalog", "reducer"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-catalog", "service-reducer"],
          code: 'canvas_apply {\n  documentId, expectedRevision: 30,\n  label: "Lección: promesas",\n  operations: [\n    { type: "template.insert",\n      templateId: "progressive-lesson", idPrefix: "promesas" }\n  ]\n}',
        },
        {
          title: "Deja instrucciones en el grupo",
          text: "La comunicación viaja con el contenido. Cualquier agente que lea este grupo sabrá cómo enseñar aquí y a quién.",
          nodes: ["agent", "service", "reducer", "m-instr", "m-group"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-reducer"],
          code: '{ type: "group.update", id: "<grupo de la lección>",\n  patch: { communication: {\n    instructions: "Revela un paso por vez. Si falla la\n      pregunta, añade un ejemplo más simple antes de seguir.",\n    intent: "Enseñar promesas paso a paso",\n    audience: "Principiante en JavaScript" } } }',
        },
        {
          title: "La persona responde",
          text: "Elegir una opción cambia el contenido del bloque, así que es una transacción de la persona por la puerta RPC. Todavía no se avisa al agente.",
          nodes: ["user", "panel", "rpc", "service", "reducer", "store", "m-block"],
          path: ["user-panel", "panel-rpc", "rpc-service", "service-reducer", "reducer-history", "history-store"],
          code: 'canvas.mutate { workspaceId, documentId,\n  expectedRevision: 32, label: "Responder pregunta",\n  operations: [{ type: "block.update",\n    id: "<bloque pregunta>",\n    patch: { data: { answer: "b" } } }] }',
        },
        {
          title: "Pulsa «Comprobar»",
          text: "Una acción explícita. El cliente genera el eventId, de modo que reintentar no la duplica. El evento se guarda antes de entregarse.",
          nodes: ["user", "panel", "rpc", "service", "feedback"],
          path: ["user-panel", "panel-rpc", "rpc-service", "service-feedback"],
          code: 'canvas.agent.action { workspaceId, documentId,\n  expectedRevision: 33, eventId: "evt-5c",\n  action: { kind: "check", label: "Comprobar",\n    payload: { answer: "b" },\n    targetIds: ["<bloque pregunta>"],\n    delivery: "immediate" } }',
        },
        {
          title: "El despachador inicia un turno real",
          text: "El mensaje llega al agente conectado con una copia del documento en ese instante. La interfaz muestra el estado guardado: pendiente, enviado, confirmado o fallido.",
          nodes: ["feedback", "agent", "timeline"],
          path: ["feedback-agent", "agent-timeline"],
          code: 'AgentEvent { id: "evt-5c", revision: 33,\n  status: "pending" → "sent" → "acked" }',
        },
        {
          title: "El agente adapta la lección",
          text: "Acierto: el diagrama de la lección gana un nodo y una conexión más. Error: añade un refuerzo antes. Un parche de bloque reemplaza las listas nodes y edges completas.",
          nodes: ["agent", "shim", "bridge", "service", "reducer", "store", "m-block"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-reducer", "reducer-history", "history-store"],
          code: 'canvas_apply { documentId, expectedRevision: 33,\n  label: "Mostrar el estado «resuelta»",\n  operations: [{ type: "block.update",\n    id: "<bloque diagrama>",\n    patch: { data: {\n      nodes: [{ id: "pendiente", label: "Pendiente" },\n              { id: "resuelta",  label: "Resuelta" }],\n      edges: [{ id: "e1", from: "pendiente",\n                to: "resuelta", label: "resolve()" }] } } }] }',
        },
        {
          title: "El progreso es real",
          text: "El panel muestra el paso nuevo cuando canvas.watch trae la revisión siguiente. No hay animación de «pensando» simulada: el estado del agente viene de Paseo.",
          nodes: ["panel", "rpc", "service", "user"],
          path: ["panel-rpc", "rpc-service", "panel-rpc<", "user-panel<"],
          code: 'useAgent(agentId, a => a.status)  // "running" | "idle" | …',
        },
      ],
    },
    {
      id: "packs",
      title: "Insertar un grupo o un pack",
      icon: "package",
      summary: "De un archivo JSON a un grupo vivo en el lienzo, y de vuelta a una plantilla reutilizable.",
      steps: [
        {
          title: "Vista previa de la importación",
          text: "La persona pega o elige un pack. Con dryRun el catálogo responde qué se añadiría o reemplazaría, sin tocar nada.",
          nodes: ["user", "catalogui", "catalog"],
          path: ["catalogui-catalog"],
          code: 'canvas.pack.import { expectedRevision: 4,\n  pack, replace: false, dryRun: true }\n→ { diff: { added: ["retro.tablero", "retro.voto"],\n            replaced: [], unchanged: [] },\n    committed: false }',
        },
        {
          title: "Instalación atómica",
          text: "Se valida el pack entero contra su esquema: solo datos declarativos, sin código ni rutas. O entra completo o no entra. Los documentos existentes no se tocan.",
          nodes: ["catalog", "packsfs"],
          path: ["catalog-packsfs"],
          code: '{ "format": "paseo-canvas-pack", "version": 1,\n  "id": "retro", "name": "Retrospectiva",\n  "blockTypes": [...], "templates": [...],\n  "documents": [...] }\n→ { committed: true, catalog: { revision: 5, … } }',
        },
        {
          title: "El agente descubre lo nuevo",
          text: "La próxima vez que consulte el catálogo verá los tipos y plantillas del pack con su descripción.",
          nodes: ["agent", "shim", "bridge", "service", "catalog"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-catalog"],
          code: 'canvas_catalog { action: "list" }\n→ templates: [{ id: "retro.tablero",\n     name: "Tablero de retrospectiva", description: "…" }, …]\ncanvas_catalog { action: "read", id: "retro.tablero" }\n→ { entry: { blocks: [...], groups: [...], … } }',
        },
        {
          title: "Inserta la plantilla con un prefijo",
          text: "Agente o persona usan la misma operación. Los ids de la plantilla se reasignan con el prefijo, así se puede insertar varias veces sin choques.",
          nodes: ["agent", "service", "catalog", "reducer"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-catalog", "service-reducer"],
          code: '{ type: "template.insert",\n  templateId: "retro.tablero",\n  idPrefix: "sprint12" }',
        },
        {
          title: "El grupo existe como unidad",
          text: "Se guarda con título, descripción, hijos y diseño propios. Moverlo cambia solo su posición; plegarlo o borrarlo afecta a todo el subárbol.",
          nodes: ["reducer", "history", "store", "docs", "journal", "m-doc", "m-group", "m-block"],
          path: ["reducer-history", "history-store", "store-docs", "doc-group", "group-block"],
          code: '{ id: "…", title: "Retro del sprint 12",\n  description: "Recoger y priorizar aprendizajes",\n  templateId: "retro.tablero",\n  blockIds: [], groupIds: ["…bien", "…mejorar", "…acciones"],\n  layout: { mode: "grid", columns: 3 } }',
        },
        {
          title: "De grupo a plantilla, de plantilla a pack",
          text: "Un grupo que funcionó se exporta como plantilla, se guarda en el catálogo y sale en un pack JSON portable para compartirlo.",
          nodes: ["user", "catalogui", "catalog", "packsfs", "m-group"],
          path: ["catalogui-catalog", "catalog-packsfs"],
          code: 'canvas.group.export { workspaceId, documentId,\n  groupId, templateId: "mi-retro.tablero", name: "Mi retro" }\n→ { template }\npack = { format: "paseo-canvas-pack", version: 1,\n  id: "mi-retro", name: "Mi retro", description: "…",\n  blockTypes: [], templates: [template], documents: [] }\ncanvas.pack.import { expectedRevision: 5, pack }\ncanvas.pack.export { id: "mi-retro" }  → JSON',
        },
      ],
    },
    {
      id: "feedback",
      title: "Feedback de la persona",
      icon: "send",
      summary: "Dos canales con distinto coste: la selección es contexto ambiental; las acciones inician un turno.",
      steps: [
        {
          title: "Seleccionar no cuesta nada",
          text: "La selección se guarda en el servidor con su propia versión. Nunca envía un mensaje al agente.",
          nodes: ["user", "panel", "selection", "rpc", "service"],
          path: ["user-panel", "panel-selection", "selection-rpc", "rpc-service"],
          code: 'canvas.selection.set { workspaceId, documentId,\n  expectedSelectionVersion: 14,\n  ids: ["login-estados", "login-revision"] }',
        },
        {
          title: "La persona ve qué comparte",
          text: "Una bandeja de contexto muestra siempre lo que el agente podrá ver. La selección vive en document.selectedIds.",
          nodes: ["selection", "composer", "user", "m-doc"],
          path: ["selection-composer"],
          code: "Contexto visible para el agente\n▪ Estados              checklist\n▪ Lista de revisión    checklist",
        },
        {
          title: "Una acción explícita",
          text: "«Pedir cambios» con una nota. El evento registra objetivos, revisión y una copia del documento en ese instante, y queda pendiente.",
          nodes: ["user", "panel", "rpc", "service", "feedback"],
          path: ["user-panel", "panel-rpc", "rpc-service", "service-feedback"],
          code: 'canvas.agent.action { workspaceId, documentId,\n  expectedRevision: 13, eventId: "evt-9a",\n  action: { kind: "request-changes",\n    label: "Pedir cambios",\n    payload: { note: "Falta el estado de error de red" },\n    targetIds: ["login-estados", "login-revision"] } }',
        },
        {
          title: "Inmediata o por lotes",
          text: "Una acción inmediata se envía ya. Las acciones por lotes se acumulan y salen juntas cuando la persona pulsa «Enviar al agente». Sin agente conectado, todo sigue pendiente y la interfaz lo dice.",
          nodes: ["panel", "rpc", "feedback", "agent", "timeline"],
          path: ["panel-rpc", "rpc-service", "service-feedback", "feedback-agent", "agent-timeline"],
          code: 'delivery: "immediate" | "batched"\ncanvas.agent.events.flush { workspaceId, documentId }\n\npending → sent → acked\n        ↘ failed (con el motivo visible)',
        },
        {
          title: "El agente lee con instrucciones",
          text: "Al leer encuentra la selección y la comunicación efectiva: la del bloque, luego la de sus grupos, luego la del documento.",
          nodes: ["agent", "shim", "bridge", "service", "m-instr"],
          path: ["agent-shim", "shim-bridge", "bridge-service"],
          code: 'canvas_read { documentId: "login" }\n→ document.selectedIds: ["login-estados", "login-revision"]\n  document.communication: { instructions, intent, audience }',
        },
        {
          title: "Responde en el lienzo",
          text: "Aplica el cambio con una transacción. El panel muestra el contenido nuevo y el estado real del evento.",
          nodes: ["agent", "shim", "bridge", "service", "reducer", "store", "panel"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-reducer", "reducer-history", "history-store"],
          code: 'canvas_apply { documentId: "login", expectedRevision: 13,\n  label: "Añadir estado de error de red",\n  operations: [{ type: "block.update", id: "login-estados",\n    patch: { data: {...} } }] }',
        },
      ],
    },
    {
      id: "conflicto",
      title: "Conflicto y deshacer",
      icon: "history",
      summary: "Qué pasa cuando dos escriben a la vez, y por qué deshacer nunca borra historia.",
      steps: [
        {
          title: "Dos escritores, la misma revisión",
          text: "La persona mueve un bloque mientras el agente prepara una edición. Ambos leyeron la revisión 20.",
          nodes: ["user", "panel", "agent"],
          path: ["user-panel"],
          code: "persona: revisión conocida 20\nagente:  revisión conocida 20",
        },
        {
          title: "Gana quien llega primero",
          text: "El gesto de la persona se confirma al soltar. El documento pasa a la revisión 21.",
          nodes: ["panel", "rpc", "service", "reducer", "store"],
          path: ["panel-rpc", "rpc-service", "service-reducer", "reducer-history", "history-store"],
          code: 'canvas.mutate { workspaceId, documentId: "login",\n  expectedRevision: 20, label: "Mover bloque",\n  operations: [{ type: "entity.move", id: "login-estados",\n    parentGroupId: "login-pantalla",\n    position: { x: 320, y: 48 } }] }\n→ revision: 21',
        },
        {
          title: "El agente recibe un conflicto",
          text: "Su transacción llega con una revisión vieja. No se aplica nada, ni siquiera en parte.",
          nodes: ["agent", "shim", "bridge", "service", "reducer"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-reducer"],
          code: 'canvas_apply { expectedRevision: 20, … }\n→ error REVISION_CONFLICT',
        },
        {
          title: "Relee y reintenta",
          text: "Sin fusión automática: el agente vuelve a leer, decide con la información nueva y reenvía sobre la revisión actual.",
          nodes: ["agent", "shim", "bridge", "service", "reducer", "store"],
          path: ["agent-shim", "shim-bridge", "bridge-service", "service-reducer", "reducer-history", "history-store"],
          code: 'canvas_read { documentId: "login" }   → revision: 21\ncanvas_apply { expectedRevision: 21, … } → revision: 22',
        },
        {
          title: "Deshacer añade, no retrocede",
          text: "Deshacer queda registrado como una entrada nueva del historial y la revisión sigue subiendo. Si no es seguro, se rechaza con UNDO_BLOCKED en lugar de pisar trabajo ajeno.",
          nodes: ["user", "panel", "rpc", "service", "history", "store", "journal"],
          path: ["user-panel", "panel-rpc", "rpc-service", "history-store", "store-journal"],
          code: 'canvas.undo { workspaceId, documentId: "login",\n  expectedRevision: 22 }\n→ revision: 23, canRedo: true\n\ncanvas.history → { kind: "undo", actor: "user",\n  label: "Mover bloque", changed: ["login-estados"] }',
        },
      ],
    },
  ];

  const multiplayer = {
    hoy: {
      title: "Hoy: compartido, no simultáneo",
      lead: "Lo que el plugin hace de verdad en Paseo 0.10.3.",
      nodes: ["otros", "panel", "rpc", "service", "reducer", "history", "store", "docs", "journal", "agent", "shim", "bridge"],
      edges: ["otros-rpc", "panel-rpc", "rpc-service", "service-reducer", "reducer-history", "history-store", "store-docs", "store-journal", "agent-shim", "shim-bridge", "bridge-service"],
      points: [
        ["Una sola fuente de verdad", "El subproceso del plugin es el único escritor. Escritorio, navegador y móvil conectados al mismo daemon ven el mismo documento."],
        ["Persona y agente escriben igual", "Ambos envían transacciones con revisión esperada; el agente debe estar conectado al documento."],
        ["Control optimista por revisión", "Quien escribe con una revisión vieja recibe REVISION_CONFLICT, relee y reintenta. Nada se fusiona solo."],
        ["Latencia de sondeo", "Los cambios ajenos aparecen cuando canvas.watch vuelve a preguntar, no al instante."],
        ["Una selección por documento", "No hay selección por participante: todos los clientes comparten la misma."],
        ["Un único actor «persona»", "El historial distingue user, agent y system, pero no una persona de otra."],
      ],
    },
    futuro: {
      title: "Futuro: multijugador en vivo",
      lead: "Planeado, no construido. La interfaz y la documentación no deben insinuarlo.",
      nodes: ["push", "presence", "merge", "identity", "crosshost"],
      edges: [],
      points: [
        ["Canal push", "Requiere que Paseo ofrezca a los plugins un canal del servidor hacia los clientes."],
        ["Presencia y cursores", "Selección por participante e indicadores de edición."],
        ["Fusión por entidad", "Rebase automático o CRDT, y edición sin conexión."],
        ["Identidad y permisos", "Autoría por persona y permisos por documento."],
        ["Sincronía entre hosts", "Replicar el historial entre daemons."],
      ],
      ready: [
        "Las transacciones ya son listas ordenadas de operaciones con actor.",
        "La selección ya tiene su propia versión, separada del contenido.",
        "Cada vista ya separa revisión de contenido y versión de ejecución.",
      ],
    },
  };

  const compare = [
    ["Actualizaciones", "Sondeo con canvas.watch", "Push del servidor"],
    ["Concurrencia", "Conflicto y reintento", "Fusión automática"],
    ["Participantes", "Sin presencia", "Cursores y selección propia"],
    ["Identidad", "user · agent · system", "Por persona"],
    ["Alcance", "Un daemon", "Varios hosts"],
  ];

  const planned = [
    "Conectores entre bloques (enlaces persistidos).",
    "Redimensionar bloques y motor de diseño automático en el servidor.",
    "Etiquetas de procedencia por bloque.",
    "Tarjeta del lienzo dentro de la conversación.",
  ];

  const principles = [
    ["Un servicio, dos puertas", "La interfaz (RPC) y el agente (MCP) ejecutan las mismas transacciones."],
    ["Toda mutación es una transacción", "Con revisión esperada, etiqueta legible y todo o nada."],
    ["Los grupos son de primera clase", "Con descripción, hijos, diseño y comunicación propios."],
    ["Los packs son datos", "JSON declarativo: tipos, plantillas y documentos. Nunca código."],
    ["Nada simulado", "El estado del agente y de cada entrega viene de señales reales."],
  ];

  return { zones, nodes, edges, flows, multiplayer, compare, planned, principles };
})();
