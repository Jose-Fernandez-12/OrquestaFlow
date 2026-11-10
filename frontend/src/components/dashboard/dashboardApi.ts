import { apiRequest } from '../scripts/pythonEnvApi';

export type DashboardRange = '24h' | '7d' | '30d';
export type RunStatus = 'running' | 'completed' | 'error' | 'cancelled';
export type TargetType = 'flow' | 'script' | 'query';

export interface StatusTotals {
  total: number;
  completed: number;
  error: number;
  cancelled: number;
  running: number;
  successRate: number | null;
  avgDurationMs: number | null;
  records: number;
}

export interface SeriesBucket {
  start: string;
  completed: number;
  error: number;
  cancelled: number;
}

export interface ExportedFile {
  fileName: string;
  downloadUrl: string;
  records: number | null;
}

export interface RecentRun {
  id: string;
  targetType: TargetType;
  targetId: string;
  targetName: string | null;
  status: RunStatus;
  trigger: string;
  durationMs: number | null;
  recordCount: number | null;
  error: string | null;
  startedAt: string | null;
  files: ExportedFile[];
}

export interface FailingTarget {
  logId: string;
  targetType: 'flow' | 'script';
  targetId: string;
  targetName: string;
  trigger: string;
  error: string | null;
  failedNode: string | null;
  failedAt: string | null;
  scheduled: boolean;
}

export interface MissedRun {
  scheduleId: string;
  scheduleName: string;
  targetType: TargetType;
  targetId: string;
  targetName: string | null;
  missedAt: string | null;
  nextRunAt: string | null;
}

export interface UpcomingRun {
  scheduleId: string;
  scheduleName: string;
  targetType: TargetType;
  targetId: string;
  targetName: string | null;
  cronExpression: string;
  nextRunAt: string | null;
  lastStatus: 'completed' | 'error' | null;
}

/** Mirrors DashboardSummary in backend/src/engine/dashboardSummary.ts */
export interface DashboardSummary {
  range: DashboardRange;
  generatedAt: string;
  totals: StatusTotals;
  previous: StatusTotals;
  failedByTrigger: Record<string, number>;
  series: SeriesBucket[];
  recent: RecentRun[];
  failing: FailingTarget[];
  missed: MissedRun[];
  upcoming: UpcomingRun[];
  schedules: { active: number; paused: number };
  scheduledTargets: string[];
  connections: { total: number; active: number };
  inventory: { flows: number; scripts: number; queries: number; connections: number; schedules: number };
  hasFlowRuns: boolean;
}

export function fetchDashboardSummary(range: DashboardRange, onlyFailed: boolean): Promise<DashboardSummary> {
  // The server buckets runs by the browser's day, not the UTC one
  const tz = -new Date().getTimezoneOffset();
  return apiRequest<DashboardSummary>(`/dashboard/summary?range=${range}&tz=${tz}${onlyFailed ? '&recent=error' : ''}`);
}
