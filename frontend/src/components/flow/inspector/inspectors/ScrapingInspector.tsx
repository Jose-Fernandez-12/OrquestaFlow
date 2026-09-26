import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileCode2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Input } from '../../../ui/input';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { fetchScripts } from '../../../../store/scriptSlice';
import type { InspectorProps } from '../types';

type ScrapingInspectorProps = Pick<InspectorProps, 'node' | 'updateNodeData'>;

export function ScrapingInspector({ node, updateNodeData }: ScrapingInspectorProps) {
  const dispatch = useAppDispatch();
  const scripts = useAppSelector(state => state.scripts.scripts) || [];
  const loading = useAppSelector(state => state.scripts.loading);

  useEffect(() => {
    if (scripts.length === 0) dispatch(fetchScripts());
    // Only on mount: the list is refreshed from the Scripts section
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const value = String(node.data?.script || '');
  const selected = scripts.find(s => s.id === value || s.name === value);
  const missing = value !== '' && !selected && !loading;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">URL a scrapear</label>
        <Input
          value={(node.data?.url as string) || ''}
          onChange={(e) => updateNodeData('url', e.target.value)}
          placeholder="https://ejemplo.com/precios"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Selector CSS (opcional)</label>
        <Input
          className="font-mono text-xs"
          value={(node.data?.selector as string) || ''}
          onChange={(e) => updateNodeData('selector', e.target.value)}
          placeholder=".titulo > a"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Script de extracción (.py)</label>
          <Link to="/scripts" className="text-[10px] text-accent hover:underline flex items-center gap-1">
            Gestionar scripts <ExternalLink size={10} />
          </Link>
        </div>
        <select
          className="flex w-full h-9 rounded-sm border border-border bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:border-accent"
          value={selected?.id ?? value}
          onChange={(e) => updateNodeData('script', e.target.value)}
        >
          <option value="">{loading ? 'Cargando scripts…' : 'Seleccionar script…'}</option>
          {scripts.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.file_path.split('/').pop()?.replace(/^[0-9a-f-]{36}_/, '')}
            </option>
          ))}
          {missing && <option value={value}>{value} (no encontrado)</option>}
        </select>

        {missing ? (
          <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-px" />
            El script configurado no existe en la sección Scripts. Súbelo allí y selecciónalo de nuevo.
          </p>
        ) : !loading && scripts.length === 0 ? (
          <p className="text-[11px] text-muted">
            Aún no hay scripts. Súbelos en la sección <Link to="/scripts" className="text-accent hover:underline">Scripts</Link>.
          </p>
        ) : null}
      </div>

      <div className="p-2.5 rounded-sm border border-border bg-bg/60 text-[11px] text-muted leading-relaxed flex gap-2">
        <FileCode2 size={13} className="shrink-0 mt-0.5 text-muted" />
        <span>
          El script recibe la URL y el selector en las variables de entorno <code className="text-fg">SCRAPING_URL</code> y{' '}
          <code className="text-fg">SCRAPING_SELECTOR</code> (admiten <code className="text-fg">{'{{variables}}'}</code>) y debe
          imprimir el resultado en JSON por consola.
        </span>
      </div>
    </div>
  );
}
