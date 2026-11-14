import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  GitCommitVertical,
  Loader2,
  RotateCcw,
  Save,
  Eye,
  AlertTriangle,
  Plus,
  Minus,
  PenLine,
  Move,
  Globe,
  GlobeLock,
  CheckCircle2,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { getApiUrl, readApiResponse } from '../../lib/api';
import type { Flow } from '../../store/flowSlice';

type FlowWithPublish = Flow & {
  published_version_id?: string | null;
  published_at?: string | null;
};

interface FlowVersionSummary {
  id: string;
  version_number: number;
  name: string | null;
  note: string | null;
  kind: 'auto' | 'manual' | 'restore' | 'initial';
  created_at: string;
  updated_at: string;
  node_count: number;
  edge_count: number;
}

interface PropertyDiff {
  key: string;
  before: string;
  after: string;
}

interface DiffNodeItem {
  id: string;
  label: string;
  type: string;
}

interface ModifiedNodeItem extends DiffNodeItem {
  properties: PropertyDiff[];
}

interface VersionDiff {
  added: DiffNodeItem[];
  removed: DiffNodeItem[];
  modified: ModifiedNodeItem[];
  moved: string[];
  edgesAdded: number;
  edgesRemoved: number;
}

interface FlowVersionsModalProps {
  flow: Flow;
  isOpen: boolean;
  isLocked: boolean;
  currentDefinition: string;
  onClose: () => void;
  saveCurrent: () => Promise<void>;
  onRestored: (flow: Flow) => void;
  onPublished?: (flow: Flow) => void;
}

const KIND_LABELS: Record<FlowVersionSummary['kind'], { label: string; className: string }> = {
  auto: { label: 'Guardado', className: 'bg-bg text-muted border-border' },
  manual: { label: 'Punto manual', className: 'bg-accent/10 text-accent border-accent/30' },
  restore: { label: 'Restauración', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  initial: { label: 'Estado inicial', className: 'bg-bg text-muted border-border' },
};

function formatSqliteDate(value: string): string {
  const d = new Date(`${value.replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? value : format(d, 'dd/MM/yyyy HH:mm');
}

function nodeLabel(node: any): string {
  return String(node?.data?.label || node?.type || node?.id);
}

const SECRET_KEY_RE = /(secret|password|token|authorization|apikey|api_key|credential|bearer|private)/i;

function formatDiffValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '(vacío)';
  if (SECRET_KEY_RE.test(key)) return '••••••••';
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  return str.length > 90 ? `${str.slice(0, 87)}…` : str;
}

function diffNodeProperties(prevData: Record<string, any>, nextData: Record<string, any>): PropertyDiff[] {
  const keys = new Set([...Object.keys(prevData || {}), ...Object.keys(nextData || {})]);
  const props: PropertyDiff[] = [];
  for (const key of keys) {
    if (key === 'icon') continue;
    const beforeRaw = prevData?.[key];
    const afterRaw = nextData?.[key];
    if (JSON.stringify(beforeRaw ?? null) !== JSON.stringify(afterRaw ?? null)) {
      props.push({
        key,
        before: formatDiffValue(key, beforeRaw),
        after: formatDiffValue(key, afterRaw),
      });
    }
  }
  return props;
}

function diffDefinitions(fromDef: string, toDef: string): VersionDiff {
  const parse = (s: string) => {
    try {
      const d = JSON.parse(s || '{}');
      return { nodes: d.nodes || [], edges: d.edges || [] };
    } catch {
      return { nodes: [], edges: [] };
    }
  };
  const from = parse(fromDef);
  const to = parse(toDef);
  const fromNodes = new Map<string, any>(from.nodes.map((n: any) => [n.id, n]));
  const toNodes = new Map<string, any>(to.nodes.map((n: any) => [n.id, n]));
  const edgeKey = (e: any) => `${e.source}|${e.sourceHandle || ''}|${e.target}`;
  const fromEdges = new Set(from.edges.map(edgeKey));
  const toEdges = new Set(to.edges.map(edgeKey));

  const diff: VersionDiff = { added: [], removed: [], modified: [], moved: [], edgesAdded: 0, edgesRemoved: 0 };
  for (const [id, node] of toNodes) {
    const prev = fromNodes.get(id);
    if (!prev) {
      diff.added.push({ id, label: nodeLabel(node), type: String(node?.type || 'nodo') });
    } else if (JSON.stringify(prev.data ?? {}) !== JSON.stringify(node.data ?? {})) {
      diff.modified.push({
        id,
        label: nodeLabel(node),
        type: String(node?.type || 'nodo'),
        properties: diffNodeProperties(prev.data || {}, node.data || {}),
      });
    } else if (prev.position?.x !== node.position?.x || prev.position?.y !== node.position?.y) {
      diff.moved.push(nodeLabel(node));
    }
  }
  for (const [id, node] of fromNodes) {
    if (!toNodes.has(id)) {
      diff.removed.push({ id, label: nodeLabel(node), type: String(node?.type || 'nodo') });
    }
  }
  toEdges.forEach(k => !fromEdges.has(k) && diff.edgesAdded++);
  fromEdges.forEach(k => !toEdges.has(k) && diff.edgesRemoved++);
  return diff;
}

export function FlowVersionsModal({
  flow,
  isOpen,
  isLocked,
  currentDefinition,
  onClose,
  saveCurrent,
  onRestored,
  onPublished,
}: FlowVersionsModalProps) {
  const flowWithPublish = flow as FlowWithPublish;
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [expanded, setExpanded] = useState<{ id: string; diff: VersionDiff } | null>(null);
  const [loadingDiffId, setLoadingDiffId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<FlowVersionSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  const [publishedOverride, setPublishedOverride] = useState<{
    flowId: string;
    propValue: string | null;
    value: string | null;
  } | null>(null);
  const propPublishedId = flowWithPublish.published_version_id ?? null;
  const publishedVersionId =
    publishedOverride &&
    publishedOverride.flowId === flow.id &&
    publishedOverride.propValue === propPublishedId
      ? publishedOverride.value
      : propPublishedId;

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/flows/${flow.id}/versions`));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setVersions(body.data || []);
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar el historial de versiones');
    } finally {
      setLoading(false);
    }
  }, [flow.id]);

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
    }
  }, [isOpen, fetchVersions]);

  const handleClose = () => {
    setExpanded(null);
    setConfirmRestore(null);
    onClose();
  };

  if (!isOpen) return null;

  const handleSnapshot = async () => {
    setSavingSnapshot(true);
    setError(null);
    try {
      await saveCurrent();
      const res = await fetch(getApiUrl(`/flows/${flow.id}/versions`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setNote('');
      await fetchVersions();
    } catch (e: any) {
      setError(e.message || 'No se pudo guardar la versión');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const toggleDiff = async (version: FlowVersionSummary) => {
    if (expanded?.id === version.id) {
      setExpanded(null);
      return;
    }
    setLoadingDiffId(version.id);
    try {
      const res = await fetch(getApiUrl(`/flows/${flow.id}/versions/${version.id}`));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setExpanded({ id: version.id, diff: diffDefinitions(currentDefinition, body.data.definition) });
    } catch (e: any) {
      setError(e.message || 'No se pudo comparar la versión');
    } finally {
      setLoadingDiffId(null);
    }
  };

  const handleRestore = async () => {
    if (!confirmRestore) return;
    setRestoring(true);
    setError(null);
    try {
      await saveCurrent();
      const res = await fetch(getApiUrl(`/flows/${flow.id}/versions/${confirmRestore.id}/restore`), { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      onRestored(body.data);
      handleClose();
    } catch (e: any) {
      setError(e.message || 'No se pudo restaurar la versión');
    } finally {
      setRestoring(false);
    }
  };

  const handlePublish = async (version: FlowVersionSummary) => {
    setPublishingId(version.id);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/flows/${flow.id}/versions/${version.id}/publish`), { method: 'POST' });
      const body = await readApiResponse<any>(res, 'No se pudo publicar la versión');
      const nextPublishedId = body?.data?.published_version_id ?? version.id;
      setPublishedOverride({ flowId: flow.id, propValue: propPublishedId, value: nextPublishedId });
      if (onPublished) {
        onPublished(body?.data?.id ? body.data : ({ ...flow, published_version_id: nextPublishedId } as Flow));
      }
    } catch (e: any) {
      setError(e.message || 'No se pudo publicar la versión');
    } finally {
      setPublishingId(null);
    }
  };

  const handleUnpublish = async () => {
    setUnpublishing(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/flows/${flow.id}/unpublish`), { method: 'POST' });
      const body = await readApiResponse<any>(res, 'No se pudo despublicar el flujo');
      setPublishedOverride({ flowId: flow.id, propValue: propPublishedId, value: null });
      if (onPublished) {
        onPublished(body?.data?.id ? body.data : ({ ...flow, published_version_id: null } as Flow));
      }
    } catch (e: any) {
      setError(e.message || 'No se pudo despublicar el flujo');
    } finally {
      setUnpublishing(false);
    }
  };

  const publishedVersion = versions.find(v => v.id === publishedVersionId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Versiones del flujo"
      className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-fast"
    >
      <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-accent-light text-accent flex items-center justify-center shrink-0">
              <GitCommitVertical size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold tracking-tight text-fg">Versiones del flujo</h2>
                {publishedVersionId ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={10} />
                    Publicada{publishedVersion ? ` · v${publishedVersion.version_number}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    Borrador (Draft)
                  </span>
                )}
              </div>
              <p className="text-xs text-muted truncate">{flow.name} · se conservan las últimas 50</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {publishedVersionId && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnpublish}
                disabled={unpublishing || isLocked}
                className="h-7 px-2.5 text-xs gap-1 text-muted hover:text-danger hover:border-danger/40"
                title="Quitar la versión publicada de producción"
              >
                {unpublishing ? <Loader2 size={12} className="animate-spin" /> : <GlobeLock size={12} />}
                Despublicar
              </Button>
            )}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar versiones"
              className="p-1 rounded-md text-muted hover:text-fg hover:bg-bg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-border bg-bg/40 space-y-2 shrink-0">
          <label className="text-xs font-medium text-fg">Crear un punto de versión con el estado actual</label>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !savingSnapshot && !isLocked && handleSnapshot()}
              placeholder="Nota opcional, p. ej. «Antes de cambiar la consulta de ventas»"
              maxLength={200}
              className="flex-1 h-8 rounded-sm border border-border bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:border-accent"
            />
            <Button variant="primary" size="sm" onClick={handleSnapshot} disabled={savingSnapshot || isLocked} className="gap-1.5 text-xs h-8">
              {savingSnapshot ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Guardar versión
            </Button>
          </div>
          <p className="text-[10px] text-muted">
            Además, cada guardado crea una versión automática (los guardados de menos de 5 minutos se agrupan).
          </p>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2.5 border border-red-500/30 bg-red-500/10 rounded text-xs text-red-600 flex items-center gap-2">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Cargando versiones…
            </div>
          )}

          {!loading && versions.length === 0 && (
            <div className="text-center py-10 text-sm text-muted">
              Aún no hay versiones. Se crearán automáticamente al guardar cambios en el flujo.
            </div>
          )}

          {!loading &&
            versions.map((v, idx) => {
              const kind = KIND_LABELS[v.kind] || KIND_LABELS.auto;
              const isPublished = publishedVersionId === v.id;
              const isExpanded = expanded?.id === v.id;
              const diff = isExpanded ? expanded!.diff : null;
              const noChanges = diff && !diff.added.length && !diff.removed.length && !diff.modified.length && !diff.moved.length && !diff.edgesAdded && !diff.edgesRemoved;
              return (
                <div
                  key={v.id}
                  className={cn(
                    'border rounded-md bg-surface',
                    isPublished ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : idx === 0 ? 'border-accent/40' : 'border-border'
                  )}
                >
                  <div className="p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <div className="w-10 text-center shrink-0">
                      <div className="text-sm font-semibold text-fg font-mono">v{v.version_number}</div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', kind.className)}>{kind.label}</span>
                        {isPublished && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 size={10} />
                            Publicada
                          </span>
                        )}
                        {idx === 0 && <span className="text-[10px] font-medium text-accent">Más reciente</span>}
                        <span className="text-[11px] text-muted">{formatSqliteDate(v.updated_at || v.created_at)}</span>
                      </div>
                      {v.note && <p className="text-xs text-fg truncate" title={v.note}>{v.note}</p>}
                      <p className="text-[10px] text-muted">{v.node_count} nodos · {v.edge_count} conexiones</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="none" onClick={() => toggleDiff(v)} className="h-7 px-2 text-xs gap-1" title="Comparar con el lienzo actual">
                        {loadingDiffId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                        Cambios
                      </Button>
                      {!isPublished && (
                        <Button
                          variant="outline"
                          size="none"
                          onClick={() => handlePublish(v)}
                          disabled={isLocked || publishingId !== null}
                          className="h-7 px-2 text-xs gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          title="Marcar esta versión como la publicada en producción"
                        >
                          {publishingId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                          Publicar esta versión
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="none"
                        onClick={() => setConfirmRestore(v)}
                        disabled={isLocked}
                        className="h-7 px-2 text-xs gap-1"
                        title={isLocked ? 'Desbloquea el flujo para restaurar' : 'Restaurar esta versión'}
                      >
                        <RotateCcw size={12} />
                        Restaurar
                      </Button>
                    </div>
                  </div>

                  {diff && (
                    <div className="px-3 pb-3 pt-2.5 border-t border-border bg-bg/30 text-[11px] space-y-2">
                      <p className="text-muted">Al restaurar esta versión, respecto al lienzo actual:</p>
                      {noChanges && <p className="text-fg">No hay diferencias.</p>}

                      {diff.added.length > 0 && (
                        <div className="space-y-1">
                          {diff.added.map(item => (
                            <div key={`add-${item.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                              <span className="flex items-center gap-1.5 font-medium truncate">
                                <Plus size={12} className="shrink-0" />
                                Añadido: {item.label}
                              </span>
                              <span className="text-[10px] font-mono opacity-80 shrink-0">{item.type}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {diff.removed.length > 0 && (
                        <div className="space-y-1">
                          {diff.removed.map(item => (
                            <div key={`rem-${item.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300">
                              <span className="flex items-center gap-1.5 font-medium truncate">
                                <Minus size={12} className="shrink-0" />
                                Eliminado: {item.label}
                              </span>
                              <span className="text-[10px] font-mono opacity-80 shrink-0">{item.type}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {diff.modified.length > 0 && (
                        <div className="space-y-1.5">
                          {diff.modified.map(item => (
                            <div key={`mod-${item.id}`} className="rounded border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-amber-700 dark:text-amber-300 font-medium border-b border-amber-500/20">
                                <span className="flex items-center gap-1.5 truncate">
                                  <PenLine size={12} className="shrink-0" />
                                  Modificado: {item.label}
                                </span>
                                <span className="text-[10px] font-mono opacity-80 shrink-0">{item.type}</span>
                              </div>
                              {item.properties.length > 0 && (
                                <div className="divide-y divide-amber-500/10 bg-surface/60">
                                  {item.properties.map(prop => (
                                    <div key={prop.key} className="px-2.5 py-1 grid grid-cols-[110px_1fr] gap-2 text-[10px] items-start">
                                      <span className="font-mono font-semibold text-fg truncate" title={prop.key}>{prop.key}</span>
                                      <div className="font-mono space-y-0.5 min-w-0 break-all">
                                        <div className="text-rose-600 dark:text-rose-400">− {prop.before}</div>
                                        <div className="text-emerald-600 dark:text-emerald-400">+ {prop.after}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {diff.moved.length > 0 && (
                        <p className="flex gap-1.5 text-muted"><Move size={12} className="shrink-0 mt-px" /> Cambia de posición: {diff.moved.join(', ')}</p>
                      )}
                      {(diff.edgesAdded > 0 || diff.edgesRemoved > 0) && (
                        <p className="text-muted">Conexiones: +{diff.edgesAdded} / −{diff.edgesRemoved}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {confirmRestore && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-fg">¿Restaurar la versión v{confirmRestore.version_number}?</h3>
            <p className="text-xs text-muted leading-relaxed">
              El lienzo se reemplazará por esta versión. El estado actual se guarda antes como una versión nueva, así que podrás
              volver a él desde este historial.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmRestore(null)} disabled={restoring} className="text-xs h-8">
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleRestore} disabled={restoring} className="text-xs h-8 gap-1.5">
                {restoring ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Restaurar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
