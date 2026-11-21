import React from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { X, ShoppingCart, CheckCircle, Download, FileSpreadsheet, Send } from 'lucide-react';
import { exportSheetsToExcel } from '../utils/excelExport';

interface PlannedOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onApproveOrder: (itemId: string) => void;
  settings?: AppSettings;
  language: Language;
}

export const PlannedOrdersModal: React.FC<PlannedOrdersModalProps> = ({
  isOpen,
  onClose,
  items,
  onApproveOrder,
  settings,
  language,
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';
  const currSym = getCurrencySymbol(settings?.currency_code || 'EGP', language);

  const orderItems = items.filter(isAnalyzableItem).filter(i => (i.orderNow || 0) > 0);
  const totalUnits = orderItems.reduce((sum, i) => sum + (i.orderNow || 0), 0);
  const totalValue = orderItems.reduce((sum, i) => sum + (i.orderNowValue || 0), 0);

  const handleExportXlsx = async () => {
    const data = orderItems.map(i => ({
      'Item Code': i.code,
      'Description': i.description,
      'Supplier': i.supplier,
      'Location': i.location,
      'Order Qty': i.orderNow,
      [`Unit Cost (${currSym})`]: i.purchasePrice,
      [`Total Value (${currSym})`]: i.orderNowValue,
      'Lead Time (Days)': i.leadTimeDays,
      'Status': i.approvalState,
    }));
    await exportSheetsToExcel([{ name: 'Purchase Orders', rows: data }], 'NEXO_Purchase_Orders.xlsx');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {t.inventory.toolbar.plannedOrders} ({orderItems.length} {isAr ? 'أوامر' : 'POs'})
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr ? 'تجميع وتأكيد أوامر الشراء المقترحة لتوريد المخزون' : 'Consolidated purchase orders for replenishment release'}
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

        {/* Table */}
        <div className="flex-1 overflow-auto bg-white p-3">
          <table className="nexo-grid w-full text-right text-[12px]">
            <thead>
              <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10 text-[11px]">
                <th className={`text-left w-24 bg-[#ECEFF1] ${isAr ? 'sticky right-0' : 'sticky left-0'}`}>{t.inventory.table.code}</th>
                <th className="text-left min-w-[150px]">{t.inventory.table.desc}</th>
                <th className="text-left min-w-[110px]">{t.common.supplier}</th>
                <th className="text-left min-w-[90px]">{t.inventory.table.location}</th>
                <th className="min-w-[70px] bg-amber-50 text-amber-900 font-bold">{t.inventory.table.orderNow}</th>
                <th className="min-w-[70px]">Unit Cost ({currSym})</th>
                <th className="min-w-[85px] bg-amber-50 text-amber-900 font-bold">{t.inventory.table.orderValue} ({currSym})</th>
                <th className="text-center min-w-[80px]">{t.inventory.table.approval}</th>
                <th className="text-center min-w-[70px]">{t.inventory.table.action}</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.map((item, idx) => (
                <tr key={item.id} className={`hover:bg-amber-50/40 ${idx % 2 === 1 ? 'bg-[#F8F9FA]' : 'bg-white'}`}>
                  <td className={`text-left font-mono font-bold text-slate-800 bg-inherit ${isAr ? 'sticky right-0' : 'sticky left-0'}`}>{item.code}</td>
                  <td className="text-left font-medium text-slate-800 truncate max-w-xs">{item.description}</td>
                  <td className="text-left text-slate-600 truncate">{item.supplier}</td>
                  <td className="text-left text-slate-600">{item.location}</td>
                  <td className="font-mono font-bold text-amber-800">{item.orderNow?.toLocaleString()}</td>
                  <td className="font-mono text-slate-700">{formatCurrency(item.purchasePrice, settings, language)}</td>
                  <td className="font-mono font-bold text-slate-900">{formatCurrency(item.orderNowValue, settings, language)}</td>
                  <td className="text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      item.approvalState === 'approved' 
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                        : 'bg-slate-200 text-slate-700'
                    }`}>
                      {item.approvalState}
                    </span>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => onApproveOrder(item.id)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                        item.approvalState === 'approved'
                          ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {item.approvalState === 'approved' ? (isAr ? 'إلغاء' : 'Revoke') : (isAr ? 'اعتماد' : 'Approve')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-4 text-slate-700 font-semibold">
            <span>{isAr ? 'إجمالي الوحدات:' : 'Total Units:'} <strong className="text-amber-800 font-mono">{totalUnits.toLocaleString()}</strong></span>
            <span>{isAr ? 'إجمالي الميزانية:' : 'Total Value:'} <strong className="text-slate-900 font-mono">{formatCurrency(totalValue, settings, language)}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportXlsx}
              className="px-3 py-1 bg-white border border-[#CBD5E1] hover:bg-[#E2E8F0] text-slate-700 font-semibold rounded text-[11px] flex items-center gap-1.5 shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>{isAr ? 'تصدير أوامر الشراء' : 'Export Orders (.xlsx)'}</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
