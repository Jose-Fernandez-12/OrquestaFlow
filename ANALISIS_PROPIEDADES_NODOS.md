# Análisis y Mejora Visual del Panel de Propiedades de Nodos

**Fecha**: 24 de Septiembre, 2026  
**Rama**: `feature/properties-visual-improvements`  
**Base**: `feature/advanced-nodes-catalog`

---

## 📋 Índice

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Análisis del Estado Actual](#análisis-del-estado-actual)
3. [Propuestas de Mejora](#propuestas-de-mejora)
4. [Plan de Implementación](#plan-de-implementación)
5. [Validación de Propiedades por Tipo de Nodo](#validación-de-propiedades-por-tipo-de-nodo)

---

## 🎯 Resumen Ejecutivo

El panel de propiedades (Inspector de Nodos) es el componente principal para configurar y visualizar las propiedades de cada nodo en el flujo. Este documento analiza el diseño visual actual y propone mejoras específicas para optimizar la experiencia de usuario, la jerarquía visual y la consistencia del sistema.

### Objetivos de la Mejora

- **Mejorar la jerarquía visual**: Hacer más clara la distinción entre secciones, campos y acciones
- **Optimizar el espaciado**: Reducir la densidad visual sin sacrificar funcionalidad
- **Refinamiento de componentes**: Mejorar inputs, selects, botones y tabs
- **Consistencia visual**: Unificar el lenguaje de diseño en todos los inspectores
- **Mejor feedback visual**: Estados hover, focus, disabled más claros

---

## 🔍 Análisis del Estado Actual

### 1. Estructura del Inspector

#### Componentes Principales

```
NodeInspector (Contenedor Principal)
├── Resize Handle (Ajuste de ancho)
├── InspectorHeader (Encabezado)
│   ├── Icono + Badge de tipo
│   ├── Label editable
│   └── Indicadores de estado (ejecutando, completado, error, pausado)
├── Action Bar (Barra de acciones)
│   ├── Botón "Variables disponibles"
│   └── Badge "En bucle" (si aplica)
├── VariableDrawer (Panel de variables - condicional)
├── Debug Controls (Controles de debug - condicional)
├── Loop Quick-Access Bar (Acceso rápido a bucles - condicional)
└── Inspector Específico por Tipo
    ├── InspectorTabs (Pestañas de navegación)
    └── Contenido del Inspector
        ├── Campos de formulario
        ├── Editores especializados
        └── Botón Eliminar Nodo
```

#### Inspectores Específicos Implementados

1. **StartInspector** - Nodo de inicio
2. **HttpInspector** - Peticiones HTTP (GET, POST, etc.)
3. **ScrapingInspector** - Web scraping
4. **QueryInspector** - Consultas SQL
5. **ExportInspector** - Exportación de datos
6. **TimerInspector** - Temporizadores y delays
7. **DataSourceInspector** - Fuentes de datos
8. **DataListInspector** - Listas de datos
9. **VariablesInspector** - Variables
10. **ForEachInspector** - Bucles forEach
11. **ForEachEndInspector** - Fin de bucle
12. **ConditionalBranchInspector** - Ramas condicionales
13. **JsonTransformInspector** - Transformaciones JSON
14. **WebhookTriggerInspector** - Webhooks (experimental)
15. **OAuth2ConnectorInspector** - OAuth2 (experimental)
16. **AiChatCompletionInspector** - Chat IA (experimental)

### 2. Sistema de Diseño Actual

#### Tokens de Color (CSS Custom Properties)

```css
--bg: #fafafa           /* Fondo principal */
--surface: #ffffff      /* Superficies (tarjetas, paneles) */
--fg: #111111          /* Texto principal */
--muted: #6b6b6b       /* Texto secundario */
--border: #e5e5e5      /* Bordes */
--accent: #2f6feb      /* Color de acento (azul) */
--success: #17a34a     /* Verde (éxito) */
--warn: #eab308        /* Amarillo (advertencia) */
--danger: #dc2626      /* Rojo (peligro) */
```

#### Tipografía

- **Font Family**: Inter (display + body)
- **Tamaños**: 10px, 11px, 12px, 13px, 14px (base), 18px
- **Weights**: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)

#### Espaciado

- **Panel width**: 360px (mín) - 420px (default) - 720px (máx)
- **Padding interno**: 16px (p-4)
- **Gap entre elementos**: 16px (gap-4)

### 3. Fortalezas del Diseño Actual

✅ **Panel redimensionable**: Excelente UX, permite ajustar según necesidad  
✅ **Sistema de tabs**: Organización clara de secciones complejas  
✅ **Variables drawer**: Acceso rápido a variables disponibles  
✅ **Indicadores de estado**: Feedback visual claro durante ejecución  
✅ **Loop context**: Información contextual cuando está dentro de bucle  
✅ **Editores especializados**: KeyValueEditor, JsonSelector, etc.  
✅ **Design tokens**: Sistema de colores bien definido  

### 4. Áreas de Mejora Identificadas

#### 4.1. Jerarquía Visual

**Problema**: Algunos elementos tienen pesos visuales similares, dificultando la distinción entre secciones principales y secundarias.

**Observaciones**:
- Los tabs tienen un estilo funcional pero podrían ser más distintivos
- Los campos de formulario carecen de suficiente separación visual
- Las secciones no siempre tienen una clara delimitación

#### 4.2. Densidad de Información

**Problema**: En inspectores complejos (HttpInspector, QueryInspector) hay mucha información en poco espacio.

**Observaciones**:
- Espaciado vertical a veces insuficiente entre grupos de campos
- Labels y inputs muy próximos entre sí
- Badges y pills podrían tener mejor jerarquía

#### 4.3. Componentes de Formulario

**Problema**: Los inputs, selects y textareas necesitan refinamiento visual.

**Observaciones**:
- Estados focus podrían ser más pronunciados
- Hover states en algunos elementos no son lo suficientemente evidentes
- Los selects nativos tienen estilos inconsistentes entre navegadores

#### 4.4. Sistema de Tabs

**Problema**: Las tabs funcionan pero podrían ser más modernas y accesibles.

**Observaciones**:
- El indicador de tab activa podría ser más visible
- Los badges de conteo son funcionales pero podrían ser más elegantes
- El espaciado horizontal podría optimizarse

#### 4.5. Botones y Acciones

**Problema**: Algunos botones tienen estilos inconsistentes.

**Observaciones**:
- El botón "Variables disponibles" tiene buen diseño
- El botón "Eliminar Nodo" podría tener más peso visual como acción destructiva
- Los botones de acción rápida (copy, etc.) podrían ser más sutiles

#### 4.6. Paleta de Colores para Estados

**Problema**: Los colores de estado (ejecutando, completado, error) son claros pero podrían refinarse.

**Observaciones**:
- El azul de "ejecutando" es muy similar al accent
- Los fondos de los badges podrían tener más contraste
- El "En bucle" badge (sky-500) introduce un nuevo color no tokenizado

---

## 💡 Propuestas de Mejora

### 1. Refinamiento del Sistema de Tokens

#### 1.1. Expandir Paleta de Grises

```css
/* Agregamos niveles intermedios para mejor jerarquía */
--fg: #111111;           /* Texto principal - sin cambios */
--fg-secondary: #3d3d3d; /* NUEVO: Texto secundario importante */
--muted: #6b6b6b;        /* Texto terciario - sin cambios */
--muted-light: #9ca3af;  /* NUEVO: Texto muy sutil, placeholders */
```

#### 1.2. Mejorar Tokens de Bordes

```css
--border: #e5e5e5;          /* Borde estándar - sin cambios */
--border-light: #f0f0f0;    /* NUEVO: Borde muy sutil (separadores internos) */
--border-focus: #2f6feb;    /* NUEVO: Borde en estado focus */
--border-hover: #d1d5db;    /* NUEVO: Borde en estado hover */
```

#### 1.3. Tokenizar Colores de Estado

```css
/* Estados de nodo */
--state-executing: #3b82f6;     /* Azul más distintivo que accent */
--state-executing-bg: #dbeafe;  /* Fondo azul claro */
--state-paused: #f59e0b;        /* Amber/Naranja */
--state-paused-bg: #fef3c7;     /* Fondo amber claro */
--state-completed: #17a34a;     /* Verde - reutiliza success */
--state-error: #dc2626;         /* Rojo - reutiliza danger */

/* Contexto de bucle */
--loop-accent: #0ea5e9;         /* Sky/Cyan para contexto de bucle */
--loop-accent-bg: #e0f2fe;      /* Fondo cyan claro */
```

#### 1.4. Refinar Sombras

```css
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-focus: 0 0 0 3px color-mix(in oklab, var(--accent), transparent 70%);
```

### 2. Mejoras en InspectorHeader

#### Propuestas

1. **Aumentar padding vertical** de `p-4` (16px) a `p-5` (20px) para darle más "respiración"
2. **Mejorar el badge de tipo** con un diseño más compacto y elegante
3. **Separar visualmente** el icono del label con un gap mayor
4. **Refinar estados de ejecución** con colores tokenizados

#### Código Sugerido

```tsx
// En InspectorHeader.tsx
<div className="p-5 border-b border-border flex flex-col gap-3 bg-gradient-to-b from-surface to-bg/20">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      {/* Icono con mejor elevación */}
      <div className={cn(
        'p-2.5 rounded-lg shrink-0 shadow-sm',
        bgClass, colorClass
      )}>
        <Icon size={18} />
      </div>
      
      <div className="flex flex-col min-w-0 gap-0.5">
        {/* Badge de tipo más compacto */}
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
          {typeLabel}
        </span>
        {/* Label con mejor tipografía */}
        <h3 className="text-sm font-semibold text-fg leading-tight">
          {(node.data?.label as string) || 'Sin nombre'}
        </h3>
      </div>
    </div>
    {/* ... estados */}
  </div>
</div>
```

### 3. Mejoras en InspectorTabs

#### Propuestas

1. **Tab activa más visible** con indicador inferior más grueso
2. **Mejor hover state** con transición suave
3. **Badges más elegantes** con mejor contraste
4. **Iconos con mejor alineación**

#### Código Sugerido

```tsx
// En InspectorTabs.tsx
<button
  className={cn(
    'relative flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all whitespace-nowrap',
    'rounded-t-lg border-b-2',
    isActive
      ? 'text-accent bg-surface border-accent shadow-sm -mb-px z-10'
      : 'text-muted hover:text-fg hover:bg-bg/50 border-transparent hover:border-border'
  )}
>
  {Icon && <Icon size={14} strokeWidth={2.5} className={isActive ? 'text-accent' : 'text-current'} />}
  <span className="font-medium">{tab.label}</span>
  
  {/* Badge mejorado */}
  {tab.badge !== undefined && tab.badge > 0 && (
    <span className={cn(
      'px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none',
      isActive
        ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
        : 'bg-muted/10 text-muted'
    )}>
      {tab.badge}
    </span>
  )}
</button>
```

### 4. Mejoras en Campos de Formulario

#### 4.1. Labels Mejorados

```tsx
<label className="text-xs font-semibold text-fg-secondary mb-1.5 block">
  Nombre del Campo
</label>
```

#### 4.2. Inputs y Textareas

```css
/* Mejores estados de focus y hover */
.input-field {
  @apply w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm;
  @apply transition-colors duration-150;
  @apply placeholder:text-muted-light;
  @apply hover:border-border-hover;
  @apply focus:border-accent focus:ring-2 focus:ring-accent/20;
  @apply disabled:opacity-50 disabled:cursor-not-allowed;
}
```

#### 4.3. Selects

```tsx
<select className={cn(
  "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm",
  "transition-colors duration-150",
  "hover:border-border-hover",
  "focus:border-accent focus:ring-2 focus:ring-accent/20",
  "cursor-pointer"
)}>
  {/* opciones */}
</select>
```

### 5. Mejoras en el Sistema de Espaciado

#### Propuestas

1. **Aumentar gap entre secciones** de `gap-4` (16px) a `gap-5` (20px)
2. **Padding consistente** en el contenido principal: `p-5` (20px)
3. **Separadores visuales sutiles** entre grupos de campos relacionados

```tsx
<div className="p-5 flex-1 overflow-y-auto flex flex-col gap-5">
  {/* Sección 1 */}
  <div className="space-y-3">
    {/* campos relacionados */}
  </div>
  
  {/* Separador sutil (opcional) */}
  <div className="border-t border-border-light" />
  
  {/* Sección 2 */}
  <div className="space-y-3">
    {/* campos relacionados */}
  </div>
</div>
```

### 6. Mejoras en Badges y Pills

#### Loop Badge

```tsx
<span className="text-[10px] font-semibold text-loop-accent bg-loop-accent-bg border border-loop-accent/30 px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm">
  <Repeat size={11} strokeWidth={2.5} />
  <span>En bucle</span>
</span>
```

#### Quick-Access Bar (Loop Context)

```tsx
<div className="p-3 bg-loop-accent-bg/50 border border-loop-accent/20 rounded-lg shadow-sm">
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2 font-semibold text-loop-accent text-xs">
      <Repeat size={13} strokeWidth={2.5} />
      <span>Dentro de: {parentLoopName}</span>
    </div>
    <span className="text-[10px] font-mono text-muted-light">
      {itemCount} items
    </span>
  </div>
  {/* botones de variables */}
</div>
```

### 7. Mejoras en Botones

#### Botón "Variables disponibles"

```tsx
<button
  className={cn(
    'flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-all',
    isOpen
      ? 'bg-accent/10 text-accent border-accent/40 shadow-md ring-2 ring-accent/20'
      : 'bg-accent/5 text-accent border-accent/20 hover:bg-accent/15 hover:border-accent/30 hover:shadow-sm'
  )}
>
  <Braces size={14} strokeWidth={2.5} />
  <span>Variables disponibles</span>
  <ChevronDown size={13} className={cn('transition-transform', isOpen && 'rotate-180')} />
</button>
```

#### Botón "Eliminar Nodo"

```tsx
<Button
  variant="default"
  className={cn(
    "w-full flex items-center justify-center gap-2 text-sm font-semibold",
    "bg-danger/10 text-danger border-2 border-danger/20",
    "hover:bg-danger/15 hover:border-danger/30 hover:shadow-md",
    "transition-all duration-150"
  )}
>
  <Trash2 size={15} strokeWidth={2.5} />
  <span>Eliminar Nodo</span>
</Button>
```

### 8. Mejoras en Indicadores de Estado

#### Estados de Ejecución

```tsx
{/* Ejecutando */}
<div className="w-7 h-7 bg-state-executing-bg border-2 border-state-executing text-state-executing rounded-full flex items-center justify-center shadow-sm">
  <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
</div>

{/* Pausado */}
<div className="w-7 h-7 bg-state-paused-bg border-2 border-state-paused text-state-paused rounded-full flex items-center justify-center shadow-sm">
  <Pause size={12} strokeWidth={2.5} className="fill-current" />
</div>

{/* Completado */}
<div className="w-7 h-7 bg-success text-white rounded-full flex items-center justify-center shadow-sm">
  <Check size={13} strokeWidth={3} />
</div>

{/* Error */}
<div className="w-7 h-7 bg-danger text-white rounded-full flex items-center justify-center shadow-sm">
  <X size={13} strokeWidth={3} />
</div>
```

---

## 📊 Validación de Propiedades por Tipo de Nodo

### Matriz de Validación

| Tipo de Nodo | Tabs Implementados | Propiedades Clave | Validación | Estado |
|--------------|-------------------|-------------------|------------|--------|
| **start** | N/A (simple) | Ninguna configurable | ✅ | Completo |
| **httpRequest** | General, Auth, Request, Response, Iteration | method, endpoint, headers, body, auth | ✅ | Completo |
| **scraping** | - | url, selector, extractMode | ⚠️ | Revisar tabs |
| **query** | Consulta, Parámetros, Datos Entrada | queryId, queryParams | ✅ | Completo |
| **export** | - | format, columns, filename | ⚠️ | Revisar tabs |
| **timer** | - | delay, unit | ⚠️ | Revisar tabs |
| **dataSource** | - | source, format, options | ⚠️ | Revisar tabs |
| **dataList** | - | items | ⚠️ | Revisar tabs |
| **variables** | - | variables (key-value) | ⚠️ | Revisar tabs |
| **forEach** | - | source, itemVar | ⚠️ | Revisar tabs |
| **forEachEnd** | N/A (simple) | Ninguna | ✅ | Completo |
| **conditionalBranch** | - | mode, conditions, cases | ⚠️ | Revisar tabs |
| **jsonTransform** | - | transformations | ⚠️ | Revisar tabs |
| **webhookTrigger** | - | path, method, auth | ⚠️🧪 | Experimental |
| **oauth2Connector** | - | provider, scopes, credentials | ⚠️🧪 | Experimental |
| **aiChatCompletion** | - | model, messages, temperature | ⚠️🧪 | Experimental |

**Leyenda**:
- ✅ Completo y bien estructurado
- ⚠️ Funcional pero podría beneficiarse de tabs
- 🧪 Experimental

### Recomendaciones por Inspector

#### ScrapingInspector
**Tabs sugeridos**: General, Selectores, Extracción, Avanzado
- **General**: URL, método de scraping
- **Selectores**: CSS selectors, XPath
- **Extracción**: Modo de extracción, formato
- **Avanzado**: Headers, timeout, anti-bot

#### ExportInspector
**Tabs sugeridos**: General, Columnas, Formato
- **General**: Nombre de archivo, tipo
- **Columnas**: Mapeo de columnas
- **Formato**: Opciones específicas (CSV, JSON, Excel)

#### ConditionalBranchInspector
**Tabs sugeridos**: Condiciones, Casos, Preview
- **Condiciones**: Editor de reglas (modo if/else)
- **Casos**: Editor de casos (modo switch)
- **Preview**: Vista previa de evaluación con datos de prueba

---

## 🚀 Plan de Implementación

### Fase 1: Fundamentos (1-2 días)
- [ ] Actualizar tokens CSS en `index.css`
- [ ] Crear utility classes para nuevos tokens
- [ ] Documentar cambios en sistema de diseño

### Fase 2: Componentes Core (2-3 días)
- [ ] Refinar `InspectorHeader.tsx`
- [ ] Mejorar `InspectorTabs.tsx`
- [ ] Actualizar componentes de formulario base (Input, Select, Textarea)
- [ ] Mejorar `VariableDrawer.tsx`

### Fase 3: Inspectores Específicos (3-4 días)
- [ ] Actualizar `HttpInspector.tsx`
- [ ] Actualizar `QueryInspector.tsx`
- [ ] Actualizar `ConditionalBranchInspector.tsx`
- [ ] Revisar y actualizar resto de inspectores simples

### Fase 4: Detalles y Pulido (1-2 días)
- [ ] Refinar estados de hover/focus en todos los elementos
- [ ] Optimizar responsive (aunque el panel es fixed-width)
- [ ] Pruebas de accesibilidad (contraste, keyboard navigation)
- [ ] Documentación de componentes mejorados

### Fase 5: Validación (1 día)
- [ ] Testing visual en diferentes navegadores
- [ ] Validación de flujo completo con todos los tipos de nodos
- [ ] Feedback del equipo
- [ ] Ajustes finales

---

## 📝 Checklist de Calidad

### Consistencia Visual
- [ ] Todos los inspectores usan los mismos tokens de color
- [ ] Espaciado consistente en todos los componentes
- [ ] Tipografía consistente (tamaños, weights)
- [ ] Bordes y radios consistentes

### Accesibilidad
- [ ] Contraste de color cumple WCAG 2.1 AA (mínimo 4.5:1 para texto)
- [ ] Focus states visibles en todos los elementos interactivos
- [ ] Labels asociados correctamente a inputs
- [ ] Navegación por teclado funcional

### UX
- [ ] Estados hover claros y predecibles
- [ ] Transiciones suaves (150-200ms)
- [ ] Feedback visual inmediato en acciones
- [ ] No hay "saltos" visuales inesperados

### Performance
- [ ] No hay re-renders innecesarios
- [ ] Animaciones optimizadas (GPU-accelerated)
- [ ] CSS bien organizado (evitar especificidad excesiva)

---

## 🎨 Paleta de Colores Completa (Post-Mejora)

### Neutrales
```
#FFFFFF  --surface          ████████  Blanco (superficies)
#FAFAFA  --bg               ████████  Gris muy claro (fondo)
#F0F0F0  --border-light     ████████  Gris ultra claro (separadores)
#E5E5E5  --border           ████████  Gris claro (bordes)
#D1D5DB  --border-hover     ████████  Gris medio-claro (hover)
#9CA3AF  --muted-light      ████████  Gris medio (placeholders)
#6B6B6B  --muted            ████████  Gris (texto secundario)
#3D3D3D  --fg-secondary     ████████  Gris oscuro (texto importante)
#111111  --fg               ████████  Casi negro (texto principal)
```

### Acento y Semántico
```
#2F6FEB  --accent           ████████  Azul (acción primaria)
#17A34A  --success          ████████  Verde (éxito)
#EAB308  --warn             ████████  Amarillo (advertencia)
#DC2626  --danger           ████████  Rojo (peligro)
```

### Estados de Nodo
```
#3B82F6  --state-executing  ████████  Azul brillante (ejecutando)
#DBEAFE  --state-exec-bg    ████████  Azul muy claro (fondo)
#F59E0B  --state-paused     ████████  Naranja (pausado)
#FEF3C7  --state-paused-bg  ████████  Amarillo muy claro (fondo)
```

### Contexto de Bucle
```
#0EA5E9  --loop-accent      ████████  Cyan (loop context)
#E0F2FE  --loop-accent-bg   ████████  Cyan muy claro (fondo)
```

---

## 📚 Referencias

- [Componente NodeInspector](./frontend/src/components/flow/inspector/NodeInspector.tsx)
- [InspectorHeader](./frontend/src/components/flow/inspector/InspectorHeader.tsx)
- [InspectorTabs](./frontend/src/components/flow/inspector/InspectorTabs.tsx)
- [HttpInspector](./frontend/src/components/flow/inspector/inspectors/HttpInspector.tsx)
- [Sistema de tokens](./frontend/src/index.css)

---

**Última actualización**: 24 de Septiembre, 2026
