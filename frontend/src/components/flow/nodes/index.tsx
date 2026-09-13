import React from 'react';
import { BaseNode } from './BaseNode';

export const StartNode = React.memo((props: any) => <BaseNode {...props} type="start" />);
export const HttpNode = React.memo((props: any) => <BaseNode {...props} type="httpRequest" />);
export const ScrapingNode = React.memo((props: any) => <BaseNode {...props} type="scraping" />);
export const ExportNode = React.memo((props: any) => <BaseNode {...props} type="export" />);
export const QueryNode = React.memo((props: any) => <BaseNode {...props} type="query" />);
export const TimerNode = React.memo((props: any) => <BaseNode {...props} type="timer" />);
export const DataSourceNode = React.memo((props: any) => <BaseNode {...props} type="dataSource" />);
export const DataListNode = React.memo((props: any) => <BaseNode {...props} type="dataList" />);
export const ForEachNode = React.memo((props: any) => <BaseNode {...props} type="forEach" />);
export const ForEachEndNode = React.memo((props: any) => <BaseNode {...props} type="forEachEnd" />);

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
