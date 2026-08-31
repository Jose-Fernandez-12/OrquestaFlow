import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { v4 as uuid } from 'uuid';
import { Play, Save, Maximize2, Minimize2, MoreHorizontal, Clock, PanelLeft, Plus, CheckCircle2, FileSpreadsheet, X } from 'lucide-react';
import { io } from 'socket.io-client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { 
  fetchFlows, 
  setCurrentFlow, 
  createFlow,
  saveFlow, 
  selectNode, 
  executeFlow, 
  toggleCanvasExpanded,
  toggleNodeLibraryExpanded,
  setNodeExecuting,
  setNodeCompleted,
  resetNodeStates
} from '../../store/flowSlice';
import { Button } from '../ui/button';
import { nodeTypes } from './nodes';
import { NodeLibrary } from './NodeLibrary';
import { NodeInspector } from './NodeInspector';
import { cn } from '../../lib/utils';
import { downloadAsXMLSpreadsheet, downloadAsCSV, resolveExportData } from '../../lib/exportUtils';

function FlowCanvas() {
  const dispatch = useAppDispatch();
  const flows = useAppSelector(state => state.flows.flows);
  const currentFlow = useAppSelector(state => state.flows.currentFlow);
  const canvasExpanded = useAppSelector(state => state.flows.canvasExpanded);
  const nodeLibraryExpanded = useAppSelector(state => state.flows.nodeLibraryExpanded);
  const selectedNodeId = useAppSelector(state => state.flows.selectedNodeId);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [editingName, setEditingName] = useState(currentFlow?.name || '');
  const [exportNotification, setExportNotification] = useState<{
    fileName: string;
    downloadUrl: string;
    records: number;
    format: string;
    filePath?: string;
  } | null>(null);

  useEffect(() => {
    if (currentFlow) setEditingName(currentFlow.name);
  }, [currentFlow?.id]);

  // Connect socket.io for real-time progress
  useEffect(() => {
    const socket = io('http://localhost:3001');

    socket.on('flow-progress', (data: { flowId: string; nodeId: string; status: 'running' | 'completed' | 'error' }) => {
      if (currentFlow && data.flowId === currentFlow.id) {
        if (data.status === 'running') {
          dispatch(setNodeExecuting(data.nodeId));
        } else if (data.status === 'completed') {
          dispatch(setNodeCompleted(data.nodeId));
        }
      }
    });

    socket.on('flow-export-ready', (data: { flowId: string; fileName: string; downloadUrl: string; records: number; format: string; filePath?: string }) => {
      if (currentFlow && data.flowId === currentFlow.id) {
        setExportNotification(data);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [currentFlow, dispatch]);

  // Load flow definition when currentFlow changes
  useEffect(() => {
    if (currentFlow && currentFlow.definition) {
      try {
        const def = JSON.parse(currentFlow.definition);
        setNodes(def.nodes || []);
        setEdges(def.edges || []);
      } catch (e) {
        console.error("Failed to parse flow definition", e);
      }
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [currentFlow, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const label = event.dataTransfer.getData('application/reactflow-label');

      if (typeof type === 'undefined' || !type || !reactFlowInstance) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: uuid(),
        type,
        position,
        data: { label: label || type },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    if (nodes.length === 1) {
      dispatch(selectNode(nodes[0].id));
    } else {
      dispatch(selectNode(null));
    }
  }, [dispatch]);

  const handleSave = () => {
    if (!currentFlow) return;
    const definition = JSON.stringify({ nodes, edges });
    dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName }));
  };

  const handleNewFlow = () => {
    dispatch(createFlow({ name: 'Nuevo Flujo' }));
  };

  const handleExecute = async () => {
    if (!currentFlow) return;
    dispatch(resetNodeStates());
    
    // Auto-guardar definición antes de ejecutar para que el backend tenga los últimos datos
    const definition = JSON.stringify({ nodes, edges });
    await dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName }));
    
    const result = await dispatch(executeFlow(currentFlow.id));
    
    // Find export node result in the execution context
    const context = (result.payload as any)?.context as Record<string, any> | undefined;
    if (context) {
      const exportNode = nodes.find(n => n.type === 'export');
      if (exportNode) {
        const data = exportNode.data as any;
        const format = data?.format || 'CSV';
        const rawFileName = data?.fileName as string | undefined;
        
        const exportData = resolveExportData(context, data?.dataSource);
        const columns = data?.columns || (exportData[0] ? Object.keys(exportData[0]).map(k => ({ header: k, key: k })) : []);
        
        if (exportData.length > 0) {
          if (format === 'Excel') {
            downloadAsXMLSpreadsheet(exportData, columns, rawFileName || 'export');
          } else {
            downloadAsCSV(exportData, columns, rawFileName || 'export');
          }
        }
        
        const finalName = (rawFileName || 'export').trim() === '' ? 'export' : (rawFileName || 'export').trim();
        const ext = format === 'Excel' ? '.xls' : '.csv';

        setExportNotification({
          fileName: finalName + ext,
          downloadUrl: '',
          records: exportData.length,
          format,
          filePath: undefined
        });
      }
    }
  };

  if (!currentFlow) {
    return <div className="flex-1 flex items-center justify-center text-muted">Selecciona o crea un flujo para comenzar</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Topbar inside editor */}
      <div className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="icon" size="icon" onClick={() => dispatch(toggleNodeLibraryExpanded())} title={nodeLibraryExpanded ? "Ocultar Librería" : "Mostrar Librería"}>
            <PanelLeft size={18} />
          </Button>
          <div className="w-px h-6 bg-border"></div>
          
          <select 
            className="bg-bg border border-border rounded-sm px-2 py-1 text-sm focus-visible:outline-none max-w-[200px]"
            value={currentFlow.id}
            onChange={(e) => {
              const selected = flows.find(f => f.id === e.target.value);
              if (selected) dispatch(setCurrentFlow(selected));
            }}
          >
            {flows.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          <input 
            type="text"
            className="font-medium bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none px-1 py-0.5 text-sm w-[200px]"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            placeholder="Nombre del flujo"
          />

          <Button variant="default" size="sm" onClick={handleNewFlow} className="h-7 text-xs px-2">
            <Plus size={14} className="mr-1" /> Nuevo
          </Button>

          {currentFlow.status === 'draft' && (
            <span className="text-xs bg-warn/20 text-warn px-2 py-0.5 rounded-sm ml-2">Borrador</span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={handleSave} className="gap-2">
            <Save size={16} /> Guardar
          </Button>
          <Button variant="primary" size="sm" onClick={handleExecute} className="gap-2" disabled={nodes.length === 0}>
            <Play size={16} /> Ejecutar Flujo
          </Button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <Button variant="icon" size="icon" onClick={() => dispatch(toggleCanvasExpanded())} title={canvasExpanded ? "Restaurar layout" : "Expandir canvas"}>
            {canvasExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </Button>
          <Button variant="icon" size="icon">
            <MoreHorizontal size={18} />
          </Button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="flex-1 flex min-h-0 relative">
          {!canvasExpanded && nodeLibraryExpanded && <NodeLibrary />}
          
          <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              fitView
              className="bg-bg"
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} size={1} color="#e5e5e5" />
              <Controls className="!bg-surface !border-border !shadow-sm !rounded-sm" />
              <MiniMap 
                nodeColor="#e5e5e5"
                maskColor="rgba(250, 250, 250, 0.7)"
                className="!bg-surface !border-border !rounded-sm !shadow-sm" 
              />
            </ReactFlow>
          </div>

          {!canvasExpanded && selectedNodeId && (
            <NodeInspector 
              nodes={nodes} 
              setNodes={setNodes}
              edges={edges}
              selectedNodeId={selectedNodeId} 
            />
          )}
        </div>

        {/* Export success notification toast */}
        {exportNotification && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
            <div className="bg-surface border border-success/40 rounded-md shadow-raised px-5 py-4 flex items-start gap-4 min-w-[380px] max-w-[520px]">
              <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={18} className="text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileSpreadsheet size={14} className="text-muted shrink-0" />
                  <span className="text-sm font-semibold">{exportNotification.fileName}</span>
                  <span className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded-sm font-mono">{exportNotification.format}</span>
                </div>
                <p className="text-xs text-muted mb-2">
                  {exportNotification.records.toLocaleString()} registros exportados exitosamente
                </p>
                <p className="text-[10px] font-mono text-muted/70 break-all bg-bg px-2 py-1.5 rounded-sm border border-border">
                  {exportNotification.filePath || `backend/data/${exportNotification.fileName}`}
                </p>
              </div>
              <button
                onClick={() => setExportNotification(null)}
                className="text-muted hover:text-fg shrink-0 mt-0.5"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* FlowSummary bottom cards */}
        {!canvasExpanded && (
          <div className="h-[140px] border-t border-border bg-surface grid grid-cols-2 gap-4 p-4 shrink-0 z-10 overflow-y-auto">
            <div className="border border-border rounded-sm p-3 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold">Programaciones activas</h3>
                <p className="text-[10px] text-muted">Próximas ejecuciones automáticas de este flujo.</p>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border mt-2">
                <div className="w-6 h-6 rounded-full bg-accent-light text-accent flex items-center justify-center shrink-0">
                  <Clock size={12} />
                </div>
                <div className="text-[11px]">
                  <strong>Lunes a las 08:00</strong>
                  <span className="block text-[10px] text-muted">Cron: 0 8 * * 1</span>
                </div>
              </div>
            </div>

            <div className="border border-border rounded-sm p-3 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold">Último resultado de ejecución</h3>
                <p className="text-[10px] text-muted">Historial del último disparo manual o automático.</p>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border mt-2">
                <div className="w-2 h-2 rounded-full bg-success shrink-0"></div>
                <div className="text-[11px]">
                  <strong>Ejecución Exitosa</strong>
                  <span className="block text-[10px] text-muted">Duración: {currentFlow.last_run_duration_ms || 1300}ms • Registros: {currentFlow.last_run_record_count || 148}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowEditor() {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(state => state.flows.loading);
  const flows = useAppSelector(state => state.flows.flows);

  useEffect(() => {
    dispatch(fetchFlows());
  }, [dispatch]);

  return (
    <ReactFlowProvider>
      {loading && flows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">Cargando flujos...</div>
      ) : (
        <FlowCanvas />
      )}
    </ReactFlowProvider>
  );
}

export default FlowEditor;
