// Generated from design/tokens.json. Keep both files in sync.
export const tokens = {
  "$meta": {
    "product": "Lienzo",
    "subtitle": "Paseo Canvas",
    "version": 5,
    "language": "es",
    "note": "Fuente de verdad visual, alineada con plugin/shared (model.ts, rpc.ts, builtins.ts). Los neutros, el acento y los estados vienen SIEMPRE de theme.colors del host; aquí solo se fijan los valores propios de Lienzo. v2 añade: renderers, diagram, preview, media, size.blockWidth.wide, layout. Claves v1 se conservan; las marcadas deprecated no se usan. v3 añade: graph (lienzo como grafo: nodos, enlaces, regiones), renderers.node, layout.graph/rows. v4 añade: motion (curvas, muelles, arrastre, cámara, guías, auto-pan), canvas.fitInset, canvas.pin y zoom mínimo 0.25 para la vista general. Ver docs/design.md §16. v5: guía consultable, medios interactivos, tamaño de bloque opcional y adquisición magnética de enlaces."
  },
  "hostColorRoles": {
    "canvas": "theme.colors.surface0",
    "panel": "theme.colors.surface1",
    "block": "theme.colors.surface1",
    "control": "theme.colors.surface2",
    "line": "theme.colors.border",
    "ink": "theme.colors.foreground",
    "inkMuted": "theme.colors.foregroundMuted",
    "accent": "theme.colors.accent",
    "onAccent": "theme.colors.accentForeground",
    "success": "theme.colors.statusSuccess",
    "warning": "theme.colors.statusWarning",
    "danger": "theme.colors.statusDanger"
  },
  "contributedThemes": {
    "lienzo-papel": {
      "name": "Lienzo Papel",
      "appearance": "light",
      "colors": {
        "background": "#F4F1EA",
        "foreground": "#1F1D1A",
        "raised": "#FCFBF7",
        "control": "#EAE6DC",
        "border": "#D8D2C4",
        "accent": "#2447C5",
        "mutedForeground": "#655F54",
        "ring": "#8E8778"
      }
    },
    "lienzo-tinta": {
      "name": "Lienzo Tinta",
      "appearance": "dark",
      "colors": {
        "background": "#141311",
        "foreground": "#ECE8DF",
        "raised": "#1D1B18",
        "control": "#282520",
        "border": "#38342D",
        "accent": "#8FA8FF",
        "mutedForeground": "#A69F92",
        "ring": "#6F695E"
      }
    }
  },
  "mockOnly": {
    "note": "Valores que en el plugin real entrega el host. Solo los usa design/demo.html.",
    "light": {
      "onAccent": "#FFFFFF",
      "success": "#2F7D4F",
      "warning": "#9A6700",
      "danger": "#B3261E"
    },
    "dark": {
      "onAccent": "#0C1330",
      "success": "#6CC08B",
      "warning": "#E3B341",
      "danger": "#F2867C"
    }
  },
  "tones": {
    "$doc": "Un tono clasifica un bloque o un grupo. Valor 'host:x' = usar theme.colors.x. Los demás dependen de isDark(surface0).",
    "neutro": {
      "meaning": "Texto libre, sin intención especial",
      "light": "host:foregroundMuted",
      "dark": "host:foregroundMuted"
    },
    "acento": {
      "meaning": "Dirigido al agente (instrucciones, acuerdos)",
      "light": "host:accent",
      "dark": "host:accent"
    },
    "violeta": {
      "meaning": "Espera una respuesta de la persona",
      "light": "#6D44B8",
      "dark": "#B79BF0"
    },
    "turquesa": {
      "meaning": "Material de referencia: código, archivos, conceptos",
      "light": "#0F7B83",
      "dark": "#5CC4CC"
    },
    "exito": {
      "meaning": "Avance, hecho, aprobado",
      "light": "host:statusSuccess",
      "dark": "host:statusSuccess"
    },
    "aviso": {
      "meaning": "Atención, severidad media",
      "light": "host:statusWarning",
      "dark": "host:statusWarning"
    },
    "riesgo": {
      "meaning": "Bloqueante, severidad alta, error",
      "light": "host:statusDanger",
      "dark": "host:statusDanger"
    }
  },
  "alpha": {
    "toneWash": 0.1,
    "toneWashStrong": 0.16,
    "toneBorder": 0.38,
    "groupFill": 0.05,
    "selectionHalo": 0.2,
    "hoverFill": 0.06,
    "pressedFill": 0.1,
    "scrim": 0.45,
    "disabled": 0.45,
    "pending": 0.7,
    "glyphRing": 0.7
  },
  "font": {
    "family": {
      "sans": "undefined (fuente del sistema)",
      "serif": "Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, \"Iowan Old Style\", \"Times New Roman\", serif' })",
      "mono": "Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, \"SF Mono\", Menlo, Consolas, monospace' })"
    },
    "style": {
      "display": {
        "family": "serif",
        "size": 22,
        "lineHeight": 28,
        "weight": "600",
        "letterSpacing": -0.2
      },
      "title": {
        "family": "serif",
        "size": 17,
        "lineHeight": 23,
        "weight": "600",
        "letterSpacing": -0.1
      },
      "groupTitle": {
        "family": "serif",
        "size": 15,
        "lineHeight": 20,
        "weight": "600",
        "letterSpacing": 0
      },
      "heading": {
        "family": "sans",
        "size": 14,
        "lineHeight": 20,
        "weight": "600",
        "letterSpacing": 0
      },
      "body": {
        "family": "sans",
        "size": 13,
        "lineHeight": 19,
        "weight": "400",
        "letterSpacing": 0
      },
      "bodyStrong": {
        "family": "sans",
        "size": 13,
        "lineHeight": 19,
        "weight": "600",
        "letterSpacing": 0
      },
      "small": {
        "family": "sans",
        "size": 12,
        "lineHeight": 17,
        "weight": "400",
        "letterSpacing": 0
      },
      "label": {
        "family": "mono",
        "size": 10.5,
        "lineHeight": 14,
        "weight": "500",
        "letterSpacing": 0.6,
        "transform": "uppercase"
      },
      "code": {
        "family": "mono",
        "size": 12,
        "lineHeight": 18,
        "weight": "400",
        "letterSpacing": 0
      },
      "button": {
        "family": "sans",
        "size": 13,
        "lineHeight": 18,
        "weight": "600",
        "letterSpacing": 0
      }
    },
    "compactBump": {
      "body": 14,
      "bodyLineHeight": 21,
      "small": 13,
      "smallLineHeight": 18,
      "button": 14
    }
  },
  "space": {
    "0": 0,
    "1": 2,
    "2": 4,
    "3": 6,
    "4": 8,
    "5": 12,
    "6": 16,
    "7": 20,
    "8": 24,
    "9": 32,
    "10": 48
  },
  "radius": {
    "chip": 4,
    "control": 6,
    "block": 10,
    "group": 14,
    "panel": 0,
    "pill": 999
  },
  "border": {
    "hairline": 1,
    "group": 1.5,
    "selected": 2,
    "spine": 3
  },
  "size": {
    "topBar": 48,
    "topBarCompact": 52,
    "catalogRail": 288,
    "inspector": 328,
    "tray": 56,
    "trayExpandedMax": 220,
    "control": 32,
    "controlSmall": 26,
    "controlCompact": 44,
    "iconButton": 32,
    "icon": 16,
    "iconSmall": 14,
    "iconLarge": 20,
    "blockWidth": {
      "standard": 288,
      "wide": 592,
      "m": 288,
      "$deprecated": "s y l eliminados; m = standard. wide = diagram y preview-frame (2 columnas + 16).",
      "node": 224
    },
    "blockMinHeight": 72,
    "groupPadding": 16,
    "groupHeader": 36,
    "groupMinWidth": 320,
    "catalogCardMinHeight": 76,
    "emptyStateMaxWidth": 380,
    "groupHeaderNested": 32,
    "groupPaddingNested": 12,
    "groupEmpty": 56,
    "groupDescription": {
      "maxLines": 2,
      "maxHeight": 34,
      "gap": 12
    }
  },
  "canvas": {
    "snap": 8,
    "zoomMin": 0.25,
    "zoomMax": 1.6,
    "zoomSteps": [
      0.25,
      0.4,
      0.5,
      0.67,
      0.8,
      1,
      1.25,
      1.6
    ],
    "defaultGap": 16,
    "groupGap": 32,
    "dragThreshold": 4,
    "initialZoom": {
      "min": 0.8,
      "max": 1,
      "topInset": 48
    },
    "fitInset": 48,
    "fitMax": 1,
    "pin": {
      "size": 18,
      "icon": "Pin",
      "iconSize": 10,
      "offset": -7,
      "label": "Soltar posición",
      "container": "Reordenar automáticamente"
    },
    "resize": {
      "hit": 28,
      "size": 10,
      "radius": 3,
      "max": 4096,
      "minimum": {
        "node": {
          "width": 160,
          "height": 104
        },
        "standard": {
          "width": 224,
          "height": 144
        },
        "web": {
          "width": 320,
          "height": 288
        },
        "media": {
          "width": 240,
          "height": 320
        }
      }
    }
  },
  "motion": {
    "fast": 120,
    "base": 180,
    "slow": 260,
    "easing": "Easing.bezier(0.22, 1, 0.36, 1)",
    "rule": "Solo transform y opacidad (única excepción: ancho/alto del marco de un grupo). Entradas y respuestas con ease-out propio; muelles solo para lo que viene de un gesto. Las transiciones temporizadas duran como máximo 280 ms; los muelles y la inercia terminan al llegar a sus umbrales de reposo. Las acciones de teclado repetibles no se animan. AccessibilityInfo.isReduceMotionEnabled → todo instantáneo.",
    "curve": {
      "out": [
        0.22,
        1,
        0.36,
        1
      ],
      "inOut": [
        0.65,
        0,
        0.35,
        1
      ]
    },
    "press": {
      "scale": 0.97,
      "ms": 100
    },
    "drag": {
      "threshold": 4,
      "liftScale": 1.02,
      "liftMs": 140,
      "dropMs": 180,
      "shadow": "0px 14px 32px",
      "shadowAlpha": 0.24,
      "targetSlack": 8,
      "targetFadeMs": 120,
      "targetFillAlpha": 0.08
    },
    "spring": {
      "stiffness": 380,
      "damping": 32,
      "mass": 1,
      "velocityMax": 500,
      "restDistance": 0.25,
      "restSpeed": 2
    },
    "layout": {
      "ms": 240,
      "frameMs": 220
    },
    "enter": {
      "ms": 180,
      "scale": 0.96,
      "offset": 12
    },
    "camera": {
      "fitMs": 280,
      "stepMs": 160,
      "wheelMs": 120,
      "wheelNotch": 40,
      "deceleration": 0.995,
      "flickMin": 0.2,
      "stopBelow": 0.02
    },
    "guides": {
      "threshold": 6,
      "width": 1,
      "fadeMs": 100
    },
    "autoPan": {
      "edge": 48,
      "maxSpeed": 900
    },
    "magnet": {
      "radius": 28,
      "releaseRadius": 40,
      "sparkCount": 4,
      "sparkMs": 180,
      "sparkTravel": 12,
      "sparkSize": 2,
      "cooldownMs": 240
    }
  },
  "breakpoints": {
    "compact": "layout.compact === true",
    "medium": "ancho del panel < 980 → el inspector pasa a hoja superpuesta; el catálogo se contrae",
    "wide": "ancho del panel >= 980 → catálogo + lienzo + inspector"
  },
  "blockTypes": {
    "$deprecated": "Sustituido por renderers. Los tipos reales viven en plugin/shared/builtins.ts: diagram, note, code, checklist, choice, progress, preview, media."
  },
  "icons": {
    "panel": "Frame",
    "catalog": "LibraryBig",
    "inspector": "PanelRight",
    "group": "Group",
    "ungroup": "Ungroup",
    "template": "LayoutTemplate",
    "pack": "Package",
    "import": "Download",
    "export": "Upload",
    "undo": "Undo2",
    "redo": "Redo2",
    "send": "SendHorizontal",
    "person": "User",
    "revision": "History",
    "conflict": "GitCompareArrows",
    "viewCanvas": "Frame",
    "viewOutline": "ListTree",
    "zoomIn": "Plus",
    "zoomOut": "Minus",
    "fit": "Maximize",
    "add": "Plus",
    "search": "Search",
    "close": "X",
    "more": "Ellipsis",
    "collapse": "ChevronDown",
    "expand": "ChevronRight",
    "copy": "Copy",
    "delete": "Trash2",
    "duplicate": "CopyPlus",
    "retry": "RotateCw",
    "offline": "Unplug",
    "example": "FlaskConical",
    "check": "Check",
    "error": "CircleAlert",
    "info": "Info",
    "download": "Download",
    "upload": "Upload",
    "importPack": "FileInput",
    "exportPack": "FileOutput",
    "pickFile": "FolderOpen",
    "openExternal": "ExternalLink",
    "queued": "Clock",
    "acked": "CheckCheck",
    "stepPrev": "ChevronLeft",
    "stepNext": "ChevronRight",
    "connect": "Plug",
    "setup": "Wrench",
    "globe": "Globe",
    "diagram": "Workflow",
    "edgeOut": "CornerDownRight",
    "agent": "Bot",
    "guide": "BookOpen"
  },
  "layout": {
    "$doc": "Render de layout (grupo o documento). Sin layout: graph si hay enlaces entre hijos directos; si no, free si algún hijo tiene position; si no, rows cuando el grupo contiene grupos; si no, stack. La raíz sin layout ni enlaces: free con los no posicionados en filas.",
    "stack": {
      "gap": 12,
      "align": "stretch",
      "width": "max(ancho de hijos) + 2*groupPadding"
    },
    "grid": {
      "gap": 12,
      "columns": 2,
      "columnsMax": 4,
      "cell": 288,
      "wideSpansRow": true
    },
    "flow": {
      "gap": 28,
      "direction": "row",
      "connectorIcon": "ChevronRight",
      "connectorSize": 14,
      "wrapOnCompact": "column"
    },
    "free": {
      "minInnerWidth": 288,
      "padding": 16
    },
    "root": {
      "unplacedShelfGap": 48,
      "unplacedShelfWidth": 1400,
      "unplacedShelfOffsetY": 64
    },
    "labels": {
      "stack": "Pila",
      "grid": "Rejilla",
      "flow": "Flujo",
      "graph": "Grafo",
      "free": "Libre"
    },
    "graph": {
      "direction": "down",
      "directions": {
        "down": "Hacia abajo",
        "right": "Hacia la derecha"
      },
      "unlinked": "filas debajo del grafo",
      "positioned": "conservan su position; después se resuelven solapes"
    },
    "rows": {
      "gap": 24,
      "gapRoot": 48,
      "note": "Modo interno (no se persiste): empaqueta en filas hasta graph.wrap."
    }
  },
  "renderers": {
    "$doc": "Visual por BlockType.renderer (enum de model.ts). icon = Lucide, tone = tokens.tones, width = size.blockWidth. Tipo sin renderer → generic. typeId ausente del catálogo → unknown.",
    "note": {
      "icon": "StickyNote",
      "tone": "neutro",
      "width": "standard"
    },
    "text": {
      "icon": "AlignLeft",
      "tone": "neutro",
      "width": "standard"
    },
    "code": {
      "icon": "Code",
      "tone": "turquesa",
      "width": "standard"
    },
    "checklist": {
      "icon": "ListChecks",
      "tone": "exito",
      "width": "standard"
    },
    "choice": {
      "icon": "MessageCircleQuestion",
      "tone": "violeta",
      "width": "standard"
    },
    "quiz": {
      "icon": "PencilLine",
      "tone": "violeta",
      "width": "standard"
    },
    "form": {
      "icon": "ClipboardPen",
      "tone": "violeta",
      "width": "standard"
    },
    "progress": {
      "icon": "Milestone",
      "tone": "exito",
      "width": "standard"
    },
    "metric": {
      "icon": "Gauge",
      "tone": "turquesa",
      "width": "standard"
    },
    "step": {
      "icon": "ListOrdered",
      "tone": "exito",
      "width": "standard"
    },
    "callout": {
      "icon": "Info",
      "tone": "aviso",
      "width": "standard"
    },
    "preview-frame": {
      "icon": "AppWindow",
      "tone": "acento",
      "width": "wide"
    },
    "image-ref": {
      "icon": "Image",
      "tone": "turquesa",
      "width": "standard"
    },
    "diagram": {
      "icon": "Workflow",
      "tone": "acento",
      "width": "wide"
    },
    "node": {
      "icon": "CircleDot",
      "tone": "neutro",
      "width": "node"
    },
    "generic": {
      "icon": "Square",
      "tone": "neutro",
      "width": "standard"
    },
    "unknown": {
      "icon": "PackageOpen",
      "tone": "neutro",
      "width": "standard"
    }
  },
  "diagram": {
    "$doc": "Bloque diagram (DiagramData). Solo Views. Ver docs/design.md §7.",
    "node": {
      "width": 136,
      "height": 44,
      "radius": 8,
      "paddingH": 8,
      "border": 1,
      "borderCurrent": 2,
      "labelStyle": "small 600, 2 líneas máx, centrado"
    },
    "gapX": 24,
    "gapY": 40,
    "padding": 12,
    "maxColumns": {
      "wide": 3,
      "standard": 1
    },
    "line": {
      "width": 1.5,
      "widthCurrent": 2,
      "color": "withAlpha(foregroundMuted,0.7)",
      "colorCurrent": "accent",
      "backEdgeStyle": "dashed"
    },
    "arrow": {
      "size": 6,
      "stroke": 1.5
    },
    "rail": {
      "inset": 10,
      "laneGap": 8,
      "maxLanes": 4
    },
    "edgeLabel": {
      "style": "small 11/14",
      "paddingH": 4,
      "paddingV": 1,
      "radius": 4,
      "fill": "surface1",
      "maxWidth": 120,
      "maxWidthNextRow": 136,
      "nextRowOffsets": {
        "run": 16,
        "labelCenter": 30
      }
    },
    "ghost": {
      "opacity": 0.5,
      "borderStyle": "dashed"
    },
    "enter": {
      "duration": 260,
      "translateY": 6
    },
    "listFallback": {
      "whenInnerWidthBelow": 296,
      "whenNodesAbove": 30,
      "rail": 24,
      "marker": 18,
      "rowGap": 10
    },
    "detail": {
      "radius": 6,
      "paddingH": 10,
      "paddingV": 8,
      "fill": "wash(acento)"
    },
    "stepper": {
      "height": 28
    },
    "gapYLabeled": 48
  },
  "graph": {
    "$doc": "Lienzo como grafo (architecture §13). Tarjetas nodo, enlaces curvos entre marcos y regiones punteadas. Colores siempre desde tones/theme.colors. Ver docs/design.md §15.",
    "node": {
      "width": 224,
      "estimatedHeight": 80,
      "minHeight": 64,
      "radius": 10,
      "paddingH": 12,
      "paddingV": 10,
      "gap": 4,
      "titleLines": 2,
      "summaryLines": 2,
      "details": {
        "width": 288,
        "offset": 8,
        "maxLines": 14
      }
    },
    "gap": {
      "node": 32,
      "layer": 80,
      "nodeGroups": 48,
      "layerGroups": 120,
      "lane": 20,
      "unlinkedOffset": 40
    },
    "wrap": {
      "min": 960,
      "fallback": 1400,
      "viewportInset": 96
    },
    "link": {
      "width": 1.5,
      "widthActive": 2.25,
      "hitWidth": 14,
      "alpha": {
        "rest": 0.5,
        "toned": 0.85,
        "dim": 0.14
      },
      "dash": {
        "flow": "",
        "depends": "6 5",
        "reference": "1.5 5"
      },
      "defaultTone": {
        "flow": "acento",
        "depends": "violeta",
        "reference": "turquesa"
      },
      "toneAlias": {
        "peligro": "riesgo"
      },
      "arrow": {
        "length": 9,
        "width": 8
      },
      "port": {
        "spacing": 16,
        "span": 0.6
      },
      "curve": {
        "min": 28,
        "max": 120
      },
      "label": {
        "size": 11,
        "lineHeight": 14,
        "maxChars": 32,
        "halo": 4,
        "lift": 10
      },
      "badge": {
        "radius": 8,
        "size": 10
      },
      "sideGap": 20,
      "strands": {
        "max": 4,
        "gap": 5
      }
    },
    "dim": {
      "node": 0.34
    },
    "handle": {
      "size": 16,
      "hit": 28,
      "icon": "Plus"
    },
    "region": {
      "borderStyle": "dashed",
      "fillAlpha": 0.025
    },
    "kinds": {
      "flow": "Flujo",
      "depends": "Depende",
      "reference": "Referencia"
    },
    "kindHelp": {
      "flow": "Sigue o envía a",
      "depends": "Necesita a",
      "reference": "Menciona a"
    },
    "tones": [
      "neutro",
      "acento",
      "violeta",
      "turquesa",
      "aviso",
      "peligro"
    ],
    "status": {
      "$doc": "Palabra de data.status (sin distinguir mayúsculas) → tono del chip. Lo no listado es neutro.",
      "exito": [
        "ready",
        "ok",
        "done",
        "live",
        "stable",
        "listo",
        "lista",
        "hecho",
        "hecha",
        "estable",
        "activo",
        "activa",
        "completo",
        "completa"
      ],
      "aviso": [
        "wip",
        "review",
        "pending",
        "partial",
        "beta",
        "pendiente",
        "parcial",
        "en curso",
        "en progreso",
        "revisar",
        "revisión"
      ],
      "riesgo": [
        "blocked",
        "error",
        "failed",
        "broken",
        "down",
        "bloqueado",
        "bloqueada",
        "fallo",
        "falla",
        "roto",
        "rota",
        "caído",
        "caída"
      ],
      "acento": [
        "new",
        "next",
        "planned",
        "nuevo",
        "nueva",
        "siguiente",
        "planeado",
        "planeada"
      ]
    }
  },
  "preview": {
    "$doc": "Bloque preview (renderer preview-frame): data {description, url?}.",
    "urlBar": {
      "height": 28,
      "radius": 6,
      "fill": "surface2"
    },
    "frame": {
      "height": 360,
      "heightCompact": 240,
      "radius": 6,
      "border": 1
    },
    "sandbox": "allow-scripts allow-forms",
    "conceptual": {
      "minHeight": 96,
      "borderStyle": "dashed"
    }
  },
  "media": {
    "$doc": "Bloque media (renderer image-ref): data {url, caption?, mediaKind?}.",
    "image": {
      "height": 180,
      "radius": 6,
      "fill": "surface2",
      "resizeMode": "contain"
    },
    "kinds": {
      "image": "Image",
      "video": "Film",
      "audio": "AudioLines",
      "reference": "Link"
    },
    "video": {
      "height": 200,
      "preload": "none",
      "autoplay": false
    },
    "audio": {
      "height": 48,
      "preload": "none"
    },
    "viewer": {
      "height": 440,
      "heightCompact": 320,
      "zoomMin": 1,
      "zoomMax": 4,
      "zoomStep": 0.5
    }
  },
  "web": {
    "$doc": "Únicos accesos DOM permitidos, todos en plugin/client/web.ts y solo si layout.platform === \"web\".",
    "helpers": [
      "downloadJson(filename, text): boolean",
      "pickJsonFile(maxBytes=1048576): Promise<string|null>",
      "WebFrame({url,height,title})",
      "attachWheel(node, onWheel)",
      "attachKeys(handler)"
    ]
  }
} as const;
