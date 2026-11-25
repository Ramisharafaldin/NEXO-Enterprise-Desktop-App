import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { InventoryItem, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatItemCode } from '../utils/formatters';
import { X, Network, ArrowRightLeft, Building2, Store, CheckCircle2, FileSpreadsheet, Loader2, Search, Filter } from 'lucide-react';
import { exportDrpReport } from '../utils/excelExport';
import { formatExportSuccessToast } from '../utils/exportDownload';
import { api, DrpResponse, DrpRecommendation } from '../api/client';

interface DrpModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  language: Language;
  projectId?: string;
  location?: string;
}

export const DrpModal: React.FC<DrpModalProps> = ({
  isOpen,
  onClose,
  items,
  language,
  projectId,
  location,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  // Backend DRP State (Workstream 6: Full DuckDB dataset)
  const [drpData, setDrpData] = useState<DrpResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [destFilter, setDestFilter] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Client-side fallback topology
  const activeItems = useMemo(() => (items || []).filter(isAnalyzableItem), [items]);

  const locations = useMemo(() => {
    const set = new Set(activeItems.map(i => i.location || (isAr ? 'المستودع الرئيسي' : 'Central DC')));
    return Array.from(set);
  }, [activeItems, isAr]);

  const primaryDc = useMemo(() => {
    const dcItem = activeItems.find(i => !!i.dc);
    return dcItem ? dcItem.location : (locations[0] || 'Central DC');
  }, [activeItems, locations]);

  const branches = useMemo(() => {
    return locations.filter(l => l !== primaryDc);
  }, [locations, primaryDc]);

  // Client fallback transfer calculations
  const clientTransferRecommendations = useMemo(() => {
    const recommendations: DrpRecommendation[] = [];
    const byCode: Record<string, InventoryItem[]> = {};
    items.forEach(i => {
      if (!byCode[i.code]) byCode[i.code] = [];
      byCode[i.code].push(i);
    });

    Object.entries(byCode).forEach(([code, variants]) => {
      const deficitVariants = variants.filter(v => v.location !== primaryDc && v.onHand < v.safetyStock);
      const surplusVariants = variants.filter(v => v.onHand > (v.safetyStock * 1.2));

      deficitVariants.forEach(deficit => {
        const needed = Math.max(1, deficit.safetyStock - deficit.onHand);
        const dcSource = surplusVariants.find(s => s.location === primaryDc && (s.onHand - s.safetyStock) > 0);
        const sourceItem = dcSource || surplusVariants.find(s => s.location !== deficit.location && (s.onHand - s.safetyStock) > 0);

        if (sourceItem) {
          const availableSurplus = Math.max(0, sourceItem.onHand - sourceItem.safetyStock);
          const transferQty = Math.min(needed, availableSurplus);
          if (transferQty > 0) {
            recommendations.push({
              code: deficit.code,
              description: deficit.description,
              source_branch: sourceItem.location,
              dest_branch: deficit.location,
              source_on_hand: sourceItem.onHand,
              dest_on_hand: deficit.onHand,
              transfer_qty: Math.round(transferQty),
              transfer_value: Math.round(transferQty * (deficit.purchasePrice || 50.0)),
              lead_time: Math.min(deficit.leadTimeDays || 3, 5),
              priority: deficit.onHand <= 0 ? 'high' : 'normal',
            });
          }
        }
      });
    });

    return recommendations;
  }, [items, primaryDc]);

  // Fetch full DuckDB DRP recommendations when projectId is provided
  const fetchDrp = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const data = await api.getDrp(projectId, {
        search: search.trim() || undefined,
        source_location: sourceFilter || undefined,
        dest_location: destFilter || undefined,
        page_size: 200,
      });
      setDrpData(data);
    } catch (err) {
      console.warn('Failed to load server-side DRP data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, search, sourceFilter, destFilter]);

  useEffect(() => {
    if (projectId) {
      fetchDrp();
    }
  }, [projectId, fetchDrp]);

  const recommendations = drpData?.recommendations ?? clientTransferRecommendations;
  const kpis = drpData?.kpis ?? {
    total_recommendations: clientTransferRecommendations.length,
    total_transfer_units: clientTransferRecommendations.reduce((acc, r) => acc + r.transfer_qty, 0),
    total_transfer_value: clientTransferRecommendations.reduce((acc, r) => acc + r.transfer_value, 0),
    balanced_skus_count: activeItems.length - clientTransferRecommendations.length,
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      let res;
      if (projectId) {
        let exportUrl = `/api/projects/${projectId}/export/drp?language=${language}`;
        if (location && location !== 'ALL') exportUrl += `&location=${encodeURIComponent(location)}`;
        if (search.trim()) exportUrl += `&search=${encodeURIComponent(search.trim())}`;
        res = await api.downloadReportExport(exportUrl, 'DRP_Transfers_Report.xlsx');
      } else {
        res = await exportDrpReport({
          items: activeItems,
          transferRecommendations: recommendations.map((r, i) => ({
            id: `${r.code}-${i}`,
            code: r.code,
            description: r.description,
            source: r.source_branch,
            destination: r.dest_branch,
            quantity: r.transfer_qty,
            leadTimeDays: r.lead_time,
            priority: r.priority as any,
          })),
          primaryDc,
          branches,
          language,
        });
      }
      const msg = formatExportSuccessToast(res, isAr);
      if (msg) {
        setExportFeedback({ type: 'success', text: msg });
        setTimeout(() => setExportFeedback(null), 6000);
      }
    } catch (err: any) {
      console.error('Failed to export DRP report:', err);
      setExportFeedback({
        type: 'error',
        text: (isAr ? 'فشل تصدير تقرير DRP: ' : 'DRP export failed: ') + (err?.message || 'Unknown error'),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-purple-50 text-purple-600 border border-purple-200">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {t.tabs.dc} — {isAr ? 'شبكة التوزيع متعددة المستويات والمناقلات (DRP)' : 'Multi-Echelon DRP Network & Transfer Optimization'}
                </h3>
                {projectId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                    Full DuckDB Engine
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? 'موازنة المخزون بين الفروع والمستودعات الإقليمية وجدولة المناقلات الفورية لمنع النفاذ'
                  : 'Balance inter-branch inventory across network & schedule instant transfers to eliminate stockouts'}
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
          {/* Global DRP KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded-lg">
              <span className="text-[10px] text-purple-900 font-bold block">
                {isAr ? 'عدد المناقلات الموصى بها' : 'Transfer Recommendations'}
              </span>
              <span className="text-lg font-black text-purple-950 font-mono">
                {kpis.total_recommendations.toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
              <span className="text-[10px] text-blue-900 font-bold block">
                {isAr ? 'إجمالي وحدات المناقلة' : 'Total Transfer Units'}
              </span>
              <span className="text-lg font-black text-blue-950 font-mono">
                {Math.round(kpis.total_transfer_units).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg">
              <span className="text-[10px] text-emerald-900 font-bold block">
                {isAr ? 'القيمة التقديرية للمناقلات' : 'Estimated Transfer Value'}
              </span>
              <span className="text-lg font-black text-emerald-950 font-mono">
                {Math.round(kpis.total_transfer_value).toLocaleString()} {isAr ? 'ج.م' : 'EGP'}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-700 font-bold block">
                {isAr ? 'أصناف متوازنة بالشبكة' : 'Balanced Network SKUs'}
              </span>
              <span className="text-lg font-black text-slate-900 font-mono">
                {kpis.balanced_skus_count.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 bg-[#F8F9FA] rounded border border-[#E2E8F0]">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={isAr ? 'بحث بالكود أو الوصف...' : 'Search code or description...'}
                  className="w-full pl-7 pr-2 py-1 text-[11px] border border-[#CBD5E1] rounded bg-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {branches.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  className="px-2 py-1 text-[11px] border border-[#CBD5E1] rounded bg-white"
                >
                  <option value="">{isAr ? 'جميع فروع المصدر' : 'All Source Branches'}</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <select
                  value={destFilter}
                  onChange={e => setDestFilter(e.target.value)}
                  className="px-2 py-1 text-[11px] border border-[#CBD5E1] rounded bg-white"
                >
                  <option value="">{isAr ? 'جميع فروع الوجهة' : 'All Dest Branches'}</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Transfer Recommendations Table */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-purple-600" />
                <span>{isAr ? 'توصيات المناقلات الفورية بين المستودعات والفروع:' : 'Immediate Intersite Transfer Recommendations:'}</span>
              </h4>
              {isLoading && (
                <div className="flex items-center gap-1 text-[11px] text-purple-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isAr ? 'جارِ التحميل...' : 'Loading...'}</span>
                </div>
              )}
            </div>

            <div className="border border-[#E2E8F0] rounded overflow-hidden max-h-80 overflow-y-auto">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th className="text-left">{isAr ? 'مستودع المصدر' : 'Source'}</th>
                    <th className="text-left">{isAr ? 'فرع الوجهة' : 'Destination'}</th>
                    <th>{isAr ? 'كمية المناقلة' : 'Transfer Qty'}</th>
                    <th>{isAr ? 'القيمة' : 'Value'}</th>
                    <th>{isAr ? 'مدة النقل' : 'Transit Time'}</th>
                    <th className="text-center">{t.inventory.table.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.length > 0 ? (
                    recommendations.map((rec, idx) => (
                      <tr key={`${rec.code}-${rec.source_branch}-${rec.dest_branch}-${idx}`} className="hover:bg-purple-50/40">
                        <td className="text-left font-mono font-bold text-slate-800">{formatItemCode(rec.code)}</td>
                        <td className="text-left font-medium text-slate-800 truncate max-w-xs">{rec.description}</td>
                        <td className="text-left text-slate-600">{rec.source_branch}</td>
                        <td className="text-left font-semibold text-purple-900">{rec.dest_branch}</td>
                        <td className="font-mono font-bold text-purple-700 bg-purple-50/60">
                          {rec.transfer_qty.toLocaleString()}
                        </td>
                        <td className="font-mono text-slate-800">
                          {rec.transfer_value ? rec.transfer_value.toLocaleString() : '-'}
                        </td>
                        <td className="font-mono text-slate-600">{rec.lead_time}d</td>
                        <td className="text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            rec.priority === 'high' 
                              ? 'bg-rose-100 text-rose-800 border-rose-200' 
                              : 'bg-purple-100 text-purple-800 border-purple-200'
                          }`}>
                            {rec.priority === 'high' ? (isAr ? 'عاجل لمنع النفاذ' : 'Critical Stockout') : (isAr ? 'موصى به' : 'Recommended')}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-400">
                        {isLoading
                          ? (isAr ? 'جارِ فحص أرصدة جميع الفروع في DuckDB...' : 'Analyzing cross-branch balances in DuckDB...')
                          : (isAr ? 'لا توجد مناقلات مطلوبة حالياً، المخزون متوازن عبر الفروع.' : 'No intersite transfers needed; network inventory is balanced.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-medium">
            {isAr
              ? `إجمالي المناقلات الموصى بها: ${recommendations.length} مناقلة`
              : `Total recommended transfers: ${recommendations.length} lines`}
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
