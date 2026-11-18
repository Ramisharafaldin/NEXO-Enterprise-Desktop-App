import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { api, DashboardKpis, DashboardSummaryResponse } from '../api/client';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  AlertTriangle, 
  Package, 
  RefreshCw, 
  CheckCircle2, 
  Clock,
  Layers,
  SlidersHorizontal,
  ChevronDown,
  Check
} from 'lucide-react';

interface DashboardViewProps {
  items: InventoryItem[];
  settings?: AppSettings;
  language: Language;
  projectId?: string;
  onRefresh?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  items,
  settings,
  language,
  projectId,
  onRefresh,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';
  const currSymbol = getCurrencySymbol(settings?.currency_code || 'EGP', language);

  const [dbKpis, setDbKpis] = useState<DashboardKpis | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTilesMenu, setShowTilesMenu] = useState(false);

  // Available periods from items
  const allPeriodDates = Array.from(
    new Set(items.flatMap(i => (i.periods || []).map(p => p.date)))
  ).sort();
  const defaultPeriod = allPeriodDates.length > 0 ? allPeriodDates[0] : 'Nov-2026';
  const [startPeriod, setStartPeriod] = useState(defaultPeriod);

  // Customizable tile visibility with localStorage persistence
  const [visibleTiles, setVisibleTiles] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('nexo_dashboard_visible_tiles');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      inventoryValue: true,
      ordersToPlace: true,
      forecastAccuracy: true,
      stockoutAlert: true,
      overstock: true,
      expirations: true,
      turnover: true,
      categoryChart: true,
      abcChart: true,
    };
  });

  const toggleTile = (key: string) => {
    setVisibleTiles(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('nexo_dashboard_visible_tiles', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Fetch real KPIs & pre-aggregated summary from DuckDB backend
  const fetchKpis = async () => {
    if (!projectId) return;
    setIsRefreshing(true);
    try {
      const summary = await api.getDashboard(projectId);
      setDashboardSummary(summary);
      if (summary.kpis) {
        setDbKpis(summary.kpis);
      }
    } catch (e) {
      console.warn('Dashboard: Failed to load backend summary, falling back to local calculation', e);
      try {
        const res = await api.getKpis(projectId);
        setDbKpis(res);
      } catch (err) {}
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchKpis();
  }, [projectId]);

  const handleRefreshClick = async () => {
    await fetchKpis();
    if (onRefresh) onRefresh();
  };

  // Strict Defensive Exclusion: Filter out any dormant SKUs (onHand <= 0 && totalSales <= 0)
  const activeItems = useMemo(() => (items || []).filter(isAnalyzableItem), [items]);

  // Aggregated KPIs (DuckDB backend prioritised, fallback to local item computations)
  const totalInventoryValue = dashboardSummary?.kpis?.totalInventoryValue ?? dbKpis?.totalInventoryValue ?? activeItems.reduce((sum, i) => sum + (i.inventoryValue || (i.onHand * i.salesPrice) || 0), 0);
  const totalOrdersToPlaceValue = dashboardSummary?.total_orders_value ?? activeItems.reduce((sum, i) => sum + (i.orderNowValue || 0), 0);
  const totalOrdersToPlaceUnits = dashboardSummary?.total_orders_units ?? activeItems.reduce((sum, i) => sum + (i.orderNow || 0), 0);
  const stockoutCount = dashboardSummary?.stockout_count ?? activeItems.filter(i => i.isStockout || i.onHand <= 0).length;
  const overstockCount = dashboardSummary?.overstock_count ?? activeItems.filter(i => i.isOverstock).length;
  const totalOverstockValue = dashboardSummary?.total_overstock_value ?? dbKpis?.totalOverstockValue ?? activeItems.reduce((sum, i) => sum + (i.overstockValue || 0), 0);
  const totalWriteOffValue = dashboardSummary?.total_write_off_value ?? activeItems.reduce((sum, i) => sum + (i.expectedWriteOffValue || 0), 0);
  const avgWmape = activeItems.length > 0 ? (activeItems.reduce((sum, i) => sum + (i.wmape || 0), 0) / activeItems.length) : 0;
  const avgAccuracy = dashboardSummary?.kpis?.overallForecastAccuracy ?? dbKpis?.overallForecastAccuracy ?? (100 - avgWmape);
  const avgTurnover = dashboardSummary?.kpis?.inventoryTurns ?? dbKpis?.inventoryTurns ?? (activeItems.length > 0 ? (activeItems.reduce((sum, i) => sum + (i.turnoverRatio || 0), 0) / activeItems.length) : 0);
  const totalActiveSkus = dashboardSummary?.active_skus ?? activeItems.length;

  const uniqueLocations = Array.from(new Set(activeItems.map(i => i.location || (isAr ? 'المركز الرئيسي' : 'Main Hub'))));
  const locationCount = uniqueLocations.length || 1;

  // Real ABC Revenue Breakdown from actual item inventory values
  const classAItems = activeItems.filter(i => (i.abcClass || 'C').toUpperCase() === 'A');
  const classBItems = activeItems.filter(i => (i.abcClass || 'C').toUpperCase() === 'B');
  const classCItems = activeItems.filter(i => (i.abcClass || 'C').toUpperCase() === 'C');

  const classAVal = classAItems.reduce((sum, i) => sum + (i.inventoryValue || (i.onHand * i.salesPrice) || 0), 0);
  const classBVal = classBItems.reduce((sum, i) => sum + (i.inventoryValue || (i.onHand * i.salesPrice) || 0), 0);
  const classCVal = classCItems.reduce((sum, i) => sum + (i.inventoryValue || (i.onHand * i.salesPrice) || 0), 0);
  const localAbcSum = classAVal + classBVal + classCVal;

  const localAbcData = [
    { 
      name: isAr ? `فئة A (${classAItems.length} صنف / ${localAbcSum > 0 ? Math.round((classAVal / localAbcSum) * 100) : 0}%)` : `Class A (${classAItems.length} SKUs / ${localAbcSum > 0 ? Math.round((classAVal / localAbcSum) * 100) : 0}%)`, 
      value: Math.round(classAVal), 
      color: '#10B981' 
    },
    { 
      name: isAr ? `فئة B (${classBItems.length} صنف / ${localAbcSum > 0 ? Math.round((classBVal / localAbcSum) * 100) : 0}%)` : `Class B (${classBItems.length} SKUs / ${localAbcSum > 0 ? Math.round((classBVal / localAbcSum) * 100) : 0}%)`, 
      value: Math.round(classBVal), 
      color: '#2196F3' 
    },
    { 
      name: isAr ? `فئة C (${classCItems.length} صنف / ${localAbcSum > 0 ? Math.round((classCVal / localAbcSum) * 100) : 0}%)` : `Class C (${classCItems.length} SKUs / ${localAbcSum > 0 ? Math.round((classCVal / localAbcSum) * 100) : 0}%)`, 
      value: Math.round(classCVal), 
      color: '#94A3B8' 
    },
  ];

  const finalAbcData = useMemo(() => {
    if (dashboardSummary?.abc_data && dashboardSummary.abc_data.length > 0) {
      return dashboardSummary.abc_data.map(d => ({
        name: isAr ? (d.name_ar || d.name) : d.name,
        value: d.value,
        color: d.color
      }));
    }
    return localAbcData;
  }, [dashboardSummary, localAbcData, isAr]);

  const abcSum = useMemo(() => {
    return finalAbcData.reduce((sum, d) => sum + d.value, 0);
  }, [finalAbcData]);

  // Chart data: Orders by Category
  const categoryOrderMap: Record<string, number> = {};
  activeItems.forEach(i => {
    const cat = i.category || (isAr ? 'عام' : 'General');
    if ((i.orderNowValue || 0) > 0) {
      categoryOrderMap[cat] = (categoryOrderMap[cat] || 0) + (i.orderNowValue || 0);
    }
  });
  const localCategoryOrdersData = Object.entries(categoryOrderMap).map(([name, value]) => ({ 
    name, 
    value: Math.round(value) 
  }));

  const finalCategoryOrdersData = useMemo(() => {
    if (dashboardSummary?.category_orders && dashboardSummary.category_orders.length > 0) {
      return dashboardSummary.category_orders;
    }
    return localCategoryOrdersData;
  }, [dashboardSummary, localCategoryOrdersData]);

  const tileLabels: Record<string, string> = {
    inventoryValue: t.dashboard.cards.inventoryValue,
    ordersToPlace: t.dashboard.cards.ordersToPlace,
    forecastAccuracy: t.dashboard.cards.forecastAccuracy,
    stockoutAlert: t.dashboard.cards.stockoutAlert,
    overstock: t.dashboard.cards.overstockCapital,
    expirations: t.dashboard.cards.expirations,
    turnover: t.dashboard.cards.turnoverRatio,
    categoryChart: isAr ? 'رسم أوامر الشراء حسب المجموعة' : 'Category Orders Chart',
    abcChart: t.dashboard.cards.abcDistribution,
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8F9FA] select-none text-[#1E293B] text-[12px]">
      {/* 1. Top Filter Bar */}
      <div className="flex items-center justify-between px-4 h-10 bg-white border-b border-[#D1D5DB] shrink-0 text-[11px] font-medium text-slate-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">{t.dashboard.filterBar.startFrom}</span>
            <select
              value={startPeriod}
              onChange={e => setStartPeriod(e.target.value)}
              className="px-2.5 py-1 border border-[#CBD5E1] rounded text-[11px] font-semibold text-slate-800 bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
            >
              {allPeriodDates.length > 0 ? (
                allPeriodDates.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))
              ) : (
                <>
                  <option value="Nov-2026">Current Planning Cycle: Nov-2026</option>
                  <option value="Dec-2026">Next Cycle: Dec-2026</option>
                  <option value="Jan-2027">Quarter Q1: Jan-2027</option>
                </>
              )}
            </select>
          </div>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Tiles Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowTilesMenu(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#F1F5F9] hover:bg-[#E2E8F0] rounded border border-[#CBD5E1] text-slate-700 font-semibold cursor-pointer transition"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>{t.dashboard.filterBar.tilesSelected}</span>
              <span className="text-[10px] px-1 rounded-full bg-slate-200 text-slate-700">
                {Object.values(visibleTiles).filter(Boolean).length}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showTilesMenu && (
              <div 
                className="absolute top-full mt-1 w-64 bg-white border border-[#CBD5E1] shadow-xl rounded-lg py-2 z-50 text-[11px]"
                onMouseLeave={() => setShowTilesMenu(false)}
              >
                <div className="px-3 py-1 text-xs font-bold text-slate-800 border-b border-[#E2E8F0] mb-1">
                  {isAr ? 'تخصيص البطاقات المعروضة' : 'Customize Dashboard Cards'}
                </div>
                <div className="max-h-60 overflow-y-auto px-2 space-y-1">
                  {Object.entries(tileLabels).map(([key, label]) => (
                    <label 
                      key={key} 
                      className="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-slate-700 font-medium"
                    >
                      <span>{label}</span>
                      <input 
                        type="checkbox" 
                        checked={visibleTiles[key] !== false} 
                        onChange={() => toggleTile(key)}
                        className="rounded text-[#2196F3] focus:ring-0 cursor-pointer"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Refresh KPIs */}
        <div>
          <button 
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-[#CBD5E1] hover:bg-[#E2E8F0] text-slate-700 font-semibold rounded text-[11px] shadow-xs cursor-pointer disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#2196F3] ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? (isAr ? 'جاري التحديث...' : 'Refreshing...') : t.dashboard.filterBar.refresh}</span>
          </button>
        </div>
      </div>

      {/* 2. Modular White KPI Tile Grid */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Row 1: Primary Financial & Operational KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Inventory Value */}
          {visibleTiles.inventoryValue !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">
                  {t.dashboard.cards.inventoryValue}
                </span>
                <div className="p-1.5 bg-blue-50 text-[#2196F3] rounded">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-slate-900 font-mono">
                  {formatCurrency(totalInventoryValue, settings, language)}
                </span>
                <div className="text-[12px] text-slate-500 mt-1 flex items-center gap-1.5">
                  <span className="font-semibold text-slate-700">{totalActiveSkus} {isAr ? 'صنف' : 'SKUs'}</span> 
                  <span>{isAr ? `عبر ${locationCount} موقع توزيع` : `across ${locationCount} distribution locations`}</span>
                </div>
              </div>
            </div>
          )}

          {/* Card 2: Planned Orders */}
          {visibleTiles.ordersToPlace !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">
                  {t.dashboard.cards.ordersToPlace}
                </span>
                <div className="p-1.5 bg-amber-50 text-amber-600 rounded">
                  <ShoppingCart className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-amber-600 font-mono">
                  {formatCurrency(totalOrdersToPlaceValue, settings, language)}
                </span>
                <div className="text-[12px] text-slate-500 mt-1 flex items-center gap-1.5">
                  <strong className="text-amber-800 font-mono">{totalOrdersToPlaceUnits.toLocaleString()} units</strong>
                  <span>{isAr ? 'مطلوب طلبها الآن' : 'to order now'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Card 3: Forecast Accuracy */}
          {visibleTiles.forecastAccuracy !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">
                  {t.dashboard.cards.forecastAccuracy}
                </span>
                <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-emerald-600 font-mono">
                  {avgAccuracy.toFixed(1)}%
                </span>
                <div className="text-[12px] text-slate-500 mt-1 flex items-center gap-1.5">
                  <span>Average WMAPE:</span>
                  <strong className="text-slate-700 font-mono">{avgWmape.toFixed(1)}%</strong>
                </div>
              </div>
            </div>
          )}

          {/* Card 4: Stockout Alert */}
          {visibleTiles.stockoutAlert !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">
                  {t.dashboard.cards.stockoutAlert}
                </span>
                <div className="p-1.5 bg-rose-50 text-rose-600 rounded">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-rose-600 font-mono">
                  {stockoutCount} {isAr ? 'صنف' : 'SKUs'}
                </span>
                <div className="text-[12px] text-rose-700 mt-1 font-semibold">
                  {stockoutCount > 0 
                    ? (isAr ? 'يلزم توريد عاجل لمنع النفاذ' : 'Critical replenishment required')
                    : (isAr ? 'مستويات الأمان مكتملة' : 'Safety stock levels fully met')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Row 2: Secondary Risk & Turnover Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {visibleTiles.overstock !== false && (
            <div className="p-3.5 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[12px] font-bold text-slate-500 uppercase">
                  {t.dashboard.cards.overstockCapital}
                </span>
                <div className="text-lg font-bold text-amber-700 font-mono mt-0.5">
                  {formatCurrency(totalOverstockValue, settings, language)}
                </div>
                <span className="text-[11.5px] text-slate-500">
                  {overstockCount} {isAr ? 'أصناف تتجاوز الحد الأقصى' : 'items over max target'}
                </span>
              </div>
              <Package className="w-8 h-8 text-amber-200" />
            </div>
          )}

          {visibleTiles.expirations !== false && (
            <div className="p-3.5 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[12px] font-bold text-slate-500 uppercase">
                  {t.dashboard.cards.expirations}
                </span>
                <div className="text-lg font-bold text-slate-700 font-mono mt-0.5">
                  {formatCurrency(totalWriteOffValue, settings, language)}
                </div>
                <span className="text-[11.5px] text-slate-500">
                  {isAr ? 'حماية تواريخ الصلاحية نشطة' : 'Shelf life expiration protection active'}
                </span>
              </div>
              <Clock className="w-8 h-8 text-slate-200" />
            </div>
          )}

          {visibleTiles.turnover !== false && (
            <div className="p-3.5 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[12px] font-bold text-slate-500 uppercase">
                  {t.dashboard.cards.turnoverRatio}
                </span>
                <div className="text-lg font-bold text-emerald-700 font-mono mt-0.5">
                  {avgTurnover.toFixed(1)}x / {isAr ? 'سنة' : 'year'}
                </div>
                <span className="text-[11.5px] text-slate-500">
                  {isAr ? 'معدل دوران رأس المال العامل' : 'Healthy capital velocity'}
                </span>
              </div>
              <Layers className="w-8 h-8 text-emerald-200" />
            </div>
          )}
        </div>

        {/* Row 3: Visual Analytics Canvas (Charts) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: Planned Order Capital Allocation by Category */}
          {visibleTiles.categoryChart !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col h-[280px]">
              <h3 className="text-xs font-bold text-slate-800 mb-2">
                {isAr ? `توزيع ميزانية أوامر الشراء المقترحة حسب المجموعة (${currSymbol})` : `Planned Purchase Order Capital by Category (${currSymbol})`}
              </h3>
              <div className="flex-1 w-full min-h-0">
                {finalCategoryOrdersData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={finalCategoryOrdersData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid stroke="#F1F5F9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} stroke="#CBD5E1" />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} stroke="#CBD5E1" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#FFFFFF', 
                          borderColor: '#CBD5E1', 
                          borderRadius: 6,
                          fontSize: 11,
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }} 
                      />
                      <Bar dataKey="value" fill="#2196F3" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                    {isAr ? 'لا توجد أوامر شراء مقترحة حالياً' : 'No planned purchase orders at this time'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chart 2: ABC Inventory Revenue Contribution */}
          {visibleTiles.abcChart !== false && (
            <div className="p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs flex flex-col h-[280px]">
              <h3 className="text-xs font-bold text-slate-800 mb-2">
                {t.dashboard.cards.abcDistribution}
              </h3>
              <div className="flex-1 w-full min-h-0 flex items-center justify-center">
                {abcSum > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={finalAbcData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={3}
                        >
                          {finalAbcData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#FFFFFF', 
                            borderColor: '#CBD5E1', 
                            borderRadius: 6,
                            fontSize: 11,
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                          }} 
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 text-[11px] pr-4 shrink-0">
                      {finalAbcData.map(d => (
                        <div key={d.name} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                          <span className="text-slate-600 font-medium truncate max-w-[150px]">{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs">
                    {isAr ? 'لا توجد بيانات كافية لحساب توزيع ABC' : 'No inventory values available for ABC analysis'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
