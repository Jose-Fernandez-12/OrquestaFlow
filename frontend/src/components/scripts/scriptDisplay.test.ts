import { describe, it, expect } from 'vitest';
import { displayFileName, parseDbDate, relativeTime } from './scriptDisplay';

describe('scriptDisplay', () => {
  it('drops the upload folder and the id prefix from the file name', () => {
    expect(displayFileName('scripts/6b5d1d04-0f6f-4e28-bc25-ced20d93c814_test_args_y_entorno.py')).toBe('test_args_y_entorno.py');
    expect(displayFileName('C:\\scripts\\legacy.py')).toBe('legacy.py');
  });

  it('reads SQLite UTC dates and describes them relative to now', () => {
    const d = parseDbDate('2026-10-04 07:48:14')!;
    expect(d.toISOString()).toBe('2026-10-04T07:48:14.000Z');
    const now = d.getTime();
    expect(relativeTime(d, now + 10_000)).toBe('hace un momento');
    expect(relativeTime(d, now + 5 * 60_000)).toBe('hace 5 min');
    expect(relativeTime(d, now + 3 * 3600_000)).toBe('hace 3 h');
    expect(relativeTime(d, now + 26 * 3600_000)).toBe('ayer');
    expect(relativeTime(null)).toBe('Nunca');
  });
});
