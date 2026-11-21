import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TrendingUp, CheckCircle2, Upload } from 'lucide-react';
import { InventoryItem, ModelType, ReplenishmentStrategy, AppSettings, isAnalyzableItem } from './engine/types';
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
import { DEFAULT_APP_SETTINGS, formatCurrency, getCurrencySymbol, formatItemCode } from './utils/formatters';
import { NavigationRail, MainTabId } from './components/NavigationRail';
import { TopMenuBar } from './components/TopMenuBar';
import { UpdateBanner } from './components/UpdateBanner';
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
import { exportSheetsToExcel } from './utils/excelExport';

export const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<MainTabId>('start');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appVersion, setAppVersion] = useState<string>('');
  const [pythonVersion, setPythonVersion] = useState<string>('');

  // Projects & Active Dataset
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('proj_default_retail');
  const [activeDataset, setActiveDataset] = useState('Retail Inventory Planning Example monthly.xlsx');

  // Core Items State - Starts blank, loaded from active project in DuckDB
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [dormantCount, setDormantCount] = useState<number>(0);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [explainingItem, setExplainingItem] = useState<InventoryItem | null>(null);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals state
  const [isSqlServerModalOpen, setIsSqlServerModalOpen] = useState(false);
  const [isPlannedOrdersModalOpen, setIsPlannedOrdersModalOpen] = useState(false);
  const [isContainersModalOpen, setIsContainersModalOpen] = useState(false);
  const [isDrpModalOpen, setIsDrpModalOpen] = useState(false);
  const [isBomModalOpen, setIsBomModalOpen] = useState(false);
  const [isAbcModalOpen, setIsAbcModalOpen] = useState(false);

  // GitHub Auto-Updater check trigger
  const checkUpdateRef = useRef<(() => Promise<void>) | null>(null);
  const handleTriggerCheckUpdate = useCallback(() => {
    if (checkUpdateRef.current) {
      checkUpdateRef.current();
    }
  }, []);

  // Update HTML direction and language attribute
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Load project items from DuckDB backend
  const loadProject = useCallback(async (projectId: string) => {
    setIsSyncing(true);
    setItems([]);
    setSelectedItemId('');
    setDormantCount(0);
    try {
      try {
        await api.activateProject(projectId);
      } catch (actErr) {
        console.warn('activateProject notification:', actErr);
      }
      const ws = await api.getWorkspace(projectId);
      if (ws && ws.items && ws.items.length > 0) {
        const analyzable = ws.items.filter(isAnalyzableItem);
        setItems(analyzable.length > 0 ? analyzable : ws.items);
        setSelectedItemId(analyzable[0]?.id || ws.items[0].id);
        setActiveProjectId(projectId);
        setDormantCount(ws.dormant_count ?? ws.excluded_dormant_count ?? Math.max(0, ws.items.length - analyzable.length));
        if (ws.project) {
          setActiveDataset(ws.project.dataset_name || ws.project.name);
        }
        setIsServerConnected(true);
      } else {
        setActiveProjectId(projectId);
        if (ws?.project) {
          setActiveDataset(ws.project.dataset_name || ws.project.name);
        }
        setItems([]);
        setSelectedItemId('');
        setDormantCount(0);
        setIsServerConnected(true);
      }
    } catch (err) {
      console.warn('Backend unavailable, project workspace empty:', err);
      setActiveProjectId(projectId);
      setItems([]);
      setSelectedItemId('');
      setDormantCount(0);
      setIsServerConnected(false);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Fetch list of projects from DuckDB
  const refreshProjects = useCallback(async (): Promise<string | undefined> => {
    try {
      const res = await api.getProjects();
      const projs = res.projects || [];
      setProjects(projs);
      
      const targetPid = res.active_project_id || (projs.find(p => p.id === activeProjectId) ? activeProjectId : (projs[0]?.id || 'proj_default_retail'));
      if (targetPid && targetPid !== activeProjectId) {
        setActiveProjectId(targetPid);
      }
      const found = projs.find(p => p.id === targetPid);
      if (found) {
        setActiveDataset(found.dataset_name || found.name);
      }
      setIsServerConnected(true);
      return targetPid;
    } catch (err) {
      console.warn('Could not fetch projects list:', err);
      setIsServerConnected(false);
      return undefined;
    }
  }, [activeProjectId]);

  // Initial load
  useEffect(() => {
    const fetchLiveVersion = (retries = 3) => {
      api.checkHealth()
        .then(health => {
          const v = health?.current_version || health?.version;
          if (v) {
            setAppVersion(v.startsWith('v') ? v : `v${v}`);
          }
          if (health?.python_version) {
            setPythonVersion(health.python_version);
          }
        })
        .catch(err => {
          if (retries > 0) {
            setTimeout(() => fetchLiveVersion(retries - 1), 600);
          } else {
            console.warn('Could not load live version from /api/health:', err);
          }
        });
    };
    fetchLiveVersion();

    api.getSettings().then(saved => {
      if (saved) {
        setSettings(saved);
        if (saved.language && (saved.language === 'en' || saved.language === 'ar')) {
          setLanguage(saved.language);
        }
      }
    }).catch(err => console.warn('Could not load settings on startup:', err));

    refreshProjects().then((targetPid) => {
      const pidToLoad = targetPid || activeProjectId;
      if (pidToLoad) {
        loadProject(pidToLoad);
      }
    });
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
        api.updateItemParameters(activeProjectId, itemId, { approvalState: nextState }).catch(() => { });
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
  const handleExportExcel = async () => {
    try {
      await api.downloadExcelExport(activeProjectId, 'all', `${activeDataset.replace('.xlsx', '')}_Export.xlsx`);
    } catch {
      // Fallback client-side XLSX generation
      const invData = items.map(i => ({
        'Item Code': formatItemCode(i.code),
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
      await exportSheetsToExcel([{ name: 'Inventory Planning', rows: invData }], `${activeDataset.replace('.xlsx', '')}_Export.xlsx`);
    }
  };

  // Save Project and active workspace immediately to DuckDB with feedback toast
  const handleSaveProject = async () => {
    try {
      setIsSyncing(true);
      await api.saveProject(activeProjectId);
      await refreshProjects();
      setToastMessage({
        text: language === 'ar' ? 'تم حفظ مساحة العمل والمشروع بنجاح في DuckDB' : 'Project and workspace saved successfully to DuckDB',
        type: 'success'
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage({
        text: language === 'ar' ? `فشل حفظ المشروع: ${err.message || ''}` : `Failed to save project: ${err.message || ''}`,
        type: 'error'
      });
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSyncing(false);
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
      {/* 0. Top GitHub Auto-Update Notification Banner */}
      <UpdateBanner
        language={language}
        onRegisterCheck={fn => { checkUpdateRef.current = fn; }}
        appVersion={appVersion}
      />

      {/* 1. Top Desktop Menu Strip & Action Toolbar */}
      <TopMenuBar
        language={language}
        onLanguageChange={setLanguage}
        onNewProject={() => setActiveTab('start')}
        onOpenProject={() => setActiveTab('start')}
        onSaveProject={handleSaveProject}
        onExportExcel={handleExportExcel}
        onRecalculateAll={handleRecalculateAll}
        onOpenSettings={() => setActiveTab('settings')}
        onOpenDataHub={() => setActiveTab('data-hub')}
        onOpenSqlServerModal={() => setIsSqlServerModalOpen(true)}
        onOpenPlannedOrdersModal={() => setIsPlannedOrdersModalOpen(true)}
        onOpenDrpModal={() => setIsDrpModalOpen(true)}
        onOpenBomModal={() => setIsBomModalOpen(true)}
        onOpenAbcModal={() => setIsAbcModalOpen(true)}
        onCheckUpdate={handleTriggerCheckUpdate}
        activeDataset={activeDataset}
        isServerConnected={isServerConnected}
        appVersion={appVersion}
        pythonVersion={pythonVersion}
      />

      {/* 2. Main Workspace Body with Slim Navigation Rail */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Primary Vertical Navigation Rail (Dark Charcoal Slate #343D46, ~76px) */}
        <NavigationRail
          activeTab={activeTab}
          onTabChange={setActiveTab}
          language={language}
          appVersion={appVersion}
        />

        {/* Dynamic Canvas Views */}
        <main className="flex-1 flex overflow-hidden min-w-0 bg-white">
          {activeTab === 'start' && (
            <StartView
              language={language}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={async (projId, targetTab) => {
                await loadProject(projId);
                const p = projects.find(x => x.id === projId);
                if (p) setActiveDataset(p.dataset_name || p.name);
                setActiveTab(targetTab || 'demand');
              }}
              onRefreshProjects={refreshProjects}
              onLoadExample={handleLoadExample}
              appVersion={appVersion}
            />
          )}

          {activeTab === 'data-hub' && (
            <DataHubView
              projectId={activeProjectId}
              projectName={activeDataset}
              dormantCount={dormantCount}
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
                projectId={activeProjectId}
                selectedItem={selectedItem}
                onSelectItem={i => setSelectedItemId(i.id)}
                onModelChange={handleModelChange}
                onOverrideChange={handleOverrideChange}
                onExplainCalculation={i => setExplainingItem(i)}
                onParameterChange={handleItemParameterChange}
                onNavigateToDataHub={() => setActiveTab('data-hub')}
                settings={settings}
                language={language}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#F8F9FA] text-[#1E293B]">
                <div className="p-4 rounded-full bg-blue-50 text-[#2196F3] mb-4 shadow-xs">
                  <TrendingUp className="w-10 h-10 stroke-[1.5]" />
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-2 text-center">
                  {language === 'ar'
                    ? 'المشروع فارغ حالياً — لا توجد بيانات مرفوعة بعد'
                    : 'This project is currently empty — no data uploaded yet'}
                </h3>
                <p className="text-xs text-slate-500 mb-6 text-center max-w-md leading-relaxed">
                  {language === 'ar'
                    ? 'يرجى الانتقال إلى تغذية البيانات لرفع مبيعات الأصناف وتوليد نماذج التنبؤ.'
                    : 'Please navigate to Data Hub to upload SKU sales records and generate demand forecast models.'}
                </p>
                <button
                  onClick={() => setActiveTab('data-hub')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#2196F3] hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {language === 'ar' ? 'الذهاب إلى تغذية البيانات' : 'Go to Data Hub'}
                  </span>
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
              onNavigateToDataHub={() => setActiveTab('data-hub')}
              settings={settings}
              language={language}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              items={items}
              settings={settings}
              language={language}
              onNavigateToDataHub={() => setActiveTab('data-hub')}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              items={items}
              projectId={activeProjectId}
              settings={settings}
              language={language}
              onNavigateToDataHub={() => setActiveTab('data-hub')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onSaveSettings={handleSaveSettings}
              onResetSettings={handleResetSettings}
              onCheckUpdate={handleTriggerCheckUpdate}
              language={language}
              onLanguageChange={setLanguage}
              appVersion={appVersion}
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

      {/* Floating Notification Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 ${
            language === 'ar' ? 'left-6' : 'right-6'
          } z-50 px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 text-sm font-medium transition-all ${
            toastMessage.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
};

export default App;
