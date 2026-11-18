import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  FileSpreadsheet, 
  Server, 
  HardDrive, 
  Globe, 
  Download, 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Layers, 
  Table, 
  ArrowRight,
  ArrowLeft,
  Key,
  Calendar,
  Clock,
  Check,
  ShieldCheck,
  FileCheck
} from 'lucide-react';
import { translations, Language } from '../i18n/translations';
import { api, IngestionLog, ErpConnection, SqlServerTestResult } from '../api/client';

interface DataHubViewProps {
  projectId: string;
  projectName: string;
  onRefreshProject: () => void;
  language: Language;
}

type ActiveConnector = 'excel' | 'sql' | 'local_db' | 'api' | 'logs';

export const DataHubView: React.FC<DataHubViewProps> = ({
  projectId,
  projectName,
  onRefreshProject,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';
  const hubT = (t as any).dataHub || {};

  const templateColumns = {
    sales: isAr
      ? ['كود الصنف', 'الفرع / المخزن', 'الفترة / الشهر', 'الكمية المباعة', 'قيمة المبيعات']
      : ['CODE', 'LOCA', 'PERIOD', 'QTY_SOLD', 'REVENUE'],
    inventory: isAr
      ? ['كود الصنف', 'اسم الصنف', 'القسم / المجموعة', 'الفرع / المخزن', 'الرصيد المتوفر', 'قيد التوريد', 'مهلة التوريد (يوم)', 'تذبذب التوريد', 'مستوى الخدمة %', 'الحد الأدنى للطلب', 'مضاعفات العبوة', 'سعر التكلفة', 'سعر البيع', 'المورد']
      : ['CODE', 'DESC', 'CATI', 'LOCA', 'ONHA', 'ONOW', 'LTIM', 'LTIV', 'SLEV', 'MINB', 'BROU', 'COST', 'PRIC', 'SUPP'],
    inTransit: isAr
      ? ['كود الصنف', 'الفرع / المخزن', 'رقم أمر الشراء / الشحنة', 'الكمية في الطريق', 'تاريخ الوصول المتوقع', 'المورد', 'حالة الشحنة']
      : ['CODE', 'LOCA', 'PO_NUMBER', 'QTY_IN_TRANSIT', 'EXPECTED_DATE', 'SUPP', 'STATUS']
  };

  const [activeConnector, setActiveConnector] = useState<ActiveConnector>('excel');
  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [connections, setConnections] = useState<ErpConnection[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Template download states
  const [downloadingTemplate, setDownloadingTemplate] = useState<string | null>(null);

  // 1. Excel / CSV Connector State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<'combined' | 'inventory' | 'sales' | 'in_transit'>('combined');
  const [mergeMode, setMergeMode] = useState<'merge' | 'replace'>('merge');
  const [inspectData, setInspectData] = useState<{
    columns: string[];
    previewRows: any[];
    rowCount: number;
    suggestedMappings: Record<string, string>;
  } | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // 2. SQL Server Connector State
  const [sqlHost, setSqlHost] = useState('localhost\\SQLEXPRESS');
  const [sqlPort, setSqlPort] = useState(1433);
  const [sqlDb, setSqlDb] = useState('ERP_SupplyChain_DW');
  const [sqlAuthMode, setSqlAuthMode] = useState<'sql' | 'windows'>('sql');
  const [sqlUser, setSqlUser] = useState('sa_nexo');
  const [sqlPass, setSqlPass] = useState('••••••••••••');
  const [sqlItemsTable, setSqlItemsTable] = useState('dbo.Dim_Item');
  const [sqlSalesTable, setSqlSalesTable] = useState('dbo.Fact_Sales_History');
  const [sqlCustomQuery, setSqlCustomQuery] = useState('');
  const [sqlUseCustomQuery, setSqlUseCustomQuery] = useState(false);
  const [sqlSaveProfile, setSqlSaveProfile] = useState(true);
  const [sqlProfileName, setSqlProfileName] = useState('Production SQL Server ERP');
  const [sqlTestState, setSqlTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [sqlTestResult, setSqlTestResult] = useState<SqlServerTestResult | null>(null);
  const [isSyncingSql, setIsSyncingSql] = useState(false);

  // 3. Local DB Connector State
  const localDbFileRef = useRef<HTMLInputElement>(null);
  const [localDbFile, setLocalDbFile] = useState<File | null>(null);
  const [localDbPath, setLocalDbPath] = useState('');
  const [inspectDbResult, setInspectDbResult] = useState<{
    file_type: 'duckdb' | 'sqlite';
    tables: string[];
    table_details: Record<string, { columns: { name: string; type: string }[]; preview: any[]; row_count: number }>;
  } | null>(null);
  const [selectedDbTable, setSelectedDbTable] = useState('');
  const [dbCustomQuery, setDbCustomQuery] = useState('');
  const [dbDataCategory, setDbDataCategory] = useState<'inventory' | 'sales'>('inventory');
  const [isInspectingDb, setIsInspectingDb] = useState(false);
  const [isImportingDb, setIsImportingDb] = useState(false);

  // 4. REST API / Web Feed State
  const [apiUrl, setApiUrl] = useState('');
  const [apiHeaderName, setApiHeaderName] = useState('');
  const [apiAuthToken, setApiAuthToken] = useState('');
  const [apiCategory, setApiCategory] = useState<'inventory' | 'sales'>('inventory');
  const [apiPreview, setApiPreview] = useState<{ columns: string[]; row_count: number; preview_rows: any[] } | null>(null);
  const [isPreviewingApi, setIsPreviewingApi] = useState(false);
  const [isImportingApi, setIsImportingApi] = useState(false);
  const [apiSaveProfile, setApiSaveProfile] = useState(false);
  const [apiProfileName, setApiProfileName] = useState('Google Sheets Web Feed');

  // Quick 1-click re-sync state
  const [isQuickSyncing, setIsQuickSyncing] = useState(false);

  // Load audit logs and saved profiles
  const loadLogsAndConnections = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await api.getIngestionLogs(projectId);
      setLogs(res.logs || []);
      setConnections(res.connections || []);
    } catch (err) {
      console.warn('Could not load ingestion logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadLogsAndConnections();
  }, [projectId]);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };

  // Download template handler
  const handleDownloadTemplate = async (templateType: 'sales' | 'inventory' | 'in-transit') => {
    setDownloadingTemplate(templateType);
    try {
      const ok = await api.downloadTemplate(templateType, undefined, language);
      if (ok) {
        showNotification('success', isAr ? 'تم حفظ النموذج القياسي بنجاح على جهازك!' : 'Standard template downloaded successfully!');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to download template');
    } finally {
      setDownloadingTemplate(null);
    }
  };

  // Bilingual column map for client-side auto-mapping fallback
  const BILINGUAL_COL_MAP: Record<string, string[]> = {
    code: ['code', 'sku', 'item_code', 'itemcode', 'item', 'كود الصنف', 'كود', 'رمز الصنف', 'رقم الصنف'],
    description: ['desc', 'description', 'item_description', 'name', 'item_name', 'اسم الصنف', 'الوصف', 'بيان الصنف'],
    category: ['category', 'cat', 'cati', 'family', 'group', 'product_line', 'القسم / المجموعة', 'التصنيف', 'الفئة', 'المجموعة', 'القسم'],
    location: ['loc', 'location', 'loca', 'warehouse', 'wh', 'branch', 'site', 'الفرع / المخزن', 'المستودع', 'المخزن', 'الفرع', 'الموقع'],
    on_hand: ['on_hand', 'onhand', 'onha', 'stock', 'balance', 'qty_on_hand', 'inventory', 'الرصيد المتوفر', 'الرصيد', 'الرصيد الحالي', 'المخزون الحالي', 'المتوفر'],
    on_order: ['on_order', 'onorder', 'onow', 'onor', 'in_transit', 'po_qty', 'قيد التوريد', 'تحت الطلب', 'في الطريق', 'أوامر مفتوحة'],
    lead_time_days: ['lead_time', 'leadtime', 'lt', 'ltim', 'lead_time_days', 'مهلة التوريد (يوم)', 'مهلة التوريد', 'فترة التوريد (يوم)', 'فترة التوريد'],
    lead_time_variance_days: ['lt_var', 'ltiv', 'lead_time_variance', 'تذبذب التوريد', 'تباين التوريد', 'انحراف التوريد'],
    service_level: ['service_level', 'servicelevel', 'sl', 'slev', 'مستوى الخدمة %', 'مستوى الخدمة', 'نسبة الخدمة'],
    min_batch: ['min_batch', 'moq', 'minb', 'min_order', 'الحد الأدنى للطلب', 'أدنى كمية', 'أقل كمية للطلب'],
    batch_rounding: ['batch_rounding', 'rounding', 'brou', 'box_qty', 'مضاعفات العبوة', 'مضاعفات الطلب', 'الكرتونة', 'حجم الصندوق'],
    purchase_price: ['cost', 'purchase_price', 'unit_cost', 'purchase_cost', 'سعر التكلفة', 'التكلفة', 'سعر الشراء'],
    sales_price: ['price', 'sales_price', 'retail', 'selling_price', 'pric', 'سعر البيع', 'السعر'],
    supplier: ['supplier', 'supp', 'vendor', 'المورد', 'اسم المورد'],
    period: ['period', 'date', 'month', 'period_date', 'الفترة / الشهر', 'الفترة', 'التاريخ', 'الشهر'],
    qty_sold: ['qty_sold', 'actual', 'sales_qty', 'quantity_sold', 'units_sold', 'الكمية المباعة', 'المبيعات', 'الكمية'],
    revenue: ['revenue', 'sales_value', 'amount', 'total_sales', 'قيمة المبيعات', 'الإيراد', 'المبلغ'],
    order_no: ['order_no', 'order', 'po_number', 'po', 'order_id', 'order_num', 'رقم أمر الشراء / الشحنة', 'رقم أمر الشراء', 'رقم الطلب', 'رقم الشحنة', 'رقم الأمر'],
    destination: ['destination', 'dest', 'target_wh', 'to_location', 'الفرع / المخزن', 'المستودع المستلم', 'الوجهة', 'الموقع', 'إلى'],
    eta_date: ['eta_date', 'eta', 'arrival_date', 'delivery_date', 'expected_date', 'تاريخ الوصول المتوقع', 'تاريخ الوصول', 'تاريخ الاستلام'],
    carrier: ['carrier', 'shipping_line', 'forwarder', 'transport', 'الناقل', 'شركة الشحن', 'الخط الملاحي'],
    status: ['status', 'shipment_status', 'حالة الشحنة', 'الحالة'],
    quantity: ['quantity', 'qty', 'units', 'shipped_qty', 'qty_in_transit', 'الكمية في الطريق', 'الكمية', 'العدد', 'عدد الوحدات']
  };

  // 1. File Upload & Inspection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setIsProcessingFile(true);
    try {
      const insp = await api.inspectFile(file);
      const cols = insp.columns || [];
      const mergedMapping: Record<string, string> = { ...(insp.suggested_mappings || {}) };

      // Ensure 100% round-trip recognition client-side
      for (const [field, candidates] of Object.entries(BILINGUAL_COL_MAP)) {
        if (!mergedMapping[field]) {
          const match = cols.find(c => {
            const cl = c.trim().toLowerCase();
            return candidates.some(cand => cl === cand.toLowerCase() || cl.includes(cand.toLowerCase()) || cand.toLowerCase().includes(cl));
          });
          if (match) {
            mergedMapping[field] = match;
          }
        }
      }

      // Auto-detect importType if matching specialized template columns
      if (cols.some(c => ['حالة الشحنة', 'STATUS', 'EXPECTED_DATE', 'تاريخ الوصول المتوقع'].includes(c.trim()))) {
        setImportType('in_transit');
      } else if (cols.some(c => ['الفترة / الشهر', 'PERIOD', 'QTY_SOLD', 'الكمية المباعة'].includes(c.trim()))) {
        setImportType('sales');
      } else if (cols.some(c => ['الرصيد المتوفر', 'ONHA', 'مهلة التوريد (يوم)', 'LTIM'].includes(c.trim()))) {
        setImportType('inventory');
      }

      setInspectData({
        columns: insp.columns,
        previewRows: insp.preview_rows,
        rowCount: insp.row_count,
        suggestedMappings: mergedMapping
      });
      setColumnMapping(mergedMapping);
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to inspect file structure');
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleCommitTypedImport = async () => {
    if (!selectedFile) return;
    setIsProcessingFile(true);
    try {
      const res = await api.importTypedFile(
        selectedFile,
        importType,
        projectId,
        undefined,
        mergeMode,
        columnMapping
      );
      showNotification('success', isAr 
        ? `تم استيراد ${res.rows_processed} صنف بنجاح وحفظها في قاعدة بيانات DuckDB!` 
        : `Successfully ingested ${res.rows_processed} rows into DuckDB workspace!`
      );
      setSelectedFile(null);
      setInspectData(null);
      onRefreshProject();
      loadLogsAndConnections();
    } catch (err: any) {
      showNotification('error', err.message || 'Import failed');
    } finally {
      setIsProcessingFile(false);
    }
  };

  // 2. SQL Server Test & Import
  const handleTestSqlServer = async () => {
    setSqlTestState('testing');
    setSqlTestResult(null);
    try {
      const res = await api.testSqlServer({
        server_host: sqlHost,
        database_name: sqlDb,
        port: sqlPort,
        auth_mode: sqlAuthMode,
        username: sqlUser,
        password: sqlPass,
        simulate_demo: false
      });
      setSqlTestResult(res);
      setSqlTestState(res.success ? 'success' : 'error');
    } catch (err: any) {
      setSqlTestState('error');
      setSqlTestResult({
        success: false,
        error: err.message || 'Connection failed'
      });
    }
  };

  const handleImportSqlServer = async () => {
    setIsSyncingSql(true);
    try {
      const res = await api.importSqlServer({
        server_host: sqlHost,
        database_name: sqlDb,
        port: sqlPort,
        auth_mode: sqlAuthMode,
        username: sqlUser,
        password: sqlPass,
        items_table: sqlItemsTable,
        sales_table: sqlSalesTable,
        custom_sql: sqlUseCustomQuery && sqlCustomQuery ? sqlCustomQuery : undefined,
        project_id: projectId,
        save_profile: sqlSaveProfile,
        profile_name: sqlProfileName,
        simulate_demo: true
      });
      showNotification('success', isAr
        ? `تم سحب ${res.imported_skus} صنف من خادم SQL Server ومزامنتها بنجاح!`
        : `Successfully imported ${res.imported_skus} items from Microsoft SQL Server!`
      );
      onRefreshProject();
      loadLogsAndConnections();
    } catch (err: any) {
      showNotification('error', err.message || 'SQL Server sync failed');
    } finally {
      setIsSyncingSql(false);
    }
  };

  // 3. Local DB Inspect & Import
  const handleInspectLocalDb = async () => {
    if (!localDbFile && !localDbPath.trim()) return;
    setIsInspectingDb(true);
    setInspectDbResult(null);
    try {
      const res = await api.inspectLocalDb(localDbFile || localDbPath.trim());
      setInspectDbResult(res);
      if (res.tables && res.tables.length > 0) {
        setSelectedDbTable(res.tables[0]);
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to inspect database');
    } finally {
      setIsInspectingDb(false);
    }
  };

  const handleImportLocalDb = async () => {
    if (!selectedDbTable && !dbCustomQuery.trim()) return;
    setIsImportingDb(true);
    try {
      const res = await api.importLocalDb({
        file: localDbFile || undefined,
        filePath: !localDbFile && localDbPath.trim() ? localDbPath.trim() : undefined,
        tableName: selectedDbTable,
        customQuery: dbCustomQuery.trim() || undefined,
        dataCategory: dbDataCategory,
        projectId: projectId,
        mergeMode: mergeMode
      });
      showNotification('success', isAr
        ? `تم استيراد ${res.rows_processed} صنف من قاعدة البيانات المحلية بنجاح!`
        : `Successfully imported ${res.rows_processed} items from local database!`
      );
      onRefreshProject();
      loadLogsAndConnections();
    } catch (err: any) {
      showNotification('error', err.message || 'Local DB import failed');
    } finally {
      setIsImportingDb(false);
    }
  };

  // 4. REST API Preview & Import
  const handlePreviewApi = async () => {
    if (!apiUrl.trim()) return;
    setIsPreviewingApi(true);
    setApiPreview(null);
    try {
      const res = await api.previewExternalUrl(
        apiUrl.trim(),
        apiHeaderName.trim() || undefined,
        apiAuthToken.trim() || undefined
      );
      setApiPreview(res);
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to fetch remote feed');
    } finally {
      setIsPreviewingApi(false);
    }
  };

  const handleImportApi = async () => {
    if (!apiUrl.trim()) return;
    setIsImportingApi(true);
    try {
      const res = await api.importExternalUrl({
        url: apiUrl.trim(),
        authHeader: apiHeaderName.trim() || undefined,
        authToken: apiAuthToken.trim() || undefined,
        dataCategory: apiCategory,
        projectId: projectId,
        mergeMode: mergeMode,
        saveProfile: apiSaveProfile,
        profileName: apiProfileName.trim() || undefined
      });
      showNotification('success', isAr
        ? `تم سحب ${res.rows_processed} سجل من الرابط وحفظها في قاعدة البيانات!`
        : `Successfully ingested ${res.rows_processed} records from remote feed!`
      );
      onRefreshProject();
      loadLogsAndConnections();
    } catch (err: any) {
      showNotification('error', err.message || 'Web feed import failed');
    } finally {
      setIsImportingApi(false);
    }
  };

  // 5. 1-Click Quick Re-sync
  const handleQuickSync = async () => {
    setIsQuickSyncing(true);
    try {
      const res = await api.syncSavedSource(projectId);
      showNotification('success', isAr
        ? `تمت المزامنة بنجاح من ${res.profile_name} (${res.imported_skus} صنف)!`
        : `Successfully re-synced ${res.imported_skus} items from ${res.profile_name}!`
      );
      onRefreshProject();
      loadLogsAndConnections();
    } catch (err: any) {
      showNotification('error', err.message || 'Quick sync failed');
    } finally {
      setIsQuickSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F3F4F6] text-[#1E293B] overflow-y-auto select-none" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 ${isAr ? 'left-6' : 'right-6'} z-50 flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg border text-xs font-semibold animate-in fade-in slide-in-from-top-3 ${
          notification.type === 'success'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-rose-50 border-rose-300 text-rose-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Header Strip */}
      <div className="bg-[#343D46] text-white px-6 py-4 flex-none border-b border-[#2A3138] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#2196F3] rounded-lg shadow-sm">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>{hubT.title || (isAr ? 'مركز تغذية واستيراد البيانات' : 'Data Hub & Ingestion Engine')}</span>
              <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600">
                {projectName}
              </span>
            </h1>
            <p className="text-[12px] text-slate-300 mt-0.5">
              {hubT.subtitle || (isAr ? 'تغذية مؤسسية موحدة: نماذج إكسل، الربط المباشر مع SQL Server، وقواعد DuckDB و SQLite' : 'Unified enterprise ingestion: Excel templates, Microsoft SQL Server ERP, DuckDB/SQLite, and REST APIs')}
            </p>
          </div>
        </div>

        {/* 1-Click Quick Re-Sync Button (if connections exist) */}
        {connections.length > 0 && (
          <button
            onClick={handleQuickSync}
            disabled={isQuickSyncing}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold transition shadow-xs cursor-pointer disabled:opacity-50"
            title={isAr ? 'مزامنة فورية بنقرة واحدة من المصدر المحفوظ' : '1-Click Re-sync from Saved ERP Profile'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isQuickSyncing ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'مزامنة المصدر المحفوظ الآن' : 'Sync Saved Profile Now'}</span>
          </button>
        )}
      </div>

      {/* Primary Connector Tabs Navigation */}
      <div className="bg-white border-b border-[#D1D5DB] px-6 flex items-center gap-2 text-xs font-medium">
        <button
          onClick={() => setActiveConnector('excel')}
          className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition cursor-pointer ${
            activeConnector === 'excel'
              ? 'border-[#2196F3] text-[#2196F3] font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          <span>{hubT.excelTab || (isAr ? 'ملفات إكسيل و CSV' : 'Excel & CSV Files')}</span>
        </button>

        <button
          onClick={() => setActiveConnector('sql')}
          className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition cursor-pointer ${
            activeConnector === 'sql'
              ? 'border-[#2196F3] text-[#2196F3] font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Server className="w-4 h-4 text-[#2196F3]" />
          <span>{hubT.sqlServerTab || (isAr ? 'خادم SQL Server ERP' : 'SQL Server ERP')}</span>
        </button>

        <button
          onClick={() => setActiveConnector('local_db')}
          className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition cursor-pointer ${
            activeConnector === 'local_db'
              ? 'border-[#2196F3] text-[#2196F3] font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <HardDrive className="w-4 h-4 text-amber-600" />
          <span>{hubT.localDbTab || (isAr ? 'قواعد DuckDB / SQLite' : 'DuckDB & SQLite')}</span>
        </button>

        <button
          onClick={() => setActiveConnector('api')}
          className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition cursor-pointer ${
            activeConnector === 'api'
              ? 'border-[#2196F3] text-[#2196F3] font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Globe className="w-4 h-4 text-indigo-600" />
          <span>{hubT.apiTab || (isAr ? 'روابط API و Google Sheets' : 'REST API & Web Feeds')}</span>
        </button>

        <button
          onClick={() => setActiveConnector('logs')}
          className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition cursor-pointer ${
            activeConnector === 'logs'
              ? 'border-[#2196F3] text-[#2196F3] font-bold'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4 text-slate-500" />
          <span>{hubT.auditTab || (isAr ? 'سجل العمليات (Audit Log)' : 'Ingestion Audit Log')}</span>
          {logs.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-300">
              {logs.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* ========================================================================= */}
        {/* TAB 1: EXCEL & CSV CONNECTOR                                              */}
        {/* ========================================================================= */}
        {activeConnector === 'excel' && (
          <div className="space-y-6">
            {/* Template Download Hero Banner */}
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                      {isAr ? 'نماذج جاهزة' : 'Official Templates'}
                    </span>
                    <h3 className="text-sm font-bold text-slate-800">
                      {isAr ? 'تصدير نماذج إكسل القياسية الفارغة مع أمثلة عملية' : 'Standard Blank Excel Templates with Realistic Examples'}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 max-w-2xl">
                    {hubT.templateBannerDesc || (isAr ? 'قم بتحميل النماذج القياسية الجاهزة المنسقة مع أمثلة عملية لاستيراد بياناتك فوراً وبشكل آلي 100% عبر الحوار الأصلي للويندوز.' : 'Download pre-formatted Excel templates with styled headers and realistic sample rows for instant automated import using native Windows Save As dialog.')}
                  </p>
                </div>
                <div className="text-[11px] font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded border border-slate-200 self-start md:self-auto">
                  {isAr ? 'تخطيط Excel متوافق مع اللغة الحالية (RTL)' : 'Language-aware Excel layout (LTR)'}
                </div>
              </div>

              {/* 3 Template Cards with Localized Column Preview Pills */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {/* Sales Template Card */}
                <div className="border border-emerald-200/80 bg-emerald-50/30 rounded-lg p-3.5 flex flex-col justify-between gap-3 hover:border-emerald-300 transition shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        {isAr ? 'نموذج المبيعات' : 'Sales Template'}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded">
                        {templateColumns.sales.length} {isAr ? 'أعمدة' : 'cols'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-2.5">
                      {isAr ? 'حركات المبيعات الشهرية أو الدورية لحساب التنبؤ بالطلب' : 'Periodic sales transactions and revenue history'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {templateColumns.sales.map((col, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-white border border-emerald-200 text-emerald-800 text-[10px] font-medium rounded">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('sales')}
                    disabled={downloadingTemplate === 'sales'}
                    className="flex items-center justify-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50 mt-1"
                  >
                    <Download className={`w-3.5 h-3.5 ${downloadingTemplate === 'sales' ? 'animate-bounce' : ''}`} />
                    <span>{hubT.downloadSalesTemplate || (isAr ? 'تحميل نموذج المبيعات (.xlsx)' : 'Download Sales Template (.xlsx)')}</span>
                  </button>
                </div>

                {/* Inventory Template Card */}
                <div className="border border-blue-200/80 bg-blue-50/30 rounded-lg p-3.5 flex flex-col justify-between gap-3 hover:border-blue-300 transition shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#2196F3]"></span>
                        {isAr ? 'نموذج المخزون' : 'Inventory Master'}
                      </span>
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-100/80 px-1.5 py-0.5 rounded">
                        {templateColumns.inventory.length} {isAr ? 'عموداً' : 'cols'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-2.5">
                      {isAr ? 'سجل الأصناف، الأرصدة، مهل التوريد ومستويات الخدمة المستهدفة' : 'SKU parameters, balances, lead times & service levels'}
                    </p>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {templateColumns.inventory.map((col, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-white border border-blue-200 text-blue-800 text-[10px] font-medium rounded">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('inventory')}
                    disabled={downloadingTemplate === 'inventory'}
                    className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50 mt-1"
                  >
                    <Download className={`w-3.5 h-3.5 ${downloadingTemplate === 'inventory' ? 'animate-bounce' : ''}`} />
                    <span>{hubT.downloadInventoryTemplate || (isAr ? 'تحميل نموذج المخزون (.xlsx)' : 'Download Inventory Template (.xlsx)')}</span>
                  </button>
                </div>

                {/* In-Transit Template Card */}
                <div className="border border-amber-200/80 bg-amber-50/30 rounded-lg p-3.5 flex flex-col justify-between gap-3 hover:border-amber-300 transition shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                        {isAr ? 'نموذج الشحنات بالطريق' : 'In-Transit Shipments'}
                      </span>
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded">
                        {templateColumns.inTransit.length} {isAr ? 'أعمدة' : 'cols'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-2.5">
                      {isAr ? 'أوامر الشراء المفتوحة ومواعيد الوصول وحالات التخليص' : 'Open purchase orders, delivery ETAs & transit status'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {templateColumns.inTransit.map((col, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-white border border-amber-200 text-amber-800 text-[10px] font-medium rounded">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('in-transit')}
                    disabled={downloadingTemplate === 'in-transit'}
                    className="flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50 mt-1"
                  >
                    <Download className={`w-3.5 h-3.5 ${downloadingTemplate === 'in-transit' ? 'animate-bounce' : ''}`} />
                    <span>{isAr ? 'تحميل نموذج الشحن (.xlsx)' : 'Download In-Transit Template (.xlsx)'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Ingestion Parameters Card */}
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {isAr ? '1. إعدادات استيراد ودمج الملف' : '1. File Ingestion & Merge Parameters'}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Import Type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {hubT.importType || (isAr ? 'نوع البيانات المستوردة' : 'Data Category')}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'combined', label: isAr ? 'ملف شامل' : 'Combined', desc: 'SKUs + History' },
                      { id: 'inventory', label: isAr ? 'سجل المخزون' : 'Inventory', desc: 'SKU Master' },
                      { id: 'sales', label: isAr ? 'حركات المبيعات' : 'Sales History', desc: 'Periodic Actuals' },
                      { id: 'in_transit', label: isAr ? 'شحنات بالطريق' : 'In-Transit', desc: 'Orders & ETAs' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setImportType(opt.id as any)}
                        className={`p-2 rounded border text-left text-xs transition cursor-pointer ${
                          importType === opt.id
                            ? 'bg-blue-50 border-[#2196F3] text-blue-900 font-bold'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-semibold">{opt.label}</div>
                        <div className="text-[10px] text-slate-400 font-normal">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Merge Mode */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {hubT.mergeMode || (isAr ? 'أسلوب التحديث والدمج' : 'Ingestion Mode')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMergeMode('merge')}
                      className={`p-2 rounded border text-left text-xs transition cursor-pointer ${
                        mergeMode === 'merge'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-900 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-semibold">{hubT.mergeOption || (isAr ? 'دمج وتحديث الحالي' : 'Merge & Update Existing')}</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        {isAr ? 'تحديث الأصناف المطابقة وإضافة الجديدة' : 'Upsert matching SKUs and append new'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMergeMode('replace')}
                      className={`p-2 rounded border text-left text-xs transition cursor-pointer ${
                        mergeMode === 'replace'
                          ? 'bg-amber-50 border-amber-500 text-amber-900 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-semibold">{hubT.replaceOption || (isAr ? 'استبدال كامل البيانات' : 'Replace All Data')}</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        {isAr ? 'حذف أصناف المشروع الحالية وإحلال الجديدة' : 'Clear existing project SKUs and rewrite'}
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {mergeMode === 'replace' && (
                <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{hubT.confirmReplaceWarning || (isAr ? 'تنبيه: أسلوب الاستبدال سيقوم بحذف الأصناف الحالية في هذا المشروع واستبدالها بالبيانات الجديدة.' : 'Notice: Replace mode will overwrite existing SKU records in this project.')}</span>
                </div>
              )}
            </div>

            {/* Drag & Drop File Zone */}
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {isAr ? '2. اختيار أو سحب الملف' : '2. File Upload Dropzone'}
              </h3>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
                  selectedFile
                    ? 'border-emerald-400 bg-emerald-50/30'
                    : 'border-slate-300 hover:border-[#2196F3] bg-slate-50/50 hover:bg-blue-50/20'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="p-3 bg-white rounded-full shadow-xs border border-slate-200">
                  <UploadCloud className="w-6 h-6 text-[#2196F3]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    {selectedFile ? selectedFile.name : (hubT.dragDropTitle || (isAr ? 'اسحب وأفلت ملف إكسيل (.xlsx, .xls) أو CSV هنا' : 'Drag & Drop your Excel (.xlsx, .xls) or CSV file here'))}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : (hubT.dragDropSub || (isAr ? 'أو انقر لاختيار الملف من جهاز الكمبيوتر' : 'or click to browse from your computer'))}
                  </p>
                </div>
              </div>
            </div>

            {/* Live Data Preview & Column Mapping Table */}
            {inspectData && (
              <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Table className="w-4 h-4 text-[#2196F3]" />
                    <span>{hubT.previewTitle || (isAr ? 'معاينة البيانات ومطابقة الأعمدة الذكية' : 'Data Preview & Column Mapping')}</span>
                    <span className="text-[11px] font-normal text-slate-500">
                      ({inspectData.rowCount} {isAr ? 'صف مكتشف' : 'rows detected'})
                    </span>
                  </h3>

                  <button
                    onClick={handleCommitTypedImport}
                    disabled={isProcessingFile}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isProcessingFile ? (hubT.saving || 'Saving...') : (hubT.commitImport || (isAr ? 'اعتماد وحفظ في قاعدة بيانات DuckDB' : 'Commit & Save to DuckDB Workspace'))}</span>
                  </button>
                </div>

                {/* Preview Grid */}
                <div className="border border-slate-200 rounded overflow-x-auto max-h-72">
                  <table className="w-full text-[12px] border-collapse">
                    <thead className="bg-[#343D46] text-white sticky top-0">
                      <tr>
                        {inspectData.columns.map((c, i) => (
                          <th key={i} className="px-3 py-2 text-left font-semibold border-r border-[#2A3138] truncate whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {inspectData.previewRows.slice(0, 8).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-blue-50/40">
                          {inspectData.columns.map((c, cIdx) => (
                            <td key={cIdx} className="px-3 py-1.5 border-r border-slate-100 truncate whitespace-nowrap text-slate-700">
                              {String(row[c] ?? '')}
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

        {/* ========================================================================= */}
        {/* TAB 2: MICROSOFT SQL SERVER ERP CONNECTOR                                 */}
        {/* ========================================================================= */}
        {activeConnector === 'sql' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-[#2196F3]" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      {isAr ? 'الربط المباشر مع خادم Microsoft SQL Server ERP' : 'Direct Microsoft SQL Server ERP Integration'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {isAr ? 'سحب مباشر لجداول الأصناف، حركات المبيعات، ومخزون المستودعات عبر ODBC' : 'Direct SQL query and table ingestion for SKUs, inventory, and historical sales transactions'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestSqlServer}
                    disabled={sqlTestState === 'testing'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-semibold transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sqlTestState === 'testing' ? 'animate-spin' : ''}`} />
                    <span>{hubT.sqlTestConn || (isAr ? 'اختبار الاتصال' : 'Test Connection')}</span>
                  </button>

                  <button
                    onClick={handleImportSqlServer}
                    disabled={isSyncingSql}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSyncingSql ? 'Syncing...' : (hubT.sqlSyncNow || (isAr ? 'سحب ومزامنة البيانات الآن' : 'Sync ERP Data Now'))}</span>
                  </button>
                </div>
              </div>

              {/* Test Status Banner */}
              {sqlTestResult && (
                <div className={`p-3 rounded border text-xs flex items-center justify-between ${
                  sqlTestResult.success
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-rose-50 border-rose-300 text-rose-900'
                }`}>
                  <div className="flex items-center gap-2">
                    {sqlTestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                    <span>{sqlTestResult.message || sqlTestResult.error}</span>
                  </div>
                  {sqlTestResult.driver_used && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-200/60 font-semibold">
                      {sqlTestResult.driver_used}
                    </span>
                  )}
                </div>
              )}

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {hubT.sqlServerHost || 'Server Host / Instance'}
                  </label>
                  <input
                    type="text"
                    value={sqlHost}
                    onChange={e => setSqlHost(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    placeholder="e.g. localhost\SQLEXPRESS or tcp:192.168.1.10,1433"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {hubT.sqlDatabase || 'Database Name'}
                  </label>
                  <input
                    type="text"
                    value={sqlDb}
                    onChange={e => setSqlDb(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    placeholder="e.g. ERP_SupplyChain_DW"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {hubT.sqlAuthMode || 'Authentication'}
                  </label>
                  <select
                    value={sqlAuthMode}
                    onChange={e => setSqlAuthMode(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none cursor-pointer"
                  >
                    <option value="sql">{hubT.sqlUserPassAuth || 'SQL Server Authentication'}</option>
                    <option value="windows">{hubT.sqlWindowsAuth || 'Windows Integrated Authentication'}</option>
                  </select>
                </div>
              </div>

              {sqlAuthMode === 'sql' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {hubT.sqlUsername || 'Username'}
                    </label>
                    <input
                      type="text"
                      value={sqlUser}
                      onChange={e => setSqlUser(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {hubT.sqlPassword || 'Password'}
                    </label>
                    <input
                      type="password"
                      value={sqlPass}
                      onChange={e => setSqlPass(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Table Mapping & Custom SQL */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    {isAr ? 'مخطط الجداول والاستعلامات' : 'Table Mapping & Query Options'}
                  </h4>

                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sqlUseCustomQuery}
                      onChange={e => setSqlUseCustomQuery(e.target.checked)}
                      className="rounded text-[#2196F3]"
                    />
                    <span>{isAr ? 'استخدام استعلام SQL مخصص' : 'Use Custom SQL Query'}</span>
                  </label>
                </div>

                {!sqlUseCustomQuery ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {isAr ? 'جدول الأصناف (Items Table / View)' : 'Items Table / View'}
                      </label>
                      <input
                        type="text"
                        value={sqlItemsTable}
                        onChange={e => setSqlItemsTable(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {isAr ? 'جدول المبيعات (Sales Transactions Table)' : 'Sales History Table / View'}
                      </label>
                      <input
                        type="text"
                        value={sqlSalesTable}
                        onChange={e => setSqlSalesTable(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {isAr ? 'استعلام SQL المباشر' : 'Custom SQL Query'}
                    </label>
                    <textarea
                      rows={3}
                      value={sqlCustomQuery}
                      onChange={e => setSqlCustomQuery(e.target.value)}
                      placeholder="SELECT ItemCode AS code, Description AS description, OnHand AS on_hand, PurchasePrice AS purchase_price FROM dbo.Dim_Item WHERE IsActive = 1"
                      className="w-full px-3 py-2 text-xs font-mono rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    />
                  </div>
                )}

                {/* Save Profile Checkbox */}
                <div className="pt-2 flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sqlSaveProfile}
                      onChange={e => setSqlSaveProfile(e.target.checked)}
                      className="rounded text-[#2196F3]"
                    />
                    <span>{hubT.sqlSaveProfile || 'Save connection profile for 1-click re-sync'}</span>
                  </label>

                  {sqlSaveProfile && (
                    <input
                      type="text"
                      value={sqlProfileName}
                      onChange={e => setSqlProfileName(e.target.value)}
                      className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none max-w-xs"
                      placeholder="Profile name"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: LOCAL EMBEDDED DATABASES (DUCKDB / SQLITE)                         */}
        {/* ========================================================================= */}
        {activeConnector === 'local_db' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <HardDrive className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isAr ? 'استيراد من قواعد بيانات DuckDB و SQLite المحلية' : 'Local Embedded DuckDB & SQLite Ingestion'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr ? 'قراءة ومعاينة الجداول مباشرة من ملفات .duckdb أو .sqlite أو .db على جهازك' : 'Directly inspect and extract tables from local .duckdb, .sqlite, or .db files'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {hubT.localDbFile || 'Database File Path or Upload'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={localDbPath}
                      onChange={e => {
                        setLocalDbPath(e.target.value);
                        setLocalDbFile(null);
                      }}
                      className="flex-1 px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                      placeholder="C:\data\source_inventory.duckdb or .sqlite"
                    />
                    <input
                      ref={localDbFileRef}
                      type="file"
                      accept=".duckdb,.sqlite,.db"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setLocalDbFile(f);
                          setLocalDbPath(f.name);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => localDbFileRef.current?.click()}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-semibold transition cursor-pointer"
                    >
                      {isAr ? 'تصفح...' : 'Browse...'}
                    </button>
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleInspectLocalDb}
                    disabled={isInspectingDb || (!localDbFile && !localDbPath.trim())}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isInspectingDb ? 'animate-spin' : ''}`} />
                    <span>{hubT.inspectTables || (isAr ? 'فحص الجداول والمخطط' : 'Inspect Tables & Schema')}</span>
                  </button>
                </div>
              </div>

              {/* Inspection Results */}
              {inspectDbResult && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-4 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 uppercase text-[10px]">
                        {inspectDbResult.file_type}
                      </span>
                      <span>{isAr ? 'تم اكتشاف الجداول التالية:' : 'Discovered Tables:'}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <select
                        value={dbDataCategory}
                        onChange={e => setDbDataCategory(e.target.value as any)}
                        className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white outline-none cursor-pointer"
                      >
                        <option value="inventory">{isAr ? 'سجل المخزون (Inventory)' : 'Inventory Master'}</option>
                        <option value="sales">{isAr ? 'حركات المبيعات (Sales)' : 'Sales History'}</option>
                      </select>

                      <button
                        onClick={handleImportLocalDb}
                        disabled={isImportingDb}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isImportingDb ? 'Importing...' : (hubT.importLocalDbNow || 'Import Selected Table')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {inspectDbResult.tables.map(tbl => (
                      <div
                        key={tbl}
                        onClick={() => setSelectedDbTable(tbl)}
                        className={`p-3 rounded border text-xs cursor-pointer transition ${
                          selectedDbTable === tbl
                            ? 'bg-blue-50 border-[#2196F3] text-blue-900 font-bold shadow-xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-semibold truncate">{tbl}</div>
                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                          {inspectDbResult.table_details[tbl]?.columns?.length || 0} {isAr ? 'عمود' : 'columns'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: REST API / GOOGLE SHEETS CONNECTOR                                 */}
        {/* ========================================================================= */}
        {activeConnector === 'api' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Globe className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isAr ? 'تغذية الويب المباشرة (REST API أو Google Sheets CSV)' : 'Cloud REST API & Google Sheets Web Feed'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr ? 'استيراد فوري من روابط JSON REST endpoints أو ملفات Google Sheets المنشورة بصيغة CSV' : 'Fetch live data feeds from remote REST endpoints or published Google Sheets CSV URLs'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {hubT.apiUrl || 'Endpoint URL (JSON or Google Sheets CSV)'}
                  </label>
                  <input
                    type="url"
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                    placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv or https://api.corp.com/v1/skus"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {hubT.authHeaderName || 'Auth Header Name (Optional)'}
                    </label>
                    <input
                      type="text"
                      value={apiHeaderName}
                      onChange={e => setApiHeaderName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                      placeholder="e.g. Authorization or X-API-Key"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {hubT.authTokenVal || 'Token / API Key (Optional)'}
                    </label>
                    <input
                      type="password"
                      value={apiAuthToken}
                      onChange={e => setApiAuthToken(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded border border-slate-300 bg-white focus:border-[#2196F3] outline-none"
                      placeholder="Bearer token or secret key"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-3">
                    <select
                      value={apiCategory}
                      onChange={e => setApiCategory(e.target.value as any)}
                      className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white outline-none cursor-pointer"
                    >
                      <option value="inventory">{isAr ? 'سجل المخزون (Inventory)' : 'Inventory Master'}</option>
                      <option value="sales">{isAr ? 'حركات المبيعات (Sales)' : 'Sales History'}</option>
                    </select>

                    <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={apiSaveProfile}
                        onChange={e => setApiSaveProfile(e.target.checked)}
                        className="rounded text-[#2196F3]"
                      />
                      <span>{isAr ? 'حفظ الرابط للمزامنة' : 'Save as feed profile'}</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePreviewApi}
                      disabled={isPreviewingApi || !apiUrl.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isPreviewingApi ? 'animate-spin' : ''}`} />
                      <span>{hubT.previewFeed || 'Fetch & Preview'}</span>
                    </button>

                    <button
                      onClick={handleImportApi}
                      disabled={isImportingApi || !apiUrl.trim()}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isImportingApi ? 'Ingesting...' : (hubT.importApiNow || 'Ingest Feed Now')}</span>
                    </button>
                  </div>
                </div>

                {/* API Preview Rows */}
                {apiPreview && (
                  <div className="border border-slate-200 rounded mt-4 p-3 bg-slate-50/50 space-y-2">
                    <div className="text-xs font-bold text-slate-800">
                      {isAr ? `تم جلب ${apiPreview.row_count} سجل بنجاح:` : `Successfully fetched ${apiPreview.row_count} records:`}
                    </div>
                    <div className="overflow-x-auto max-h-48 border border-slate-200 rounded bg-white">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="bg-[#343D46] text-white">
                          <tr>
                            {apiPreview.columns.slice(0, 8).map((c, i) => (
                              <th key={i} className="px-2.5 py-1 text-left font-semibold border-r border-[#2A3138]">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {apiPreview.preview_rows.slice(0, 5).map((r, rIdx) => (
                            <tr key={rIdx}>
                              {apiPreview.columns.slice(0, 8).map((c, cIdx) => (
                                <td key={cIdx} className="px-2.5 py-1 truncate border-r border-slate-50 text-slate-600">
                                  {String(r[c] ?? '')}
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
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: INGESTION AUDIT LOG                                                */}
        {/* ========================================================================= */}
        {activeConnector === 'logs' && (
          <div className="bg-white rounded-lg border border-[#D1D5DB] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-slate-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isAr ? 'سجل عمليات تغذية البيانات (Ingestion Audit Trail)' : 'Data Ingestion Audit Trail'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr ? 'تتبع تاريخي شامل لجميع عمليات السحب، الملفات المرفوعة، والمزامنة مع ERP' : 'Persistent historical record of all data feeds, file uploads, and ERP synchronizations'}
                  </p>
                </div>
              </div>

              <button
                onClick={loadLogsAndConnections}
                disabled={isLoadingLogs}
                className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-xs font-semibold transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'تحديث السجل' : 'Refresh'}</span>
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                {hubT.noLogsYet || (isAr ? 'لا توجد سجلات تغذية بيانات حتى الآن.' : 'No data ingestion events recorded yet.')}
              </div>
            ) : (
              <div className="border border-slate-200 rounded overflow-x-auto">
                <table className="w-full text-[12px] text-left border-collapse">
                  <thead className="bg-[#343D46] text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold border-r border-[#2A3138]">{hubT.logTime || 'Timestamp'}</th>
                      <th className="px-3 py-2 font-semibold border-r border-[#2A3138]">{hubT.logSource || 'Source'}</th>
                      <th className="px-3 py-2 font-semibold border-r border-[#2A3138]">{hubT.logCategory || 'Category'}</th>
                      <th className="px-3 py-2 font-semibold border-r border-[#2A3138]">{hubT.logRows || 'Rows Processed'}</th>
                      <th className="px-3 py-2 font-semibold border-r border-[#2A3138]">{hubT.logStatus || 'Status'}</th>
                      <th className="px-3 py-2 font-semibold">{isAr ? 'التفاصيل' : 'Details'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[11.5px] font-bold uppercase ${
                            log.source_type === 'sql_server' ? 'bg-blue-100 text-blue-800' :
                            log.source_type === 'excel' ? 'bg-emerald-100 text-emerald-800' :
                            log.source_type === 'duckdb_sqlite' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {log.source_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700 font-medium capitalize">
                          {log.data_category}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-800">
                          {log.rows_processed.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1 text-emerald-700 font-semibold text-[12px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{log.status}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-[12px] truncate max-w-xs">
                          {log.source_name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
