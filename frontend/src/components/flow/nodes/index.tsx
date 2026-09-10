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
export const ConditionalBranchNode = React.memo((props: any) => <BaseNode {...props} type="conditionalBranch" />);
export const JsonTransformNode = React.memo((props: any) => <BaseNode {...props} type="jsonTransform" />);
export const WebhookTriggerNode = React.memo((props: any) => <BaseNode {...props} type="webhookTrigger" />);
export const OAuth2ConnectorNode = React.memo((props: any) => <BaseNode {...props} type="oauth2Connector" />);
export const AiChatCompletionNode = React.memo((props: any) => <BaseNode {...props} type="aiChatCompletion" />);

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
  conditionalBranch: ConditionalBranchNode,
  jsonTransform: JsonTransformNode,
  webhookTrigger: WebhookTriggerNode,
  oauth2Connector: OAuth2ConnectorNode,
  aiChatCompletion: AiChatCompletionNode,
};
