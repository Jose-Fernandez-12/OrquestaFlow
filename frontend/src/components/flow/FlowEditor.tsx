import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  ConnectionMode,
  MarkerType,
  type Connection,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { v4 as uuid } from 'uuid';
import { useParams, useNavigate } from 'react-router-dom';
import { SOCKET_URL, getApiUrl } from '../../lib/api';
import {
  Play,
  Save,
  Maximize2,
  Minimize2,
  MoreHorizontal,
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
  History,
  Square,
  Bug,
  StepForward,
  PlayCircle,
  Loader2,
  Pause,
  Eye,
  Upload,
  FileCode2,
  GitCommitVertical,
  Check,
  Terminal,
  Undo2,
  Redo2,
  AlertCircle,
  Search
} from 'lucide-react';
import { io } from 'socket.io-client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { showToast } from '../../store/uiSlice';
import { FlowExecutionHistoryModal } from './FlowExecutionHistoryModal';
import { FlowVersionsModal } from './FlowVersionsModal';
import { ImportFlowModal } from './ImportFlowModal';
import { NodeResultModal } from './NodeResultModal';
import { getBranchOutputs, isBranchHandle } from './nodeDefinitions';
import { useCanvasHistory } from './canvas/useCanvasHistory';
import { CanvasSearch } from './canvas/CanvasSearch';
import { findParentForEachNode, getForEachItems } from './inspector/utils';
import { validateFlow, groupIssues, type FlowIssue } from './validation/flowValidation';
import { FlowIssuesList, PreRunIssuesDialog } from './validation/FlowIssues';
import { FlowIssuesContext } from './validation/FlowIssuesContext';
import { canvasSignature, copySelection, isClipboardPayload, pasteClipboard, type ClipboardPayload } from './canvas/canvasState';
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
  setNodeTimer,
  setNodeRetry,
  resetNodeStates,
  setNodePaused,
  setExecutionMode,
  resumeDebugNode,
  pauseDebugExecution,
  setDebugModalOpen
} from '../../store/flowSlice';
import { fetchSchedules } from '../../store/scheduleSlice';
import { fetchQueries } from '../../store/querySlice';
import { Button } from '../ui/button';
import { nodeTypes } from './nodes';
import { NodeLibrary } from './NodeLibrary';
import { NodeInspector } from './NodeInspector';
import { DebugContextViewer } from './DebugContextViewer';
import { ExportPreviewModal } from './ExportPreviewModal';
import { DataSourcePreviewModal } from './DataSourcePreviewModal';
import { cn } from '../../lib/utils';
import { downloadAsXMLSpreadsheet, downloadAsCSV, resolveExportData, triggerBrowserDownload } from '../../lib/exportUtils';

// Drops edges whose nodes no longer exist or whose conditional output (deleted switch case,
// changed mode) is gone, since those would never be followed.
function pruneEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return edges.filter(edge => {
    const source = byId.get(edge.source);
    if (!source || !byId.has(edge.target)) return false;
    if (source.type === 'conditionalBranch' && isBranchHandle(edge.sourceHandle)) {
      return getBranchOutputs(source.data).some(o => o.handle === edge.sourceHandle);
    }
    return true;
  });
}

const CLIPBOARD_KEY = 'orquesta-clipboard';

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
  const skippedNodeIds = useAppSelector(state => state.flows.skippedNodeIds);
  const pausedNodeIds = useAppSelector(state => state.flows.pausedNodeIds);
  const executionMode = useAppSelector(state => state.flows.executionMode);
  const nodeResults = useAppSelector(state => state.flows.nodeResults);
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);
  const queries = useAppSelector(state => (state as any).queries.queries || []);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  
  const { id: routeFlowId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  const isDebugModalOpen = useAppSelector(state => state.flows.isDebugModalOpen);
  const allNodePreviews = useAppSelector(state => state.flows.debugPreviewsByNode || {});
  const globalRequestPreview = useAppSelector(state => state.flows.debugRequestPreview);
  const globalResponsePreview = useAppSelector(state => state.flows.debugResponsePreview);

  // Active node for debugging inspection (persisted so modal doesn't flicker/unmount while stepping)
  const activeDebugNodeId = pausedNodeIds.length > 0 ? pausedNodeIds[pausedNodeIds.length - 1] : selectedNodeId;
  const [persistedDebugNodeId, setPersistedDebugNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (activeDebugNodeId) {
      setPersistedDebugNodeId(activeDebugNodeId);
    }
  }, [activeDebugNodeId]);

  const debugTargetNodeId = activeDebugNodeId || persistedDebugNodeId;
  const debugTargetNode = debugTargetNodeId ? nodes.find(n => n.id === debugTargetNodeId) : null;
  const nodeDebugPreview = debugTargetNodeId ? allNodePreviews[debugTargetNodeId] : undefined;
  const debugRequestPreview = nodeDebugPreview !== undefined ? nodeDebugPreview.requestPreview : globalRequestPreview;
  const debugResponsePreview = nodeDebugPreview !== undefined ? nodeDebugPreview.responsePreview : globalResponsePreview;
  const iterationHistory = nodeDebugPreview?.history || [];

  // Keep React Flow nodes.selected in sync with Redux selectedNodeId
  useEffect(() => {
    setNodes(nds => {
      let hasChanges = false;
      const updated = nds.map(n => {
        const shouldBeSelected = selectedNodeId !== null && n.id === selectedNodeId;
        if (!!n.selected !== shouldBeSelected) {
          hasChanges = true;
          return { ...n, selected: shouldBeSelected };
        }
        return n;
      });
      return hasChanges ? updated : nds;
    });
  }, [selectedNodeId, setNodes]);
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

  const [previewExportData, setPreviewExportData] = useState<{
    id: string;
    label: string;
    result: any;
    completed: boolean;
    hasError: boolean;
    fileName?: string;
    format?: string;
  } | null>(null);

  const [previewDataSourceData, setPreviewDataSourceData] = useState<{
    id: string;
    label: string;
    filePath?: string;
    fileName?: string;
    format?: string;
    sheetName?: string;
    sheets?: string[];
    sampleRows?: any[];
    totalRows?: number;
    result?: any;
    completed?: boolean;
  } | null>(null);

  const [missingParamsContext, setMissingParamsContext] = useState<{
    nodesWithMissing: { node: Node, missing: string[], currentParams: Record<string, string> }[];
  } | null>(null);
  
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  const [isLiveExecuting, setIsLiveExecuting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const isLiveExecutingRef = useRef(false);
  useEffect(() => {
    isLiveExecutingRef.current = isLiveExecuting;
  }, [isLiveExecuting]);

  useEffect(() => {
    if (pausedNodeIds.length > 0 || !isLiveExecuting) {
      setIsPausing(false);
    }
  }, [pausedNodeIds.length, isLiveExecuting]);

  const debugSessionLostAt = useAppSelector(state => state.flows.debugSessionLostAt);
  useEffect(() => {
    if (!debugSessionLostAt) return;
    setIsLiveExecuting(false);
    dispatch(showToast('La depuración ya no está activa en el servidor. Vuelve a ejecutar el flujo.'));
  }, [debugSessionLostAt, dispatch]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const downloadedUrlsRef = useRef(new Set<string>());

  const autoDownloadFile = (downloadUrl: string, fileName: string) => {
    const key = `${downloadUrl}_${fileName}`;
    if (downloadedUrlsRef.current.has(key)) return;
    downloadedUrlsRef.current.add(key);
    triggerBrowserDownload(downloadUrl, fileName);
    setTimeout(() => {
      downloadedUrlsRef.current.delete(key);
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
    const handlePreviewExport = (e: any) => {
      setPreviewExportData(e.detail);
    };
    const handlePreviewDataSource = (e: any) => {
      setPreviewDataSourceData(e.detail);
    };
    window.addEventListener('inspect-node-result', handleInspect);
    window.addEventListener('preview-export-node', handlePreviewExport);
    window.addEventListener('preview-data-source-node', handlePreviewDataSource);
    return () => {
      window.removeEventListener('inspect-node-result', handleInspect);
      window.removeEventListener('preview-export-node', handlePreviewExport);
      window.removeEventListener('preview-data-source-node', handlePreviewDataSource);
    };
  }, []);

  // Sync previewExportData with latest node result if preview modal is open
  useEffect(() => {
    if (previewExportData) {
      const latestResult = nodeResults[previewExportData.id];
      const isCompleted = completedNodeIds.includes(previewExportData.id);
      const isError = errorNodeIds.includes(previewExportData.id);
      if (latestResult && latestResult !== previewExportData.result) {
        setPreviewExportData(prev => prev ? {
          ...prev,
          result: latestResult,
          completed: isCompleted,
          hasError: isError
        } : null);
      }
    }
  }, [nodeResults, completedNodeIds, errorNodeIds, previewExportData]);

  useEffect(() => {
    if (currentFlow) setEditingName(currentFlow.name);
  }, [currentFlow?.id, currentFlow?.name]);

  const flowId = currentFlow?.id;

  // Connect socket.io for real-time progress and synchronize active execution state
  useEffect(() => {
    if (!flowId) return;

    // Query active execution state on mount (syncs if execution started from catalog or earlier)
    fetch(getApiUrl(`/flows/${flowId}/execution-state`))
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

    const socket = io(SOCKET_URL);

    socket.on('flow-progress', (data: { 
      flowId: string; 
      nodeId: string; 
      status: 'running' | 'completed' | 'error' | 'progress' | 'paused'; 
      result?: any; 
      current?: number; 
      total?: number;
      remainingSeconds?: number;
      totalSeconds?: number;
      context?: any;
    }) => {
      if (data.flowId === flowId) {
        if (data.status === 'running') {
          setIsLiveExecuting(true);
          dispatch(setNodeExecuting(data.nodeId));
        } else if (data.status === 'paused') {
          setIsLiveExecuting(true);
          dispatch(setNodePaused({ 
            nodeId: data.nodeId, 
            context: data.context || data.result?.context,
            requestPreview: data.result?.requestPreview,
            responsePreview: data.result?.responsePreview,
            nodePreview: data.result?.nodePreview,
            debugType: data.result?.debugType
          }));
          dispatch(selectNode(data.nodeId));
        } else if (data.status === 'completed') {
          dispatch(setNodeCompleted({ nodeId: data.nodeId, result: data.result }));
        } else if (data.status === 'error') {
          dispatch(setNodeError({ nodeId: data.nodeId, error: data.result }));
        } else if (data.status === 'progress') {
          if (data.result?.retry) {
            dispatch(setNodeRetry({ nodeId: data.nodeId, ...data.result.retry }));
          } else if (data.current !== undefined && data.total !== undefined) {
            dispatch(setNodeProgress({ nodeId: data.nodeId, current: data.current, total: data.total }));
          }
          if (data.remainingSeconds !== undefined && data.totalSeconds !== undefined) {
            dispatch(setNodeTimer({ nodeId: data.nodeId, remainingSeconds: data.remainingSeconds, totalSeconds: data.totalSeconds }));
          } else if (data.result?.remainingSeconds !== undefined && data.result?.totalSeconds !== undefined) {
            dispatch(setNodeTimer({ nodeId: data.nodeId, remainingSeconds: data.result.remainingSeconds, totalSeconds: data.result.totalSeconds }));
          }
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

    socket.on('flow-export-ready', (data: { flowId: string; fileName: string; downloadUrl: string; records: number; format: string; filePath?: string; source?: string }) => {
      if (data.flowId === flowId) {
        // Do not auto-download if this was triggered in the background by a scheduler
        if (data.source === 'scheduler') {
          return;
        }

        // Do not auto-download if the execution was stopped or is not actively executing
        if (!isLiveExecutingRef.current) {
          return;
        }

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
        const isSkipped = skippedNodeIds.includes(edge.target);
        if (isSkipped) {
          expectedStroke = '#94a3b8'; // slate: branch not taken
        } else if (errorNodeIds.includes(edge.source)) {
          // amber when the node failed but its error policy let the flow continue
          expectedStroke = nodeResults[edge.source]?.continued ? '#f59e0b' : '#ef4444';
        } else if (completedNodeIds.includes(edge.source)) {
          expectedStroke = '#22c55e'; // green
        }
        const expectedDash = isSkipped ? '6 4' : undefined;

        if (!edge.style || edge.style.stroke !== expectedStroke || edge.style.strokeDasharray !== expectedDash || !edge.markerEnd) {
          changed = true;
          return {
            ...edge,
            markerEnd: { type: MarkerType.ArrowClosed, color: expectedStroke },
            style: { ...edge.style, stroke: expectedStroke, strokeWidth: 2, strokeDasharray: expectedDash },
            interactionWidth: 20
          };
        }
        return edge;
      });
      return changed ? newEds : eds;
    });
  }, [completedNodeIds, errorNodeIds, skippedNodeIds, nodeResults, setEdges]);



  const handleEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    if (isLocked) return;
    setEdges(eds => eds.map(e => {
      if (e.id === edge.id) {
        return {
          ...e,
          source: e.target,
          target: e.source,
          sourceHandle: undefined,
          targetHandle: undefined,
        };
      }
      return e;
    }));
  }, [isLocked, setEdges]);

  // Load flow definition when currentFlow changes
  useEffect(() => {
    if (currentFlow && currentFlow.definition) {
      try {
        const def = JSON.parse(currentFlow.definition);
        setNodes(def.nodes || []);
        const loadedEdges = (def.edges || []).map((e: Edge) => ({
          ...e,
          markerEnd: e.markerEnd || { type: MarkerType.ArrowClosed, color: '#3b82f6' }
        }));
        setEdges(loadedEdges);
        setSavedSignature(canvasSignature(def.nodes || [], loadedEdges));
      } catch (e) {
        console.error("Failed to parse flow definition", e);
      }
    } else {
      setNodes([]);
      setEdges([]);
      setSavedSignature(canvasSignature([], []));
    }
  }, [currentFlow, setNodes, setEdges]);

  const canvasHistory = useCanvasHistory({
    nodes,
    edges,
    setNodes,
    setEdges,
    resetKey: currentFlow?.id,
    savedSignature,
  });

  // Configuration problems, recomputed shortly after each change
  const [issues, setIssues] = useState<FlowIssue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [pendingRunMode, setPendingRunMode] = useState<'normal' | 'debug' | null>(null);
  useEffect(() => {
    if (nodes.some(n => n.dragging)) return;
    const timer = setTimeout(() => setIssues(validateFlow(nodes, edges)), 250);
    return () => clearTimeout(timer);
  }, [nodes, edges]);
  const issuesByNode = useMemo(() => groupIssues(issues), [issues]);
  const errorCount = issues.filter(i => i.level === 'error').length;

  const focusNode = useCallback((nodeId: string) => {
    dispatch(selectNode(nodeId));
    reactFlowInstance?.fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 });
  }, [dispatch, reactFlowInstance]);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      if (params.source === params.target) return;

      setEdges((eds) => {
        // Remover cualquier conexión previa entre estos dos nodos para reemplazarla limpiamente
        const filtered = eds.filter(e => 
          !( (e.source === params.source && e.target === params.target) || 
             (e.source === params.target && e.target === params.source) )
        );
        return addEdge({
          id: `e_${params.source}_${params.target}_${Date.now()}`,
          ...params,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' }
        }, filtered);
      });
    },
    [setEdges]
  );

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    return connection.source !== connection.target;
  }, []);

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

      const newNode: Node = type === 'note'
        ? { id: uuid(), type, position, data: { label: 'Nota', text: '', color: 'amarillo' }, width: 240, height: 130, zIndex: -1 }
        : { id: uuid(), type, position, data: { label: label || type } };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onSelectionChange = useCallback(({ nodes: selNodes }: { nodes: Node[] }) => {
    if (selNodes.length === 1) {
      dispatch(selectNode(selNodes[0].id));
    }
  }, [dispatch]);

  const handlePaneClick = useCallback(() => {
    dispatch(selectNode(null));
  }, [dispatch]);

  const handleNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.stopPropagation();
    if (node.type === 'export') {
      setPreviewExportData({
        id: node.id,
        label: (node.data?.label as string) || 'Exportar',
        result: nodeResults[node.id],
        completed: completedNodeIds.includes(node.id),
        hasError: errorNodeIds.includes(node.id),
        fileName: node.data?.fileName as string,
        format: node.data?.format as string,
      });
      return;
    }

    if (node.type === 'dataSource' || node.type === 'fileSource') {
      setPreviewDataSourceData({
        id: node.id,
        label: (node.data?.label as string) || 'Obtener datos',
        filePath: node.data?.filePath as string,
        fileName: node.data?.fileName as string,
        format: node.data?.format as string,
        sheetName: node.data?.sheetName as string,
        sheets: node.data?.sheets as string[],
        sampleRows: node.data?.sampleRows as any[],
        totalRows: node.data?.totalRows as number,
        result: nodeResults[node.id],
        completed: completedNodeIds.includes(node.id),
      });
      return;
    }

    if (completedNodeIds.includes(node.id) || errorNodeIds.includes(node.id)) {
      setInspectNodeData({
        id: node.id,
        label: (node.data?.label as string) || (node.type ? String(node.type) : 'Nodo'),
        result: nodeResults[node.id],
        hasError: errorNodeIds.includes(node.id),
      });
    }
  }, [nodeResults, completedNodeIds, errorNodeIds]);

  const handleSave = () => {
    if (!currentFlow || isLocked) return;
    
    const definition = JSON.stringify({ nodes, edges: pruneEdges(nodes, edges) });
    dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName }));
    setSavedSignature(canvasSignature(nodes, edges));
    
    setShowSaveNotification(true);
    setTimeout(() => {
      setShowSaveNotification(false);
    }, 3000);
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

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
    const url = getApiUrl(`/flows/${currentFlow.id}/export-json`);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", url);
    const slug = (currentFlow.name || 'flujo').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'flujo';
    downloadAnchor.setAttribute("download", `${slug}_flow.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setShowOptionsMenu(false);
  };

  const handleExportPython = async () => {
    if (!currentFlow) return;
    setShowOptionsMenu(false);
    try {
      const res = await fetch(`${getApiUrl(`/flows/${currentFlow.id}/export-python`)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
        dispatch(showToast(err.error || 'Error al exportar el paquete'));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Same rule as the server (accents removed) so the file name matches the script inside
      const slug = currentFlow.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'flujo';
      a.download = `${slug}_bundle.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
      dispatch(showToast('Paquete ZIP exportado correctamente'));
    } catch (e) {
      dispatch(showToast('Error al exportar el paquete ZIP'));
    }
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

  // ── Clipboard: copy / paste / duplicate nodes (works across flows in this browser) ──
  const clipboardRef = useRef<ClipboardPayload | null>(null);

  const readClipboard = (): ClipboardPayload | null => {
    try {
      const stored = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null');
      if (isClipboardPayload(stored)) return stored;
    } catch {}
    return clipboardRef.current;
  };

  const copyNodes = useCallback(() => {
    const payload = copySelection(nodes, edges);
    if (!payload) return false;
    clipboardRef.current = payload;
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {}
    dispatch(showToast(`${payload.nodes.length} ${payload.nodes.length === 1 ? 'nodo copiado' : 'nodos copiados'} · Ctrl+V para pegar`));
    return true;
  }, [nodes, edges, dispatch]);

  const pasteNodes = useCallback((payload: ClipboardPayload | null, atPointer: boolean) => {
    if (!payload || payload.nodes.length === 0 || isLocked) return;
    const anchor = atPointer && lastPointer.current && reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition(lastPointer.current)
      : null;
    const pasted = pasteClipboard(payload, {
      newId: uuid,
      anchor,
      existingLabels: nodes.map(n => String(n.data?.label || '')),
    });
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...pasted.nodes]);
    setEdges(eds => [...eds, ...pasted.edges]);
    dispatch(selectNode(pasted.nodes.length === 1 ? pasted.nodes[0].id : null));
  }, [isLocked, reactFlowInstance, nodes, setNodes, setEdges, dispatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowSearch(v => !v);
        return;
      }
      const target = event.target as HTMLElement | null;
      // Leave shortcuts to text fields and code editors
      if (target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        if (!isLocked) handleSaveRef.current();
      } else if (key === 'z' && !event.shiftKey) {
        if (isLocked) return;
        event.preventDefault();
        if (!canvasHistory.undo()) dispatch(showToast('No hay cambios para deshacer'));
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        if (isLocked) return;
        event.preventDefault();
        canvasHistory.redo();
      } else if (key === 'c') {
        if (window.getSelection()?.toString()) return; // copying page text
        if (copyNodes()) event.preventDefault();
      } else if (key === 'v') {
        const payload = readClipboard();
        if (!payload || isLocked) return;
        event.preventDefault();
        pasteNodes(payload, true);
      } else if (key === 'd') {
        if (isLocked) return;
        const payload = copySelection(nodes, edges);
        if (!payload) return;
        event.preventDefault();
        pasteNodes(payload, false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLocked, canvasHistory, copyNodes, pasteNodes, nodes, edges, dispatch]);

  // ── Test a single node with the results of the last run ──
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);

  const handleTestNode = useCallback(async (nodeId: string) => {
    if (!currentFlow || testingNodeId || isLiveExecuting) return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const label = String(node.data?.label || node.id);

    // Upstream results by id and by name, as the engine keeps them
    const context: Record<string, any> = { ...(intermediateContext || {}) };
    for (const [id, result] of Object.entries(nodeResults || {})) {
      if (result === undefined || (result && typeof result === 'object' && (result as any).skipped)) continue;
      context[id] = result;
      const n = nodes.find(x => x.id === id);
      if (n?.data?.label) context[String(n.data.label)] = result;
    }

    // Nearest data sources (timers and branches pass data through)
    const directSources = (id: string, seen = new Set<string>()): Node[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      return edges.filter(e => e.target === id).flatMap(e => {
        const src = nodes.find(n => n.id === e.source);
        if (!src || src.type === 'start') return [];
        return ['timer', 'delay', 'conditionalBranch'].includes(src.type || '') ? directSources(src.id, seen) : [src];
      });
    };
    const loop = findParentForEachNode(node, edges, nodes);
    const missing = directSources(node.id).filter(s => context[s.id] === undefined && s.id !== loop?.id);
    if (missing.length > 0) {
      dispatch(showToast(`Para probar «${label}» primero ejecuta el flujo: faltan los resultados de ${missing.map(m => `«${m.data?.label || m.id}»`).join(', ')}.`));
      return;
    }

    // Inside a loop the node sees the first element as {{_item}}
    if (loop && context._item === undefined) {
      const items = getForEachItems(loop, nodes, edges, nodeResults, intermediateContext);
      if (items.length > 0) {
        Object.assign(context, { _item: items[0], item: items[0], _index: 0, _total: items.length, [loop.id]: items[0] });
        const alias = String(loop.data?.itemAlias || '').trim();
        if (alias) context[alias] = items[0];
      }
    }

    setTestingNodeId(nodeId);
    try {
      // The server runs the saved definition
      const definition = JSON.stringify({ nodes, edges: pruneEdges(nodes, edges) });
      await dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName }));
      setSavedSignature(canvasSignature(nodes, edges));

      const res = await fetch(getApiUrl(`/flows/${currentFlow.id}/nodes/${nodeId}/execute`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        dispatch(showToast(`La prueba de «${label}» falló: ${payload.error || res.statusText}`));
        return;
      }
      dispatch(showToast(`Prueba de «${label}» completada en ${payload.data?.duration ?? 0} ms`));
      window.dispatchEvent(new CustomEvent('inspect-node-result', {
        detail: { id: nodeId, result: payload.data?.output, hasError: false, label },
      }));
    } catch (err: any) {
      dispatch(showToast(`No se pudo probar el nodo: ${err.message}`));
    } finally {
      setTestingNodeId(null);
      setIsLiveExecuting(false);
    }
  }, [currentFlow, testingNodeId, isLiveExecuting, nodes, edges, nodeResults, intermediateContext, dispatch, editingName]);

  const handleExecute = async (mode: 'normal' | 'debug' = 'normal', skipValidation = false) => {
    if (!currentFlow) return;
    const currentIssues = validateFlow(nodes, edges);
    if (!skipValidation && currentIssues.some(i => i.level === 'error')) {
      setIssues(currentIssues);
      setPendingRunMode(mode);
      return;
    }
    dispatch(setExecutionMode(mode));
    dispatch(resetNodeStates());
    
    // Check for missing parameters
    const nodesWithMissing: { node: Node, missing: string[], currentParams: Record<string, string> }[] = [];
    nodes.forEach(node => {
      if (node.type === 'query' && node.data?.queryId) {
        const query = queries.find((q: any) => q.id === node.data!.queryId);
        if (query) {
          const sqlText = (query.sql_text as string) || '';
          const paramMatches = [...sqlText.matchAll(/(?:^|[\s\(=<>,+\-*/'%])#param_([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
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

    await performExecution(nodes, mode);
  };

  const performExecution = async (nodesToExecute: Node[], mode: 'normal' | 'debug' = 'normal') => {
    // Auto-guardar definición antes de ejecutar para que el backend tenga los últimos datos
    const definition = JSON.stringify({ nodes: nodesToExecute, edges: pruneEdges(nodesToExecute, edges) });
    await dispatch(saveFlow({ id: currentFlow!.id, definition, name: editingName }));
    
    try {
      const result = await dispatch(executeFlow({ id: currentFlow!.id, mode }));
      
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
    } finally {
      setIsLiveExecuting(false);
      isLiveExecutingRef.current = false;
    }
  };

  const handleStopExecution = async () => {
    if (!currentFlow) return;
    try {
      isLiveExecutingRef.current = false;
      setIsLiveExecuting(false);
      await dispatch(stopFlow(currentFlow.id)).unwrap();
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
    <FlowIssuesContext.Provider value={issuesByNode}>
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {pendingRunMode && (
        <PreRunIssuesDialog
          issues={issues}
          nodes={nodes}
          onReview={nodeId => {
            setPendingRunMode(null);
            if (nodeId) focusNode(nodeId);
          }}
          onRunAnyway={() => {
            const mode = pendingRunMode;
            setPendingRunMode(null);
            handleExecute(mode, true);
          }}
        />
      )}
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
              {canvasHistory.isDirty ? (
                <span
                  className="text-[10px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded border border-amber-500/25 font-medium"
                  title="Hay cambios en el lienzo que aún no se han guardado (Ctrl+S)"
                >
                  Sin guardar
                </span>
              ) : currentFlow.status === 'draft' ? (
                <span className="text-[10px] bg-warn/15 text-warn px-2 py-0.5 rounded border border-warn/20 font-medium">Borrador</span>
              ) : (
                <span className="text-[10px] bg-success/15 text-success px-2 py-0.5 rounded border border-success/20 font-medium">Guardado</span>
              )}
              <div className="flex items-center gap-0.5 ml-1">
                <Button
                  variant="icon"
                  size="icon"
                  onClick={() => canvasHistory.undo()}
                  disabled={!canvasHistory.canUndo}
                  title="Deshacer (Ctrl+Z)"
                  className="h-8 w-8 disabled:opacity-35"
                >
                  <Undo2 size={16} />
                </Button>
                <Button
                  variant="icon"
                  size="icon"
                  onClick={() => canvasHistory.redo()}
                  disabled={!canvasHistory.canRedo}
                  title="Rehacer (Ctrl+Y o Ctrl+Shift+Z)"
                  className="h-8 w-8 disabled:opacity-35"
                >
                  <Redo2 size={16} />
                </Button>
              </div>
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
            <Button variant="default" size="sm" onClick={handleSave} className="gap-2" title="Guardar (Ctrl+S)">
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
            <div className="flex items-center gap-2">
              {issues.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowIssues(v => !v)}
                    className={cn(
                      'h-8 px-2.5 flex items-center gap-1.5 rounded-sm border text-xs font-medium transition-colors',
                      errorCount > 0
                        ? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
                        : 'border-amber-400/50 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10'
                    )}
                    title="Problemas de configuración del flujo"
                  >
                    {errorCount > 0 ? <AlertCircle size={14} /> : <AlertTriangle size={14} />}
                    {issues.length}
                  </button>
                  {showIssues && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowIssues(false)} />
                      <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-surface border border-border rounded-md shadow-raised z-50">
                        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-fg">
                          Revisión del flujo · {errorCount} {errorCount === 1 ? 'error' : 'errores'}, {issues.length - errorCount} {issues.length - errorCount === 1 ? 'aviso' : 'avisos'}
                        </div>
                        <FlowIssuesList
                          issues={issues}
                          nodes={nodes}
                          onSelect={id => {
                            setShowIssues(false);
                            focusNode(id);
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => handleExecute('debug')} className="gap-2 text-amber-600 border-amber-600 hover:bg-amber-50" disabled={nodes.length === 0}>
                <Bug size={16} /> Debug
              </Button>
              <Button variant="primary" size="sm" onClick={() => handleExecute('normal')} className="gap-2" disabled={nodes.length === 0}>
                <Play size={16} /> Ejecutar Flujo
              </Button>
            </div>
          )}
          <div className="w-px h-6 bg-border mx-1"></div>
          <Button variant="icon" size="icon" onClick={() => dispatch(toggleCanvasExpanded())} title={canvasExpanded ? "Restaurar layout" : "Expandir canvas"}>
            {canvasExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setShowHistoryModal(true)}
            className="gap-1.5 h-8 text-xs font-medium"
            title="Ver historial de ejecuciones"
          >
            <History size={14} className="text-muted" />
            <span className="hidden sm:inline">Historial</span>
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
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOptionsMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-52 bg-surface border border-border rounded-md shadow-raised py-1 z-50 animate-in fade-in zoom-in-95 duration-fast text-xs">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      handleToggleLock();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    {isLocked ? <Unlock size={14} className="text-slate-600" /> : <Lock size={14} className="text-slate-600" />}
                    <span>{isLocked ? 'Desbloquear edición' : 'Bloquear edición'}</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      setShowHistoryModal(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <History size={14} className="text-muted" />
                    <span>Historial de ejecuciones</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      setShowVersionsModal(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <GitCommitVertical size={14} className="text-muted" />
                    <span>Versiones del flujo</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      handleDuplicateCurrentFlow();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <Copy size={14} className="text-muted" />
                    <span>Duplicar este flujo</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      handleExportJSON();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <Download size={14} className="text-muted" />
                    <span>Exportar JSON</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      setIsImportModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <Upload size={14} className="text-muted" />
                    <span>Importar JSON</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportPython();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 text-fg transition-colors"
                  >
                    <FileCode2 size={14} className="text-muted" />
                    <span>Exportar a Python (ZIP)</span>
                  </button>

                  <div className="h-px bg-border my-1"></div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOptionsMenu(false);
                      setIsDeleteModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-danger/10 flex items-center gap-2 text-danger transition-colors"
                  >
                    <Trash2 size={14} />
                    <span>Eliminar flujo</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="flex-1 flex min-h-0 relative">
          {!canvasExpanded && nodeLibraryExpanded && <NodeLibrary />}
          
          <div
            className="flex-1 h-full relative"
            ref={reactFlowWrapper}
            onMouseMove={(e) => { lastPointer.current = { x: e.clientX, y: e.clientY }; }}
            onMouseLeave={() => { lastPointer.current = null; }}
          >
            {showSearch && (
              <CanvasSearch nodes={nodes} onSelect={focusNode} onClose={() => setShowSearch(false)} />
            )}
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="absolute top-3 left-3 z-10 h-8 pl-2.5 pr-2 flex items-center gap-2 rounded-sm border border-border bg-surface/90 text-xs text-muted hover:text-fg hover:border-border-hover shadow-sm backdrop-blur"
              title="Buscar un nodo en el lienzo"
            >
              <Search size={13} />
              <span>Buscar nodo</span>
              <kbd className="text-[10px] border border-border rounded px-1">Ctrl K</kbd>
            </button>
            {executionMode === 'debug' && (pausedNodeIds.length > 0 || isLiveExecuting) && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-nowrap items-center gap-2 whitespace-nowrap max-w-[calc(100%-1.5rem)] overflow-x-auto bg-surface border border-amber-300 shadow-raised rounded-full px-4 py-2">
                <div className="flex items-center gap-2 text-amber-600 text-sm font-semibold mr-1">
                  <Bug size={16} className={isLiveExecuting && pausedNodeIds.length === 0 ? "animate-spin" : "animate-pulse"} />
                  <span>Debugging</span>
                </div>
                {pausedNodeIds.length > 0 ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pausedNodeIds.forEach(id => dispatch(resumeDebugNode({ id: currentFlow!.id, nodeId: id, action: 'step_over' })))}
                      className="h-7 min-h-0 shrink-0 text-xs border-amber-200 hover:bg-amber-50"
                      title="Ejecutar el paso actual e ir al siguiente (paso a paso)"
                    >
                      <StepForward size={14} className="mr-1" /> Paso a paso
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => dispatch(resumeDebugNode({ id: currentFlow!.id, action: 'continue' }))}
                      className="h-7 min-h-0 shrink-0 text-xs bg-amber-600 hover:bg-amber-700"
                      title="Continuar ejecución sin pausas"
                    >
                      <PlayCircle size={14} className="mr-1" /> Continuar Todo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch(setDebugModalOpen(true))}
                      className="h-7 min-h-0 shrink-0 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                      title="Abrir ventana modal de inspección de depuración"
                    >
                      <Eye size={13} className="mr-1" /> Inspeccionar
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-muted font-medium px-1">
                      <Loader2 size={13} className="animate-spin text-amber-600" />
                      <span>Ejecutando...</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPausing}
                      onClick={async () => {
                        setIsPausing(true);
                        await dispatch(pauseDebugExecution(currentFlow!.id));
                      }}
                      className="h-7 min-h-0 shrink-0 text-xs border-amber-400 text-amber-700 hover:bg-amber-50 font-medium disabled:opacity-70"
                      title="Pausar en el siguiente paso para retomar el control paso a paso"
                    >
                      {isPausing ? (
                        <>
                          <Loader2 size={13} className="mr-1 animate-spin text-amber-600" /> Pausando...
                        </>
                      ) : (
                        <>
                          <Pause size={13} className="mr-1 fill-amber-600" /> Pausar
                        </>
                      )}
                    </Button>
                  </>
                )}
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleStopExecution}
                  className="h-7 min-h-0 shrink-0 text-xs bg-danger text-white hover:bg-danger/90 border-danger"
                  title="Detener ejecución del flujo"
                >
                  <Square size={11} className="mr-1 fill-white" /> Detener
                </Button>
              </div>
            )}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              connectionMode={ConnectionMode.Loose}
              onNodesChange={isLocked ? undefined : onNodesChange}
              onEdgesChange={isLocked ? undefined : onEdgesChange}
              onConnect={isLocked ? undefined : onConnect}
              isValidConnection={isValidConnection}
              onInit={setReactFlowInstance}
              onDrop={isLocked ? undefined : onDrop}
              onDragOver={isLocked ? undefined : onDragOver}
              onSelectionChange={onSelectionChange}
              onPaneClick={handlePaneClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onEdgeDoubleClick={handleEdgeDoubleClick}
              nodeTypes={nodeTypes}
              deleteKeyCode={isLocked ? null : ['Backspace', 'Delete']}
              nodesDraggable={!isLocked}
              nodesConnectable={!isLocked}
              elementsSelectable={true}
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
              onTestNode={isLocked ? undefined : handleTestNode}
              testing={testingNodeId === selectedNodeId}
              testDisabled={isLiveExecuting || testingNodeId !== null}
            />
          )}

          {/* Top-Level Debug Inspection Modal (persists across stepping and continue) */}
          {isDebugModalOpen && debugTargetNode && (
            <DebugContextViewer
              node={debugTargetNode}
              nodes={nodes}
              edges={edges}
              flowId={currentFlow?.id || ''}
              context={intermediateContext || {}}
              requestPreview={debugRequestPreview}
              responsePreview={debugResponsePreview}
              iterationHistory={iterationHistory}
              allNodePreviews={allNodePreviews}
              modalOnly={true}
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
                        <label className="text-[11px] font-mono text-accent">#param_{param}</label>
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
      {inspectNodeData && (() => {
        const rawResult = inspectNodeData.result;
        const hasLogs = rawResult && typeof rawResult === 'object' && Array.isArray(rawResult._logs) && rawResult._logs.length > 0;
        const logs: Array<{ level: string; args: string[]; ts: number }> = hasLogs ? rawResult._logs : [];
        // Strip _logs and unwrap _data for display
        const displayResult = hasLogs
          ? (rawResult._data !== undefined ? rawResult._data : Object.fromEntries(Object.entries(rawResult).filter(([k]) => k !== '_logs')))
          : rawResult;
        const jsonStr = JSON.stringify(displayResult, null, 2);

        return (
          <NodeResultModal
            inspectNodeData={{ ...inspectNodeData, result: displayResult }}
            jsonStr={jsonStr}
            logs={logs}
            hasLogs={hasLogs}
            onClose={() => setInspectNodeData(null)}
          />
        );
      })()}


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

      {/* Export Preview Modal */}
      {previewExportData && (
        <ExportPreviewModal
          isOpen={Boolean(previewExportData)}
          onClose={() => setPreviewExportData(null)}
          nodeId={previewExportData.id}
          nodeLabel={previewExportData.label}
          nodeResult={previewExportData.result || nodeResults[previewExportData.id]}
          completed={previewExportData.completed || completedNodeIds.includes(previewExportData.id)}
          isLiveExecuting={isLiveExecuting}
          onExecuteFlow={handleExecute}
          fileName={previewExportData.fileName}
          format={previewExportData.format}
          node={nodes.find(n => n.id === previewExportData.id)}
          nodes={nodes}
          edges={edges}
          context={{ ...nodeResults, ...intermediateContext }}
        />
      )}

      {/* Data Source Preview Modal */}
      {previewDataSourceData && (
        <DataSourcePreviewModal
          isOpen={Boolean(previewDataSourceData)}
          onClose={() => setPreviewDataSourceData(null)}
          nodeId={previewDataSourceData.id}
          nodeLabel={previewDataSourceData.label}
          fileName={previewDataSourceData.fileName}
          filePath={previewDataSourceData.filePath}
          format={previewDataSourceData.format}
          sheetName={previewDataSourceData.sheetName}
          sheets={previewDataSourceData.sheets}
          sampleRows={previewDataSourceData.sampleRows}
          totalRows={previewDataSourceData.totalRows}
          nodeResult={previewDataSourceData.result || nodeResults[previewDataSourceData.id]}
          onSelectSheet={(sheet) => {
            setNodes(nds => nds.map(n => {
              if (n.id === previewDataSourceData.id) {
                return { ...n, data: { ...n.data, sheetName: sheet } };
              }
              return n;
            }));
          }}
        />
      )}

      {/* Execution History Modal */}
      <FlowExecutionHistoryModal
        flow={currentFlow}
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
      />

      {currentFlow && (
        <FlowVersionsModal
          flow={currentFlow}
          isOpen={showVersionsModal}
          isLocked={isLocked}
          currentDefinition={showVersionsModal ? JSON.stringify({ nodes, edges }) : ''}
          onClose={() => setShowVersionsModal(false)}
          saveCurrent={async () => {
            if (isLocked) return;
            const definition = JSON.stringify({ nodes, edges: pruneEdges(nodes, edges) });
            await dispatch(saveFlow({ id: currentFlow.id, definition, name: editingName })).unwrap();
          }}
          onRestored={(restored) => {
            dispatch(resetNodeStates());
            dispatch(setCurrentFlow(restored));
            dispatch(showToast('Versión restaurada'));
          }}
        />
      )}

      {/* Import Flow Modal */}
      <ImportFlowModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={(importedFlow) => {
          dispatch(fetchFlows());
          navigate(`/flujos/${importedFlow.id}`);
        }}
      />

    </div>
    </FlowIssuesContext.Provider>
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
