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
import { Play, Save, Maximize2, Minimize2, MoreHorizontal } from 'lucide-react';
import { io } from 'socket.io-client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { 
  fetchFlows, 
  setCurrentFlow, 
  saveFlow, 
  selectNode, 
  executeFlow, 
  toggleCanvasExpanded,
  setNodeExecuting,
  setNodeCompleted,
  resetNodeStates
} from '../../store/flowSlice';
import { Button } from '../ui/button';
import { nodeTypes } from './nodes';
import { NodeLibrary } from './NodeLibrary';
import { NodeInspector } from './NodeInspector';
import { cn } from '../../lib/utils';

function FlowCanvas() {
  const dispatch = useAppDispatch();
  const currentFlow = useAppSelector(state => state.flows.currentFlow);
  const canvasExpanded = useAppSelector(state => state.flows.canvasExpanded);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

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
    dispatch(saveFlow({ id: currentFlow.id, definition }));
  };

  const handleExecute = () => {
    if (!currentFlow) return;
    dispatch(resetNodeStates());
    dispatch(executeFlow(currentFlow.id));
  };

  if (!currentFlow) {
    return <div className="flex-1 flex items-center justify-center text-muted">Selecciona o crea un flujo para comenzar</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Topbar inside editor */}
      <div className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="font-medium">{currentFlow.name}</div>
          {currentFlow.status === 'draft' && (
            <span className="text-xs bg-warn/20 text-warn px-2 py-0.5 rounded-sm">Borrador</span>
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
      <div className="flex-1 flex min-h-0 relative">
        {!canvasExpanded && <NodeLibrary />}
        
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

        {!canvasExpanded && <NodeInspector />}
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
