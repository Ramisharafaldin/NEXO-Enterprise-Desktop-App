import React, { useState, useRef } from 'react';
import { 
  FilePlus, 
  FolderOpen, 
  Database, 
  BookOpen, 
  Layers, 
  Network, 
  Calendar, 
  ShoppingBag, 
  PlayCircle,
  Clock,
  ArrowRight,
  FileSpreadsheet,
  Trash2,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Upload,
  RefreshCw,
  Table,
  Sliders
} from 'lucide-react';
import { translations, Language } from '../i18n/translations';
import { NexoLogo } from '../components/NexoLogo';
import { api, ProjectSummary, FileInspectResult } from '../api/client';
import { formatExportSuccessToast } from '../utils/exportDownload';

interface StartViewProps {
  language: Language;
  projects: ProjectSummary[];
  activeProjectId: string;
  onSelectProject: (projectId: string, targetTab?: any) => void;
  onRefreshProjects: () => Promise<any> | void;
  onLoadExample: (exampleKey: 'retail' | 'drp' | 'mrp' | 'multichannel' | 'weekly') => void;
  appVersion?: string;
}

export const StartView: React.FC<StartViewProps> = ({
  language,
  projects,
  activeProjectId,
  onSelectProject,
  onRefreshProjects,
  onLoadExample,
  appVersion,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [activeSubTab, setActiveSubTab] = useState<'projects' | 'examples' | 'tutorials'>('examples');
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [exportToast, setExportToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // New Project Modal State
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // File Upload & Interactive Column Mapping State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inspectData, setInspectData] = useState<FileInspectResult | null>(null);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [customProjectName, setCustomProjectName] = useState('');
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({
    code: '',
    description: '',
    category: '',
    location: '',
    sales_price: '',
    purchase_price: '',
    on_hand: '',
    on_order: '',
    lead_time_days: '',
    service_level: '',
    min_batch: '',
    batch_rounding: '',
  });

  const handleCreateNewProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreatingProject(true);
    try {
      const proj = await api.createProject(newProjectName.trim(), newProjectDesc.trim(), 'Custom Workspace');
      await onRefreshProjects();
      onSelectProject(proj.id, 'data-hub');
      setIsNewProjectModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
    } catch (err: any) {
      alert(`Error creating project: ${err.message}`);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const inspection = await api.inspectFile(file);
      setPendingFile(file);
      setInspectData(inspection);
      setCustomProjectName(file.name.replace(/\.[^/.]+$/, ""));
      
      // Auto-populate suggested mappings
      const initialMap: Record<string, string> = {
        code: inspection.suggested_mappings.code || inspection.columns[0] || '',
        description: inspection.suggested_mappings.description || '',
        category: inspection.suggested_mappings.category || '',
        location: inspection.suggested_mappings.location || '',
        sales_price: inspection.suggested_mappings.sales_price || '',
        purchase_price: inspection.suggested_mappings.purchase_price || '',
        on_hand: inspection.suggested_mappings.on_hand || '',
        on_order: inspection.suggested_mappings.on_order || '',
        lead_time_days: inspection.suggested_mappings.lead_time_days || '',
        service_level: inspection.suggested_mappings.service_level || '',
        min_batch: inspection.suggested_mappings.min_batch || '',
        batch_rounding: inspection.suggested_mappings.batch_rounding || '',
      };
      setColumnMappings(initialMap);
      setIsMappingModalOpen(true);
    } catch (err: any) {
      // Fallback: direct upload if inspection endpoint is bypassed
      try {
        const res = await api.uploadFile(file);
        onRefreshProjects();
        onSelectProject(res.project_id);
      } catch (uploadErr: any) {
        setUploadError(uploadErr.message || 'File upload failed');
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmMappingAndImport = async () => {
    if (!pendingFile) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await api.uploadFile(pendingFile, customProjectName || pendingFile.name, columnMappings);
      setIsMappingModalOpen(false);
      setPendingFile(null);
      setInspectData(null);
      onRefreshProjects();
      onSelectProject(res.project_id);
    } catch (err: any) {
      setUploadError(err.message || 'Interactive import failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(isAr ? 'هل أنت متأكد من حذف هذا المشروع نهائياً من قاعدة البيانات؟' : 'Are you sure you want to delete this project from the database?')) {
      return;
    }
    try {
      await api.deleteProject(id);
      onRefreshProjects();
    } catch (err: any) {
      alert(`Error deleting project: ${err.message}`);
    }
  };

  const exampleModels = [
    {
      id: 'retail' as const,
      title: 'Retail Inventory Planning Example monthly',
      desc: isAr 
        ? 'تخطيط تجديد مخزون التجزئة لـ 10 أصناف رئيسية عبر 24 فترة شهرية مع الموسمية ونقاط إعادة الطلب.'
        : 'Monthly multi-SKU retail replenishment across 10 core items, 24 periods with seasonality & ROP.',
      file: 'Retail Inventory Planning Example monthly.xlsx',
      icon: ShoppingBag,
      color: 'text-blue-600 bg-blue-50 border-blue-200',
      badge: isAr ? 'شهري' : 'Monthly',
    },
    {
      id: 'drp' as const,
      title: 'Two-Echelon Inventory Planning (Central DC & Stores)',
      desc: isAr
        ? 'شبكة توزيع ثنائية المستويات تربط بين المستودع المركزي والفروع الإقليمية مع موازنة الشحنات.'
        : '2-Echelon multi-echelon network consolidating store demands at Central DC with transfer triggers.',
      file: 'Two-Echelon Distribution Planning.xlsx',
      icon: Network,
      color: 'text-purple-600 bg-purple-50 border-purple-200',
      badge: isAr ? 'شبكة DRP' : 'DRP Network',
    },
    {
      id: 'mrp' as const,
      title: 'Material Requirements Planning (BOM Explosion)',
      desc: isAr
        ? 'تفكيك شجرة المواد (BOM) للمنتجات التامة إلى مواد أولية وحساب مهل التوريد التراكمية.'
        : 'Multi-level Bill of Materials explosion from finished goods down to raw components with lead time offsets.',
      file: 'Manufacturing MRP Example.xlsx',
      icon: Layers,
      color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      badge: isAr ? 'تصنيع MRP' : 'Manufacturing MRP',
    },
    {
      id: 'multichannel' as const,
      title: 'Multi-Channel Demand & Inventory Planning',
      desc: isAr
        ? 'تخطيط الطلب متعدد القنوات للمتاجر الفعلية وقنوات التجارة الإلكترونية ومبيعات الجملة.'
        : 'Omnichannel inventory distribution balancing retail branches, e-commerce, and wholesale pipelines.',
      file: 'Multi-Channel Demand.xlsx',
      icon: Calendar,
      color: 'text-amber-600 bg-amber-50 border-amber-200',
      badge: isAr ? 'متعدد القنوات' : 'Omnichannel',
    },
    {
      id: 'weekly' as const,
      title: 'Inventory Planning by Week',
      desc: isAr
        ? 'تخطيط سريع وعالي الوتيرة على أساس أسبوعي للمنتجات سريعة الاستهلاك والمواد الغذائية.'
        : 'High-frequency weekly replenishment cycles for fast-moving consumer goods and perishable items.',
      file: 'Weekly Fast Cycle Replenishment.xlsx',
      icon: Clock,
      color: 'text-rose-600 bg-rose-50 border-rose-200',
      badge: isAr ? 'أسبوعي' : 'Weekly',
    },
  ];

  return (
    <div className="flex-1 flex overflow-hidden bg-white text-[#1E293B]">
      {/* Hidden File Input for Excel/CSV Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".xlsx,.xls,.csv"
        className="hidden"
      />

      {/* Secondary Sub-Sidebar (#F3F4F6, width ~224px) */}
      <aside className="w-56 bg-[#F3F4F6] border-r border-[#D1D5DB] flex flex-col py-4 px-2 select-none shrink-0">
        <div className="px-3 mb-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          {isAr ? 'بدء العمل' : 'Start Workspace'}
        </div>

        <nav className="space-y-1">
          <button
            onClick={() => setActiveSubTab('projects')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] font-medium transition cursor-pointer ${
              activeSubTab === 'projects'
                ? 'bg-white text-[#2196F3] shadow-xs font-semibold'
                : 'text-slate-700 hover:bg-[#E5E7EB]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FolderOpen className="w-4 h-4 text-slate-500" />
              <span>{t.start.projectsTab}</span>
            </div>
            {projects.length > 0 && (
              <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full">
                {projects.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('examples')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-[12px] font-medium transition cursor-pointer ${
              activeSubTab === 'examples'
                ? 'bg-white text-[#2196F3] shadow-xs font-semibold'
                : 'text-slate-700 hover:bg-[#E5E7EB]'
            }`}
          >
            <BookOpen className="w-4 h-4 text-slate-500" />
            <span>{t.start.examplesTab}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('tutorials')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-[12px] font-medium transition cursor-pointer ${
              activeSubTab === 'tutorials'
                ? 'bg-white text-[#2196F3] shadow-xs font-semibold'
                : 'text-slate-700 hover:bg-[#E5E7EB]'
            }`}
          >
            <PlayCircle className="w-4 h-4 text-slate-500" />
            <span>{t.start.tutorialsTab}</span>
          </button>
        </nav>
      </aside>

      {/* Main White Canvas */}
      <main className="flex-1 overflow-y-auto p-8 bg-white">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Prominent NEXO Brand Hero Banner */}
          <div className="border-b border-[#E2E8F0] pb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <NexoLogo size="xl" />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                    NEXO
                  </h1>
                  {isAr && (
                    <span className="text-xl font-bold text-[#2196F3] font-arabic">
                      نيكسو
                    </span>
                  )}
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-[#2196F3] px-2.5 py-0.5 rounded-full border border-blue-200 ml-2">
                    Enterprise Full-Stack
                  </span>
                  {appVersion && (
                    <span className="text-[11px] font-bold font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300 ml-1">
                      {appVersion.startsWith('v') ? appVersion : `v${appVersion}`}
                    </span>
                  )}
                </div>
                <p className="text-slate-500 text-[13px] mt-1 font-medium">
                  {t.start.subtitle}
                </p>
              </div>
            </div>
          </div>

          {/* Upload Status / Error alert */}
          {uploadError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[12px] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{uploadError}</span>
              </div>
              <button onClick={() => setUploadError(null)} className="text-rose-500 hover:text-rose-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isUploading && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-[#2196F3] text-[12px] flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{isAr ? 'جارٍ فحص وتحليل بنية البيانات واستيرادها إلى DuckDB...' : 'Inspecting spreadsheet structure and ingesting into DuckDB workspace...'}</span>
            </div>
          )}

          {/* 2 Prominent Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. + New Project */}
            <button
              onClick={() => setIsNewProjectModalOpen(true)}
              className="p-5 bg-[#2196F3] hover:bg-blue-600 text-white rounded-lg shadow-sm border border-blue-500 flex flex-col justify-between items-start text-left transition transform hover:-translate-y-0.5 cursor-pointer"
            >
              <div className="flex items-center justify-between w-full">
                <div className="p-2 bg-white/20 rounded">
                  <FilePlus className="w-6 h-6 text-white" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded">
                  {isAr ? 'جديد' : 'Create'}
                </span>
              </div>
              <div className="mt-4">
                <span className="text-base font-bold block">{t.start.newProjectBtn}</span>
                <span className="text-xs text-blue-100 mt-1 block">
                  {isAr ? 'تهيئة مساحة تخطيط جديدة وحفظها في DuckDB.' : 'Initialize empty supply chain workspace in DuckDB.'}
                </span>
              </div>
            </button>

            {/* 2. Open Project / Import File */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-5 bg-white hover:bg-blue-50/50 text-[#2196F3] rounded-lg shadow-xs border-2 border-[#2196F3] flex flex-col justify-between items-start text-left transition transform hover:-translate-y-0.5 cursor-pointer"
            >
              <div className="flex items-center justify-between w-full">
                <div className="p-2 bg-blue-50 rounded">
                  <FolderOpen className="w-6 h-6 text-[#2196F3]" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider bg-blue-100/60 text-[#2196F3] px-2 py-0.5 rounded">
                  {isAr ? 'استيراد ملف' : 'Import File'}
                </span>
              </div>
              <div className="mt-4">
                <span className="text-base font-bold block text-slate-800">{t.start.openProjectBtn}</span>
                <span className="text-xs text-slate-500 mt-1 block">
                  {isAr ? 'استيراد ملفات Excel (.xlsx) أو CSV مع تعيين تفاعلي للأعمدة.' : 'Interactive column mapping & DuckDB import (.xlsx / .csv).'}
                </span>
              </div>
            </button>
          </div>

          {/* Sub Tab: Recent Saved Projects in DuckDB */}
          {activeSubTab === 'projects' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">
                  {t.start.recentProjects} ({projects.length})
                </h2>
                <button
                  onClick={onRefreshProjects}
                  className="text-xs text-[#2196F3] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>{isAr ? 'تحديث القائمة' : 'Refresh'}</span>
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-[#CBD5E1] rounded-lg text-center bg-[#F8F9FA]">
                  <FolderOpen className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <p className="text-slate-600 text-sm font-semibold">
                    {t.start.noRecent}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {isAr ? 'انقر على "فتح مشروع" لتحميل ملف من جهازك.' : 'Click "Open project" to load an existing file.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {projects.map(proj => {
                    const isActive = proj.id === activeProjectId;
                    return (
                      <div
                        key={proj.id}
                        onClick={() => onSelectProject(proj.id)}
                        className={`p-4 rounded-lg border transition flex items-center justify-between cursor-pointer ${
                          isActive
                            ? 'border-[#2196F3] bg-blue-50/30 shadow-xs'
                            : 'border-[#E2E8F0] hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3.5">
                          <div className={`p-2.5 rounded-lg ${isActive ? 'bg-[#2196F3] text-white' : 'bg-slate-100 text-slate-600'}`}>
                            <Database className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-800">
                                {proj.name}
                              </h3>
                              {isActive && (
                                <span className="text-[10px] font-bold bg-[#2196F3] text-white px-2 py-0.5 rounded-full">
                                  {isAr ? 'المشروع النشط' : 'Active'}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {proj.description || proj.dataset_name || 'Persistent DuckDB Workspace'}
                            </p>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1.5 font-mono">
                              <span>SKUs: <strong>{proj.sku_count}</strong></span>
                              <span>•</span>
                              <span>{isAr ? 'آخر تحديث:' : 'Updated:'} {new Date(proj.updated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={exportingProjectId === proj.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setExportingProjectId(proj.id);
                              try {
                                const res = await api.downloadExcelExport(proj.id, 'all', `NEXO_${proj.name}.xlsx`);
                                const msg = formatExportSuccessToast(res, isAr);
                                if (msg) {
                                  setExportToast({ type: 'success', text: msg });
                                  setTimeout(() => setExportToast(null), 5000);
                                }
                              } catch (err: any) {
                                setExportToast({
                                  type: 'error',
                                  text: (isAr ? 'فشل تصدير المشروع: ' : 'Project export failed: ') + (err?.message || 'Unknown error'),
                                });
                                setTimeout(() => setExportToast(null), 6000);
                              } finally {
                                setExportingProjectId(null);
                              }
                            }}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded transition disabled:opacity-50 cursor-pointer"
                            title={isAr ? 'تصدير كملف Excel' : 'Export to Excel'}
                          >
                            {exportingProjectId === proj.id ? <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> : <Download className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={e => handleDeleteProject(proj.id, e)}
                            className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                            title={isAr ? 'حذف المشروع' : 'Delete Project'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="px-3 py-1.5 bg-slate-100 hover:bg-[#2196F3] hover:text-white text-slate-700 text-xs font-semibold rounded transition flex items-center gap-1">
                            <span>{isAr ? 'فتح' : 'Open'}</span>
                            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sub Tab: Example Models */}
          {activeSubTab === 'examples' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">
                  {t.start.exampleModels}
                </h2>
                <span className="text-xs text-slate-500">
                  {exampleModels.length} {isAr ? 'نماذج قياسية متوفرة' : 'benchmark models available'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {exampleModels.map(model => {
                  const Icon = model.icon;
                  return (
                    <div
                      key={model.id}
                      onClick={() => onLoadExample(model.id)}
                      className="p-4 rounded-lg border border-[#E2E8F0] hover:border-[#2196F3] hover:shadow-md bg-white transition cursor-pointer flex flex-col justify-between group"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${model.color}`}>
                            {model.badge}
                          </span>
                          <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            {model.file}
                          </span>
                        </div>
                        <h3 className="text-[13px] font-bold text-slate-800 group-hover:text-[#2196F3] transition">
                          {model.title}
                        </h3>
                        <p className="text-[12px] text-slate-500 mt-1 line-clamp-2">
                          {model.desc}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[11px] font-semibold text-[#2196F3]">
                        <span>{t.start.loadExample}</span>
                        <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sub Tab: Tutorials */}
          {activeSubTab === 'tutorials' && (
            <div className="space-y-4 pt-2">
              <h2 className="text-base font-bold text-slate-800">
                {t.start.tutorialsTitle}
              </h2>

              <div className="space-y-3">
                <div className="p-4 bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg flex items-start gap-4">
                  <div className="p-3 bg-[#2196F3]/10 text-[#2196F3] rounded-lg shrink-0">
                    <PlayCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      {t.start.tut1Title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {t.start.tut1Desc}
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg flex items-start gap-4">
                  <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-lg shrink-0">
                    <PlayCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      {t.start.tut2Title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {t.start.tut2Desc}
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg flex items-start gap-4">
                  <div className="p-3 bg-purple-500/10 text-purple-600 rounded-lg shrink-0">
                    <PlayCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      {t.start.tut3Title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {t.start.tut3Desc}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Project Dialog Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-[#CBD5E1] w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-[#F8F9FA] px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FilePlus className="w-5 h-5 text-[#2196F3]" />
                <h3 className="text-sm font-bold text-slate-800">
                  {isAr ? 'إنشاء مشروع تخطيط جديد' : 'Create New Supply Chain Project'}
                </h3>
              </div>
              <button 
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewProject} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {isAr ? 'اسم المشروع' : 'Project Name'} *
                </label>
                <input
                  type="text"
                  required
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  placeholder={isAr ? 'مثال: خطة الطلب والتوريد للربع الثالث 2026' : 'e.g. Q3 2026 Regional Demand & Replenishment'}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-xs focus:outline-none focus:border-[#2196F3]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {isAr ? 'الوصف (اختياري)' : 'Description (Optional)'}
                </label>
                <textarea
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  placeholder={isAr ? 'أضف ملاحظات حول نطاق التخطيط أو الفروع أو الموردين...' : 'Add notes regarding scope, branches, distribution centers...'}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-xs focus:outline-none focus:border-[#2196F3] h-20 resize-none"
                />
              </div>

              <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded text-slate-600 text-[11px]">
                {isAr
                  ? 'سيتم إنشاء مساحة تخزين مخصصة في قاعدة بيانات DuckDB المحلية مع دعم فوري لاستيراد الأصناف والجداول.'
                  : 'A dedicated local DuckDB workspace will be initialized, ready for live SKU import and analysis.'}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-3 py-1.5 border border-[#CBD5E1] text-slate-700 rounded text-xs font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isCreatingProject || !newProjectName.trim()}
                  className="px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {isCreatingProject && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isAr ? 'إنشاء وتفعيل' : 'Create & Open'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interactive Column Mapping Modal */}
      {isMappingModalOpen && inspectData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-[#CBD5E1] w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#F8F9FA] px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#2196F3]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isAr ? 'تعيين أعمدة ملف البيانات (Interactive Column Mapping)' : 'Map Spreadsheet Columns to NEXO Engine'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {inspectData.filename} • {inspectData.row_count} {isAr ? 'صف بيانات' : 'rows detected'}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsMappingModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {isAr ? 'اسم مساحة المشروع في DuckDB:' : 'Target Workspace Name in DuckDB:'}
                </label>
                <input
                  type="text"
                  value={customProjectName}
                  onChange={e => setCustomProjectName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] font-semibold"
                />
              </div>

              {/* Column Mapping Selectors */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-700 uppercase mb-2">
                  {isAr ? 'تعيين حقول المخطط القياسي:' : 'Standard NEXO Field Mappings:'}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'code', label: 'Item Code (SKU)', req: true },
                    { key: 'description', label: 'Item Description', req: false },
                    { key: 'category', label: 'Category / Group', req: false },
                    { key: 'location', label: 'Location / Warehouse', req: false },
                    { key: 'sales_price', label: 'Sales Price ($)', req: false },
                    { key: 'purchase_price', label: 'Purchase Cost ($)', req: false },
                    { key: 'on_hand', label: 'On-Hand Stock', req: false },
                    { key: 'on_order', label: 'On-Order (In-Transit)', req: false },
                    { key: 'lead_time_days', label: 'Lead Time (Days)', req: false },
                    { key: 'service_level', label: 'Service Level (e.g. 0.95)', req: false },
                    { key: 'min_batch', label: 'MOQ (Min Order Batch)', req: false },
                    { key: 'batch_rounding', label: 'Batch / Box Rounding', req: false },
                  ].map(f => (
                    <div key={f.key} className="p-2 border border-slate-200 rounded-md bg-[#F8F9FA]">
                      <label className="block text-[10px] font-bold text-slate-600 truncate mb-1">
                        {f.label} {f.req && <span className="text-rose-500">*</span>}
                      </label>
                      <select
                        value={columnMappings[f.key] || ''}
                        onChange={e => setColumnMappings({ ...columnMappings, [f.key]: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-300 rounded text-[11px] bg-white focus:outline-none focus:border-[#2196F3]"
                      >
                        <option value="">{isAr ? '-- غير محدد --' : '-- Auto / Default --'}</option>
                        {inspectData.columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample Data Preview Table */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-700 uppercase mb-1.5">
                  {isAr ? 'معاينة أول 3 صفوف من الملف:' : 'First 3 Rows Preview:'}
                </h4>
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#ECEFF1] text-slate-700 font-semibold">
                      <tr>
                        {inspectData.columns.slice(0, 8).map(c => (
                          <th key={c} className="p-2 font-mono">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspectData.preview_rows.map((r, i) => (
                        <tr key={i}>
                          {inspectData.columns.slice(0, 8).map(c => (
                            <td key={c} className="p-2 text-slate-700 font-mono truncate max-w-[120px]">
                              {String(r[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-[#F8F9FA] px-4 py-3 border-t border-[#E2E8F0] flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-mono">
                {inspectData.columns.length} columns detected in {inspectData.filename}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMappingModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded text-xs font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmMappingAndImport}
                  disabled={isUploading}
                  className="px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {isUploading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isAr ? 'تأكيد واستيراد إلى DuckDB' : 'Confirm & Ingest into DuckDB'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {exportToast && (
        <div
          className={`fixed bottom-6 ${isAr ? 'left-6' : 'right-6'} z-50 px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 text-xs font-semibold ${
            exportToast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          {exportToast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{exportToast.text}</span>
        </div>
      )}
    </div>
  );
};
