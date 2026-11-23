import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol, formatItemCode } from '../utils/formatters';
import { classifyAbcXyz } from '../engine/math';
import { X, Grid, Info, CheckCircle2, FileSpreadsheet, Loader2, Filter } from 'lucide-react';
import { exportAbcXyzReport } from '../utils/excelExport';
import { api } from '../api/client';

interface AbcXyzModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  settings?: AppSettings;
  language: Language;
  projectId?: string;
  location?: string;
}

export const AbcXyzModal: React.FC<AbcXyzModalProps> = ({
  isOpen,
  onClose,
  items,
  settings,
  language,
  projectId,
  location,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';
  const currSym = getCurrencySymbol(settings?.currency_code || 'EGP', language);

  // Backend ABC-XYZ State (Workstream 6: Full DuckDB 100% calculation)
  const [abcData, setAbcData] = useState<any>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Re-classify dynamically with configured thresholds (client fallback)
  const clientClassifiedItems = useMemo(() => {
    const active = (items || []).filter(isAnalyzableItem);
    return classifyAbcXyz(
      active,
      settings?.abc_a_cutoff ?? 80,
      settings?.abc_b_cutoff ?? 95,
      settings?.xyz_x_cv ?? 0.5,
      settings?.xyz_y_cv ?? 1.0
    );
  }, [items, settings]);

  const matrix = [
    { cell: 'AX', color: 'bg-emerald-100 text-emerald-900 border-emerald-300', policy: 'Automated JIT / Tight ROP' },
    { cell: 'AY', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', policy: 'Frequent Orders / Buffer Stock' },
    { cell: 'AZ', color: 'bg-amber-50 text-amber-900 border-amber-300', policy: 'High Safety Stock / Contract Supply' },
    { cell: 'BX', color: 'bg-blue-100 text-blue-900 border-blue-300', policy: 'Standard Periodic Review' },
    { cell: 'BY', color: 'bg-blue-50 text-blue-800 border-blue-200', policy: 'Min/Max with Moderate Safety Stock' },
    { cell: 'BZ', color: 'bg-amber-100 text-amber-900 border-amber-300', policy: 'Order on Demand / Supplier Agreement' },
    { cell: 'CX', color: 'bg-slate-100 text-slate-800 border-slate-300', policy: 'Bulk Periodic Orders (MOQ Discounts)' },
    { cell: 'CY', color: 'bg-slate-100 text-slate-800 border-slate-300', policy: 'Conservative Min/Max' },
    { cell: 'CZ', color: 'bg-rose-50 text-rose-800 border-rose-300', policy: 'Make/Buy to Order / Prune SKU' },
  ];

  // Fetch full DuckDB ABC-XYZ matrix
  const fetchAbcXyz = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const data = await api.getAbcXyz(projectId, {
        location: location || undefined,
        filter_class: selectedCell || undefined,
        page_size: 100,
      });
      setAbcData(data);
    } catch (err) {
      console.warn('Failed to load server-side ABC-XYZ data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, location, selectedCell]);

  useEffect(() => {
    if (projectId) {
      fetchAbcXyz();
    }
  }, [projectId, fetchAbcXyz]);

  const handleCellClick = (cellName: string) => {
    setSelectedCell(prev => (prev === cellName ? null : cellName));
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      if (projectId) {
        let exportUrl = `/api/projects/${projectId}/export/abc-xyz?language=${language}`;
        if (location && location !== 'ALL') exportUrl += `&location=${encodeURIComponent(location)}`;
        await api.downloadReportExport(exportUrl, 'ABC_XYZ_Matrix_Report.xlsx');
      } else {
        await exportAbcXyzReport({
          matrix,
          classifiedItems: clientClassifiedItems,
          language,
        });
      }
    } catch (err) {
      console.error('Failed to export ABC-XYZ report:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const totalSkus = abcData?.total_skus ?? clientClassifiedItems.length;
  const totalRev = abcData?.total_revenue;
  const totalInv = abcData?.total_inventory_value;
  const displayItems = abcData?.items ?? (selectedCell 
    ? clientClassifiedItems.filter(i => `${i.abcClass}${i.xyzClass}` === selectedCell)
    : clientClassifiedItems);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Grid className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {t.tabs.abc} — {isAr ? 'مصفوفة تصنيف المخزون التساعية (ABC-XYZ)' : '9-Box Portfolio Classification Matrix'}
                </h3>
                {projectId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                    Full DuckDB Engine ({totalSkus.toLocaleString()} SKUs)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? 'تصنيف الأصناف حسب مساهمتها في الإيرادات (ABC) واستقرار الطلب (XYZ) عبر كامل قاعدة البيانات'
                  : 'Classify portfolio by revenue importance (ABC) and demand variability (XYZ) across 100% of SKUs'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 bg-white text-[12px]">
          {/* KPI Summary Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
              <span className="text-[10px] text-blue-900 font-bold block">
                {isAr ? 'إجمالي الأصناف المصنفة' : 'Total Classified SKUs'}
              </span>
              <span className="text-lg font-black text-blue-950 font-mono">
                {totalSkus.toLocaleString()}
              </span>
            </div>
            {totalRev !== undefined && (
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg">
                <span className="text-[10px] text-emerald-900 font-bold block">
                  {isAr ? 'إجمالي الإيرادات السنوية' : 'Annual Portfolio Revenue'}
                </span>
                <span className="text-lg font-black text-emerald-950 font-mono">
                  {Math.round(totalRev).toLocaleString()} {currSym}
                </span>
              </div>
            )}
            {totalInv !== undefined && (
              <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded-lg">
                <span className="text-[10px] text-purple-900 font-bold block">
                  {isAr ? 'قيمة المخزون الإجمالية' : 'Total Inventory Value'}
                </span>
                <span className="text-lg font-black text-purple-950 font-mono">
                  {Math.round(totalInv).toLocaleString()} {currSym}
                </span>
              </div>
            )}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-between">
              <span className="text-[10px] text-slate-700 font-bold block">
                {isAr ? 'الخلية النشطة' : 'Active Box Filter'}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black font-mono text-blue-700">
                  {selectedCell || (isAr ? 'جميع الخلايا (9)' : 'All 9 Boxes')}
                </span>
                {selectedCell && (
                  <button
                    onClick={() => setSelectedCell(null)}
                    className="text-[10px] text-rose-600 hover:underline font-bold"
                  >
                    {isAr ? 'إلغاء الفلتر' : 'Clear'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3x3 Grid */}
          <div className="grid grid-cols-3 gap-3">
            {matrix.map(m => {
              const boxData = abcData?.matrix?.[m.cell];
              const skuCount = boxData ? boxData.sku_count : clientClassifiedItems.filter(i => `${i.abcClass}${i.xyzClass}` === m.cell).length;
              const revPct = boxData ? boxData.revenue_pct : undefined;
              const isSelected = selectedCell === m.cell;

              return (
                <div 
                  key={m.cell} 
                  onClick={() => handleCellClick(m.cell)}
                  className={`p-3 rounded-lg border ${m.color} flex flex-col justify-between min-h-[110px] cursor-pointer transition transform hover:scale-[1.01] ${
                    isSelected ? 'ring-2 ring-blue-600 shadow-md' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm font-mono">{m.cell}</span>
                    <div className="flex items-center gap-1.5">
                      {revPct !== undefined && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-black/10">
                          {revPct}% rev
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/70">
                        {skuCount.toLocaleString()} {isAr ? 'أصناف' : 'SKUs'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] font-semibold mt-1">
                    {m.policy}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-600 flex items-center justify-between">
                    <span>{isSelected ? (isAr ? '● محدد للعرض' : '● Selected') : (isAr ? 'انقر للفلترة' : 'Click to filter')}</span>
                    {boxData?.inventory_value ? (
                      <span className="font-mono font-bold">
                        {Math.round(boxData.inventory_value).toLocaleString()} {currSym}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Details Table */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-600" />
                <span>
                  {isAr ? 'تفاصيل تصنيف الأصناف:' : 'Item Classification Breakdown:'}
                  {selectedCell && (
                    <span className="text-blue-600 ml-1 font-mono font-bold">({selectedCell})</span>
                  )}
                </span>
              </h4>
              {isLoading && (
                <div className="flex items-center gap-1 text-[11px] text-blue-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isAr ? 'جارِ التحميل من DuckDB...' : 'Loading from DuckDB...'}</span>
                </div>
              )}
            </div>

            <div className="border border-[#E2E8F0] rounded overflow-hidden max-h-60 overflow-y-auto">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th className="text-left">{isAr ? 'الفرع' : 'Branch'}</th>
                    <th className="text-center">ABC</th>
                    <th className="text-center">XYZ</th>
                    <th className="text-center">{isAr ? 'التصنيف' : 'Box'}</th>
                    <th>{isAr ? 'الطلب اليومي' : 'Daily Demand'}</th>
                    <th>{t.inventory.table.onHand}</th>
                    <th>{isAr ? 'قيمة المخزون' : 'Inventory Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.length > 0 ? (
                    displayItems.map((item: any, idx: number) => {
                      const abc = item.abc_class || item.abcClass;
                      const xyz = item.xyz_class || item.xyzClass;
                      const combined = item.combined_class || `${abc}${xyz}`;
                      const demand = item.mean_daily_demand !== undefined ? item.mean_daily_demand : item.meanDailyDemand;
                      const invVal = item.inventory_value !== undefined ? item.inventory_value : (item.inventoryValue || 0);

                      return (
                        <tr key={`${item.code}-${idx}`} className="hover:bg-slate-50">
                          <td className="text-left font-mono font-bold text-slate-800">{formatItemCode(item.code)}</td>
                          <td className="text-left text-slate-700 truncate max-w-xs">{item.description}</td>
                          <td className="text-left text-slate-600">{item.location || '-'}</td>
                          <td className="text-center font-bold">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              abc === 'A' ? 'bg-emerald-100 text-emerald-800' :
                              abc === 'B' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
                            }`}>
                              {abc}
                            </span>
                          </td>
                          <td className="text-center font-bold text-slate-700">{xyz}</td>
                          <td className="text-center font-mono font-bold text-blue-900 bg-blue-50/50">{combined}</td>
                          <td className="font-mono">{(Number(demand) || 0).toFixed(2)}</td>
                          <td className="font-mono font-bold">{(Number(item.on_hand ?? item.onHand) || 0).toLocaleString()}</td>
                          <td className="font-mono font-bold text-emerald-800">
                            {Math.round(invVal).toLocaleString()} {currSym}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="text-center py-6 text-slate-400">
                        {isAr ? 'لا توجد أصناف مطابقة للتصنيف المحدد.' : 'No items match the selected box filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-medium">
            {isAr
              ? `إجمالي الأصناف في قاعدة البيانات: ${totalSkus.toLocaleString()} صنف`
              : `Total SKUs in DuckDB: ${totalSkus.toLocaleString()} items`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={isExporting}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded text-xs flex items-center gap-1.5 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>{isAr ? 'تصدير Excel' : 'Export Excel'}</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#2196F3] text-white font-semibold rounded text-xs hover:bg-blue-600 transition shadow-xs cursor-pointer"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
