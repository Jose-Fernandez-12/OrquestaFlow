import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import initSqlJs from 'sql.js';
import { getDb } from '../src/db/database';
import { executeFlowEngine, validateHttpUrl } from '../src/engine/executor';
import { ExecutionTracer } from '../src/engine/executionLog';
import { PYTHON_RUNTIME } from '../src/engine/python/runtime';
import { transpileFlowToPython } from '../src/engine/pythonTranspiler';
import { runSchedule } from '../src/engine/scheduler';
import { validateSqliteFilePath } from '../src/engine/sqlite';
import { connectionRoutes } from '../src/routes/connections';
import { environmentRoutes } from '../src/routes/environments';
import { executionRoutes } from '../src/routes/executions';
import { flowRoutes } from '../src/routes/flows';
import { scheduleRoutes } from '../src/routes/schedules';
import { scriptRoutes } from '../src/routes/scripts';
import { isUnsafeSqlitePath } from '../src/security/access';
import { createFlow, edge, jsonResponse, setupDb } from './helpers';

beforeAll(() => setupDb());

const startNode = { id: 'start', type: 'start', data: { label: 'Inicio' } };
const uploadedFilesToClean: string[] = [];
const tempDirsToClean: string[] = [];

beforeEach(() => {
  const db = getDb();
  db.exec(`
    DELETE FROM webhook_logs;
    DELETE FROM execution_logs;
    DELETE FROM schedules;
    DELETE FROM queries;
    DELETE FROM connections;
    DELETE FROM flow_versions;
    DELETE FROM flows;
  `);
});

afterEach(() => {
  vi.restoreAllMocks();
  while (uploadedFilesToClean.length > 0) {
    const filePath = uploadedFilesToClean.pop()!;
    fs.rmSync(filePath, { force: true });
  }
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildMultipart(filename: string, content: string, contentType = 'text/plain') {
  const boundary = '----orquestaBoundaryV21Test';
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return {
    payload: Buffer.from(body, 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('security guards: SQLite/dataSource/connections path traversal, script upload whitelist, SSRF, ODBC escaping', () => {
  it('blocks SQLite path traversal and internal orquesta.sqlite access across engine and connections API', async () => {
    for (const bad of ['', '../secret.sqlite', '..\\secret.sqlite', 'dir/../other.sqlite', 'data/orquesta.sqlite', '/opt/db/orquesta.sqlite']) {
      expect(isUnsafeSqlitePath(bad)).toBe(true);
      expect(() => validateSqliteFilePath(bad)).toThrow();
    }
    expect(isUnsafeSqlitePath('data\\orquesta.sqlite')).toBe(true);
    expect(isUnsafeSqlitePath('data/clientes.sqlite')).toBe(false);
    expect(validateSqliteFilePath('data/clientes.sqlite')).toBe(path.resolve('data/clientes.sqlite'));

    const app = Fastify();
    await app.register(connectionRoutes, { prefix: '/api/connections' });
    try {
      const badCreate = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: { name: 'Bad SQLite', region: 'Local', host: '../evil.sqlite', driver: 'sqlite' },
      });
      expect(badCreate.statusCode).toBe(400);

      const badCreateInternal = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: { name: 'Internal', region: 'Local', host: 'data/orquesta.sqlite', driver: 'sqlite' },
      });
      expect(badCreateInternal.statusCode).toBe(400);

      const okCreate = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: { name: 'Valid SQLite', region: 'Local', host: path.join(os.tmpdir(), 'safe_nonexistent.sqlite'), driver: 'sqlite' },
      });
      expect(okCreate.statusCode).toBe(200);
      const connId = okCreate.json().data.id;

      const badUpdate = await app.inject({
        method: 'PUT',
        url: `/api/connections/${connId}`,
        payload: { host: 'sub/../../orquesta.sqlite' },
      });
      expect(badUpdate.statusCode).toBe(400);

      getDb().prepare('INSERT INTO connections (id, name, region, host, database_name, port, driver) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('legacy_bad_conn', 'Legacy Bad', 'Local', 'data/orquesta.sqlite', 'sqlite', 0, 'sqlite');
      const badTest = await app.inject({ method: 'POST', url: '/api/connections/legacy_bad_conn/test' });
      expect(badTest.statusCode).toBe(400);
    } finally {
      await app.close();
    }

    for (const unsafeFile of ['../outside.csv', 'data/orquesta.sqlite', '/etc/passwd']) {
      const flowId = createFlow(
        [startNode, { id: 'ds', type: 'dataSource', data: { label: 'Archivo', filePath: unsafeFile } }],
        [edge('start', 'ds')]
      );
      await expect(executeFlowEngine(flowId)).rejects.toThrow(/no permitida|orquesta\.sqlite|fuera de los directorios permitidos/i);
    }
  });

  it('enforces .py/.js whitelist on script upload', async () => {
    const app = Fastify();
    await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
    await app.register(scriptRoutes, { prefix: '/api/scripts' });

    try {
      for (const badName of ['payload.sh', 'malware.exe', 'notes.txt', '../evil.sh']) {
        const form = buildMultipart(badName, 'echo nope');
        const res = await app.inject({ method: 'POST', url: '/api/scripts/upload', ...form });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/\.py.*\.js/i);
      }

      const pyForm = buildMultipart('mi_script.py', 'print("ok")\n');
      const pyRes = await app.inject({ method: 'POST', url: '/api/scripts/upload', ...pyForm });
      expect(pyRes.statusCode).toBe(200);
      const pyScript = pyRes.json().data;
      expect(pyScript.language).toBe('python');
      expect(pyScript.file_path).toMatch(/^scripts\/.*_mi_script\.py$/);
      uploadedFilesToClean.push(path.join(process.cwd(), 'uploads', pyScript.file_path));

      const jsForm = buildMultipart('helper.js', 'console.log("ok");\n');
      const jsRes = await app.inject({ method: 'POST', url: '/api/scripts/upload', ...jsForm });
      expect(jsRes.statusCode).toBe(200);
      const jsScript = jsRes.json().data;
      expect(jsScript.language).toBe('javascript');
      uploadedFilesToClean.push(path.join(process.cwd(), 'uploads', jsScript.file_path));
    } finally {
      await app.close();
    }
  });

  it('blocks non-HTTP(S) URLs and cloud metadata hosts in validateHttpUrl and HTTP nodes', async () => {
    expect(validateHttpUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
    expect(validateHttpUrl('http://localhost:3001/ping').port).toBe('3001');

    for (const badUrl of [
      'file:///etc/passwd',
      'ftp://example.com/file',
      'javascript:alert(1)',
      'not a url',
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.10.20/token',
      'http://metadata.google.internal/computeMetadata/v1/',
      'https://metadata.goog/computeMetadata/v1/',
    ]) {
      expect(() => validateHttpUrl(badUrl)).toThrow();
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const flowId = createFlow(
      [startNode, { id: 'http', type: 'httpRequest', data: { label: 'Meta', method: 'GET', endpoint: 'http://169.254.169.254/latest/meta-data/' } }],
      [edge('start', 'http')]
    );
    await expect(executeFlowEngine(flowId)).rejects.toThrow(/metadatos|no permitido/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('escapes special ODBC characters (;, {, }) in python/runtime.ts _escape_odbc_value and _connection_string', () => {
    const pyCheck = `
import json, os, types
ns = {"__file__": "/tmp/orquesta_runtime.py"}
exec(open(0, encoding="utf-8").read(), ns)
ns["_DATABASES"]["PROD"] = {"host": "db.internal", "port": 1433, "database": "sales;v1}", "driver": "ODBC Driver 17} for SQL Server"}
os.environ["DB_USER_PROD"] = "svc{user}"
os.environ["DB_PASSWORD_PROD"] = "p@ss;with}braces{!"
print(json.dumps({
  "escaped": ns["_escape_odbc_value"]("a;b{c}d"),
  "plain": ns["_escape_odbc_value"]("simple"),
  "conn_str": ns["_connection_string"]("PROD"),
}))
`;
    const combinedInput = PYTHON_RUNTIME;
    const stdout = execFileSync('python3', ['-c', pyCheck], {
      input: combinedInput,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.escaped).toBe('{a;b{c}}d}');
    expect(parsed.plain).toBe('simple');
    expect(parsed.conn_str).toContain('DRIVER={ODBC Driver 17}} for SQL Server}');
    expect(parsed.conn_str).toContain('DATABASE={sales;v1}}}');
    expect(parsed.conn_str).toContain('UID={svc{user}}}');
    expect(parsed.conn_str).toContain('PWD={p@ss;with}}braces{!}');
  });
});

describe('v2.1 engine features: error_branch, DLQ failed_items, mockEnabled, forEach concurrency, $env, publish/unpublish', () => {
  it('routes failed node along error_branch with $error populated and skips the normal branch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Upstream boom', { status: 502, statusText: 'Bad Gateway' }));

    const flowId = createFlow(
      [
        startNode,
        {
          id: 'api',
          type: 'httpRequest',
          data: { label: 'Pago externo', method: 'GET', endpoint: 'https://api.example.test/pay', onError: 'error_branch', retryCount: 0 },
        },
        {
          id: 'okBranch',
          type: 'dataList',
          data: { label: 'OK', items: '[{"status":"ok"}]' },
        },
        {
          id: 'errBranch',
          type: 'variables',
          data: {
            label: 'Catch',
            variables: [
              { key: 'msg', type: 'string', value: '{{$error.message}}' },
              { key: 'failedNode', type: 'string', value: '{{$error.nodeId}}' },
              { key: 'failedLabel', type: 'string', value: '{{$error.nodeLabel}}' },
            ],
          },
        },
      ],
      [
        edge('start', 'api'),
        edge('api', 'okBranch'),
        edge('api', 'errBranch', { sourceHandle: 'error' }),
      ]
    );

    const tracer = new ExecutionTracer();
    const ctx = await executeFlowEngine(flowId, undefined, { tracer });

    expect(ctx.okBranch).toBeUndefined();
    expect(ctx.$error).toMatchObject({ nodeId: 'api', nodeLabel: 'Pago externo' });
    expect(String(ctx.$error.message)).toContain('502');
    expect(ctx.errBranch).toEqual({
      msg: ctx.$error.message,
      failedNode: 'api',
      failedLabel: 'Pago externo',
    });

    const trace = tracer.toJSON('completed');
    const apiTrace = trace.find(t => t.nodeId === 'api')!;
    const okTrace = trace.find(t => t.nodeId === 'okBranch')!;
    expect(apiTrace.status).toBe('continued');
    expect(apiTrace.errorBranch).toBe(true);
    expect(okTrace.status).toBe('skipped');
  });

  it('collects DLQ failed_items in forEach when iterations fail with onError=continue', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/2')) {
        return new Response('Item 2 rejected', { status: 422, statusText: 'Unprocessable Entity' });
      }
      return jsonResponse({ ok: true, url });
    });

    const flowId = createFlow(
      [
        startNode,
        { id: 'items', type: 'dataList', data: { label: 'Items', items: '[{"id":1},{"id":2},{"id":3}]' } },
        { id: 'loop', type: 'forEach', data: { label: 'Loop', iterateOver: '{{items}}', concurrency: 1, onError: 'continue' } },
        { id: 'call', type: 'httpRequest', data: { label: 'Call', method: 'GET', endpoint: 'https://api.example.test/items/{{_item.id}}', retryCount: 0 } },
        { id: 'endLoop', type: 'forEachEnd', data: { label: 'End' } },
      ],
      [
        edge('start', 'items'),
        edge('items', 'loop'),
        edge('loop', 'call'),
        edge('call', 'endLoop'),
      ]
    );

    const tracer = new ExecutionTracer();
    const ctx = await executeFlowEngine(flowId, undefined, { tracer });

    expect(ctx.endLoop).toHaveLength(2);
    expect(ctx.endLoop.map((r: any) => r.url)).toEqual([
      'https://api.example.test/items/1',
      'https://api.example.test/items/3',
    ]);
    expect(ctx.loop.failed_items).toHaveLength(1);
    expect(ctx.loop.failed_items[0]).toMatchObject({ index: 1, item: { id: 2 } });
    expect(String(ctx.loop.failed_items[0].error)).toContain('422');
    expect(ctx.endLoop.failed_items).toHaveLength(1);

    const loopTrace = tracer.toJSON('completed').find(t => t.nodeId === 'loop')!;
    expect(loopTrace.failedItems).toHaveLength(1);
  });

  it('returns mockOutput without external call and sets mocked: true in ExecutionTracer when mockEnabled is true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const flowId = createFlow(
      [
        startNode,
        {
          id: 'api',
          type: 'httpRequest',
          data: {
            label: 'Mocked API',
            method: 'GET',
            endpoint: 'https://api.example.test/never-called',
            mockEnabled: true,
            mockOutput: '{"items":[{"id":99}],"cached":true}',
          },
        },
        {
          id: 'vars',
          type: 'variables',
          data: {
            label: 'ReadMock',
            variables: [{ key: 'firstId', type: 'number', value: '{{api.items[0].id}}' }],
          },
        },
      ],
      [edge('start', 'api'), edge('api', 'vars')]
    );

    const tracer = new ExecutionTracer();
    const ctx = await executeFlowEngine(flowId, undefined, { tracer });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.api).toEqual({ items: [{ id: 99 }], cached: true });
    expect(ctx.vars.firstId).toBe(99);
    const apiTrace = tracer.toJSON('completed').find(t => t.nodeId === 'api')!;
    expect(apiTrace.mocked).toBe(true);
  });

  it('executes forEach iterations in bounded parallel batches respecting concurrency while preserving order', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      try {
        await new Promise(resolve => setTimeout(resolve, 25));
        const id = Number(String(input).split('/').pop());
        return jsonResponse({ id });
      } finally {
        inFlight--;
      }
    });

    const flowId = createFlow(
      [
        startNode,
        { id: 'items', type: 'dataList', data: { label: 'Batch', items: '[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":6}]' } },
        { id: 'loop', type: 'forEach', data: { label: 'ParallelLoop', iterateOver: '{{items}}', concurrency: 3, rateLimitMs: 0 } },
        { id: 'req', type: 'httpRequest', data: { label: 'Req', method: 'GET', endpoint: 'https://api.example.test/batch/{{_item.id}}' } },
        { id: 'endLoop', type: 'forEachEnd', data: { label: 'End' } },
      ],
      [edge('start', 'items'), edge('items', 'loop'), edge('loop', 'req'), edge('req', 'endLoop')]
    );

    const ctx = await executeFlowEngine(flowId);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(ctx.endLoop.map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('supports environments CRUD, prevents deleting the active environment, and resolves {{$env.*}} in flows', async () => {
    const app = Fastify();
    await app.register(environmentRoutes, { prefix: '/api/environments' });

    let createdEnvId = '';
    const origActiveRes = await app.inject({ method: 'GET', url: '/api/environments/active' });
    expect(origActiveRes.statusCode).toBe(200);
    const origActiveId = origActiveRes.json().data.id;

    try {
      const listRes = await app.inject({ method: 'GET', url: '/api/environments' });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().data.length).toBeGreaterThanOrEqual(3);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/environments',
        payload: { name: 'QA V21', variables: { API_BASE: 'https://qa.example.test', ENV_TOKEN: 'qa-secret-1' } },
      });
      expect(createRes.statusCode).toBe(200);
      createdEnvId = createRes.json().data.id;
      expect(createRes.json().data.slug).toBe('qa-v21');

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/environments/${createdEnvId}`,
        payload: { variables: { API_BASE: 'https://qa2.example.test', ENV_TOKEN: 'qa-secret-2' } },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().data.variables.API_BASE).toBe('https://qa2.example.test');

      const activateRes = await app.inject({ method: 'POST', url: `/api/environments/${createdEnvId}/activate` });
      expect(activateRes.statusCode).toBe(200);
      expect(activateRes.json().data.is_active).toBe(1);

      const delActive = await app.inject({ method: 'DELETE', url: `/api/environments/${createdEnvId}` });
      expect(delActive.statusCode).toBe(409);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
      const flowId = createFlow(
        [
          startNode,
          {
            id: 'vars',
            type: 'variables',
            data: { label: 'Vars', variables: [{ key: 'base', type: 'string', value: '{{$env.API_BASE}}' }] },
          },
          {
            id: 'http',
            type: 'httpRequest',
            data: {
              label: 'Call',
              method: 'POST',
              endpoint: '{{$env.API_BASE}}/ping',
              authType: 'bearer',
              authToken: '{{$env.ENV_TOKEN}}',
              body: '{"base":"{{$env.API_BASE}}"}',
            },
          },
        ],
        [edge('start', 'vars'), edge('vars', 'http')]
      );

      const ctx = await executeFlowEngine(flowId);
      expect(ctx.vars.base).toBe('https://qa2.example.test');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe('https://qa2.example.test/ping');
      expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer qa-secret-2' });
      expect(JSON.parse(String((calledInit as RequestInit).body))).toEqual({ base: 'https://qa2.example.test' });

      await app.inject({ method: 'POST', url: `/api/environments/${origActiveId}/activate` });
      const delInactive = await app.inject({ method: 'DELETE', url: `/api/environments/${createdEnvId}` });
      expect(delInactive.statusCode).toBe(200);
      expect(delInactive.json().data.deleted).toBe(true);
      createdEnvId = '';
    } finally {
      await app.inject({ method: 'POST', url: `/api/environments/${origActiveId}/activate` });
      if (createdEnvId) {
        await app.inject({ method: 'DELETE', url: `/api/environments/${createdEnvId}` });
      }
      await app.close();
    }
  });

  it('publishes and unpublishes flow snapshots while draft changes stay isolated for published callers', async () => {
    const app = Fastify();
    await app.register(flowRoutes, { prefix: '/api/flows' });

    const defV1 = JSON.stringify({
      nodes: [startNode, { id: 'out', type: 'dataList', data: { label: 'Out', items: '[{"version":"v1"}]' } }],
      edges: [edge('start', 'out')],
    });
    const defV2 = JSON.stringify({
      nodes: [startNode, { id: 'out', type: 'dataList', data: { label: 'Out', items: '[{"version":"v2-draft"}]' } }],
      edges: [edge('start', 'out')],
    });

    try {
      const created = (await app.inject({ method: 'POST', url: '/api/flows', payload: { name: 'PubFlow', definition: defV1 } })).json().data;
      const snapRes = await app.inject({ method: 'POST', url: `/api/flows/${created.id}/versions`, payload: { note: 'v1 release' } });
      expect(snapRes.statusCode).toBe(200);
      const versions = (await app.inject({ method: 'GET', url: `/api/flows/${created.id}/versions` })).json().data;
      expect(versions.length).toBeGreaterThanOrEqual(1);
      const v1Id = snapRes.json().data.id;

      const pubRes = await app.inject({ method: 'POST', url: `/api/flows/${created.id}/versions/${v1Id}/publish` });
      expect(pubRes.statusCode).toBe(200);
      expect(pubRes.json().data.published_version_id).toBe(v1Id);

      // Modify draft to v2 without publishing
      await app.inject({ method: 'PUT', url: `/api/flows/${created.id}`, payload: { definition: defV2 } });

      // Draft execution uses v2, while usePublished (and scheduler) still runs v1
      const draftCtx = await executeFlowEngine(created.id);
      expect(draftCtx.out).toEqual([{ version: 'v2-draft' }]);

      const pubCtx = await executeFlowEngine(created.id, undefined, { usePublished: true });
      expect(pubCtx.out).toEqual([{ version: 'v1' }]);

      // Unpublish -> usePublished falls back to current draft v2
      const unpubRes = await app.inject({ method: 'POST', url: `/api/flows/${created.id}/unpublish` });
      expect(unpubRes.statusCode).toBe(200);
      expect(unpubRes.json().data.published_version_id).toBeNull();

      const afterUnpubCtx = await executeFlowEngine(created.id, undefined, { usePublished: true });
      expect(afterUnpubCtx.out).toEqual([{ version: 'v2-draft' }]);
    } finally {
      await app.close();
    }
  });
});

describe('webhooks, /api/executions, scheduler query target, and runFlow Python transpiler', () => {
  it('handles sync webhookRespond (body & bodyTemplate fallback), HMAC auth, Idempotency-Key replay, and webhook-logs', async () => {
    const app = Fastify();
    await app.register(flowRoutes, { prefix: '/api/flows' });

    const secret = 'super-webhook-secret';
    const syncDef = JSON.stringify({
      nodes: [
        { id: 'trig', type: 'webhookTrigger', data: { label: 'Trig', webhookId: 'wh-orders-sync', responseMode: 'sync', httpMethod: 'POST', secret } },
        { id: 'vars', type: 'variables', data: { label: 'Vars', variables: [{ key: 'order', type: 'string', value: '{{trig.body.orderId}}' }] } },
        {
          id: 'resp',
          type: 'webhookRespond',
          data: {
            label: 'Resp',
            statusCode: 201,
            headers: '{"X-Order-Reply": "ok-{{vars.order}}"}',
            body: '{"ok": true, "orderId": "{{vars.order}}"}',
          },
        },
      ],
      edges: [edge('trig', 'vars'), edge('vars', 'resp')],
    });

    const fallbackDef = JSON.stringify({
      nodes: [
        { id: 'trig', type: 'webhookTrigger', data: { label: 'Trig', webhookId: 'wh-legacy-bodytpl', responseMode: 'sync', httpMethod: 'POST' } },
        {
          id: 'resp',
          type: 'webhookRespond',
          data: { statusCode: 202, bodyTemplate: '{"legacyBodyTemplate": true, "who": "{{trig.body.name}}"}' },
        },
      ],
      edges: [edge('trig', 'resp')],
    });

    try {
      const flow = (await app.inject({ method: 'POST', url: '/api/flows', payload: { name: 'Webhook Sync', definition: syncDef } })).json().data;
      const bodyStr = JSON.stringify({ orderId: 'ORD-77' });
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

      const wrongMethod = await app.inject({ method: 'GET', url: '/api/flows/webhook/wh-orders-sync' });
      expect(wrongMethod.statusCode).toBe(405);

      const unauth = await app.inject({
        method: 'POST',
        url: '/api/flows/webhook/wh-orders-sync',
        headers: { 'content-type': 'application/json' },
        payload: bodyStr,
      });
      expect(unauth.statusCode).toBe(401);

      const first = await app.inject({
        method: 'POST',
        url: '/api/flows/webhook/wh-orders-sync',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': sig,
          'idempotency-key': 'idem-key-001',
        },
        payload: bodyStr,
      });
      expect(first.statusCode).toBe(201);
      expect(first.headers['x-order-reply']).toBe('ok-ORD-77');
      expect(first.headers['x-idempotent-replay']).toBeUndefined();
      expect(first.json()).toEqual({ ok: true, orderId: 'ORD-77' });

      const replay = await app.inject({
        method: 'POST',
        url: '/api/flows/webhook/wh-orders-sync',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': sig,
          'idempotency-key': 'idem-key-001',
        },
        payload: bodyStr,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json()).toEqual({ ok: true, orderId: 'ORD-77' });

      const execLogs = getDb().prepare('SELECT id FROM execution_logs WHERE target_id = ?').all(flow.id);
      expect(execLogs).toHaveLength(1);

      const logsRes = await app.inject({ method: 'GET', url: `/api/flows/${flow.id}/webhook-logs` });
      expect(logsRes.statusCode).toBe(200);
      expect(logsRes.json().data).toHaveLength(1);
      expect(logsRes.json().data[0]).toMatchObject({
        webhook_id: 'wh-orders-sync',
        status_code: 201,
        idempotency_key: 'idem-key-001',
      });

      // Legacy bodyTemplate compatibility
      await app.inject({ method: 'POST', url: '/api/flows', payload: { name: 'Legacy Webhook', definition: fallbackDef } });
      const legacyRes = await app.inject({
        method: 'POST',
        url: '/api/flows/webhook/wh-legacy-bodytpl',
        payload: { name: 'Ana' },
      });
      expect(legacyRes.statusCode).toBe(202);
      expect(legacyRes.json()).toEqual({ legacyBodyTemplate: true, who: 'Ana' });
    } finally {
      await app.close();
    }
  });

  it('lists executions, returns detail with subflow children & failed_items, and cancels running flows via /api/executions', async () => {
    const app = Fastify();
    await app.register(flowRoutes, { prefix: '/api/flows' });
    await app.register(executionRoutes, { prefix: '/api/executions' });

    try {
      const childFlowId = createFlow(
        [startNode, { id: 'childOut', type: 'dataList', data: { label: 'ChildOut', items: '[{"x":1}]' } }],
        [edge('start', 'childOut')]
      );
      const parentFlowId = createFlow(
        [startNode, { id: 'sub', type: 'runFlow', data: { label: 'RunChild', targetFlowId: childFlowId, flowParams: [] } }],
        [edge('start', 'sub')]
      );

      const execRes = await app.inject({ method: 'POST', url: `/api/flows/${parentFlowId}/execute`, payload: {} });
      expect(execRes.statusCode).toBe(200);
      const parentLogId = execRes.json().data.logId;

      const listRes = await app.inject({ method: 'GET', url: '/api/executions?target_type=flow&status=completed' });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().summary.completed).toBeGreaterThanOrEqual(2);

      const detailRes = await app.inject({ method: 'GET', url: `/api/executions/${parentLogId}` });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json().data;
      expect(detail.node_trace.some((n: any) => n.nodeId === 'sub' && n.status === 'completed')).toBe(true);
      expect(detail.children).toHaveLength(1);
      expect(detail.children[0]).toMatchObject({
        target_id: childFlowId,
        parent_execution_id: parentLogId,
        status: 'completed',
      });

      // Verify DLQ failed_items propagation through POST /api/flows/:id/execute -> GET /api/executions/:id
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).endsWith('/bad')) {
          return new Response('Item failed', { status: 500, statusText: 'Server Error' });
        }
        return jsonResponse({ ok: true });
      });
      const dlqFlowId = createFlow(
        [
          startNode,
          { id: 'list', type: 'dataList', data: { label: 'List', items: '[{"slug":"ok"},{"slug":"bad"}]' } },
          { id: 'loop', type: 'forEach', data: { label: 'DLQLoop', iterateOver: '{{list}}', onError: 'continue' } },
          { id: 'req', type: 'httpRequest', data: { label: 'Req', method: 'GET', endpoint: 'https://api.example.test/{{_item.slug}}', retryCount: 0 } },
          { id: 'endLoop', type: 'forEachEnd', data: { label: 'EndLoop' } },
        ],
        [edge('start', 'list'), edge('list', 'loop'), edge('loop', 'req'), edge('req', 'endLoop')]
      );
      const dlqExecRes = await app.inject({ method: 'POST', url: `/api/flows/${dlqFlowId}/execute`, payload: {} });
      expect(dlqExecRes.statusCode).toBe(200);
      const dlqLogId = dlqExecRes.json().data.logId;
      const dlqDetailRes = await app.inject({ method: 'GET', url: `/api/executions/${dlqLogId}` });
      expect(dlqDetailRes.statusCode).toBe(200);
      expect(dlqDetailRes.json().data.has_failed_items).toBe(true);
      expect(dlqDetailRes.json().data.failed_items).toHaveLength(1);
      expect(dlqDetailRes.json().data.failed_items[0]).toMatchObject({ index: 1, item: { slug: 'bad' } });
      const dlqListRes = await app.inject({ method: 'GET', url: `/api/executions?search=${dlqLogId}` });
      expect(dlqListRes.statusCode).toBe(200);
      expect(dlqListRes.json().data[0]).toMatchObject({ id: dlqLogId, has_failed_items: true, failed_items_count: 1 });
      vi.restoreAllMocks();

      // Test cancelling an active running flow
      let fetchStartedResolve!: () => void;
      const fetchStarted = new Promise<void>(r => { fetchStartedResolve = r; });
      vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        fetchStartedResolve();
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err: any = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        });
      });

      const slowFlowId = createFlow(
        [startNode, { id: 'slowHttp', type: 'httpRequest', data: { label: 'Slow', method: 'GET', endpoint: 'https://slow.example.test/job', retryCount: 0 } }],
        [edge('start', 'slowHttp')]
      );

      const slowExecPromise = app.inject({ method: 'POST', url: `/api/flows/${slowFlowId}/execute`, payload: {} });
      await fetchStarted;

      const runningRow = getDb().prepare("SELECT id FROM execution_logs WHERE target_id = ? AND status = 'running' LIMIT 1")
        .get(slowFlowId) as { id: string } | undefined;
      expect(runningRow?.id).toBeTruthy();

      const cancelRes = await app.inject({ method: 'POST', url: `/api/executions/${runningRow!.id}/cancel` });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().data).toMatchObject({
        cancelled: true,
        engineCancelled: true,
        status: 'cancelled',
      });

      await slowExecPromise;
      const afterRow = getDb().prepare('SELECT status FROM execution_logs WHERE id = ?').get(runningRow!.id) as { status: string };
      expect(afterRow.status).toBe('cancelled');

      const cancelAgain = await app.inject({ method: 'POST', url: `/api/executions/${runningRow!.id}/cancel` });
      expect(cancelAgain.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('executes scheduled target_type="query" in scheduler.ts and supports CRUD in /api/schedules', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orquesta-sched-query-'));
    tempDirsToClean.push(tmpDir);
    const sqliteFile = path.join(tmpDir, 'sales.sqlite');

    const SQL = await initSqlJs();
    const extDb = new SQL.Database();
    extDb.run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, "Uno"), (2, "Dos");');
    fs.writeFileSync(sqliteFile, Buffer.from(extDb.export()));
    extDb.close();

    const db = getDb();
    db.prepare('INSERT INTO connections (id, name, region, host, database_name, port, driver) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('conn_sqlite_1', 'Sales SQLite', 'Local', sqliteFile, 'sqlite', 0, 'sqlite');
    db.prepare('INSERT INTO queries (id, name, sql_text, connection_ids) VALUES (?, ?, ?, ?)')
      .run('query_sched_1', 'Listar items', 'SELECT id, name FROM items ORDER BY id', JSON.stringify(['conn_sqlite_1']));

    const app = Fastify();
    await app.register(scheduleRoutes, { prefix: '/api/schedules' });
    let scheduleId = '';
    try {
      const createdRes = await app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { target_type: 'query', target_id: 'query_sched_1', name: 'Job Query', cron_expression: '0 8 * * *' },
      });
      expect(createdRes.statusCode).toBe(200);
      const schedule = createdRes.json().data;
      scheduleId = schedule.id;
      expect(schedule.target_type).toBe('query');

      await runSchedule(schedule, 'schedule');

      const logs = db.prepare("SELECT * FROM execution_logs WHERE schedule_id = ? AND target_type = 'query'").all(scheduleId) as Array<Record<string, any>>;
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('completed');
      expect(logs[0].record_count).toBe(2);
      expect(JSON.parse(logs[0].result)).toMatchObject({
        connection_ids: ['conn_sqlite_1'],
        columns: ['id', 'name'],
        rowCount: 2,
      });

      const updatedQuery = db.prepare('SELECT last_run_at, last_row_count FROM queries WHERE id = ?').get('query_sched_1') as any;
      expect(updatedQuery.last_row_count).toBe(2);
      expect(updatedQuery.last_run_at).toBeTruthy();
    } finally {
      if (scheduleId) {
        await app.inject({ method: 'DELETE', url: `/api/schedules/${scheduleId}` });
      }
      await app.close();
    }
  });

  it('transpiles runFlow subflows and detects circular subflow recursion cleanly', () => {
    const out = transpileFlowToPython(
      'Flujo Padre',
      {
        nodes: [
          { id: 'start', type: 'start', data: { label: 'Inicio' } },
          { id: 'vars', type: 'variables', data: { label: 'Entrada', variables: [{ key: 'cliente', type: 'string', value: 'ACME' }] } },
          {
            id: 'callSub',
            type: 'runFlow',
            data: {
              label: 'Invocar Hijo',
              targetFlowId: 'sub_1',
              targetFlowName: 'Subflujo Calculo',
              outputNodeId: 'calc',
              flowParams: [{ key: 'nombre', value: '{{vars.cliente}}' }],
            },
          },
        ],
        edges: [edge('start', 'vars'), edge('vars', 'callSub')],
      },
      {
        queries: {},
        flows: {
          sub_1: {
            id: 'sub_1',
            name: 'Subflujo Calculo',
            definition: {
              nodes: [
                { id: 's', type: 'start', data: { label: 'Inicio' } },
                { id: 'calc', type: 'dataList', data: { label: 'Calculo', items: '[{"ok":true}]' } },
                { id: 'self', type: 'runFlow', data: { label: 'Recursion', targetFlowId: 'sub_1', targetFlowName: 'Subflujo Calculo' } },
              ],
              edges: [edge('s', 'calc'), edge('calc', 'self')],
            },
          },
        },
      }
    );

    expect(out.script).toContain('def _run_subflow_');
    expect(out.script).toContain('_sub_res = _run_subflow_');
    expect(out.script).toContain('"nombre": resolve(ctx, "{{vars.cliente}}")');
    expect(out.script).toContain('_out_id = "calc"');
    expect(out.script).toContain('Llamada recursiva circular detectada');

    const tmpPyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orquesta-py-compile-'));
    tempDirsToClean.push(tmpPyDir);
    const pyPath = path.join(tmpPyDir, 'padre_flow.py');
    fs.writeFileSync(pyPath, out.script);
    execFileSync('python3', ['-m', 'py_compile', pyPath], { encoding: 'utf8' });
  });
});
