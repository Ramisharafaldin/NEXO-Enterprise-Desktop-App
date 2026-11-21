import React, { useState, useMemo } from 'react';
import { InventoryItem, AppSettings, isAnalyzableItem } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { 
  X, 
  ShoppingCart, 
  Download, 
  ChevronDown, 
  Search, 
  MapPin, 
  Layers, 
  Building2,
  PackageCheck
} from 'lucide-react';
import { exportSheetsToExcel } from '../utils/excelExport';
import { formatItemCode } from '../utils/formatters';

interface PlannedOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onApproveOrder: (itemId: string) => void;
  settings?: AppSettings;
  language: Language;
  selectedLocation?: string;
}

interface SupplierPOGroup {
  poNumber: string;
  supplierName: string;
  items: InventoryItem[];
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
}) => {
  if (!isOpen) return null;

  const t = translations[language];
  const isAr = language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(() => new Set());

  // 1. Filter all replenishment items that have active orders
  const orderItems = useMemo(() => {
    return items.filter(isAnalyzableItem).filter(i => {
      if ((i.orderNow || 0) <= 0) return false;
      if (!selectedLocation || selectedLocation === 'ALL') return true;
      return (i.location || '').toLowerCase().trim() === selectedLocation.toLowerCase().trim();
    });
  }, [items, selectedLocation]);

  const totalSkus = orderItems.length;
  const totalUnits = useMemo(() => orderItems.reduce((sum, i) => sum + (i.orderNow || 0), 0), [orderItems]);
  const totalValue = useMemo(() => orderItems.reduce((sum, i) => sum + (i.orderNowValue || 0), 0), [orderItems]);

  // 2. Group items by Supplier into distinct Purchase Orders (Master-Detail)
  const supplierPOGroups: SupplierPOGroup[] = useMemo(() => {
    const supplierMap = new Map<string, InventoryItem[]>();
    for (const item of orderItems) {
      const rawSup = item.supplier?.trim();
      const supName = rawSup || (isAr ? 'مورد غير محدد' : 'Unassigned Supplier');
      if (!supplierMap.has(supName)) {
        supplierMap.set(supName, []);
      }
      supplierMap.get(supName)!.push(item);
    }

    // Sort suppliers descending by total PO budget value
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
      poNumber: `PO-${String(idx + 1).padStart(3, '0')}`
    }));
  }, [orderItems, isAr]);

  // 3. Filter groups based on search query
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return supplierPOGroups;

    return supplierPOGroups.map(group => {
      const supplierMatches = group.supplierName.toLowerCase().includes(q) || group.poNumber.toLowerCase().includes(q);
      const matchingItems = group.items.filter(item => 
        cleanItemCode(item.code).toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.location && item.location.toLowerCase().includes(q))
      );

      if (supplierMatches) {
        return group;
      }
      if (matchingItems.length > 0) {
        return {
          ...group,
          items: matchingItems,
          skuCount: matchingItems.length,
          totalUnits: matchingItems.reduce((sum, i) => sum + (i.orderNow || 0), 0),
          totalValue: matchingItems.reduce((sum, i) => sum + (i.orderNowValue || 0), 0),
        };
      }
      return null;
    }).filter(Boolean) as SupplierPOGroup[];
  }, [supplierPOGroups, searchQuery]);

  // Expand / Collapse toggles
  const handleTogglePO = (poNumber: string) => {
    setExpandedPOs(prev => {
      const next = new Set(prev);
      if (next.has(poNumber)) {
        next.delete(poNumber);
      } else {
        next.add(poNumber);
      }
      return next;
    });
  };

  const allExpanded = filteredGroups.length > 0 && filteredGroups.every(g => expandedPOs.has(g.poNumber));
  const handleToggleExpandAll = () => {
    if (allExpanded) {
      setExpandedPOs(new Set());
    } else {
      setExpandedPOs(new Set(filteredGroups.map(g => g.poNumber)));
    }
  };

  // Per-supplier single PO export
  const handleExportSinglePO = async (group: SupplierPOGroup, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const rows = group.items.map(i => ({
      [isAr ? 'رقم أمر الشراء' : 'PO Number']: group.poNumber,
      [isAr ? 'اسم المورد' : 'Supplier']: group.supplierName,
      [isAr ? 'كود الصنف' : 'Item Code']: cleanItemCode(i.code),
      [isAr ? 'اسم الصنف' : 'Description']: i.description,
      [isAr ? 'الموقع / الفرع' : 'Location']: i.location || '',
      [isAr ? 'الكمية المطلوبة' : 'Order Qty']: i.orderNow || 0,
      [isAr ? 'سعر التكلفة' : 'Unit Cost']: Number((i.purchasePrice || 0).toFixed(2)),
      [isAr ? 'إجمالي القيمة' : 'Line Total']: Number((i.orderNowValue || 0).toFixed(2)),
      [isAr ? 'فترة التوريد (يوم)' : 'Lead Time (Days)']: i.leadTimeDays || 0,
      [isAr ? 'حالة الاعتماد' : 'Approval Status']: i.approvalState || 'pending',
    }));
    const safeSupplier = group.supplierName.replace(/[\\/*?:\[\]]/g, '_').slice(0, 30);
    const hasLoc = Boolean(selectedLocation && selectedLocation !== 'ALL');
    const locTag = hasLoc ? `_${selectedLocation!.trim()}` : '';
    const filename = `PO${locTag}_${group.poNumber}_${safeSupplier}.xlsx`;
    await exportSheetsToExcel([{ name: group.poNumber, rows }], filename);
  };

  // Main Export All POs: 2 sheets (Summary + Line Items)
  const handleExportAllPOs = async () => {
    // Sheet 1: PO Summary
    const summaryRows = supplierPOGroups.map(g => ({
      [isAr ? 'رقم أمر الشراء' : 'PO Number']: g.poNumber,
      [isAr ? 'اسم المورد' : 'Supplier']: g.supplierName,
      [isAr ? 'عدد الأصناف' : 'SKU Count']: g.skuCount,
      [isAr ? 'إجمالي الوحدات المطلوبة' : 'Total Units']: g.totalUnits,
      [isAr ? 'إجمالي قيمة أمر الشراء' : 'Total PO Value']: Number(g.totalValue.toFixed(2)),
      [isAr ? 'الفروع المغطاة' : 'Locations Covered']: g.locations.join(', ') || '-',
    }));

    // Sheet 2: PO Line Items
    const lineItemRows: Record<string, any>[] = [];
    for (const g of supplierPOGroups) {
      for (const i of g.items) {
        lineItemRows.push({
          [isAr ? 'رقم أمر الشراء' : 'PO Number']: g.poNumber,
          [isAr ? 'اسم المورد' : 'Supplier']: g.supplierName,
          [isAr ? 'كود الصنف' : 'Item Code']: cleanItemCode(i.code),
          [isAr ? 'اسم الصنف' : 'Description']: i.description,
          [isAr ? 'الموقع / الفرع' : 'Location']: i.location || '',
          [isAr ? 'الكمية المطلوبة' : 'Order Qty']: i.orderNow || 0,
          [isAr ? 'سعر التكلفة' : 'Unit Cost']: Number((i.purchasePrice || 0).toFixed(2)),
          [isAr ? 'إجمالي القيمة' : 'Line Total']: Number((i.orderNowValue || 0).toFixed(2)),
          [isAr ? 'فترة التوريد (يوم)' : 'Lead Time (Days)']: i.leadTimeDays || 0,
          [isAr ? 'حالة الاعتماد' : 'Approval Status']: i.approvalState || 'pending',
        });
      }
    }

    const hasLoc = Boolean(selectedLocation && selectedLocation !== 'ALL');
    const locTag = hasLoc ? `_${selectedLocation!.trim()}` : '';
    await exportSheetsToExcel([
      { name: isAr ? 'ملخص أوامر الشراء' : 'PO Summary', rows: summaryRows },
      { name: isAr ? 'تفاصيل الأصناف' : 'PO Line Items', rows: lineItemRows }
    ], `PO${locTag}_Planned_Purchase_Orders.xlsx`);
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
                    ? `أوامر الشراء المخططة (${supplierPOGroups.length} أمر شراء • ${totalSkus} صنف)`
                    : `Planned Purchase Orders (${supplierPOGroups.length} POs • ${totalSkus} SKUs)`
                  }
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isAr 
                  ? 'تجميع أوامر الشراء حسب الموردين لتسهيل التعميد وإصدار أوامر التوريد'
                  : 'Consolidated supplier purchase orders for streamlined approval and procurement release'
                }
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar: Search & Expand All */}
        <div className="p-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className={`w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 ${isAr ? 'right-2.5' : 'left-2.5'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث باسم المورد، كود الصنف، أو الوصف...' : 'Search by supplier, SKU code, or description...'}
              className={`w-full bg-white border border-slate-200 rounded-lg py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-2xs ${
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

          <div className="flex items-center gap-2">
            {searchQuery && (
              <span className="text-[11px] text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded">
                {isAr ? `مطابقة ${filteredGroups.length} من ${supplierPOGroups.length}` : `${filteredGroups.length} of ${supplierPOGroups.length} matching`}
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleExpandAll}
              disabled={filteredGroups.length === 0}
              className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-[11px] flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>{allExpanded ? (isAr ? 'طي الكل' : 'Collapse All') : (isAr ? 'توسيع الكل' : 'Expand All')}</span>
            </button>
          </div>
        </div>

        {/* Master-Detail PO Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/50 space-y-3">
          {filteredGroups.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="p-3 rounded-full bg-slate-100 text-slate-400 mb-3">
                <PackageCheck className="w-8 h-8 stroke-[1.5]" />
              </div>
              <h4 className="text-sm font-bold text-slate-700 mb-1">
                {searchQuery 
                  ? (isAr ? 'لا توجد نتائج مطابقة لبحثك' : 'No matching purchase orders found')
                  : (isAr ? 'لا توجد أوامر شراء مقترحة حالياً' : 'No purchase orders required at this time')
                }
              </h4>
              <p className="text-xs text-slate-500 max-w-sm">
                {searchQuery
                  ? (isAr ? 'جرّب البحث بكلمات أخرى أو امسح شريط البحث' : 'Try searching with different terms or clear the search filter')
                  : (isAr ? 'جميع الأصناف في مستويات مخزون آمنة ولا تحتاج إلى طلب توريد' : 'All SKUs are currently operating within safe inventory levels')
                }
              </p>
            </div>
          ) : (
            filteredGroups.map(group => {
              const isExpanded = expandedPOs.has(group.poNumber);
              return (
                <div
                  key={group.poNumber}
                  className={`border rounded-xl transition-all overflow-hidden bg-white shadow-2xs ${
                    isExpanded ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Supplier Card Header */}
                  <div
                    onClick={() => handleTogglePO(group.poNumber)}
                    className="p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none bg-slate-50/70 hover:bg-amber-50/30 transition"
                  >
                    {/* Left Details: Sequence, Supplier Name, SKU Badge, Locations */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-slate-900 text-white tracking-wider shrink-0 shadow-2xs">
                        {group.poNumber}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-[13px] sm:text-sm truncate" title={group.supplierName}>
                            {group.supplierName}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                            {group.skuCount} {isAr ? 'صنف' : 'SKUs'}
                          </span>
                        </div>
                        {group.locations.length > 0 && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-xs">{group.locations.join(' • ')}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Metrics & Quick Export */}
                    <div className="flex items-center gap-3 sm:gap-4 text-xs shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="text-end">
                          <span className="text-[10px] text-slate-500 block">{isAr ? 'إجمالي الوحدات' : 'Total Units'}</span>
                          <span className="font-mono font-bold text-amber-800 text-[12px] sm:text-[13px]">
                            {group.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className={`text-end ps-3 ${isAr ? 'border-r' : 'border-l'} border-slate-200`}>
                          <span className="text-[10px] text-slate-500 block">{isAr ? 'قيمة الأمر' : 'PO Value'}</span>
                          <span className="font-mono font-bold text-slate-900 text-[12px] sm:text-[13px]">
                            {group.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => handleExportSinglePO(group, e)}
                          title={isAr ? 'تصدير أمر الشراء لهذا المورد' : 'Export PO for this supplier'}
                          className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                          <span className="hidden sm:inline">{isAr ? 'تصدير الأمر' : 'Export PO'}</span>
                        </button>

                        <div className="p-1 text-slate-400">
                          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-amber-600' : ''}`} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Itemized SKU Table */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 overflow-x-auto bg-white p-2 sm:p-3">
                      <table className="w-full text-[11.5px] border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 font-semibold text-[11px] border-b border-slate-200">
                            <th className="py-2 px-2.5 text-start w-28">{isAr ? 'كود الصنف' : 'SKU Code'}</th>
                            <th className="py-2 px-2.5 text-start min-w-[200px]">{isAr ? 'الوصف' : 'Description'}</th>
                            <th className="py-2 px-2.5 text-start min-w-[110px]">{isAr ? 'الموقع / الفرع' : 'Branch / Location'}</th>
                            <th className="py-2 px-2.5 text-center min-w-[85px] bg-amber-50/60 text-amber-900 font-bold">{isAr ? 'الكمية المطلوبة' : 'Order Qty'}</th>
                            <th className="py-2 px-2.5 text-center min-w-[90px]">{isAr ? 'سعر التكلفة' : 'Unit Cost'}</th>
                            <th className="py-2 px-2.5 text-center min-w-[100px] bg-amber-50/60 text-amber-900 font-bold">{isAr ? 'إجمالي الصنف' : 'Line Total'}</th>
                            <th className="py-2 px-2.5 text-center min-w-[75px]">{isAr ? 'الاعتماد' : 'Status'}</th>
                            <th className="py-2 px-2.5 text-center min-w-[75px]">{isAr ? 'الإجراء' : 'Action'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.items.map((item, itemIdx) => {
                            const cleanCode = cleanItemCode(item.code);
                            const isApproved = item.approvalState === 'approved';
                            return (
                              <tr key={item.id || itemIdx} className="hover:bg-slate-50 transition">
                                <td className="py-2 px-2.5 font-mono font-bold text-slate-800 text-start">{cleanCode}</td>
                                <td className="py-2 px-2.5 font-medium text-slate-800 truncate max-w-xs text-start" title={item.description}>
                                  {item.description}
                                </td>
                                <td className="py-2 px-2.5 text-slate-600 text-start">{item.location || '-'}</td>
                                <td className="py-2 px-2.5 font-mono font-bold text-amber-900 text-center">
                                  {(item.orderNow || 0).toLocaleString()}
                                </td>
                                <td className="py-2 px-2.5 font-mono text-slate-700 text-center">
                                  {(item.purchasePrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-2.5 font-mono font-bold text-slate-900 text-center">
                                  {(item.orderNowValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-2.5 text-center">
                                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isApproved 
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}>
                                    {isApproved ? (isAr ? 'معتمد' : 'Approved') : (isAr ? 'معلق' : 'Pending')}
                                  </span>
                                </td>
                                <td className="py-2 px-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => onApproveOrder(item.id)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                                      isApproved
                                        ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                                        : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                                    }`}
                                  >
                                    {isApproved ? (isAr ? 'إلغاء' : 'Revoke') : (isAr ? 'اعتماد' : 'Approve')}
                                  </button>
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

        {/* Footer */}
        <div className="p-3.5 bg-[#ECEFF1] border-t border-[#CBD5E1] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-5 text-slate-700 font-semibold flex-wrap">
            <span>
              {isAr ? 'إجمالي الوحدات:' : 'Total Units:'}{' '}
              <strong className="text-amber-800 font-mono text-sm">
                {totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
              disabled={supplierPOGroups.length === 0}
              className="px-3.5 py-1.5 bg-white border border-[#CBD5E1] hover:bg-[#E2E8F0] text-slate-800 font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>{isAr ? 'تصدير أوامر الشراء (ملخص + تفاصيل)' : 'Export All POs (Summary + Details)'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-[#2196F3] text-white font-semibold rounded-lg text-xs hover:bg-blue-600 transition shadow-2xs"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
