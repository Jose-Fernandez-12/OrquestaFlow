import React, { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchConnections, setCurrentConnection, testConnection, createConnection } from '../../store/connectionSlice';
import { fetchQueries, setCurrentQuery, executeQuery, updateQuery, createQuery } from '../../store/querySlice';
import { Database, Plus, Play, RefreshCw, Save, CheckCircle2, AlertCircle } from 'lucide-react';
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
        const ids = JSON.parse(queriesState.currentQuery.connection_ids || '[]');
        setSelectedConns(ids);
      } catch (e) {
        setSelectedConns([]);
      }
    } else {
      setSqlText('');
      setQueryName('');
      setSelectedConns([]);
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

  const handleSaveQuery = () => {
    if (queriesState.currentQuery) {
      dispatch(updateQuery({
        id: queriesState.currentQuery.id,
        name: queryName,
        sql_text: sqlText,
        connection_ids: selectedConns
      }));
    } else {
      dispatch(createQuery({
        name: queryName || 'Nueva Consulta',
        sql_text: sqlText,
        connection_ids: selectedConns
      }));
    }
  };

  const handleExecuteQuery = () => {
    if (queriesState.currentQuery && selectedConns.length > 0) {
      dispatch(executeQuery({
        id: queriesState.currentQuery.id,
        connection_ids: selectedConns,
        params: {} // optional
      }));
    }
  };

  const handleToggleConn = (id: string) => {
    setSelectedConns(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const selectedConn = connectionsState.currentConnection;
  const selectedQuery = queriesState.currentQuery;

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
                {connectionsState.connections.map(conn => (
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
                  <Button variant="default" size="sm" onClick={handleSaveQuery} className="gap-2">
                    <Save size={14} /> Guardar
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleExecuteQuery} disabled={queriesState.executing} className="gap-2">
                    <Play size={14} /> Ejecutar
                  </Button>
                </div>
              </div>

              {/* Database destinations board */}
              <div className="p-4 border border-border rounded-md bg-bg/50">
                <h3 className="text-sm font-semibold mb-3">Bases de datos asociadas</h3>
                <div className="flex flex-wrap gap-2">
                  {connectionsState.connections.map(conn => {
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
                        {conn.name} ({conn.region})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SQL Code Editor */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted font-mono uppercase tracking-wider">Sentencia SQL</label>
                <textarea
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  placeholder="SELECT * FROM tabla WHERE campo = :param"
                  className="w-full min-h-[160px] p-4 border border-border rounded-sm font-mono text-sm bg-bg text-fg focus-visible:outline-none focus-visible:border-accent resize-y"
                  spellCheck={false}
                />
              </div>

              {/* Results display */}
              {queriesState.executing && (
                <div className="p-8 text-center text-sm text-muted">Ejecutando consulta en las bases de datos seleccionadas...</div>
              )}

              {queriesState.results && (
                <div className="border border-border rounded-md overflow-hidden bg-surface flex flex-col">
                  <div className="p-4 border-b border-border bg-bg/30 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-semibold">Resultados</h4>
                      <p className="text-xs text-muted">{queriesState.results?.rowCount} registros devueltos en {queriesState.results?.duration}ms</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-bg border-b border-border">
                          {queriesState.results.columns?.map(col => (
                            <th key={col} className="p-3 font-mono font-medium text-muted">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queriesState.results.rows?.map((row, idx) => (
                          <tr key={idx} className="border-b border-border hover:bg-bg/40 last:border-0">
                            {queriesState.results?.columns?.map(col => (
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
                <div className="grid grid-cols-2 gap-4">
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
                    <label className="text-xs font-medium text-muted">Región</label>
                    <Input
                      type="text"
                      value={formRegion}
                      onChange={(e) => setFormRegion(e.target.value)}
                      placeholder="Ej. Colombia, México, Local"
                    />
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
                        alert('Por favor complete los campos obligatorios: Nombre, Región y Host/Ruta');
                        return;
                      }
                      const connData = {
                        name: formName,
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
                        const resultAction = await dispatch(createConnection(connData));
                        if (createConnection.fulfilled.match(resultAction)) {
                          setIsCreating(false);
                          // Reset form fields
                          setFormName('');
                          setFormRegion('');
                          setFormCity('');
                          setFormHost('');
                          setFormDatabaseName('');
                          setFormPort(1433);
                          setFormDriver('ODBC Driver 17 for SQL Server');
                          setFormUsername('');
                          setFormPassword('');
                          setFormEnvCredentialKey('SQLSERVER');
                          dispatch(setCurrentConnection(resultAction.payload.data));
                        } else {
                          alert('Error al crear la conexión');
                        }
                      } catch (err) {
                        alert('Error al crear la conexión');
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
    </div>
  );
}
