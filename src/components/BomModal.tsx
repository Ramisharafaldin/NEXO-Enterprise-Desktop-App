import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { X, Layers, AlertCircle, CheckCircle2, ChevronRight, Cog, ArrowRight } from 'lucide-react';

interface BomModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  language: Language;
}

export const BomModal: React.FC<BomModalProps> = ({
  isOpen,
  onClose,
  items,
  language,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  // Parent products candidates: prioritize bomType === 'product' or first items
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

  // Production requirement plan for parent item (defaulting to orderNow or 100)
  const [productionPlanQty, setProductionPlanQty] = useState<number>(() => {
    return selectedParent?.orderNow && selectedParent.orderNow > 0 ? selectedParent.orderNow : 100;
  });

  // Components: other items in the project acting as bill of materials components
  const components = useMemo(() => {
    if (!selectedParent) return [];
    const others = items.filter(i => i.id !== selectedParent.id);
    const materials = others.filter(i => i.bomType === 'material');
    const sourceList = materials.length > 0 ? materials : others.slice(0, 5);

    return sourceList.map((mat, idx) => {
      // Deterministic multiplier per component (1, 2, or 4)
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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.tabs.bom} — {isAr ? 'شجرة تراكيب المواد وحساب احتياجات التصنيع (MRP)' : 'Bill of Materials (MRP Explosion)'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'تفكيك المنتجات التامة إلى مكونات وحساب العجز الصافي وأوامر التوريد' : 'Multi-level BOM tree breakdown & component gross-to-net requirements'}
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
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#2196F3] text-white rounded shrink-0">
                <Cog className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-blue-900 uppercase tracking-wider block">
                  {isAr ? 'المنتج التام المحدد (Finished Parent SKU):' : 'Active Finished Good / Parent Assembly:'}
                </label>
                <select
                  value={selectedParent?.id}
                  onChange={e => setSelectedParentId(e.target.value)}
                  className="px-2 py-1 border border-blue-300 rounded font-bold text-xs bg-white text-slate-900 focus:outline-none focus:border-[#2196F3] cursor-pointer max-w-sm"
                >
                  {items.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.code} — {i.description}
                    </option>
                  ))}
                </select>
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
                Lead Time: <strong>{selectedParent?.leadTimeDays || 14}d</strong>
              </div>
            </div>
          </div>

          {/* BOM Component Tree Table */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 mb-1.5">
              {isAr ? 'المكونات والمواد الأولية في شجرة المواد:' : 'Component Explosion & Net Shortage Matrix:'}
            </h4>
            <div className="border border-[#E2E8F0] rounded overflow-hidden">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold">
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
                  {components.length > 0 ? (
                    components.map(({ item: mat, qtyPerParent, grossReq, netShortage, componentOrder }) => (
                      <tr key={mat.id} className="hover:bg-blue-50/30">
                        <td className="text-left font-mono font-bold text-slate-800">{mat.code}</td>
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
                      <td colSpan={8} className="text-center py-4 text-slate-400">
                        {isAr ? 'اختر منتجاً لعرض شجرة مكوناته.' : 'Select a product to view component tree.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
