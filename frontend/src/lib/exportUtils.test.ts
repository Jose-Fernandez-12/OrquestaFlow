import { describe, it, expect } from 'vitest';
import { buildSpreadsheetXml, getHeaderTextColor, normalizeHexColor } from './exportUtils';

const columns = [
  { header: 'Cliente', key: 'cliente' },
  { header: 'Total', key: 'total' },
  { header: 'Nota', key: 'nota' },
];

type ParsedCell = { style: string; type: string; text: string };

function parseCells(xml: string): ParsedCell[] {
  return [...xml.matchAll(/<Cell ss:StyleID="(\w+)"><Data ss:Type="(\w+)">([^<]*)<\/Data><\/Cell>/g)]
    .map(m => ({ style: m[1], type: m[2], text: m[3] }));
}

describe('buildSpreadsheetXml', () => {
  it('writes the header row first, in the order of the visible columns', () => {
    const xml = buildSpreadsheetXml([{ nota: 'x', total: 5, cliente: 'Ana' }], columns, '#991B1B');
    const cells = parseCells(xml);

    expect(cells.slice(0, 3)).toEqual([
      { style: 'Header', type: 'String', text: 'Cliente' },
      { style: 'Header', type: 'String', text: 'Total' },
      { style: 'Header', type: 'String', text: 'Nota' },
    ]);
    expect(cells.slice(3).map(c => c.text)).toEqual(['Ana', '5', 'x']);
  });

  it('exports finite numbers as Number and everything else as String', () => {
    const xml = buildSpreadsheetXml([{ cliente: '00123', total: 12.5, nota: true }], columns);
    const data = parseCells(xml).slice(3);

    expect(data[0]).toEqual({ style: 'Data', type: 'String', text: '00123' });
    expect(data[1]).toEqual({ style: 'Data', type: 'Number', text: '12.5' });
    expect(data[2]).toEqual({ style: 'Data', type: 'String', text: 'true' });
  });

  it('leaves null and undefined cells empty instead of writing NULL', () => {
    const xml = buildSpreadsheetXml([{ cliente: null, total: undefined, nota: 'ok' }], columns);
    const data = parseCells(xml).slice(3);

    expect(data.map(c => c.text)).toEqual(['', '', 'ok']);
    expect(xml).not.toContain('NULL');
    expect(data[1].type).toBe('String');
  });

  it('escapes XML entities and strips control characters', () => {
    const xml = buildSpreadsheetXml([{ nota: 'a<b & "c"\u0001' }], columns);
    expect(parseCells(xml).slice(3)[2].text).toBe('a&lt;b &amp; &quot;c&quot;');
  });

  it('reads a literal column name that contains a dot before trying a nested path', () => {
    const xml = buildSpreadsheetXml(
      [{ 'cliente.id': 7, cliente: { id: 99 } }],
      [{ header: 'cliente.id', key: 'cliente.id' }]
    );
    expect(parseCells(xml).slice(1)[0]).toEqual({ style: 'Data', type: 'Number', text: '7' });
  });

  it('still resolves nested dot paths for flow exports', () => {
    const xml = buildSpreadsheetXml([{ a: { b: 3 } }], [{ header: 'AB', key: 'a.b' }]);
    expect(parseCells(xml).slice(1)[0].text).toBe('3');
  });

  it('uses the given header background and a readable text color', () => {
    const dark = buildSpreadsheetXml([], columns, '#991b1b');
    expect(dark).toContain('<Interior ss:Color="#991B1B" ss:Pattern="Solid"/>');
    expect(dark).toContain('ss:Color="#FFFFFF" ss:Bold="1"');

    const light = buildSpreadsheetXml([], columns, '#FACC15');
    expect(light).toContain('<Interior ss:Color="#FACC15" ss:Pattern="Solid"/>');
    expect(light).toContain('ss:Color="#0F172A" ss:Bold="1"');
  });

  it('falls back to the default header color when the color is invalid or missing', () => {
    expect(buildSpreadsheetXml([], columns)).toContain('<Interior ss:Color="#1E293B"');
    expect(buildSpreadsheetXml([], columns, 'no-es-color')).toContain('<Interior ss:Color="#1E293B"');
  });

  it('sizes columns from their content within the limits', () => {
    const xml = buildSpreadsheetXml(
      [{ cliente: 'x'.repeat(500), total: 1, nota: '' }],
      columns
    );
    const widths = [...xml.matchAll(/<Column ss:Width="(\d+)"\/>/g)].map(m => Number(m[1]));

    expect(widths).toEqual([320, 80, 80]);
  });
});

describe('normalizeHexColor', () => {
  it('accepts 6-digit hex with or without # and returns uppercase #RRGGBB', () => {
    expect(normalizeHexColor('#1e293b')).toBe('#1E293B');
    expect(normalizeHexColor('991b1b')).toBe('#991B1B');
  });

  it('rejects anything else', () => {
    expect(normalizeHexColor('#fff')).toBeNull();
    expect(normalizeHexColor('rojo')).toBeNull();
    expect(normalizeHexColor('')).toBeNull();
  });
});

describe('getHeaderTextColor', () => {
  it('uses white on dark and mid-tone backgrounds, dark text on light ones', () => {
    expect(getHeaderTextColor('#1E293B')).toBe('#FFFFFF');
    expect(getHeaderTextColor('#2F6FEB')).toBe('#FFFFFF');
    expect(getHeaderTextColor('#FFFFFF')).toBe('#0F172A');
  });
});
