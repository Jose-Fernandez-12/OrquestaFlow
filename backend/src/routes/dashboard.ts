import { FastifyInstance } from 'fastify';
import { buildDashboardSummary, DASHBOARD_RANGES, type DashboardRange } from '../engine/dashboardSummary.js';

const MAX_TZ_OFFSET_MINUTES = 14 * 60;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Everything the dashboard shows about executions, in one request.
  // Query: range (24h | 7d | 30d), tz (the browser's local time minus UTC, in minutes) so "today" is the user's day,
  // recent=error to list only failed runs under recent activity
  app.get<{ Querystring: { range?: string; tz?: string; recent?: string } }>('/summary', async (request) => {
    const range = DASHBOARD_RANGES.includes(request.query.range as DashboardRange) ? request.query.range as DashboardRange : '7d';
    const tz = Number(request.query.tz);
    const tzOffsetMinutes = request.query.tz !== undefined && Number.isFinite(tz)
      ? Math.max(-MAX_TZ_OFFSET_MINUTES, Math.min(MAX_TZ_OFFSET_MINUTES, Math.trunc(tz)))
      : -new Date().getTimezoneOffset();

    return { data: buildDashboardSummary({ range, tzOffsetMinutes, onlyFailedRecent: request.query.recent === 'error' }) };
  });
}
