import { describe, it, expect } from 'vitest';
import { buildSqlPreview, describeQueryParams, resolveReferences, sqlParamNames } from '../src/engine/debugPreview';

describe('buildSqlPreview', () => {
  it('writes each parameter as a SQL literal', () => {
    const sql = 'SELECT * FROM ventas WHERE eds = #param_eds AND fecha >= #param_desde AND total > #param_min';
    expect(buildSqlPreview(sql, { eds: '13', desde: '2026-09-29', min: 100 })).toBe(
      "SELECT * FROM ventas WHERE eds = '13' AND fecha >= '2026-09-29' AND total > 100"
    );
  });

  it('expands lists, keeps LIKE patterns and escapes quotes', () => {
    expect(buildSqlPreview('WHERE id IN (#param_ids)', { ids: ['1', "O'Neil"] })).toBe("WHERE id IN ('1', 'O''Neil')");
    expect(buildSqlPreview("WHERE nombre LIKE '%#param_q%'", { q: 'gas' })).toBe("WHERE nombre LIKE '%gas%'");
  });

  it('shows a missing parameter as the empty text the engines send', () => {
    expect(buildSqlPreview('WHERE eds = #param_eds', {})).toBe("WHERE eds = ''");
  });
});

describe('describeQueryParams', () => {
  it('lists every parameter of the statement with its template and value', () => {
    const sql = 'SELECT * FROM t WHERE a = #param_eds AND b = #param_fecha AND c = #param_eds';
    expect(sqlParamNames(sql)).toEqual(['eds', 'fecha']);
    expect(describeQueryParams(sql, { eds: '{{_item.codigoEds}}' }, { eds: '13' })).toEqual([
      { name: 'eds', template: '{{_item.codigoEds}}', value: '13', missing: false },
      { name: 'fecha', template: null, value: undefined, missing: true },
    ]);
  });
});

describe('resolveReferences', () => {
  const context: Record<string, any> = { Login: { token: 'secreto' }, _item: { idcentronegocio: 13 } };
  const resolve = (expr: string) => {
    const path = expr.replace(/^\{\{\s*|\s*\}\}$/g, '').split('.');
    return path.reduce((acc: any, key) => (acc == null ? undefined : acc[key]), context);
  };

  it('resolves each reference once and flags the ones that do not exist', () => {
    const refs = resolveReferences(
      { endpoint: 'https://api/x?eds={{_item.idcentronegocio}}', params: '{"eds": "{{ _item.idcentronegocio }}", "f": "{{Fechas.inicio}}"}' },
      ['endpoint', 'params'],
      resolve
    );
    expect(refs).toEqual([
      { expression: '_item.idcentronegocio', value: 13, missing: false },
      { expression: 'Fechas.inicio', value: undefined, missing: true },
    ]);
  });

  it('masks the value of references used in secret fields', () => {
    const [ref] = resolveReferences({ authToken: '{{Login.token}}' }, ['authToken'], resolve);
    expect(ref).toEqual({ expression: 'Login.token', value: '••••••••', missing: false, masked: true });
  });
});
