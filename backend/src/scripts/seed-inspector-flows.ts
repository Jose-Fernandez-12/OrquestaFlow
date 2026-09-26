import { getDb, initDb } from "../db/database.js";

async function seed() {
  await initDb();
  const db = getDb();

  const flows = [
    {
      id: "flow-demo-api-etl",
      name: "1. Demo - API REST & Transformacion JSON",
      description: "Flujo completo de ingestion API REST (con Bearer Auth, parametros y reintentos), transformacion con JavaScript y exportacion a Excel.",
      definition: JSON.stringify({
        nodes: [
          {
            id: "node_start_1",
            type: "start",
            position: { x: 50, y: 180 },
            data: { label: "Inicio de Proceso" }
          },
          {
            id: "node_http_get_1",
            type: "httpRequest",
            position: { x: 320, y: 150 },
            data: {
              label: "Obtener Departamentos",
              endpoint: "https://api-colombia.com/api/v1/Department",
              method: "GET",
              authType: "bearer",
              bearerToken: "eyJobXNlcklkIjoiMTIzNDUiLCJyb2xlIjoiYWRtaW4ifQ.demo_token",
              params: JSON.stringify({ page: "1", pageSize: "15", sortBy: "population", order: "desc" }, null, 2),
              headers: JSON.stringify({ "Accept": "application/json", "X-Client-Version": "1.3.0" }, null, 2),
              timeout: 15000,
              retryCount: 3,
              retryDelay: 1500,
              extractPath: ""
            }
          },
          {
            id: "node_transform_1",
            type: "jsonTransform",
            position: { x: 620, y: 150 },
            data: {
              label: "Normalizar Departamentos",
              script: `// Transforma la respuesta de la API a una estructura limpia
return input.map((item, index) => ({
  posicion: index + 1,
  id_departamento: item.id,
  nombre: item.name,
  superficie_km2: item.surface,
  poblacion_estimada: item.population,
  capital_id: item.cityCapitalId,
  total_municipios: item.municipalities
}));`
            }
          },
          {
            id: "node_http_post_1",
            type: "httpRequest",
            position: { x: 920, y: 150 },
            data: {
              label: "Notificar a Webhook / API",
              endpoint: "https://httpbin.org/post",
              method: "POST",
              authType: "apiKey",
              apiKeyHeader: "X-Api-Key",
              apiKeyValue: "sec_orquesta_live_99812",
              body: JSON.stringify({
                evento: "departamentos_normalizados",
                total_items: "{{node_transform_1.length}}",
                datos_muestra: "{{node_transform_1}}"
              }, null, 2),
              headers: JSON.stringify({ "Content-Type": "application/json" }, null, 2)
            }
          },
          {
            id: "node_export_1",
            type: "export",
            position: { x: 1220, y: 150 },
            data: {
              label: "Generar Reporte Excel",
              format: "Excel",
              fileName: "departamentos_colombia_consolidado",
              columns: [
                { header: "Posicion", key: "posicion" },
                { header: "Departamento", key: "nombre" },
                { header: "Poblacion", key: "poblacion_estimada" },
                { header: "Superficie (km2)", key: "superficie_km2" },
                { header: "Municipios", key: "total_municipios" }
              ]
            }
          }
        ],
        edges: [
          {
            id: "e1",
            source: "node_start_1",
            sourceHandle: "right",
            target: "node_http_get_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "e2",
            source: "node_http_get_1",
            sourceHandle: "right",
            target: "node_transform_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "e3",
            source: "node_transform_1",
            sourceHandle: "right",
            target: "node_http_post_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "e4",
            source: "node_http_post_1",
            sourceHandle: "right",
            target: "node_export_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          }
        ]
      })
    },
    {
      id: "flow-demo-foreach-loop",
      name: "2. Demo - Bucle ForEach & Variables de Contexto",
      description: "Demostracion de variables de flujo globales con presets de fecha, array DataList, bucle ForEach con acceso rapido a variables en cada iteracion y rate limiting.",
      definition: JSON.stringify({
        nodes: [
          {
            id: "node_start_2",
            type: "start",
            position: { x: 50, y: 200 },
            data: { label: "Inicio" }
          },
          {
            id: "node_vars_1",
            type: "variables",
            position: { x: 280, y: 180 },
            data: {
              label: "Variables Globales",
              variables: [
                { key: "fecha_proceso", type: "date", value: "$today_iso", description: "Fecha de ejecucion ISO" },
                { key: "ambiente", type: "string", value: "produccion", description: "Entorno destino" },
                { key: "max_concurrencia", type: "number", value: 2, description: "Hilos paralelos" },
                { key: "notificar_telegram", type: "boolean", value: true, description: "Enviar alertas" },
                { key: "filtro_region", type: "string", value: "Andina", description: "Filtro principal" }
              ]
            }
          },
          {
            id: "node_datalist_1",
            type: "dataList",
            position: { x: 550, y: 180 },
            data: {
              label: "Lista de Sucursales",
              items: JSON.stringify([
                { id: "SUC-001", nombre: "Sede Bogota Centro", ciudad: "Bogota", departamentoId: 11, meta_ventas: 85000 },
                { id: "SUC-002", nombre: "Sede Medellin Poblado", ciudad: "Medellin", departamentoId: 5, meta_ventas: 64000 },
                { id: "SUC-003", nombre: "Sede Cali Chipichape", ciudad: "Cali", departamentoId: 76, meta_ventas: 48000 },
                { id: "SUC-004", nombre: "Sede Barranquilla Prado", ciudad: "Barranquilla", departamentoId: 8, meta_ventas: 39000 }
              ], null, 2)
            }
          },
          {
            id: "node_foreach_1",
            type: "forEach",
            position: { x: 820, y: 180 },
            data: {
              label: "Iterar Sucursales",
              iterateOver: "{{node_datalist_1}}",
              itemAlias: "sucursal",
              concurrency: 2,
              batchSize: 1,
              maxIterations: 10
            }
          },
          {
            id: "node_http_branch_1",
            type: "httpRequest",
            position: { x: 1090, y: 150 },
            data: {
              label: "Consultar Ciudades por Depto",
              endpoint: "https://api-colombia.com/api/v1/Department/{{sucursal.departamentoId}}/cities",
              method: "GET",
              params: JSON.stringify({ codigo_sucursal: "{{sucursal.id}}", ciudad: "{{sucursal.ciudad}}" }, null, 2)
            }
          },
          {
            id: "node_timer_loop_1",
            type: "timer",
            position: { x: 1360, y: 180 },
            data: {
              label: "Rate Limit (1.5s)",
              duration: 1.5,
              unit: "seconds"
            }
          },
          {
            id: "node_foreachend_1",
            type: "forEachEnd",
            position: { x: 1610, y: 180 },
            data: {
              label: "Consolidar Resultados"
            }
          },
          {
            id: "node_export_loop_1",
            type: "export",
            position: { x: 1860, y: 180 },
            data: {
              label: "Exportar Resumen CSV",
              format: "CSV",
              fileName: "sucursales_consolidadas"
            }
          }
        ],
        edges: [
          {
            id: "el1",
            source: "node_start_2",
            sourceHandle: "right",
            target: "node_vars_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el2",
            source: "node_vars_1",
            sourceHandle: "right",
            target: "node_datalist_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el3",
            source: "node_datalist_1",
            sourceHandle: "right",
            target: "node_foreach_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el4",
            source: "node_foreach_1",
            sourceHandle: "right",
            target: "node_http_branch_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el5",
            source: "node_http_branch_1",
            sourceHandle: "right",
            target: "node_timer_loop_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el6",
            source: "node_timer_loop_1",
            sourceHandle: "right",
            target: "node_foreachend_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "el7",
            source: "node_foreachend_1",
            sourceHandle: "right",
            target: "node_export_loop_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          }
        ]
      })
    },
    {
      id: "flow-demo-ia-conditions",
      name: "3. Demo - Clasificacion con IA & Ramas Condicionales",
      description: "Recepcion de Webhook Trigger entrante, clasificacion semantica mediante AI Chat Completion, enrutamiento mediante Conditional Branch (Switch) y despacho.",
      definition: JSON.stringify({
        nodes: [
          {
            id: "node_webhook_1",
            type: "webhookTrigger",
            position: { x: 50, y: 220 },
            data: {
              label: "Webhook Recepcion Tickets",
              path: "/api/webhooks/tickets-soporte",
              method: "POST",
              secretToken: "whsec_live_994827103abcf"
            }
          },
          {
            id: "node_ai_chat_1",
            type: "aiChatCompletion",
            position: { x: 330, y: 200 },
            data: {
              label: "Clasificador Semantico IA",
              endpoint: "https://api.openai.com/v1/chat/completions",
              model: "gpt-4o-mini",
              temperature: 0.2,
              responseFormat: "json_object",
              systemPrompt: "Eres un clasificador inteligente de incidencias. Analiza el reclamo del usuario y responde en JSON estricto con las claves: 'prioridad' ('ALTA', 'MEDIA', 'BAJA'), 'area' ('FACTURACION', 'SISTEMAS', 'LOGISTICA') y 'resumen_breve'.",
              userPrompt: "Mensaje recibido: {{node_webhook_1.body.mensaje}}"
            }
          },
          {
            id: "node_branch_1",
            type: "conditionalBranch",
            position: { x: 650, y: 200 },
            data: {
              label: "Enrutador por Prioridad",
              mode: "switch",
              cases: [
                { id: "1", value: "ALTA", label: "Prioridad Alta (Escalar Urgente)" },
                { id: "2", value: "MEDIA", label: "Prioridad Media (Cola Normal)" },
                { id: "3", value: "BAJA", label: "Prioridad Baja (Informativo)" }
              ]
            }
          },
          {
            id: "node_action_alta",
            type: "httpRequest",
            position: { x: 980, y: 80 },
            data: {
              label: "Alerta Slack Canal Critico",
              endpoint: "https://hooks.slack.com/services/T00/B00/CRITICO",
              method: "POST",
              authType: "none",
              headers: JSON.stringify({ "Content-Type": "application/json" }, null, 2),
              body: JSON.stringify({
                channel: "#incidentes-urgentes",
                username: "Orquesta AI Bot",
                text: "ALERTA URGENTE: Ticket clasificado con prioridad ALTA"
              }, null, 2)
            }
          },
          {
            id: "node_action_media",
            type: "query",
            position: { x: 980, y: 220 },
            data: {
              label: "Registrar en Base de Datos",
              queryId: "9f047e03-928e-4cf8-9341-91fe3366669e",
              connectionId: "d5959626-45f4-4ead-b6e8-8de6a90f696c"
            }
          },
          {
            id: "node_action_baja",
            type: "timer",
            position: { x: 980, y: 360 },
            data: {
              label: "Delay de Procesamiento",
              duration: 5,
              unit: "seconds"
            }
          },
          {
            id: "node_export_auditoria",
            type: "export",
            position: { x: 1280, y: 220 },
            data: {
              label: "Exportar Log Auditoria",
              format: "Excel",
              fileName: "auditoria_tickets_clasificados",
              columns: [
                { header: "ID Ticket", key: "ticketId" },
                { header: "Prioridad IA", key: "prioridad" },
                { header: "Area", key: "area" },
                { header: "Fecha", key: "timestamp" }
              ]
            }
          }
        ],
        edges: [
          {
            id: "eb1",
            source: "node_webhook_1",
            sourceHandle: "right",
            target: "node_ai_chat_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "eb2",
            source: "node_ai_chat_1",
            sourceHandle: "right",
            target: "node_branch_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "eb_case_1",
            source: "node_branch_1",
            sourceHandle: "case_1",
            target: "node_action_alta",
            targetHandle: "left",
            style: { stroke: "#ef4444", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#ef4444" }
          },
          {
            id: "eb_case_2",
            source: "node_branch_1",
            sourceHandle: "case_2",
            target: "node_action_media",
            targetHandle: "left",
            style: { stroke: "#f59e0b", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#f59e0b" }
          },
          {
            id: "eb_case_3",
            source: "node_branch_1",
            sourceHandle: "case_3",
            target: "node_action_baja",
            targetHandle: "left",
            style: { stroke: "#3b82f6", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "eb_to_export",
            source: "node_action_media",
            sourceHandle: "right",
            target: "node_export_auditoria",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          }
        ]
      })
    },
    {
      id: "flow-demo-database-scraping",
      name: "4. Demo - Consultas SQL & Web Scraping",
      description: "Conector a base de datos relacional, consulta de registros, extraccion web scraping de datos complementarios y exportacion final en CSV.",
      definition: JSON.stringify({
        nodes: [
          {
            id: "node_start_4",
            type: "start",
            position: { x: 50, y: 180 },
            data: { label: "Inicio Auditoria" }
          },
          {
            id: "node_query_1",
            type: "query",
            position: { x: 300, y: 150 },
            data: {
              label: "Consultar Flujos en BD",
              queryId: "9f047e03-928e-4cf8-9341-91fe3366669e",
              connectionId: "d5959626-45f4-4ead-b6e8-8de6a90f696c"
            }
          },
          {
            id: "node_scraping_1",
            type: "scraping",
            position: { x: 600, y: 150 },
            data: {
              label: "Web Scraping Hacker News",
              url: "https://news.ycombinator.com",
              selector: ".titleline > a",
              script: "extraer_titulares_tech"
            }
          },
          {
            id: "node_export_4",
            type: "export",
            position: { x: 900, y: 150 },
            data: {
              label: "Exportar CSV Combinado",
              format: "CSV",
              fileName: "extraccion_noticias_y_flujos",
              columns: [
                { header: "Titulo Noticia", key: "title" },
                { header: "Enlace URL", key: "url" },
                { header: "Puntos", key: "score" }
              ]
            }
          }
        ],
        edges: [
          {
            id: "es1",
            source: "node_start_4",
            sourceHandle: "right",
            target: "node_query_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "es2",
            source: "node_query_1",
            sourceHandle: "right",
            target: "node_scraping_1",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          },
          {
            id: "es3",
            source: "node_scraping_1",
            sourceHandle: "right",
            target: "node_export_4",
            targetHandle: "left",
            style: { stroke: "#22c55e", strokeWidth: 2 },
            markerEnd: { type: "arrowclosed", color: "#3b82f6" }
          }
        ]
      })
    }
  ];

  for (const flow of flows) {
    const existing = db.prepare("SELECT id FROM flows WHERE id = ?").get(flow.id);
    if (existing) {
      db.prepare(`
        UPDATE flows 
        SET name = ?, description = ?, definition = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(flow.name, flow.description, flow.definition, flow.id);
      console.log(`Updated flow: ${flow.name} (${flow.id})`);
    } else {
      db.prepare(`
        INSERT INTO flows (id, name, description, definition, status, is_locked)
        VALUES (?, ?, ?, ?, 'saved', 0)
      `).run(flow.id, flow.name, flow.description, flow.definition);
      console.log(`Created flow: ${flow.name} (${flow.id})`);
    }
  }

  console.log("Seeding demo flows completed successfully.");
}

seed().catch(err => {
  console.error("Error seeding flows:", err);
  process.exit(1);
});
