const DEFAULT_HEADER_COLOR = '#1E293B';

/** Normaliza "#abc123" o "abc123" a "#ABC123". Devuelve null si no es un color hexadecimal de 6 dígitos. */
export function normalizeHexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

/**
 * Color del texto de la cabecera: blanco salvo en fondos claros.
 * Usa la luminancia relativa (WCAG); solo cambia a oscuro cuando el blanco
 * quedaría por debajo de 3:1 de contraste.
 */
export function getHeaderTextColor(background: string): string {
  const hex = normalizeHexColor(background) ?? DEFAULT_HEADER_COLOR;
  const linear = (offset: number) => {
    const c = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);
  return luminance > 0.3 ? '#0F172A' : '#FFFFFF';
}

/**
 * Genera un XML Spreadsheet 2003 (.xls) con la primera fila como cabecera
 * coloreada. Se usa en lugar de .xlsx porque la versión community de SheetJS
 * (xlsx 0.18.x) descarta el relleno de las celdas al escribir, así que no
 * puede aplicar el color de la cabecera.
 */
export function buildSpreadsheetXml(
  data: any[],
  columns: { header: string; key: string }[],
  headerColor?: string
): string {
  const background = (headerColor ? normalizeHexColor(headerColor) : null) ?? DEFAULT_HEADER_COLOR;
  const textColor = getHeaderTextColor(background);
  const cells = data.map(row => columns.map(col => toExportCell(resolveDotPath(row, col.key))));

  let xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Bottom"/>
      <Borders/>
      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="Header">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
      <Borders/>
      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="${textColor}" ss:Bold="1"/>
      <Interior ss:Color="${background}" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Data">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Export">
    <Table>
`;

  // Ancho según el contenido (cabecera incluida), con límites para no quedar ni minúsculo ni desbordado
  columns.forEach((col, i) => {
    const longest = cells.reduce((max, row) => Math.max(max, row[i].text.length), col.header.length);
    const width = Math.min(320, Math.max(80, longest * 7 + 16));
    xml += `      <Column ss:Width="${width}"/>\n`;
  });

  // Header Row
  xml += `      <Row ss:Height="24">\n`;
  columns.forEach((col) => {
    xml += `        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>\n`;
  });
  xml += `      </Row>\n`;

  // Data Rows
  cells.forEach((row) => {
    xml += `      <Row ss:Height="18">\n`;
    row.forEach((cell) => {
      xml += `        <Cell ss:StyleID="Data"><Data ss:Type="${cell.type}">${escapeXml(cell.text)}</Data></Cell>\n`;
    });
    xml += `      </Row>\n`;
  });

  xml += `    </Table>
  </Worksheet>
</Workbook>`;

  return xml;
}

export function downloadAsXMLSpreadsheet(
  data: any[],
  columns: { header: string; key: string }[],
  fileName: string,
  headerColor?: string
) {
  const xml = buildSpreadsheetXml(data, columns, headerColor);

  // Blob en lugar de data URI: las URIs muy grandes fallan en exportaciones de muchas filas
  const blobUrl = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }));

  const link = document.createElement('a');
  link.href = blobUrl;

  let safeName = (fileName || 'exportacion').trim();
  if (safeName === '') safeName = 'exportacion';
  safeName = safeName.replace(/\.xlsx?$/, '') + '.xls';
  link.style.display = 'none';
  link.setAttribute('download', safeName);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.onclick = (e) => e.stopPropagation();

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}

/** Números finitos como Number (Excel los trata como valores); el resto como texto; nulos como celda vacía. */
export function toExportCell(value: unknown): { type: 'Number' | 'String'; text: string } {
  if (value === null || value === undefined) return { type: 'String', text: '' };
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'Number', text: String(value) };
  if (typeof value === 'object') return { type: 'String', text: JSON.stringify(value) };
  return { type: 'String', text: String(value) };
}

function resolveDotPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  // Una clave literal (p. ej. una columna SQL "cliente.id") tiene prioridad sobre la ruta anidada
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  return path.split('.').reduce((acc, part) => {
    if (acc == null) return undefined;
    const bracketMatch = part.match(/^([^\[]*)\[(\d+)\]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const idx = parseInt(bracketMatch[2], 10);
      const nested = key ? acc[key] : acc;
      return nested != null ? nested[idx] : undefined;
    }
    return acc[part];
  }, obj);
}

function escapeXml(unsafe: string): string {
  return unsafe
    // Caracteres de control no permitidos en XML: Excel no abriría el archivo
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
}

export function resolveExportData(context: Record<string, any>, dataSource?: string): any[] {
  const findArrayInObject = (obj: any): any[] | null => {
    if (!obj || typeof obj !== 'object') return null;
    
    // Prioritize common data array keys
    const preferredKeys = ['rows', 'items', 'data', 'records'];
    for (const key of preferredKeys) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    
    // Fallback to finding any array that contains objects (to avoid returning metadata arrays like 'columns')
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        return val;
      }
    }
    
    // Absolute fallback: any array
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) return val;
    }
    
    return null;
  };

  if (dataSource) {
    const match = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = match ? match[1] : dataSource;
    const resolved = resolveDotPath(context, pathStr);
    
    if (Array.isArray(resolved)) return resolved;
    if (resolved && typeof resolved === 'object') {
      const nested = findArrayInObject(resolved);
      return nested ? nested : [resolved];
    }
    return [];
  }
  
  for (const val of Object.values(context)) {
    if (Array.isArray(val) && val.length > 0) return val;
    if (val && typeof val === 'object') {
      const nested = findArrayInObject(val);
      if (nested) return nested;
    }
  }
  return Object.values(context);
}

export function downloadAsCSV(
  data: any[],
  columns: { header: string; key: string }[],
  fileName: string
) {
  let csv = columns.map(c => c.header).join(',') + '\n';
  data.forEach(row => {
    csv += columns.map(col => {
      const val = resolveDotPath(row, col.key);
      const strVal = val === null || val === undefined ? '' : String(val);
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    }).join(',') + '\n';
  });

  const encodedCsv = encodeURIComponent(csv);
  const dataUri = `data:text/csv;charset=utf-8,${encodedCsv}`;
  
  const link = document.createElement('a');
  link.href = dataUri;
  
  let safeName = (fileName || 'exportacion').trim();
  if (safeName === '') safeName = 'exportacion';
  safeName = safeName.replace(/\.csv$/, '') + '.csv';
  link.download = safeName;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

import { getFileUrl } from './api';

export async function triggerBrowserDownload(downloadUrl: string, fileName?: string) {
  const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : getFileUrl(downloadUrl);
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    if (fileName) {
      link.download = fileName;
    }
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      window.URL.revokeObjectURL(blobUrl);
    }, 1500);
  } catch (err) {
    const link = document.createElement('a');
    link.href = fullUrl;
    if (fileName) link.download = fileName;
    link.target = '_blank';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
    }, 1500);
  }
}
