import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Button } from '../../ui/button';
import { Trash2, Braces, Repeat, Check, Copy, ChevronDown } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../../store/hooks';
import { selectNode } from '../../../store/flowSlice';
import { cn } from '../../../lib/utils';
import { InspectorHeader } from './InspectorHeader';
import { VariableDrawer } from './VariableDrawer';
import { DebugContextViewer } from '../DebugContextViewer';
import { StartInspector } from './inspectors/StartInspector';
import { HttpInspector } from './inspectors/HttpInspector';
import { ScrapingInspector } from './inspectors/ScrapingInspector';
import { QueryInspector } from './inspectors/QueryInspector';
import { ExportInspector } from './inspectors/ExportInspector';
import { TimerInspector } from './inspectors/TimerInspector';
import { DataSourceInspector } from './inspectors/DataSourceInspector';
import { DataListInspector } from './inspectors/DataListInspector';
import { ForEachInspector } from './inspectors/ForEachInspector';
import { ForEachEndInspector } from './inspectors/ForEachEndInspector';
import { ConditionalBranchInspector } from './inspectors/ConditionalBranchInspector';
import { JsonTransformInspector } from './inspectors/JsonTransformInspector';
import { WebhookTriggerInspector } from './inspectors/WebhookTriggerInspector';
import { OAuth2ConnectorInspector } from './inspectors/OAuth2ConnectorInspector';
import { AiChatCompletionInspector } from './inspectors/AiChatCompletionInspector';
import { findParentForEachNode, getForEachItems } from './utils';

export interface NodeInspectorProps {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  edges: Edge[];
  selectedNodeId: string;
}

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;

export function NodeInspector({
  nodes,
  setNodes,
  edges,
  selectedNodeId,
}: NodeInspectorProps) {
  const dispatch = useAppDispatch();
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isVariableDrawerOpen, setIsVariableDrawerOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const node = nodes.find(n => n.id === selectedNodeId);

  const pausedNodeIds = useAppSelector(state => state.flows.pausedNodeIds);
  const intermediateContext = useAppSelector(state => state.flows.intermediateContext);
  const allNodePreviews = useAppSelector(state => state.flows.debugPreviewsByNode || {});
  const nodeDebugPreview = allNodePreviews[selectedNodeId];
  const globalRequestPreview = useAppSelector(state => state.flows.debugRequestPreview);
  const globalResponsePreview = useAppSelector(state => state.flows.debugResponsePreview);

  const debugRequestPreview = nodeDebugPreview !== undefined 
    ? nodeDebugPreview.requestPreview 
    : globalRequestPreview;
  const debugResponsePreview = nodeDebugPreview !== undefined 
    ? nodeDebugPreview.responsePreview 
    : globalResponsePreview;
  const iterationHistory = nodeDebugPreview?.history || [];
  const currentFlow = useAppSelector(state => state.flows.currentFlow);
  const nodeResults = useAppSelector(state => (state as any).flows?.nodeResults || {});
  const isPaused = pausedNodeIds.includes(selectedNodeId);

  const updateNodeData = useCallback(
    (key: string, value: any) => {
      setNodes(nds =>
        nds.map(n => {
          if (n.id === selectedNodeId) {
            return { ...n, selected: true, data: { ...n.data, [key]: value } };
          }
          return n;
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  // Resize drag handling
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Parent loop context
  const parentForEachNode = React.useMemo(() => {
    if (!node) return null;
    return findParentForEachNode(node, edges, nodes);
  }, [node, edges, nodes]);

  const parentLoopItems = React.useMemo(() => {
    if (!parentForEachNode) return [];
    return getForEachItems(parentForEachNode, nodes, edges, nodeResults, intermediateContext);
  }, [parentForEachNode, nodes, edges, nodeResults, intermediateContext]);

  const parentLoopKeys = React.useMemo(() => {
    if (!parentLoopItems || parentLoopItems.length === 0) return [];
    const first = parentLoopItems[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return Object.keys(first);
    }
    return [];
  }, [parentLoopItems]);

  const copyVariable = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  if (!node) {
    return (
      <div
        style={{ width: `${panelWidth}px` }}
        className="bg-surface border-l border-border flex flex-col p-4 z-10 shrink-0 select-none text-muted text-sm justify-center items-center"
      >
        Selecciona un nodo para ver y editar sus propiedades
      </div>
    );
  }

  const type = node.type || '';

  return (
    <aside
      style={{ width: `${panelWidth}px` }}
      aria-label="Panel de configuración del nodo"
      className={cn(
        'relative bg-surface border-l border-border flex flex-col h-full z-10 shrink-0 select-text',
        isResizing && 'select-none transition-none'
      )}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={startResizing}
        className={cn(
          'absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-20 transition-colors',
          isResizing ? 'bg-accent/40' : 'hover:bg-accent/20'
        )}
        title="Arrastra para cambiar el ancho del panel"
      />

      {/* Header */}
      <InspectorHeader
        node={node}
        updateNodeData={updateNodeData}
        onClose={() => dispatch(selectNode(null))}
      />

      {/* Action bar (Variable Panel trigger + Helpers) */}
      <div className="px-4 py-2 border-b border-border bg-bg/40 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => setIsVariableDrawerOpen(prev => !prev)}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium transition-colors px-2.5 py-1 rounded border',
            isVariableDrawerOpen
              ? 'bg-accent/15 text-accent border-accent/40 shadow-xs'
              : 'text-accent hover:text-accent-hover bg-accent/5 border-accent/20 hover:bg-accent/10'
          )}
          title="Alternar panel de variables dinámicas disponibles"
        >
          <Braces size={13} />
          <span>Variables disponibles</span>
          <ChevronDown
            size={12}
            className={cn('transition-transform duration-200', isVariableDrawerOpen && 'rotate-180')}
          />
        </button>

        {parentForEachNode && (
          <span className="text-[10px] text-sky-600 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded font-medium flex items-center gap-1">
            <Repeat size={10} />
            <span>En bucle</span>
          </span>
        )}
      </div>

      {/* Inline Variable Panel (Seamless - no overlay, no secondary menu) */}
      {isVariableDrawerOpen && (
        <VariableDrawer
          node={node}
          nodes={nodes}
          edges={edges}
          isOpen={isVariableDrawerOpen}
          onClose={() => setIsVariableDrawerOpen(false)}
        />
      )}

      {/* Sticky Debug Controls & Diagnostic Banner when paused */}
      {isPaused && (
        <div className="p-3 border-b border-border bg-bg/50 shrink-0">
          <DebugContextViewer
            node={node}
            nodes={nodes}
            edges={edges}
            flowId={currentFlow?.id || ''}
            context={intermediateContext || {}}
            requestPreview={debugRequestPreview}
            responsePreview={debugResponsePreview}
            iterationHistory={iterationHistory}
            allNodePreviews={allNodePreviews}
            bannerOnly={true}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">

        {/* Compact Loop Quick-Access Bar (if inside forEach) */}
        {parentForEachNode && (
          <div className="p-2.5 bg-sky-500/5 border border-sky-500/20 rounded-md text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-sky-600 text-[11px]">
                <Repeat size={12} />
                <span>Dentro de: {String(parentForEachNode.data?.label || parentForEachNode.id)}</span>
              </div>
              <span className="text-[10px] font-mono text-muted">
                {parentLoopItems.length > 0 ? `${parentLoopItems.length} items` : 'Iterando'}
              </span>
            </div>
            {parentLoopKeys.length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {parentLoopKeys.slice(0, 6).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => copyVariable(`{{_item.${k}}}`)}
                    className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-fg hover:border-sky-500 hover:text-sky-600 transition-colors"
                    title={`Copiar {{_item.${k}}}`}
                  >
                    <span>{k}</span>
                    {copiedKey === `{{_item.${k}}}` ? (
                      <Check size={9} className="text-emerald-500" />
                    ) : (
                      <Copy size={9} className="text-muted opacity-70" />
                    )}
                  </button>
                ))}
                {parentLoopKeys.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setIsVariableDrawerOpen(true)}
                    className="text-[10px] text-accent font-medium px-1 hover:underline"
                  >
                    +{parentLoopKeys.length - 6} más...
                  </button>
                )}
              </div>
            ) : (
              <div className="flex gap-1 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => copyVariable('{{_item.campo}}')}
                  className="px-1.5 py-0.5 bg-surface border border-border rounded text-accent hover:border-accent"
                >
                  {'{{_item.campo}}'}
                </button>
                <button
                  type="button"
                  onClick={() => copyVariable('{{_index}}')}
                  className="px-1.5 py-0.5 bg-surface border border-border rounded text-muted hover:border-border-hover"
                >
                  {'{{_index}}'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Node-specific Inspector Routing */}
        {type === 'start' && <StartInspector node={node} />}

        {(type.startsWith('http') || type === 'httpRequest') && (
          <HttpInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
            setNodes={setNodes}
            selectedNodeId={selectedNodeId}
          />
        )}

        {type === 'scraping' && (
          <ScrapingInspector node={node} updateNodeData={updateNodeData} />
        )}

        {type === 'query' && (
          <QueryInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
          />
        )}

        {type === 'export' && (
          <ExportInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
          />
        )}

        {(type === 'timer' || type === 'delay') && (
          <TimerInspector node={node} updateNodeData={updateNodeData} />
        )}

        {(type === 'dataSource' || type === 'fileSource') && (
          <DataSourceInspector
            node={node}
            updateNodeData={updateNodeData}
            nodes={nodes}
            edges={edges}
          />
        )}

        {type === 'dataList' && (
          <DataListInspector node={node} updateNodeData={updateNodeData} />
        )}

        {type === 'forEach' && (
          <ForEachInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
          />
        )}

        {type === 'forEachEnd' && <ForEachEndInspector node={node} />}

        {type === 'conditionalBranch' && (
          <ConditionalBranchInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
            nodeResult={nodeResults[node.id]}
            debugPreview={isPaused ? nodeDebugPreview?.nodePreview : undefined}
          />
        )}

        {type === 'jsonTransform' && (
          <JsonTransformInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
            nodeResult={nodeResults[node.id]}
            debugPreview={isPaused ? nodeDebugPreview?.nodePreview : undefined}
          />
        )}

        {type === 'webhookTrigger' && (
          <WebhookTriggerInspector
            node={node}
            updateNodeData={updateNodeData}
            nodeResult={nodeResults[node.id]}
          />
        )}

        {type === 'oauth2Connector' && (
          <OAuth2ConnectorInspector
            node={node}
            updateNodeData={updateNodeData}
            nodeResult={nodeResults[node.id]}
          />
        )}

        {type === 'aiChatCompletion' && (
          <AiChatCompletionInspector
            node={node}
            nodes={nodes}
            edges={edges}
            updateNodeData={updateNodeData}
            nodeResult={nodeResults[node.id]}
          />
        )}

        {/* Fallback for unrecognized node types */}
        {![
          'start',
          'httpGet',
          'httpPost',
          'httpRequest',
          'scraping',
          'query',
          'export',
          'timer',
          'delay',
          'dataSource',
          'fileSource',
          'dataList',
          'forEach',
          'forEachEnd',
          'conditionalBranch',
          'jsonTransform',
          'webhookTrigger',
          'oauth2Connector',
          'aiChatCompletion',
        ].includes(type) && (
          <div className="p-4 bg-bg border border-border rounded text-xs text-muted text-center space-y-2">
            <p className="font-medium text-fg">Tipo de nodo: {type}</p>
            <p className="leading-relaxed">
              No hay un inspector especializado para este tipo de nodo.
            </p>
          </div>
        )}

        {/* Delete Node Button */}
        <div className="mt-8 pt-4 border-t border-border">
          <Button
            variant="default"
            className="w-full text-danger border-danger/20 hover:bg-danger/10 hover:border-danger/30 flex items-center justify-center gap-1.5 text-xs"
            onClick={() => setNodes(nds => nds.filter(n => n.id !== selectedNodeId))}
          >
            <Trash2 size={13} />
            <span>Eliminar Nodo</span>
          </Button>
        </div>
      </div>

    </aside>
  );
}
