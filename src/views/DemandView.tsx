import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { InventoryItem, ModelType, ReplenishmentStrategy, AppSettings, isAnalyzableItem } from '../engine/types';
import { normalizeHorizonKey } from '../engine/math';
import { shouldAutoRecalculateItem } from '../App';
import { translations, Language } from '../i18n/translations';
import { formatItemCode } from '../utils/formatters';
import { api } from '../api/client';
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Line, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  CartesianGrid 
} from 'recharts';
import { 
  Search, 
  Settings, 
  FileText, 
  Sliders, 
  Eye, 
  Layers, 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  File, 
  CheckCircle2, 
  HelpCircle,
  TrendingUp,
  RotateCcw,
  X,
  Upload
} from 'lucide-react';

interface DemandViewProps {
  items: InventoryItem[];
  selectedItem?: InventoryItem;
  onSelectItem: (item: InventoryItem) => void;
  onModelChange: (itemId: string, newModel: ModelType) => void;
  onOverrideChange: (itemId: string, periodDate: string, val: number | undefined) => void;
  onExplainCalculation: (item: InventoryItem) => void;
  onParameterChange?: (itemId: string, updates: Partial<InventoryItem>) => void;
  onOpenSettings?: () => void;
  onNavigateToDataHub?: () => void;
  settings?: AppSettings;
  language: Language;
  projectId?: string;
  selectedLocation?: string;
  recalculateItem?: (item: InventoryItem, newModel?: ModelType, newStrategy?: ReplenishmentStrategy) => InventoryItem;
}

export const DemandView: React.FC<DemandViewProps> = ({
  items,
  selectedItem: rawSelectedItem,
  onSelectItem,
  onModelChange,
  onOverrideChange,
  onExplainCalculation,
  onParameterChange,
  onOpenSettings,
  onNavigateToDataHub,
  settings,
  language,
  projectId = 'proj_default_retail',
  selectedLocation,
  recalculateItem,
}) => {
  const selectedItem = useMemo(() => {
    if (!rawSelectedItem) return undefined;
    if (recalculateItem && shouldAutoRecalculateItem(rawSelectedItem)) {
      return recalculateItem(rawSelectedItem);
    }
    return rawSelectedItem;
  }, [rawSelectedItem, recalculateItem]);

  const t = translations[language];
  const isAr = language === 'ar';

  // Pane 1 State
  const treeSearchRef = useRef<HTMLInputElement>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Electronics': true,
    'Apparel': true,
    'Industrial': true,
    'FMCG': true,
    'Automotive': true,
  });
  const [groupBy, setGroupBy] = useState<'item' | 'location'>('item');
  const [showAbc, setShowAbc] = useState(true);
  const [hideDistortions, setHideDistortions] = useState(false);
  const [hideCategories, setHideCategories] = useState(false);

  // Note Modal & Parameters State
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [currentNote, setCurrentNote] = useState(selectedItem?.notes || '');
  const [ignoreZeroSales, setIgnoreZeroSales] = useState(true);
  const [ignoreStockoutDays, setIgnoreStockoutDays] = useState(true);
  const [useHolidays, setUseHolidays] = useState(true);
  const [approvalHorizon, setApprovalHorizon] = useState<string>('6m');
  const [adjustLevel, setAdjustLevel] = useState(1.0);

  useEffect(() => {
    if (selectedItem) {
      setCurrentNote(selectedItem.notes || '');
      const m = selectedItem.notes?.match(/approvalHorizon:([0-9a-zA-Z]+)/);
      if (m && m[1]) {
        setApprovalHorizon(normalizeHorizonKey(m[1]));
      } else if (settings?.forecast_horizon_periods) {
        setApprovalHorizon(normalizeHorizonKey(settings.forecast_horizon_periods));
      }
    }
  }, [selectedItem?.id, selectedItem?.notes, settings?.forecast_horizon_periods]);

  // Pane 2 State
  const [chartMetric, setChartMetric] = useState<'quantity' | 'revenue'>('quantity');
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null);
  const [tempOverride, setTempOverride] = useState<string>('');
  const [visibleRows, setVisibleRows] = useState({
    actual: true,
    model: true,
    forecast: true,
    override: true,
    lowerConf: true,
    upperConf: true,
  });

  // Pane 3 State
  const [inspectorTab, setInspectorTab] = useState<'forecasting' | 'model' | 'inventory' | 'kpis'>('forecasting');

  // Server-side pagination state (capped at 50 rows per page to prevent Edge WebView2 Error code 39)
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [paginatedItems, setPaginatedItems] = useState<InventoryItem[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(false);

  // Reset on project or branch switch
  useEffect(() => {
    setPage(1);
    setTreeSearch('');
    setDebouncedSearch('');
    setPaginatedItems([]);
    setTotalCount(0);
  }, [projectId, selectedLocation]);

  // Debounce tree search input (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(treeSearch);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [treeSearch]);

  const fetchDemandPage = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingList(true);
    try {
      const res = await api.getDemand({
        projectId,
        page,
        pageSize,
        search: debouncedSearch,
        location: selectedLocation,
        includeDormant: false
      });
      const hydrated = (res.items || []).map(i => {
        if (recalculateItem && shouldAutoRecalculateItem(i)) {
          return recalculateItem(i);
        }
        return i;
      });
      setPaginatedItems(hydrated);
      setTotalCount(res.total_count ?? hydrated.length);
      setTotalPages(res.total_pages ?? Math.max(1, Math.ceil((res.total_count || 1) / pageSize)));
      if (hydrated.length > 0 && !rawSelectedItem) {
        onSelectItem(hydrated[0]);
      } else if (rawSelectedItem && shouldAutoRecalculateItem(rawSelectedItem) && recalculateItem) {
        const found = hydrated.find(x => x.id === rawSelectedItem.id);
        if (found) {
          onSelectItem(found);
        }
      }
    } catch (err) {
      console.warn('Failed to load server-side demand page:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, [projectId, page, pageSize, debouncedSearch, rawSelectedItem, onSelectItem, selectedLocation, recalculateItem]);

  useEffect(() => {
    fetchDemandPage();
  }, [fetchDemandPage]);

  // Strict Defensive Exclusion: Filter out any dormant SKUs (onHand <= 0 && totalSales <= 0)
  const activeItems = useMemo(() => {
    if (paginatedItems.length > 0) return paginatedItems;
    const base = (items || []).filter(isAnalyzableItem);
    if (!selectedLocation || selectedLocation === 'ALL') return base.slice(0, 50);
    return base.filter(i => (i.location || '').toLowerCase().trim() === selectedLocation.toLowerCase().trim()).slice(0, 50);
  }, [paginatedItems, items, selectedLocation]);

  // Categories group
  const categories = useMemo(() => {
    const map: Record<string, InventoryItem[]> = {};
    activeItems.forEach(i => {
      const key = (groupBy === 'item' ? i.category : i.location) || (isAr ? 'عام' : 'General');
      if (!map[key]) map[key] = [];
      const code = (i.code || '').toLowerCase();
      const desc = (i.description || '').toLowerCase();
      const query = (treeSearch || '').toLowerCase().trim();
      if (!query || code.includes(query) || desc.includes(query)) {
        map[key].push(i);
      }
    });
    return map;
  }, [activeItems, groupBy, treeSearch, isAr]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    Object.keys(categories).forEach(k => { next[k] = true; });
    setExpandedCategories(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    Object.keys(categories).forEach(k => { next[k] = false; });
    setExpandedCategories(next);
  };

  // Periods formatting
  const periods = selectedItem?.periods || [];
  const historicalPeriods = periods.filter(p => (p.actual || 0) > 0);
  const futurePeriods = periods.filter(p => (p.actual || 0) === 0);

  // Chart data calculation
  const multiplier = chartMetric === 'revenue' ? (selectedItem?.salesPrice || 1) : 1;
  const chartData = periods.map(p => ({
    date: p.label || p.date,
    actual: (p.actual || 0) > 0 ? Math.round((p.actual || 0) * multiplier) : undefined,
    model: visibleRows.model && p.model ? Math.round(p.model * multiplier) : undefined,
    forecast: visibleRows.forecast && p.forecast ? Math.round(p.forecast * multiplier) : undefined,
    override: p.override ? Math.round(p.override * multiplier) : undefined,
    confUpper: visibleRows.upperConf && p.confUpper ? Math.round(p.confUpper * multiplier) : undefined,
    confLower: visibleRows.lowerConf && p.confLower ? Math.round(p.confLower * multiplier) : undefined,
  }));

  // Identify valid Actual Sales data points for dynamic trend gradient
  const validActualPoints = useMemo(() => {
    const points: { idx: number; val: number; date: string }[] = [];
    chartData.forEach((d, idx) => {
      if (typeof d.actual === 'number' && !isNaN(d.actual)) {
        points.push({ idx, val: d.actual, date: d.date });
      }
    });
    return points;
  }, [chartData]);

  // Map trend directions and colors for dots and line vertices
  const actualTrendsMap = useMemo(() => {
    const map = new Map<string, { color: string; trend: 'up' | 'down' | 'flat' | 'first' }>();
    for (let i = 0; i < validActualPoints.length; i++) {
      const pt = validActualPoints[i];
      if (i === 0) {
        map.set(pt.date, { color: '#64748b', trend: 'first' });
      } else {
        const prev = validActualPoints[i - 1];
        if (pt.val > prev.val) {
          map.set(pt.date, { color: '#16a34a', trend: 'up' });
        } else if (pt.val < prev.val) {
          map.set(pt.date, { color: '#dc2626', trend: 'down' });
        } else {
          map.set(pt.date, { color: '#64748b', trend: 'flat' });
        }
      }
    }
    return map;
  }, [validActualPoints]);

  // Dynamic SVG linearGradient stops for crisp linear trend segments
  const actualTrendGradientStops = useMemo(() => {
    if (validActualPoints.length < 2) {
      return [
        <stop key="fallback-0" offset="0%" stopColor="#64748b" />,
        <stop key="fallback-1" offset="100%" stopColor="#64748b" />
      ];
    }

    const firstIdx = validActualPoints[0].idx;
    const lastIdx = validActualPoints[validActualPoints.length - 1].idx;
    const span = lastIdx - firstIdx;

    if (span <= 0) {
      return [
        <stop key="fallback-0" offset="0%" stopColor="#64748b" />,
        <stop key="fallback-1" offset="100%" stopColor="#64748b" />
      ];
    }

    const stops: React.ReactNode[] = [];
    for (let i = 0; i < validActualPoints.length - 1; i++) {
      const curr = validActualPoints[i];
      const next = validActualPoints[i + 1];

      const offsetStart = ((curr.idx - firstIdx) / span) * 100;
      const offsetEnd = ((next.idx - firstIdx) / span) * 100;

      const segmentColor = 
        next.val > curr.val ? '#16a34a' :
        next.val < curr.val ? '#dc2626' : '#64748b';

      stops.push(
        <stop
          key={`trend-stop-${i}-start`}
          offset={`${offsetStart.toFixed(3)}%`}
          stopColor={segmentColor}
        />
      );
      stops.push(
        <stop
          key={`trend-stop-${i}-end`}
          offset={`${offsetEnd.toFixed(3)}%`}
          stopColor={segmentColor}
        />
      );
    }

    return stops;
  }, [validActualPoints]);

  // Custom renderers for data dots colored by trend direction
  const renderActualDot = useCallback((props: any) => {
    const { cx, cy, payload } = props || {};
    if (cx == null || cy == null || isNaN(cx) || isNaN(cy) || payload?.actual == null) {
      return null;
    }
    const trendInfo = actualTrendsMap.get(payload.date);
    const dotColor = trendInfo?.color || '#64748b';

    return (
      <circle
        key={`actual-dot-${payload.date}`}
        cx={cx}
        cy={cy}
        r={3.5}
        fill={dotColor}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
    );
  }, [actualTrendsMap]);

  const renderActualActiveDot = useCallback((props: any) => {
    const { cx, cy, payload } = props || {};
    if (cx == null || cy == null || isNaN(cx) || isNaN(cy) || payload?.actual == null) {
      return null;
    }
    const trendInfo = actualTrendsMap.get(payload.date);
    const dotColor = trendInfo?.color || '#64748b';

    return (
      <g key={`actual-activedot-${payload.date}`}>
        <circle
          cx={cx}
          cy={cy}
          r={6.5}
          fill={dotColor}
          fillOpacity={0.25}
        />
        <circle
          cx={cx}
          cy={cy}
          r={4.5}
          fill={dotColor}
          stroke="#ffffff"
          strokeWidth={2}
        />
      </g>
    );
  }, [actualTrendsMap]);

  const handleStartEdit = (date: string, currentVal?: number) => {
    setEditingPeriod(date);
    setTempOverride(currentVal !== undefined ? currentVal.toString() : '');
  };

  const handleSaveEdit = (date: string) => {
    if (!selectedItem) return;
    const val = tempOverride.trim() === '' ? undefined : parseFloat(tempOverride);
    onOverrideChange(selectedItem.id, date, isNaN(val as any) ? undefined : val);
    setEditingPeriod(null);
  };

  const stickyColClass = isAr 
    ? 'sticky right-0 bg-inherit border-l border-[#CBD5E1] text-right' 
    : 'sticky left-0 bg-inherit border-r border-[#CBD5E1] text-left';

  if (!items || items.length === 0 || !selectedItem) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#F8F9FA] text-[#1E293B]">
        <div className="p-4 rounded-full bg-blue-50 text-[#2196F3] mb-4 shadow-xs">
          <TrendingUp className="w-10 h-10 stroke-[1.5]" />
        </div>
        <h3 className="text-base font-bold text-slate-800 mb-2 text-center">
          {isAr
            ? 'المشروع فارغ حالياً — لا توجد بيانات مرفوعة بعد'
            : 'This project is currently empty — no data uploaded yet'}
        </h3>
        <p className="text-xs text-slate-500 mb-6 text-center max-w-md leading-relaxed">
          {isAr
            ? 'يرجى الانتقال إلى تغذية البيانات لرفع مبيعات الأصناف وتوليد نماذج التنبؤ.'
            : 'Please navigate to Data Hub to upload SKU sales records and generate demand forecast models.'}
        </p>
        {onNavigateToDataHub && (
          <button
            onClick={onNavigateToDataHub}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#2196F3] hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>
              {isAr ? 'الذهاب إلى تغذية البيانات' : 'Go to Data Hub'}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-[#F8F9FA] select-none text-[#1E293B] text-[12px]">
      {/* ========================================================= */}
      {/* PANE 1: Tree & Filters (~240px)                           */}
      {/* ========================================================= */}
      <aside className="w-[240px] flex-none bg-[#F3F4F6] border-r border-[#D1D5DB] flex flex-col justify-between overflow-hidden">
        {/* Top: Search and Expand/Collapse links */}
        <div className="p-2 border-b border-[#E2E8F0] space-y-1.5 bg-white">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
            <input
              ref={treeSearchRef}
              type="text"
              value={treeSearch}
              onChange={e => setTreeSearch(e.target.value)}
              placeholder={t.demand.searchPlaceholder}
              className="w-full pl-7 pr-2 py-1 text-[11px] border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] bg-white"
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-[#2196F3] px-1 font-medium">
            <button onClick={expandAll} className="hover:underline cursor-pointer">
              {t.demand.expandAll}
            </button>
            <span className="text-slate-300">|</span>
            <button onClick={collapseAll} className="hover:underline cursor-pointer">
              {t.demand.collapseAll}
            </button>
          </div>
        </div>

        {/* Middle: Hierarchical Item/Category Tree */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {Object.entries(categories).map(([catName, catItems]) => {
            const isExpanded = expandedCategories[catName] !== false;
            return (
              <div key={catName} className="space-y-0.5">
                {!hideCategories && (
                  <button
                    onClick={() => toggleCategory(catName)}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-[#E2E8F0] rounded text-left cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    )}
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate flex-1">{catName}</span>
                    <span className="text-[10px] text-slate-400 font-normal">({catItems.length})</span>
                  </button>
                )}

                {/* Items in Category */}
                {(isExpanded || hideCategories) && (
                  <div className={!hideCategories ? 'pl-4 space-y-0.5' : 'space-y-0.5'}>
                    {catItems.map(item => {
                      const isSelected = selectedItem?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (recalculateItem && shouldAutoRecalculateItem(item)) {
                              onSelectItem(recalculateItem(item));
                            } else {
                              onSelectItem(item);
                            }
                          }}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#2196F3] text-white font-semibold'
                              : 'text-slate-700 hover:bg-[#E2E8F0]'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isSelected ? 'bg-white' : item.isStockout ? 'bg-rose-500' : 'bg-emerald-500'
                          }`} />
                          <span className="font-mono text-[10px] shrink-0">{formatItemCode(item.code)}</span>
                          <span className="truncate flex-1">{item.description}</span>
                          {showAbc && (
                            <span className={`text-[9px] px-1 rounded font-bold uppercase shrink-0 ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {item.abcClass}{item.xyzClass}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination Bar for Demand Tree (50 SKUs / page) */}
        <div className="p-2 bg-[#F1F5F9] border-t border-[#CBD5E1] flex items-center justify-between text-[10px] text-slate-600 shrink-0">
          <span className="font-mono font-medium">
            {isAr ? `صفحة ${page} / ${totalPages}` : `Pg ${page}/${totalPages}`}
            <span className="text-slate-400 font-normal ml-1">({totalCount || activeItems.length})</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoadingList}
              className="px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-[10px] cursor-pointer"
            >
              {isAr ? 'السابق' : 'Prev'}
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoadingList}
              className="px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-[10px] cursor-pointer"
            >
              {isAr ? 'التالي' : 'Next'}
            </button>
          </div>
        </div>

        {/* Bottom: Filter Box (Radios & Checkboxes) */}
        <div className="p-2.5 bg-[#ECEFF1] border-t border-[#D1D5DB] space-y-2 text-[11px]">
          {/* Radio Group */}
          <div className="flex items-center gap-3 font-semibold text-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="groupBy"
                checked={groupBy === 'item'}
                onChange={() => setGroupBy('item')}
                className="text-[#2196F3] focus:ring-0"
              />
              <span>{t.demand.byItem}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="groupBy"
                checked={groupBy === 'location'}
                onChange={() => setGroupBy('location')}
                className="text-[#2196F3] focus:ring-0"
              />
              <span>{t.demand.byLocation}</span>
            </label>
          </div>

          <div className="h-[1px] bg-[#CFD8DC]" />

          {/* Checkboxes */}
          <div className="space-y-1 text-slate-600 font-medium text-[11px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAbc}
                onChange={e => setShowAbc(e.target.checked)}
                className="rounded text-[#2196F3] focus:ring-0"
              />
              <span>{t.demand.abcAnalysis}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hideDistortions}
                onChange={e => setHideDistortions(e.target.checked)}
                className="rounded text-[#2196F3] focus:ring-0"
              />
              <span>{t.demand.hideDistortions}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hideCategories}
                onChange={e => setHideCategories(e.target.checked)}
                className="rounded text-[#2196F3] focus:ring-0"
              />
              <span>{t.demand.hideCategories}</span>
            </label>
          </div>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* PANE 2: Center Split (Grid & Chart)                       */}
      {/* ========================================================= */}
      <section className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
        {/* Top Center Toolbar */}
        <div className="flex items-center justify-between px-3 h-8 bg-[#F8F9FA] border-b border-[#E2E8F0] shrink-0 text-[11px] font-medium text-slate-700">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <span className="font-mono text-[#2196F3]">{formatItemCode(selectedItem.code)}</span>
              <span>-</span>
              <span className="truncate max-w-xs">{selectedItem.description}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => treeSearchRef.current?.focus()}
              title={t.demand.centerToolbar.search}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#E2E8F0] text-slate-600 cursor-pointer transition"
            >
              <Search className="w-3 h-3 text-slate-400" />
              <span>{t.demand.centerToolbar.search}</span>
            </button>
            <button 
              onClick={() => onOpenSettings?.()}
              title={t.demand.centerToolbar.settings}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#E2E8F0] text-slate-600 cursor-pointer transition"
            >
              <Settings className="w-3 h-3 text-slate-400" />
              <span>{t.demand.centerToolbar.settings}</span>
            </button>
            <button 
              onClick={() => setIsNoteModalOpen(true)}
              title={t.demand.centerToolbar.addNote}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#E2E8F0] text-slate-600 cursor-pointer transition"
            >
              <FileText className="w-3 h-3 text-slate-400" />
              <span>{t.demand.centerToolbar.addNote}</span>
              {selectedItem.notes && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#2196F3]" />
              )}
            </button>
          </div>
        </div>

        {/* Upper Half: High-Density Time-Series Grid */}
        <div className="h-[210px] flex-none overflow-auto border-b border-[#CBD5E1] bg-white">
          <table className="nexo-grid w-full text-right">
            <thead>
              <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10 text-[12px]">
                <th className={`w-44 ${stickyColClass} z-20 bg-[#ECEFF1]`}>
                  {isAr ? 'نوع البيانات / الفترة' : 'Series / Period'}
                </th>
                {periods.map((p, idx) => {
                  const isFuture = (p.actual || 0) === 0;
                  return (
                    <th 
                      key={p.date} 
                      className={`min-w-[62px] px-2 py-1 text-center font-mono ${
                        isFuture ? 'bg-blue-50/70 text-blue-900 border-b-2 border-b-[#2196F3]' : ''
                      }`}
                    >
                      <div>{p.label || p.date}</div>
                      {isFuture && (
                        <div className="text-[10.5px] text-[#2196F3] font-bold">
                          +{idx - historicalPeriods.length + 1}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Row 1: Actual sales */}
              {visibleRows.actual && (
                <tr className="hover:bg-slate-50">
                  <td className={`font-semibold text-slate-800 ${stickyColClass} bg-white`}>
                    {t.demand.gridRows.actual}
                  </td>
                  {periods.map(p => (
                    <td key={p.date} className="font-mono text-slate-700">
                      {(p.actual || 0) > 0 ? (p.actual || 0).toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
              )}

              {/* Row 2: Statistical model */}
              {visibleRows.model && (
                <tr className="hover:bg-slate-50 bg-[#F8F9FA]/40 text-emerald-800">
                  <td className={`font-medium ${stickyColClass} bg-[#F8F9FA]`}>
                    {t.demand.gridRows.model}
                  </td>
                  {periods.map(p => (
                    <td key={p.date} className="font-mono">
                      {p.model !== undefined && p.model !== null ? p.model.toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
              )}

              {/* Row 3: Final forecast */}
              {visibleRows.forecast && (
                <tr className="hover:bg-blue-50/40 bg-blue-50/20 font-bold text-[#2196F3]">
                  <td className={`font-bold ${stickyColClass} bg-blue-50/30`}>
                    {t.demand.gridRows.forecast}
                  </td>
                  {periods.map(p => (
                    <td key={p.date} className="font-mono">
                      {p.forecast !== undefined && p.forecast !== null ? p.forecast.toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
              )}

              {/* Row 4: Forecast override (INLINE EDITABLE + DuckDB PERSISTENCE) */}
              {visibleRows.override && (
                <tr className="bg-amber-50/30 text-amber-900 hover:bg-amber-50/60">
                  <td className={`font-semibold ${stickyColClass} bg-amber-50/40`}>
                    {t.demand.gridRows.override}
                  </td>
                  {periods.map(p => {
                    const isFuture = (p.actual || 0) === 0;
                    if (!isFuture) {
                      return <td key={p.date} className="font-mono text-slate-300">-</td>;
                    }
                    const isEditing = editingPeriod === p.date;
                    return (
                      <td 
                        key={p.date} 
                        className="font-mono cursor-pointer hover:bg-amber-100/60 p-0"
                        onClick={() => !isEditing && handleStartEdit(p.date, p.override)}
                      >
                        {isEditing ? (
                          <input
                            type="number"
                            autoFocus
                            value={tempOverride}
                            onChange={e => setTempOverride(e.target.value)}
                            onBlur={() => handleSaveEdit(p.date)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveEdit(p.date);
                              if (e.key === 'Escape') setEditingPeriod(null);
                            }}
                            className="w-full text-right px-1 py-0.5 border border-[#2196F3] rounded text-xs bg-white font-mono focus:outline-none"
                          />
                        ) : (
                          <div className="px-2 py-1">
                            {p.override !== undefined && p.override !== null ? (
                              <span className="font-bold underline text-amber-700">
                                {p.override.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px] italic">
                                {isAr ? 'تعديل...' : 'edit'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}

              {/* Row 5: Lower 95% */}
              {visibleRows.lowerConf && (
                <tr className="text-slate-500 hover:bg-slate-50 text-[12px]">
                  <td className={`${stickyColClass} bg-white`}>
                    {t.demand.gridRows.lowerConf}
                  </td>
                  {periods.map(p => (
                    <td key={p.date} className="font-mono">
                      {p.confLower !== undefined && p.confLower !== null ? p.confLower.toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
              )}

              {/* Row 6: Upper 95% */}
              {visibleRows.upperConf && (
                <tr className="text-slate-500 hover:bg-slate-50 text-[12px]">
                  <td className={`${stickyColClass} bg-white`}>
                    {t.demand.gridRows.upperConf}
                  </td>
                  {periods.map(p => (
                    <td key={p.date} className="font-mono">
                      {p.confUpper !== undefined && p.confUpper !== null ? p.confUpper.toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Lower Half: Sub-Tabs & Recharts Canvas */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden p-2">
          {/* Sub-tabs: Quantity vs Revenue */}
          <div className="flex items-center justify-between pb-1.5 border-b border-[#E2E8F0] shrink-0">
            <div className="inline-flex rounded border border-[#CBD5E1] bg-[#F1F5F9] p-0.5 text-[11px] font-semibold">
              <button
                onClick={() => setChartMetric('quantity')}
                className={`px-3 py-1 rounded transition cursor-pointer ${
                  chartMetric === 'quantity'
                    ? 'bg-white text-[#2196F3] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.demand.chartTabs.quantity} ({isAr ? 'وحدات' : 'Units'})
              </button>
              <button
                onClick={() => setChartMetric('revenue')}
                className={`px-3 py-1 rounded transition cursor-pointer ${
                  chartMetric === 'revenue'
                    ? 'bg-white text-[#2196F3] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.demand.chartTabs.revenue}
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-[#2196F3] inline-block" />
                {t.demand.gridRows.forecast}
              </span>
              <span 
                className="flex items-center gap-1.5 font-medium text-slate-700"
                title={isAr ? "المبيعات الفعلية (أخضر = صعود، أحمر = هبوط)" : "Actual Sales (Green = Up, Red = Down)"}
              >
                <span className="inline-flex items-center overflow-hidden rounded-full w-4 h-1 shrink-0">
                  <span className="w-1/2 h-full bg-[#16a34a]" />
                  <span className="w-1/2 h-full bg-[#dc2626]" />
                </span>
                <span>{t.demand.gridRows.actual}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-600 inline-block border-dashed" />
                {t.demand.gridRows.model}
              </span>
            </div>
          </div>

          {/* Recharts Canvas with Crisp Gridlines */}
          <div className="flex-1 w-full pt-2 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="actualTrendGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    {actualTrendGradientStops}
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 10, fill: '#64748B' }} 
                  stroke="#CBD5E1" 
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: '#64748B' }} 
                  stroke="#CBD5E1"
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    borderColor: '#CBD5E1', 
                    borderRadius: 6,
                    fontSize: 11,
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }} 
                />
                {/* Confidence Area */}
                <Area 
                  type="monotone" 
                  dataKey="confUpper" 
                  stroke="transparent" 
                  fill="#2196F3" 
                  fillOpacity={0.12} 
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Actual Sales Line - Sharp Linear Trend */}
                <Line 
                  type="linear" 
                  dataKey="actual" 
                  stroke="url(#actualTrendGradient)" 
                  strokeWidth={2.5} 
                  dot={renderActualDot} 
                  activeDot={renderActualActiveDot}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Statistical Fitted Model */}
                <Line 
                  type="monotone" 
                  dataKey="model" 
                  stroke="#10B981" 
                  strokeWidth={1.5} 
                  strokeDasharray="4 4" 
                  dot={false} 
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Forecast Line */}
                <Line 
                  type="monotone" 
                  dataKey="forecast" 
                  stroke="#2196F3" 
                  strokeWidth={2.5} 
                  dot={{ r: 4, fill: '#2196F3' }} 
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* PANE 3: Right Properties Inspector (~300px)               */}
      {/* ========================================================= */}
      <aside className="w-[300px] flex-none bg-[#F3F4F6] border-l border-[#D1D5DB] flex flex-col justify-between overflow-hidden">
        {/* Header & Tabs */}
        <div>
          <div className="px-3 py-2 border-b border-[#E2E8F0] bg-white font-bold text-slate-800 text-[12px] flex items-center justify-between">
            <span>{t.demand.inspector.title}</span>
            <span className="text-[10px] text-slate-400 font-mono">{formatItemCode(selectedItem.code)}</span>
          </div>

          {/* 4 Tabs: Forecasting, Model, Inventory, KPIs */}
          <div className="grid grid-cols-4 border-b border-[#CBD5E1] bg-[#ECEFF1] text-center text-[11px] font-semibold">
            <button
              onClick={() => setInspectorTab('forecasting')}
              className={`py-1.5 transition cursor-pointer ${
                inspectorTab === 'forecasting'
                  ? 'bg-white text-[#2196F3] border-b-2 border-[#2196F3]'
                  : 'text-slate-600 hover:bg-[#E2E8F0]'
              }`}
            >
              {t.demand.inspector.tabForecasting}
            </button>
            <button
              onClick={() => setInspectorTab('model')}
              className={`py-1.5 transition cursor-pointer ${
                inspectorTab === 'model'
                  ? 'bg-white text-[#2196F3] border-b-2 border-[#2196F3]'
                  : 'text-slate-600 hover:bg-[#E2E8F0]'
              }`}
            >
              {t.demand.inspector.tabModel}
            </button>
            <button
              onClick={() => setInspectorTab('inventory')}
              className={`py-1.5 transition cursor-pointer ${
                inspectorTab === 'inventory'
                  ? 'bg-white text-[#2196F3] border-b-2 border-[#2196F3]'
                  : 'text-slate-600 hover:bg-[#E2E8F0]'
              }`}
            >
              {t.demand.inspector.tabInventory}
            </button>
            <button
              onClick={() => setInspectorTab('kpis')}
              className={`py-1.5 transition cursor-pointer ${
                inspectorTab === 'kpis'
                  ? 'bg-white text-[#2196F3] border-b-2 border-[#2196F3]'
                  : 'text-slate-600 hover:bg-[#E2E8F0]'
              }`}
            >
              {t.demand.inspector.tabKpis}
            </button>
          </div>
        </div>

        {/* Tab Properties Body with Live Interactive Changes */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 text-[11px]">
          {inspectorTab === 'forecasting' && (
            <div className="space-y-1 bg-white border border-[#E2E8F0] rounded p-2">
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.active}</span>
                <button
                  onClick={() => onParameterChange && onParameterChange(selectedItem.id, { checkState: selectedItem.checkState === 'checked' ? 'attention' : 'checked' })}
                  className={`font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                    selectedItem.checkState === 'checked' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {selectedItem.checkState === 'checked' ? t.demand.inspector.yes : t.demand.inspector.no}
                </button>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.forecastApproach}</span>
                <select
                  value="item"
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { notes: `Approach: ${e.target.value}` })}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white"
                >
                  <option value="item">{isAr ? 'مستوى الصنف' : 'Item level'}</option>
                  <option value="category">{isAr ? 'مستوى الفئة' : 'Category aggregate'}</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.seasonalityPattern}</span>
                <select
                  value="12"
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { notes: `Seasonality: ${e.target.value}` })}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white"
                >
                  <option value="12">{isAr ? '12 فترة (سنوي)' : '12 periods (Annual)'}</option>
                  <option value="4">{isAr ? '4 فترات (ربعي)' : '4 periods (Quarterly)'}</option>
                  <option value="0">{isAr ? 'لا يوجد موسمية' : 'No seasonality'}</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.ignoreZeroSales}</span>
                <button
                  onClick={() => {
                    const next = !ignoreZeroSales;
                    setIgnoreZeroSales(next);
                    onParameterChange && onParameterChange(selectedItem.id, { notes: `ignoreZeroSales:${next}` });
                  }}
                  className={`font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer transition ${
                    ignoreZeroSales ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {ignoreZeroSales ? (t.demand.inspector.enabled || (isAr ? 'مفعل' : 'Enabled')) : (t.demand.inspector.disabled || (isAr ? 'معطل' : 'Disabled'))}
                </button>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.ignoreStockoutDays}</span>
                <button
                  onClick={() => {
                    const next = !ignoreStockoutDays;
                    setIgnoreStockoutDays(next);
                    onParameterChange && onParameterChange(selectedItem.id, { notes: `ignoreStockoutDays:${next}` });
                  }}
                  className={`font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer transition ${
                    ignoreStockoutDays ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {ignoreStockoutDays ? t.demand.inspector.yes : t.demand.inspector.no}
                </button>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.useHolidays}</span>
                <button
                  onClick={() => {
                    const next = !useHolidays;
                    setUseHolidays(next);
                    onParameterChange && onParameterChange(selectedItem.id, { notes: `useHolidays:${next}` });
                  }}
                  className={`font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer transition ${
                    useHolidays ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {useHolidays ? t.demand.inspector.yes : t.demand.inspector.no}
                </button>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">{t.demand.inspector.approvalHorizon}</span>
                <select
                  value={approvalHorizon}
                  onChange={e => {
                    const val = e.target.value;
                    setApprovalHorizon(val);
                    const oldNotes = (selectedItem?.notes || '').replace(/approvalHorizon:[0-9a-zA-Z]+\s*/g, '').trim();
                    const updatedNotes = oldNotes ? `${oldNotes} approvalHorizon:${val}` : `approvalHorizon:${val}`;
                    onParameterChange && onParameterChange(selectedItem.id, { notes: updatedNotes });
                  }}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white cursor-pointer"
                >
                  <option value="1w">{isAr ? 'أسبوع واحد (7 أيام)' : '1 Week (7 Days)'}</option>
                  <option value="2w">{isAr ? 'أسبوعان (14 يوم)' : '2 Weeks (14 Days)'}</option>
                  <option value="3w">{isAr ? '3 أسابيع (21 يوم)' : '3 Weeks (21 Days)'}</option>
                  <option value="1m">{isAr ? 'شهر واحد' : '1 Month'}</option>
                  <option value="3m">{isAr ? '+3 فترات مقبلة (ربع سنوي)' : '+3 Periods (Quarterly)'}</option>
                  <option value="6m">{isAr ? '+6 فترات مقبلة (نصف سنوي)' : '+6 Periods (Bi-Annual)'}</option>
                  <option value="12m">{isAr ? '+12 فترة مقبلة (سنة كاملة)' : '+12 Periods (Annual)'}</option>
                  <option value="18m">{isAr ? '+18 فترة مقبلة' : '+18 Periods (18 Months)'}</option>
                  <option value="24m">{isAr ? '+24 فترة مقبلة (سنتان)' : '+24 Periods (24 Months)'}</option>
                </select>
              </div>
            </div>
          )}

          {inspectorTab === 'model' && (
            <div className="space-y-2 bg-white border border-[#E2E8F0] rounded p-2">
              <div>
                <label className="block text-slate-500 mb-1 font-medium">{t.demand.inspector.modelType}</label>
                <select
                  value={selectedItem.modelType}
                  onChange={e => onModelChange(selectedItem.id, e.target.value as ModelType)}
                  className="w-full px-2 py-1 border border-[#CBD5E1] rounded text-[11px] focus:outline-none focus:border-[#2196F3] bg-white font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="auto">{isAr ? 'اختيار آلي للنموذج (Auto)' : 'Auto Model Selection'}</option>
                  <option value="seasonal">{isAr ? 'موسمي وهولت-وينترز (Seasonal)' : 'Seasonal & Trend'}</option>
                  <option value="linear">{isAr ? 'اتجاه خطي (Linear Trend)' : 'Linear Trend'}</option>
                  <option value="constant">{isAr ? 'مستوى ثابت (Constant Level)' : 'Constant Level'}</option>
                  <option value="intermittent">{isAr ? 'طلب متقطع كروستون (Croston SBA)' : 'Intermittent (Croston)'}</option>
                  <option value="zero">{isAr ? 'منتج متوقف / صفري (Zero/Discontinued)' : 'Zero / Discontinued'}</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.fittedModel}</span>
                <span className="font-semibold text-[#2196F3] uppercase text-[10px]">
                  {selectedItem.fittedModelType || selectedItem.modelType}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.useModelFrom}</span>
                <span className="text-slate-700">{isAr ? 'بيانات تاريخية (24 شهر)' : 'History (24m)'}</span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">{t.demand.inspector.adjustLevel}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="2.0"
                    value={adjustLevel}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setAdjustLevel(val);
                      onParameterChange && onParameterChange(selectedItem.id, { notes: `adjustLevel:${val}` });
                    }}
                    className="w-16 px-1.5 py-0.5 border border-slate-300 rounded font-mono font-semibold text-slate-800 text-[10px] bg-white text-right"
                  />
                  <span className="text-[10px] text-slate-400">({Math.round(adjustLevel * 100)}%)</span>
                </div>
              </div>
            </div>
          )}

          {inspectorTab === 'inventory' && (
            <div className="space-y-1.5 bg-white border border-[#E2E8F0] rounded p-2">
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'استراتيجية التجديد' : 'Strategy'}</span>
                <select
                  value={selectedItem.replenishmentStrategy}
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { replenishmentStrategy: e.target.value as ReplenishmentStrategy })}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white cursor-pointer"
                >
                  <option value="periodic">Periodic (JIT)</option>
                  <option value="min_max">Min / Max</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (d)'}</span>
                <input
                  type="number"
                  value={selectedItem.leadTimeDays}
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { leadTimeDays: Number(e.target.value) || 1 })}
                  className="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-right font-mono font-semibold"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'مستوى الخدمة (SL)' : 'Service Level'}</span>
                <select
                  value={selectedItem.serviceLevel >= 0.99 ? '0.99' : selectedItem.serviceLevel >= 0.98 ? '0.98' : selectedItem.serviceLevel >= 0.95 ? '0.95' : '0.90'}
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { serviceLevel: parseFloat(e.target.value) })}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-emerald-700 text-[10px] bg-white cursor-pointer font-mono"
                >
                  <option value="0.90">90% (Z=1.28)</option>
                  <option value="0.95">95% (Z=1.65)</option>
                  <option value="0.98">98% (Z=2.05)</option>
                  <option value="0.99">99% (Z=2.33)</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'الحد الأدنى للطلب (MOQ)' : 'MOQ (Min Batch)'}</span>
                <input
                  type="number"
                  value={selectedItem.minBatch}
                  onChange={e => onParameterChange && onParameterChange(selectedItem.id, { minBatch: Number(e.target.value) || 1 })}
                  className="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-right font-mono font-semibold"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'مخزون الأمان (SS)' : 'Safety Stock (SS)'}</span>
                <span className="font-mono font-bold text-slate-900">{selectedItem.safetyStock}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">{isAr ? 'نقطة إعادة الطلب (ROP)' : 'Reorder Point (ROP)'}</span>
                <span className="font-mono font-bold text-[#2196F3]">{selectedItem.reorderPoint}</span>
              </div>
            </div>
          )}

          {inspectorTab === 'kpis' && (
            <div className="space-y-1.5 bg-white border border-[#E2E8F0] rounded p-2">
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">WMAPE:</span>
                <span className="font-mono font-bold text-emerald-600">{selectedItem.wmape?.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">MAPE:</span>
                <span className="font-mono font-bold text-slate-700">{selectedItem.mape?.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'دقة التنبؤ' : 'Accuracy'}:</span>
                <span className="font-mono font-bold text-[#2196F3]">{selectedItem.accuracy?.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{isAr ? 'أيام التغطية' : 'Days of Supply'}:</span>
                <span className="font-mono font-semibold text-slate-800">{selectedItem.daysOfSupply} {isAr ? 'يوم' : 'd'}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">{isAr ? 'المطلوب شراؤه الآن' : 'Order Now'}:</span>
                <span className="font-mono font-bold text-amber-600">{selectedItem.orderNow}</span>
              </div>
            </div>
          )}
        </div>

        {/* Explain Calculation Button */}
        <div className="p-2 border-t border-[#E2E8F0] bg-white">
          <button
            onClick={() => onExplainCalculation(selectedItem)}
            className="w-full py-1.5 px-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#2196F3] font-semibold rounded text-[11px] border border-[#CBD5E1] transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{t.demand.inspector.explainBtn}</span>
          </button>
        </div>
      </aside>

      {/* Item Note Modal */}
      {isNoteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-md w-full shadow-2xl overflow-hidden flex flex-col text-[#1E293B]">
            <div className="p-3 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#2196F3]" />
                <span className="font-bold text-xs text-slate-800">
                  {isAr ? `ملاحظات الصنف (${formatItemCode(selectedItem.code)})` : `Item Notes (${formatItemCode(selectedItem.code)})`}
                </span>
              </div>
              <button 
                onClick={() => setIsNoteModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-[#E2E8F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                value={currentNote}
                onChange={e => setCurrentNote(e.target.value)}
                placeholder={isAr ? 'اكتب ملاحظات التخطيط أو أسباب التعديل اليدوي للتنبؤ هنا...' : 'Enter planning assumptions, overrides justification, or supply notes...'}
                className="w-full h-32 p-2.5 text-xs border border-slate-300 rounded focus:border-[#2196F3] focus:outline-none resize-none leading-relaxed"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setIsNoteModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs cursor-pointer font-medium"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => {
                    if (onParameterChange) {
                      onParameterChange(selectedItem.id, { notes: currentNote.trim() });
                    }
                    setIsNoteModalOpen(false);
                  }}
                  className="px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer"
                >
                  {t.common.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
