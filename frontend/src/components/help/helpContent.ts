// Contents of the help center. Kept apart from the modal so the texts are easy to update with the app.
import {
  Play,
  SlidersHorizontal,
  Globe,
  FileSpreadsheet,
  Database,
  Code,
  List,
  GitFork,
  Braces,
  Repeat,
  Square,
  Clock,
  FileOutput,
  StickyNote,
  Radio,
  KeyRound,
  Bot,
  type LucideIcon,
} from 'lucide-react';

export interface HelpNode {
  icon: LucideIcon;
  color: string;
  name: string;
  desc: string;
}

export interface HelpGroup {
  title: string;
  note?: string;
  nodes: HelpNode[];
}

export const NODE_GROUPS: HelpGroup[] = [
  {
    title: 'Entrada y datos',
    nodes: [
      { icon: Play, color: 'text-emerald-600', name: 'Inicio de flujo', desc: 'Punto de partida. Los nodos sin entradas también arrancan en paralelo.' },
      { icon: SlidersHorizontal, color: 'text-violet-600', name: 'Variables', desc: 'Valores reutilizables. Se editan en tabla o en JSON (son los mismos datos) y aceptan fechas dinámicas como $today_ymd.' },
      { icon: Globe, color: 'text-blue-600', name: 'HTTP Request', desc: 'Llama a una API (GET, POST, PUT…). Parámetros, encabezados, Bearer o Basic. En modo iteración envía una petición por elemento y siempre devuelve una lista de respuestas.' },
      { icon: Database, color: 'text-amber-600', name: 'Consulta DB', desc: 'Ejecuta una consulta guardada con parámetros #param_nombre, cuyos valores salen de otros nodos.' },
      { icon: FileSpreadsheet, color: 'text-green-600', name: 'Obtener datos', desc: 'Carga un Excel o CSV, o combina los datos de varios nodos.' },
      { icon: List, color: 'text-slate-600', name: 'Lista de datos', desc: 'Una lista JSON fija, útil para pruebas o catálogos pequeños.' },
      { icon: Code, color: 'text-cyan-600', name: 'Web Scraping', desc: 'Ejecuta un script de extracción (Python) sobre una página.' },
    ],
  },
  {
    title: 'Lógica y transformación',
    nodes: [
      { icon: Braces, color: 'text-teal-600', name: 'Transformar datos', desc: 'Mapea campos o ejecuta JavaScript sobre los datos de entrada (data). Admite console.log, console.table y breakpoints.' },
      { icon: GitFork, color: 'text-orange-600', name: 'Bifurcación', desc: 'Sí/No o Switch según reglas. Solo continúa la rama elegida; las demás quedan omitidas.' },
      { icon: Repeat, color: 'text-rose-600', name: 'Para cada elemento', desc: 'Recorre una lista y ejecuta los nodos hasta "Fin de bucle" una vez por elemento ({{_item}}).' },
      { icon: Square, color: 'text-rose-500', name: 'Fin de bucle', desc: 'Cierra el bucle y junta los resultados de todas las vueltas en una lista.' },
      { icon: Clock, color: 'text-indigo-600', name: 'Temporizador', desc: 'Espera un tiempo antes de seguir (por ejemplo, para respetar límites de una API). Deja pasar los datos que recibe.' },
    ],
  },
  {
    title: 'Salida y documentación',
    nodes: [
      { icon: FileOutput, color: 'text-purple-600', name: 'Exportar CSV/Excel', desc: 'Genera el archivo. En "Múltiples pestañas" cada nodo conectado es una pestaña con su nombre (puedes cambiarlo); una pestaña sin datos muestra "Sin registros".' },
      { icon: StickyNote, color: 'text-yellow-600', name: 'Nota', desc: 'Texto para explicar el flujo en el lienzo. No se ejecuta.' },
    ],
  },
  {
    title: 'Experimentales',
    note: 'Se activan en Configuración → Experimental.',
    nodes: [
      { icon: Radio, color: 'text-pink-600', name: 'Webhook Trigger', desc: 'Inicia el flujo al recibir un POST en su URL, validado con HMAC o Bearer.' },
      { icon: KeyRound, color: 'text-indigo-600', name: 'Conector OAuth2', desc: 'Obtiene y reutiliza tokens (client credentials, password o refresh token).' },
      { icon: Bot, color: 'text-fuchsia-600', name: 'IA / Chat LLM', desc: 'Envía prompts con datos del flujo a una API compatible con OpenAI.' },
    ],
  },
];

export interface SyntaxItem {
  code: string;
  tag: string;
  desc: string;
  example?: string;
}

export const SYNTAX_ITEMS: SyntaxItem[] = [
  {
    code: '{{Nombre del nodo.campo}}',
    tag: 'Datos de otro nodo',
    desc: 'Lee el resultado de un nodo anterior por su nombre o por su ID (botón de ID en el panel del nodo). Las listas se recorren con [0], [1]…',
    example: '{{Logearse.data.token}}   ·   {{2af12582-….data.token}}',
  },
  {
    code: '{{Transformar._data}}',
    tag: 'Transformar datos',
    desc: 'Si el código usa console.log, el resultado queda en _data y los mensajes en _logs. Sin console.log el resultado se usa directo.',
  },
  {
    code: '{{_item}}  ·  {{_item.campo}}',
    tag: 'Elemento actual',
    desc: 'En un bucle o en un nodo HTTP en modo iteración: el elemento que se está procesando. {{_item}} solo, envía el elemento completo (por ejemplo, como body).',
    example: '{"idEds": "{{_item.idcentronegocio}}"}',
  },
  {
    code: '{{_index}}  ·  {{_total}}',
    tag: 'Posición en el bucle',
    desc: 'Dentro de "Para cada elemento": número del elemento actual (desde 0) y cantidad total. No existen en el modo iteración del nodo HTTP.',
  },
  {
    code: '#param_nombre',
    tag: 'Consultas SQL',
    desc: "Parámetro seguro de la consulta; su valor se asigna en el nodo Consulta DB. Una lista se expande a 'a', 'b'… para usar con IN, y '%#param_x%' sirve para LIKE.",
    example: 'SELECT * FROM Ventas WHERE IdEds = #param_eds AND Fecha >= #param_desde',
  },
  {
    code: '$today_ymd  ·  $today_iso  ·  $yesterday_ymd  ·  $month_start',
    tag: 'Fechas en Variables',
    desc: 'Se reemplazan al ejecutar por la fecha del día (20260930 / 2026-09-30), la de ayer o el primer día del mes. También $now_iso y $timestamp.',
  },
  {
    code: 'env:NOMBRE_VARIABLE',
    tag: 'Secretos',
    desc: 'En los nodos OAuth2 e IA, lee el valor desde backend/.env en vez de escribirlo en el flujo.',
  },
];

export interface GuideItem {
  title: string;
  text: string;
}

export const DEBUG_GUIDE: GuideItem[] = [
  {
    title: 'Debug: paso a paso',
    text: 'El botón "Debug" ejecuta el flujo pausando antes de cada nodo y de cada petición HTTP. "Siguiente paso" avanza uno; "Continuar todo" sigue sin pausas; "Inspeccionar" abre el detalle del nodo en pausa.',
  },
  {
    title: 'Ver cómo se arma una petición o consulta',
    text: 'Al inspeccionar un nodo HTTP verás la URL, los encabezados, los parámetros y el cuerpo ya resueltos, y la tabla "Referencias resueltas" con cada {{referencia}} y su valor (en rojo las que no existen). En una Consulta DB, la pestaña "Consulta SQL" muestra cada #param_ con su origen y valor, y el SQL con los valores puestos.',
  },
  {
    title: 'Breakpoints en Transformar datos',
    text: 'Haz clic junto al número de línea del editor de código para marcar un breakpoint. En Debug, la pestaña "Paso a paso" recorre los breakpoints y los console.log mostrando las variables en cada punto.',
  },
  {
    title: 'Probar sin ejecutar todo el flujo',
    text: '"Probar nodo" ejecuta solo ese nodo; "Desde aquí" ejecuta el nodo y todo lo que sigue; seleccionando varios nodos (Ctrl+clic o Shift+arrastrar) aparecen "Ejecutar selección" y "Depurar selección". Los nodos que no se ejecutan aportan los resultados de la última ejecución.',
  },
  {
    title: 'Si falta un resultado anterior',
    text: 'Si un nodo anterior nunca se ejecutó, la prueba avisa cuál falta y lo señala en el lienzo. Ejecuta el flujo completo una vez (aunque falle a mitad, se guarda lo que alcanzó a terminar).',
  },
];

export const TIPS: GuideItem[] = [
  {
    title: 'Reintentos y errores por nodo',
    text: 'En "Reintentos y errores" de cada nodo defines cuántas veces reintentar, la espera entre intentos y qué hacer si falla: detener el flujo o continuar registrando el error. Los nodos HTTP sin configuración usan los reintentos globales de Configuración.',
  },
  {
    title: 'Credenciales de base de datos',
    text: 'Cada conexión usa el usuario y la contraseña guardados en ella o los de backend/.env (SQLSERVER_USER / SQLSERVER_PASSWORD, o la clave de la conexión). En Configuración → Conexiones y datos ves de dónde las toma cada una.',
  },
  {
    title: 'Exportar e importar flujos',
    text: 'Exportar JSON incluye el flujo, sus consultas y sus conexiones, con las peticiones tal cual. Las credenciales de base de datos nunca se exportan: al importar, configúralas en Conexiones o en backend/.env antes de ejecutar.',
  },
  {
    title: 'Versiones del flujo',
    text: 'Cada guardado crea una versión (las seguidas en pocos minutos se agrupan). Desde "Versiones del flujo" puedes ver y restaurar una anterior; restaurar también guarda el estado actual.',
  },
  {
    title: 'Un editor abierto guarda lo que tiene cargado',
    text: 'Guardar o ejecutar desde el editor guarda la versión que tiene en pantalla. Si el flujo se cambió en otro lado, recarga la página antes de seguir para no sobrescribirlo.',
  },
  {
    title: 'Tiempos de espera',
    text: 'Ajusta en Configuración los límites de peticiones HTTP, conexión y consultas SQL, y scripts, para que un servicio caído no deje un flujo esperando indefinidamente.',
  },
];
