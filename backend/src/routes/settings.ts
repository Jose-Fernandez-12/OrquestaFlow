import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';

export interface SystemSettingsMap {
  http_timeout_seconds: number;
  mssql_connection_timeout_seconds: number;
  mssql_request_timeout_seconds: number;
  script_timeout_seconds: number;
  http_max_retries: number;
  table_preview_row_limit: number;
  user_display_name: string;
  user_role_label: string;
  [key: string]: any;
}

export const DEFAULT_SETTINGS: SystemSettingsMap = {
  http_timeout_seconds: 30,
  mssql_connection_timeout_seconds: 30,
  mssql_request_timeout_seconds: 300,
  script_timeout_seconds: 60,
  http_max_retries: 1,
  table_preview_row_limit: 500,
  user_display_name: 'Jose Fernandez',
  user_role_label: 'Administrador'
};

export function getSystemSettingsFromDb(): SystemSettingsMap {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, any> = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      if (['http_timeout_seconds', 'mssql_connection_timeout_seconds', 'mssql_request_timeout_seconds', 'script_timeout_seconds', 'http_max_retries', 'table_preview_row_limit'].includes(row.key)) {
        const num = Number(row.value);
        result[row.key] = isNaN(num) ? DEFAULT_SETTINGS[row.key] : num;
      } else {
        result[row.key] = row.value;
      }
    }
    return result as SystemSettingsMap;
  } catch (err) {
    console.error('[Settings] Error fetching settings, returning defaults:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // Get all system settings
  app.get('/', async () => {
    const settings = getSystemSettingsFromDb();
    return { data: settings };
  });

  // Update system settings (batch)
  app.put<{ Body: Record<string, any> }>('/', async (request, reply) => {
    const body = request.body || {};
    const db = getDb();

    const allowedKeys = [
      'http_timeout_seconds',
      'mssql_connection_timeout_seconds',
      'mssql_request_timeout_seconds',
      'script_timeout_seconds',
      'http_max_retries',
      'table_preview_row_limit',
      'user_display_name',
      'user_role_label'
    ];

    try {
      for (const [k, v] of Object.entries(body)) {
        if (!allowedKeys.includes(k)) continue;
        
        let stringValue = String(v);
        // Validations for numeric settings
        if (['http_timeout_seconds', 'mssql_connection_timeout_seconds', 'mssql_request_timeout_seconds', 'script_timeout_seconds', 'table_preview_row_limit'].includes(k)) {
          const num = Math.max(1, parseInt(stringValue, 10) || 1);
          stringValue = String(num);
        } else if (k === 'http_max_retries') {
          const num = Math.max(0, Math.min(5, parseInt(stringValue, 10) || 0));
          stringValue = String(num);
        }

        const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get(k);
        if (existing) {
          db.prepare("UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(stringValue, k);
        } else {
          db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run(k, stringValue);
        }
      }

      const updated = getSystemSettingsFromDb();
      return { data: updated, message: 'Configuración actualizada exitosamente' };
    } catch (err: any) {
      return reply.status(500).send({ error: `Error al guardar configuración: ${err.message}` });
    }
  });

  // Reset to default settings
  app.post('/reset', async () => {
    const db = getDb();
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, String(val));
    }
    const resetSettings = getSystemSettingsFromDb();
    return { data: resetSettings, message: 'Configuración restablecida a los valores predeterminados' };
  });
}
