import React, { useState, useMemo, useEffect } from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { 
  X, 
  ShoppingCart, 
  ChevronDown, 
  Search, 
  Layers, 
  Building2, 
  PackageCheck, 
  FileSpreadsheet, 
  Loader2, 
  Calendar, 
  Clock 
} from 'lucide-react';
import { exportSheetsToExcel } from '../utils/excelExport';
import { formatExportSuccessToast } from '../utils/exportDownload';
import { formatItemCode } from '../utils/formatters';
import { api, PurchaseOrdersResponse } from '../api/client';

interface PlannedOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onApproveOrder: (itemId: string) => void;
  settings?: AppSettings;
  language: Language;
  selectedLocation?: string;
  projectId?: string;
}

interface SupplierPOGroup {
  poNumber: string;
  supplierName: string;
  items: any[];
  totalUnits: number;
  totalValue: number;
  locations: string[];
  skuCount: number;
}

const cleanItemCode = formatItemCode;

export const PlannedOrdersModal: React.FC<PlannedOrdersModalProps> = ({
  isOpen,
  onClose,
  items,
  onApproveOrder,
  settings,
  language,
  selectedLocation,
  projectId,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [coverageDays, setCoverageDays] = useState<number>(14);
  const [velocityDays, setVelocityDays] = useState<number>(60);
  const [excludeUnmatched, setExcludeUnmatched] = useState<boolean>(true);
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(() => new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backendData, setBackendData] = useState<PurchaseOrdersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch full-database PO calculations from DuckDB endpoint
  useEffect(() => {
    if (!isOpen || !projectId) return;
    let isMounted = true;
    setIsLoading(true);
    api.getPurchaseOrders(projectId, {
      location: selectedLocation,
      search: searchQuery,
      coverage_days: coverageDays,
      velocity_days: velocityDays,
      exclude_unmatched: excludeUnmatched,
    }).then(res => {
      if (isMounted) {
        setBackendData(res);
        setIsLoading(false);
      }
    }).catch(err => {
      console.warn('Failed to fetch full-DB PO data, falling back to local items:', err);
      if (isMounted) setIsLoading(false);
    });
    return () => { isMounted = false; };
  }, [isOpen, projectId, selectedLocation, searchQuery, coverageDays, velocityDays, excludeUnmatched]);

  // Fallback to client-side items calculation if backendData is unavailable
  const clientOrderItems = useMemo(() => {
    return items.filter(isAnalyzableItem).filter(i => {
      if ((i.orderNow || 0) <= 0) return false;
      if (!selectedLocation || selectedLocation === 'ALL') return true;
      return (i.location || '').toLowerCase().trim() === selectedLocation.toLowerCase().trim();
    });
  }, [items, selectedLocation]);

  const clientSupplierGroups: SupplierPOGroup[] = useMemo(() => {
    const supplierMap = new Map<string, InventoryItem[]>();
    for (const item of clientOrderItems) {
      const rawSup = item.supplier?.trim();
      const supName = rawSup || (isAr ? 'مورد غير محدد' : 'Unassigned Supplier');
      if (!supplierMap.has(supName)) {
        supplierMap.set(supName, []);
      }
      supplierMap.get(supName)!.push(item);
    }

    const sorted = Array.from(supplierMap.entries())
      .map(([supplierName, groupItems]) => {
        const groupUnits = groupItems.reduce((sum, i) => sum + (i.orderNow || 0), 0);
        const groupValue = groupItems.reduce((sum, i) => sum + (i.orderNowValue || 0), 0);
        const locSet = new Set<string>();
        groupItems.forEach(i => {
          if (i.location && i.location.trim()) {
            locSet.add(i.location.trim());
          }
        });
        return {
          supplierName,
          items: groupItems,
          totalUnits: groupUnits,
          totalValue: groupValue,
          locations: Array.from(locSet),
          skuCount: groupItems.length,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);

    return sorted.map((g, idx) => ({
      ...g,
      poNumber: `PO-${String(idx + 1).padStart(3, '0')}`,
    }));
  }, [clientOrderItems, isAr]);

  const displayGroups = useMemo(() => {
    if (backendData?.suppliers) {
      return backendData.suppliers.map(s => ({
        poNumber: s.po_number,
        supplierName: s.supplier_name,
        items: s.items,
        totalUnits: s.total_units,
        totalValue: s.total_value,
        locations: s.branches,
        skuCount: s.sku_count,
      }));
    }
    return clientSupplierGroups;
  }, [backendData, clientSupplierGroups]);

  const totalPos = backendData?.kpis?.total_pos ?? displayGroups.length;
  const totalSkus = backendData?.kpis?.total_skus ?? displayGroups.reduce((acc, g) => acc + g.skuCount, 0);
  const totalUnits = backendData?.kpis?.total_units ?? displayGroups.reduce((acc, g) => acc + g.totalUnits, 0);
  const totalValue = backendData?.kpis?.total_budget ?? displayGroups.reduce((acc, g) => acc + g.totalValue, 0);
  const unmatchedExcludedCount = backendData?.kpis?.unmatched_excluded_count ?? 0;

  // Expand / Collapse toggles
  const handleTogglePO = (poNumber: string) => {
    setExpandedPOs(prev => {
      const next = new Set(prev);
      if (next.has(poNumber)) next.delete(poNumber);
      else next.add(poNumber);
      return next;
    });
  };

  const allExpanded = displayGroups.length > 0 && displayGroups.every(g => expandedPOs.has(g.poNumber));
  const handleToggleExpandAll = () => {
    if (allExpanded) {
      setExpandedPOs(new Set());
    } else {
      setExpandedPOs(new Set(displayGroups.map(g => g.poNumber)));
    }
  };

  // Full-Dataset Pure-Python openpyxl Export
  const handleExportAllPOs = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      const hasLoc = Boolean(selectedLocation && selectedLocation !== 'ALL');
      const locTag = hasLoc ? `_${selectedLocation!.trim()}` : '';
      let res;
      if (projectId) {
        const params = new URLSearchParams({
          language,
          coverage_days: String(coverageDays),
          velocity_days: String(velocityDays),
          exclude_unmatched: String(excludeUnmatched),
        });
        if (hasLoc) params.set('location', selectedLocation!.trim());
        if (searchQuery.trim()) params.set('search', searchQuery.trim());

        res = await api.downloadReportExport(
          `/api/projects/${projectId}/export/purchase-orders?${params.toString()}`,
          `PO_Planned_Purchase_Orders${locTag}_${language}.xlsx`
        );
      } else {
        const summaryRows = displayGroups.map(g => ({
          [isAr ? 'رقم أمر الشراء' : 'PO Number']: g.poNumber,
          [isAr ? 'اسم المورد' : 'Supplier']: g.supplierName,
          [isAr ? 'عدد الأصناف' : 'SKU Count']: g.skuCount,
          [isAr ? 'إجمالي الوحدات المطلوبة' : 'Total Units']: g.totalUnits,
          [isAr ? 'إجمالي قيمة أمر الشراء' : 'Total PO Value']: Number(g.totalValue.toFixed(2)),
          [isAr ? 'الفروع المغطاة' : 'Locations Covered']: g.locations.join(', ') || '-',
        }));
        res = await exportSheetsToExcel([{ name: isAr ? 'ملخص أوامر الشراء' : 'PO Summary', rows: summaryRows }], `Planned_Purchase_Orders${locTag}.xlsx`);
      }
      const msg = formatExportSuccessToast(res, isAr);
      if (msg) {
        setExportFeedback({ type: 'success', text: msg });
        setTimeout(() => setExportFeedback(null), 6000);
      }
    } catch (err: any) {
      console.error('Failed to export all POs:', err);
      setExportFeedback({
        type: 'error',
        text: (isAr ? 'فشل تصدير أوامر الشراء: ' : 'PO export failed: ') + (err?.message || 'Unknown error'),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white border border-[#CBD5E1] rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  {isAr 
                    ? `أوامر الشراء المخططة (${totalPos} أمر شراء • ${totalSkus.toLocaleString()} صنف)`
                    : `Planned Purchase Orders (${totalPos} POs • ${totalSkus.toLocaleString()} SKUs)`
                  }
                </h3>
                {isLoading && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {isAr ? 'جاري التحليل...' : 'Recalculating...'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isAr 
                  ? 'محرك المراجعة الدورية (Order-Up-To) المحمي من الأصناف الخاملة وتجميع الموردين التلقائي'
                  : 'Enterprise Order-Up-To Periodic Review Replenishment Engine with Anti-Dead-SKU trigger guard'
                }
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Controls Bar */}
        <div className="p-3 bg-[#F1F5F9] border-b border-[#CBD5E1] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[300px]">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className={`w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 ${isAr ? 'right-2.5' : 'left-2.5'}`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? 'بحث بمورد أو صنف...' : 'Search supplier or SKU...'}
                className={`w-full bg-white border border-slate-300 rounded-lg py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-amber-500 shadow-2xs ${
                  isAr ? 'pr-8 pl-3' : 'pl-8 pr-3'
                }`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className={`absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 ${isAr ? 'left-2.5' : 'right-2.5'}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Coverage Cycle */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 px-2 py-1 rounded-lg shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-medium text-slate-600">{isAr ? 'دورة التغطية:' : 'Coverage:'}</span>
              <select
                value={coverageDays}
                onChange={(e) => setCoverageDays(Number(e.target.value))}
                className="bg-transparent font-bold text-slate-800 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value={7}>{isAr ? '7 أيام (أسبوع)' : '7 Days (1W)'}</option>
                <option value={14}>{isAr ? '14 يوم (أسبوعان)' : '14 Days (2W)'}</option>
                <option value={21}>{isAr ? '21 يوم (3 أسابيع)' : '21 Days (3W)'}</option>
                <option value={30}>{isAr ? '30 يوم (شهر)' : '30 Days (1M)'}</option>
              </select>
            </div>

            {/* Velocity Window */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 px-2 py-1 rounded-lg shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-medium text-slate-600">{isAr ? 'نافذة النشاط:' : 'Activity:'}</span>
              <select
                value={velocityDays}
                onChange={(e) => setVelocityDays(Number(e.target.value))}
                className="bg-transparent font-bold text-slate-800 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value={30}>{isAr ? '30 يوماً الأخيرة' : 'Last 30 Days'}</option>
                <option value={60}>{isAr ? '60 يوماً (افتراضي)' : 'Last 60 Days (Default)'}</option>
                <option value={90}>{isAr ? '90 يوماً (موسمي)' : 'Last 90 Days'}</option>
              </select>
            </div>

            {/* Exclude Unmatched Toggle */}
            <label className="flex items-center gap-1.5 bg-white border border-slate-300 px-2.5 py-1 rounded-lg shadow-2xs cursor-pointer hover:bg-slate-50 text-[11px] font-medium text-slate-700">
              <input
                type="checkbox"
                checked={excludeUnmatched}
                onChange={(e) => setExcludeUnmatched(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500"
              />
              <span>{isAr ? 'استبعاد غير المطابقة' : 'Exclude Unmatched'}</span>
              {unmatchedExcludedCount > 0 && (
                <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {unmatchedExcludedCount}
                </span>
              )}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleExpandAll}
              disabled={displayGroups.length === 0}
              className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-[11px] flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>{allExpanded ? (isAr ? 'طي الكل' : 'Collapse All') : (isAr ? 'توسيع الكل' : 'Expand All')}</span>
            </button>
          </div>
        </div>

        {/* Master-Detail PO Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/50 space-y-3">
          {displayGroups.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300 p-8">
              <PackageCheck className="w-10 h-10 mx-auto text-emerald-500 mb-2 opacity-80" />
              <p className="font-semibold text-sm text-slate-800">
                {isAr ? 'لا توجد أوامر شراء مطلوبة حالياً' : 'No planned purchase orders required'}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                {isAr 
                  ? 'جميع الأصناف تغطي دورة التغطية المحددة أو تقع ضمن حدود مخزون الأمان ونقاط إعادة الطلب.'
                  : 'All inventory positions currently satisfy safety stock and coverage cycle requirements.'
                }
              </p>
            </div>
          ) : (
            displayGroups.map((group) => {
              const isExpanded = expandedPOs.has(group.poNumber);

              return (
                <div 
                  key={group.poNumber} 
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs hover:border-slate-300 transition"
                >
                  {/* Master Card Header */}
                  <div 
                    onClick={() => handleTogglePO(group.poNumber)}
                    className="p-3 sm:p-3.5 bg-gradient-to-r from-slate-50 to-white hover:from-amber-50/30 hover:to-white flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none border-b border-transparent transition"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="p-1 rounded text-slate-400 hover:text-slate-600 transition"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.5 rounded shadow-2xs">
                            {group.poNumber}
                          </span>
                          <span className="font-bold text-sm text-slate-900">
                            {group.supplierName}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                            {group.skuCount} {isAr ? 'أصناف' : 'SKUs'}
                          </span>
                        </div>
                        {group.locations.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                            <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-md">{group.locations.join(' • ')}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">{isAr ? 'إجمالي الوحدات' : 'Units'}</div>
                        <div className="font-mono font-bold text-amber-700 text-sm">
                          {group.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">{isAr ? 'القيمة الإجمالية' : 'Total Value'}</div>
                        <div className="font-mono font-bold text-slate-900 text-sm">
                          {group.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detail Table */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 overflow-x-auto bg-slate-50/30">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-600 font-semibold text-[11px] border-b border-slate-200">
                            <th className="py-2 px-3 text-left">{isAr ? 'كود الصنف' : 'SKU Code'}</th>
                            <th className="py-2 px-3 text-left">{isAr ? 'اسم الصنف' : 'Description'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'الفرع' : 'Branch'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'المخزون' : 'On Hand'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'الطلب اليومي' : 'Daily Demand'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'أيام التغطية' : 'DOS'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'مخزون الأمان' : 'Safety Stock'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'المستوى المستهدف' : 'Target Stock'}</th>
                            <th className="py-2 px-2.5 text-center text-amber-800">{isAr ? 'الكمية المطلوبة' : 'Order Qty'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'سعر التكلفة' : 'Unit Cost'}</th>
                            <th className="py-2 px-2.5 text-center">{isAr ? 'إجمالي القيمة' : 'Line Total'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-[11px]">
                          {group.items.map((line: any, lIdx: number) => {
                            const cCode = cleanItemCode(line.code);
                            const cDesc = line.description || '';
                            const cLoc = line.location || '';
                            const cOnHand = Number(line.on_hand ?? line.onHand ?? 0);
                            const cDemand = Number(line.avg_daily_demand ?? line.meanDailyDemand ?? 0);
                            const cDos = Number(line.days_of_supply ?? line.daysOfSupply ?? 999);
                            const cSS = Number(line.safety_stock ?? line.safetyStock ?? 0);
                            const cTarget = Number(line.target_stock ?? 0);
                            const cOrderNow = Number(line.order_now ?? line.orderNow ?? 0);
                            const cCost = Number(line.purchase_price ?? line.purchasePrice ?? 0);
                            const cVal = Number(line.line_value ?? line.orderNowValue ?? (cOrderNow * cCost));

                            return (
                              <tr key={lIdx} className="hover:bg-white transition">
                                <td className="py-2 px-3 font-mono font-bold text-slate-800 text-left">{cCode}</td>
                                <td className="py-2 px-3 text-slate-700 max-w-xs truncate text-left">{cDesc}</td>
                                <td className="py-2 px-2.5 text-slate-600 text-center">{cLoc}</td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">{cOnHand.toLocaleString()}</td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">{cDemand.toFixed(2)}</td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">{cDos >= 999 ? '999+' : cDos}</td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">{cSS}</td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">{cTarget > 0 ? cTarget : '-'}</td>
                                <td className="py-2 px-2.5 font-mono font-bold text-amber-700 text-center bg-amber-50/50">
                                  {cOrderNow.toLocaleString()}
                                </td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">
                                  {cCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-2.5 font-mono font-bold text-slate-900 text-center">
                                  {cVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Export Feedback Banner */}
        {exportFeedback && (
          <div className={`px-4 py-2 text-xs font-semibold border-t ${
            exportFeedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            {exportFeedback.text}
          </div>
        )}

        {/* Footer */}
        <div className="p-3.5 bg-[#ECEFF1] border-t border-[#CBD5E1] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-5 text-slate-700 font-semibold flex-wrap">
            <span>
              {isAr ? 'إجمالي الوحدات:' : 'Total Units:'}{' '}
              <strong className="text-amber-800 font-mono text-sm">
                {totalUnits.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </strong>
            </span>
            <span>
              {isAr ? 'إجمالي الميزانية:' : 'Total Budget:'}{' '}
              <strong className="text-slate-900 font-mono text-sm">
                {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportAllPOs}
              disabled={isExporting || displayGroups.length === 0}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>{isAr ? 'تصدير Excel (أوامر الشراء)' : 'Export Excel (POs)'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-[#2196F3] text-white font-semibold rounded-lg text-xs hover:bg-blue-600 transition shadow-2xs cursor-pointer"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
