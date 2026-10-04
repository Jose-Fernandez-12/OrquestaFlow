import { io } from 'socket.io-client';
import { getApiUrl, SOCKET_URL } from '../../lib/api';
import type { ConsoleChunk } from '../ui/ConsoleOutput';

export interface EnvJob {
  jobId: string;
  kind: 'setup' | 'add-package' | 'remove-package';
  status: 'running' | 'completed' | 'error';
  output: Array<ConsoleChunk & { ts: number }>;
  error: string | null;
}

export interface PythonEnvState {
  uv: { path: string; version: string; managed: boolean } | null;
  venv: { python: string; version: string } | null;
  system: { command: string; args: string[]; version: string } | null;
  pythonVersion: string;
  uvVersion: string;
  runtimeDir: string;
  pendingSteps: Array<{ id: string; label: string }>;
  requirements: Array<{ name: string; spec: string; installed: string | null }>;
  activeJob: EnvJob | null;
}

export async function envRequest<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(getApiUrl(`/python-env${path}`), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json.data;
}

/**
 * Starts (or attaches to) an environment job and follows its output live until it ends.
 * The socket is opened before the request so no line printed in between is lost.
 */
export function followEnvJob(start: () => Promise<EnvJob>, onOutput: (chunks: ConsoleChunk[]) => void): Promise<EnvJob> {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL);
    let jobId: string | null = null;
    let chunks: Array<ConsoleChunk & { ts: number }> = [];
    const early: Array<ConsoleChunk & { ts: number; jobId: string }> = [];
    let done = false;

    const finish = async () => {
      if (done || !jobId) return;
      done = true;
      socket.disconnect();
      try {
        const job = await envRequest<EnvJob>(`/jobs/${jobId}`);
        onOutput(job.output);
        resolve(job);
      } catch (err) {
        reject(err);
      }
    };

    socket.on('python-env-output', (d: ConsoleChunk & { ts: number; jobId: string }) => {
      if (!jobId) { early.push(d); return; }
      if (d.jobId !== jobId) return;
      chunks = [...chunks, d];
      onOutput(chunks);
    });
    const earlyExits = new Set<string>();
    socket.on('python-env-exit', (d: { jobId: string }) => {
      if (!jobId) earlyExits.add(d.jobId);
      else if (d.jobId === jobId) finish();
    });

    start()
      .then(job => {
        jobId = job.jobId;
        const lastTs = job.output.length ? job.output[job.output.length - 1].ts : 0;
        chunks = [...job.output, ...early.filter(e => e.jobId === job.jobId && e.ts > lastTs)];
        onOutput(chunks);
        if (job.status !== 'running' || earlyExits.has(job.jobId)) finish();
      })
      .catch(err => { socket.disconnect(); reject(err); });
  });
}
