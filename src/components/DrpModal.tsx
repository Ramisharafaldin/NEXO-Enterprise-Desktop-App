import React, { useMemo } from 'react';
import { InventoryItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { X, Network, ArrowRightLeft, Building2, Store, CheckCircle2 } from 'lucide-react';

interface DrpModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  language: Language;
}

export const DrpModal: React.FC<DrpModalProps> = ({
  isOpen,
  onClose,
  items,
  language,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  // Dynamic Multi-Echelon Location Topology
  const locations = useMemo(() => {
    const set = new Set(items.map(i => i.location || (isAr ? 'المستودع الرئيسي' : 'Central DC')));
    return Array.from(set);
  }, [items, isAr]);

  const primaryDc = useMemo(() => {
    const dcItem = items.find(i => !!i.dc);
    return dcItem ? dcItem.location : (locations[0] || 'Central DC');
  }, [items, locations]);

  const branches = useMemo(() => {
    return locations.filter(l => l !== primaryDc);
  }, [locations, primaryDc]);

  // Dynamic DRP Intersite Transfer Recommendations Engine
  const transferRecommendations = useMemo(() => {
    const recommendations: {
      id: string;
      code: string;
      description: string;
      source: string;
      destination: string;
      quantity: number;
      leadTimeDays: number;
      priority: 'high' | 'normal';
    }[] = [];

    // Group items by item code across locations
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
        // Find best source (prioritize DC, then other branches)
        const dcSource = surplusVariants.find(s => s.location === primaryDc && (s.onHand - s.safetyStock) > 0);
        const sourceItem = dcSource || surplusVariants.find(s => s.location !== deficit.location && (s.onHand - s.safetyStock) > 0);

        if (sourceItem) {
          const availableSurplus = Math.max(0, sourceItem.onHand - sourceItem.safetyStock);
          const transferQty = Math.min(needed, availableSurplus);
          if (transferQty > 0) {
            recommendations.push({
              id: `${deficit.id}-${sourceItem.id}`,
              code: deficit.code,
              description: deficit.description,
              source: sourceItem.location,
              destination: deficit.location,
              quantity: Math.round(transferQty),
              leadTimeDays: Math.min(deficit.leadTimeDays || 3, 5),
              priority: deficit.onHand <= 0 ? 'high' : 'normal',
            });
          }
        }
      });
    });

    return recommendations;
  }, [items, primaryDc]);

  const regionalStoreItems = useMemo(() => {
    return items.filter(i => i.location !== primaryDc);
  }, [items, primaryDc]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-purple-50 text-purple-600 border border-purple-200">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.tabs.dc} — {isAr ? 'شبكة التوزيع متعددة المستويات والمناقلات (DRP)' : 'Two-Echelon DRP Network & Transfer Optimization'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'تجميع احتياجات الفروع بالمستودع الرئيسي وجدولة المناقلات الفورية لمنع النفاذ' : 'Consolidate branch demand at Central Hub & balance network stock'}
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
          {/* Topology Architecture Banner */}
          <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 text-white rounded shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-purple-950 block text-[13px]">
                  {primaryDc} ({isAr ? 'المستودع المركزي الرئيسي' : 'Primary Upstream DC'})
                </span>
                <span className="text-[11px] text-purple-700">
                  {branches.length > 0 
                    ? (isAr ? `يغذي ${branches.length} فروع توزيع: (${branches.join(', ')})` : `Upstream supply hub feeding ${branches.length} branches: (${branches.join(', ')})`)
                    : (isAr ? 'شبكة التوزيع الحالية' : 'Single distribution facility')}
                </span>
              </div>
            </div>
            <div className="text-right text-[11px] text-purple-900 font-mono bg-white p-2 rounded border border-purple-200 shrink-0">
              Intersite Lead Time: <strong>2 - 4 days</strong>
            </div>
          </div>

          {/* Transfer Recommendations Table */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-600" />
              <span>{isAr ? 'توصيات المناقلات الفورية بين المستودعات والفروع:' : 'Immediate Intersite Transfer Recommendations:'}</span>
            </h4>
            <div className="border border-[#E2E8F0] rounded overflow-hidden">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th className="text-left">{isAr ? 'مستودع المصدر' : 'Source Location'}</th>
                    <th className="text-left">{isAr ? 'فرع الوجهة' : 'Destination'}</th>
                    <th>{isAr ? 'كمية المناقلة' : 'Transfer Qty'}</th>
                    <th>{isAr ? 'مدة النقل' : 'Transit Time'}</th>
                    <th className="text-center">{t.inventory.table.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {transferRecommendations.length > 0 ? (
                    transferRecommendations.map(rec => (
                      <tr key={rec.id} className="hover:bg-purple-50/40">
                        <td className="text-left font-mono font-bold text-slate-800">{rec.code}</td>
                        <td className="text-left font-medium text-slate-800 truncate max-w-xs">{rec.description}</td>
                        <td className="text-left text-slate-600">{rec.source}</td>
                        <td className="text-left font-semibold text-purple-900">{rec.destination}</td>
                        <td className="font-mono font-bold text-purple-700 bg-purple-50/60">
                          {rec.quantity.toLocaleString()} units
                        </td>
                        <td className="font-mono text-slate-600">{rec.leadTimeDays}d</td>
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
                      <td colSpan={7} className="text-center py-4 text-slate-400">
                        {isAr ? 'لا توجد مناقلات مطلوبة حالياً، المخزون متوازن عبر الفروع.' : 'No urgent intersite transfers needed; network inventory is balanced.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Regional Stores Inventory Balances */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-slate-600" />
              <span>{isAr ? 'أرصدة الفروع الإقليمية:' : 'Regional Store Inventories:'}</span>
            </h4>
            <div className="border border-[#E2E8F0] rounded overflow-hidden max-h-48 overflow-y-auto">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.location}</th>
                    <th>{t.inventory.table.onHand}</th>
                    <th>{t.inventory.table.safetyStock}</th>
                    <th>{t.inventory.table.rop}</th>
                    <th>{t.inventory.table.orderNow}</th>
                  </tr>
                </thead>
                <tbody>
                  {(regionalStoreItems.length > 0 ? regionalStoreItems : items).map(item => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="text-left font-mono font-bold text-slate-800">{item.code}</td>
                      <td className="text-left text-slate-600">{item.location}</td>
                      <td className="font-mono">{item.onHand.toLocaleString()}</td>
                      <td className="font-mono">{item.safetyStock.toLocaleString()}</td>
                      <td className="font-mono font-bold text-[#2196F3]">{item.reorderPoint.toLocaleString()}</td>
                      <td className={`font-mono font-bold ${(item.orderNow || 0) > 0 ? 'text-amber-800 bg-amber-50/50' : 'text-slate-400'}`}>
                        {item.orderNow || 0}
                      </td>
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
            className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
