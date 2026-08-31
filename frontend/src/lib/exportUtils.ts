export function downloadAsXMLSpreadsheet(
  data: any[],
  columns: { header: string; key: string }[],
  fileName: string
) {
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
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#6366F1"/>
      </Borders>
      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
      <Interior ss:Color="#1E293B" ss:Pattern="Solid"/>
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
  if (dataSource) {
    const match = dataSource.match(/^\{\{(.+)\}\}$/);
    const pathStr = match ? match[1] : dataSource;
    const resolved = resolveDotPath(context, pathStr);
    
    if (Array.isArray(resolved)) return resolved;
    if (resolved && typeof resolved === 'object') {
      const nested = Object.values(resolved).find((v) => Array.isArray(v));
      return nested ? (nested as any[]) : [resolved];
    }
    return [];
  }
  
  for (const val of Object.values(context)) {
    if (Array.isArray(val) && val.length > 0) return val;
    if (val && typeof val === 'object') {
      const nested = Object.values(val).find((v) => Array.isArray(v));
      if (nested) return nested as any[];
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
