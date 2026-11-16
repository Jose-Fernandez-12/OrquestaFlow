export function downloadAsXMLSpreadsheet(
  data: any[],
  columns: { header: string; key: string }[],
  fileName: string,
  headerColor?: string
) {
  console.log('Downloading XML Spreadsheet, headerColor:', headerColor);
  
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
      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
      <Interior ss:Color="${headerColor ? (headerColor.startsWith('#') ? headerColor : '#' + headerColor) : '#1E293B'}" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Data">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Export">
    <Table>
`;

  // Define columns widths
  columns.forEach((col) => {
    const width = Math.max(col.header.length * 8, 80);
    xml += `      <Column ss:Width="${width}"/>\n`;
  });

  // Header Row
  xml += `      <Row ss:Height="24">\n`;
  columns.forEach((col) => {
    xml += `        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>\n`;
  });
  xml += `      </Row>\n`;

  // Data Rows
  data.forEach((row) => {
    xml += `      <Row ss:Height="18">\n`;
    columns.forEach((col) => {
      const val = resolveDotPath(row, col.key);
      const strVal = val === null || val === undefined ? '' : String(val);
      xml += `        <Cell ss:StyleID="Data"><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>\n`;
    });
    xml += `      </Row>\n`;
  });

  xml += `    </Table>
  </Worksheet>
</Workbook>`;

  const encodedXml = encodeURIComponent(xml);
  const dataUri = `data:application/vnd.ms-excel;charset=utf-8,${encodedXml}`;
  
  const link = document.createElement('a');
  link.href = dataUri;
  
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
}

function resolveDotPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
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
  return unsafe.replace(/[<>&'"]/g, function (c) {
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

export interface ExportedFileItem {
  nodeId?: string;
  fileName: string;
  downloadUrl: string;
  records?: number;
  format?: string;
  filePath?: string;
}

export function normalizeExportedFilesList(raw: unknown): ExportedFileItem[] {
  if (!Array.isArray(raw)) return [];
  const byName = new Map<string, ExportedFileItem>();

  const decodeName = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  for (const entry of raw) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed || trimmed === '#') continue;
      const base = trimmed.split(/[?#]/)[0].split(/[/\\]/).pop()?.trim() || '';
      const fileName = decodeName(base);
      if (!fileName || fileName === '#') continue;
      if (!byName.has(fileName)) {
        byName.set(fileName, {
          fileName,
          downloadUrl: `/api/files/${fileName}`,
          format: /\.xlsx?$/i.test(fileName) ? 'Excel' : 'CSV',
        });
      }
      continue;
    }

    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, any>;
    const rawPath = typeof obj.filePath === 'string' ? obj.filePath.trim() : '';
    const rawName = typeof obj.fileName === 'string' ? obj.fileName.trim() : '';
    const rawUrl = typeof obj.downloadUrl === 'string' && obj.downloadUrl.trim() !== '#' ? obj.downloadUrl.trim() : '';

    const pathBase = rawPath ? rawPath.split(/[/\\]/).pop()?.trim() || '' : '';
    const nameBase = rawName ? rawName.split(/[/\\]/).pop()?.trim() || '' : '';
    const urlBase = rawUrl ? decodeName(rawUrl.split(/[?#]/)[0].split('/').pop()?.trim() || '') : '';

    const fileName = nameBase || pathBase || urlBase;
    if (!fileName || fileName === '#') continue;

    const item: ExportedFileItem = {
      ...(typeof obj.nodeId === 'string' && obj.nodeId.trim() ? { nodeId: obj.nodeId.trim() } : {}),
      fileName,
      downloadUrl: rawUrl || `/api/files/${fileName}`,
      ...(typeof obj.records === 'number' && Number.isFinite(obj.records) ? { records: obj.records } : {}),
      format: typeof obj.format === 'string' && obj.format.trim()
        ? obj.format.trim()
        : (/\.xlsx?$/i.test(fileName) ? 'Excel' : 'CSV'),
      ...(rawPath ? { filePath: rawPath } : {}),
    };

    const existing = byName.get(fileName);
    if (existing) {
      byName.set(fileName, {
        ...existing,
        ...(item.nodeId && !existing.nodeId ? { nodeId: item.nodeId } : {}),
        ...(item.records !== undefined && existing.records === undefined ? { records: item.records } : {}),
        ...(item.filePath && !existing.filePath ? { filePath: item.filePath } : {}),
        ...(item.format && !existing.format ? { format: item.format } : {}),
        downloadUrl: existing.downloadUrl || item.downloadUrl,
      });
    } else {
      byName.set(fileName, item);
    }
  }

  return [...byName.values()];
}

export async function triggerBrowserDownload(downloadUrl: string, fileName?: string): Promise<boolean> {
  const target = (downloadUrl && downloadUrl.trim() !== '#' ? downloadUrl.trim() : '') || (fileName || '').trim();
  const fullUrl = getFileUrl(target);
  if (!fullUrl) return false;

  try {
    const res = await fetch(fullUrl, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 404) return false;
      throw new Error(`Download failed (${res.status})`);
    }
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
    return true;
  } catch {
    const link = document.createElement('a');
    link.href = fullUrl;
    if (fileName) link.download = fileName;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
    }, 1500);
    return false;
  }
}
