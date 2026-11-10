import { v4 as uuid } from 'uuid';

export interface FlowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  nodeBadges: string[];
  buildDefinition: () => { nodes: any[]; edges: any[] };
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'blank',
    name: 'Flujo en blanco',
    category: 'Básico',
    description: 'Lienzo vacío con un nodo de inicio para diseñar tu flujo desde cero.',
    nodeBadges: ['Inicio'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 100, y: 200 },
            data: { label: 'Inicio' },
          },
        ],
        edges: [],
      };
    },
  },
  {
    id: 'rest-api-to-excel',
    name: 'API REST a reporte Excel',
    category: 'Integración',
    description: 'Define variables con fecha dinámica, consulta un endpoint HTTP, transforma el JSON y exporta a Excel.',
    nodeBadges: ['Variables', 'HTTP Request', 'Transformar', 'Exportar Excel'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      const varsId = `variables_${uuid().slice(0, 8)}`;
      const httpId = `http_${uuid().slice(0, 8)}`;
      const transformId = `transform_${uuid().slice(0, 8)}`;
      const exportId = `export_${uuid().slice(0, 8)}`;

      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 60, y: 200 },
            data: { label: 'Inicio' },
          },
          {
            id: varsId,
            type: 'variables',
            position: { x: 280, y: 200 },
            data: {
              label: 'Parámetros',
              variables: [
                {
                  key: 'fechaCorte',
                  type: 'date',
                  value: '$today_ymd',
                  description: 'Fecha del reporte (YYYYMMDD)',
                  promptOnRun: true,
                },
                {
                  key: 'limite',
                  type: 'number',
                  value: 10,
                  description: 'Máximo de registros a consultar',
                  promptOnRun: true,
                },
              ],
            },
          },
          {
            id: httpId,
            type: 'httpRequest',
            position: { x: 520, y: 200 },
            data: {
              label: 'Consultar API',
              method: 'GET',
              endpoint: 'https://jsonplaceholder.typicode.com/users',
            },
          },
          {
            id: transformId,
            type: 'jsonTransform',
            position: { x: 760, y: 200 },
            data: {
              label: 'Formatear filas',
              transformType: 'javascript',
              expression: `const rows = Array.isArray(data) ? data : (data?.data || []);\nreturn rows.slice(0, Number(context['Parámetros']?.limite) || 10).map(u => ({\n  id: u.id,\n  nombre: u.name,\n  correo: u.email,\n  empresa: u.company?.name || '',\n  fechaCorte: context['Parámetros']?.fechaCorte\n}));`,
            },
          },
          {
            id: exportId,
            type: 'export',
            position: { x: 1000, y: 200 },
            data: {
              label: 'Exportar Excel',
              format: 'Excel',
              fileName: 'reporte_api_{{fechaCorte}}',
            },
          },
        ],
        edges: [
          { id: `e_${startId}_${varsId}`, source: startId, target: varsId },
          { id: `e_${varsId}_${httpId}`, source: varsId, target: httpId },
          { id: `e_${httpId}_${transformId}`, source: httpId, target: transformId },
          { id: `e_${transformId}_${exportId}`, source: transformId, target: exportId },
        ],
      };
    },
  },
  {
    id: 'sql-conditional-export',
    name: 'Consulta SQL con validación condicional',
    category: 'Base de datos',
    description: 'Ejecuta una consulta parametrizada por rango de fechas, verifica si devolvió registros y genera el archivo.',
    nodeBadges: ['Variables', 'Consulta DB', 'Bifurcación', 'Exportar'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      const varsId = `variables_${uuid().slice(0, 8)}`;
      const queryId = `query_${uuid().slice(0, 8)}`;
      const branchId = `branch_${uuid().slice(0, 8)}`;
      const exportId = `export_${uuid().slice(0, 8)}`;

      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 60, y: 200 },
            data: { label: 'Inicio' },
          },
          {
            id: varsId,
            type: 'variables',
            position: { x: 280, y: 200 },
            data: {
              label: 'Fechas consulta',
              variables: [
                {
                  key: 'fechaInicio',
                  type: 'date',
                  value: '$month_start',
                  description: 'Inicio de mes (YYYYMM01)',
                  promptOnRun: true,
                },
                {
                  key: 'fechaFin',
                  type: 'date',
                  value: '$today_ymd',
                  description: 'Fecha actual (YYYYMMDD)',
                  promptOnRun: true,
                },
              ],
            },
          },
          {
            id: queryId,
            type: 'query',
            position: { x: 520, y: 200 },
            data: {
              label: 'Consulta ventas',
              queryId: '',
            },
          },
          {
            id: branchId,
            type: 'conditionalBranch',
            position: { x: 760, y: 200 },
            data: {
              label: '¿Hay registros?',
              mode: 'if_else',
              conditions: [
                {
                  id: '1',
                  // The query node returns the list of rows itself
                  left: `{{${queryId}.length}}`,
                  operator: 'gt',
                  right: '0',
                },
              ],
            },
          },
          {
            id: exportId,
            type: 'export',
            position: { x: 1020, y: 160 },
            data: {
              label: 'Exportar ventas',
              format: 'Excel',
              fileName: 'ventas_{{fechaInicio}}_{{fechaFin}}',
            },
          },
        ],
        edges: [
          { id: `e_${startId}_${varsId}`, source: startId, target: varsId },
          { id: `e_${varsId}_${queryId}`, source: varsId, target: queryId },
          { id: `e_${queryId}_${branchId}`, source: queryId, target: branchId },
          {
            id: `e_${branchId}_${exportId}`,
            source: branchId,
            target: exportId,
            sourceHandle: 'true',
          },
        ],
      };
    },
  },
  {
    id: 'foreach-batch-http',
    name: 'Iteración por lote (ForEach + HTTP)',
    category: 'Bucles',
    description: 'Recorre una lista de elementos con un bucle ForEach, consulta o procesa cada uno y consolida los resultados.',
    nodeBadges: ['Lista de datos', 'Para cada elemento', 'HTTP Request', 'Fin de bucle', 'Exportar'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      const listId = `datalist_${uuid().slice(0, 8)}`;
      const feId = `foreach_${uuid().slice(0, 8)}`;
      const httpId = `http_${uuid().slice(0, 8)}`;
      const feEndId = `foreachend_${uuid().slice(0, 8)}`;
      const exportId = `export_${uuid().slice(0, 8)}`;

      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 60, y: 200 },
            data: { label: 'Inicio' },
          },
          {
            id: listId,
            type: 'dataList',
            position: { x: 260, y: 200 },
            data: {
              label: 'Sucursales',
              items: JSON.stringify(
                [
                  { id: 1, codigo: 'SUC-01', ciudad: 'Bogotá' },
                  { id: 2, codigo: 'SUC-02', ciudad: 'Medellín' },
                  { id: 3, codigo: 'SUC-03', ciudad: 'Cali' },
                ],
                null,
                2
              ),
            },
          },
          {
            id: feId,
            type: 'forEach',
            position: { x: 480, y: 200 },
            data: {
              label: 'Por cada sucursal',
              iterateOver: `{{${listId}}}`,
            },
          },
          {
            id: httpId,
            type: 'httpRequest',
            position: { x: 700, y: 200 },
            data: {
              label: 'Consultar detalle',
              method: 'GET',
              endpoint: 'https://jsonplaceholder.typicode.com/todos/{{_item.id}}',
            },
          },
          {
            id: feEndId,
            type: 'forEachEnd',
            position: { x: 920, y: 200 },
            data: { label: 'Consolidar lote' },
          },
          {
            id: exportId,
            type: 'export',
            position: { x: 1140, y: 200 },
            data: {
              label: 'Exportar consolidado',
              format: 'Excel',
              fileName: 'consolidado_sucursales',
            },
          },
        ],
        edges: [
          { id: `e_${startId}_${listId}`, source: startId, target: listId },
          { id: `e_${listId}_${feId}`, source: listId, target: feId },
          { id: `e_${feId}_${httpId}`, source: feId, target: httpId },
          { id: `e_${httpId}_${feEndId}`, source: httpId, target: feEndId },
          { id: `e_${feEndId}_${exportId}`, source: feEndId, target: exportId },
        ],
      };
    },
  },
  {
    id: 'parallel-wait-pipeline',
    name: 'Ramas en paralelo con sincronización',
    category: 'Orquestación',
    description: 'Ejecuta dos orígenes en paralelo, espera a que ambos terminen con "Esperar nodo" y unifica en un reporte.',
    nodeBadges: ['HTTP Request', 'Lista de datos', 'Esperar nodo', 'Transformar', 'Exportar'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      const httpId = `http_${uuid().slice(0, 8)}`;
      const listId = `datalist_${uuid().slice(0, 8)}`;
      const waitId = `wait_${uuid().slice(0, 8)}`;
      const transformId = `transform_${uuid().slice(0, 8)}`;

      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 60, y: 220 },
            data: { label: 'Inicio' },
          },
          {
            id: httpId,
            type: 'httpRequest',
            position: { x: 300, y: 120 },
            data: {
              label: 'Fuente principal',
              method: 'GET',
              endpoint: 'https://jsonplaceholder.typicode.com/users',
            },
          },
          {
            id: listId,
            type: 'dataList',
            position: { x: 300, y: 310 },
            data: {
              label: 'Catálogo auxiliar',
              items: JSON.stringify(
                [
                  { id: 1, region: 'Norte' },
                  { id: 2, region: 'Centro' },
                  { id: 3, region: 'Sur' },
                ],
                null,
                2
              ),
            },
          },
          {
            id: waitId,
            type: 'waitFor',
            position: { x: 580, y: 120 },
            data: {
              label: 'Esperar catálogo',
              waitForNodeIds: [listId],
            },
          },
          {
            id: transformId,
            type: 'jsonTransform',
            position: { x: 840, y: 120 },
            data: {
              label: 'Cruzar datos',
              transformType: 'javascript',
              expression: `const usuarios = Array.isArray(data) ? data : (data?.data || []);\nconst catalogo = context['${listId}'] || [];\nreturn usuarios.slice(0, 5).map(u => ({\n  id: u.id,\n  nombre: u.name,\n  region: catalogo.find(c => c.id === u.id)?.region || 'General'\n}));`,
            },
          },
        ],
        edges: [
          { id: `e_${startId}_${httpId}`, source: startId, target: httpId },
          { id: `e_${startId}_${listId}`, source: startId, target: listId },
          { id: `e_${httpId}_${waitId}`, source: httpId, target: waitId },
          { id: `e_${waitId}_${transformId}`, source: waitId, target: transformId },
        ],
      };
    },
  },
  {
    id: 'subflow-orchestrator',
    name: 'Orquestador con subflujo',
    category: 'Modular',
    description: 'Prepara parámetros de entrada, invoca otro flujo mediante el nodo "Ejecutar flujo" y transforma su salida.',
    nodeBadges: ['Variables', 'Ejecutar flujo', 'Transformar'],
    buildDefinition: () => {
      const startId = `start_${uuid().slice(0, 8)}`;
      const varsId = `variables_${uuid().slice(0, 8)}`;
      const runFlowId = `runflow_${uuid().slice(0, 8)}`;
      const transformId = `transform_${uuid().slice(0, 8)}`;

      return {
        nodes: [
          {
            id: startId,
            type: 'start',
            position: { x: 60, y: 200 },
            data: { label: 'Inicio' },
          },
          {
            id: varsId,
            type: 'variables',
            position: { x: 280, y: 200 },
            data: {
              label: 'Variables entrada',
              variables: [
                {
                  key: 'ambiente',
                  type: 'string',
                  value: 'produccion',
                  description: 'Ambiente objetivo',
                  promptOnRun: true,
                },
                {
                  key: 'fechaProceso',
                  type: 'date',
                  value: '$today_ymd',
                  description: 'Fecha de proceso',
                  promptOnRun: true,
                },
              ],
            },
          },
          {
            id: runFlowId,
            type: 'runFlow',
            position: { x: 540, y: 200 },
            data: {
              label: 'Ejecutar subflujo',
              targetFlowId: '',
              targetFlowName: '',
              flowParams: [
                { key: 'ambiente', value: '{{ambiente}}' },
                { key: 'fechaProceso', value: '{{fechaProceso}}' },
              ],
            },
          },
          {
            id: transformId,
            type: 'jsonTransform',
            position: { x: 800, y: 200 },
            data: {
              label: 'Procesar respuesta',
              transformType: 'javascript',
              expression: `return {\n  subflujo: data?.flowName || '',\n  duracionMs: data?.durationMs || 0,\n  resultado: data?.data ?? data\n};`,
            },
          },
        ],
        edges: [
          { id: `e_${startId}_${varsId}`, source: startId, target: varsId },
          { id: `e_${varsId}_${runFlowId}`, source: varsId, target: runFlowId },
          { id: `e_${runFlowId}_${transformId}`, source: runFlowId, target: transformId },
        ],
      };
    },
  },
];

