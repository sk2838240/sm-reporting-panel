import { Download, FileCode, Database, Folder, FileJson, Search, Copy, Check, Github, Layers, Package } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Badge, FullLoader, useToast, BackButton } from '../components/ui';
import { authHeaders } from '../lib/api';

export default function DevOpPage() {
  const [tab, setTab] = useState('files');
  const [fileList, setFileList] = useState({ files: [], categories: {}, total: 0 });
  const [dbData, setDbData] = useState(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingDb, setLoadingDb] = useState(true);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { push } = useToast();

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch('/api/devop-files?action=list', { headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status === 403 ? 'Super admin access required' : 'Failed to load files');
      const data = await res.json();
      setFileList(data);
    } catch (e) { push(e.message || 'Failed to load file list', 'error'); }
    setLoadingFiles(false);
  }, [push]);

  const loadDb = useCallback(async () => {
    setLoadingDb(true);
    try {
      const res = await fetch('/api/devop-db', { headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status === 403 ? 'Super admin access required' : 'Failed to load database info');
      const data = await res.json();
      setDbData(data);
    } catch (e) { push(e.message || 'Failed to load database info', 'error'); }
    setLoadingDb(false);
  }, [push]);

  useEffect(() => { loadFiles(); loadDb(); }, [loadFiles, loadDb]);

  const readFile = async (filePath) => {
    setActiveFile(filePath);
    setLoadingContent(true);
    setFileContent('');
    try {
      const res = await fetch(`/api/devop-files?action=read&path=${encodeURIComponent(filePath)}`, { headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFileContent(data.content || '');
      else push(data.error || 'File not found', 'error');
    } catch { push('Failed to read file', 'error'); }
    setLoadingContent(false);
  };

  const downloadAll = async () => {
    setDownloading(true);
    try {
      // window.open() cannot attach the Authorization header, so fetch the
      // archive as a blob and trigger the download from a temporary link.
      const res = await fetch('/api/devop-files?download=project', { headers: await authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agency-portal-project.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      push('Project ZIP downloaded', 'success');
    } catch (e) { push(e.message || 'Download failed', 'error'); }
    setDownloading(false);
  };

  const downloadTableData = (table) => {
    if (!dbData || !dbData.data?.[table]) return;
    const blob = new Blob([JSON.stringify({ table, rowCount: dbData.rowCounts?.[table], sample: dbData.data[table] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table}.json`;
    a.click();
    URL.revokeObjectURL(url);
    push(`${table} downloaded`, 'success');
  };

  const downloadDb = () => {
    if (!dbData) return;
    const blob = new Blob([JSON.stringify(dbData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agency-portal-database.json';
    a.click();
    URL.revokeObjectURL(url);
    push('Database snapshot downloaded', 'success');
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredFiles = (fileList.files || []).filter(f =>
    f.path.toLowerCase().includes(search.toLowerCase())
  );

  const fileIcon = (path) => {
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')) return <FileCode className='w-4 h-4 text-amber-500' />;
    if (path.endsWith('.json')) return <FileJson className='w-4 h-4 text-emerald-500' />;
    if (path.endsWith('.sql')) return <Database className='w-4 h-4 text-indigo-500' />;
    if (path.endsWith('.css')) return <FileCode className='w-4 h-4 text-sky-500' />;
    if (path.endsWith('.svg')) return <FileJson className='w-4 h-4 text-purple-500' />;
    if (path.endsWith('.md')) return <FileJson className='w-4 h-4 text-slate-500' />;
    return <FileCode className='w-4 h-4 text-slate-400' />;
  };

  return (
    <div className='min-h-screen bg-slate-50 dark:bg-slate-900'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 py-8'>
        <BackButton to='/app' className='mb-6' />
        {/* Header */}
        <div className='mb-8'>
          <div className='flex items-center gap-3 mb-3'>
            <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg'><Layers className='w-6 h-6' /></div>
            <div>
              <h1 className='text-2xl font-bold text-slate-900 dark:text-slate-100'>Search Modifiers — Open Source Portal</h1>
              <p className='text-sm text-slate-500 dark:text-slate-400'>Browse, view, and download the full project source code.</p>
            </div>
          </div>
          <div className='flex flex-wrap gap-2 mt-3'>
            <Badge color='indigo'><Github className='w-3 h-3' /> Self-updating</Badge>
            <Badge color='emerald'>Vite + React 19 + TypeScript</Badge>
            <Badge color='amber'>Supabase + Postgres</Badge>
            <Badge color='sky'>{fileList.total || 0} files</Badge>
          </div>
        </div>

        {/* Single download button — prominently displayed */}
        <div className='rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-6 mb-6 text-white relative overflow-hidden'>
          <div className='absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl' />
          <div className='relative flex flex-wrap items-center justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur'>
                <Package className='w-7 h-7' />
              </div>
              <div>
                <h2 className='text-lg font-bold'>Download Complete Project</h2>
                <p className='text-sm text-white/80'>All {fileList.total || 65} source files in a single ZIP — ready to share with your team.</p>
              </div>
            </div>
            <button onClick={downloadAll} disabled={downloading}
              className='inline-flex items-center gap-2 rounded-xl bg-white dark:bg-slate-100 text-indigo-600 px-5 py-3 text-sm font-bold hover:bg-indigo-50 transition disabled:opacity-60 shrink-0'>
              <Download className='w-5 h-5' />
              {downloading ? 'Preparing...' : 'Download All (.zip)'}
            </button>
          </div>
        </div>

        {/* Secondary download — database snapshot */}
        <div className='flex flex-wrap gap-3 mb-6'>
          {dbData && (
            <button onClick={downloadDb}
              className='inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition'>
              <Database className='w-4 h-4 text-indigo-500' />
              Database Snapshot (.json)
              <span className='text-xs text-slate-400 dark:text-slate-500'>· {Object.values(dbData.rowCounts || {}).reduce((a, b) => a + b, 0)} rows</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className='flex gap-1 mb-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1 w-fit'>
          <button onClick={() => setTab('files')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'files' ? 'bg-slate-900 text-white dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}><Folder className='w-4 h-4' /> Files</button>
          <button onClick={() => setTab('database')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'database' ? 'bg-slate-900 text-white dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}><Database className='w-4 h-4' /> Database</button>
        </div>

        {/* Files tab */}
        {tab === 'files' && (
          <div className='grid lg:grid-cols-3 gap-4'>
            {/* File tree */}
            <div className='lg:col-span-1 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col' style={{ maxHeight: '70vh' }}>
              <div className='p-3 border-b border-slate-100 dark:border-slate-700'>
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
                  <input type='text' placeholder='Search files...' value={search} onChange={(e) => setSearch(e.target.value)} className='w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40' />
                </div>
              </div>
              <div className='overflow-y-auto flex-1 py-1'>
                {loadingFiles ? <div className='p-4'><FullLoader label='Loading files...' /></div> : (
                  filteredFiles.length === 0 ? <p className='text-sm text-slate-400 text-center py-8'>No files found</p> : (
                    filteredFiles.map((f) => (
                      <button key={f.path} onClick={() => readFile(f.path)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition ${activeFile === f.path ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-600 dark:text-slate-300'}`}>
                        {fileIcon(f.path)}
                        <span className='truncate'>{f.path}</span>
                      </button>
                    ))
                  )
                )}
              </div>
            </div>

            {/* File viewer */}
            <div className='lg:col-span-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col' style={{ maxHeight: '70vh' }}>
              {activeFile ? (
                <>
                  <div className='flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50'>
                    <span className='text-sm font-mono font-medium text-slate-700 dark:text-slate-300 truncate'>{activeFile}</span>
                    <button onClick={copyToClipboard} className='inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700'>
                      {copied ? <><Check className='w-3.5 h-3.5 text-emerald-500' /> Copied</> : <><Copy className='w-3.5 h-3.5' /> Copy</>}
                    </button>
                  </div>
                  <div className='overflow-auto flex-1 bg-slate-50 dark:bg-slate-900'>
                    {loadingContent ? <div className='p-4'><FullLoader label='Loading file...' /></div> : (
                      <pre className='text-xs font-mono text-slate-700 dark:text-slate-300 p-4 leading-relaxed'><code>{fileContent}</code></pre>
                    )}
                  </div>
                </>
              ) : (
                <div className='flex flex-col items-center justify-center flex-1 text-center p-8'>
                  <FileCode className='w-12 h-12 text-slate-300 dark:text-slate-600 mb-3' />
                  <p className='text-sm text-slate-400 dark:text-slate-500'>Select a file from the list to view its contents</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Database tab */}
        {tab === 'database' && (
          <div className='space-y-4'>
            {loadingDb ? <FullLoader label='Loading database info...' /> : dbData ? (
              <>
                <div className='grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-2'>
                  <StatCard label='Tables' value={dbData.tables?.length || 0} color='#6366f1' />
                  <StatCard label='Total Rows' value={Object.values(dbData.rowCounts || {}).reduce((a, b) => a + b, 0)} color='#10b981' />
                  <StatCard label='Migrations' value={2} color='#0ea5e9' />
                  <StatCard label='API Routes' value={fileList.categories?.api?.length || 0} color='#f59e0b' />
                </div>

                {(dbData.tables || []).map((table) => (
                  <div key={table} className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden'>
                    <div className='flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700'>
                      <div className='flex items-center gap-2'>
                        <Database className='w-4 h-4 text-indigo-500' />
                        <span className='font-semibold text-slate-800 dark:text-slate-200'>{table}</span>
                        <Badge color='slate'>{dbData.rowCounts?.[table] || 0} rows</Badge>
                      </div>
                      <button onClick={() => downloadTableData(table)} className='text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline'>Download</button>
                    </div>
                    <div className='px-5 py-3'>
                      {/* Columns */}
                      <div className='flex flex-wrap gap-1.5 mb-3'>
                        {(dbData.schema?.[table] || []).map((col) => (
                          <span key={col.name} className='inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-300'>
                            <span className='font-semibold'>{col.name}</span>
                            <span className='text-slate-400 dark:text-slate-500'>{col.type}</span>
                          </span>
                        ))}
                      </div>
                      {/* Sample data */}
                      {(dbData.data?.[table] || []).length > 0 ? (
                        <div className='overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-700'>
                          <table className='w-full text-xs'>
                            <thead>
                              <tr className='bg-slate-50 dark:bg-slate-900/50'>
                                {Object.keys(dbData.data[table][0]).slice(0, 6).map((k) => (
                                  <th key={k} className='px-2 py-1.5 text-left font-semibold text-slate-500 dark:text-slate-400'>{k}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dbData.data[table].map((row, i) => (
                                <tr key={i} className='border-t border-slate-50 dark:border-slate-700'>
                                  {Object.values(row).slice(0, 6).map((v, j) => (
                                    <td key={j} className='px-2 py-1.5 text-slate-600 dark:text-slate-400 font-mono max-w-[180px] truncate'>{formatValue(v)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className='text-xs text-slate-400 dark:text-slate-500'>No data in table.</p>}
                    </div>
                  </div>
                ))}
              </>
            ) : <p className='text-sm text-slate-400 text-center py-8'>Failed to load database info.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4'>
      <div className='text-2xl font-bold' style={{ color }}>{value}</div>
      <div className='text-xs text-slate-400 dark:text-slate-500 mt-0.5'>{label}</div>
    </div>
  );
}

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 50) + '...';
  return String(v);
}
