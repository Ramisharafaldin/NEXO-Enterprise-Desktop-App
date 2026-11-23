import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { InventoryItem, ModelType, ReplenishmentStrategy, AppSettings, TimeSeriesPeriod, isAnalyzableItem } from '../engine/types';
import { 
  normalizeHorizonKey, 
  fitConstantModel, 
  fitLinearTrendModel, 
  fitSeasonalModel, 
  fitIntermittentModel, 
  autoSelectModel, 
  resolveHorizon, 
  getNextPeriodDate 
} from '../engine/math';
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
  ChevronRight, 
  ChevronDown, 
  Folder, 
  File, 
  CheckCircle2, 
  HelpCircle,
  TrendingUp,
  RotateCcw,
  X,
  Upload,
  Filter,
  Loader2,
  Check,
  MapPin
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
  recalculateItem?: (
    item: InventoryItem,
    newModel?: ModelType,
    newStrategy?: ReplenishmentStrategy,
    horizonOverride?: string | number,
    seasonalityOverride?: string | number,
    dateBoundsOverride?: { minActualDate?: string | null; maxActualDate?: string | null }
  ) => InventoryItem;
  onApprovalHorizonChange?: (horizon: string) => void;
  onProjectDefaultsLoaded?: (defaults: any) => void;
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
  onApprovalHorizonChange,
  onProjectDefaultsLoaded,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';
  const isAllLocations = !selectedLocation || selectedLocation.toUpperCase() === 'ALL';

  // Single Source of Truth: Project-level defaults inherited by all SKUs without overrides
  const [projectDefaults, setProjectDefaults] = useState<{
    seasonalityPattern: string;
    seasonalityPeriod: number;
    forecastApproach: 'item' | 'category';
    approvalHorizon?: string;
    minActualDate?: string | null;
    maxActualDate?: string | null;
  }>({
    seasonalityPattern: '12',
    seasonalityPeriod: 12,
    forecastApproach: 'item',
    approvalHorizon: '12m',
    minActualDate: null,
    maxActualDate: null,
  });

  const [approvalHorizon, setApprovalHorizon] = useState<string>(
    settings?.forecast_horizon_periods ? normalizeHorizonKey(settings.forecast_horizon_periods) : '12m'
  );
  const [seasonalityPattern, setSeasonalityPattern] = useState<string>('12');

  const selectedItem = useMemo(() => {
    if (!rawSelectedItem) return undefined;
    if (recalculateItem && shouldAutoRecalculateItem(rawSelectedItem)) {
      const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
      const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
      const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };
      return recalculateItem(rawSelectedItem, undefined, undefined, effHorizon, effSeason, dateBounds);
    }
    return rawSelectedItem;
  }, [rawSelectedItem, recalculateItem, approvalHorizon, seasonalityPattern, projectDefaults]);

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
  const [adjustLevel, setAdjustLevel] = useState(1.0);

  // Quick Full-DB Search State
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [quickSearchTerm, setQuickSearchTerm] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState<InventoryItem[]>([]);
  const [isQuickSearching, setIsQuickSearching] = useState(false);

  // Demand & Forecast Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [modalHorizon, setModalHorizon] = useState<string>('12m');
  const [modalModel, setModalModel] = useState<ModelType>('auto');
  const [modalSeasonality, setModalSeasonality] = useState<string>('12');
  const [isRecalculatingAll, setIsRecalculatingAll] = useState(false);

  // Forecast Level & Category Aggregation State
  const [forecastApproach, setForecastApproach] = useState<'item' | 'category'>('item');
  const [categorySeriesData, setCategorySeriesData] = useState<{
    category: string;
    sku_count: number;
    total_sales: number;
    periods: TimeSeriesPeriod[];
  } | null>(null);
  const [isLoadingCategorySeries, setIsLoadingCategorySeries] = useState(false);

  // Model Status State
  const [modelStatus, setModelStatus] = useState<'active' | 'inactive'>('active');

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const firstFutureColRef = useRef<HTMLTableCellElement>(null);
  const rawSelectedItemRef = useRef(rawSelectedItem);
  useEffect(() => {
    rawSelectedItemRef.current = rawSelectedItem;
  }, [rawSelectedItem]);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  // Synchronize state when selected item, projectDefaults, or settings change
  useEffect(() => {
    if (selectedItem) {
      setCurrentNote(selectedItem.notes || '');

      // Single Source of Truth: Approval Horizon is strictly project-wide and immutable across SKU clicks
      const projectHorizon = projectDefaults.approvalHorizon 
        ? normalizeHorizonKey(projectDefaults.approvalHorizon) 
        : (settings?.forecast_horizon_periods ? normalizeHorizonKey(settings.forecast_horizon_periods) : '12m');
      setApprovalHorizon(projectHorizon);

      // Forecast approach (Single Source of Truth: projectDefaults, falling back to item)
      const fAppr = projectDefaults.forecastApproach || selectedItem.forecastApproach || 'item';
      setForecastApproach(fAppr === 'category' ? 'category' : 'item');

      // Seasonality pattern (Single Source of Truth: projectDefaults, falling back to item)
      const sPat = projectDefaults.seasonalityPattern 
        || selectedItem.seasonalityPattern 
        || '12';
      setSeasonalityPattern(sPat);
      setModalSeasonality(sPat);

      // Model status (strictly scoped to this selected item only)
      setModelStatus(selectedItem.modelStatus === 'inactive' ? 'inactive' : 'active');

      // Model type & horizon modal defaults
      setModalModel(selectedItem.modelType || 'auto');
      setModalHorizon(projectHorizon);

      // Outlier / sales flags
      setIgnoreZeroSales(!selectedItem.notes?.includes('ignoreZeroSales:false'));
      setIgnoreStockoutDays(!selectedItem.notes?.includes('ignoreStockoutDays:false'));
      setUseHolidays(!selectedItem.notes?.includes('useHolidays:false'));
    }
  }, [selectedItem?.id, selectedItem?.modelStatus, settings?.forecast_horizon_periods, projectDefaults]);

  // Debounced Full-DB Quick Search against DuckDB
  useEffect(() => {
    if (!isQuickSearchOpen) return;
    if (!quickSearchTerm.trim()) {
      setQuickSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsQuickSearching(true);
      try {
        const res = await api.getDemand({
          projectId,
          search: quickSearchTerm.trim(),
          location: selectedLocation,
          pageSize: 25,
          includeDormant: false
        });
        setQuickSearchResults(res.items || []);
      } catch (err) {
        console.warn('Quick search error:', err);
      } finally {
        setIsQuickSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [quickSearchTerm, isQuickSearchOpen, projectId, selectedLocation]);

  // Category Aggregate Forecast computation
  const loadCategorySeries = useCallback(async (catName: string) => {
    if (!projectId || !catName) return;
    setIsLoadingCategorySeries(true);
    try {
      const res = await api.getCategorySeries(projectId, catName, selectedLocation);
      const rawPeriods = res.periods || [];
      if (rawPeriods.length === 0) {
        setCategorySeriesData({
          category: catName,
          sku_count: res.sku_count || 0,
          total_sales: res.total_sales || 0,
          periods: []
        });
        return;
      }

      // Run forecast model on category aggregated actuals
      const actuals = rawPeriods.map(p => p.actual || 0);
      const horizonCfg = resolveHorizon(approvalHorizon, 'monthly');
      const horizon = horizonCfg.forecastPeriods;
      const seasonLen = (seasonalityPattern === '0' || seasonalityPattern === 'none') ? 0 : (Number(seasonalityPattern) || 12);

      const mType = selectedItem?.modelType || 'auto';
      let fResult;
      if (mType === 'constant') fResult = fitConstantModel(actuals, horizon);
      else if (mType === 'linear') fResult = fitLinearTrendModel(actuals, horizon);
      else if (mType === 'seasonal') {
        fResult = seasonLen > 0 ? fitSeasonalModel(actuals, horizon, seasonLen) : fitLinearTrendModel(actuals, horizon);
      } else if (mType === 'intermittent') {
        fResult = fitIntermittentModel(actuals, horizon);
      } else {
        fResult = autoSelectModel(actuals, horizon, seasonLen);
      }

      // Build historical fitted periods
      const histPeriods: TimeSeriesPeriod[] = rawPeriods.map((p, i) => ({
        date: p.date,
        actual: Math.round(p.actual),
        model: fResult.fitted[i] !== undefined ? Math.round(fResult.fitted[i]) : Math.round(p.actual),
        revenue: Math.round(p.revenue || 0)
      }));

      // Build future forecast periods
      const lastDate = histPeriods.length > 0 ? histPeriods[histPeriods.length - 1].date : '2026-10';
      const futureList: TimeSeriesPeriod[] = [];
      for (let h = 0; h < horizon; h++) {
        const futureDate = getNextPeriodDate(lastDate, h + 1, 'monthly');
        const fVal = Math.round(fResult.forecast[h] || 0);
        const up = Math.round(fResult.confUpper[h] || fVal * 1.2);
        const low = Math.round(fResult.confLower[h] || fVal * 0.8);
        futureList.push({
          date: futureDate,
          actual: 0,
          forecast: fVal,
          model: undefined,
          confUpper: up,
          confLower: low
        });
      }

      setCategorySeriesData({
        category: catName,
        sku_count: res.sku_count || 0,
        total_sales: res.total_sales || 0,
        periods: [...histPeriods, ...futureList]
      });
    } catch (err) {
      console.warn('Failed to load category series:', err);
    } finally {
      setIsLoadingCategorySeries(false);
    }
  }, [projectId, selectedLocation, approvalHorizon, seasonalityPattern, selectedItem?.modelType]);

  // Load category series whenever category mode is active and category is present
  useEffect(() => {
    if (forecastApproach === 'category' && selectedItem?.category) {
      loadCategorySeries(selectedItem.category);
    }
  }, [forecastApproach, selectedItem?.category, loadCategorySeries]);

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [treeSummaryMap, setTreeSummaryMap] = useState<Record<string, number>>({});
  const [isLoadingList, setIsLoadingList] = useState(false);

  // Reset on project or branch switch
  useEffect(() => {
    setPage(1);
    setTreeSearch('');
    setDebouncedSearch('');
    setSelectedCategory(null);
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

  // Workstream 6: Fetch true full-database SKU counts per Category / Location
  useEffect(() => {
    if (!projectId) return;
    api.getTreeSummary(projectId, {
      group_by: groupBy === 'item' ? 'category' : 'location',
      location: selectedLocation,
      search: debouncedSearch || undefined,
    }).then(res => {
      const map: Record<string, number> = {};
      (res.nodes || []).forEach(n => {
        if (n.name) map[n.name] = n.sku_count;
      });
      setTreeSummaryMap(map);
    }).catch(err => {
      console.warn('Failed to load tree summary:', err);
    });
  }, [projectId, groupBy, selectedLocation, debouncedSearch]);

  const fetchDemandPage = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingList(true);
    try {
      const res = await api.getDemand({
        projectId,
        page,
        pageSize,
        search: debouncedSearch,
        category: selectedCategory || undefined,
        location: selectedLocation,
        includeDormant: false
      });

      let effectiveHorizon = approvalHorizon || '12m';
      let effectiveSeasonality: string | number = seasonalityPattern || '12';
      let effectiveMinDate = projectDefaults.minActualDate;
      let effectiveMaxDate = projectDefaults.maxActualDate;

      if (res.project_defaults) {
        const normHorizon = res.project_defaults.approvalHorizon
          ? normalizeHorizonKey(res.project_defaults.approvalHorizon)
          : '12m';
        effectiveHorizon = normHorizon;
        effectiveSeasonality = res.project_defaults.seasonalityPeriod ?? res.project_defaults.seasonalityPattern ?? 12;
        effectiveMinDate = res.project_defaults.minActualDate || null;
        effectiveMaxDate = res.project_defaults.maxActualDate || null;

        const pd = {
          seasonalityPattern: String(res.project_defaults.seasonalityPattern || effectiveSeasonality),
          seasonalityPeriod: Number(res.project_defaults.seasonalityPeriod) || 12,
          forecastApproach: (res.project_defaults.forecastApproach === 'category' ? 'category' : 'item') as 'item' | 'category',
          approvalHorizon: normHorizon,
          minActualDate: effectiveMinDate,
          maxActualDate: effectiveMaxDate,
        };
        setProjectDefaults(pd);
        setApprovalHorizon(normHorizon);
        onProjectDefaultsLoaded?.(pd);
        if (onApprovalHorizonChange && settings?.forecast_horizon_periods !== normHorizon) {
          onApprovalHorizonChange(normHorizon);
        }
      }

      const dateBounds = { minActualDate: effectiveMinDate, maxActualDate: effectiveMaxDate };
      const hydrated = (res.items || []).map(i => {
        if (recalculateItem && shouldAutoRecalculateItem(i)) {
          return recalculateItem(i, undefined, undefined, effectiveHorizon, effectiveSeasonality, dateBounds);
        }
        return i;
      });
      setPaginatedItems(hydrated);
      setTotalCount(res.total_count ?? hydrated.length);
      setTotalPages(res.total_pages ?? Math.max(1, Math.ceil((res.total_count || 1) / pageSize)));
      const currentSelected = rawSelectedItemRef.current;
      if (hydrated.length > 0 && !currentSelected) {
        onSelectItem(hydrated[0]);
      } else if (currentSelected && recalculateItem) {
        const found = hydrated.find(x => x.id === currentSelected.id);
        if (found) {
          onSelectItem(shouldAutoRecalculateItem(found)
            ? recalculateItem(found, undefined, undefined, effectiveHorizon, effectiveSeasonality, dateBounds)
            : found
          );
        }
      }
    } catch (err) {
      console.warn('Failed to load server-side demand page:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, [projectId, page, pageSize, debouncedSearch, selectedCategory, onSelectItem, selectedLocation, recalculateItem, onProjectDefaultsLoaded, approvalHorizon, seasonalityPattern, projectDefaults.minActualDate, projectDefaults.maxActualDate, onApprovalHorizonChange, settings?.forecast_horizon_periods]);

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

  // Periods formatting (supports both SKU level and Category Aggregate level)
  const isCategoryMode = forecastApproach === 'category' && Boolean(categorySeriesData?.periods?.length);
  const periods = isCategoryMode ? (categorySeriesData?.periods || []) : (selectedItem?.periods || []);
  const maxActualDate = projectDefaults.maxActualDate 
    || settings?.max_actual_date 
    || periods.filter(p => (p.actual || 0) > 0).map(p => p.date).sort().pop() 
    || '2026-10';
  const isFuturePeriod = (p: TimeSeriesPeriod) => p.date > maxActualDate;
  const historicalPeriods = periods.filter(p => !isFuturePeriod(p));
  const futurePeriods = periods.filter(p => isFuturePeriod(p));

  // Auto-scroll horizontal demand table so recent actuals and upcoming forecast periods are centered on load
  useEffect(() => {
    if (firstFutureColRef.current) {
      firstFutureColRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }, [selectedItem?.id, periods.length]);

  // Chart data calculation
  const multiplier = chartMetric === 'revenue' ? (isCategoryMode ? 1 : (selectedItem?.salesPrice || 1)) : 1;
  const chartData = periods.map(p => {
    const isFuture = p.date > maxActualDate;
    const rawActual = p.actual ?? 0;
    const rawModel = p.model ?? 0;
    const rawForecast = p.override ?? p.forecast ?? 0;

    return {
      date: p.label || p.date,
      actual: !isFuture ? Math.round(rawActual * multiplier) : null,
      model: (!isFuture && visibleRows.model) ? Math.round(rawModel * multiplier) : null,
      forecast: (isFuture && visibleRows.forecast) ? Math.round(rawForecast * multiplier) : null,
      override: (isFuture && p.override !== undefined && p.override !== null) ? Math.round(p.override * multiplier) : null,
      confUpper: (isFuture && visibleRows.upperConf && p.confUpper !== undefined && p.confUpper !== null) ? Math.round(p.confUpper * multiplier) : null,
      confLower: (isFuture && visibleRows.lowerConf && p.confLower !== undefined && p.confLower !== null) ? Math.round(p.confLower * multiplier) : null,
    };
  });

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

  const handleForecastApproachChange = (val: 'item' | 'category') => {
    setForecastApproach(val);
    const label = val === 'item' ? (isAr ? 'مستوى الصنف' : 'Item level') : (isAr ? 'مستوى الفئة' : 'Category aggregate');

    setProjectDefaults(prev => ({ ...prev, forecastApproach: val }));
    setPaginatedItems(prev => prev.map(item => ({
      ...item,
      forecastApproach: val
    })));
    if (selectedItem) {
      const updated = { ...selectedItem, forecastApproach: val };
      onSelectItem(updated);
      onParameterChange && onParameterChange(selectedItem.id, { forecastApproach: val });
    }
    if (projectId) {
      api.updateForecastSettings(projectId, {
        scope: 'all',
        forecast_approach: val,
        item_id: selectedItem?.id
      }).catch(err => console.error('Failed to update global forecast approach:', err));
    }
    showToast(
      isAr 
        ? `تم تطبيق مستوى التنبؤ (${label}) على جميع أصناف المشروع`
        : `Forecast level (${label}) applied to all project items`
    );
  };

  const handleSeasonalityPatternChange = (val: string) => {
    setSeasonalityPattern(val);
    const numVal = Number(val);
    const newModelType: ModelType = (val === '4' || val === '12') ? 'seasonal' : 'auto';
    const label = val === '12' 
      ? (isAr ? '12 فترة (سنوي)' : '12 periods (Annual)') 
      : val === '4' 
      ? (isAr ? '4 فترات (ربعي)' : '4 periods (Quarterly)') 
      : (isAr ? 'بدون موسمية' : 'No seasonality');

    // 1. Update projectDefaults immediately
    setProjectDefaults(prev => ({ ...prev, seasonalityPattern: val, seasonalityPeriod: numVal }));

    const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
    const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };

    // 2. Fast project-wide memory update across all loaded items
    setPaginatedItems(prev => prev.map(item => {
      const oldNotes = (item.notes || '').replace(/seasonality:[0-9]+\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} seasonality:${val}` : `seasonality:${val}`;
      const updated: InventoryItem = {
        ...item,
        modelType: newModelType,
        seasonalityPattern: val,
        seasonalityPeriod: numVal,
        notes: updatedNotes
      };
      return recalculateItem ? recalculateItem(updated, undefined, undefined, effHorizon, val, dateBounds) : updated;
    }));

    if (selectedItem) {
      const oldNotes = (selectedItem.notes || '').replace(/seasonality:[0-9]+\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} seasonality:${val}` : `seasonality:${val}`;
      const updatedSelected: InventoryItem = {
        ...selectedItem,
        modelType: newModelType,
        seasonalityPattern: val,
        seasonalityPeriod: numVal,
        notes: updatedNotes
      };
      const fullyRecalculated = recalculateItem ? recalculateItem(updatedSelected, undefined, undefined, effHorizon, val, dateBounds) : updatedSelected;
      onSelectItem(fullyRecalculated);
      onParameterChange && onParameterChange(selectedItem.id, {
        modelType: newModelType,
        seasonalityPattern: val,
        seasonalityPeriod: numVal,
        notes: updatedNotes
      });
    }

    if (projectId) {
      api.updateForecastSettings(projectId, {
        scope: 'all',
        seasonality_period: val,
        model_type: newModelType,
        item_id: selectedItem?.id
      }).catch(err => console.error('Failed to update global seasonality in DuckDB:', err));
    }

    showToast(
      isAr 
        ? `تم تطبيق نمط الموسمية (${label}) على جميع أصناف المشروع بنجاح`
        : `Seasonality pattern (${label}) applied to all project items successfully`
    );
  };

  const handleApprovalHorizonChange = (val: string) => {
    const normVal = normalizeHorizonKey(val);
    setApprovalHorizon(normVal);

    // 1. Update projectDefaults immediately
    setProjectDefaults(prev => ({ ...prev, approvalHorizon: normVal }));

    // 2. Update settings in App.tsx if listener provided
    onApprovalHorizonChange && onApprovalHorizonChange(normVal);

    const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
    const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };

    // 3. Fast project-wide memory update across all loaded items
    setPaginatedItems(prev => prev.map(item => {
      const oldNotes = (item.notes || '').replace(/approvalHorizon:[0-9a-zA-Z]+\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} approvalHorizon:${normVal}` : `approvalHorizon:${normVal}`;
      const updated: InventoryItem = {
        ...item,
        approvalHorizon: normVal,
        notes: updatedNotes
      };
      return recalculateItem ? recalculateItem(updated, undefined, undefined, normVal, effSeason, dateBounds) : updated;
    }));

    if (selectedItem) {
      const oldNotes = (selectedItem.notes || '').replace(/approvalHorizon:[0-9a-zA-Z]+\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} approvalHorizon:${normVal}` : `approvalHorizon:${normVal}`;
      const updatedSelected: InventoryItem = {
        ...selectedItem,
        approvalHorizon: normVal,
        notes: updatedNotes
      };
      const fullyRecalculated = recalculateItem ? recalculateItem(updatedSelected, undefined, undefined, normVal, effSeason, dateBounds) : updatedSelected;
      onSelectItem(fullyRecalculated);
      onParameterChange && onParameterChange(selectedItem.id, {
        approvalHorizon: normVal,
        notes: updatedNotes
      });
    }

    if (projectId) {
      api.updateForecastSettings(projectId, {
        scope: 'all',
        approval_horizon: normVal,
        item_id: selectedItem?.id
      }).catch(err => console.error('Failed to update global approval horizon in DuckDB:', err));
    }

    showToast(
      isAr 
        ? 'تم تطبيق أفق الاعتماد لكافة الأصناف وحفظه كإعداد افتراضي للمشروع' 
        : 'Approval horizon applied to all project items and saved as default'
    );
  };

  const handleToggleIgnoreZeroSales = () => {
    const next = !ignoreZeroSales;
    setIgnoreZeroSales(next);

    const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
    const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
    const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };

    setPaginatedItems(prev => prev.map(item => {
      const oldNotes = (item.notes || '').replace(/ignoreZeroSales:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} ignoreZeroSales:${next}` : `ignoreZeroSales:${next}`;
      const updated: InventoryItem = { ...item, notes: updatedNotes };
      return recalculateItem ? recalculateItem(updated, undefined, undefined, effHorizon, effSeason, dateBounds) : updated;
    }));

    if (selectedItem) {
      const oldNotes = (selectedItem.notes || '').replace(/ignoreZeroSales:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} ignoreZeroSales:${next}` : `ignoreZeroSales:${next}`;
      const updatedSelected: InventoryItem = { ...selectedItem, notes: updatedNotes };
      const fullyRecalculated = recalculateItem ? recalculateItem(updatedSelected, undefined, undefined, effHorizon, effSeason, dateBounds) : updatedSelected;
      onSelectItem(fullyRecalculated);
      onParameterChange && onParameterChange(selectedItem.id, { notes: updatedNotes });
    }

    showToast(
      isAr
        ? `تم ${next ? 'تفعيل' : 'تعطيل'} تجاهل المبيعات الصفرية لكافة الأصناف`
        : `Ignore zero sales ${next ? 'enabled' : 'disabled'} for all project items`
    );
  };

  const handleToggleIgnoreStockoutDays = () => {
    const next = !ignoreStockoutDays;
    setIgnoreStockoutDays(next);

    const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
    const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
    const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };

    setPaginatedItems(prev => prev.map(item => {
      const oldNotes = (item.notes || '').replace(/ignoreStockoutDays:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} ignoreStockoutDays:${next}` : `ignoreStockoutDays:${next}`;
      const updated: InventoryItem = { ...item, notes: updatedNotes };
      return recalculateItem ? recalculateItem(updated, undefined, undefined, effHorizon, effSeason, dateBounds) : updated;
    }));

    if (selectedItem) {
      const oldNotes = (selectedItem.notes || '').replace(/ignoreStockoutDays:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} ignoreStockoutDays:${next}` : `ignoreStockoutDays:${next}`;
      const updatedSelected: InventoryItem = { ...selectedItem, notes: updatedNotes };
      const fullyRecalculated = recalculateItem ? recalculateItem(updatedSelected, undefined, undefined, effHorizon, effSeason, dateBounds) : updatedSelected;
      onSelectItem(fullyRecalculated);
      onParameterChange && onParameterChange(selectedItem.id, { notes: updatedNotes });
    }

    showToast(
      isAr
        ? `تم ${next ? 'تفعيل' : 'تعطيل'} تجاهل أيام النفاد لكافة الأصناف`
        : `Ignore stockout days ${next ? 'enabled' : 'disabled'} for all project items`
    );
  };

  const handleToggleUseHolidays = () => {
    const next = !useHolidays;
    setUseHolidays(next);

    const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
    const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
    const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };

    setPaginatedItems(prev => prev.map(item => {
      const oldNotes = (item.notes || '').replace(/useHolidays:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} useHolidays:${next}` : `useHolidays:${next}`;
      const updated: InventoryItem = { ...item, notes: updatedNotes };
      return recalculateItem ? recalculateItem(updated, undefined, undefined, effHorizon, effSeason, dateBounds) : updated;
    }));

    if (selectedItem) {
      const oldNotes = (selectedItem.notes || '').replace(/useHolidays:(true|false)\s*/g, '').trim();
      const updatedNotes = oldNotes ? `${oldNotes} useHolidays:${next}` : `useHolidays:${next}`;
      const updatedSelected: InventoryItem = { ...selectedItem, notes: updatedNotes };
      const fullyRecalculated = recalculateItem ? recalculateItem(updatedSelected, undefined, undefined, effHorizon, effSeason, dateBounds) : updatedSelected;
      onSelectItem(fullyRecalculated);
      onParameterChange && onParameterChange(selectedItem.id, { notes: updatedNotes });
    }

    showToast(
      isAr
        ? `تم ${next ? 'تفعيل' : 'تعطيل'} مراعاة العطلات الرسمية لكافة الأصناف`
        : `Account for official holidays ${next ? 'enabled' : 'disabled'} for all project items`
    );
  };

  const stickyColClass = isAr 
    ? 'sticky right-0 z-20 border-l border-slate-200 text-right shadow-[1px_0_3px_rgba(0,0,0,0.05)]' 
    : 'sticky left-0 z-20 border-r border-slate-200 text-left shadow-[-1px_0_3px_rgba(0,0,0,0.05)]';

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

          {selectedCategory && (
            <div className="flex items-center justify-between px-2 py-1 bg-blue-50 text-blue-800 text-[10px] font-medium rounded border border-blue-200">
              <span className="truncate">{isAr ? `تصفية: ${selectedCategory}` : `Filter: ${selectedCategory}`}</span>
              <button 
                onClick={() => { setSelectedCategory(null); setPage(1); }} 
                className="font-bold text-rose-600 hover:text-rose-800 cursor-pointer ml-1 text-xs"
                title={isAr ? 'إلغاء التصفية' : 'Clear filter'}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Middle: Hierarchical Item/Category Tree */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {Object.entries(categories).map(([catName, catItems]) => {
            const isExpanded = expandedCategories[catName] !== false;
            const fullCount = treeSummaryMap[catName] ?? catItems.length;
            const isCategorySelected = selectedCategory === catName;

            return (
              <div key={catName} className="space-y-0.5">
                {!hideCategories && (
                  <div className={`w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-bold rounded transition ${
                    isCategorySelected 
                      ? 'bg-blue-100 text-blue-900 border border-blue-300' 
                      : 'text-slate-700 hover:bg-[#E2E8F0]'
                  }`}>
                    <button
                      onClick={() => toggleCategory(catName)}
                      className="flex items-center gap-1.5 flex-1 text-left truncate cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate flex-1">{catName}</span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({fullCount.toLocaleString()})
                      </span>
                      <button
                        title={isCategorySelected ? (isAr ? 'إلغاء تصفية التصنيف' : 'Clear category filter') : (isAr ? 'تصفية بهذا التصنيف' : 'Filter by category')}
                        onClick={() => {
                          setSelectedCategory(prev => prev === catName ? null : catName);
                          setPage(1);
                        }}
                        className={`p-0.5 rounded text-[10px] cursor-pointer hover:bg-blue-200 transition ${
                          isCategorySelected ? 'text-blue-700 font-black' : 'text-slate-400 hover:text-slate-700'
                        }`}
                      >
                        <Filter className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
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
                            const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
                            const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
                            const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };
                            const recalculated = (recalculateItem && shouldAutoRecalculateItem(item))
                              ? recalculateItem(item, undefined, undefined, effHorizon, effSeason, dateBounds)
                              : item;
                            onSelectItem(recalculated);
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
                          {isAllLocations && groupBy !== 'location' && item.location && (
                            <span 
                              title={item.location}
                              className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded shrink-0 max-w-[68px] truncate ${
                                isSelected
                                  ? 'bg-white/20 text-white border border-white/30'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                              }`}
                            >
                              {item.location}
                            </span>
                          )}
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
            {selectedItem.location && (
              <span 
                title={selectedItem.location}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 shrink-0"
              >
                <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate max-w-[150px]">{selectedItem.location}</span>
              </span>
            )}
            {isCategoryMode && categorySeriesData && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] bg-amber-100 text-amber-900 font-bold border border-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span>
                  {isAr 
                    ? `تنبؤ مجمع للفئة: ${selectedItem.category} (${categorySeriesData.sku_count} صنف)` 
                    : `Category Forecast: ${selectedItem.category} (${categorySeriesData.sku_count} SKUs)`}
                </span>
                <button
                  onClick={() => handleForecastApproachChange('item')}
                  className="ml-1 text-[9px] text-amber-800 hover:text-black underline cursor-pointer"
                  title={isAr ? 'العودة لمستوى الصنف' : 'Return to item level'}
                >
                  ({isAr ? 'إلغاء' : 'Reset'})
                </button>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsQuickSearchOpen(true)}
              title={t.demand.centerToolbar.search}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#E2E8F0] text-slate-600 cursor-pointer transition active:scale-95"
            >
              <Search className="w-3 h-3 text-slate-400" />
              <span>{t.demand.centerToolbar.search}</span>
            </button>
            <button 
              onClick={() => setIsSettingsModalOpen(true)}
              title={t.demand.centerToolbar.settings}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#E2E8F0] text-slate-600 cursor-pointer transition active:scale-95"
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
                <th className={`w-44 ${stickyColClass} z-30 bg-[#ECEFF1]`}>
                  {isAr ? 'نوع البيانات / الفترة' : 'Series / Period'}
                </th>
                {periods.map((p, idx) => {
                  const isFuture = p.date > maxActualDate;
                  const isFirstFuture = idx === historicalPeriods.length;
                  return (
                    <th 
                      key={p.date} 
                      ref={isFirstFuture ? firstFutureColRef : undefined}
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
                  {periods.map(p => {
                    const isFuture = p.date > maxActualDate;
                    return (
                      <td key={p.date} className="font-mono text-slate-700">
                        {isFuture ? '-' : (p.actual || 0).toLocaleString()}
                      </td>
                    );
                  })}
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
                  <td className={`font-bold ${stickyColClass} bg-[#EFF6FF]`}>
                    {t.demand.gridRows.forecast}
                  </td>
                  {periods.map(p => {
                    const isHistorical = p.date <= maxActualDate;
                    if (isHistorical) {
                      return (
                        <td key={p.date} className="font-mono text-slate-300 font-normal">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={p.date} className="font-mono">
                        {p.forecast !== undefined && p.forecast !== null ? p.forecast.toLocaleString() : '—'}
                      </td>
                    );
                  })}
                </tr>
              )}

              {/* Row 4: Forecast override (INLINE EDITABLE + DuckDB PERSISTENCE) */}
              {visibleRows.override && (
                <tr className="bg-amber-50/30 text-amber-900 hover:bg-amber-50/60">
                  <td className={`font-semibold ${stickyColClass} bg-[#FFFBEB]`}>
                    {t.demand.gridRows.override}
                  </td>
                  {periods.map(p => {
                    const isFuture = p.date > maxActualDate;
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
                  domain={[0, 'auto']}
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
                  onClick={() => {
                    const nextStatus = modelStatus === 'active' ? 'inactive' : 'active';
                    setModelStatus(nextStatus);
                    const nextCheck = nextStatus === 'active' ? 'checked' : 'undecided';
                    onParameterChange && onParameterChange(selectedItem.id, { 
                      modelStatus: nextStatus, 
                      status: nextStatus, 
                      checkState: nextCheck 
                    });
                  }}
                  className={`font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer transition ${
                    modelStatus === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {modelStatus === 'active' ? t.demand.inspector.yes : t.demand.inspector.no}
                </button>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.forecastApproach}</span>
                <select
                  value={forecastApproach}
                  onChange={e => handleForecastApproachChange(e.target.value as 'item' | 'category')}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white cursor-pointer"
                >
                  <option value="item">{isAr ? 'مستوى الصنف' : 'Item level'}</option>
                  <option value="category">{isAr ? 'مستوى الفئة' : 'Category aggregate'}</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.seasonalityPattern}</span>
                <select
                  value={seasonalityPattern}
                  onChange={e => handleSeasonalityPatternChange(e.target.value)}
                  className="px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-slate-800 text-[10px] bg-white cursor-pointer"
                >
                  <option value="12">{isAr ? '12 فترة (سنوي)' : '12 periods (Annual)'}</option>
                  <option value="4">{isAr ? '4 فترات (ربعي)' : '4 periods (Quarterly)'}</option>
                  <option value="0">{isAr ? 'لا يوجد موسمية' : 'No seasonality'}</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-[#F1F5F9]">
                <span className="text-slate-500">{t.demand.inspector.ignoreZeroSales}</span>
                <button
                  onClick={handleToggleIgnoreZeroSales}
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
                  onClick={handleToggleIgnoreStockoutDays}
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
                  onClick={handleToggleUseHolidays}
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
                  onChange={e => handleApprovalHorizonChange(e.target.value)}
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

      {/* Quick Full-DB SKU / Category Search Modal */}
      {isQuickSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#CBD5E1] rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col text-[#1E293B] max-h-[85vh]">
            <div className="p-3 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-[#2196F3]" />
                <span className="font-bold text-xs text-slate-800">
                  {isAr ? 'بحث سريع عن الأصناف والفئات (DuckDB)' : 'Quick SKU & Category Search (DuckDB)'}
                </span>
                <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-mono">
                  {isAr ? 'بحث مباشر عبر كامل المشروع' : 'Full-Database Search'}
                </span>
              </div>
              <button 
                onClick={() => setIsQuickSearchOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-[#E2E8F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#E2E8F0] bg-white">
              <div className="relative">
                <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={quickSearchTerm}
                  onChange={e => setQuickSearchTerm(e.target.value)}
                  placeholder={isAr ? 'اكتب كود الصنف أو الوصف أو الفئة للبحث المباشر في قاعدة البيانات...' : 'Type SKU code, description, or category to query DuckDB directly...'}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:border-[#2196F3] focus:outline-none focus:ring-1 focus:ring-[#2196F3] bg-slate-50/50"
                />
                {isQuickSearching && (
                  <div className="absolute top-2.5 right-3 text-[10px] text-blue-600 font-medium animate-pulse">
                    {isAr ? 'جاري البحث في DuckDB...' : 'Searching DuckDB...'}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 min-h-[260px] max-h-[380px]">
              {quickSearchResults.length > 0 ? (
                <div className="space-y-1">
                  {quickSearchResults.map(item => (
                    <div
                      key={item.id}
                      onClick={() => {
                        const effHorizon = approvalHorizon || projectDefaults.approvalHorizon || '12m';
                        const effSeason = seasonalityPattern || projectDefaults.seasonalityPattern || '12';
                        const dateBounds = { minActualDate: projectDefaults.minActualDate, maxActualDate: projectDefaults.maxActualDate };
                        const recalculated = (recalculateItem && shouldAutoRecalculateItem(item))
                          ? recalculateItem(item, undefined, undefined, effHorizon, effSeason, dateBounds)
                          : item;
                        onSelectItem(recalculated);
                        if (item.category) setSelectedCategory(item.category);
                        setIsQuickSearchOpen(false);
                      }}
                      className="flex items-center justify-between p-2 rounded-lg border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-mono text-xs font-bold text-[#2196F3] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          {formatItemCode(item.code)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-slate-800 truncate flex items-center gap-1.5">
                            <span className="truncate">{item.description}</span>
                            {isAllLocations && item.location && (
                              <span 
                                title={item.location}
                                className="text-[9.5px] font-medium px-1.5 py-0.5 rounded shrink-0 max-w-[80px] truncate bg-slate-100 text-slate-600 border border-slate-200/80"
                              >
                                {item.location}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{item.category}</span>
                            {item.location && !isAllLocations && (
                              <>
                                <span>•</span>
                                <span>{item.location}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-[11px] font-mono shrink-0 pl-3">
                        <div className="text-slate-700 font-semibold">{isAr ? `مخزون: ${item.onHand.toLocaleString()}` : `Stock: ${item.onHand.toLocaleString()}`}</div>
                        <div className="text-slate-400 text-[10px]">{item.abcClass}{item.xyzClass}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : quickSearchTerm.trim() ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs">
                  <p>{isAr ? 'لم يتم العثور على نتائج مطابقة' : 'No matching items found'}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs text-center space-y-2">
                  <Search className="w-8 h-8 text-slate-300 stroke-[1.5]" />
                  <p>{isAr ? 'اكتب كلمة البحث للوصول المباشر إلى أي صنف في المشروع' : 'Start typing to search across all SKUs in this project'}</p>
                  <button
                    onClick={() => {
                      setIsQuickSearchOpen(false);
                      treeSearchRef.current?.focus();
                    }}
                    className="mt-2 text-xs text-[#2196F3] hover:underline cursor-pointer"
                  >
                    {isAr ? 'أو التركيز على شجرة التصنيفات الجانبية' : 'Or focus sidebar category tree'}
                  </button>
                </div>
              )}
            </div>

            <div className="p-3 bg-[#F8F9FA] border-t border-[#E2E8F0] flex items-center justify-between text-xs">
              <button
                onClick={() => {
                  setIsQuickSearchOpen(false);
                  treeSearchRef.current?.focus();
                  if (quickSearchTerm) setTreeSearch(quickSearchTerm);
                }}
                className="text-[#2196F3] hover:underline cursor-pointer font-medium"
              >
                {isAr ? 'تطبيق البحث على الشجرة الجانبية' : 'Apply to sidebar tree'}
              </button>
              <button
                onClick={() => setIsQuickSearchOpen(false)}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded cursor-pointer font-medium text-xs"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Demand & Forecast Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#CBD5E1] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col text-[#1E293B]">
            <div className="p-3 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#2196F3]" />
                <span className="font-bold text-xs text-slate-800">
                  {isAr ? 'إعدادات التنبؤ والطلب' : 'Demand & Forecast Settings'}
                </span>
              </div>
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-[#E2E8F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'أفق التنبؤ الافتراضي' : 'Default Forecast Horizon'}
                </label>
                <select
                  value={modalHorizon}
                  onChange={e => setModalHorizon(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                >
                  <option value="1m">{isAr ? 'شهر واحد (1M)' : '1 Month (1M)'}</option>
                  <option value="3m">{isAr ? '3 أشهر (ربع سنوي)' : '3 Months (Quarterly)'}</option>
                  <option value="6m">{isAr ? '6 أشهر (نصف سنوي)' : '6 Months (Bi-Annual)'}</option>
                  <option value="12m">{isAr ? '12 شهر (سنة كاملة)' : '12 Months (Annual)'}</option>
                  <option value="24m">{isAr ? '24 شهر (سنتان)' : '24 Months (2 Years)'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'النموذج الإحصائي الافتراضي' : 'Default Statistical Model'}
                </label>
                <select
                  value={modalModel}
                  onChange={e => setModalModel(e.target.value as ModelType)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                >
                  <option value="auto">{isAr ? 'اختيار آلي ذكي (Auto Model Selection)' : 'Auto Model Selection'}</option>
                  <option value="seasonal">{isAr ? 'هولت-وينترز الموسمي (Holt-Winters Seasonal)' : 'Holt-Winters Seasonal'}</option>
                  <option value="linear">{isAr ? 'انحدار خطي واتجاه (Linear Trend OLS)' : 'Linear Trend'}</option>
                  <option value="constant">{isAr ? 'مستوى ثابت ومتوسط متحرك (Constant Level)' : 'Constant Level'}</option>
                  <option value="intermittent">{isAr ? 'طلب متقطع كروستون (Croston SBA)' : 'Croston Intermittent'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'نمط الموسمية الافتراضي' : 'Default Seasonality Pattern'}
                </label>
                <select
                  value={modalSeasonality}
                  onChange={e => setModalSeasonality(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                >
                  <option value="12">{isAr ? '12 فترة (دورة سنوية)' : '12 Periods (Annual Cycle)'}</option>
                  <option value="4">{isAr ? '4 فترات (دورة ربع سنوية)' : '4 Periods (Quarterly Cycle)'}</option>
                  <option value="0">{isAr ? 'بدون موسمية (تعطيل المؤشرات الموسمية)' : 'No Seasonality'}</option>
                </select>
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                <button
                  disabled={isRecalculatingAll}
                  onClick={async () => {
                    setIsRecalculatingAll(true);
                    try {
                      // Apply horizon / seasonality to active item & reload
                      if (selectedItem) {
                        const notes = `${selectedItem.notes || ''} approvalHorizon:${modalHorizon} seasonality:${modalSeasonality}`.trim();
                        onParameterChange && onParameterChange(selectedItem.id, {
                          modelType: modalModel,
                          seasonalityPattern: modalSeasonality,
                          seasonalityPeriod: Number(modalSeasonality),
                          notes
                        });
                      }
                      if (projectId) {
                        setProjectDefaults(prev => ({
                          ...prev,
                          seasonalityPattern: modalSeasonality,
                          seasonalityPeriod: Number(modalSeasonality),
                          approvalHorizon: modalHorizon
                        }));
                        setApprovalHorizon(modalHorizon);
                        setSeasonalityPattern(modalSeasonality);
                        onApprovalHorizonChange && onApprovalHorizonChange(modalHorizon);
                        await api.updateForecastSettings(projectId, {
                          scope: 'all',
                          seasonality_period: modalSeasonality,
                          approval_horizon: modalHorizon,
                          model_type: modalModel,
                          item_id: selectedItem?.id
                        }).catch(err => console.error('Failed to update project forecast settings:', err));
                      }
                      await fetchDemandPage();
                      setIsSettingsModalOpen(false);
                      showToast(
                        isAr 
                          ? 'تم حفظ معلمات التنبؤ وتطبيقها على جميع أصناف المشروع' 
                          : 'Forecast parameters saved and applied to all project SKUs'
                      );
                    } finally {
                      setIsRecalculatingAll(false);
                    }
                  }}
                  className="w-full py-2 px-3 bg-[#2196F3] hover:bg-blue-600 text-white font-bold rounded-lg text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isRecalculatingAll ? (
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5" />
                  )}
                  <span>{isAr ? 'تطبيق وإعادة حساب التنبؤ' : 'Apply & Recalculate Forecast'}</span>
                </button>

                {onOpenSettings && (
                  <button
                    onClick={() => {
                      setIsSettingsModalOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer"
                  >
                    {isAr ? 'فتح إعدادات النظام الشاملة...' : 'Open Full System Settings...'}
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 bg-[#F8F9FA] border-t border-[#E2E8F0] flex justify-end">
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scope Synchronization Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900/90 backdrop-blur-md text-white text-xs font-medium rounded-xl shadow-xl border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button 
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
