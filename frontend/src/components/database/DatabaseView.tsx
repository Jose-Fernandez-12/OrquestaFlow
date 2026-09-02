import React, { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchConnections, setCurrentConnection, testConnection, createConnection, updateConnection, deleteConnection } from '../../store/connectionSlice';
import { fetchQueries, setCurrentQuery, executeQuery, updateQuery, createQuery, deleteQuery } from '../../store/querySlice';
import { showToast } from '../../store/uiSlice';
import { Database, Plus, Play, RefreshCw, Save, CheckCircle2, AlertCircle, AlignLeft, X, Columns, Trash2, Edit } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { format } from 'sql-formatter';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';

export function DatabaseView() {
  const dispatch = useAppDispatch();
  const connectionsState = useAppSelector(state => state.connections);
  const queriesState = useAppSelector(state => state.queries);

  const [activeTab, setActiveTab] = useState<'connections' | 'queries'>('connections');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [testing, setTesting] = useState(false);

  // Local state for creating connection
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formGroupName, setFormGroupName] = useState('');
  const [formRegion, setFormRegion] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formDatabaseName, setFormDatabaseName] = useState('');
  const [formPort, setFormPort] = useState(1433);
  const [formDriver, setFormDriver] = useState('ODBC Driver 17 for SQL Server');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formEnvCredentialKey, setFormEnvCredentialKey] = useState('SQLSERVER');
  
  // Local state for editing/creating SQL
  const [sqlText, setSqlText] = useState('');
  const [queryName, setQueryName] = useState('');
  const [selectedConns, setSelectedConns] = useState<string[]>([]);
  const [showQueryEditor, setShowQueryEditor] = useState(true);
  const [displayColumns, setDisplayColumns] = useState<string[]>([]);
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false);

  // Local state for parameters
  const [isParamModalOpen, setIsParamModalOpen] = useState(false);
  const [detectedParams, setDetectedParams] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Derived state for autocomplete
  const uniqueGroups = Array.from(new Set(connectionsState.connections.map(c => c.group_name).filter(Boolean))) as string[];
  const uniqueRegions = Array.from(new Set(connectionsState.connections.map(c => c.region).filter(Boolean))) as string[];

  useEffect(() => {
    dispatch(fetchConnections());
    dispatch(fetchQueries());
  }, [dispatch]);

  // Sync edit states when selected query changes
  useEffect(() => {
    if (queriesState.currentQuery) {
      setSqlText(queriesState.currentQuery.sql_text);
      setQueryName(queriesState.currentQuery.name);
      try {
        let rawIds = queriesState.currentQuery.connection_ids;
        // If it's already an array, use it. Otherwise, parse it.
        if (Array.isArray(rawIds)) {
          setSelectedConns(rawIds);
        } else if (typeof rawIds === 'string') {
          const ids = JSON.parse(rawIds || '[]');
          setSelectedConns(Array.isArray(ids) ? ids : []);
        } else {
          setSelectedConns([]);
        }
      } catch (e) {
        setSelectedConns([]);
      }
      try {
        const dCols = JSON.parse(queriesState.currentQuery.display_columns || '[]');
        setDisplayColumns(Array.isArray(dCols) ? dCols : []);
      } catch (e) {
        setDisplayColumns([]);
      }
    } else {
      setSqlText('');
      setQueryName('');
      setSelectedConns([]);
      setDisplayColumns([]);
    }
  }, [queriesState.currentQuery]);

  const handleTestConnection = async (id: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await dispatch(testConnection(id)).unwrap();
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Error al conectar' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveQuery = async () => {
    try {
      if (queriesState.currentQuery) {
        await dispatch(updateQuery({
          id: queriesState.currentQuery.id,
          name: queryName,
          sql_text: sqlText,
          connection_ids: selectedConns,
          display_columns: JSON.stringify(displayColumns)
        })).unwrap();
        dispatch(showToast('Consulta guardada exitosamente'));
      } else {
        await dispatch(createQuery({
          name: queryName || 'Nueva Consulta',
          sql_text: sqlText,
          connection_ids: selectedConns,
          display_columns: JSON.stringify(displayColumns)
        })).unwrap();
        dispatch(showToast('Consulta creada exitosamente'));
      }
    } catch (err: any) {
      dispatch(showToast(`Error al guardar consulta: ${err.message}`));
    }
  };

  const handleFormatSql = () => {
    try {
      const formatted = format(sqlText, { 
        language: 'sql', 
        keywordCase: 'upper',
        linesBetweenQueries: 1
      });
      setSqlText(formatted);
    } catch (e) {
      console.error('Error formatting SQL', e);
    }
  };

  const extractParams = (sqlString: string) => {
    const regex = /:([a-zA-Z0-9_]+)/g;
    const params = new Set<string>();
    let match;
    while ((match = regex.exec(sqlString)) !== null) {
      params.add(match[1]);
    }
    return Array.from(params);
  };

  const handleExecuteClick = () => {
    if (!queriesState.currentQuery || selectedConns.length === 0) return;
    
    const params = extractParams(sqlText);
    if (params.length > 0) {
      setDetectedParams(params);
      const initialValues: Record<string, string> = {};
      params.forEach(p => initialValues[p] = '');
      setParamValues(initialValues);
      setIsParamModalOpen(true);
    } else {
      doExecute({});
    }
  };

  const doExecute = (params: Record<string, any>) => {
    if (queriesState.currentQuery && selectedConns.length > 0) {
      // Auto-parse parameters
      const parsedParams: Record<string, any> = {};
      Object.keys(params).forEach(k => {
        let val = params[k];
        if (typeof val === 'string') {
          val = val.trim();
          // Quitar comillas simples o dobles si el usuario las puso manualmente
          if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
            val = val.substring(1, val.length - 1);
          }
          // Convertir a número si es un número válido
          if (val !== '' && !isNaN(Number(val))) {
            parsedParams[k] = Number(val);
          } else {
            parsedParams[k] = val;
          }
        } else {
          parsedParams[k] = val;
        }
      });

      dispatch(executeQuery({
        id: queriesState.currentQuery.id,
        connection_ids: selectedConns,
        params: parsedParams
      })).unwrap().catch((err: any) => {
        dispatch(showToast(`Error de ejecución: ${err.message}`));
      });
      setIsParamModalOpen(false);
      setShowQueryEditor(false);
    }
  };

  const handleToggleConn = (id: string) => {
    setSelectedConns(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const selectedConn = connectionsState.currentConnection;
  const selectedQuery = queriesState.currentQuery;

  const activeColumns = React.useMemo(() => {
    if (!queriesState.results?.columns) return [];
    const dCols = Array.isArray(displayColumns) ? displayColumns : [];
    if (dCols.length === 0) return queriesState.results.columns;
    
    const filtered = queriesState.results.columns.filter(c => 
      c && typeof c === 'string' && dCols.some(dc => dc && typeof dc === 'string' && dc.toLowerCase() === c.toLowerCase())
    );
    return filtered.length > 0 ? filtered : queriesState.results.columns;
  }, [queriesState.results?.columns, displayColumns]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg p-6">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bases de datos</h1>
          <p className="text-sm text-muted">Gestión de conexiones regionales SQL Server y consultas preparadas.</p>
        </div>
      </div>

      {/* Main Database Grid Layout */}
      <div className="flex-1 grid grid-cols-[280px_1fr] border border-border rounded-md bg-surface overflow-hidden min-h-[500px]">
        {/* Left column list */}
        <div className="border-r border-border flex flex-col min-h-0">
          {/* Tabs */}
          <div className="flex p-2 gap-1 border-b border-border bg-bg/50 shrink-0">
            <button
              onClick={() => setActiveTab('connections')}
              className={cn(
                "flex-1 py-1.5 px-3 rounded-sm text-xs font-medium transition-colors",
                activeTab === 'connections' ? "bg-surface text-fg shadow-sm border border-border/60" : "text-muted hover:text-fg"
              )}
            >
              Conexiones
            </button>
            <button
              onClick={() => setActiveTab('queries')}
              className={cn(
                "flex-1 py-1.5 px-3 rounded-sm text-xs font-medium transition-colors",
                activeTab === 'queries' ? "bg-surface text-fg shadow-sm border border-border/60" : "text-muted hover:text-fg"
              )}
            >
              Consultas
            </button>
          </div>

          {/* Tab lists */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {activeTab === 'connections' ? (
              <>
                <div className="flex items-center justify-between px-1 mb-1 shrink-0">
                  <span className="text-[10px] font-mono tracking-wider text-muted uppercase">Conexiones</span>
                  <Button
                    variant="icon"
                    size="icon"
                    className="h-6 w-6"
                    title="Nueva Conexion"
                    onClick={() => {
                      dispatch(setCurrentConnection(null));
                      setIsCreating(true);
                      setTestResult(null);
                    }}
                  >
                    <Plus size={14} />
                  </Button>
                </div>
                {Object.entries(connectionsState.grouped).map(([groupName, regions]) => (
                  <div key={groupName} className="mb-4">
                    {groupName && <div className="text-[11px] font-bold text-fg uppercase tracking-widest px-1 mb-2 border-b border-border/50 pb-1">{groupName}</div>}
                    {Object.entries(regions).map(([region, conns]) => (
                      <div key={region} className="flex flex-col gap-1 mb-2">
                        <span className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1">{region}</span>
                        {conns.map(conn => (
                          <button
                            key={conn.id}
                            onClick={() => {
                              dispatch(setCurrentConnection(conn));
                              setIsCreating(false);
                              setTestResult(null);
                            }}
                            className={cn(
                              "w-full text-left p-3 border rounded-sm flex items-center gap-3 transition-all",
                              selectedConn?.id === conn.id 
                                ? "border-accent bg-accent-light text-fg" 
                                : "border-border hover:border-muted hover:bg-bg"
                            )}
                          >
                            <div className="w-8 h-8 rounded-sm bg-bg border border-border flex items-center justify-center font-semibold text-accent text-xs shrink-0">
                              DB
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{conn.name}</div>
                              <div className="text-xs text-muted truncate">{conn.region} • {conn.database_name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between px-1 mb-1 shrink-0">
                  <span className="text-[10px] font-mono tracking-wider text-muted uppercase">Consultas SQL</span>
                  <Button variant="icon" size="icon" className="h-6 w-6" onClick={() => dispatch(setCurrentQuery(null))} title="Nueva Consulta">
                    <Plus size={14} />
                  </Button>
                </div>
                {queriesState.queries.map(q => (
                  <button
                    key={q.id}
                    onClick={() => dispatch(setCurrentQuery(q))}
                    className={cn(
                      "w-full text-left p-3 border rounded-sm flex items-center gap-3 transition-all",
                      selectedQuery?.id === q.id 
                        ? "border-accent bg-accent-light text-fg" 
                        : "border-border hover:border-muted hover:bg-bg"
                    )}
                  >
                    <div className="w-8 h-8 rounded-sm bg-bg border border-border flex items-center justify-center font-mono text-accent text-xs shrink-0">
                      SQL
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{q.name}</div>
                      <div className="text-xs text-muted truncate">Last run: {q.last_run_at ? new Date(q.last_run_at).toLocaleDateString() : 'Never'}</div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Right column detail/editor */}
        <div className="min-w-0 flex flex-col overflow-y-auto">
          {activeTab === 'connections' && selectedConn && (
            <div className="p-6 flex flex-col gap-6">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-semibold">{selectedConn.name}</h2>
                  <p className="text-sm text-muted">Configuración de servidor e información de autenticación regional.</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (window.confirm('¿Estás seguro de eliminar esta conexión?')) {
                        try {
                          await dispatch(deleteConnection(selectedConn.id)).unwrap();
                          dispatch(showToast('Conexión eliminada exitosamente'));
                        } catch (err: any) {
                          dispatch(showToast(`Error al eliminar: ${err.message}`));
                        }
                      }
                    }}
                    className="gap-2 text-danger hover:bg-danger/10 hover:border-danger/30"
                  >
                    <Trash2 size={14} /> Eliminar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFormName(selectedConn.name);
                      setFormGroupName(selectedConn.group_name || '');
                      setFormRegion(selectedConn.region);
                      setFormCity(selectedConn.city || '');
                      setFormHost(selectedConn.host);
                      setFormDatabaseName(selectedConn.database_name);
                      setFormPort(selectedConn.port);
                      setFormDriver(selectedConn.driver);
                      setFormUsername(selectedConn.username || '');
                      setFormPassword('');
                      setFormEnvCredentialKey(selectedConn.env_credential_key || 'SQLSERVER');
                      setIsCreating(true);
                      setTestResult(null);
                    }}
                    className="gap-2"
                  >
                    <Edit size={14} /> Editar
                  </Button>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={() => handleTestConnection(selectedConn.id)}
                    disabled={testing}
                    className="gap-2"
                  >
                    {testing ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} 
                    Probar conexión
                  </Button>
                </div>
              </div>

              {testResult && (
                <div className={cn(
                  "p-4 border rounded-sm flex items-center gap-3",
                  testResult.success 
                    ? "bg-success/10 border-success/30 text-success" 
                    : "bg-danger/10 border-danger/30 text-danger"
                )}>
                  {testResult.success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span className="text-sm font-medium">
                    {testResult.message} {testResult.latency && `(${testResult.latency}ms)`}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-border rounded-sm">
                  <span className="text-xs text-muted font-mono uppercase tracking-wider">Host</span>
                  <strong className="block text-sm mt-1">{selectedConn.host}</strong>
                </div>
                <div className="p-4 border border-border rounded-sm">
                  <span className="text-xs text-muted font-mono uppercase tracking-wider">Base de Datos</span>
                  <strong className="block text-sm mt-1">{selectedConn.database_name}</strong>
                </div>
              </div>

              <div className="p-4 border border-border rounded-sm">
                <span className="text-xs text-muted font-mono uppercase tracking-wider">Región y Credenciales</span>
                <div className="mt-2 text-sm">
                  <div><span className="text-muted">Región:</span> {selectedConn.region}</div>
                  {selectedConn.username && <div><span className="text-muted">Usuario:</span> {selectedConn.username}</div>}
                </div>
              </div>

              {/* Associated Queries */}
              <div className="flex flex-col gap-3 mt-2">
                <h3 className="text-sm font-semibold">Consultas asociadas a esta conexión</h3>
                <div className="flex flex-col gap-2">
                  {(() => {
                    const associatedQueries = queriesState.queries.filter(q => {
                      try {
                        const ids = typeof q.connection_ids === 'string' ? JSON.parse(q.connection_ids) : (q.connection_ids || []);
                        return Array.isArray(ids) && ids.includes(selectedConn.id);
                      } catch(e) { return false; }
                    });
                    
                    if (associatedQueries.length === 0) {
                      return <div className="text-sm text-muted italic">No hay consultas asociadas a esta conexión.</div>;
                    }
                    
                    return associatedQueries.map(q => (
                      <div key={q.id} className="p-3 border border-border rounded-sm flex items-center justify-between hover:bg-bg/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-sm bg-bg border border-border flex items-center justify-center font-mono text-accent text-xs shrink-0">
                            SQL
                          </div>
                          <div>
                            <div className="text-sm font-medium">{q.name}</div>
                            <div className="text-xs text-muted">Última ejecución: {q.last_run_at ? new Date(q.last_run_at).toLocaleDateString() : 'Nunca'}</div>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            setActiveTab('queries');
                            dispatch(setCurrentQuery(q));
                          }}
                          className="text-xs"
                        >
                          Ver consulta
                        </Button>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'queries' && (
            <div className="p-6 flex flex-col gap-6">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={queryName}
                    onChange={(e) => setQueryName(e.target.value)}
                    placeholder="Nombre de la consulta"
                    className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none w-full pb-1"
                  />
                  <p className="text-sm text-muted mt-1">Escribe la consulta SQL y selecciona las bases de datos destino.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={async () => {
                      if (window.confirm('¿Estás seguro de eliminar esta consulta?')) {
                        try {
                          await dispatch(deleteQuery(queriesState.currentQuery!.id)).unwrap();
                          dispatch(showToast('Consulta eliminada exitosamente'));
                        } catch (err: any) {
                          dispatch(showToast(`Error al eliminar: ${err.message}`));
                        }
                      }
                    }} 
                    className="gap-2 text-danger hover:bg-danger/10 hover:border-danger/30"
                    title="Eliminar consulta"
                  >
                    <Trash2 size={14} /> Eliminar
                  </Button>
                  <Button variant="default" size="sm" onClick={handleFormatSql} className="gap-2" title="Formatear SQL">
                    <AlignLeft size={14} /> Formatear
                  </Button>
                  <Button variant="default" size="sm" onClick={handleSaveQuery} className="gap-2">
                    <Save size={14} /> Guardar
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleExecuteClick} disabled={queriesState.executing} className="gap-2">
                    <Play size={14} /> Ejecutar
                  </Button>
                </div>
              </div>

              {/* Database destinations board */}
              <div className="p-4 border border-border rounded-md bg-bg/50">
                <div className="flex flex-col gap-4">
                  {(() => {
                    const firstSelectedConn = selectedConns.length > 0 
                      ? connectionsState.connections.find(c => c.id === selectedConns[0]) 
                      : null;
                    const activeGroup = firstSelectedConn ? (firstSelectedConn.group_name || '') : null;
                    
                    return (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-semibold">Bases de datos asociadas</h3>
                          {activeGroup !== null && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setSelectedConns([])}
                              className="text-xs h-6 text-muted hover:text-fg gap-1 px-2"
                              title="Limpiar selección para elegir otra carpeta o grupo"
                            >
                              <RefreshCw size={12} /> Cambiar grupo/carpeta
                            </Button>
                          )}
                        </div>
                        {(() => {
                          const filteredGroups = Object.entries(connectionsState.grouped)
                            .filter(([groupName]) => activeGroup === null || groupName === activeGroup);

                          if (filteredGroups.length === 0) {
                            return <div className="text-xs text-muted">No hay conexiones disponibles.</div>;
                          }

                          return filteredGroups.map(([groupName, regions]) => (
                            <div key={groupName} className="mb-4">
                              {groupName && <div className="text-[12px] font-bold text-fg uppercase tracking-widest px-1 mb-2 border-b border-border/50 pb-1">{groupName}</div>}
                              <div className="flex flex-col gap-3">
                                {Object.entries(regions).map(([region, conns]) => (
                                  <div key={region} className="flex flex-col gap-1.5">
                                    <span className="text-[11px] font-semibold text-muted uppercase tracking-wider ml-1">{region}</span>
                                    <div className="flex flex-wrap gap-2">
                                      {conns.map(conn => {
                                        const isChecked = selectedConns.includes(conn.id);
                                        return (
                                          <button
                                            key={conn.id}
                                            onClick={() => handleToggleConn(conn.id)}
                                            className={cn(
                                              "px-3 py-1.5 border rounded-full text-xs font-medium transition-colors flex items-center gap-2",
                                              isChecked 
                                                ? "border-accent bg-accent-light text-accent" 
                                                : "border-border bg-surface text-fg hover:border-muted"
                                            )}
                                          >
                                            <span className={cn("w-2 h-2 rounded-full", isChecked ? "bg-accent" : "bg-muted")}></span>
                                            {conn.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ));
                        })()}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* SQL Code Editor */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-muted font-mono uppercase tracking-wider">Sentencia SQL</label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-[10px] uppercase font-mono text-muted-foreground hover:text-fg"
                    onClick={() => setShowQueryEditor(!showQueryEditor)}
                  >
                    {showQueryEditor ? 'Ocultar' : 'Mostrar'} Editor
                  </Button>
                </div>
                {showQueryEditor && (
                  <div className="border border-border rounded-sm overflow-hidden bg-bg focus-within:border-accent">
                    <CodeMirror
                      value={sqlText}
                      height="600px"
                      extensions={[sql()]}
                      onChange={(val) => setSqlText(val)}
                      theme="light"
                      className="text-sm font-mono border-0"
                    />
                  </div>
                )}
              </div>

              {/* Results display */}
              {queriesState.executing && (
                <div className="p-8 text-center text-sm text-muted">Ejecutando consulta en las bases de datos seleccionadas...</div>
              )}

              {queriesState.results && (
                <div className="border border-border rounded-md bg-surface flex flex-col relative">
                  <div className="p-4 border-b border-border bg-bg/30 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-semibold">Resultados</h4>
                      <p className="text-xs text-muted">{queriesState.results?.rowCount} registros devueltos en {queriesState.results?.duration}ms</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setIsColumnSelectorOpen(!isColumnSelectorOpen)}
                      className="gap-2"
                    >
                      <Columns size={14} /> Columnas visibles
                    </Button>
                  </div>
                  
                  {isColumnSelectorOpen && (
                    <div className="p-4 border-b border-border bg-bg">
                      <div className="flex flex-wrap gap-2">
                        {queriesState.results.columns?.map(col => {
                          const isVisible = activeColumns.includes(col);
                          return (
                            <button
                              key={col}
                              onClick={() => {
                                setDisplayColumns(prev => {
                                  if (prev.length === 0) {
                                    return (queriesState.results?.columns || []).filter(c => c !== col);
                                  }
                                  const exists = prev.some(c => c.toLowerCase() === col.toLowerCase());
                                  if (exists) {
                                    const next = prev.filter(c => c.toLowerCase() !== col.toLowerCase());
                                    if (next.length === 0) return []; 
                                    return next;
                                  }
                                  return [...prev, col];
                                });
                              }}
                              className={cn(
                                "px-2 py-1 text-[10px] font-mono border rounded-sm transition-colors",
                                isVisible ? "bg-accent/10 border-accent/30 text-accent" : "bg-transparent border-border text-muted"
                              )}
                            >
                              {col}
                            </button>
                          );
                        })}
                        {displayColumns.length > 0 && (
                          <button 
                            onClick={() => setDisplayColumns([])}
                            className="px-2 py-1 text-[10px] font-mono border border-border rounded-sm hover:bg-bg ml-2"
                          >
                            Mostrar todas
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-bg border-b border-border">
                          {activeColumns.map(col => (
                            <th key={col} className="p-3 font-mono font-medium text-muted">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queriesState.results.rows?.map((row, idx) => (
                          <tr key={idx} className="border-b border-border hover:bg-bg/40 last:border-0">
                            {activeColumns.map(col => (
                              <td key={col} className="p-3 truncate max-w-[200px]" title={String(row[col] ?? '')}>
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {!selectedConn && activeTab === 'connections' && !isCreating && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted">
              Selecciona una conexión para configurar o probar
            </div>
          )}

          {isCreating && activeTab === 'connections' && (
            <div className="p-6 flex flex-col gap-6 max-w-2xl">
              <div>
                <h2 className="text-lg font-semibold">Nueva Conexión</h2>
                <p className="text-sm text-muted">Configura una nueva base de datos regional SQL Server o archivo SQLite local.</p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">Nombre de la conexión</label>
                    <Input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ej. Producción Bogotá, DB Local SQLite"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">Grupo / Carpeta (Opcional)</label>
                    <Input
                      type="text"
                      list="group-names"
                      value={formGroupName}
                      onChange={(e) => setFormGroupName(e.target.value)}
                      placeholder="Ej. Operaciones"
                    />
                    <datalist id="group-names">
                      {uniqueGroups.map(group => <option key={group} value={group} />)}
                    </datalist>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">Región</label>
                    <Input
                      type="text"
                      list="region-names"
                      value={formRegion}
                      onChange={(e) => setFormRegion(e.target.value)}
                      placeholder="Ej. Colombia, México, Local"
                    />
                    <datalist id="region-names">
                      {uniqueRegions.map(region => <option key={region} value={region} />)}
                    </datalist>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">Motor / Driver</label>
                    <select
                      value={formDriver}
                      onChange={(e) => {
                        setFormDriver(e.target.value);
                        if (e.target.value === 'sqlite') {
                          setFormHost('');
                          setFormDatabaseName('sqlite');
                          setFormPort(0);
                        } else {
                          setFormHost('');
                          setFormDatabaseName('');
                          setFormPort(1433);
                        }
                      }}
                      className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <option value="ODBC Driver 17 for SQL Server">SQL Server (ODBC 17)</option>
                      <option value="sqlite">SQLite (Local File)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">
                      {formDriver === 'sqlite' ? 'Ruta del archivo SQLite' : 'Host / Dirección de servidor'}
                    </label>
                    <Input
                      type="text"
                      value={formHost}
                      onChange={(e) => setFormHost(e.target.value)}
                      placeholder={formDriver === 'sqlite' ? 'Ej. C:/ruta/a/mi_base_de_datos.db' : 'Ej. db.operaciones.local'}
                    />
                  </div>
                </div>

                {formDriver !== 'sqlite' && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted">Nombre de la base de datos</label>
                      <Input
                        type="text"
                        value={formDatabaseName}
                        onChange={(e) => setFormDatabaseName(e.target.value)}
                        placeholder="Ej. orquesta_bogota"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted">Usuario</label>
                        <Input
                          type="text"
                          value={formUsername}
                          onChange={(e) => setFormUsername(e.target.value)}
                          placeholder="Ej. sa"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted">Contraseña</label>
                        <Input
                          type="password"
                          value={formPassword}
                          onChange={(e) => setFormPassword(e.target.value)}
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false);
                      setTestResult(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!formName || !formRegion || !formHost) {
                        dispatch(showToast('Por favor complete los campos obligatorios: Nombre, Región y Host/Ruta'));
                        return;
                      }
                      const connData = {
                        name: formName,
                        group_name: formGroupName || null,
                        region: formRegion,
                        city: formCity || null,
                        host: formHost,
                        database_name: formDriver === 'sqlite' ? 'sqlite' : formDatabaseName,
                        port: formDriver === 'sqlite' ? 0 : formPort,
                        driver: formDriver,
                        username: formDriver === 'sqlite' ? null : formUsername,
                        password: formDriver === 'sqlite' ? null : formPassword,
                        env_credential_key: formDriver === 'sqlite' ? null : formEnvCredentialKey
                      };
                      try {
                        let resultAction;
                        if (selectedConn) {
                          resultAction = await dispatch(updateConnection({ id: selectedConn.id, ...connData }));
                        } else {
                          resultAction = await dispatch(createConnection(connData));
                        }
                        
                        if (createConnection.fulfilled.match(resultAction) || updateConnection.fulfilled.match(resultAction)) {
                          setIsCreating(false);
                          dispatch(showToast(selectedConn ? 'Conexión actualizada exitosamente' : 'Conexión creada exitosamente'));
                          // Reset form fields
                          setFormName('');
                          setFormGroupName('');
                          setFormRegion('');
                          setFormCity('');
                          setFormHost('');
                          setFormDatabaseName('');
                          setFormPort(1433);
                          setFormDriver('ODBC Driver 17 for SQL Server');
                          setFormUsername('');
                          setFormPassword('');
                          setFormEnvCredentialKey('SQLSERVER');
                        } else {
                          dispatch(showToast(selectedConn ? 'Error al actualizar la conexión' : 'Error al crear la conexión'));
                        }
                      } catch (err) {
                        dispatch(showToast('Error de red al guardar la conexión'));
                      }
                    }}
                  >
                    Guardar Conexión
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!selectedQuery && activeTab === 'queries' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted">
              Crea una nueva consulta o selecciona una existente
            </div>
          )}
        </div>
      </div>

      {/* Params Modal */}
      {isParamModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Parámetros requeridos</h3>
              <button onClick={() => setIsParamModalOpen(false)} className="text-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <p className="text-sm text-muted">Ingresa los valores para los parámetros detectados en tu consulta SQL.</p>
              {detectedParams.map(param => (
                <div key={param} className="flex flex-col gap-1.5">
                  <label className="text-xs font-mono font-medium text-accent">:{param}</label>
                  <Input
                    type="text"
                    value={paramValues[param] || ''}
                    onChange={(e) => setParamValues(prev => ({ ...prev, [param]: e.target.value }))}
                    placeholder={`Valor para ${param}`}
                    autoFocus={detectedParams[0] === param}
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-border bg-bg/50 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsParamModalOpen(false)}>Cancelar</Button>
              <Button variant="primary" onClick={() => doExecute(paramValues)} className="gap-2">
                <Play size={14} /> Ejecutar Consulta
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
