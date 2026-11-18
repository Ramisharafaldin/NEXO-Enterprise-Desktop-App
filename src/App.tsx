import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { InventoryItem, ModelType, ReplenishmentStrategy, AppSettings } from './engine/types';
import { getInitialInventoryItems } from './engine/sampleData';
import { 
  autoSelectModel, 
  fitConstantModel, 
  fitLinearTrendModel, 
  fitSeasonalModel, 
  fitIntermittentModel, 
  calculateItemReplenishment,
  classifyAbcXyz,
  mean 
} from './engine/math';
import { Language, translations } from './i18n/translations';
import { DEFAULT_APP_SETTINGS, formatCurrency, getCurrencySymbol } from './utils/formatters';
import { NavigationRail, MainTabId } from './components/NavigationRail';
import { TopMenuBar } from './components/TopMenuBar';
import { SqlServerModal } from './components/SqlServerModal';
import { PlannedOrdersModal } from './components/PlannedOrdersModal';
import { ContainersModal } from './components/ContainersModal';
import { DrpModal } from './components/DrpModal';
import { BomModal } from './components/BomModal';
import { AbcXyzModal } from './components/AbcXyzModal';
import { ExplainModal } from './components/ExplainModal';

import { StartView } from './views/StartView';
import { DemandView } from './views/DemandView';
import { InventoryView } from './views/InventoryView';
import { ReportsView } from './views/ReportsView';
import { DashboardView } from './views/DashboardView';
import { UserGuideView } from './views/UserGuideView';
import { SettingsView } from './views/SettingsView';
import { DataHubView } from './views/DataHubView';

import { api, ProjectSummary } from './api/client';
import * as XLSX from 'xlsx';

export const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<MainTabId>('start');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  
  // Projects & Active Dataset
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('proj_default_retail');
  const [activeDataset, setActiveDataset] = useState('Retail Inventory Planning Example monthly.xlsx');
  
  // Core Items State - Initialized immediately with standard benchmark data to prevent blank/null state
  const initialItems = useMemo(() => getInitialInventoryItems(), []);
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItems[0]?.id || '');
  const [explainingItem, setExplainingItem] = useState<InventoryItem | null>(null);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Modals state
  const [isSqlServerModalOpen, setIsSqlServerModalOpen] = useState(false);
  const [isPlannedOrdersModalOpen, setIsPlannedOrdersModalOpen] = useState(false);
  const [isContainersModalOpen, setIsContainersModalOpen] = useState(false);
  const [isDrpModalOpen, setIsDrpModalOpen] = useState(false);
  const [isBomModalOpen, setIsBomModalOpen] = useState(false);
  const [isAbcModalOpen, setIsAbcModalOpen] = useState(false);

  // Update HTML direction and language attribute
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Load project items from DuckDB backend or fallback to initial sample data
  const loadProject = useCallback(async (projectId: string) => {
    setIsSyncing(true);
    try {
      const ws = await api.getWorkspace(projectId);
      if (ws && ws.items && ws.items.length > 0) {
        setItems(ws.items);
        setSelectedItemId(ws.items[0].id);
        setActiveProjectId(projectId);
        if (ws.project) {
          setActiveDataset(ws.project.dataset_name || ws.project.name);
        }
        setIsServerConnected(true);
      } else {
        // Fallback to sample data if project has 0 items
        const initial = getInitialInventoryItems();
        setItems(initial);
        if (initial.length > 0) setSelectedItemId(initial[0].id);
      }
    } catch (err) {
      console.warn('Backend unavailable, loading local memory cache:', err);
      const initial = getInitialInventoryItems();
      setItems(initial);
      if (initial.length > 0) setSelectedItemId(initial[0].id);
      setIsServerConnected(false);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Fetch list of projects from DuckDB
  const refreshProjects = useCallback(async () => {
    try {
      const projs = await api.getProjects();
      setProjects(projs);
      if (projs.length > 0) {
        const found = projs.find(p => p.id === activeProjectId);
        if (!found) {
          setActiveProjectId(projs[0].id);
          setActiveDataset(projs[0].dataset_name || projs[0].name);
        } else {
          setActiveDataset(found.dataset_name || found.name);
        }
      }
      setIsServerConnected(true);
    } catch (err) {
      console.warn('Could not fetch projects list:', err);
      setIsServerConnected(false);
    }
  }, [activeProjectId]);

  // Initial load
  useEffect(() => {
    api.getSettings().then(saved => {
      if (saved) {
        setSettings(saved);
        if (saved.language && (saved.language === 'en' || saved.language === 'ar')) {
          setLanguage(saved.language);
        }
      }
    }).catch(err => console.warn('Could not load settings on startup:', err));

    refreshProjects();
    loadProject(activeProjectId);
  }, []);

  const selectedItem = items.find(i => i.id === selectedItemId) || items[0];

  // Recalculate item forecast and replenishment using the verified math engine
  const recalculateItem = (item: InventoryItem, newModel?: ModelType, newStrategy?: ReplenishmentStrategy): InventoryItem => {
    const modelToUse = newModel || item.modelType;
    const strategyToUse = newStrategy || item.replenishmentStrategy;

    const actuals = item.periods.filter(p => p.actual > 0).map(p => p.actual);
    const horizon = settings?.forecast_horizon_periods || 6;

    let res;
    if (modelToUse === 'constant') res = fitConstantModel(actuals, horizon);
    else if (modelToUse === 'linear') res = fitLinearTrendModel(actuals, horizon);
    else if (modelToUse === 'seasonal') res = fitSeasonalModel(actuals, horizon, 12);
    else if (modelToUse === 'intermittent') res = fitIntermittentModel(actuals, horizon);
    else if (modelToUse === 'zero') res = {
      modelType: 'zero' as ModelType,
      fitted: actuals.map(() => 0),
      forecast: Array(horizon).fill(0),
      confUpper: Array(horizon).fill(0),
      confLower: Array(horizon).fill(0),
      mape: 0,
      wmape: 0,
      accuracy: 100
    };
    else res = autoSelectModel(actuals, horizon);

    // Update periods with new forecast and preserve user overrides
    const updatedPeriods = item.periods.map((p, i) => {
      if (p.actual > 0) {
        return { ...p, model: res.fitted[i] !== undefined ? Math.round(res.fitted[i]) : p.actual };
      } else {
        const futureIdx = i - actuals.length;
        const baseForecast = Math.round(res.forecast[futureIdx] || 0);
        return {
          ...p,
          forecast: p.override !== undefined ? p.override : baseForecast,
          confUpper: Math.round(res.confUpper[futureIdx] || baseForecast * 1.2),
          confLower: Math.round(res.confLower[futureIdx] || baseForecast * 0.8),
        };
      }
    });

    const forecastVals = updatedPeriods.filter(p => p.forecast !== undefined).map(p => p.forecast!);
    const meanDaily = actuals.length > 0 ? (mean(actuals) / 30) : 1;

    const updatedBase: InventoryItem = {
      ...item,
      modelType: modelToUse,
      replenishmentStrategy: strategyToUse,
      fittedModelType: res.modelType,
      periods: updatedPeriods,
      meanDailyDemand: meanDaily,
      mape: res.mape,
      wmape: res.wmape,
      accuracy: res.accuracy,
    };

    const metrics = calculateItemReplenishment(updatedBase, forecastVals, 30);

    return {
      ...updatedBase,
      ...metrics,
    };
  };

  // Model selection change handler
  const handleModelChange = (itemId: string, newModel: ModelType) => {
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const updated = recalculateItem(item, newModel);
        // Persist to DuckDB in background
        api.updateItemParameters(activeProjectId, itemId, {
          modelType: newModel,
          safetyStock: updated.safetyStock,
          reorderPoint: updated.reorderPoint,
          orderNow: updated.orderNow,
          orderNowValue: updated.orderNowValue,
          daysOfSupply: updated.daysOfSupply,
          accuracy: updated.accuracy,
        }).catch(e => console.warn('Failed to persist model update:', e));
        return updated;
      }
      return item;
    }));
  };

  // Global replenishment strategy change handler
  const handleStrategyChange = (newStrategy: ReplenishmentStrategy) => {
    setItems(prev => prev.map(item => {
      const updated = recalculateItem(item, undefined, newStrategy);
      api.updateItemParameters(activeProjectId, item.id, {
        replenishmentStrategy: newStrategy,
        safetyStock: updated.safetyStock,
        reorderPoint: updated.reorderPoint,
        orderNow: updated.orderNow,
        orderNowValue: updated.orderNowValue,
        daysOfSupply: updated.daysOfSupply,
      }).catch(e => console.warn('Failed to persist strategy update:', e));
      return updated;
    }));
  };

  // Inline forecast override change handler
  const handleOverrideChange = (itemId: string, periodDate: string, val: number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const updatedPeriods = item.periods.map(p => 
        p.date === periodDate ? { ...p, override: val, forecast: val !== undefined ? val : p.forecast } : p
      );
      const forecastVals = updatedPeriods.filter(p => p.forecast !== undefined).map(p => p.forecast!);
      const metrics = calculateItemReplenishment({ ...item, periods: updatedPeriods }, forecastVals, 30);
      
      const updatedItem = {
        ...item,
        periods: updatedPeriods,
        ...metrics,
      };

      // Persist override to DuckDB
      api.savePeriodOverride(activeProjectId, itemId, periodDate, val)
        .catch(e => console.warn('Failed to persist override to DuckDB:', e));

      // Persist recalculated inventory metrics to DuckDB
      api.updateItemParameters(activeProjectId, itemId, {
        safetyStock: updatedItem.safetyStock,
        reorderPoint: updatedItem.reorderPoint,
        orderNow: updatedItem.orderNow,
        orderNowValue: updatedItem.orderNowValue,
        daysOfSupply: updatedItem.daysOfSupply,
      }).catch(e => console.warn('Failed to update metrics in DuckDB:', e));

      return updatedItem;
    }));
  };

  // Order Approval Handler
  const handleApproveOrder = (itemId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const nextState = item.approvalState === 'approved' ? 'unapproved' : 'approved';
        api.updateItemParameters(activeProjectId, itemId, { approvalState: nextState }).catch(() => {});
        return {
          ...item,
          approvalState: nextState,
        };
      }
      return item;
    }));
  };

  // Handler for item parameter changes (lead time, service level, strategy, batch/moq, etc.)
  const handleItemParameterChange = (itemId: string, updates: Partial<InventoryItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const mergedItem: InventoryItem = { ...item, ...updates };
        const forecastVals = mergedItem.periods.filter(p => p.forecast !== undefined).map(p => p.forecast!);
        const metrics = calculateItemReplenishment(mergedItem, forecastVals, 30);
        const fullyUpdated: InventoryItem = {
          ...mergedItem,
          ...metrics,
        };

        // Persist to DuckDB backend in background
        api.updateItemParameters(activeProjectId, itemId, {
          ...updates,
          safetyStock: fullyUpdated.safetyStock,
          reorderPoint: fullyUpdated.reorderPoint,
          orderNow: fullyUpdated.orderNow,
          orderNowValue: fullyUpdated.orderNowValue,
          daysOfSupply: fullyUpdated.daysOfSupply,
        }).catch(e => console.warn('Failed to persist item parameter updates:', e));

        return fullyUpdated;
      }
      return item;
    }));
  };

  // Recalculate all items trigger
  const handleRecalculateAll = () => {
    setItems(prev => prev.map(item => recalculateItem(item)));
    loadProject(activeProjectId);
  };

  // Export Project to Real Excel (Native Windows Save As in Desktop Mode)
  const handleSaveProject = async () => {
    try {
      await api.downloadExcelExport(activeProjectId, 'all', `${activeDataset.replace('.xlsx', '')}_Export.xlsx`);
    } catch {
      // Fallback client-side XLSX generation
      const wb = XLSX.utils.book_new();
      const invData = items.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'Category': i.category,
        'Location': i.location,
        'Supplier': i.supplier,
        'On Hand': i.onHand,
        'On Order': i.onOrder,
        'Lead Time (Days)': i.leadTimeDays,
        'Safety Stock': i.safetyStock,
        'Reorder Point': i.reorderPoint,
        'Order Now': i.orderNow,
        [`Order Value (${getCurrencySymbol(settings.currency_code, language)})`]: i.orderNowValue,
        'Purchase Price': i.purchasePrice,
        'Sales Price': i.salesPrice,
        'Days of Supply': i.daysOfSupply,
        'Forecast Accuracy (%)': i.accuracy?.toFixed(1),
      }));
      const wsInv = XLSX.utils.json_to_sheet(invData);
      XLSX.utils.book_append_sheet(wb, wsInv, 'Inventory Planning');
      XLSX.writeFile(wb, `${activeDataset.replace('.xlsx', '')}_Export.xlsx`);
    }
  };

  // Load example benchmarks with REAL DuckDB persistence
  const handleLoadExample = async (exampleKey: 'retail' | 'drp' | 'mrp' | 'multichannel' | 'weekly') => {
    const metaMap: Record<string, { name: string; file: string; desc: string; tab: MainTabId; filterFn: (i: InventoryItem) => boolean }> = {
      retail: {
        name: 'Retail Inventory Planning (Monthly)',
        file: 'Retail Inventory Planning Example monthly.xlsx',
        desc: 'Multi-SKU retail replenishment across 10 core items with seasonal Holt-Winters and ROP.',
        tab: 'demand',
        filterFn: () => true,
      },
      drp: {
        name: 'Two-Echelon Distribution Planning',
        file: 'Two-Echelon Distribution Planning.xlsx',
        desc: 'Two-echelon multi-facility distribution network consolidating store demands at Central DC.',
        tab: 'inventory',
        filterFn: (i) => !!i.dc || i.code.includes('E') || i.code.includes('W') || i.category.includes('Furniture'),
      },
      mrp: {
        name: 'Manufacturing MRP (BOM Explosion)',
        file: 'Manufacturing MRP Example.xlsx',
        desc: 'Multi-level BOM explosion from finished server chassis down to raw components with lead time offsets.',
        tab: 'inventory',
        filterFn: (i) => i.bomType === 'material' || i.bomType === 'finished' || i.code === '562156-01',
      },
      multichannel: {
        name: 'Multi-Channel Demand & Inventory Planning',
        file: 'Multi-Channel Demand.xlsx',
        desc: 'Omnichannel inventory distribution balancing retail branches, e-commerce, and wholesale pipelines.',
        tab: 'demand',
        filterFn: () => true,
      },
      weekly: {
        name: 'Weekly Fast Cycle Replenishment',
        file: 'Weekly Fast Cycle Replenishment.xlsx',
        desc: 'High-frequency weekly replenishment cycles for fast-moving consumer goods and food products.',
        tab: 'demand',
        filterFn: (i) => i.category.toLowerCase().includes('food') || i.category.toLowerCase().includes('fashion') || i.category.toLowerCase().includes('consumer'),
      },
    };

    const ex = metaMap[exampleKey] || metaMap.retail;

    // 1. Check if project already exists in DuckDB
    const existing = projects.find(p => p.dataset_name === ex.file || p.name === ex.name);
    if (existing) {
      await loadProject(existing.id);
      setActiveDataset(existing.dataset_name || existing.name);
      setActiveTab(ex.tab);
      return;
    }

    // 2. Otherwise create a persistent project in DuckDB
    setIsSyncing(true);
    try {
      const proj = await api.createProject(ex.name, ex.desc, ex.file);
      const initial = getInitialInventoryItems();
      const filtered = initial.filter(ex.filterFn);
      const itemsToSave = filtered.length > 0 ? filtered : initial;

      const itemsPayload = itemsToSave.map(i => ({
        code: i.code,
        description: i.description,
        category: i.category,
        location: i.location,
        channel: i.channel,
        supplier: i.supplier,
        sales_price: i.salesPrice,
        purchase_price: i.purchasePrice,
        on_hand: i.onHand,
        on_order: i.onOrder,
        lead_time_days: i.leadTimeDays,
        lead_time_variance_days: i.leadTimeVarianceDays,
        order_cycle_days: i.orderCycleDays,
        service_level: i.serviceLevel,
        min_batch: i.minBatch,
        batch_rounding: i.batchRounding,
        model_type: i.modelType,
        replenishment_strategy: i.replenishmentStrategy,
      }));

      const periodsPayload: any[] = [];
      itemsToSave.forEach(i => {
        (i.periods || []).forEach(p => {
          periodsPayload.push({
            code: i.code,
            date: p.date,
            actual: p.actual,
            forecast: p.forecast,
            override: p.override,
          });
        });
      });

      await api.bulkSaveItems(proj.id, itemsPayload, periodsPayload);
      await refreshProjects();
      await loadProject(proj.id);
      setActiveDataset(ex.file);
      setActiveTab(ex.tab);
    } catch (err) {
      console.warn('Fallback to memory cache for example:', err);
      const initial = getInitialInventoryItems();
      const filtered = initial.filter(ex.filterFn);
      setItems(filtered.length > 0 ? filtered : initial);
      setActiveDataset(ex.file);
      setActiveTab(ex.tab);
    } finally {
      setIsSyncing(false);
    }
  };

  // SQL Server ERP Connect & Ingestion Success Handler
  const handleSqlServerSuccess = (newProjectId: string) => {
    setIsServerConnected(true);
    refreshProjects();
    loadProject(newProjectId);
    setActiveTab('demand');
  };

  // Settings Save & Recalculate handler
  const handleSaveSettings = async (newSettings: AppSettings) => {
    const saved = await api.saveSettings(newSettings);
    setSettings(saved);
    if (saved.language && (saved.language === 'en' || saved.language === 'ar')) {
      setLanguage(saved.language);
    }
    // Reclassify and recalculate all items
    setItems(prev => {
      const reclassified = classifyAbcXyz(
        prev,
        saved.abc_a_cutoff,
        saved.abc_b_cutoff,
        saved.xyz_x_cv,
        saved.xyz_y_cv
      );
      return reclassified.map(item => recalculateItem(item));
    });
  };

  // Settings Reset handler
  const handleResetSettings = async () => {
    const saved = await api.saveSettings(DEFAULT_APP_SETTINGS);
    setSettings(saved);
    if (saved.language && (saved.language === 'en' || saved.language === 'ar')) {
      setLanguage(saved.language);
    }
    setItems(prev => {
      const reclassified = classifyAbcXyz(
        prev,
        DEFAULT_APP_SETTINGS.abc_a_cutoff,
        DEFAULT_APP_SETTINGS.abc_b_cutoff,
        DEFAULT_APP_SETTINGS.xyz_x_cv,
        DEFAULT_APP_SETTINGS.xyz_y_cv
      );
      return reclassified.map(item => recalculateItem(item));
    });
  };

  return (
    <div className={`h-screen w-screen flex flex-col bg-[#F8F9FA] text-[#1E293B] overflow-hidden ${language === 'ar' ? 'font-arabic' : 'font-sans'}`}>
      {/* 1. Top Desktop Menu Strip & Action Toolbar */}
      <TopMenuBar
        language={language}
        onLanguageChange={setLanguage}
        onNewProject={() => setActiveTab('start')}
        onOpenProject={() => setActiveTab('start')}
        onSaveProject={handleSaveProject}
        onRecalculateAll={handleRecalculateAll}
        onOpenSettings={() => setActiveTab('settings')}
        onOpenDataHub={() => setActiveTab('data-hub')}
        onOpenSqlServerModal={() => setIsSqlServerModalOpen(true)}
        onOpenPlannedOrdersModal={() => setIsPlannedOrdersModalOpen(true)}
        onOpenDrpModal={() => setIsDrpModalOpen(true)}
        onOpenBomModal={() => setIsBomModalOpen(true)}
        onOpenAbcModal={() => setIsAbcModalOpen(true)}
        activeDataset={activeDataset}
        isServerConnected={isServerConnected}
      />

      {/* 2. Main Workspace Body with Slim Navigation Rail */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Primary Vertical Navigation Rail (Dark Charcoal Slate #343D46, ~76px) */}
        <NavigationRail
          activeTab={activeTab}
          onTabChange={setActiveTab}
          language={language}
        />

        {/* Dynamic Canvas Views */}
        <main className="flex-1 flex overflow-hidden min-w-0 bg-white">
          {activeTab === 'start' && (
            <StartView
              language={language}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={async (projId) => {
                await loadProject(projId);
                const p = projects.find(x => x.id === projId);
                if (p) setActiveDataset(p.dataset_name || p.name);
                setActiveTab('demand');
              }}
              onRefreshProjects={refreshProjects}
              onLoadExample={handleLoadExample}
            />
          )}

          {activeTab === 'data-hub' && (
            <DataHubView
              projectId={activeProjectId}
              projectName={activeDataset}
              onRefreshProject={() => {
                refreshProjects();
                loadProject(activeProjectId);
              }}
              language={language}
            />
          )}

          {activeTab === 'demand' && (
            selectedItem ? (
              <DemandView
                items={items}
                selectedItem={selectedItem}
                onSelectItem={i => setSelectedItemId(i.id)}
                onModelChange={handleModelChange}
                onOverrideChange={handleOverrideChange}
                onExplainCalculation={i => setExplainingItem(i)}
                onParameterChange={handleItemParameterChange}
                settings={settings}
                language={language}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#F8F9FA] text-[#1E293B]">
                <div className="p-4 rounded-full bg-blue-50 text-[#2196F3] mb-4">
                  <TrendingUp className="w-10 h-10 animate-pulse" />
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-1">
                  {language === 'ar' ? 'جاري تحميل بيانات التنبؤ والطلب...' : 'Loading Demand Forecast Data...'}
                </h3>
                <p className="text-xs text-slate-500 mb-4 text-center max-w-md">
                  {language === 'ar'
                    ? 'يتم استرداد مصفوفة الأصناف وحركات المبيعات من قاعدة بيانات DuckDB...'
                    : 'Retrieving SKU inventory time series and forecasts from DuckDB...'}
                </p>
                <button
                  onClick={() => {
                    const initial = getInitialInventoryItems();
                    setItems(initial);
                    if (initial.length > 0) setSelectedItemId(initial[0].id);
                  }}
                  className="px-4 py-2 bg-[#2196F3] hover:bg-blue-600 text-white text-xs font-semibold rounded transition shadow-xs cursor-pointer"
                >
                  {language === 'ar' ? 'تحميل بيانات النموذج الافتراضي' : 'Load Default Benchmark Data'}
                </button>
              </div>
            )
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              items={items}
              projectId={activeProjectId}
              onStrategyChange={handleStrategyChange}
              onExplainItem={i => setExplainingItem(i)}
              onOpenPlannedOrdersModal={() => setIsPlannedOrdersModalOpen(true)}
              onOpenContainersModal={() => setIsContainersModalOpen(true)}
              onOpenDrpModal={() => setIsDrpModalOpen(true)}
              settings={settings}
              language={language}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              items={items}
              settings={settings}
              language={language}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              items={items}
              settings={settings}
              language={language}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onSaveSettings={handleSaveSettings}
              onResetSettings={handleResetSettings}
              language={language}
              onLanguageChange={setLanguage}
            />
          )}

          {activeTab === 'guide' && (
            <UserGuideView
              language={language}
            />
          )}
        </main>
      </div>

      {/* Microsoft SQL Server ERP Integration Modal */}
      <SqlServerModal
        isOpen={isSqlServerModalOpen}
        onClose={() => setIsSqlServerModalOpen(false)}
        onConnectSuccess={handleSqlServerSuccess}
        language={language}
      />

      {/* Planned Orders Drawer Modal */}
      <PlannedOrdersModal
        isOpen={isPlannedOrdersModalOpen}
        onClose={() => setIsPlannedOrdersModalOpen(false)}
        items={items}
        onApproveOrder={handleApproveOrder}
        settings={settings}
        language={language}
      />

      {/* Containers and Shipping Groups Modal */}
      <ContainersModal
        isOpen={isContainersModalOpen}
        onClose={() => setIsContainersModalOpen(false)}
        items={items}
        language={language}
      />

      {/* Multi-Echelon DRP Transfer Balancing Modal */}
      <DrpModal
        isOpen={isDrpModalOpen}
        onClose={() => setIsDrpModalOpen(false)}
        items={items}
        language={language}
      />

      {/* Bill of Materials (BOM) Explosion Modal */}
      <BomModal
        isOpen={isBomModalOpen}
        onClose={() => setIsBomModalOpen(false)}
        items={items}
        language={language}
      />

      {/* ABC / XYZ Classification Matrix Modal */}
      <AbcXyzModal
        isOpen={isAbcModalOpen}
        onClose={() => setIsAbcModalOpen(false)}
        items={items}
        settings={settings}
        language={language}
      />

      {/* Mathematical Calculation Explain Drawer Modal */}
      <ExplainModal
        item={explainingItem}
        onClose={() => setExplainingItem(null)}
        settings={settings}
        language={language}
      />
    </div>
  );
};

export default App;
