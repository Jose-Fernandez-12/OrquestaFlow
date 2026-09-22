import { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { getDb } from '../db/database.js';
import { transpileFlowToPython, TranspilerContext, TranspilerQueryInfo } from '../engine/pythonTranspiler.js';

export async function pythonExportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/:id/export-python', async (request, reply) => {
    const db = getDb();

    // Load flow
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(request.params.id) as any;
    if (!flow) {
      return reply.status(404).send({ error: 'Flow not found' });
    }

    let definition: { nodes: any[]; edges: any[] };
    try {
      definition = JSON.parse(flow.definition || '{"nodes":[],"edges":[]}');
    } catch {
      return reply.status(400).send({ error: 'Invalid flow definition' });
    }

    const nodes: any[] = definition.nodes || [];

    // Enrich query nodes with real SQL and connection info
    const ctx: TranspilerContext = { queries: {} };

    const queryNodes = nodes.filter(n => n.type === 'query');
    for (const qNode of queryNodes) {
      const queryId = qNode.data?.queryId as string;
      if (queryId) {
        if (ctx.queries[queryId]) continue; // already loaded

        const queryInfo = db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId) as any;
        if (queryInfo) {
          let connectionIds: string[] = [];
          try {
            connectionIds = JSON.parse(queryInfo.connection_ids || '[]');
          } catch { }

          let connections = connectionIds
            .map(cid => db.prepare('SELECT * FROM connections WHERE id = ?').get(cid) as any)
            .filter(Boolean);

          if (connections.length === 0) {
            const anyConn = db.prepare('SELECT * FROM connections LIMIT 1').get() as any;
            if (anyConn) connections = [anyConn];
          }

          const transpilerQueryInfo: TranspilerQueryInfo = {
            id: queryInfo.id,
            name: queryInfo.name,
            sql_text: queryInfo.sql_text,
            params: queryInfo.params || '[]',
            connections: connections.map((c: any) => ({
              id: c.id,
              name: c.name,
              host: c.host,
              database_name: c.database_name,
              port: Number(c.port || 1433),
              env_credential_key: c.env_credential_key || 'SQLSERVER',
              driver: c.driver || 'ODBC Driver 17 for SQL Server',
            })),
          };

          ctx.queries[queryId] = transpilerQueryInfo;
        }
      } else if (qNode.data?.sql || qNode.data?.sql_text) {
        // Direct query defined on node
        const directSql = qNode.data.sql || qNode.data.sql_text;
        const fakeId = qNode.id;
        const anyConn = db.prepare('SELECT * FROM connections LIMIT 1').get() as any;
        ctx.queries[fakeId] = {
          id: fakeId,
          name: qNode.data.label || 'Consulta SQL',
          sql_text: directSql,
          params: '[]',
          connections: anyConn ? [{
            id: anyConn.id,
            name: anyConn.name,
            host: anyConn.host,
            database_name: anyConn.database_name,
            port: Number(anyConn.port || 1433),
            env_credential_key: anyConn.env_credential_key || 'SQLSERVER',
            driver: anyConn.driver || 'ODBC Driver 17 for SQL Server',
          }] : []
        };
        qNode.data.queryId = fakeId;
      }
    }

    try {
      const { script, requirementsTxt, envExample, readmeMd, sqlFiles } = transpileFlowToPython(flow.name, definition, ctx);
      const slug = flow.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'flujo';
      const scriptFileName = `${slug}_flow.py`;
      const zipFileName = `${slug}_bundle.zip`;

      const zip = new JSZip();

      // 1. Python executable script
      zip.file(scriptFileName, script);

      // 2. Python requirements.txt
      zip.file('requirements.txt', requirementsTxt);

      // 3. Environment variables template with DB connections and hosts
      zip.file('.env.example', envExample);

      // 4. Instructions and documentation
      zip.file('README.md', readmeMd);

      // 5. Query files in queries/ folder
      if (sqlFiles && sqlFiles.length > 0) {
        for (const sf of sqlFiles) {
          zip.file(`queries/${sf.fileName}`, sf.sql);
        }
      }

      // 6. Complete flow data (definition and queries metadata)
      const flowData = {
        id: flow.id,
        name: flow.name,
        description: flow.description || '',
        created_at: flow.created_at,
        updated_at: flow.updated_at,
        definition,
        queries: ctx.queries
      };
      zip.file('flow.json', JSON.stringify(flowData, null, 2));

      // Generate binary buffer for ZIP
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${zipFileName}"`)
        .header('Access-Control-Expose-Headers', 'Content-Disposition')
        .send(zipBuffer);
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: `Error al generar el paquete ZIP: ${err.message}` });
    }
  });
}
