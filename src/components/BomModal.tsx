import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { InventoryItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatItemCode } from '../utils/formatters';
import { X, Layers, AlertCircle, CheckCircle2, ChevronRight, Cog, ArrowRight, FileSpreadsheet, Loader2, Search } from 'lucide-react';
import { exportMrpReport } from '../utils/excelExport';
import { formatExportSuccessToast } from '../utils/exportDownload';
import { api } from '../api/client';

interface BomModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  language: Language;
  projectId?: string;
}

export const BomModal: React.FC<BomModalProps> = ({
  isOpen,
  onClose,
  items,
  language,
  projectId,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  // Parent products candidates (client fallback)
  const parentCandidates = useMemo(() => {
    const prods = items.filter(i => i.bomType === 'product');
    return prods.length > 0 ? prods : items;
  }, [items]);

  const [selectedParentId, setSelectedParentId] = useState<string>(() => {
    return parentCandidates.length > 0 ? parentCandidates[0].id : '';
  });

  const selectedParent = useMemo(() => {
    return items.find(i => i.id === selectedParentId) || parentCandidates[0] || items[0];
  }, [items, selectedParentId, parentCandidates]);

  // Production requirement plan
  const [productionPlanQty, setProductionPlanQty] = useState<number>(() => {
    return selectedParent?.orderNow && selectedParent.orderNow > 0 ? selectedParent.orderNow : 100;
  });

  const [leadTimeDays, setLeadTimeDays] = useState<number>(14);

  // Workstream 6: Full-Database MRP Parent Search & Component Explosion
  const [parentQuery, setParentQuery] = useState<string>('');
  const [parentOptions, setParentOptions] = useState<Array<{ code: string; description: string; category?: string; price?: number; lead_time?: number }>>([]);
  const [selectedParentSku, setSelectedParentSku] = useState<string>(selectedParent?.code || '');
  const [mrpData, setMrpData] = useState<any>(null);
  const [isLoadingMrp, setIsLoadingMrp] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Search MRP parents from DuckDB
  useEffect(() => {
    if (!projectId) return;
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchMrpParents(projectId, parentQuery.trim());
        setParentOptions(results);
        if (results.length > 0 && !selectedParentSku) {
          setSelectedParentSku(results[0].code);
        }
      } catch (err) {
        console.warn('Failed to search MRP parents:', err);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [projectId, parentQuery, selectedParentSku]);

  // Fetch MRP explosion for selected parent
  const fetchMrpExplosion = useCallback(async () => {
    if (!projectId || !selectedParentSku) return;
    setIsLoadingMrp(true);
    try {
      const data = await api.getMrp(projectId, {
        parent_sku: selectedParentSku,
        production_qty: productionPlanQty,
        lead_time_days: leadTimeDays,
      });
      setMrpData(data);
    } catch (err) {
      console.warn('Failed to load MRP explosion:', err);
    } finally {
      setIsLoadingMrp(false);
    }
  }, [projectId, selectedParentSku, productionPlanQty, leadTimeDays]);

  useEffect(() => {
    if (projectId && selectedParentSku) {
      fetchMrpExplosion();
    }
  }, [projectId, selectedParentSku, fetchMrpExplosion]);

  // Client components calculation fallback
  const clientComponents = useMemo(() => {
    if (!selectedParent) return [];
    const others = items.filter(i => i.id !== selectedParent.id);
    const materials = others.filter(i => i.bomType === 'material');
    const sourceList = materials.length > 0 ? materials : others.slice(0, 5);

    return sourceList.map((mat, idx) => {
      const qtyPerParent = (idx % 3 === 0 ? 2 : idx % 3 === 1 ? 1 : 4);
      const grossReq = productionPlanQty * qtyPerParent;
      const onHand = mat.onHand || 0;
      const onOrder = mat.onOrder || 0;
      const netShortage = Math.max(0, grossReq - (onHand + onOrder));
      const minBatch = mat.minBatch || 1;
      const componentOrder = netShortage > 0 
        ? Math.ceil(netShortage / minBatch) * minBatch 
        : 0;

      return {
        item: mat,
        qtyPerParent,
        grossReq,
        netShortage,
        componentOrder,
      };
    });
  }, [selectedParent, items, productionPlanQty]);

  const handleExportExcel = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      let res;
      if (projectId && selectedParentSku) {
        const exportUrl = `/api/projects/${projectId}/export/mrp?language=${language}&parent_sku=${encodeURIComponent(selectedParentSku)}&production_qty=${productionPlanQty}&lead_time_days=${leadTimeDays}`;
        res = await api.downloadReportExport(exportUrl, 'MRP_Explosion_Report.xlsx');
      } else if (selectedParent) {
        res = await exportMrpReport({
          selectedParent,
          productionPlanQty,
          components: clientComponents,
          language,
        });
      }
      if (res) {
        const msg = formatExportSuccessToast(res, isAr);
        if (msg) {
          setExportFeedback({ type: 'success', text: msg });
          setTimeout(() => setExportFeedback(null), 6000);
        }
      }
    } catch (err: any) {
      console.error('Failed to export MRP report:', err);
      setExportFeedback({
        type: 'error',
        text: (isAr ? 'فشل تصدير شجرة المواد MRP: ' : 'MRP export failed: ') + (err?.message || 'Unknown error'),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const currentParentDesc = mrpData?.parent?.description || selectedParent?.description || '';
  const currentParentCode = mrpData?.parent?.code || selectedParentSku || selectedParent?.code || '';
  const currentComponents = mrpData?.components || [];
  const kpis = mrpData?.kpis;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {t.tabs.bom} — {isAr ? 'شجرة تراكيب المواد وحساب احتياجات التصنيع (MRP)' : 'Bill of Materials (MRP Explosion)'}
                </h3>
                {projectId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                    Full DuckDB Engine
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'تفكيك المنتجات التامة إلى مكونات وحساب العجز الصافي وأوامر التوريد عبر قاعدة البيانات كاملة' : 'Multi-level BOM tree breakdown & component gross-to-net requirements across full database'}
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
          {/* Active Product Assembly Selector Banner */}
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 bg-[#2196F3] text-white rounded shrink-0">
                <Cog className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1">
                <label className="text-[10px] font-bold text-blue-900 uppercase tracking-wider block">
                  {isAr ? 'المنتج التام المحدد (Finished Parent SKU):' : 'Active Finished Good / Parent Assembly:'}
                </label>
                {projectId ? (
                  <div className="flex items-center gap-2">
                    <div className="relative w-48">
                      <Search className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
                      <input
                        type="text"
                        value={parentQuery}
                        onChange={e => setParentQuery(e.target.value)}
                        placeholder={isAr ? 'بحث عن صنف...' : 'Search SKU...'}
                        className="w-full pl-7 pr-2 py-1 text-[11px] border border-blue-300 rounded bg-white"
                      />
                    </div>
                    <select
                      value={selectedParentSku}
                      onChange={e => setSelectedParentSku(e.target.value)}
                      className="px-2 py-1 border border-blue-300 rounded font-bold text-xs bg-white text-slate-900 focus:outline-none focus:border-[#2196F3] cursor-pointer flex-1 max-w-sm"
                    >
                      {parentOptions.map(opt => (
                        <option key={opt.code} value={opt.code}>
                          {formatItemCode(opt.code)} — {opt.description}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <select
                    value={selectedParent?.id}
                    onChange={e => setSelectedParentId(e.target.value)}
                    className="px-2 py-1 border border-blue-300 rounded font-bold text-xs bg-white text-slate-900 focus:outline-none focus:border-[#2196F3] cursor-pointer max-w-sm"
                  >
                    {items.map(i => (
                      <option key={i.id} value={i.id}>
                        {formatItemCode(i.code)} — {i.description}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 bg-white p-2 rounded border border-blue-200 shrink-0">
              <div>
                <span className="text-[10px] text-slate-500 block font-medium">
                  {isAr ? 'خطة الإنتاج المطلوبة' : 'Planned Production'}
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    value={productionPlanQty}
                    onChange={e => setProductionPlanQty(Math.max(1, Number(e.target.value)))}
                    className="w-20 px-2 py-0.5 border border-slate-300 rounded font-mono font-bold text-xs text-blue-900 text-center"
                  />
                  <span className="text-[10px] text-slate-500">{isAr ? 'وحدة' : 'units'}</span>
                </div>
              </div>
              <div className="border-l border-slate-200 pl-3 text-right text-[11px] text-slate-700 font-mono">
                Lead Time: <strong>{leadTimeDays}d</strong>
              </div>
            </div>
          </div>

          {/* MRP KPI Summary (When DuckDB is active) */}
          {kpis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
                <span className="text-[10px] text-blue-900 font-bold block">
                  {isAr ? 'إجمالي الاحتياج الإجمالي' : 'Total Gross Requirement'}
                </span>
                <span className="text-lg font-black text-blue-950 font-mono">
                  {Math.round(kpis.total_gross_req).toLocaleString()}
                </span>
              </div>
              <div className="p-2.5 bg-rose-50/70 border border-rose-200 rounded-lg">
                <span className="text-[10px] text-rose-900 font-bold block">
                  {isAr ? 'إجمالي العجز الصافي' : 'Total Net Shortage'}
                </span>
                <span className="text-lg font-black text-rose-950 font-mono">
                  {Math.round(kpis.total_net_shortage).toLocaleString()}
                </span>
              </div>
              <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg">
                <span className="text-[10px] text-amber-900 font-bold block">
                  {isAr ? 'تكلفة توريد المكونات' : 'Component Shortage Cost'}
                </span>
                <span className="text-lg font-black text-amber-950 font-mono">
                  {Math.round(kpis.total_shortage_value).toLocaleString()} {isAr ? 'ج.م' : 'EGP'}
                </span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-[10px] text-slate-700 font-bold block">
                  {isAr ? 'عدد المكونات' : 'Component Count'}
                </span>
                <span className="text-lg font-black text-slate-900 font-mono">
                  {kpis.component_count}
                </span>
              </div>
            </div>
          )}

          {/* BOM Component Tree Table */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold text-slate-800">
                {isAr ? 'المكونات والمواد الأولية في شجرة المواد:' : 'Component Explosion & Net Shortage Matrix:'}
              </h4>
              {isLoadingMrp && (
                <div className="flex items-center gap-1 text-[11px] text-[#2196F3]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isAr ? 'جارِ تفكيك شجرة المواد في DuckDB...' : 'Exploding BOM tree in DuckDB...'}</span>
                </div>
              )}
            </div>

            <div className="border border-[#E2E8F0] rounded overflow-hidden max-h-80 overflow-y-auto">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th className="text-center">{isAr ? 'الكمية / الوحدة' : 'Qty / Parent'}</th>
                    <th>{t.inventory.table.onHand}</th>
                    <th>{isAr ? 'إجمالي الاحتياج' : 'Gross Req'}</th>
                    <th className="font-bold text-rose-700">{isAr ? 'صافي العجز' : 'Net Shortage'}</th>
                    <th>{isAr ? 'مهلة التوريد' : 'Lead Time'}</th>
                    <th className="bg-amber-50 font-bold">{t.inventory.table.orderNow}</th>
                  </tr>
                </thead>
                <tbody>
                  {projectId && currentComponents.length > 0 ? (
                    currentComponents.map((c: any) => (
                      <tr key={c.code} className="hover:bg-blue-50/30">
                        <td className="text-left font-mono font-bold text-slate-800">{formatItemCode(c.code)}</td>
                        <td className="text-left text-slate-700 truncate max-w-xs">{c.description}</td>
                        <td className="text-center font-mono font-bold text-[#2196F3]">{c.qty_per_parent}.0x</td>
                        <td className="font-mono">{c.on_hand.toLocaleString()}</td>
                        <td className="font-mono font-semibold">{c.gross_requirement.toLocaleString()}</td>
                        <td className={`font-mono font-bold ${c.net_shortage > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {c.net_shortage > 0 ? c.net_shortage.toLocaleString() : 0}
                        </td>
                        <td className="font-mono text-slate-600">{c.lead_time}d</td>
                        <td className="font-mono font-bold text-amber-800 bg-amber-50">
                          {c.recommended_order > 0 ? c.recommended_order.toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))
                  ) : !projectId && clientComponents.length > 0 ? (
                    clientComponents.map(({ item: mat, qtyPerParent, grossReq, netShortage, componentOrder }) => (
                      <tr key={mat.id} className="hover:bg-blue-50/30">
                        <td className="text-left font-mono font-bold text-slate-800">{formatItemCode(mat.code)}</td>
                        <td className="text-left text-slate-700 truncate max-w-xs">{mat.description}</td>
                        <td className="text-center font-mono font-bold text-[#2196F3]">{qtyPerParent}.0x</td>
                        <td className="font-mono">{mat.onHand.toLocaleString()}</td>
                        <td className="font-mono font-semibold">{grossReq.toLocaleString()}</td>
                        <td className={`font-mono font-bold ${netShortage > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {netShortage > 0 ? netShortage.toLocaleString() : 0}
                        </td>
                        <td className="font-mono text-slate-600">{mat.leadTimeDays || 14}d</td>
                        <td className="font-mono font-bold text-amber-800 bg-amber-50">
                          {componentOrder > 0 ? componentOrder.toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-400">
                        {isLoadingMrp
                          ? (isAr ? 'جارِ تفكيك شجرة المكونات...' : 'Exploding BOM components...')
                          : (isAr ? 'اختر منتجاً لعرض شجرة مكوناته.' : 'Select a product to view component tree.')}
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
          <div className="text-[11px] text-slate-500 font-medium truncate max-w-sm">
            {currentParentCode ? `${formatItemCode(currentParentCode)} — ${currentParentDesc}` : ''}
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
