import { getDb } from '../db/database.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import mssql from 'mssql';

// Simple topological sort
export function sortNodes(nodes: any[], edges: any[]): any[] {
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};

  nodes.forEach(node => {
    inDegree[node.id] = 0;
    adjList[node.id] = [];
  });

  edges.forEach(edge => {
    if (adjList[edge.source]) {
      adjList[edge.source].push(edge.target);
      inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
    }
  });

  const queue: string[] = [];
  nodes.forEach(node => {
    if (inDegree[node.id] === 0) {
      queue.push(node.id);
    }
  });

  const sorted: any[] = [];
  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currNode = nodes.find(n => n.id === currId);
    if (currNode) sorted.push(currNode);

    (adjList[currId] || []).forEach(neighborId => {
      inDegree[neighborId]--;
      if (inDegree[neighborId] === 0) {
        queue.push(neighborId);
      }
    });
  }

  // Return nodes in topological order
  return sorted;
}

// Global execution wrapper
export async function executeFlowEngine(flowId: string, onNodeProgress?: (nodeId: string, status: 'running' | 'completed' | 'error', result?: any) => void) {
  const db = getDb();
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
  if (!flow) throw new Error('Flow not found');

  const definition = JSON.parse(flow.definition || '{"nodes":[],"edges":[]}');
  const sorted = sortNodes(definition.nodes || [], definition.edges || []);

  const context: Record<string, any> = {};

  for (const node of sorted) {
    if (onNodeProgress) onNodeProgress(node.id, 'running');

    try {
      let output: any = {};

      switch (node.type) {
        case 'start':
          output = { msg: 'Flow started' };
          break;

        case 'httpGet':
        case 'httpPost':
          output = await executeHttpNode(node, context);
          break;

        case 'scraping':
          output = await executeScrapingNode(node, context);
          break;

        case 'export':
          output = await executeExportNode(node, context);
          break;

        default:
          output = { warning: 'Unknown node type' };
      }

      context[node.id] = output;
      if (onNodeProgress) onNodeProgress(node.id, 'completed', output);

    } catch (err: any) {
      if (onNodeProgress) onNodeProgress(node.id, 'error', { error: err.message });
      throw err;
    }
  }

  return context;
}

// Http Node Handler
async function executeHttpNode(node: any, context: Record<string, any>) {
  let endpoint = node.data?.endpoint || '';
  
  // Basic variable substitution: {{nodeId.key}}
  endpoint = endpoint.replace(/\{\{([^}]+)\}\}/g, (match: string, pathStr: string) => {
    const parts = pathStr.trim().split('.');
    let val = context;
    for (const part of parts) {
      if (val === undefined || val === null) return '';
      val = val[part];
    }
    return String(val || '');
  });

  const method = node.type === 'httpPost' ? 'POST' : 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'POST') {
    options.body = JSON.stringify(node.data?.payload || {});
  }

  const response = await fetch(endpoint, options);
  if (!response.ok) {
    throw new Error(`HTTP Request failed with status ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// Scraping Node Handler (spawns Python script if configured)
async function executeScrapingNode(node: any, context: Record<string, any>) {
  const scriptName = node.data?.script;
  if (!scriptName) {
    return { data: 'Simulated web scraping result' };
  }

  // Resolve script path
  const scriptPath = path.join(process.cwd(), 'scripts', scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script file not found: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const py = spawn('python', [scriptPath]);
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', data => stdout += data.toString());
    py.stderr.on('data', data => stderr += data.toString());

    py.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}. Error: ${stderr}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ output: stdout });
        }
      }
    });
  });
}

// Export Node Handler
async function executeExportNode(node: any, context: Record<string, any>) {
  const fileName = node.data?.fileName || `export_${uuid()}.csv`;
  const format = node.data?.format || 'CSV';

  // Gather all contexts to export
  const exportData = Object.values(context);

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, fileName);

  if (format === 'CSV') {
    const csvContent = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(filePath, csvContent);
  } else {
    // Basic Excel simulation or writing JSON as text
    fs.writeFileSync(filePath, JSON.stringify(exportData));
  }

  return { filePath, format, success: true };
}
