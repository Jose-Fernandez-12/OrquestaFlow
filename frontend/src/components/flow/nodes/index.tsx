import React from 'react';
import { Play, Globe, FileOutput, Code, Database } from 'lucide-react';
import { BaseNode } from './BaseNode';

export const StartNode = (props: any) => (
  <BaseNode {...props} type="start" data={{ ...props.data, icon: Play }} />
);

export const HttpNode = (props: any) => (
  <BaseNode {...props} type="httpRequest" data={{ ...props.data, icon: Globe }} />
);

export const ScrapingNode = (props: any) => (
  <BaseNode {...props} type="scraping" data={{ ...props.data, icon: Code }} />
);

export const ExportNode = (props: any) => (
  <BaseNode {...props} type="export" data={{ ...props.data, icon: FileOutput }} />
);

export const QueryNode = (props: any) => (
  <BaseNode {...props} type="query" data={{ ...props.data, icon: Database }} />
);

export const nodeTypes = {
  start: StartNode,
  httpRequest: HttpNode,
  scraping: ScrapingNode,
  export: ExportNode,
  query: QueryNode,
};
