// Source of orquesta_runtime.py, the helper module shipped with every exported flow.
// The generated <flow>_flow.py only describes the steps; everything mechanical lives here.
// Keep behaviour aligned with executor.ts (template resolution, flattenRows, conditions, loops).

export const PYTHON_RUNTIME = String.raw`"""
orquesta_runtime.py
===================
Funciones comunes de los flujos exportados desde OrquestaFlow.

El script del flujo (<nombre>_flow.py) solo describe los pasos. Aquí vive la
mecánica: resolver {{variables}}, peticiones HTTP con reintentos, consultas SQL,
exportar a Excel/CSV, bucles y bifurcaciones. Normalmente no necesitas
modificar este archivo.
"""

from __future__ import annotations

import base64
import getpass
import json
import logging
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv es opcional
    def load_dotenv(*_args, **_kwargs):
        return False

log = logging.getLogger("orquesta")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RETRYABLE_STATUS = {408, 425, 429}


# =============================================================================
# Errores
# =============================================================================

class FlowError(Exception):
    """Error que detiene el flujo."""


class HttpError(Exception):
    """Respuesta HTTP con código de error."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# =============================================================================
# Contexto del flujo y ejecución de pasos
# =============================================================================

class FlowContext(dict):
    """
    Resultados de los pasos ya ejecutados. Cada resultado se guarda con el id del
    nodo y con su nombre, igual que en OrquestaFlow: {{Obtener datos.campo}}.
    """

    def __init__(self, name, total_steps):
        super().__init__()
        self.flow_name = name
        self.total_steps = total_steps
        self.ran = set()
        self.branches = {}
        self.warnings = []
        self.last_output = None
        self.depth = 0
        self.started_at = time.time()

    def output_of(self, *node_ids):
        """Primer resultado disponible entre los nodos indicados (la entrada de un paso)."""
        for node_id in node_ids:
            value = self.get(node_id)
            if value is not None:
                return unwrap(value)
        return self.get("_item")

    def last_value(self):
        """Último resultado guardado; se usa cuando el paso no tiene una entrada conectada."""
        for key in reversed(list(self.keys())):
            if key.startswith("start") or key.startswith("_"):
                continue
            if self[key] is not None:
                return self[key]
        return None

    def took(self, step_fn, handle=None):
        """True si el paso se ejecutó y, en una bifurcación, si eligió la salida 'handle'."""
        if step_fn.node_id not in self.ran:
            return False
        return handle is None or self.branches.get(step_fn.node_id) == handle


def node(number, label, *, node_id, kind="", retries=0, retry_delay=1.0, backoff="exponential", on_error="stop"):
    """Asocia una función del script con su nodo en OrquestaFlow."""
    def register(fn):
        fn.number = number
        fn.label = label
        fn.node_id = node_id
        fn.kind = kind
        fn.retries = retries
        fn.retry_delay = retry_delay
        fn.backoff = backoff
        fn.on_error = on_error
        return fn
    return register


def start_flow(name, total_steps, databases=None, start_ids=("start",)):
    """Prepara el log, carga el archivo .env y devuelve el contexto vacío del flujo."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    load_dotenv(os.path.join(BASE_DIR, ".env"))
    load_dotenv()
    _DATABASES.update(databases or {})

    ctx = FlowContext(name, total_steps)
    for start_id in start_ids:
        ctx[start_id] = {"msg": "Flow started"}
        ctx.ran.add(start_id)
    log.info("=" * 60)
    log.info("Flujo: %s", name)
    log.info("=" * 60)
    return ctx


def finish_flow(ctx):
    elapsed = time.time() - ctx.started_at
    log.info("=" * 60)
    if ctx.warnings:
        log.warning("Flujo completado con %d aviso(s) en %.1fs:", len(ctx.warnings), elapsed)
        for warning in ctx.warnings:
            log.warning("  - %s", warning)
    else:
        log.info("Flujo completado en %.1fs", elapsed)
    log.info("=" * 60)
    return ctx


def run_main(main):
    """Ejecuta main() y termina con código 1 si el flujo falla."""
    try:
        main()
    except FlowError as error:
        log.error("El flujo se detuvo: %s", error)
        sys.exit(1)
    except KeyboardInterrupt:
        log.warning("Ejecución cancelada por el usuario")
        sys.exit(130)


def run(ctx, step_fn):
    """Ejecuta un paso: aplica reintentos y la política de error, y guarda el resultado."""
    pad = "   " * ctx.depth
    kind = f"  ({step_fn.kind})" if step_fn.kind else ""
    log.info("%s[%s/%s] %s%s", pad, step_fn.number, ctx.total_steps, step_fn.label, kind)
    started = time.time()
    try:
        result = with_retries(lambda: step_fn(ctx), step_fn.retries, step_fn.retry_delay, step_fn.backoff, pad)
    except FlowError:
        raise
    except Exception as error:
        if step_fn.on_error != "continue":
            raise FlowError(f"{step_fn.label}: {error}") from error
        message = str(error)
        log.warning("%s   falló, el flujo continúa: %s", pad, message)
        ctx.warnings.append(f"{step_fn.label}: {message}")
        result = {"error": message, "failed": True}

    ctx[step_fn.node_id] = result
    if step_fn.label and step_fn.label != step_fn.node_id:
        ctx[step_fn.label] = result
    ctx.ran.add(step_fn.node_id)
    if isinstance(result, dict) and "selectedHandle" in result:
        ctx.branches[step_fn.node_id] = result["selectedHandle"]
    else:
        ctx.last_output = result
    log.info("%s   OK: %s (%.1fs)", pad, describe(result), time.time() - started)
    return result


def with_retries(action, retries=0, delay=1.0, backoff="exponential", pad=""):
    """Repite 'action' ante fallos transitorios (red, tiempo de espera, HTTP 408/429/5xx)."""
    attempt = 0
    while True:
        try:
            return action()
        except Exception as error:
            if attempt >= retries or not is_retryable(error):
                raise
            attempt += 1
            wait = min(60.0, delay * (2 ** (attempt - 1)) if backoff == "exponential" else delay)
            log.warning("%s   reintento %d/%d en %.1fs: %s", pad, attempt, retries, wait, error)
            time.sleep(wait)


def is_retryable(error):
    status = getattr(error, "status", None)
    if isinstance(status, int):
        return status in RETRYABLE_STATUS or 500 <= status <= 599
    return not isinstance(error, (FlowError, KeyboardInterrupt))


def describe(result):
    if isinstance(result, list):
        return f"{len(result)} registro(s)"
    if isinstance(result, dict):
        if result.get("failed"):
            return "con error"
        if result.get("filePath"):
            return f"archivo {result['filePath']} ({result.get('records', 0)} registros)"
        if "branchLabel" in result:
            return f"salida '{result['branchLabel']}'"
        rows = flatten_rows(result)
        if len(rows) > 1:
            return f"{len(rows)} registro(s)"
    return "listo"


_SKIP = object()


def loop(ctx, loop_fn, collect=(), alias=None):
    """
    Bucle "Para cada elemento": ejecuta loop_fn para obtener la lista y repite el
    bloque 'for' del flujo una vez por elemento. En cada vuelta {{_item}},
    {{_index}} y {{_total}} apuntan al elemento actual. Los resultados se
    acumulan igual que en OrquestaFlow (cada fila combinada con su elemento).

    'collect' indica los pasos que llegan al "Fin de bucle": el primero que se
    haya ejecutado aporta el resultado de la vuelta. Una entrada puede ser
    (paso, salida) cuando viene de una bifurcación. 'alias' es el nombre
    opcional del elemento, p. ej. {{sucursal.id}}.
    """
    items = run(ctx, loop_fn)
    items = items if isinstance(items, list) else ([] if items is None else [items])
    results = []
    ran_before = set(ctx.ran)
    ctx.depth += 1
    for index, item in enumerate(items):
        ctx.ran = set(ran_before)
        ctx.update({"_item": item, "item": item, "_index": index, "_total": len(items), loop_fn.node_id: item})
        if alias:
            ctx[alias] = item
        ctx.last_output = None
        log.info("%s-- elemento %d de %d", "   " * (ctx.depth - 1), index + 1, len(items))
        yield item

        row = _iteration_result(ctx, item, collect)
        if row is not _SKIP:
            results.extend(_merge_with_item(item, row))

    ctx.depth -= 1
    for key in ("_item", "item", "_index", "_total", alias):
        if key:
            ctx.pop(key, None)
    ctx.ran = ran_before
    ctx[loop_fn.node_id] = results
    ctx[loop_fn.label] = results
    log.info("   bucle '%s' completado: %d registro(s)", loop_fn.label, len(results))


def _iteration_result(ctx, item, collect):
    if not collect:
        return ctx.last_output
    for entry in collect:
        step_fn, handle = entry if isinstance(entry, tuple) else (entry, None)
        if ctx.took(step_fn, handle):
            # A bifurcation passes the element through unchanged
            return item if step_fn.node_id in ctx.branches else ctx.get(step_fn.node_id)
    return _SKIP


def _merge_with_item(item, result):
    rows = flatten_rows(result)
    if rows:
        return [{**item, **row} if isinstance(item, dict) and isinstance(row, dict) else row for row in rows]
    if isinstance(item, dict):
        if isinstance(result, dict):
            return [{**item, **result}]
        if result is not None:
            return [{**item, "resultado": result}]
        return [dict(item)]
    return [result]


def loop_results(ctx, loop_node_id):
    """Salida del nodo "Fin de bucle": los resultados acumulados por el bucle."""
    return flatten_rows(ctx.get(loop_node_id) or [])


# =============================================================================
# Plantillas {{nodo.campo}}
# =============================================================================

_TEMPLATE = re.compile(r"\{\{([^}]+)\}\}")
_BRACKET = re.compile(r"^([^\[]*?)\[(\d+|\*)\]$")


def resolve(ctx, value):
    """Sustituye las expresiones {{nodo.campo}} por su valor (también dentro de dicts y listas)."""
    if isinstance(value, str):
        exact = _TEMPLATE.fullmatch(value.strip())
        if exact:
            return resolve_path(ctx, exact.group(1))
        text = _TEMPLATE.sub(lambda m: to_text(resolve_path(ctx, m.group(1))), value)
        if "http" in text or text.startswith("/"):
            text = _resolve_url_placeholders(ctx, text)
        return text
    if isinstance(value, list):
        return [resolve(ctx, v) for v in value]
    if isinstance(value, dict):
        return {k: resolve(ctx, v) for k, v in value.items()}
    return value


def to_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=_json_default)
    return str(value)


def get_path(obj, path):
    """Lee 'a.b[0].c' dentro de un objeto. Sobre una lista de filas, 'campo' lee la primera fila."""
    if obj is None or not path or not str(path).strip():
        return None
    tokens = str(path).strip().split(".")
    value = obj
    for i, token in enumerate(tokens):
        if value is None:
            return None
        bracket = _BRACKET.match(token)
        if bracket:
            key, index = bracket.groups()
            if key:
                value = _child(value, key)
            if value is None:
                return None
            if index == "*":
                if not isinstance(value, list):
                    return None
                rest = ".".join(tokens[i + 1:])
                return value if not rest else [get_path(v, rest) for v in value]
            position = int(index)
            value = value[position] if isinstance(value, list) and position < len(value) else None
        elif isinstance(value, list) and token == "length":
            value = len(value)
        elif isinstance(value, list) and not token.isdigit():
            first = value[0] if value else None
            value = first.get(token) if isinstance(first, dict) else None
        else:
            value = _child(value, token)
    return value


def _child(value, key):
    if isinstance(value, dict):
        return value.get(key)
    if isinstance(value, list) and key.isdigit():
        position = int(key)
        return value[position] if position < len(value) else None
    if isinstance(value, str) and key == "length":
        return len(value)
    return None


def resolve_path(ctx, path):
    """Resuelve una ruta como lo hace OrquestaFlow: contexto, elemento del bucle y búsqueda por nombre."""
    path = (path or "").strip()
    if not path or ctx is None:
        return None
    direct = get_path(ctx, path)
    if direct is not None:
        return direct

    item = ctx.get("_item")
    if item is not None:
        if not isinstance(item, dict):
            return item
        if item.get(path) is not None:
            return item[path]
        found = get_path(item, path)
        if found is not None:
            return found
        found = _find_key(item, path)
        if found is not None:
            return found

    for key, value in ctx.items():
        if key in ("start", "_item") or value is None:
            continue
        if isinstance(value, list):
            first = value[0] if value else None
            if isinstance(first, dict):
                found = get_path(first, path)
                if found is None:
                    found = _find_key(first, path)
                if found is not None:
                    return found
        elif isinstance(value, dict):
            found = get_path(value, path)
            if found is not None:
                return found
            inner = value.get("data")
            if isinstance(inner, list) and inner and isinstance(inner[0], dict):
                found = get_path(inner[0], path)
                if found is None:
                    found = _find_key(inner[0], path)
                if found is not None:
                    return found
            elif isinstance(inner, dict):
                found = get_path(inner, path)
                if found is not None:
                    return found
            found = _find_key(value, path)
            if found is not None:
                return found
    return None


def _find_key(obj, name):
    lower = name.lower()
    for key, value in obj.items():
        if str(key).lower() == lower:
            return value
    return None


def _resolve_url_placeholders(ctx, text):
    """Rellena /ruta/{id} y /ruta/:id con valores del contexto (compatibilidad con OrquestaFlow)."""
    def lookup(match):
        name = match.group(1)
        value = resolve_path(ctx, name)
        if value is None and "id" in name.lower():
            value = _guess_id(ctx)
        return match.group(0) if value is None else to_text(value)

    text = re.sub(r"\{([^{}]+)\}", lookup, text)
    return re.sub(r":([a-zA-Z0-9_]+)", lookup, text)


def _guess_id(ctx):
    value = resolve_path(ctx, "id")
    if value is not None:
        return value
    for source in [ctx.get("_item"), *ctx.values()]:
        target = source[0] if isinstance(source, list) and source else source
        if isinstance(target, dict):
            for key, val in target.items():
                if "id" in str(key).lower():
                    return val
    return None


def unwrap(value):
    """Las transformaciones con console.log devuelven {_data, _logs}: se usa solo _data."""
    if isinstance(value, dict) and "_data" in value and isinstance(value.get("_logs"), list):
        return value["_data"]
    return value


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def first_list(ctx):
    for key, value in ctx.items():
        if not key.startswith("_") and isinstance(value, list) and value:
            return value
    return []


def flatten_rows(data):
    """Extrae las filas de una respuesta (listas anidadas, 'data', 'rows', 'items')."""
    if data is None:
        return []
    if not isinstance(data, list):
        if not isinstance(data, dict):
            return []
        if "_data" in data:
            return flatten_rows(data["_data"])
        for key in ("rows", "data", "items"):
            if isinstance(data.get(key), list):
                return flatten_rows(data[key])
        if isinstance(data.get("data"), dict) and data["data"]:
            return [data["data"]]
        for value in data.values():
            if isinstance(value, list):
                return flatten_rows(value)
        return [data]

    rows = []
    for item in data:
        if not item:
            continue
        if isinstance(item, list):
            rows.extend(flatten_rows(item))
        elif isinstance(item, dict):
            nested = next((item[k] for k in ("data", "rows", "items") if isinstance(item.get(k), list)), None)
            if nested is not None:
                rows.extend(flatten_rows(nested))
            elif isinstance(item.get("data"), dict) and item["data"]:
                rows.append(dict(item["data"]))
            else:
                rows.append(item)
    return rows


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


# =============================================================================
# Valores de entrada: variables, secretos y archivos
# =============================================================================

def _env_name(name):
    return re.sub(r"[^A-Za-z0-9_]", "_", str(name))


def ask(name, default=None, kind="string"):
    """
    Valor de una variable del flujo. Orden: variable de entorno VAR_<nombre> (o
    <NOMBRE>), respuesta por consola si hay una terminal, y el valor por defecto.
    """
    key = _env_name(name)
    value = os.getenv(f"VAR_{key}") or os.getenv(key.upper())
    if value is None or value.strip() == "":
        value = "" if default is None else default
        if sys.stdin and sys.stdin.isatty():
            answer = input(f"Valor para '{name}' [{to_text(default)}]: ").strip()
            if answer:
                value = answer
    return _coerce(value, kind)


def _coerce(value, kind):
    if not isinstance(value, str):
        return value
    text = value.strip()
    if kind == "number":
        try:
            return float(text) if "." in text else int(text)
        except ValueError:
            return value
    if kind == "boolean":
        return text.lower() in ("true", "1", "yes", "si", "sí", "s", "verdadero")
    if kind == "json" and text.startswith(("{", "[")):
        try:
            return json.loads(text)
        except ValueError:
            return value
    return value


def ask_into(ctx, path):
    """Pide por consola un valor que el flujo esperaba recibir de fuera (p. ej. {{Parametros.fecha}})."""
    if resolve_path(ctx, path) is not None:
        return
    parts = path.split(".")
    value = ask(path)
    target = ctx
    for part in parts[:-1]:
        existing = target.get(part)
        if not isinstance(existing, dict):
            existing = {}
            target[part] = existing
        target = existing
    target[parts[-1]] = value


def set_variables(ctx, values):
    """Publica las variables en el contexto: {{Variables.x}}, {{x}} y {{<nombre del nodo>.x}}."""
    ctx.setdefault("Variables", {}).update(values)
    for key, value in values.items():
        ctx[key] = value
        log.info("   %s = %s", key, to_text(value))
    return values


def secret(env_name, required=True):
    """Lee un secreto de una variable de entorno (nunca se guarda en el script)."""
    value = os.getenv(env_name, "")
    if not value and sys.stdin and sys.stdin.isatty():
        value = getpass.getpass(f"Valor para {env_name} (no se mostrará): ")
    if not value and required:
        raise FlowError(f"Falta la variable de entorno {env_name}; defínela en el archivo .env")
    return value


def file_input(env_name, default=""):
    """Ruta de un archivo de entrada: variable de entorno, ruta original o pregunta por consola."""
    path = os.getenv(env_name) or default
    if path and not os.path.isabs(path) and not os.path.exists(path):
        candidate = os.path.join(BASE_DIR, path)
        if os.path.exists(candidate):
            path = candidate
    if (not path or not os.path.exists(path)) and sys.stdin and sys.stdin.isatty():
        path = input(f"Ruta del archivo ({env_name}): ").strip().strip('"')
    if not path:
        raise FlowError(f"No se indicó el archivo de entrada; define {env_name} en el archivo .env")
    return path


def today(fmt="%Y-%m-%d", days=0):
    return (datetime.now() + timedelta(days=days)).strftime(fmt)


def month_start(fmt="%Y-%m-%d"):
    return datetime.now().replace(day=1).strftime(fmt)


def now_ms():
    return int(time.time() * 1000)


def now_iso():
    return datetime.now().isoformat()


# =============================================================================
# HTTP
# =============================================================================

def _requests():
    try:
        import requests
    except ImportError as error:
        raise FlowError("Falta la librería 'requests': pip install -r requirements.txt") from error
    return requests


def http_request(ctx, method, url, *, headers=None, params=None, body=None, bearer_token=None,
                 basic_auth=None, extract=None, timeout=30, retries=0, retry_delay=1.0,
                 backoff="exponential", for_each=None):
    """
    Petición HTTP con plantillas {{...}} en la URL, headers, parámetros y cuerpo.
    Con 'for_each' repite la petición por cada elemento de la lista ({{_item}}).
    Cada petición se reintenta por separado ante fallos transitorios.
    """
    items = [None]
    if for_each is not None:
        found = first_list(ctx) if for_each == "auto" else resolve(ctx, for_each)
        if isinstance(found, list) and found:
            items = found

    results = []
    for index, item in enumerate(items):
        scope = ctx if item is None else {**ctx, "_item": item, "_index": index, "_total": len(items)}
        request_url = resolve(scope, url)
        request_headers = {"Content-Type": "application/json", **_as_mapping(resolve(scope, headers))}
        token = to_text(resolve(scope, bearer_token)).strip() if bearer_token else ""
        if token:
            request_headers["Authorization"] = f"Bearer {token}"
        if basic_auth:
            user, password = (to_text(resolve(scope, part)) for part in basic_auth)
            if user or password:
                encoded = base64.b64encode(f"{user}:{password}".encode()).decode()
                request_headers["Authorization"] = f"Basic {encoded}"

        send = lambda: _send(method, request_url, _as_mapping(resolve(scope, params)), request_headers,
                             resolve(scope, body), timeout)
        data = with_retries(send, retries, retry_delay, backoff, "   " * (ctx.depth + 1))
        results.append(get_path(data, extract) if extract else data)
        if len(items) > 1:
            log.info("   %d/%d OK", index + 1, len(items))

    return results if len(items) > 1 else results[0]


def _as_mapping(value):
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if v is not None}
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def _send(method, url, params, headers, payload, timeout):
    requests = _requests()
    kwargs = {"params": {k: to_text(v) for k, v in params.items()} or None, "headers": headers, "timeout": timeout}
    if method in ("POST", "PUT", "PATCH") and payload not in (None, ""):
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                kwargs["data"] = payload.encode("utf-8")
        if "data" not in kwargs:
            kwargs["data"] = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
    try:
        response = requests.request(method, url, **kwargs)
    except requests.RequestException as error:
        raise ConnectionError(f"no se pudo completar la petición a {url}: {error}") from error
    try:
        data = response.json()
    except ValueError:
        data = response.text
    if not response.ok:
        detail = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        raise HttpError(response.status_code, f"HTTP {response.status_code} en {url}. {detail[:300]}")
    return data


# =============================================================================
# SQL Server
# =============================================================================

_DATABASES = {}
_PARAM = re.compile(r"'(%?)#param_([A-Za-z0-9_]+)(%?)'|(?<![A-Za-z0-9_#])#param_([A-Za-z_][A-Za-z0-9_]*)\b")


def run_sql(ctx, *, sql_file, connections, params=None, columns=None):
    """
    Ejecuta la consulta del archivo 'sql_file' en cada conexión (claves de .env) y
    une las filas. Los #param_x de la consulta se sustituyen por 'params'.
    """
    sql = _read_text(sql_file)
    values = resolve(ctx, params or {})
    rows = []
    for key in connections:
        is_sqlite = _DATABASES.get(key, {}).get("driver") == "sqlite"
        statement, args = _prepare_sql(sql, values, concat="||" if is_sqlite else "+")
        rows.extend(_query_sqlite(key, statement, args) if is_sqlite else _query(key, statement, args))
    if columns:
        if len(columns) == 1:
            return [row.get(columns[0]) for row in rows]
        return [{c: row.get(c) for c in columns} for row in rows]
    return rows


def _read_text(relative_path):
    path = relative_path if os.path.isabs(relative_path) else os.path.join(BASE_DIR, relative_path)
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _prepare_sql(sql, values, concat="+"):
    args = []

    def replace(match):
        name = match.group(2) or match.group(4)
        value = values.get(name)
        value = "" if value is None else value
        if isinstance(value, str) and "," in value and ("'" in value or '"' in value):
            value = [part.strip().strip("'\"") for part in value.split(",")]
        if isinstance(value, list):
            args.extend(value)
            marks = ", ".join("?" for _ in value) or "NULL"
        else:
            args.append(value)
            marks = "?"
        if match.group(2) is None:
            return marks
        parts = (["'%'"] if match.group(1) else []) + [marks] + (["'%'"] if match.group(3) else [])
        return f" {concat} ".join(parts)

    return _PARAM.sub(replace, sql), args


def _connection_string(key):
    custom = os.getenv(f"DB_CONN_STR_{key}", "").strip()
    if custom and "UID=;" not in custom and "PWD=;" not in custom:
        return custom
    defaults = _DATABASES.get(key, {})
    driver = os.getenv(f"DB_DRIVER_{key}", defaults.get("driver", "ODBC Driver 17 for SQL Server"))
    host = os.getenv(f"DB_HOST_{key}", defaults.get("host", "localhost"))
    port = os.getenv(f"DB_PORT_{key}", str(defaults.get("port", 1433)))
    database = os.getenv(f"DB_NAME_{key}", defaults.get("database", ""))
    user = os.getenv(f"DB_USER_{key}") or os.getenv("DB_USER_DEFAULT", "")
    password = os.getenv(f"DB_PASSWORD_{key}") or os.getenv("DB_PASSWORD_DEFAULT", "")
    return f"DRIVER={{{driver}}};SERVER={host},{port};DATABASE={database};UID={user};PWD={password}"


def _query(key, statement, args):
    try:
        import pyodbc
    except ImportError as error:
        raise FlowError("Falta la librería 'pyodbc': pip install -r requirements.txt") from error
    connection = pyodbc.connect(_connection_string(key))
    try:
        cursor = connection.cursor()
        if args:
            cursor.execute(statement, args)
        else:
            cursor.execute(statement)
        columns = [column[0] for column in cursor.description or []]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        log.info("   [%s] %d fila(s)", key, len(rows))
        return rows
    finally:
        connection.close()


def _query_sqlite(key, statement, args):
    import sqlite3

    path = os.getenv(f"DB_PATH_{key}") or _DATABASES.get(key, {}).get("host", "")
    if not path or not os.path.exists(path):
        raise FlowError(f"No se encontró la base SQLite de la conexión {key}; define DB_PATH_{key} en .env")
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in connection.execute(statement, args).fetchall()]
        log.info("   [%s] %d fila(s)", key, len(rows))
        return rows
    finally:
        connection.close()


# =============================================================================
# Archivos de entrada
# =============================================================================

def _pandas():
    try:
        import pandas
    except ImportError as error:
        raise FlowError("Faltan 'pandas' y 'openpyxl': pip install -r requirements.txt") from error
    return pandas


def read_table(path, sheet=None):
    """Lee un Excel (.xlsx/.xls) o CSV y devuelve sus filas como lista de diccionarios."""
    pd = _pandas()
    if path.lower().endswith((".xlsx", ".xls")):
        frame = pd.read_excel(path, sheet_name=sheet if sheet else 0)
    else:
        frame = pd.read_csv(path, encoding="utf-8-sig")
    frame = frame.astype(object).where(frame.notna(), None)
    return frame.to_dict(orient="records")


def merge_sources(*values):
    """Modo unificador: combina las filas de varios nodos por una llave común (id/código) o por posición."""
    tables = [rows for rows in (flatten_rows(v) for v in values) if rows]
    if not tables:
        return []
    tables.sort(key=len, reverse=True)
    base, others = tables[0], tables[1:]
    merged = []
    for index, base_row in enumerate(base):
        combined = dict(base_row)
        for other in others:
            match = None
            foreign = list((other[0] or {}).keys())
            common = [k for k in combined if any(f.lower() == k.lower() for f in foreign)]
            key = next((k for k in common if "id" in k.lower() or "code" in k.lower()), common[0] if common else None)
            if key is not None and combined.get(key) is not None:
                foreign_key = next(f for f in foreign if f.lower() == key.lower())
                match = next((r for r in other if str(r.get(foreign_key)) == str(combined[key])), None)
            if match is None and index < len(other):
                match = other[index]
            if isinstance(match, dict):
                combined.update(match)
        merged.append(combined)
    return merged


def run_script(ctx, script_file, url="", selector="", timeout=600):
    """
    Nodo de web scraping: ejecuta un script de Python y lee el JSON que imprime por
    consola. La URL y el selector llegan al script en SCRAPING_URL y SCRAPING_SELECTOR.
    """
    import subprocess

    path = os.path.join(BASE_DIR, script_file)
    if not os.path.exists(path) and os.path.exists(path + ".py"):
        path += ".py"
    if not os.path.exists(path):
        raise FlowError(f"No se encontró el script {script_file}; cópialo en la carpeta scripts/")
    env = {**os.environ, "SCRAPING_URL": to_text(resolve(ctx, url)), "SCRAPING_SELECTOR": to_text(resolve(ctx, selector)),
           "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run([sys.executable, path], capture_output=True, text=True, encoding="utf-8",
                          timeout=timeout, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"el script terminó con código {proc.returncode}: {proc.stderr[-500:]}")
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return {"output": proc.stdout}


def pause(seconds, pass_through=None):
    """Nodo de pausa: espera y deja pasar los datos que recibió."""
    log.info("   esperando %s s...", seconds)
    time.sleep(seconds)
    return pass_through


# =============================================================================
# Exportar a Excel / CSV
# =============================================================================

def export_file(ctx, data, *, file_name, format="csv", columns=None, joins=None, header_color=None):
    """Genera un Excel o CSV con las filas de 'data' (columnas, uniones y color de encabezado opcionales)."""
    pd = _pandas()
    rows = build_export_rows(ctx, data, columns or [], joins or [])
    excel = format.lower() in ("excel", "xlsx")
    path = _output_path(resolve(ctx, file_name), ".xlsx" if excel else ".csv")

    headers = [c["header"] for c in (columns or []) if c.get("header")]
    frame = pd.DataFrame(rows) if rows else pd.DataFrame(columns=headers)
    if excel:
        frame.to_excel(path, index=False, engine="openpyxl")
        _style_excel(path, header_color)
    else:
        frame.to_csv(path, index=False, encoding="utf-8-sig")
    return {"filePath": path, "records": len(frame), "format": "Excel" if excel else "CSV", "success": True}


def export_sheets(ctx, *, file_name, sheets, header_color=None):
    """Excel con una hoja por nodo: sheets = {id_del_nodo: nombre_de_hoja}."""
    pd = _pandas()
    path = _output_path(resolve(ctx, file_name), ".xlsx")
    total = 0
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        written = False
        for node_id, sheet_name in sheets.items():
            rows = flatten_rows(ctx.get(node_id))
            if not rows:
                continue
            pd.DataFrame(rows).to_excel(writer, sheet_name=str(sheet_name)[:31], index=False)
            total += len(rows)
            written = True
        if not written:
            pd.DataFrame([{"Mensaje": "Sin datos"}]).to_excel(writer, sheet_name="Datos Vacio", index=False)
    _style_excel(path, header_color)
    return {"filePath": path, "records": total, "format": "Excel", "success": True}


def build_export_rows(ctx, data, columns, joins):
    """Filas finales de la exportación: aplana, une con otros nodos y aplica el mapeo de columnas."""
    wrapped = []
    for root in (data if isinstance(data, list) else [data]):
        wrapped.extend(flatten_rows(root))

    lookups = []
    for join in joins:
        node_id, local_key, foreign_key = join.get("nodeId"), join.get("localKey"), join.get("foreignKey")
        if not (node_id and local_key and foreign_key):
            continue
        index = {}
        for row in flatten_rows(ctx.get(node_id)):
            actual = next((k for k in row if str(k).lower() == foreign_key.lower()), foreign_key)
            if row.get(actual) is not None:
                index[str(row[actual])] = row
        if index:
            lookups.append((index, local_key))

    def matches(item):
        found = []
        for index, local_key in lookups:
            actual = next((k for k in item if str(k).lower() == local_key.lower()), local_key)
            if item.get(actual) is not None and str(item[actual]) in index:
                found.append(index[str(item[actual])])
        return found

    if not columns:
        if not lookups:
            return wrapped
        merged = []
        for item in wrapped:
            row = dict(item)
            for match in matches(item):
                row.update(match)
            merged.append(row)
        return merged

    rows = []
    for position, item in enumerate(wrapped):
        joined = matches(item)
        row = {}
        for column in columns:
            header, key = column.get("header"), column.get("key")
            if not header or not key:
                continue
            if "{{" in key:
                value = resolve({**ctx, "_item": item, "_index": position}, key)
            else:
                value = get_path(item, key)
                if value is None:
                    value = next((m[key] for m in joined if key in m), None)
                if value is None:
                    value = resolve_path(ctx, key)
            row[header] = "" if value is None else value
        rows.append(row)
    return rows


def _output_path(name, extension):
    folder = os.getenv("OUTPUT_DIR") or os.path.join(BASE_DIR, "exports")
    os.makedirs(folder, exist_ok=True)
    clean = re.sub(r'[<>:"/\\|?*\r\n\t]', "_", to_text(name)).strip() or "exportacion"
    clean = re.sub(r"\.(csv|xlsx|json)$", "", clean, flags=re.IGNORECASE)
    return os.path.join(folder, clean + extension)


def _style_excel(path, header_color=None):
    """Encabezados con color de fondo, texto blanco en negrita y columnas con ancho legible."""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        return
    color = (header_color or "#1E293B").lstrip("#").upper()
    if len(color) == 3:
        color = "".join(c * 2 for c in color)
    if not re.fullmatch(r"[0-9A-F]{6}", color):
        color = "1E293B"
    workbook = openpyxl.load_workbook(path)
    for sheet in workbook.worksheets:
        sheet.row_dimensions[1].height = 24
        for index, cell in enumerate(sheet[1], start=1):
            cell.fill = PatternFill(start_color=color, end_color=color, fill_type="solid")
            cell.font = Font(bold=True, color="FFFFFF")
            cell.alignment = Alignment(vertical="center")
            sheet.column_dimensions[get_column_letter(index)].width = max(len(str(cell.value or "")) + 4, 16)
    workbook.save(path)


# =============================================================================
# Transformaciones
# =============================================================================

_JS_RUNNER = r"""
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const { code, data, context } = JSON.parse(raw);
    const read = (path) => path.trim().split('.').reduce((cur, key) => (cur == null ? cur : cur[key]), context);
    const body = code.replace(/\{\{([^}]+)\}\}/g, (_m, path) => JSON.stringify(read(path) ?? null));
    const source = /\breturn\b/.test(body) ? body : 'return (' + body + '\n);';
    const logs = [];
    const capture = (level) => (...args) => { logs.push(level + ': ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); };
    const fakeConsole = { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error'), debug: capture('debug'), table: capture('table') };
    const fn = new Function('data', 'context', 'console', '"use strict";\n' + source);
    const result = fn(data, context, fakeConsole);
    process.stdout.write(JSON.stringify({ ok: true, result: result === undefined ? null : result, logs }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
  }
});
"""


def run_js(ctx, script_file, data):
    """
    Ejecuta una transformación JavaScript (carpeta transforms/) con Node.js 18+.
    Dentro del script: 'data' es la entrada y 'context' los resultados de los pasos.
    """
    import shutil
    import subprocess

    code = _read_text(script_file)
    if not code.strip():
        return data
    node_bin = shutil.which("node")
    if not node_bin:
        raise FlowError("Las transformaciones JavaScript necesitan Node.js 18+ (https://nodejs.org)")

    payload = json.dumps({"code": code, "data": data, "context": dict(ctx)}, ensure_ascii=False, default=_json_default)
    try:
        proc = subprocess.run([node_bin, "-e", _JS_RUNNER], input=payload, capture_output=True,
                              text=True, encoding="utf-8", timeout=60)
    except subprocess.TimeoutExpired as error:
        raise FlowError(f"La transformación {script_file} superó 60 segundos") from error

    try:
        output = json.loads(proc.stdout or "{}")
    except ValueError as error:
        raise FlowError(f"Salida no válida de {script_file}: {(proc.stdout or proc.stderr)[:300]}") from error
    for line in output.get("logs", []):
        log.info("   [js] %s", line)
    if not output.get("ok"):
        raise ValueError(f"error en {script_file}: {output.get('error')}")
    return output.get("result")


def map_fields(ctx, data, mappings, keep_others=False):
    """Transformación por mapeo de campos (modo antiguo del nodo): 'origen' -> 'destino'."""
    def map_row(row):
        if not isinstance(row, dict):
            return row
        out = dict(row) if keep_others else {}
        for mapping in mappings:
            source = mapping.get("from", "")
            target = mapping.get("to") or source
            if not source:
                continue
            if "{{" in source:
                out[target] = resolve({**ctx, "_item": row, "item": row}, source)
                continue
            value = get_path(row, source)
            if keep_others and source != target and "." not in source:
                out.pop(source, None)
            out[target] = value
        return out

    if isinstance(data, list):
        return [map_row(r) for r in data]
    if isinstance(data, dict):
        for key in ("rows", "data", "items"):
            if isinstance(data.get(key), list):
                return [map_row(r) for r in data[key]]
        return map_row(data)
    return data


# =============================================================================
# Bifurcación (condiciones Sí/No y switch por valor)
# =============================================================================

_OPERATOR_ALIASES = {
    "greater_than": "gt", "greater_equal": "gte", "greater_or_equal": "gte",
    "less_than": "lt", "less_equal": "lte", "less_or_equal": "lte",
    "is_null": "is_empty", "is_not_null": "is_not_empty",
}
_UNARY = {"is_empty", "is_not_empty", "is_true", "is_false"}


def condition(ctx, rules, combine="and"):
    """Evalúa reglas (izquierda, operador, derecha) y elige la salida 'true' o 'false'."""
    evaluations = []
    for left, operator, right in rules:
        op = _OPERATOR_ALIASES.get(operator, operator or "equals")
        left_value = _operand(ctx, left)
        right_value = None if op in _UNARY else _operand(ctx, right)
        evaluations.append({"left": left, "operator": op, "right": right, "leftValue": left_value,
                            "rightValue": right_value, "passed": _evaluate(op, left_value, right_value)})
    passed = any(e["passed"] for e in evaluations) if combine == "or" else all(e["passed"] for e in evaluations)
    return {"mode": "if_else", "result": passed, "selectedHandle": "true" if passed else "false",
            "branchLabel": "Sí" if passed else "No", "combinator": combine, "evaluations": evaluations}


def switch(ctx, expression, cases):
    """Compara un valor con cada caso (id, valor, etiqueta); si ninguno coincide sale por 'default'."""
    value = _operand(ctx, expression)
    for case_id, case_value, label in cases:
        if _equal(value, _operand(ctx, case_value)):
            return {"mode": "switch", "result": case_value, "selectedHandle": f"case_{case_id}",
                    "branchLabel": label or case_value, "switchValue": value}
    return {"mode": "switch", "result": "default", "selectedHandle": "default",
            "branchLabel": "Por defecto", "switchValue": value}


def _operand(ctx, raw):
    if raw is None:
        return ""
    text = str(raw)
    if "{{" in text:
        return resolve(ctx, text)
    text = text.strip()
    quoted = re.fullmatch(r"(['\"])(.*)\1", text, flags=re.DOTALL)
    return quoted.group(2) if quoted else text


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _timestamp(value):
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}", value.strip()):
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def _text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=_json_default)
    return to_text(value).strip()


def _is_empty(value):
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _equal(a, b):
    na, nb = _number(a), _number(b)
    if na is not None and nb is not None:
        return na == nb
    return _text(a).lower() == _text(b).lower()


def _compare(a, b):
    na, nb = _number(a), _number(b)
    if na is not None and nb is not None:
        return na - nb
    ta, tb = _timestamp(a), _timestamp(b)
    if ta is not None and tb is not None:
        return ta - tb
    if a is None or b is None:
        return None
    left, right = _text(a).casefold(), _text(b).casefold()
    return (left > right) - (left < right)


def _evaluate(op, left, right):
    if op == "equals":
        return _equal(left, right)
    if op == "not_equals":
        return not _equal(left, right)
    if op in ("gt", "gte", "lt", "lte"):
        diff = _compare(left, right)
        if diff is None:
            return False
        return {"gt": diff > 0, "gte": diff >= 0, "lt": diff < 0, "lte": diff <= 0}[op]
    if op == "contains":
        if isinstance(left, list):
            return any(_equal(v, right) for v in left)
        return _text(right).lower() in _text(left).lower()
    if op == "not_contains":
        return not _evaluate("contains", left, right)
    if op == "starts_with":
        return _text(left).lower().startswith(_text(right).lower())
    if op == "ends_with":
        return _text(left).lower().endswith(_text(right).lower())
    if op == "in_list":
        options = right if isinstance(right, list) else [s.strip() for s in _text(right).split(",") if s.strip()]
        return any(_equal(left, v) for v in options)
    if op == "regex":
        try:
            return re.search(_text(right), _text(left), flags=re.IGNORECASE) is not None
        except re.error as error:
            raise ValueError(f"expresión regular inválida: {_text(right)}") from error
    if op == "is_empty":
        return _is_empty(left)
    if op == "is_not_empty":
        return not _is_empty(left)
    if op == "is_true":
        return left is True or _text(left).lower() in ("true", "1", "si", "sí", "yes")
    if op == "is_false":
        return left is False or _text(left).lower() in ("false", "0", "no")
    raise ValueError(f"operador de comparación desconocido: {op}")


# =============================================================================
# Webhook, OAuth2 e IA
# =============================================================================

def webhook_payload(sample=None):
    """
    Datos que dispararían el flujo por webhook. Pasa un archivo JSON con
    --payload archivo.json (o WEBHOOK_PAYLOAD_FILE en .env); si no, se usa el ejemplo.
    """
    path = os.getenv("WEBHOOK_PAYLOAD_FILE", "")
    if "--payload" in sys.argv:
        position = sys.argv.index("--payload")
        path = sys.argv[position + 1] if position + 1 < len(sys.argv) else path
    body = sample if sample is not None else {}
    if path:
        with open(path, "r", encoding="utf-8") as handle:
            body = json.load(handle)
    return {"body": body, "headers": {}, "query": {}, "timestamp": datetime.now().isoformat(), "manual": not path}


def oauth2_token(ctx, *, token_url, grant_type="client_credentials", client_id="", client_secret="",
                 scope="", auth_method="body", username="", password="", refresh_token="", timeout=30):
    """Obtiene un token OAuth2 y lo devuelve con 'authorization_header' listo para usar."""
    requests = _requests()
    client_id = to_text(resolve(ctx, client_id)).strip()
    params = {"grant_type": grant_type}
    headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
    if auth_method == "basic":
        headers["Authorization"] = "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    else:
        if client_id:
            params["client_id"] = client_id
        if client_secret:
            params["client_secret"] = client_secret
    scope = to_text(resolve(ctx, scope)).strip()
    if scope:
        params["scope"] = scope
    if grant_type == "password":
        params["username"] = to_text(resolve(ctx, username))
        params["password"] = password
    if grant_type == "refresh_token":
        params["refresh_token"] = refresh_token

    try:
        response = requests.post(to_text(resolve(ctx, token_url)), data=params, headers=headers, timeout=timeout)
    except requests.RequestException as error:
        raise ConnectionError(f"OAuth2: no se pudo conectar ({error})") from error
    if not response.ok:
        raise HttpError(response.status_code, f"OAuth2: el servidor respondió {response.status_code} - {response.text[:300]}")
    data = response.json()
    access_token = data.get("access_token") or data.get("token")
    if not access_token:
        raise ValueError("OAuth2: la respuesta no contiene access_token")
    token_type = str(data.get("token_type") or "Bearer")
    return {**data, "access_token": access_token, "token_type": token_type,
            "expires_in": int(data.get("expires_in") or 3600),
            "authorization_header": f"{token_type[:1].upper()}{token_type[1:]} {access_token}",
            "acquired_at": datetime.now().isoformat()}


def ai_chat(ctx, *, endpoint, model, prompt, system="", api_key="", temperature=0.7,
            max_tokens=None, json_output=False, timeout=120):
    """Llama a un endpoint compatible con OpenAI (chat/completions)."""
    requests = _requests()
    user_prompt = _text(resolve(ctx, prompt))
    if not user_prompt:
        raise ValueError("IA: el prompt del usuario está vacío (revisa las variables usadas)")
    messages = []
    system_prompt = _text(resolve(ctx, system))
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})

    body = {"model": to_text(resolve(ctx, model)), "messages": messages, "temperature": temperature}
    if max_tokens:
        body["max_tokens"] = max_tokens
    if json_output:
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    started = time.time()
    try:
        response = requests.post(to_text(resolve(ctx, endpoint)), json=body, headers=headers, timeout=timeout)
    except requests.RequestException as error:
        raise ConnectionError(f"IA: no se pudo conectar ({error})") from error
    if not response.ok:
        raise HttpError(response.status_code, f"IA: el proveedor respondió {response.status_code} - {response.text[:300]}")
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("IA: la respuesta no tiene el formato OpenAI esperado (choices vacío)")
    content = (choices[0].get("message") or {}).get("content") or ""
    parsed = _parse_json_content(content) if json_output or re.match(r"^\s*(\x60\x60\x60|\{|\[)", content) else None
    if json_output and parsed is None:
        raise ValueError("IA: se solicitó JSON pero el modelo devolvió texto no válido")
    return {"content": content, "parsed": parsed, "model": data.get("model", body["model"]),
            "finish_reason": choices[0].get("finish_reason"), "usage": data.get("usage"),
            "duration_ms": int((time.time() - started) * 1000)}


def _parse_json_content(content):
    fenced = re.search(r"\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60", content, flags=re.IGNORECASE)
    candidate = (fenced.group(1) if fenced else content).strip()
    try:
        return json.loads(candidate)
    except ValueError:
        return None
`;
