import React, { useState } from 'react';
import { 
  FilePlus, 
  FolderOpen, 
  Save, 
  RefreshCw, 
  Download, 
  Server, 
  Database,
  Sliders,
  ChevronDown,
  ShoppingCart,
  Network,
  Layers,
  Grid,
  Settings,
  Info,
  X
} from 'lucide-react';
import { translations, Language } from '../i18n/translations';
import { NexoLogo } from './NexoLogo';

interface TopMenuBarProps {
  language: Language;
  onLanguageChange?: (lang: Language) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExportExcel?: () => void;
  onRecalculateAll: () => void;
  onOpenSettings?: () => void;
  onOpenDataHub?: (initialSource?: string) => void;
  onOpenSqlServerModal: () => void;
  onOpenPlannedOrdersModal: () => void;
  onOpenDrpModal: () => void;
  onOpenBomModal: () => void;
  onOpenAbcModal: () => void;
  activeDataset: string;
  isServerConnected: boolean;
}

export const TopMenuBar: React.FC<TopMenuBarProps> = ({
  language,
  onLanguageChange,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onExportExcel,
  onRecalculateAll,
  onOpenSettings,
  onOpenDataHub,
  onOpenSqlServerModal,
  onOpenPlannedOrdersModal,
  onOpenDrpModal,
  onOpenBomModal,
  onOpenAbcModal,
  activeDataset,
  isServerConnected,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  const toggleMenu = (name: string) => {
    setActiveMenu(prev => (prev === name ? null : name));
  };

  const closeMenu = () => setActiveMenu(null);

  return (
    <header className="bg-[#F3F4F6] border-b border-[#D1D5DB] select-none text-[#1E293B] z-30">
      {/* 1. Top Windows-Style Desktop Menu Strip */}
      <div className="flex items-center justify-between px-3 h-8 text-[12px] border-b border-[#E5E7EB] bg-[#ECEFF1]/70">
        <div className="flex items-center gap-2">
          {/* NEXO Brand Wordmark with Mini Emblem */}
          <div className="flex items-center gap-1.5 pr-2 border-r border-[#CBD5E1] mr-1">
            <NexoLogo size="sm" />
            <span className="font-black text-[13px] tracking-wide text-slate-900">
              {isAr ? 'نيكسو | NEXO' : 'NEXO'}
            </span>
          </div>

          {/* File Menu */}
          <div className="relative">
            <button
              onClick={() => toggleMenu('file')}
              className={`px-2 py-0.5 rounded hover:bg-[#E2E8F0] ${activeMenu === 'file' ? 'bg-[#E2E8F0]' : ''}`}
            >
              {t.menu.file}
            </button>
            {activeMenu === 'file' && (
              <div 
                className="absolute top-full mt-0.5 w-48 bg-white border border-[#CBD5E1] shadow-lg rounded py-1 z-50 text-[12px]"
                onMouseLeave={closeMenu}
              >
                <button 
                  onClick={() => { onNewProject(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  <span>{t.menu.newProject}</span>
                </button>
                <button 
                  onClick={() => { onOpenProject(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{t.menu.openProject}</span>
                </button>
                <button 
                  onClick={() => { onSaveProject(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t.menu.saveProject}</span>
                </button>
                <div className="border-t border-[#E2E8F0] my-1" />
                <button 
                  onClick={() => { 
                    if (onExportExcel) onExportExcel();
                    else onSaveProject(); 
                    closeMenu(); 
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.menu.exportExcel}</span>
                </button>
                {onOpenDataHub && (
                  <button 
                    onClick={() => { onOpenDataHub(); closeMenu(); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                  >
                    <Database className="w-3.5 h-3.5 text-[#2196F3]" />
                    <span>{isAr ? 'تغذية واستيراد البيانات...' : 'Data Hub & Ingestion...'}</span>
                  </button>
                )}
                {onOpenSettings && (
                  <>
                    <div className="border-t border-[#E2E8F0] my-1" />
                    <button 
                      onClick={() => { onOpenSettings(); closeMenu(); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>{t.menu.settings}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Item Menu */}
          <div className="relative">
            <button
              onClick={() => toggleMenu('item')}
              className={`px-2 py-0.5 rounded hover:bg-[#E2E8F0] ${activeMenu === 'item' ? 'bg-[#E2E8F0]' : ''}`}
            >
              {t.menu.item}
            </button>
            {activeMenu === 'item' && (
              <div 
                className="absolute top-full mt-0.5 w-52 bg-white border border-[#CBD5E1] shadow-lg rounded py-1 z-50 text-[12px]"
                onMouseLeave={closeMenu}
              >
                <button 
                  onClick={() => { onRecalculateAll(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{t.menu.recalculateAll}</span>
                </button>
              </div>
            )}
          </div>

          {/* View Menu */}
          <div className="relative">
            <button
              onClick={() => toggleMenu('view')}
              className={`px-2 py-0.5 rounded hover:bg-[#E2E8F0] ${activeMenu === 'view' ? 'bg-[#E2E8F0]' : ''}`}
            >
              {t.menu.view}
            </button>
            {activeMenu === 'view' && (
              <div 
                className="absolute top-full mt-0.5 w-48 bg-white border border-[#CBD5E1] shadow-lg rounded py-1 z-50 text-[12px]"
                onMouseLeave={closeMenu}
              >
                <button 
                  onClick={() => { onOpenPlannedOrdersModal(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>{t.tabs.orders}</span>
                </button>
                <button 
                  onClick={() => { onOpenDrpModal(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <Network className="w-3.5 h-3.5" />
                  <span>{t.tabs.dc}</span>
                </button>
                <button 
                  onClick={() => { onOpenBomModal(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{t.tabs.bom}</span>
                </button>
                <button 
                  onClick={() => { onOpenAbcModal(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center gap-2"
                >
                  <Grid className="w-3.5 h-3.5" />
                  <span>{t.tabs.abc}</span>
                </button>
              </div>
            )}
          </div>

          {/* Help Menu */}
          <div className="relative">
            <button
              onClick={() => toggleMenu('help')}
              className={`px-2 py-0.5 rounded hover:bg-[#E2E8F0] ${activeMenu === 'help' ? 'bg-[#E2E8F0]' : ''}`}
            >
              {t.menu.help}
            </button>
            {activeMenu === 'help' && (
              <div 
                className="absolute top-full mt-0.5 w-48 bg-white border border-[#CBD5E1] shadow-lg rounded py-1 z-50 text-[12px]"
                onMouseLeave={closeMenu}
              >
                <button
                  onClick={() => {
                    setIsAboutModalOpen(true);
                    closeMenu();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2196F3] hover:text-white flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-3.5 h-3.5" />
                    <span>{t.menu.about}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">v2.0</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right / End: Active Project Indicator */}
        <div className="flex items-center gap-2 text-[11px] text-slate-600 font-medium truncate max-w-md">
          <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{activeDataset}</span>
        </div>
      </div>

      {/* 2. Global Desktop Icon Action Toolbar */}
      <div className="flex items-center justify-between px-3 h-10 bg-[#F8F9FA]">
        <div className="flex items-center gap-1">
          {/* New */}
          <button
            onClick={onNewProject}
            title={t.menu.newProject}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <FilePlus className="w-4 h-4 text-[#2196F3]" />
            <span>{isAr ? 'جديد' : 'New'}</span>
          </button>

          {/* Open... */}
          <button
            onClick={onOpenProject}
            title={t.menu.openProject}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>{isAr ? 'فتح...' : 'Open...'}</span>
          </button>

          {/* Save */}
          <button
            onClick={onSaveProject}
            title={t.menu.saveProject}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <Save className="w-4 h-4 text-emerald-600" />
            <span>{isAr ? 'حفظ' : 'Save'}</span>
          </button>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Update data */}
          <button
            onClick={() => {
              if (onOpenDataHub) {
                onOpenDataHub();
              } else {
                onRecalculateAll();
              }
            }}
            title={t.menu.updateData}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition group cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-sky-600 group-hover:rotate-180 transition-transform duration-500" />
            <span>{isAr ? 'تحديث وتغذية البيانات' : 'Update & Feed Data'}</span>
          </button>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Planned Orders quick trigger */}
          <button
            onClick={onOpenPlannedOrdersModal}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <ShoppingCart className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.tabs.orders}</span>
          </button>

          {/* DRP quick trigger */}
          <button
            onClick={onOpenDrpModal}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <Network className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.tabs.dc}</span>
          </button>

          {/* BOM quick trigger */}
          <button
            onClick={onOpenBomModal}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.tabs.bom}</span>
          </button>

          {/* ABC Matrix quick trigger */}
          <button
            onClick={onOpenAbcModal}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#E2E8F0] rounded border border-transparent hover:border-[#CBD5E1] transition"
          >
            <Grid className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.tabs.abc}</span>
          </button>
        </div>

        {/* Right-aligned: Connect to Server / DB status button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSqlServerModal}
            className={`flex items-center gap-2 px-3 py-1 rounded border text-[11px] font-semibold transition ${
              isServerConnected
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                : 'bg-white border-[#CBD5E1] text-slate-700 hover:bg-[#E2E8F0]'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isServerConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <Server className="w-3.5 h-3.5 text-slate-600" />
            <span>
              {isServerConnected ? t.menu.serverConnected : t.menu.serverDisconnected}
            </span>
          </button>
        </div>
      </div>

      {/* About Modal */}
      {isAboutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-md w-full overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
            <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center gap-2.5">
                <NexoLogo size="md" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {isAr ? 'نيكسو بلاتفورم لتخطيط سلاسل الإمداد' : 'NEXO Enterprise Planning Platform'}
                  </h3>
                  <span className="text-[10px] text-slate-500 font-mono">Version 2.0.0 (Native Desktop)</span>
                </div>
              </div>
              <button
                onClick={() => setIsAboutModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs bg-white">
              <p className="text-slate-600 leading-relaxed">
                {isAr
                  ? 'منظومة حاسوبية مكتبية متقدمة لتخطيط وتوقع الطلب وإدارة المخزون متعدد المواقع وحساب أمان التوريد بدقة متناهية.'
                  : 'Advanced standalone Windows desktop supply chain analytics platform for multi-echelon demand forecasting, inventory optimization, and automated replenishment.'}
              </p>

              <div className="p-3 bg-[#F8F9FA] rounded-md border border-[#E2E8F0] space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{isAr ? 'المحرك التحليلي' : 'Engine'}:</span>
                  <span className="font-semibold text-slate-800">DuckDB Columnar OLAP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{isAr ? 'واجهة سطح المكتب' : 'Desktop GUI'}:</span>
                  <span className="font-semibold text-slate-800">Microsoft WebView2 (pywebview)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{isAr ? 'الخادم المدمج' : 'Backend Server'}:</span>
                  <span className="font-semibold text-slate-800">FastAPI (Python 3.12)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{isAr ? 'المشروع النشط' : 'Active Dataset'}:</span>
                  <span className="font-mono text-[#2196F3] truncate max-w-[200px]">{activeDataset}</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 text-center pt-1">
                © 2026 NEXO Supply Chain Intelligence. All rights reserved.
              </div>
            </div>

            <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex justify-end">
              <button
                onClick={() => setIsAboutModalOpen(false)}
                className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs cursor-pointer"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
