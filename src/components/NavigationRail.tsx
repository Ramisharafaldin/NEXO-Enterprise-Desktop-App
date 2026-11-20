import React from 'react';
import { 
  Home, 
  TrendingUp, 
  Package, 
  FileSpreadsheet, 
  LayoutDashboard, 
  BookOpen,
  Settings,
  Database
} from 'lucide-react';
import { translations, Language } from '../i18n/translations';
import { NexoLogo } from './NexoLogo';

export type MainTabId = 'start' | 'data-hub' | 'demand' | 'inventory' | 'reports' | 'dashboard' | 'guide' | 'settings';

interface NavigationRailProps {
  activeTab: MainTabId;
  onTabChange: (tab: MainTabId) => void;
  language: Language;
  appVersion?: string;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  activeTab,
  onTabChange,
  language,
  appVersion,
}) => {
  const t = translations[language];

  const topItems: { id: MainTabId; label: string; icon: React.ElementType }[] = [
    {
      id: 'start',
      label: t.tabs.start,
      icon: Home,
    },
    {
      id: 'data-hub',
      label: (t.tabs as any).dataHub || (language === 'ar' ? 'تغذية البيانات' : 'Data Hub'),
      icon: Database,
    },
    {
      id: 'demand',
      label: t.tabs.demand,
      icon: TrendingUp,
    },
    {
      id: 'inventory',
      label: t.tabs.inventory,
      icon: Package,
    },
    {
      id: 'reports',
      label: t.tabs.reports,
      icon: FileSpreadsheet,
    },
    {
      id: 'dashboard',
      label: t.tabs.dashboard,
      icon: LayoutDashboard,
    },
  ];

  return (
    <aside 
      className="w-[76px] flex-none bg-[#343D46] select-none flex flex-col justify-between py-2 border-r border-[#2A3138] z-20"
      style={{ minHeight: '100%' }}
    >
      <div className="flex flex-col gap-2">
        {/* Top: Sleek NEXO "N" Brand Emblem Badge */}
        <div className="flex flex-col items-center justify-center py-2 px-1 border-b border-[#3F4954]/50">
          <button
            onClick={() => onTabChange('start')}
            title="NEXO Enterprise Planning"
            className="hover:scale-105 transition-transform"
          >
            <NexoLogo size="md" />
          </button>
        </div>

        {/* Top 5 Main Modules */}
        <div className="flex flex-col gap-1 px-1.5">
          {topItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                title={item.label}
                className={`w-full py-2.5 px-1 rounded flex flex-col items-center justify-center gap-1 transition-all ${
                  isActive
                    ? 'bg-[#2196F3] text-white shadow-sm font-semibold'
                    : 'text-[#CBD5E1] hover:bg-[#3F4954] hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="text-[11px] leading-tight text-center tracking-tight truncate max-w-full">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Anchored Bottom Modules: Settings & User Guide */}
      <div className="px-1.5 pt-2 border-t border-[#3F4954]/60 flex flex-col gap-1">
        <button
          onClick={() => onTabChange('settings')}
          title={t.tabs.settings}
          className={`w-full py-2.5 px-1 rounded flex flex-col items-center justify-center gap-1 transition-all ${
            activeTab === 'settings'
              ? 'bg-[#2196F3] text-white shadow-sm font-semibold'
              : 'text-[#CBD5E1] hover:bg-[#3F4954] hover:text-white'
          }`}
        >
          <Settings className="w-5 h-5 shrink-0" strokeWidth={activeTab === 'settings' ? 2.2 : 1.8} />
          <span className="text-[10px] leading-tight text-center tracking-tight truncate max-w-full">
            {t.tabs.settings}
          </span>
        </button>

        <button
          onClick={() => onTabChange('guide')}
          title={t.tabs.guide}
          className={`w-full py-2.5 px-1 rounded flex flex-col items-center justify-center gap-1 transition-all ${
            activeTab === 'guide'
              ? 'bg-[#2196F3] text-white shadow-sm font-semibold'
              : 'text-[#CBD5E1] hover:bg-[#3F4954] hover:text-white'
          }`}
        >
          <BookOpen className="w-5 h-5 shrink-0" strokeWidth={activeTab === 'guide' ? 2.2 : 1.8} />
          <span className="text-[10px] leading-tight text-center tracking-tight truncate max-w-full">
            {t.tabs.guide}
          </span>
        </button>

        {/* Semantic Version Badge */}
        <div className="pt-2 pb-1 text-center select-none border-t border-[#3F4954]/40 mt-1">
          <span className="text-[10px] font-mono text-slate-400 font-semibold tracking-wider px-1.5 py-0.5 rounded bg-[#2D353F]">
            {appVersion || 'v0.1.0'}
          </span>
        </div>
      </div>
    </aside>
  );
};
