/**
 * Crea (o actualiza) flujos de prueba para ejercitar el motor y el editor.
 * Funciona contra un servidor en marcha, así no pisa la BD que ese servidor tiene en memoria:
 *
 *   npm run seed:test --prefix backend            (usa http://localhost:3001)
 *   API_URL=http://localhost:3999 npm run seed:test --prefix backend
 *
 * Todos son offline: solo llaman al /api/health del propio servidor o a un puerto cerrado a propósito.
 */

const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PREFIX = 'Test';

type Node = { id: string; type: string; position: { x: number; y: number }; data: Record<string, any> };
type Edge = Record<string, any>;

const node = (id: string, type: string, x: number, y: number, data: Record<string, any>): Node =>
  ({ id, type, position: { x, y }, data });

const edge = (source: string, target: string, sourceHandle = 'right'): Edge => ({
  id: `${source}__${sourceHandle}__${target}`,
  source,
  sourceHandle,
  target,
  targetHandle: 'left',
  style: { stroke: '#22c55e', strokeWidth: 2 },
  markerEnd: { type: 'arrowclosed', color: '#3b82f6' },
});

const note = (id: string, x: number, y: number, text: string, color = 'amarillo') =>
  node(id, 'note', x, y, { label: 'Nota', text, color });

const transform = (id: string, x: number, y: number, label: string, expression: string, extra: Record<string, any> = {}) =>
  node(id, 'jsonTransform', x, y, { label, transformType: 'code', expression, ...extra });

interface TestFlow { name: string; description: string; nodes: Node[]; edges: Edge[] }

const flows: TestFlow[] = [];

// ── 1. If/Else ──────────────────────────────────────────────────────────────
flows.push({
  name: `${PREFIX} 1 - Bifurcación If/Else`,
  description: 'Condición doble (monto > 1000 Y región = Norte). Debe salir por "Sí"; la rama "No" se omite y el nodo final igualmente corre. Cambia monto a 500 para ver el otro camino.',
  nodes: [
    note('t1_note', 40, 20, 'Prueba: la bifurcación es transparente para los datos. El nodo "Resumen" recibe datos de UNA sola rama; se omite solo si ambas entradas vienen de ramas no tomadas.'),
    node('t1_start', 'start', 40, 220, { label: 'Inicio' }),
    node('t1_vars', 'variables', 260, 200, {
      label: 'Datos del pedido',
      variables: [
        { key: 'monto', type: 'number', value: 1500 },
        { key: 'region', type: 'string', value: 'Norte' },
        { key: 'cliente', type: 'string', value: 'ACME S.A.' },
      ],
    }),
    node('t1_branch', 'conditionalBranch', 500, 190, {
      label: '¿Pedido grande del Norte?',
      mode: 'if_else',
      combinator: 'and',
      conditions: [
        { id: '1', left: '{{t1_vars.monto}}', operator: 'gt', right: '1000' },
        { id: '2', left: '{{t1_vars.region}}', operator: 'equals', right: 'Norte' },
      ],
    }),
    transform('t1_big', 780, 90, 'Pedido grande', 'return { tipo: "GRANDE", descuento: 0.1, monto: {{t1_vars.monto}} };'),
    transform('t1_small', 780, 330, 'Pedido normal', 'return { tipo: "NORMAL", descuento: 0, monto: {{t1_vars.monto}} };'),
    transform('t1_sum', 1060, 210, 'Resumen', 'return { cliente: {{t1_vars.cliente}}, ...data, total: data.monto * (1 - data.descuento) };'),
  ],
  edges: [
    edge('t1_start', 't1_vars'),
    edge('t1_vars', 't1_branch'),
    edge('t1_branch', 't1_big', 'true'),
    edge('t1_branch', 't1_small', 'false'),
    edge('t1_big', 't1_sum'),
    edge('t1_small', 't1_sum'),
  ],
});

// ── 2. Switch dentro de ForEach ─────────────────────────────────────────────
flows.push({
  name: `${PREFIX} 2 - Switch dentro de ForEach`,
  description: 'Recorre 6 tickets y los enruta por prioridad con un Switch. El ticket 6 ("CRITICA") no coincide con ningún caso y sale por "Por defecto". Termina exportando un CSV.',
  nodes: [
    node('t2_start', 'start', 40, 200, { label: 'Inicio' }),
    node('t2_list', 'dataList', 250, 180, {
      label: 'Tickets',
      items: JSON.stringify([
        { id: 'T-1', asunto: 'Factura duplicada', prioridad: 'ALTA' },
        { id: 'T-2', asunto: 'Cambio de contraseña', prioridad: 'BAJA' },
        { id: 'T-3', asunto: 'Reporte lento', prioridad: 'MEDIA' },
        { id: 'T-4', asunto: 'Sistema caído', prioridad: 'ALTA' },
        { id: 'T-5', asunto: 'Duda de envío', prioridad: 'BAJA' },
        { id: 'T-6', asunto: 'Prioridad inventada', prioridad: 'CRITICA' },
      ], null, 2),
    }),
    node('t2_each', 'forEach', 470, 180, { label: 'Por cada ticket', iterateOver: '{{t2_list}}', itemAlias: 'ticket', concurrency: 1, batchSize: 1, maxIterations: 50 }),
    node('t2_switch', 'conditionalBranch', 700, 170, {
      label: 'Enrutar por prioridad',
      mode: 'switch',
      switchField: '{{ticket.prioridad}}',
      cases: [
        { id: '1', value: 'ALTA', label: 'Alta' },
        { id: '2', value: 'MEDIA', label: 'Media' },
        { id: '3', value: 'BAJA', label: 'Baja' },
      ],
    }),
    transform('t2_alta', 980, 0, 'Escalar', 'return { id: item.id, asunto: item.asunto, destino: "ESCALAR" };'),
    transform('t2_media', 980, 130, 'Cola normal', 'return { id: item.id, asunto: item.asunto, destino: "COLA" };'),
    transform('t2_baja', 980, 260, 'Informativo', 'return { id: item.id, asunto: item.asunto, destino: "INFO" };'),
    transform('t2_def', 980, 390, 'Sin clasificar', 'return { id: item.id, asunto: item.asunto, destino: "REVISAR" };'),
    node('t2_end', 'forEachEnd', 1230, 200, { label: 'Fin de bucle' }),
    node('t2_export', 'export', 1450, 200, { label: 'Exportar CSV', format: 'CSV', fileName: 'test_tickets_enrutados' }),
  ],
  edges: [
    edge('t2_start', 't2_list'),
    edge('t2_list', 't2_each'),
    edge('t2_each', 't2_switch'),
    edge('t2_switch', 't2_alta', 'case_1'),
    edge('t2_switch', 't2_media', 'case_2'),
    edge('t2_switch', 't2_baja', 'case_3'),
    edge('t2_switch', 't2_def', 'default'),
    edge('t2_alta', 't2_end'),
    edge('t2_media', 't2_end'),
    edge('t2_baja', 't2_end'),
    edge('t2_def', 't2_end'),
    edge('t2_end', 't2_export'),
  ],
});

// ── 3. Transformación y depuración JS ───────────────────────────────────────
flows.push({
  name: `${PREFIX} 3 - Transformación y depuración JS`,
  description: 'Transformación JavaScript con console.log/table/warn y breakpoints en las líneas 3 y 9, seguida de un mapeo de campos y exportación a Excel. Úsalo en modo debug y abre la pestaña "Paso a paso".',
  nodes: [
    note('t3_note', 40, 20, 'Ejecuta en modo debug: el nodo "Calcular totales" tiene breakpoints en las líneas 3 (una parada por venta) y 9. Cada console.* también cuenta como parada.', 'azul'),
    node('t3_start', 'start', 40, 220, { label: 'Inicio' }),
    node('t3_list', 'dataList', 250, 200, {
      label: 'Ventas',
      items: JSON.stringify([
        { producto: 'Teclado', unidades: 10, precio: 45, region: 'Norte' },
        { producto: 'Monitor', unidades: 3, precio: 320, region: 'Sur' },
        { producto: 'Mouse', unidades: 25, precio: 12, region: 'Norte' },
        { producto: 'Laptop', unidades: 2, precio: 980, region: 'Este' },
        { producto: 'Cable HDMI', unidades: 40, precio: 5, region: 'Sur' },
      ], null, 2),
    }),
    transform('t3_js', 480, 200, 'Calcular totales', [
      '// Total por venta y marca de alto valor',
      'const conTotal = data.map(v => {',
      '  const total = v.unidades * v.precio;',
      '  return { ...v, total, alto_valor: total >= 1000 };',
      '});',
      'console.log("Filas recibidas:", data.length);',
      'console.table(conTotal);',
      'const altas = conTotal.filter(v => v.alto_valor);',
      'console.warn("Ventas de alto valor:", altas.length);',
      'return conTotal;',
    ].join('\n'), { breakpoints: [3, 9] }),
    node('t3_map', 'jsonTransform', 720, 200, {
      label: 'Renombrar campos',
      transformType: 'map',
      keepOthers: false,
      mappings: [
        { from: 'producto', to: 'Producto' },
        { from: 'region', to: 'Región' },
        { from: 'total', to: 'Total' },
        { from: 'alto_valor', to: 'Alto valor' },
      ],
    }),
    node('t3_export', 'export', 960, 200, { label: 'Exportar Excel', format: 'Excel', fileName: 'test_ventas_calculadas' }),
  ],
  edges: [
    edge('t3_start', 't3_list'),
    edge('t3_list', 't3_js'),
    edge('t3_js', 't3_map'),
    edge('t3_map', 't3_export'),
  ],
});

// ── 4. Reintentos y continuar en error ──────────────────────────────────────
flows.push({
  name: `${PREFIX} 4 - Reintentos y continuar en error`,
  description: 'Una petición a un puerto cerrado (2 reintentos, backoff exponencial) con "continuar en error", en paralelo a una petición sana. Tras el fallo, la bifurcación detecta failed=true y toma el respaldo. El historial debe mostrar el nodo en ámbar.',
  nodes: [
    node('t4_start', 'start', 40, 200, { label: 'Inicio' }),
    node('t4_fail', 'httpRequest', 270, 80, {
      label: 'API caída (puerto cerrado)',
      endpoint: 'http://127.0.0.1:9/no-existe',
      method: 'GET',
      timeout: 2,
      retryCount: 2,
      retryDelayMs: 300,
      retryBackoff: 'exponential',
      onError: 'continue',
    }),
    node('t4_ok', 'httpRequest', 270, 330, { label: 'Health del servidor', endpoint: `${API_URL}/api/health`, method: 'GET', timeout: 5 }),
    node('t4_branch', 'conditionalBranch', 540, 70, {
      label: '¿Falló la API?',
      mode: 'if_else',
      conditions: [{ id: '1', left: '{{t4_fail.failed}}', operator: 'is_true', right: '' }],
    }),
    transform('t4_fallback', 820, 20, 'Datos de respaldo', 'return { fuente: "respaldo", motivo: {{t4_fail.error}} };'),
    transform('t4_normal', 820, 170, 'Datos reales', 'return { fuente: "api" };'),
    transform('t4_sum', 1100, 190, 'Resumen', 'return { mensaje: "El flujo terminó pese al fallo", ...data };'),
  ],
  edges: [
    edge('t4_start', 't4_fail'),
    edge('t4_start', 't4_ok'),
    edge('t4_fail', 't4_branch'),
    edge('t4_branch', 't4_fallback', 'true'),
    edge('t4_branch', 't4_normal', 'false'),
    edge('t4_fallback', 't4_sum'),
    edge('t4_normal', 't4_sum'),
    edge('t4_ok', 't4_sum'),
  ],
});

// ── 5. Fallo que detiene el flujo ───────────────────────────────────────────
flows.push({
  name: `${PREFIX} 5 - Fallo con reintentos (se detiene)`,
  description: 'Igual que el 4 pero con "detener flujo": tras 3 intentos la ejecución termina en error y el nodo siguiente no corre. Para ver el error en el historial y en el canvas.',
  nodes: [
    node('t5_start', 'start', 40, 160, { label: 'Inicio' }),
    node('t5_fail', 'httpRequest', 270, 140, {
      label: 'API caída',
      endpoint: 'http://127.0.0.1:9/no-existe',
      method: 'GET',
      timeout: 2,
      retryCount: 2,
      retryDelayMs: 500,
      retryBackoff: 'fixed',
      onError: 'stop',
    }),
    transform('t5_after', 540, 140, 'No debería ejecutarse', 'return { llegue: true };'),
  ],
  edges: [edge('t5_start', 't5_fail'), edge('t5_fail', 't5_after')],
});

// ── 6. Variables, HTTP local y temporizador ─────────────────────────────────
flows.push({
  name: `${PREFIX} 6 - Variables, HTTP local y Timer`,
  description: 'Variables con presets de fecha, una petición al /api/health del propio servidor con variables en los parámetros, una espera de 2 s y un mapeo del resultado.',
  nodes: [
    node('t6_start', 'start', 40, 180, { label: 'Inicio' }),
    node('t6_vars', 'variables', 250, 160, {
      label: 'Variables',
      variables: [
        { key: 'hoy', type: 'date', value: '$today_iso' },
        { key: 'ayer', type: 'date', value: '$yesterday_iso' },
        { key: 'ambiente', type: 'string', value: 'pruebas' },
        { key: 'umbral', type: 'number', value: 7 },
        { key: 'activo', type: 'boolean', value: true },
        { key: 'config', type: 'json', value: '{"reintentos": 3, "tags": ["a", "b"]}' },
      ],
    }),
    node('t6_http', 'httpRequest', 480, 160, {
      label: 'Health con parámetros',
      endpoint: `${API_URL}/api/health`,
      method: 'GET',
      params: JSON.stringify({ fecha: '{{t6_vars.hoy}}', env: '{{t6_vars.ambiente}}' }, null, 2),
      timeout: 5,
    }),
    node('t6_timer', 'timer', 710, 160, { label: 'Esperar 2 s', duration: 2, unit: 'seconds' }),
    transform('t6_out', 930, 160, 'Armar salida', 'return { fecha: {{t6_vars.hoy}}, ayer: {{t6_vars.ayer}}, ambiente: {{t6_vars.ambiente}}, reintentos: {{t6_vars.config.reintentos}}, respuesta: data };'),
  ],
  edges: [
    edge('t6_start', 't6_vars'),
    edge('t6_vars', 't6_http'),
    edge('t6_http', 't6_timer'),
    edge('t6_timer', 't6_out'),
  ],
});

// ── 7. Errores de validación a propósito ────────────────────────────────────
flows.push({
  name: `${PREFIX} 7 - Validación (errores a propósito)`,
  description: 'NO está pensado para ejecutarse bien: contiene configuraciones inválidas para probar el panel de validación previa, la búsqueda Ctrl+K, notas, copiar/pegar y undo/redo.',
  nodes: [
    note('t7_note', 40, 20, 'Aquí deben aparecer errores y avisos: URL vacía, lista inválida, Switch sin campo, bucle sin "Fin de bucle", referencia a un nodo inexistente y un nodo suelto.', 'rojo'),
    node('t7_start', 'start', 40, 240, { label: 'Inicio' }),
    node('t7_http', 'httpRequest', 250, 220, { label: 'HTTP sin URL', endpoint: '', method: 'GET' }),
    node('t7_list', 'dataList', 480, 220, { label: 'Lista rota', items: '[{"id": 1,' }),
    node('t7_switch', 'conditionalBranch', 710, 210, {
      label: 'Switch sin campo',
      mode: 'switch',
      switchField: '',
      cases: [{ id: '1', value: 'A', label: 'A' }, { id: '2', value: 'B', label: 'B' }],
    }),
    node('t7_each', 'forEach', 950, 100, { label: 'Bucle sin fin', iterateOver: '{{t7_list}}', itemAlias: 'x' }),
    transform('t7_ref', 1190, 100, 'Referencia rota', 'return {{node_que_no_existe.campo}};'),
    node('t7_lonely', 'timer', 710, 420, { label: 'Nodo suelto', duration: 1, unit: 'seconds' }),
  ],
  edges: [
    edge('t7_start', 't7_http'),
    edge('t7_http', 't7_list'),
    edge('t7_list', 't7_switch'),
    edge('t7_switch', 't7_each', 'case_1'),
    edge('t7_each', 't7_ref'),
  ],
});

// ────────────────────────────────────────────────────────────────────────────

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  const existing: Array<{ id: string; name: string }> = (await api('/api/flows')).data;
  for (const flow of flows) {
    const body = {
      name: flow.name,
      description: flow.description,
      definition: JSON.stringify({ nodes: flow.nodes, edges: flow.edges }),
    };
    const found = existing.find(f => f.name === flow.name);
    if (found) {
      await api(`/api/flows/${found.id}`, { method: 'PUT', body: JSON.stringify(body) });
      console.log(`Actualizado: ${flow.name}`);
    } else {
      await api('/api/flows', { method: 'POST', body: JSON.stringify(body) });
      console.log(`Creado:      ${flow.name}`);
    }
  }
}

main().catch(err => {
  console.error(`No se pudo sembrar en ${API_URL}:`, err.message);
  process.exit(1);
});
