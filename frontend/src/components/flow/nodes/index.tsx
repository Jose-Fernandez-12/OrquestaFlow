import React from 'react';
import { Play, Globe, FileOutput, Code, Database, Clock, FileSpreadsheet, List, Repeat, Square } from 'lucide-react';
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

export const TimerNode = (props: any) => (
  <BaseNode {...props} type="timer" data={{ ...props.data, icon: Clock }} />
);

export const DataSourceNode = (props: any) => (
  <BaseNode {...props} type="dataSource" data={{ ...props.data, icon: FileSpreadsheet }} />
);

export const DataListNode = (props: any) => (
  <BaseNode {...props} type="dataList" data={{ ...props.data, icon: List }} />
);

export const ForEachNode = (props: any) => (
  <BaseNode {...props} type="forEach" data={{ ...props.data, icon: Repeat }} />
);

export const ForEachEndNode = (props: any) => (
  <BaseNode {...props} type="forEachEnd" data={{ ...props.data, icon: Square }} />
);

export const nodeTypes = {
  start: StartNode,
  httpRequest: HttpNode,
  httpGet: HttpNode,
  httpPost: HttpNode,
  scraping: ScrapingNode,
  export: ExportNode,
  query: QueryNode,
  timer: TimerNode,
  delay: TimerNode,
  dataSource: DataSourceNode,
  fileSource: DataSourceNode,
  dataList: DataListNode,
  forEach: ForEachNode,
  forEachEnd: ForEachEndNode,
};
