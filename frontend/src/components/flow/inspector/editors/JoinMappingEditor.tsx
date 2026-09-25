import React, { useState, useMemo } from 'react';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { ChevronDown, ChevronRight, Plus, X, Link2, Sparkles, List, Check } from 'lucide-react';
import { useAppSelector } from '../../../../store/hooks';
import type { Node } from '@xyflow/react';

interface JoinConfig {
  nodeId: string;
  localKey: string;
  foreignKey: string;
}

interface JoinMappingEditorProps {
  joins: JoinConfig[];
  onChange: (joins: JoinConfig[]) => void;
  upstreamNodes: Node[];
  mainNodeId?: string;
  nodes?: Node[];
  exportNode?: Node;
}

export function getNodeColumns(
  nodeId: string | undefined,
  nodes: Node[] = [],
  nodeResults: Record<string, any> = {},
  intermediateContext: Record<string, any> = {},
  queries: any[] = [],
  exportNode?: Node
): string[] {
  if (!nodeId) return [];

  const keys = new Set<string>();

  // If inspecting the export node, check its configured columns
  if (exportNode && exportNode.id === nodeId && exportNode.data?.columns && Array.isArray(exportNode.data.columns)) {
    exportNode.data.columns.forEach((c: any) => {
      if (typeof c === 'string' && c.trim()) keys.add(c.trim());
      else if (c?.key && typeof c.key === 'string' && c.key.trim()) keys.add(c.key.trim());
      else if (c?.header && typeof c.header === 'string' && c.header.trim()) keys.add(c.header.trim());
    });
  }

  // 1. From nodeResults or intermediateContext
  const result = nodeResults[nodeId] || intermediateContext?.[nodeId];
  if (result) {
    let rows: any[] = [];
    if (Array.isArray(result)) {
      rows = result;
    } else if (result && typeof result === 'object') {
      if (Array.isArray(result.rows)) rows = result.rows;
      else if (Array.isArray(result.data)) rows = result.data;
      else if (Array.isArray(result.items)) rows = result.items;
      else rows = [result];
    }

    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      Object.keys(rows[0]).forEach(k => keys.add(k));
    }
  }

  // 2. From node definition
  const foundNode = nodes.find(n => n.id === nodeId);
  if (foundNode) {
    // Query node: check selected query display_columns
    if (foundNode.type === 'query') {
      const queryId = foundNode.data?.queryId as string;
      const q = queries.find(item => item.id === queryId);
      if (q?.display_columns) {
        try {
          const parsed = JSON.parse(q.display_columns);
          if (Array.isArray(parsed)) parsed.forEach((col: string) => keys.add(col));
        } catch {}
      }
      if (foundNode.data?.extractColumns && typeof foundNode.data.extractColumns === 'string') {
        foundNode.data.extractColumns.split(',').forEach((c: string) => {
          if (c.trim()) keys.add(c.trim());
        });
      }
    }

    // FileSource or DataSource
    if (foundNode.data?.sampleRows && Array.isArray(foundNode.data.sampleRows) && foundNode.data.sampleRows.length > 0) {
      Object.keys(foundNode.data.sampleRows[0]).forEach(k => keys.add(k));
    }
    if (foundNode.data?.columns && Array.isArray(foundNode.data.columns)) {
      foundNode.data.columns.forEach((c: any) => {
        if (typeof c === 'string') keys.add(c);
        else if (c?.key) keys.add(c.key);
      });
    }

    // DataList
    if (foundNode.type === 'dataList' && foundNode.data?.items) {
      try {
        const parsed = typeof foundNode.data.items === 'string' ? JSON.parse(foundNode.data.items) : foundNode.data.items;
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
          Object.keys(parsed[0]).forEach(k => keys.add(k));
        }
      } catch {}
    }
  }

  return Array.from(keys);
}

export function JoinMappingEditor({
  joins,
  onChange,
  upstreamNodes = [],
  mainNodeId,
  nodes = [],
  exportNode,
}: JoinMappingEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [manualLocal, setManualLocal] = useState<Record<number, boolean>>({});
  const [manualForeign, setManualForeign] = useState<Record<number, boolean>>({});

  const nodeResults = useAppSelector(state => (state as any).flows?.nodeResults || {});
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);
  const queries = useAppSelector(state => state.queries.queries);

  // Main node label and detected columns
  const effectiveMainNodeId = mainNodeId || upstreamNodes[0]?.id;
  const mainNode = nodes.find(n => n.id === effectiveMainNodeId);
  const mainNodeLabel = (mainNode?.data?.label as string) || mainNode?.type || 'Reporte Principal';

  const mainColumns = useMemo(() => {
    return getNodeColumns(effectiveMainNodeId, nodes, nodeResults, intermediateContext, queries, exportNode);
  }, [effectiveMainNodeId, nodes, nodeResults, intermediateContext, queries, exportNode]);

  const addJoin = () => {
    onChange([...(joins || []), { nodeId: '', localKey: '', foreignKey: '' }]);
  };

  const updateJoin = (index: number, field: 'nodeId' | 'localKey' | 'foreignKey', value: string) => {
    const newJoins = [...(joins || [])];
    newJoins[index] = { ...newJoins[index], [field]: value };
    onChange(newJoins);
  };

  const handleSelectJoinedNode = (index: number, selectedNodeId: string) => {
    const newJoins = [...(joins || [])];
    newJoins[index] = { ...newJoins[index], nodeId: selectedNodeId };

    // Auto-match common keys if both localKey and foreignKey are empty
    if (!newJoins[index].localKey && !newJoins[index].foreignKey && selectedNodeId) {
      const foreignCols = getNodeColumns(selectedNodeId, nodes, nodeResults, intermediateContext, queries);
      
      // Look for exact match (case-insensitive)
      let foundLocal = '';
      let foundForeign = '';

      for (const mCol of mainColumns) {
        const match = foreignCols.find(fCol => fCol.toLowerCase() === mCol.toLowerCase());
        if (match) {
          foundLocal = mCol;
          foundForeign = match;
          break;
        }
      }

      // If no exact match, look for ID-like matches
      if (!foundLocal) {
        const mainIdCol = mainColumns.find(c => c.toLowerCase().includes('id') || c.toLowerCase().includes('cod'));
        const foreignIdCol = foreignCols.find(c => c.toLowerCase().includes('id') || c.toLowerCase().includes('cod'));
        if (mainIdCol && foreignIdCol) {
          foundLocal = mainIdCol;
          foundForeign = foreignIdCol;
        }
      }

      if (foundLocal && foundForeign) {
        newJoins[index].localKey = foundLocal;
        newJoins[index].foreignKey = foundForeign;
      }
    }

    onChange(newJoins);
  };

  const removeJoin = (index: number) => {
    const newJoins = [...(joins || [])];
    newJoins.splice(index, 1);
    onChange(newJoins);
  };

  const count = (joins || []).length;

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="flex items-center gap-1.5 text-xs font-semibold hover:text-accent transition-colors"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span>Relaciones (Joins)</span>
          {count > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-mono leading-none">
              {count}
            </span>
          )}
        </button>
        {!collapsed && (
          <Button variant="default" size="sm" onClick={addJoin} className="h-6 text-[10px] px-2 py-0 gap-1">
            <Plus size={11} />
            <span>Agregar Cruce</span>
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted leading-relaxed">
            Vincula datos de nodos anteriores con el reporte en base a una clave en común (ej. <code>id</code> o <code>codigo</code>).
          </p>

          {(!joins || joins.length === 0) && (
            <div className="text-[11px] text-muted text-center py-5 bg-bg/50 rounded border border-border border-dashed space-y-1">
              <p className="font-medium text-fg">Sin relaciones configuradas</p>
              <p className="text-[10px] text-muted">
                Agrega una relación para incluir columnas de otros nodos vinculándolas por una clave compartida.
              </p>
            </div>
          )}

          {(joins || []).map((join, i) => {
            const joinedNode = nodes.find(n => n.id === join.nodeId);
            const joinedNodeLabel = (joinedNode?.data?.label as string) || joinedNode?.type || 'Nodo a cruzar';
            const joinedColumns = getNodeColumns(join.nodeId, nodes, nodeResults, intermediateContext, queries);

            const isManualLocalActive = manualLocal[i] || (Boolean(join.localKey) && !mainColumns.includes(join.localKey));
            const isManualForeignActive = manualForeign[i] || (Boolean(join.foreignKey) && !joinedColumns.includes(join.foreignKey));

            // Available nodes to join (exclude the main source node if multiple exist)
            const availableNodes = upstreamNodes.length > 1
              ? upstreamNodes.filter(n => n.id !== effectiveMainNodeId)
              : upstreamNodes;

            return (
              <div
                key={i}
                className="p-3 bg-bg/50 rounded-md border border-border space-y-3 shadow-xs animate-fade-in"
              >
                {/* Card Title & Delete */}
                <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
                  <div className="flex items-center gap-1.5 font-medium text-xs text-fg">
                    <Link2 size={13} className="text-accent" />
                    <span>Cruce #{i + 1}</span>
                    <span className="text-[10px] text-muted font-normal">
                      (Base: <strong className="text-accent">{mainNodeLabel}</strong>)
                    </span>
                  </div>
                  <Button
                    variant="icon"
                    size="icon"
                    onClick={() => removeJoin(i)}
                    className="h-6 w-6 text-danger hover:text-danger hover:bg-danger/10"
                    title="Eliminar relación"
                  >
                    <X size={14} />
                  </Button>
                </div>

                {/* Node selection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted">
                    <label className="font-medium uppercase tracking-wider block">
                      Vincular datos desde
                    </label>
                    <span>(Se unirá a {mainNodeLabel})</span>
                  </div>
                  <select
                    className="flex w-full h-7 rounded border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:border-accent"
                    value={join.nodeId}
                    onChange={e => handleSelectJoinedNode(i, e.target.value)}
                  >
                    <option value="">Seleccionar nodo secundario a cruzar...</option>
                    {availableNodes.map(n => (
                      <option key={n.id} value={n.id}>
                        {(n.data?.label as string) || n.type} ({n.id.slice(0, 8)}...)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Key match selectors */}
                {join.nodeId && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[10px] text-muted font-medium flex items-center justify-between">
                      <span>Vincular filas donde coincida:</span>
                      {mainColumns.length > 0 && joinedColumns.length > 0 && (
                        <span className="text-[9px] text-emerald-600 font-mono flex items-center gap-0.5">
                          <Sparkles size={10} /> Columnas detectadas
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center bg-surface p-2.5 rounded border border-border/80">
                      {/* Left: Main report column */}
                      <div className="space-y-1 min-w-0">
                        <label className="text-[9px] font-medium text-muted uppercase tracking-wider block truncate" title={mainNodeLabel}>
                          {mainNodeLabel}
                        </label>
                        {isManualLocalActive || mainColumns.length === 0 ? (
                          <div className="flex gap-1">
                            <Input
                              placeholder="ej: id_eds"
                              className="h-7 text-xs font-mono"
                              value={join.localKey}
                              onChange={e => updateJoin(i, 'localKey', e.target.value)}
                            />
                            {mainColumns.length > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted hover:text-fg shrink-0"
                                title="Seleccionar de lista"
                                onClick={() => setManualLocal(prev => ({ ...prev, [i]: false }))}
                              >
                                <List size={12} />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <select
                            className="w-full h-7 rounded border border-border bg-bg px-2 text-xs font-mono focus-visible:outline-none focus-visible:border-accent truncate"
                            value={join.localKey}
                            onChange={e => {
                              if (e.target.value === '__custom__') {
                                setManualLocal(prev => ({ ...prev, [i]: true }));
                              } else {
                                updateJoin(i, 'localKey', e.target.value);
                              }
                            }}
                          >
                            <option value="">Columna en reporte...</option>
                            {mainColumns.map(col => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                            <option value="__custom__">✏️ Escribir clave manual...</option>
                          </select>
                        )}
                      </div>

                      {/* Center: Link connector */}
                      <div className="flex flex-col items-center justify-center shrink-0 pt-3">
                        <div className="w-5 h-5 rounded-full bg-accent/10 border border-accent/30 text-accent flex items-center justify-center">
                          <Link2 size={11} />
                        </div>
                        <span className="text-[9px] text-muted font-mono leading-none mt-0.5">=</span>
                      </div>

                      {/* Right: Joined node column */}
                      <div className="space-y-1 min-w-0">
                        <label className="text-[9px] font-medium text-muted uppercase tracking-wider block truncate" title={joinedNodeLabel}>
                          {joinedNodeLabel}
                        </label>
                        {isManualForeignActive || joinedColumns.length === 0 ? (
                          <div className="flex gap-1">
                            <Input
                              placeholder="ej: IdEds"
                              className="h-7 text-xs font-mono"
                              value={join.foreignKey}
                              onChange={e => updateJoin(i, 'foreignKey', e.target.value)}
                            />
                            {joinedColumns.length > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted hover:text-fg shrink-0"
                                title="Seleccionar de lista"
                                onClick={() => setManualForeign(prev => ({ ...prev, [i]: false }))}
                              >
                                <List size={12} />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <select
                            className="w-full h-7 rounded border border-border bg-bg px-2 text-xs font-mono focus-visible:outline-none focus-visible:border-accent truncate"
                            value={join.foreignKey}
                            onChange={e => {
                              if (e.target.value === '__custom__') {
                                setManualForeign(prev => ({ ...prev, [i]: true }));
                              } else {
                                updateJoin(i, 'foreignKey', e.target.value);
                              }
                            }}
                          >
                            <option value="">Columna a cruzar...</option>
                            {joinedColumns.map(col => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                            <option value="__custom__">✏️ Escribir clave manual...</option>
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Match confirmation banner */}
                    {join.localKey && join.foreignKey && (
                      <div className="p-2 rounded bg-accent/5 border border-accent/20 flex flex-col gap-1 text-[11px] text-accent">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Check size={12} className="shrink-0 text-emerald-500" />
                          <span className="truncate">
                            Coincidencia activa: <strong>{join.localKey}</strong> = <strong>{join.foreignKey}</strong>
                          </span>
                        </div>
                        {joinedColumns.length > 0 && (
                          <div className="text-[10px] text-muted truncate">
                            Columnas que aportará este nodo al reporte: {joinedColumns.slice(0, 5).join(', ')}{joinedColumns.length > 5 ? ` (+${joinedColumns.length - 5} más)` : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
