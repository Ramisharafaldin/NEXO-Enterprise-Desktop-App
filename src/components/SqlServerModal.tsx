import React, { useState } from 'react';
import { 
  Server, 
  Database, 
  Key, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Table, 
  RefreshCw,
  HardDrive,
  Cpu,
  Layers
} from 'lucide-react';
import { translations, Language } from '../i18n/translations';
import { api, SqlServerTestResult } from '../api/client';

interface SqlServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectSuccess: (projectId: string) => void;
  language: Language;
}

export const SqlServerModal: React.FC<SqlServerModalProps> = ({
  isOpen,
  onClose,
  onConnectSuccess,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [activeTab, setActiveTab] = useState<'connection' | 'mapping'>('connection');
  const [serverHost, setServerHost] = useState('tcp:erp-prod.corp.local,1433');
  const [databaseName, setDatabaseName] = useState('ERP_SupplyChain_DW');
  const [authMode, setAuthMode] = useState<'sql' | 'windows'>('sql');
  const [username, setUsername] = useState('sa_nexo');
  const [password, setPassword] = useState('••••••••••••');
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  // Table mappings
  const [itemsTable, setItemsTable] = useState('dbo.Dim_Item');
  const [salesTable, setSalesTable] = useState('dbo.Fact_Sales_History');
  const [inventoryTable, setInventoryTable] = useState('dbo.Fact_Inventory_Snapshot');
  const [bomTable, setBomTable] = useState('dbo.Dim_Bill_Of_Materials');

  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<SqlServerTestResult | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestResult(null);
    try {
      const res = await api.testSqlServer({
        server_host: serverHost,
        database_name: databaseName,
        auth_mode: authMode,
        username,
        password,
        simulate_demo: isDemoMode,
      });
      setTestResult(res);
      if (res.success) {
        setTestState('success');
      } else {
        setTestState('error');
      }
    } catch (err: any) {
      setTestState('error');
      setTestResult({
        success: false,
        error: err.message || 'Connection failed to respond',
        suggestion: 'Verify local FastAPI backend is active on http://127.0.0.1:8000',
      });
    }
  };

  const handleConnectAndSync = async () => {
    setSyncState('syncing');
    setSyncError(null);
    try {
      const res = await api.importSqlServer({
        server_host: serverHost,
        database_name: databaseName,
        auth_mode: authMode,
        username,
        password,
        items_table: itemsTable,
        sales_table: salesTable,
        inventory_table: inventoryTable,
        bom_table: bomTable,
        project_name: `ERP Sync (${databaseName})`,
        simulate_demo: isDemoMode,
      });
      setSyncState('success');
      setTimeout(() => {
        onConnectSuccess(res.project_id);
        onClose();
      }, 500);
    } catch (err: any) {
      setSyncState('error');
      setSyncError(err.message || 'ERP table synchronization failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl border border-[#CBD5E1] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#1E293B]">
        {/* Modal Header */}
        <div className="bg-[#F8F9FA] px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-[#2196F3]/10 text-[#2196F3] rounded">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-slate-800 leading-tight">
                {t.sqlServer.modalTitle}
              </h3>
              <p className="text-[11px] text-slate-500 leading-tight">
                {t.sqlServer.modalSubtitle}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-[#E2E8F0] rounded text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-[#E2E8F0] bg-[#F1F5F9] px-4 pt-2 gap-2 text-[12px] font-semibold">
          <button
            onClick={() => setActiveTab('connection')}
            className={`pb-2 px-3 border-b-2 transition ${
              activeTab === 'connection'
                ? 'border-[#2196F3] text-[#2196F3]'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.sqlServer.connectionTab}
          </button>
          <button
            onClick={() => setActiveTab('mapping')}
            className={`pb-2 px-3 border-b-2 transition ${
              activeTab === 'mapping'
                ? 'border-[#2196F3] text-[#2196F3]'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.sqlServer.tableMappingTab} {testResult?.tables ? `(${testResult.tables.length})` : ''}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 text-[12px]">
          {activeTab === 'connection' && (
            <div className="space-y-3">
              {/* Demo Mode Toggle */}
              <div className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-md flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#2196F3]" />
                  <div>
                    <span className="text-[11px] font-bold text-slate-800">
                      {isAr ? 'بيئة تجريبية ERP (محاكاة محلية)' : 'ERP Sandbox Simulation Mode'}
                    </span>
                    <p className="text-[10px] text-slate-500">
                      {isAr ? 'تفعيل الاتصال الافتراضي وقراءة الجداول النموذجية دون خادم خارجي' : 'Test SQL Server ERP queries offline without an active external database instance'}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isDemoMode}
                  onChange={e => setIsDemoMode(e.target.checked)}
                  className="w-4 h-4 text-[#2196F3] rounded border-slate-300 focus:ring-[#2196F3] cursor-pointer"
                />
              </div>

              {/* Server Host */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.serverHost}
                </label>
                <div className="relative">
                  <Server className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={serverHost}
                    onChange={e => setServerHost(e.target.value)}
                    placeholder={t.sqlServer.serverHostPlaceholder}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] bg-white font-mono"
                  />
                </div>
              </div>

              {/* Database Name */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.databaseName}
                </label>
                <div className="relative">
                  <Database className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={databaseName}
                    onChange={e => setDatabaseName(e.target.value)}
                    placeholder={t.sqlServer.databasePlaceholder}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] bg-white font-mono"
                  />
                </div>
              </div>

              {/* Auth Mode */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.authMode}
                </label>
                <select
                  value={authMode}
                  onChange={e => setAuthMode(e.target.value as any)}
                  className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] bg-white"
                >
                  <option value="sql">{t.sqlServer.sqlAuth}</option>
                  <option value="windows">{t.sqlServer.windowsAuth}</option>
                </select>
              </div>

              {/* Credentials */}
              {authMode === 'sql' && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      {t.sqlServer.username}
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      {t.sqlServer.password}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Test Connection Button and Status */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testState === 'testing'}
                  className="px-3 py-1.5 border border-[#2196F3] text-[#2196F3] hover:bg-[#2196F3]/10 font-semibold rounded text-[11px] transition flex items-center gap-1.5"
                >
                  {testState === 'testing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{testState === 'testing' ? t.sqlServer.testing : t.sqlServer.testConnection}</span>
                </button>

                {/* Success Diagnostic Box */}
                {testState === 'success' && testResult && (
                  <div className="mt-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded space-y-1.5 text-[11px] text-emerald-900">
                    <div className="flex items-center gap-2 font-bold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{testResult.message || t.sqlServer.testSuccess}</span>
                    </div>
                    {testResult.driver_used && (
                      <div className="text-[10px] text-slate-600 font-mono">
                        ODBC Driver: {testResult.driver_used} | DB: {testResult.database}
                      </div>
                    )}
                    {testResult.version && (
                      <div className="text-[10px] text-slate-600 truncate">
                        Server: {testResult.version}
                      </div>
                    )}
                  </div>
                )}

                {/* Error Diagnostic Box */}
                {testState === 'error' && testResult && (
                  <div className="mt-2.5 p-3 bg-rose-50 border border-rose-200 rounded space-y-1.5 text-[11px] text-rose-900">
                    <div className="flex items-center gap-2 font-bold text-rose-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{isAr ? 'فشل الاتصال بقاعدة بيانات SQL Server' : 'SQL Server Connection Diagnostic Failed'}</span>
                    </div>
                    <div className="text-[10px] text-rose-800 font-mono bg-white/70 p-1.5 rounded border border-rose-200 break-words">
                      {testResult.error}
                    </div>
                    {testResult.suggestion && (
                      <p className="text-[11px] text-slate-700">
                        <strong>{isAr ? 'إجراء مقترح:' : 'Suggestion:'}</strong> {testResult.suggestion}
                      </p>
                    )}
                    {testResult.installed_drivers && (
                      <div className="text-[10px] text-slate-500">
                        {isAr ? 'برامج تشغيل ODBC المثبتة:' : 'Installed ODBC Drivers:'} {testResult.installed_drivers.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'mapping' && (
            <div className="space-y-3">
              <div className="p-2.5 bg-sky-50 border border-sky-200 rounded text-sky-800 text-[11px]">
                {isAr
                  ? 'قم بتعيين أسماء الجداول أو الـ Views في قاعدة بيانات SQL Server التي تطابق مخططات نيكسو:'
                  : 'Map SQL Server database tables or views to NEXO input schemas:'}
              </div>

              {testResult?.tables && testResult.tables.length > 0 && (
                <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px]">
                  <span className="font-bold text-slate-700">
                    {isAr ? 'الجداول المكتشفة في قاعدة البيانات:' : 'Discovered Database Tables:'}
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {testResult.tables.map(tbl => (
                      <span key={tbl} className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700">
                        {tbl}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Items Table */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.itemsTable}
                </label>
                <div className="relative">
                  <Table className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={itemsTable}
                    onChange={e => setItemsTable(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] font-mono bg-white"
                  />
                </div>
              </div>

              {/* Sales Table */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.salesTable}
                </label>
                <div className="relative">
                  <Table className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={salesTable}
                    onChange={e => setSalesTable(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] font-mono bg-white"
                  />
                </div>
              </div>

              {/* Inventory Table */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.inventoryTable}
                </label>
                <div className="relative">
                  <Table className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={inventoryTable}
                    onChange={e => setInventoryTable(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] font-mono bg-white"
                  />
                </div>
              </div>

              {/* BOM Table */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {t.sqlServer.bomTable}
                </label>
                <div className="relative">
                  <Table className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={bomTable}
                    onChange={e => setBomTable(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-[#CBD5E1] rounded text-[12px] focus:outline-none focus:border-[#2196F3] font-mono bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {syncError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{syncError}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-[#F8F9FA] px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            {testResult?.driver_used ? `Active: ${testResult.driver_used}` : 'ODBC Driver: SQL Server / Driver 18'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-[#CBD5E1] text-slate-700 hover:bg-[#E2E8F0] rounded text-[12px] font-medium transition"
            >
              {t.sqlServer.cancelBtn}
            </button>
            <button
              type="button"
              onClick={handleConnectAndSync}
              disabled={syncState === 'syncing'}
              className="px-4 py-1.5 bg-[#2196F3] text-white hover:bg-blue-600 rounded text-[12px] font-semibold transition flex items-center gap-1.5 shadow-xs"
            >
              {syncState === 'syncing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{syncState === 'syncing' ? t.sqlServer.syncing : t.sqlServer.syncBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
