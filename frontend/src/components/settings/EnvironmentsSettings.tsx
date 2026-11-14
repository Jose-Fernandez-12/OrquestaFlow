import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppDispatch } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { copyToClipboard } from '../../lib/clipboard';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  activateEnvironment,
  createEnvironment,
  deleteEnvironment,
  shortEnvironmentCode,
  updateEnvironment,
  useEnvironments,
  type EnvironmentRecord,
} from './environmentsApi';

interface VariableRow {
  id: string;
  key: string;
  value: string;
}

interface EnvFormState {
  id: string | null;
  name: string;
  slug: string;
  slugTouched: boolean;
  rows: VariableRow[];
}

function makeRow(key = '', value = ''): VariableRow {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, key, value };
}

function suggestSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function badgeTone(slug: string): string {
  const code = shortEnvironmentCode(slug);
  if (code === 'PROD') return 'bg-danger/10 text-danger border-danger/25';
  if (code === 'STG') return 'bg-warn/15 text-amber-700 border-warn/35';
  if (code === 'DEV') return 'bg-success/10 text-success border-success/25';
  return 'bg-accent-light text-accent border-accent/25';
}

export function EnvironmentsSettings() {
  const dispatch = useAppDispatch();
  const { environments, error: loadError, reload } = useEnvironments();
  const [editing, setEditing] = useState<EnvFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const openEditor = (env?: EnvironmentRecord) => {
    setError(null);
    if (env) {
      const entries = Object.entries(env.variables || {});
      setEditing({
        id: env.id,
        name: env.name,
        slug: env.slug,
        slugTouched: true,
        rows: entries.length > 0 ? entries.map(([k, v]) => makeRow(k, v)) : [makeRow()],
      });
    } else {
      setEditing({
        id: null,
        name: '',
        slug: '',
        slugTouched: false,
        rows: [makeRow()],
      });
    }
  };

  const updateRow = (rowId: string, patch: Partial<VariableRow>) => {
    setError(null);
    setEditing(prev =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map(r => (r.id === rowId ? { ...r, ...patch } : r)),
          }
        : null
    );
  };

  const addRow = () => {
    setEditing(prev => (prev ? { ...prev, rows: [...prev.rows, makeRow()] } : null));
  };

  const removeRow = (rowId: string) => {
    setEditing(prev => {
      if (!prev) return null;
      const next = prev.rows.filter(r => r.id !== rowId);
      return { ...prev, rows: next.length > 0 ? next : [makeRow()] };
    });
  };

  const handleCopyExpr = async (varKey: string) => {
    const clean = varKey.trim();
    if (!clean) return;
    const expr = `{{$env.${clean}}}`;
    const ok = await copyToClipboard(expr);
    if (ok) {
      setCopiedKey(clean);
      setTimeout(() => setCopiedKey(curr => (curr === clean ? null : curr)), 1600);
    } else {
      dispatch(showToast('No se pudo copiar al portapapeles'));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    const slug = (editing.slug || suggestSlug(name)).trim().toLowerCase();
    if (!name) {
      setError('El nombre del entorno es obligatorio.');
      return;
    }
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
      setError('El identificador (slug) solo admite minúsculas, números, guion y guion bajo.');
      return;
    }

    const variables: Record<string, string> = {};
    for (const row of editing.rows) {
      const k = row.key.trim();
      if (!k) continue;
      variables[k] = row.value;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing.id) {
        await updateEnvironment(editing.id, { name, slug, variables });
        dispatch(showToast(`Entorno «${name}» actualizado`));
      } else {
        await createEnvironment({ name, slug, variables });
        dispatch(showToast(`Entorno «${name}» creado`));
      }
      setEditing(null);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el entorno');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (env: EnvironmentRecord) => {
    setActivatingId(env.id);
    setError(null);
    try {
      await activateEnvironment(env.id);
      await reload();
      dispatch(showToast(`Entorno activo cambiado a «${env.name}»`));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo activar el entorno');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async (env: EnvironmentRecord) => {
    if (Number(env.is_active) === 1) return;
    if (!window.confirm(`¿Eliminar el entorno «${env.name}»? Sus variables configuradas se perderán.`)) return;
    setError(null);
    try {
      await deleteEnvironment(env.id);
      await reload();
      dispatch(showToast(`Entorno «${env.name}» eliminado`));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el entorno');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-muted leading-relaxed">
          Define perfiles de entorno (<code className="font-mono">dev</code>, <code className="font-mono">staging</code>,{' '}
          <code className="font-mono">prod</code> o personalizados) con variables propias. Úsalas en tus flujos con{' '}
          <code className="font-mono">{'{{$env.NOMBRE}}'}</code> o <code className="font-mono">env:NOMBRE</code>; tendrán prioridad sobre el{' '}
          <code className="font-mono">.env</code> del servidor.
        </p>
        {!editing && (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 min-h-0 gap-1.5 text-xs shrink-0"
            onClick={() => openEditor()}
          >
            <Plus size={13} /> Nuevo
          </Button>
        )}
      </div>

      {(error || loadError) && !editing && (
        <p className="text-xs text-danger" role="alert">
          {error || loadError}
        </p>
      )}

      {editing && (
        <form onSubmit={handleSave} className="p-3.5 bg-bg rounded-md border border-border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="env-name" className="text-xs font-semibold">
                Nombre
              </label>
              <Input
                id="env-name"
                value={editing.name}
                onChange={e => {
                  const nextName = e.target.value;
                  setError(null);
                  setEditing(prev =>
                    prev
                      ? {
                          ...prev,
                          name: nextName,
                          slug: prev.slugTouched ? prev.slug : suggestSlug(nextName),
                        }
                      : null
                  );
                }}
                placeholder="Ej. Producción"
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="env-slug" className="text-xs font-semibold">
                Slug (identificador)
              </label>
              <Input
                id="env-slug"
                value={editing.slug}
                onChange={e => {
                  setError(null);
                  setEditing(prev =>
                    prev ? { ...prev, slug: e.target.value.toLowerCase(), slugTouched: true } : null
                  );
                }}
                placeholder="prod"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-fg">Variables del entorno ({'{{$env.*}}'})</span>
              <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-7 min-h-0 px-2 text-[11px] gap-1">
                <Plus size={12} /> Añadir variable
              </Button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {editing.rows.map((row, idx) => {
                const cleanKey = row.key.trim();
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={e => updateRow(row.id, { key: e.target.value })}
                      placeholder="API_BASE_URL"
                      aria-label={`Nombre de variable ${idx + 1}`}
                      className="h-8 text-xs font-mono flex-1"
                    />
                    <Input
                      value={row.value}
                      onChange={e => updateRow(row.id, { value: e.target.value })}
                      placeholder="https://api.ejemplo.com"
                      aria-label={`Valor de variable ${idx + 1}`}
                      className="h-8 text-xs font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      onClick={() => void handleCopyExpr(row.key)}
                      disabled={!cleanKey}
                      aria-label={cleanKey ? `Copiar {{$env.${cleanKey}}}` : 'Copiar variable'}
                      title={cleanKey ? `Copiar {{$env.${cleanKey}}}` : 'Escribe un nombre de variable'}
                      className="h-8 w-8 shrink-0"
                    >
                      {cleanKey && copiedKey === cleanKey ? (
                        <Check size={13} className="text-success" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Eliminar variable ${idx + 1}`}
                      title="Quitar fila"
                      className="h-8 w-8 shrink-0 text-muted hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="default" size="sm" className="h-8 min-h-0 text-xs" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-8 min-h-0 text-xs gap-1.5" disabled={saving}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {editing.id ? 'Guardar cambios' : 'Crear entorno'}
            </Button>
          </div>
        </form>
      )}

      {environments === null && !loadError && <p className="text-xs text-muted">Cargando entornos…</p>}

      {environments && environments.length === 0 && !editing && (
        <div className="p-6 text-center border border-dashed border-border rounded-md space-y-2">
          <Layers size={18} className="mx-auto text-muted" />
          <p className="text-sm font-medium">No hay entornos configurados</p>
          <p className="text-xs text-muted">Crea entornos como dev, staging y prod para cambiar variables sin editar nodos.</p>
        </div>
      )}

      {environments && environments.length > 0 && (
        <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {environments.map(env => {
            const isActive = Number(env.is_active) === 1;
            const varEntries = Object.entries(env.variables || {});
            const code = shortEnvironmentCode(env.slug);

            return (
              <li key={env.id} className={cn('px-3.5 py-3 bg-surface space-y-2', isActive && 'bg-accent-light/25')}>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wider', badgeTone(env.slug))}>
                    {code}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-fg truncate">{env.name}</span>
                      <span className="text-[11px] font-mono text-muted">({env.slug})</span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/10 text-success text-[10px] font-semibold">
                          <CheckCircle2 size={10} /> Activo
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted">
                      {varEntries.length === 0
                        ? 'Sin variables configuradas'
                        : `${varEntries.length} ${varEntries.length === 1 ? 'variable' : 'variables'}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!isActive && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activatingId === env.id}
                        onClick={() => void handleActivate(env)}
                        className="h-7 min-h-0 px-2.5 text-[11px] gap-1"
                      >
                        {activatingId === env.id && <Loader2 size={11} className="animate-spin" />}
                        Activar
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      onClick={() => openEditor(env)}
                      aria-label={`Editar entorno ${env.name}`}
                      title="Editar entorno y variables"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      disabled={isActive}
                      onClick={() => void handleDelete(env)}
                      aria-label={`Eliminar entorno ${env.name}`}
                      title={isActive ? 'No puedes eliminar el entorno activo' : 'Eliminar entorno'}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>

                {varEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {varEntries.map(([k, v]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => void handleCopyExpr(k)}
                        title={`Clic para copiar {{$env.${k}}} = ${v}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg hover:border-accent/50 text-[10px] font-mono text-fg transition-colors max-w-full"
                      >
                        <span className="font-semibold text-accent truncate max-w-[140px]">{k}</span>
                        <span className="text-muted">=</span>
                        <span className="truncate max-w-[160px] text-muted">{v || '""'}</span>
                        {copiedKey === k ? <Check size={10} className="text-success shrink-0" /> : <Copy size={10} className="text-muted shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
