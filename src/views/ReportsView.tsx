import React, { useState, useMemo } from 'react';
import { InventoryItem, AppSettings } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { 
  FileSpreadsheet, 
  Search, 
  Settings, 
  Download, 
  Filter, 
  Calendar,
  Layers,
  TrendingUp,
  Package,
  DollarSign,
  Network,
  X,
  Plus,
  Check
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ReportsViewProps {
  items: InventoryItem[];
  settings?: AppSettings;
  language: Language;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  items,
  settings,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';
  const currSym = getCurrencySymbol(settings?.currency_code || 'EGP', language);

  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'summary'>('all');
  const [reportType, setReportType] = useState<'replenishment' | 'projectedStock' | 'accuracy' | 'drp' | 'abc' | 'bom'>('replenishment');
  const [periodHorizon, setPeriodHorizon] = useState<'next6' | 'next12' | 'past12'>('next6');
  const [searchTerm, setSearchTerm] = useState('');

  // Advanced Filter Modal State
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterLocation, setFilterLocation] = useState<string>('all');
  const [filterAbc, setFilterAbc] = useState<string>('all');
  const [filterStockStatus, setFilterStockStatus] = useState<'all' | 'stockout' | 'overstock' | 'reorder'>('all');

  const uniqueCategories = useMemo(() => Array.from(new Set(items.map(i => i.category || 'General'))), [items]);
  const uniqueLocations = useMemo(() => Array.from(new Set(items.map(i => i.location || 'Central'))), [items]);

  const hasActiveAdvancedFilters = filterCategory !== 'all' || filterLocation !== 'all' || filterAbc !== 'all' || filterStockStatus !== 'all';

  const clearAdvancedFilters = () => {
    setFilterCategory('all');
    setFilterLocation('all');
    setFilterAbc('all');
    setFilterStockStatus('all');
  };

  // Dynamic period dates extraction
  const futurePeriodDates = useMemo(() => {
    const dates = new Set<string>();
    items.forEach(i => {
      (i.periods || []).forEach(p => {
        if ((p.actual || 0) === 0) dates.add(p.date);
      });
    });
    return Array.from(dates);
  }, [items]);

  const historyPeriodDates = useMemo(() => {
    const dates = new Set<string>();
    items.forEach(i => {
      (i.periods || []).forEach(p => {
        if ((p.actual || 0) > 0) dates.add(p.date);
      });
    });
    return Array.from(dates);
  }, [items]);

  const activePeriodColumns = useMemo(() => {
    if (periodHorizon === 'next6') {
      const slice = futurePeriodDates.slice(0, 6);
      return slice.length > 0 ? slice : ['M+1', 'M+2', 'M+3', 'M+4', 'M+5', 'M+6'];
    } else if (periodHorizon === 'next12') {
      const slice = futurePeriodDates.slice(0, 12);
      return slice.length > 0 ? slice : Array.from({ length: 12 }, (_, i) => `M+${i + 1}`);
    } else {
      const slice = historyPeriodDates.slice(-12);
      return slice.length > 0 ? slice : Array.from({ length: 12 }, (_, i) => `Hist-${12 - i}`);
    }
  }, [periodHorizon, futurePeriodDates, historyPeriodDates]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(i => {
      const matchesSearch = !searchTerm || 
        i.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
        i.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.location.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (filterCategory !== 'all' && i.category !== filterCategory) return false;
      if (filterLocation !== 'all' && i.location !== filterLocation) return false;
      if (filterAbc !== 'all' && (i.abcClass || 'C').toUpperCase() !== filterAbc) return false;

      if (filterStockStatus === 'stockout' && !(i.isStockout || i.onHand <= 0)) return false;
      if (filterStockStatus === 'overstock' && !i.isOverstock) return false;
      if (filterStockStatus === 'reorder' && (i.orderNow || 0) <= 0) return false;

      return true;
    });
  }, [items, searchTerm, filterCategory, filterLocation, filterAbc, filterStockStatus]);

  // Projected stock calculator per item
  const calculateProjectedStockArray = (item: InventoryItem): number[] => {
    let current = item.onHand;
    const isPast = periodHorizon === 'past12';
    
    return activePeriodColumns.map((colName, idx) => {
      const p = (item.periods || []).find(x => x.date === colName);
      if (isPast) {
        return p?.actual ?? 0;
      }
      const demand = p ? (p.override ?? p.forecast ?? p.model ?? 0) : 0;
      const receipt = idx === 0 ? (item.onOrder || 0) : 0;
      current = Math.max(0, current - demand + receipt);
      return current;
    });
  };

  const handleExportReport = () => {
    const wb = XLSX.utils.book_new();
    let exportData: any[] = [];

    if (reportType === 'replenishment') {
      exportData = filteredItems.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'Location': i.location,
        'Supplier': i.supplier,
        'On Hand': i.onHand,
        'On Order': i.onOrder,
        'Safety Stock': i.safetyStock,
        'ROP': i.reorderPoint,
        'Order Now': i.orderNow || 0,
        [`Unit Cost (${currSym})`]: i.purchasePrice,
        [`Total Order Value (${currSym})`]: i.orderNowValue || 0,
        'Approval': i.approvalState,
      }));
    } else if (reportType === 'projectedStock') {
      exportData = filteredItems.map(i => {
        const projections = calculateProjectedStockArray(i);
        const minStock = projections.length > 0 ? Math.min(...projections) : i.onHand;
        const row: Record<string, any> = {
          'Item Code': i.code,
          'Description': i.description,
          'Location': i.location,
          'On Hand': i.onHand,
        };
        activePeriodColumns.forEach((col, idx) => {
          row[col] = projections[idx] ?? 0;
        });
        row['Projected Min Stock'] = minStock;
        return row;
      });
    } else if (reportType === 'accuracy') {
      exportData = filteredItems.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'Model Applied': i.fittedModelType || i.modelType,
        'WMAPE (%)': i.wmape?.toFixed(2),
        'MAPE (%)': i.mape?.toFixed(2),
        'Forecast Accuracy (%)': i.accuracy?.toFixed(2),
      }));
    } else if (reportType === 'abc') {
      exportData = filteredItems.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'ABC Class': i.abcClass,
        'XYZ Class': i.xyzClass,
        [`Sales Price (${currSym})`]: i.salesPrice,
        'Turnover Ratio': i.turnoverRatio,
        [`Inventory Value (${currSym})`]: i.inventoryValue,
      }));
    } else if (reportType === 'drp') {
      exportData = filteredItems.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'Location': i.location,
        'DC Hub': i.dc ? 'Yes' : 'No',
        'On Hand': i.onHand,
        'Safety Stock': i.safetyStock,
        'Transfer Qty': i.transferQty || 0,
        'Transfer Source': i.transferSource || '-',
        'Order Now': i.orderNow || 0,
      }));
    } else {
      exportData = filteredItems.map(i => ({
        'Item Code': i.code,
        'Description': i.description,
        'BOM Type': i.bomType || 'Material',
        'On Hand': i.onHand,
        'Order Now': i.orderNow || 0,
        'Lead Time': i.leadTimeDays,
      }));
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `NEXO_${reportType}_${periodHorizon}_Report.xlsx`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8F9FA] select-none text-[#1E293B] text-[12px]">
      {/* 1. Filter Tabs */}
      <div className="flex items-center justify-between px-3 h-8 bg-[#ECEFF1] border-b border-[#CBD5E1] shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveFilterTab('all')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'all'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-[#2196F3] shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.reports.filterTabs.all} ({filteredItems.length})
          </button>
          <button
            onClick={() => setActiveFilterTab('summary')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'summary'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-[#2196F3] shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.reports.filterTabs.summary}
          </button>
          
          <button 
            onClick={() => setIsFilterModalOpen(true)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded transition cursor-pointer font-medium ${
              hasActiveAdvancedFilters
                ? 'bg-blue-100 text-[#2196F3] font-bold border border-blue-300'
                : 'text-slate-600 hover:text-slate-900 hover:bg-[#E2E8F0]'
            }`}
          >
            <Filter className="w-3 h-3" />
            <span>{t.reports.filterTabs.newFilter}</span>
            {hasActiveAdvancedFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#2196F3]" />
            )}
          </button>

          {hasActiveAdvancedFilters && (
            <button
              onClick={clearAdvancedFilters}
              title={isAr ? 'إلغاء التصفية' : 'Clear Filters'}
              className="text-[10px] text-slate-400 hover:text-rose-600 flex items-center gap-0.5 ml-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>{isAr ? 'مسح التصفية' : 'Clear'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Toolbar */}
      <div className="flex items-center justify-between px-3 h-9 bg-white border-b border-[#D1D5DB] shrink-0 text-[11px] font-medium text-slate-700">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t.reports.toolbar.search}
              className="pl-7 pr-2 py-1 text-[11px] border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] bg-white w-44"
            />
          </div>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Report Type Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">{t.reports.toolbar.reportType}:</span>
            <select
              value={reportType}
              onChange={e => setReportType(e.target.value as any)}
              className="px-2.5 py-1 border border-[#CBD5E1] rounded text-[11px] font-semibold text-slate-800 bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
            >
              <option value="replenishment">{t.reports.types.replenishment}</option>
              <option value="projectedStock">{t.reports.types.projectedStock}</option>
              <option value="accuracy">{t.reports.types.accuracy}</option>
              <option value="drp">{t.reports.types.drp}</option>
              <option value="abc">{t.reports.types.abc}</option>
              <option value="bom">{t.reports.types.bom}</option>
            </select>
          </div>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Period Horizon Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">{t.reports.toolbar.period}:</span>
            <select
              value={periodHorizon}
              onChange={e => setPeriodHorizon(e.target.value as any)}
              className="px-2 py-1 border border-[#CBD5E1] rounded text-[11px] font-medium text-slate-700 bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
            >
              <option value="next6">{t.reports.periods.next6}</option>
              <option value="next12">{t.reports.periods.next12}</option>
              <option value="past12">{t.reports.periods.past12}</option>
            </select>
          </div>
        </div>

        {/* Export Button */}
        <div>
          <button
            onClick={handleExportReport}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#2196F3] text-white font-semibold rounded hover:bg-blue-600 transition shadow-xs text-[11px] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.reports.toolbar.exportReport}</span>
          </button>
        </div>
      </div>

      {/* 3. Analytical Table */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="nexo-grid w-full text-right">
          <thead>
            <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10 text-[11px]">
              <th className="text-left w-28 sticky left-0 bg-[#ECEFF1] z-20 border-r border-[#CBD5E1]">
                {t.inventory.table.code}
              </th>
              <th className="text-left min-w-[180px]">{t.inventory.table.desc}</th>
              
              {reportType === 'replenishment' && (
                <>
                  <th className="text-left min-w-[90px]">{t.inventory.table.location}</th>
                  <th className="text-left min-w-[120px]">{t.common.supplier}</th>
                  <th className="min-w-[70px]">{t.inventory.table.onHand}</th>
                  <th className="min-w-[70px]">{t.inventory.table.safetyStock}</th>
                  <th className="min-w-[70px] bg-sky-50 text-sky-900">{t.inventory.table.rop}</th>
                  <th className="min-w-[80px] bg-amber-50 text-amber-900 font-bold">{t.inventory.table.orderNow}</th>
                  <th className="min-w-[80px]">Unit Cost ({currSym})</th>
                  <th className="min-w-[90px] bg-amber-50 text-amber-900 font-bold">{t.inventory.table.orderValue}</th>
                  <th className="text-center min-w-[80px]">{t.inventory.table.approval}</th>
                </>
              )}

              {reportType === 'accuracy' && (
                <>
                  <th className="text-left min-w-[140px]">{t.demand.inspector.fittedModel}</th>
                  <th className="min-w-[80px]">WMAPE (%)</th>
                  <th className="min-w-[80px]">MAPE (%)</th>
                  <th className="min-w-[90px] bg-emerald-50 text-emerald-900 font-bold">Accuracy (%)</th>
                  <th className="min-w-[90px]">Mean Demand</th>
                  <th className="min-w-[80px]">Sigma</th>
                </>
              )}

              {reportType === 'abc' && (
                <>
                  <th className="text-center min-w-[70px]">ABC Class</th>
                  <th className="text-center min-w-[70px]">XYZ Class</th>
                  <th className="min-w-[90px]">Sales Price ({currSym})</th>
                  <th className="min-w-[90px]">Turnover Ratio</th>
                  <th className="min-w-[100px] font-bold">Inventory Value ({currSym})</th>
                  <th className="text-left min-w-[120px]">Recommended Policy</th>
                </>
              )}

              {reportType === 'projectedStock' && (
                <>
                  <th className="min-w-[75px]">{t.inventory.table.onHand}</th>
                  {activePeriodColumns.map(col => (
                    <th key={col} className="min-w-[75px] text-center font-mono">
                      {col}
                    </th>
                  ))}
                  <th className="min-w-[90px] font-bold text-amber-800">
                    {periodHorizon === 'past12' ? 'Total Sales' : 'Projected Min Stock'}
                  </th>
                </>
              )}

              {reportType === 'drp' && (
                <>
                  <th className="text-left min-w-[100px]">Node Type</th>
                  <th className="text-left min-w-[100px]">Parent DC</th>
                  <th className="min-w-[75px]">{t.inventory.table.onHand}</th>
                  <th className="min-w-[75px]">{t.inventory.table.safetyStock}</th>
                  <th className="min-w-[120px] text-left">Transfer Action</th>
                  <th className="min-w-[90px] font-bold">Consolidated Order</th>
                </>
              )}

              {reportType === 'bom' && (
                <>
                  <th className="text-left min-w-[90px]">BOM Type</th>
                  <th className="min-w-[70px]">Qty / Parent</th>
                  <th className="min-w-[75px]">{t.inventory.table.onHand}</th>
                  <th className="min-w-[75px]">Gross Req</th>
                  <th className="min-w-[80px] font-bold text-rose-600">Net Shortage</th>
                  <th className="min-w-[80px] bg-amber-50">Component Order</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, idx) => {
              const projections = reportType === 'projectedStock' ? calculateProjectedStockArray(item) : [];
              const minOrTotal = periodHorizon === 'past12' 
                ? projections.reduce((a, b) => a + b, 0)
                : (projections.length > 0 ? Math.min(...projections) : item.onHand);

              return (
                <tr 
                  key={item.id} 
                  className={`hover:bg-blue-50/50 ${idx % 2 === 1 ? 'bg-[#F8F9FA]' : 'bg-white'}`}
                >
                  <td className="text-left font-mono font-bold text-slate-800 sticky left-0 bg-inherit border-r border-[#CBD5E1]">
                    {item.code}
                  </td>
                  <td className="text-left font-medium text-slate-800 truncate max-w-xs">
                    {item.description}
                  </td>

                  {reportType === 'replenishment' && (
                    <>
                      <td className="text-left text-slate-600">{item.location}</td>
                      <td className="text-left text-slate-600 truncate">{item.supplier}</td>
                      <td className="font-mono">{item.onHand.toLocaleString()}</td>
                      <td className="font-mono">{item.safetyStock.toLocaleString()}</td>
                      <td className="font-mono font-bold text-[#2196F3]">{item.reorderPoint.toLocaleString()}</td>
                      <td className="font-mono font-bold text-amber-800 bg-amber-50/50">
                        {item.orderNow || 0}
                      </td>
                      <td className="font-mono text-slate-600">{formatCurrency(item.purchasePrice, settings, language)}</td>
                      <td className="font-mono font-bold bg-amber-50/50 text-slate-900">
                        {formatCurrency(item.orderNowValue || 0, settings, language)}
                      </td>
                      <td className="text-center font-semibold text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded ${
                          item.approvalState === 'approved' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {item.approvalState}
                        </span>
                      </td>
                    </>
                  )}

                  {reportType === 'accuracy' && (
                    <>
                      <td className="text-left font-semibold text-slate-700 uppercase text-[10px]">
                        {item.fittedModelType || item.modelType}
                      </td>
                      <td className="font-mono text-slate-600">{item.wmape?.toFixed(1)}%</td>
                      <td className="font-mono text-slate-600">{item.mape?.toFixed(1)}%</td>
                      <td className="font-mono font-bold text-emerald-600 bg-emerald-50/40">
                        {item.accuracy?.toFixed(1)}%
                      </td>
                      <td className="font-mono">{item.meanDailyDemand?.toFixed(0) ?? '-'}</td>
                      <td className="font-mono text-slate-500">{item.demandStdDev?.toFixed(1) ?? '-'}</td>
                    </>
                  )}

                  {reportType === 'abc' && (
                    <>
                      <td className="text-center font-bold">
                        <span className={`px-2 py-0.5 rounded ${
                          item.abcClass === 'A' ? 'bg-emerald-100 text-emerald-800' :
                          item.abcClass === 'B' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {item.abcClass}
                        </span>
                      </td>
                      <td className="text-center font-bold">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {item.xyzClass}
                        </span>
                      </td>
                      <td className="font-mono">{formatCurrency(item.salesPrice, settings, language)}</td>
                      <td className="font-mono font-semibold">{item.turnoverRatio}x</td>
                      <td className="font-mono font-bold">{formatCurrency(item.inventoryValue || 0, settings, language)}</td>
                      <td className="text-left text-[11px] text-slate-600">
                        {item.abcClass === 'A' ? 'JIT / Daily Monitoring' : 'Periodic Min/Max'}
                      </td>
                    </>
                  )}

                  {reportType === 'projectedStock' && (
                    <>
                      <td className="font-mono font-semibold">{item.onHand.toLocaleString()}</td>
                      {projections.map((val, pIdx) => (
                        <td key={pIdx} className="font-mono text-center">
                          {Math.round(val).toLocaleString()}
                        </td>
                      ))}
                      <td className={`font-mono font-bold ${minOrTotal < item.safetyStock ? 'text-rose-600' : 'text-slate-900'}`}>
                        {Math.round(minOrTotal).toLocaleString()}
                      </td>
                    </>
                  )}

                  {reportType === 'drp' && (
                    <>
                      <td className="text-left text-slate-700 font-semibold">
                        {item.dc ? 'Central DC' : 'Regional Branch'}
                      </td>
                      <td className="text-left text-slate-500">
                        {item.dc ? '-' : 'DC-Central (Dallas)'}
                      </td>
                      <td className="font-mono">{item.onHand.toLocaleString()}</td>
                      <td className="font-mono">{item.safetyStock.toLocaleString()}</td>
                      <td className="text-left text-[11px] text-purple-700 font-medium">
                        {item.transferQty ? `${item.transferQty} units transfer` : 'No transfer'}
                      </td>
                      <td className="font-mono font-bold text-amber-800">
                        {item.orderNow || 0}
                      </td>
                    </>
                  )}

                  {reportType === 'bom' && (
                    <>
                      <td className="text-left font-semibold text-slate-700">
                        {item.bomType === 'material' ? 'Raw Material' : 'Finished Good'}
                      </td>
                      <td className="font-mono text-center">{item.bomType === 'material' ? '2.0' : '-'}</td>
                      <td className="font-mono">{item.onHand.toLocaleString()}</td>
                      <td className="font-mono">150</td>
                      <td className="font-mono font-bold text-rose-600">
                        {item.onHand < 100 ? (100 - item.onHand) : 0}
                      </td>
                      <td className="font-mono font-bold text-amber-800 bg-amber-50">
                        {item.orderNow || 0}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div className="h-7 px-3 bg-[#ECEFF1] border-t border-[#CBD5E1] shrink-0 flex items-center justify-between text-[11px] text-slate-600 font-medium">
        <div>
          <span>{filteredItems.length} {isAr ? 'عنصر في التقرير' : 'records in report'}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>
            {isAr ? 'إجمالي قيمة المخزون:' : 'Total Value:'}{' '}
            <strong className="text-slate-900">
              {formatCurrency(filteredItems.reduce((acc, i) => acc + (i.inventoryValue || 0), 0), settings, language)}
            </strong>
          </span>
          <span>
            {isAr ? 'أوامر الشراء المطلوبة:' : 'Orders Required:'}{' '}
            <strong className="text-amber-800">
              {formatCurrency(filteredItems.reduce((acc, i) => acc + (i.orderNowValue || 0), 0), settings, language)}
            </strong>
          </span>
        </div>
      </div>

      {/* Filter Modal */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-sm w-full shadow-2xl overflow-hidden text-[#1E293B]">
            <div className="p-3 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#2196F3]" />
                <span className="font-bold text-xs text-slate-800">
                  {isAr ? 'تصفية تقرير التحليل' : 'Advanced Report Filter'}
                </span>
              </div>
              <button 
                onClick={() => setIsFilterModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'المجموعة / الفئة' : 'Category'}
                </label>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-xs"
                >
                  <option value="all">{isAr ? 'جميع الفئات (All)' : 'All Categories'}</option>
                  {uniqueCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'موقع التوزيع' : 'Location'}
                </label>
                <select
                  value={filterLocation}
                  onChange={e => setFilterLocation(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-xs"
                >
                  <option value="all">{isAr ? 'جميع المواقع (All)' : 'All Locations'}</option>
                  {uniqueLocations.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'تصنيف ABC' : 'ABC Classification'}
                </label>
                <select
                  value={filterAbc}
                  onChange={e => setFilterAbc(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-xs"
                >
                  <option value="all">{isAr ? 'الكل (All Classes)' : 'All Classes'}</option>
                  <option value="A">Class A (Fast Movers)</option>
                  <option value="B">Class B (Medium Movers)</option>
                  <option value="C">Class C (Slow Movers)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  {isAr ? 'حالة المخزون' : 'Inventory Status'}
                </label>
                <select
                  value={filterStockStatus}
                  onChange={e => setFilterStockStatus(e.target.value as any)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-xs"
                >
                  <option value="all">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
                  <option value="stockout">{isAr ? 'أصناف في حالة نفاذ / عجز' : 'Stockout / Zero Stock'}</option>
                  <option value="overstock">{isAr ? 'أصناف فائضة عن الحد' : 'Overstock'}</option>
                  <option value="reorder">{isAr ? 'يلزم طلبها الآن' : 'Reorder Needed Now'}</option>
                </select>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={clearAdvancedFilters}
                  className="text-slate-500 hover:text-slate-800 text-xs font-medium cursor-pointer"
                >
                  {isAr ? 'إعادة ضبط' : 'Reset'}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFilterModalOpen(false)}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs cursor-pointer"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFilterModalOpen(false)}
                    className="px-4 py-1 bg-[#2196F3] hover:bg-blue-600 text-white rounded text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    {isAr ? 'تطبيق التصفية' : 'Apply Filter'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
