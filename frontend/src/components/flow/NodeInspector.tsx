/**
 * NodeInspector (Modular Re-export)
 * 
 * The monolithic NodeInspector has been refactored into modular sub-inspectors
 * located in `./inspector/`. This file provides backwards-compatible exports.
 */

export { NodeInspector } from './inspector/NodeInspector';
export type { NodeInspectorProps } from './inspector/NodeInspector';
export { getForEachItems, getUpstreamNodes, isDataProducerNode } from './inspector/utils';
