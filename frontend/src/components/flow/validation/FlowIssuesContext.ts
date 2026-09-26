import { createContext, useContext } from 'react';
import type { FlowIssue } from './flowValidation';

const EMPTY: FlowIssue[] = [];

export const FlowIssuesContext = createContext<Map<string, FlowIssue[]>>(new Map());

export function useNodeIssues(nodeId: string): FlowIssue[] {
  return useContext(FlowIssuesContext).get(nodeId) || EMPTY;
}
