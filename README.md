# OrquestaFlow

OrquestaFlow es una plataforma visual integral para el diseno, ejecucion y orquestacion de flujos de trabajo (pipelines) de datos. Permite conectar nodos de manera interactiva en un lienzo drag-and-drop para ingerir datos de APIs y bases de datos, transformarlos mediante scripts o bifurcaciones condicionales, iterar registros y exportar resultados estructurados.

---

## Funcionalidades Principales

### 1. Lienzo Interactivo y Catalogo de Nodos
Disena pipelines complejos uniendo bloques con dependencias calculadas automaticamente mediante un grafo dirigido (DAG):
- **Entrada y Disparadores:**
  - **Inicio (Start):** Punto de entrada estandar del flujo.
  - **Webhook Trigger:** Recepcion de eventos HTTP externos con token de autenticacion y esquema esperado.
  - **Temporizador (Timer):** Ejecucion con retardos o activaciones basadas en tiempo.
- **Consultas y Origenes de Datos:**
  - **Consulta SQL (Query):** Ejecucion contra SQL Server y SQLite local con deteccion de parametros dinamicos (`#param_nombre`), cancelacion en base de datos y formateador de sintaxis.
  - **Fuente de Datos (Data Source):** Unificador de multiples fuentes con combinaciones e inspeccion previa.
  - **Lista de Datos (Data List):** Carga y definicion de estructuras de datos estaticas o tabulares.
- **Red e Integraciones:**
  - **HTTP Request Unificado:** Peticiones GET, POST, PUT, DELETE, PATCH con autenticacion (Bearer, Basic, API Key), cabeceras personalizadas, parametros de consulta, politicas de reintento y extraccion de rutas JSON.
  - **OAuth2 Connector:** Flujos de autorizacion con intercambio de tokens, refresco y scopes configurables.
  - **Web Scraping:** Extraccion de contenido HTML y datos web sin requerir servicios externos pesados.
- **Logica, Bucles y Control de Flujo:**
  - **Bifurcacion Condicional (Conditional Branch):** Reglas logicas (AND/OR, comparadores numericos, texto y existencia) para enrutar los datos por caminos especificos.
  - **Bucles For Each y For Each End:** Iteracion de listas elemento por elemento con variables de contexto contextuales (`item`, `index`, `total`).
- **Transformacion e Inteligencia Artificial:**
  - **Transformacion JSON (JSON Transform):** Editor de scripts JavaScript con CodeMirror, templates rapidos, selector de variables y tiempo de ejecucion acotado (5 segundos).
  - **AI Chat Completion:** Integracion con modelos de lenguaje para enriquecimiento, clasificacion o generacion de contenido basado en prompts dinamicos.
- **Salida y Exportacion:**
  - **Exportacion a Excel (.xlsx):** Generacion de libros multi-hoja, mapeo y renombre de columnas, combinacion de tablas y estilos.
  - **Exportacion a CSV:** Salida plana para interoperabilidad con sistemas externos.

### 2. Panel de Propiedades e Inspectores Redisenados
- **Diseno Modular y Tokenizado:** Interfaz con pestanas de navegacion (Configuracion, Datos, Mapeo, Filtros) y esquema de colores estandarizado.
- **Mapeo Asistido de Datos:** Selectores visuales para vincular propiedades entre nodos aguas arriba (`MapSourceButton`, `NodeSourcePicker`, `JsonSelectorModal`).
- **Editor de Codigo Integrado:** Soporte para resaltado de sintaxis, variables insertables y validacion de esquemas en tiempo real.

### 3. Modo Depuracion (Debug Mode)
- **Ejecucion Paso a Paso:** Capacidad de pausar la ejecucion entre nodos, inspeccionar cargas utiles de entrada y salida, y controlar el flujo nodo por nodo.
- **Preflight de Peticiones:** Revision previa de parametros y URLs calculadas antes del disparo real hacia endpoints externos.
- **Visor de Contexto:** Monitoreo en vivo del estado y memoria de cada paso a traves de WebSockets.

### 4. Portabilidad y Versionamiento
- **Exportacion a Python:** Convierte cualquier flujo en un script Python ejecutable autonomo, o empaquetalo como archivo ZIP listo para produccion con entorno y dependencias (`requirements.txt`).
- **Importacion / Exportacion JSON:** Comparte o respalda definiciones completas de flujos, incluyendo consultas y conexiones asociadas.
- **Historial de Versiones:** Registro y recuperacion de versiones previas de cada flujo de trabajo.

### 5. Gestion Centralizada de Conexiones
- Administracion de credenciales para Microsoft SQL Server y SQLite local (motor WASM pure-JS via sql.js).
- Clasificacion de conexiones por apodo, grupo y region para evitar credenciales redundantes en cada flujo.

### 6. Programador de Tareas (Scheduler)
- Automatizacion de ejecuciones en segundo plano con expresiones Cron estándar.
- Registro detallado de duracion, cantidad de registros procesados y estado (completado, fallido, cancelado).

---

## Arquitectura y Tecnologias

### Frontend
- **Framework:** React 19 con TypeScript
- **Empaquetador y Servidor:** Vite
- **Lienzo de Nodos:** @xyflow/react (React Flow)
- **Estado Global:** Redux Toolkit
- **Estilos:** TailwindCSS con sistema de tokens semanticos
- **Componentes Base:** Radix UI primitives, Lucide Icons
- **Editores de Codigo:** CodeMirror, sql-formatter

### Backend
- **Servidor y API:** Fastify 5
- **Tiempo Real:** Socket.io
- **Base de Datos Local:** sql.js (SQLite basado en WebAssembly)
- **Conectores:** mssql (SQL Server), alasql
- **Archivos y Reportes:** ExcelJS, JSZip
- **Automatizacion:** node-cron, cron-parser

---

## Requisitos Previos

- **Node.js:** version 20 o superior (probado en Node.js v24).
- **npm:** version 10 o superior.

---

## Instalacion y Ejecucion

### 1. Clonar el repositorio
```bash
git clone https://github.com/Jose-Fernandez-12/OrquestaFlow.git
cd OrquestaFlow
```

### 2. Instalar dependencias
Para instalar las dependencias de la raiz, backend y frontend en un solo paso:
```bash
npm run install:all
```

O de forma manual:
```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

### 3. Iniciar el entorno de desarrollo
Ejecuta ambos servicios en paralelo desde la raiz:
```bash
npm run dev
```

El proyecto estara disponible en:
- **Frontend (Aplicacion Web):** [http://localhost:5173](http://localhost:5173)
- **Backend (API Fastify):** [http://localhost:3001](http://localhost:3001) (Health check: `/api/health`)

---

## Estructura del Proyecto

```text
orquestaFlow/
├── backend/
│   ├── src/
│   │   ├── db/          # Base de datos sql.js, esquemas y migraciones
│   │   ├── engine/      # Motor DAG, ejecutor de nodos, transpilador Python y scheduler
│   │   ├── routes/      # Endpoints REST (flows, queries, connections, export, etc.)
│   │   └── server.ts    # Servidor Fastify y WebSockets
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # Lienzo, nodos, inspectores modulares y dialogos
│   │   ├── lib/         # Utilidades de red, exportacion e importacion
│   │   ├── store/       # Slices de Redux (flows, queries, connections, ui, etc.)
│   │   └── App.tsx      # Enrutamiento y vistas principales
│   └── package.json
└── package.json         # Scripts de orquestacion local y devDependencies
```