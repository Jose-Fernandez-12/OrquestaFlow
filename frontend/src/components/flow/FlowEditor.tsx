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
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Save,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Clock,
  PanelLeft,
  Plus,
  CheckCircle2,
  FileSpreadsheet,
  X,
  ChevronLeft,
  Lock,
  Unlock,
  Copy,
  Download,
  Trash2,
  AlertTriangle,
  Loader2,
  History,
  Square
} from 'lucide-react';
import { io } from 'socket.io-client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { FlowExecutionHistoryModal } from './FlowExecutionHistoryModal';
import { 
  fetchFlows, 
  fetchFlow,
  setCurrentFlow, 
  createFlow,
  saveFlow, 
  deleteFlow,
  duplicateFlow,
  selectNode, 
  executeFlow,
  stopFlow,
  toggleCanvasExpanded,
  toggleNodeLibraryExpanded,
  setNodeExecuting,
  setNodeCompleted,
  setNodeError,
  setNodeProgress,
  resetNodeStates
} from '../../store/flowSlice';
import { fetchSchedules } from '../../store/scheduleSlice';
import { fetchQueries } from '../../store/querySlice';
import { Button } from '../ui/button';
import { nodeTypes } from './nodes';
import { NodeLibrary } from './NodeLibrary';
import { NodeInspector } from './NodeInspector';
import { cn } from '../../lib/utils';
import { downloadAsXMLSpreadsheet, downloadAsCSV, resolveExportData, triggerBrowserDownload } from '../../lib/exportUtils';

function FlowCanvas() {
  const dispatch = useAppDispatch();
  const flows = useAppSelector(state => state.flows.flows);
  const currentFlow = useAppSelector(state => state.flows.currentFlow);
  const schedules = useAppSelector(state => state.schedules.schedules);
  const canvasExpanded = useAppSelector(state => state.flows.canvasExpanded);
  const nodeLibraryExpanded = useAppSelector(state => state.flows.nodeLibraryExpanded);
  const selectedNodeId = useAppSelector(state => state.flows.selectedNodeId);
  const completedNodeIds = useAppSelector(state => state.flows.completedNodeIds);
  const errorNodeIds = useAppSelector(state => state.flows.errorNodeIds);
  const queries = useAppSelector(state => (state as any).queries.queries || []);

  const flowSchedules = currentFlow 
    ? schedules.filter(s => s.target_type === 'flow' && s.target_id === currentFlow.id && s.is_active === 1)
    : [];
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  
  const { id: routeFlowId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [editingName, setEditingName] = useState(currentFlow?.name || '');
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [exportNotification, setExportNotification] = useState<{
    fileName: string;
    downloadUrl: string;
    records: number;
    format: string;
    filePath?: string;
    id: number;
  }[]>([]);

  const [inspectNodeData, setInspectNodeData] = useState<{
    id: string;
    label: string;
    result: any;
    hasError: boolean;
  } | null>(null);

  const [missingParamsContext, setMissingParamsContext] = useState<{
    nodesWithMissing: { node: Node, missing: string[], currentParams: Record<string, string> }[];
  } | null>(null);
  
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  const [isLiveExecuting, setIsLiveExecuting] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const downloadedUrlsRef = useRef(new Set<string>());

  const autoDownloadFile = (downloadUrl: string, fileName: string) => {
    if (downloadedUrlsRef.current.has(downloadUrl)) return;
    downloadedUrlsRef.current.add(downloadUrl);
    triggerBrowserDownload(downloadUrl, fileName);
    setTimeout(() => {
      downloadedUrlsRef.current.delete(downloadUrl);
    }, 15000);
  };

  // Sync flow from route parameter
  useEffect(() => {
    if (routeFlowId && (!currentFlow || currentFlow.id !== routeFlowId)) {
      const match = flows.find(f => f.id === routeFlowId);
      if (match) {
        dispatch(setCurrentFlow(match));
      } else {
        dispatch(fetchFlow(routeFlowId));
      }
    }
  }, [routeFlowId, flows, currentFlow, dispatch]);

  const isLocked = currentFlow?.is_locked === 1;

  useEffect(() => {
    const handleInspect = (e: any) => {
      setInspectNodeData(e.detail);
    };
    window.addEventListener('inspect-node-result', handleInspect);
    return () => window.removeEventListener('inspect-node-result', handleInspect);
  }, []);

  useEffect(() => {
    if (currentFlow) setEditingName(currentFlow.name);
  }, [currentFlow?.id, currentFlow?.name]);

  const flowId = currentFlow?.id;

  // Connect socket.io for real-time progress and synchronize active execution state
  useEffect(() => {
    if (!flowId) return;

    // Query active execution state on mount (syncs if execution started from catalog or earlier)
    fetch(`http://localhost:3001/api/flows/${flowId}/execution-state`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.data) {
          const state = data.data;
          const isRunning = state.isRunning || state.status === 'running';
          setIsLiveExecuting(isRunning);

          if (state.nodes) {
            Object.entries(state.nodes).forEach(([nodeId, nodeInfo]: [string, any]) => {
              if (nodeInfo.status === 'completed') {
                dispatch(setNodeCompleted({ nodeId, result: nodeInfo.result }));
              } else if (nodeInfo.status === 'running') {
                dispatch(setNodeExecuting(nodeId));
              } else if (nodeInfo.status === 'error') {
                dispatch(setNodeError({ nodeId, error: nodeInfo.result }));
              } else if (nodeInfo.status === 'progress' && nodeInfo.current && nodeInfo.total) {
                dispatch(setNodeProgress({ nodeId, current: nodeInfo.current, total: nodeInfo.total }));
              }
            });
          }
        }
      })
      .catch(err => {
        console.error('Failed to sync flow execution state', err);
      });

    const socket = io('http://localhost:3001');

    socket.on('flow-progress', (data: { flowId: string; nodeId: string; status: 'running' | 'completed' | 'error' | 'progress', result?: any, current?: number, total?: number }) => {
      if (data.flowId === flowId) {
        if (data.status === 'running') {
          setIsLiveExecuting(true);
          dispatch(setNodeExecuting(data.nodeId));
        } else if (data.status === 'completed') {
          dispatch(setNodeCompleted({ nodeId: data.nodeId, result: data.result }));
        } else if (data.status === 'error') {
          dispatch(setNodeError({ nodeId: data.nodeId, error: data.result }));
        } else if (data.status === 'progress' && data.current && data.total) {
          dispatch(setNodeProgress({ nodeId: data.nodeId, current: data.current, total: data.total }));
        }
      }
    });

    socket.on('flow-completed', (data: { flowId: string }) => {
      if (data.flowId === flowId) {
        setIsLiveExecuting(false);
      }
    });

    socket.on('flow-failed', (data: { flowId: string }) => {
      if (data.flowId === flowId) {
        setIsLiveExecuting(false);
      }
    });

    socket.on('flow-stopped', (data: { flowId: string }) => {
      if (data.flowId === flowId) {
        setIsLiveExecuting(false);
      }
    });

    socket.on('flow-export-ready', (data: { flowId: string; fileName: string; downloadUrl: string; records: number; format: string; filePath?: string }) => {
      if (data.flowId === flowId) {
        const id = Date.now() + Math.random();
        setExportNotification(prev => [...prev, { ...data, id }]);
        
        // Auto-download file
        autoDownloadFile(data.downloadUrl, data.fileName);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
          setExportNotification(prev => prev.filter(n => n.id !== id));
        }, 5000);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [flowId, dispatch]);

  // Update edge styles when node statuses change
  useEffect(() => {
    setEdges(eds => {
      let changed = false;
      const newEds = eds.map(edge => {
        let expectedStroke = '#3b82f6'; // default blue
        if (errorNodeIds.includes(edge.source)) {
          expectedStroke = '#ef4444'; // red
        } else if (completedNodeIds.includes(edge.source)) {
          expectedStroke = '#22c55e'; // green
        }
        
        if (!edge.style || edge.style.stroke !== expectedStroke) {
          changed = true;
          return {
            ...edge,
            style: { ...edge.style, stroke: expectedStroke, strokeWidth: 2 },
            interactionWidth: 20
          };
        }
        return edge;
      });
      return changed ? newEds : eds;
    });
  }, [completedNodeIds, errorNodeIds, setEdges]);

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
    if (!currentFlow || isLocked) return;
    const definition = JSON.stringify({ nodes, edges });
    dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName }));
    
    setShowSaveNotification(true);
    setTimeout(() => {
      setShowSaveNotification(false);
    }, 3000);
  };

  const handleToggleLock = async () => {
    if (!currentFlow) return;
    const newLock = currentFlow.is_locked === 1 ? 0 : 1;
    await dispatch(saveFlow({
      id: currentFlow.id,
      is_locked: newLock
    }));
    setShowOptionsMenu(false);
  };

  const handleDuplicateCurrentFlow = async () => {
    if (!currentFlow) return;
    const res = await dispatch(duplicateFlow(currentFlow)).unwrap();
    navigate(`/flujos/${res.id}`);
    setShowOptionsMenu(false);
  };

  const handleExportJSON = () => {
    if (!currentFlow) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      name: currentFlow.name,
      description: currentFlow.description,
      definition: currentFlow.definition
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentFlow.name.toLowerCase().replace(/\s+/g, '_')}_flow.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setShowOptionsMenu(false);
  };

  const handleDeleteCurrentFlowConfirm = async () => {
    if (!currentFlow) return;
    setIsDeleting(true);
    try {
      await dispatch(deleteFlow(currentFlow.id));
      setIsDeleteModalOpen(false);
      navigate('/flujos');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExecute = async () => {
    if (!currentFlow) return;
    dispatch(resetNodeStates());
    
    // Check for missing parameters
    const nodesWithMissing: { node: Node, missing: string[], currentParams: Record<string, string> }[] = [];
    nodes.forEach(node => {
      if (node.type === 'query' && node.data?.queryId) {
        const query = queries.find((q: any) => q.id === node.data!.queryId);
        if (query) {
          const sqlText = (query.sql_text as string) || '';
          const paramMatches = [...sqlText.matchAll(/(?:^|[\s\(=<>,+\-*/'%]):([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
          const uniqueParams = [...new Set(paramMatches.map(m => m[1]))];
          
          let queryParams: Record<string, string> = {};
          if (node.data.queryParams) {
            try { queryParams = JSON.parse(node.data.queryParams as string); } catch(e) {}
          }
          
          // Parameter is missing if it is undefined or exactly empty string
          const missing = uniqueParams.filter(p => queryParams[p] === undefined || queryParams[p] === '');
          if (missing.length > 0) {
            nodesWithMissing.push({ node, missing, currentParams: queryParams });
          }
        }
      }
    });

    if (nodesWithMissing.length > 0) {
      setMissingParamsContext({ nodesWithMissing });
      return; // Stop here and wait for the user to fill the modal
    }

    await performExecution(nodes);
  };

  const performExecution = async (nodesToExecute: Node[]) => {
    // Auto-guardar definición antes de ejecutar para que el backend tenga los últimos datos
    const definition = JSON.stringify({ nodes: nodesToExecute, edges });
    await dispatch(saveFlow({ id: currentFlow!.id, definition, name: editingName }));
    
    const result = await dispatch(executeFlow(currentFlow!.id));
    
    // Check for exported files returned by backend execution
    const payload = (result as any)?.payload;
    const exportedFiles = payload?.exportedFiles || [];
    if (exportedFiles.length > 0) {
      exportedFiles.forEach((file: any, index: number) => {
        setTimeout(() => {
          autoDownloadFile(file.downloadUrl, file.fileName);
        }, index * 400);
      });
    } else {
      // Find export node results in the execution context as client-side fallback
      const context = payload?.context as Record<string, any> | undefined;
      if (context) {
        const exportNodes = nodesToExecute.filter(n => n.type === 'export');
        exportNodes.forEach(exportNode => {
          const data = exportNode.data as any;
          const format = data?.format || 'CSV';
          const rawFileName = data?.fileName as string | undefined;
          let dataSource = data?.dataSource;
          
          if (!dataSource) {
            // If empty, explicitly use the node immediately upstream
            const incomingEdge = edges.find(e => e.target === exportNode.id);
            if (incomingEdge) {
              dataSource = `{{${incomingEdge.source}}}`;
            }
          }
          
          const exportData = resolveExportData(context, dataSource);
          const columns = (data?.columns && data.columns.length > 0) 
            ? data.columns 
            : (exportData[0] ? Object.keys(exportData[0]).map(k => ({ header: k, key: k })) : []);
          
          if (exportData.length > 0) {
            if (format === 'Excel') {
              downloadAsXMLSpreadsheet(exportData, columns, rawFileName || 'export', data?.headerColor as string | undefined);
            } else {
              downloadAsCSV(exportData, columns, rawFileName || 'export');
            }
          }
        });
      }
    }
  };

  const handleStopExecution = async () => {
    if (!currentFlow) return;
    try {
      await dispatch(stopFlow(currentFlow.id)).unwrap();
      setIsLiveExecuting(false);
      dispatch(showToast(`Ejecución de «${currentFlow.name}» detenida.`));
    } catch (err: any) {
      dispatch(showToast(`No se pudo detener el flujo: ${err.message}`));
    }
  };

  if (!currentFlow) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted bg-bg p-8">
        <p className="text-sm">No se encontró el flujo especificado o está cargando...</p>
        <Button variant="primary" size="sm" onClick={() => navigate('/flujos')} className="gap-2">
          <ChevronLeft size={16} /> Volver al catálogo de flujos
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Topbar inside editor */}
      <div className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={() => navigate('/flujos')}
            className="gap-1.5 h-8 text-xs font-medium"
            title="Volver al catálogo de flujos"
          >
            <ChevronLeft size={16} />
            <span>Volver a flujos</span>
          </Button>

          <div className="w-px h-6 bg-border"></div>

          <Button
            variant="icon"
            size="icon"
            onClick={() => dispatch(toggleNodeLibraryExpanded())}
            title={nodeLibraryExpanded ? "Ocultar Librería" : "Mostrar Librería"}
          >
            <PanelLeft size={18} />
          </Button>

          <div className="w-px h-6 bg-border"></div>

          {isLocked ? (
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm px-1 py-0.5 text-fg truncate max-w-[280px]" title={currentFlow.name}>
                {currentFlow.name}
              </h2>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
                <Lock size={11} /> Protegido
              </span>
              <button
                onClick={handleToggleLock}
                className="text-xs text-accent hover:underline font-medium ml-1 cursor-pointer"
              >
                Desbloquear
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="font-medium bg-transparent border-b border-border hover:border-accent focus:border-accent focus:outline-none px-1 py-0.5 text-sm w-[260px]"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                placeholder="Nombre del flujo"
              />
              {currentFlow.status === 'draft' ? (
                <span className="text-[10px] bg-warn/15 text-warn px-2 py-0.5 rounded border border-warn/20 font-medium">Borrador</span>
              ) : (
                <span className="text-[10px] bg-success/15 text-success px-2 py-0.5 rounded border border-success/20 font-medium">Guardado</span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {isLiveExecuting && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/15 border border-accent/30 rounded text-accent text-xs font-semibold animate-pulse">
              <Loader2 size={13} className="animate-spin" />
              <span>Ejecución en vivo...</span>
            </div>
          )}
          {!isLocked && (
            <Button variant="default" size="sm" onClick={handleSave} className="gap-2">
              <Save size={16} /> Guardar
            </Button>
          )}
          {isLiveExecuting ? (
            <Button
              variant="default"
              size="sm"
              onClick={handleStopExecution}
              className="gap-1.5 bg-danger text-white hover:bg-danger/90 border-danger animate-pulse"
              title="Detener ejecución actual"
            >
              <Square size={12} className="fill-white" />
              <span>Detener Flujo</span>
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleExecute} className="gap-2" disabled={nodes.length === 0}>
              <Play size={16} /> Ejecutar Flujo
            </Button>
          )}
          <div className="w-px h-6 bg-border mx-1"></div>
          <Button variant="icon" size="icon" onClick={() => dispatch(toggleCanvasExpanded())} title={canvasExpanded ? "Restaurar layout" : "Expandir canvas"}>
            {canvasExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </Button>

          {/* Options Menu Button (...) */}
          <div className="relative">
            <Button
              variant="icon"
              size="icon"
              onClick={() => setShowOptionsMenu(prev => !prev)}
              title="Opciones del flujo"
              className={showOptionsMenu ? "bg-bg text-fg" : ""}
            >
              <MoreHorizontal size={18} />
            </Button>

            {showOptionsMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-surface border border-border rounded-md shadow-raised py-1 z-50 animate-in fade-in zoom-in-95 duration-fast text-xs">
                <button
                  onClick={handleToggleLock}
                  className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                >
                  {isLocked ? <Unlock size={14} className="text-slate-600" /> : <Lock size={14} className="text-slate-600" />}
                  <span>{isLocked ? 'Desbloquear edición' : 'Bloquear edición'}</span>
                </button>

                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setShowHistoryModal(true);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                >
                  <History size={14} className="text-muted" />
                  <span>Historial de ejecuciones</span>
                </button>

                <button
                  onClick={handleDuplicateCurrentFlow}
                  className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                >
                  <Copy size={14} className="text-muted" />
                  <span>Duplicar este flujo</span>
                </button>

                <button
                  onClick={handleExportJSON}
                  className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                >
                  <Download size={14} className="text-muted" />
                  <span>Exportar JSON</span>
                </button>

                <div className="h-px bg-border my-1"></div>

                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setIsDeleteModalOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-danger/10 flex items-center gap-2 text-danger transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Eliminar flujo</span>
                </button>
              </div>
            )}
          </div>
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
              onNodesChange={isLocked ? undefined : onNodesChange}
              onEdgesChange={isLocked ? undefined : onEdgesChange}
              onConnect={isLocked ? undefined : onConnect}
              onInit={setReactFlowInstance}
              onDrop={isLocked ? undefined : onDrop}
              onDragOver={isLocked ? undefined : onDragOver}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              deleteKeyCode={isLocked ? null : ['Backspace', 'Delete']}
              nodesDraggable={!isLocked}
              nodesConnectable={!isLocked}
              elementsSelectable={!isLocked}
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

        {/* Notifications */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
          {showSaveNotification && (
            <div className="animate-fade-in bg-surface border border-success/40 rounded-md shadow-raised px-5 py-3 flex items-center gap-3 min-w-[280px]">
              <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                <Save size={14} className="text-success" />
              </div>
              <span className="text-sm font-medium text-fg">Flujo guardado exitosamente</span>
            </div>
          )}
          
          {exportNotification.map((notif) => (
            <div key={notif.id} className="animate-fade-in bg-surface border border-success/40 rounded-md shadow-raised px-5 py-4 flex items-start gap-4 min-w-[380px] max-w-[520px]">
              <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={18} className="text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileSpreadsheet size={14} className="text-muted shrink-0" />
                  <span className="text-sm font-semibold">{notif.fileName}</span>
                  <span className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded-sm font-mono">{notif.format}</span>
                </div>
                <p className="text-xs text-muted mb-2">
                  {notif.records.toLocaleString()} registros exportados exitosamente
                </p>
                <p className="text-[10px] font-mono text-muted/70 break-all bg-bg px-2 py-1.5 rounded-sm border border-border">
                  {notif.filePath || `backend/data/${notif.fileName}`}
                </p>
              </div>
              <button
                onClick={() => setExportNotification(prev => prev.filter(n => n.id !== notif.id))}
                className="text-muted hover:text-fg shrink-0 mt-0.5"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>

        {/* FlowSummary bottom cards */}
        {!canvasExpanded && (
          <div className="h-[140px] border-t border-border bg-surface grid grid-cols-2 gap-4 p-4 shrink-0 z-10 overflow-y-auto">
            <div className="border border-border rounded-sm p-3 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold">Programaciones activas</h3>
                <p className="text-[10px] text-muted">Próximas ejecuciones automáticas de este flujo.</p>
              </div>
              {flowSchedules.length > 0 ? (
                flowSchedules.map(s => (
                  <div key={s.id} className="flex items-center gap-2 pt-2 border-t border-border mt-2">
                    <div className="w-6 h-6 rounded-full bg-accent-light text-accent flex items-center justify-center shrink-0">
                      <Clock size={12} />
                    </div>
                    <div className="text-[11px] truncate">
                      <strong>{s.name || 'Programación Activa'}</strong>
                      <span className="block text-[10px] text-muted">Cron: {s.cron_expression}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 pt-2 border-t border-border mt-2 text-[11px] text-muted">
                  Sin programaciones activas
                </div>
              )}
            </div>

            <div className="border border-border rounded-sm p-3 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold">Último resultado de ejecución</h3>
                <p className="text-[10px] text-muted">Historial del último disparo manual o automático.</p>
              </div>
              {currentFlow.last_run_at ? (
                <div className="flex items-center gap-2 pt-2 border-t border-border mt-2">
                  <div className="w-2 h-2 rounded-full bg-success shrink-0"></div>
                  <div className="text-[11px]">
                    <strong>Ejecución Exitosa</strong>
                    <span className="block text-[10px] text-muted">
                      Duración: {currentFlow.last_run_duration_ms}ms • Registros: {currentFlow.last_run_record_count}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-2 border-t border-border mt-2 text-[11px] text-muted">
                  Ninguna ejecución previa
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Missing Params Modal */}
      {missingParamsContext && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-lg flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-danger">Faltan parámetros requeridos</h2>
              <button onClick={() => setMissingParamsContext(null)} className="p-2 hover:bg-muted rounded-md text-muted-foreground">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh] space-y-4">
              <p className="text-sm text-muted">
                Antes de ejecutar el flujo, debes llenar los parámetros obligatorios de las siguientes consultas:
              </p>
              {missingParamsContext.nodesWithMissing.map((item, index) => (
                <div key={item.node.id} className="border border-border rounded-md p-3 bg-bg">
                  <h3 className="text-sm font-semibold mb-2">{item.node.data?.label as string || 'Nodo de Consulta'}</h3>
                  <div className="space-y-2">
                    {item.missing.map(param => (
                      <div key={param} className="flex flex-col gap-1">
                        <label className="text-[11px] font-mono text-accent">:{param}</label>
                        <input
                          type="text"
                          className="flex h-8 w-full rounded-md border border-border bg-surface px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          placeholder={`Valor para ${param}`}
                          value={item.currentParams[param] || ''}
                          onChange={(e) => {
                            const newContext = { ...missingParamsContext };
                            newContext.nodesWithMissing[index].currentParams[param] = e.target.value;
                            setMissingParamsContext(newContext);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button variant="default" onClick={() => setMissingParamsContext(null)}>Cancelar</Button>
              <Button onClick={() => {
                const stillMissing = missingParamsContext.nodesWithMissing.some(item => 
                  item.missing.some(p => !item.currentParams[p] || item.currentParams[p] === '')
                );
                if (stillMissing) {
                  alert('Aún faltan parámetros por llenar.');
                  return;
                }
                const updatedNodes = missingParamsContext.nodesWithMissing.map(n => ({
                  ...n.node,
                  data: {
                    ...n.node.data,
                    queryParams: JSON.stringify(n.currentParams)
                  }
                }));
                const newNodes = nodes.map(n => {
                  const updated = updatedNodes.find(u => u.id === n.id);
                  return updated || n;
                });
                setNodes(newNodes);
                setMissingParamsContext(null);
                performExecution(newNodes);
              }}>Continuar Ejecución</Button>
            </div>
          </div>
        </div>
      )}

      {/* Node Result Modal */}
      {inspectNodeData && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-md shadow-lg border border-border w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  Resultados del nodo: <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{inspectNodeData.label}</span>
                </h2>
                <div className={cn("text-xs mt-1", inspectNodeData.hasError ? "text-red-500" : "text-success")}>
                  {inspectNodeData.hasError ? "Error en ejecución" : "Ejecución exitosa"}
                </div>
              </div>
              <button onClick={() => setInspectNodeData(null)} className="p-2 hover:bg-muted rounded-md text-muted-foreground">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 bg-bg/50">
              <pre className="text-xs font-mono p-4 bg-black/80 text-green-400 rounded-md overflow-auto h-full">
                {JSON.stringify(inspectNodeData.result, null, 2)}
              </pre>
            </div>
            <div className="p-4 border-t border-border flex justify-end">
              <Button onClick={() => setInspectNodeData(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentFlow && (
        <div className="fixed inset-0 bg-fg/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-fast">
          <div className="bg-surface border border-border rounded-md shadow-raised w-full max-w-sm p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-fast">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-danger/10 text-danger flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-fg">¿Eliminar este flujo?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  ¿Estás seguro de que deseas eliminar permanentemente <strong>«{currentFlow.name}»</strong>? Esta acción borrará todos sus nodos y cancelará las programaciones vinculadas.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleDeleteCurrentFlowConfirm}
                disabled={isDeleting}
                className="bg-danger text-white hover:bg-danger/90 gap-1.5"
              >
                {isDeleting && <Loader2 size={13} className="animate-spin" />}
                Eliminar flujo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Execution History Modal */}
      <FlowExecutionHistoryModal
        flow={currentFlow}
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
      />

    </div>
  );
}

export function FlowEditor() {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(state => state.flows.loading);
  const flows = useAppSelector(state => state.flows.flows);

  useEffect(() => {
    dispatch(fetchFlows());
    dispatch(fetchSchedules());
    dispatch(fetchQueries());
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
