import React, { useState } from 'react';
import { InventoryItem, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatItemCode } from '../utils/formatters';
import { api } from '../api/client';
import { X, Box, CheckCircle2, AlertTriangle, Truck } from 'lucide-react';

interface ContainersModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  projectId?: string;
  onItemUpdated?: (itemId: string, unitCbm: number, unitWeightKg: number) => void;
  language: Language;
}

export const ContainersModal: React.FC<ContainersModalProps> = ({
  isOpen,
  onClose,
  items,
  projectId,
  onItemUpdated,
  language,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  const [containerType, setContainerType] = useState<'20ft' | '40ft' | '40hc'>('40ft');

  // Specs: 20ft (33 m3, 21,600 kg), 40ft (67 m3, 26,500 kg), 40hc (76 m3, 26,300 kg)
  const containerSpecs = {
    '20ft': { maxVol: 33, maxWeight: 21600, label: '20ft Standard Dry Container' },
    '40ft': { maxVol: 67, maxWeight: 26500, label: '40ft Standard Dry Container' },
    '40hc': { maxVol: 76, maxWeight: 26300, label: '40ft High Cube Container' },
  };

  const spec = containerSpecs[containerType];
  const orderItems = items.filter(isAnalyzableItem).filter(i => (i.orderNow || 0) > 0);

  // Dynamic volume & weight based on actual item properties
  const totalVolume = orderItems.reduce((sum, i) => sum + ((i.orderNow || 0) * (i.unitCbm ?? 0.05)), 0);
  const totalWeight = orderItems.reduce((sum, i) => sum + ((i.orderNow || 0) * (i.unitWeightKg ?? 12)), 0);

  const volPercent = Math.min(100, Math.round((totalVolume / spec.maxVol) * 100));
  const weightPercent = Math.min(100, Math.round((totalWeight / spec.maxWeight) * 100));

  const handleCbmChange = async (item: InventoryItem, val: number) => {
    const updatedCbm = Math.max(0.001, Number(val));
    if (projectId) {
      try {
        await api.updateItemParameters(projectId, item.id, { unitCbm: updatedCbm });
      } catch (e) {
        console.warn('Failed to save unitCbm to DuckDB', e);
      }
    }
    if (onItemUpdated) {
      onItemUpdated(item.id, updatedCbm, item.unitWeightKg ?? 12);
    }
  };

  const handleWeightChange = async (item: InventoryItem, val: number) => {
    const updatedWeight = Math.max(0.1, Number(val));
    if (projectId) {
      try {
        await api.updateItemParameters(projectId, item.id, { unitWeightKg: updatedWeight });
      } catch (e) {
        console.warn('Failed to save unitWeightKg to DuckDB', e);
      }
    }
    if (onItemUpdated) {
      onItemUpdated(item.id, item.unitCbm ?? 0.05, updatedWeight);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.tabs.containers} — {isAr ? 'حساب ملء الحاويات والأحمال التصديرية' : 'Container Load & Volume Optimizer'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'حساب نسبة ملء الحاويات بالشحنات وتعديل أحجام وأوزان الوحدات مع حفظها في DuckDB' : 'Calculate container fill percentages and customize SKU dimensions in DuckDB'}
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
        <div className="p-5 overflow-y-auto space-y-4 bg-white text-[12px]">
          {/* Container Type Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
              {isAr ? 'نوع الحاوية البحرية:' : 'Container Equipment Type:'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['20ft', '40ft', '40hc'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setContainerType(type)}
                  className={`p-2.5 rounded border text-center font-semibold text-xs transition cursor-pointer ${
                    containerType === type
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                      : 'border-[#CBD5E1] hover:bg-[#F1F5F9] text-slate-700'
                  }`}
                >
                  {containerSpecs[type].label}
                </button>
              ))}
            </div>
          </div>

          {/* Gauges */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            {/* Volume Meter */}
            <div className="p-4 bg-[#F8F9FA] border border-[#CBD5E1] rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>{isAr ? 'سعة الحجم (Volume):' : 'Volume Capacity:'}</span>
                <span className="font-mono font-bold text-blue-900">{totalVolume.toFixed(2)} / {spec.maxVol} m³</span>
              </div>
              <div className="w-full bg-[#E2E8F0] h-3 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    volPercent > 95 ? 'bg-rose-500' : volPercent > 80 ? 'bg-emerald-500' : 'bg-[#2196F3]'
                  }`}
                  style={{ width: `${volPercent}%` }}
                />
              </div>
              <div className="text-right text-[11px] font-bold text-slate-600">
                {volPercent}% {isAr ? 'ممتلئ' : 'filled'}
              </div>
            </div>

            {/* Weight Meter */}
            <div className="p-4 bg-[#F8F9FA] border border-[#CBD5E1] rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>{isAr ? 'سعة الوزن (Weight):' : 'Weight Capacity:'}</span>
                <span className="font-mono font-bold text-amber-900">{Math.round(totalWeight).toLocaleString()} / {spec.maxWeight.toLocaleString()} kg</span>
              </div>
              <div className="w-full bg-[#E2E8F0] h-3 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    weightPercent > 95 ? 'bg-rose-500' : weightPercent > 80 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${weightPercent}%` }}
                />
              </div>
              <div className="text-right text-[11px] font-bold text-slate-600">
                {weightPercent}% {isAr ? 'ممتلئ' : 'filled'}
              </div>
            </div>
          </div>

          {/* Allocation Table */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold text-slate-800">
                {isAr ? 'الأصناف المحملة في الحاوية (قابلة للتعديل وحفظها مباشرة):' : 'Items Loaded in Active Container (Live editable & saved to DuckDB):'}
              </h4>
              <span className="text-[10px] text-slate-500">
                {orderItems.length} {isAr ? 'صنف مطلوب طلبه' : 'items with active orders'}
              </span>
            </div>

            <div className="max-h-56 overflow-auto border border-[#E2E8F0] rounded">
              <table className="nexo-grid w-full text-right text-[11px]">
                <thead>
                  <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10">
                    <th className="text-left">{t.inventory.table.code}</th>
                    <th className="text-left">{t.inventory.table.desc}</th>
                    <th>{t.inventory.table.orderNow}</th>
                    <th className="text-center">Unit CBM (m³)</th>
                    <th className="text-center">Unit Weight (kg)</th>
                    <th>Total Vol (m³)</th>
                    <th>Total Wt (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {orderItems.length > 0 ? (
                    orderItems.map(item => {
                      const itemCbm = item.unitCbm ?? 0.05;
                      const itemWeight = item.unitWeightKg ?? 12;
                      const lineCbm = (item.orderNow || 0) * itemCbm;
                      const lineWeight = (item.orderNow || 0) * itemWeight;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="text-left font-mono font-bold text-slate-800">{formatItemCode(item.code)}</td>
                          <td className="text-left text-slate-700 truncate max-w-xs">{item.description}</td>
                          <td className="font-mono font-bold text-amber-800 bg-amber-50/40">{item.orderNow}</td>
                          <td className="text-center">
                            <input
                              type="number"
                              step="0.005"
                              min="0.001"
                              value={itemCbm}
                              onChange={e => handleCbmChange(item, Number(e.target.value))}
                              className="w-16 px-1.5 py-0.5 border border-slate-300 rounded font-mono text-center text-xs bg-white focus:border-[#2196F3]"
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="number"
                              step="0.5"
                              min="0.1"
                              value={itemWeight}
                              onChange={e => handleWeightChange(item, Number(e.target.value))}
                              className="w-16 px-1.5 py-0.5 border border-slate-300 rounded font-mono text-center text-xs bg-white focus:border-[#2196F3]"
                            />
                          </td>
                          <td className="font-mono text-slate-700">{lineCbm.toFixed(2)}</td>
                          <td className="font-mono text-slate-700">{Math.round(lineWeight).toLocaleString()}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="text-center py-4 text-slate-400">
                        {isAr ? 'لا توجد أصناف مطلوبة حالياً لتحميل الحاويات.' : 'No active purchase order quantities to load in containers.'}
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
