import React, { useMemo } from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { classifyAbcXyz } from '../engine/math';
import { X, Grid, Info, CheckCircle2 } from 'lucide-react';

interface AbcXyzModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  settings?: AppSettings;
  language: Language;
}

export const AbcXyzModal: React.FC<AbcXyzModalProps> = ({
  isOpen,
  onClose,
  items,
  settings,
  language,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';
  const currSym = getCurrencySymbol(settings?.currency_code || 'EGP', language);

  // Re-classify dynamically with configured thresholds, excluding dormant SKUs
  const classifiedItems = useMemo(() => {
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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Grid className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.tabs.abc} — {isAr ? 'مصفوفة تصنيف المخزون التساعية' : '9-Box Portfolio Classification Matrix'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'تصنيف الأصناف حسب مساهمتها في الإيرادات (ABC) واستقرار الطلب (XYZ)' : 'Classify portfolio by revenue importance (ABC) and demand variability (XYZ)'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 bg-white text-[12px]">
          {/* 3x3 Grid */}
          <div className="grid grid-cols-3 gap-3">
            {matrix.map(m => {
              const matchedItems = classifiedItems.filter(i => `${i.abcClass}${i.xyzClass}` === m.cell);
              return (
                <div 
                  key={m.cell} 
                  className={`p-3 rounded-lg border ${m.color} flex flex-col justify-between min-h-[110px]`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm font-mono">{m.cell}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/60">
                      {matchedItems.length} {isAr ? 'أصناف' : 'SKUs'}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold mt-1">
                    {m.policy}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-600 truncate">
                    {matchedItems.map(i => i.code).join(', ') || '-'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Details Table */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 mb-1.5">
              {isAr ? 'تفاصيل تصنيف الأصناف:' : 'Item Classification Breakdown:'}
            </h4>
            <div className="border border-[#E2E8F0] rounded overflow-hidden max-h-48 overflow-y-auto">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th className="text-center">ABC</th>
                    <th className="text-center">XYZ</th>
                    <th>Sales Price ({currSym})</th>
                    <th>Annual Turnover</th>
                    <th>Inventory Value ({currSym})</th>
                  </tr>
                </thead>
                <tbody>
                  {classifiedItems.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="text-left font-mono font-bold text-slate-800">{item.code}</td>
                      <td className="text-left text-slate-700 truncate max-w-xs">{item.description}</td>
                      <td className="text-center font-bold">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          item.abcClass === 'A' ? 'bg-emerald-100 text-emerald-800' :
                          item.abcClass === 'B' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {item.abcClass}
                        </span>
                      </td>
                      <td className="text-center font-bold text-slate-700">{item.xyzClass}</td>
                      <td className="font-mono">{formatCurrency(item.salesPrice, settings, language)}</td>
                      <td className="font-mono font-semibold">{item.turnoverRatio}x</td>
                      <td className="font-mono font-bold">{formatCurrency(item.inventoryValue || 0, settings, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
