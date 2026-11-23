/**
 * Hardened, unified Excel (.xlsx) export utility.
 * Replaces vulnerable frontend xlsx package (SEC-HIGH-03).
 * Calls backend POST /api/export/excel with openpyxl, formula injection
 * sanitization (SEC-MED-01) and automatic Arabic RTL sheet support.
 * Supports native pywebview save dialog in desktop mode and standard browser Blob download.
 */

import { InventoryItem } from '../engine/types';
import { Language } from '../i18n/translations';
import { formatItemCode } from './formatters';

export interface ExcelSheet {
  name: string;
  rows: Record<string, any>[];
}

export async function exportSheetsToExcel(sheets: ExcelSheet[], filename: string): Promise<boolean> {
  const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const res = await fetch('/api/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: safeFilename, sheets }),
  });

  if (!res.ok) {
    throw new Error(`Failed to generate Excel file: ${res.statusText}`);
  }

  const blob = await res.blob();

  // 1. Native pywebview desktop save dialog
  const pyApi = (window as any).pywebview?.api;
  if (pyApi && typeof pyApi.save_file_dialog === 'function') {
    try {
      return await new Promise<boolean>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64data = (reader.result as string).split(',')[1];
            const savedPath = await pyApi.save_file_dialog(safeFilename, base64data);
            resolve(!!savedPath);
          } catch {
            resolve(false);
          }
        };
        reader.readAsDataURL(blob);
      });
    } catch {
      // Fallback to browser blob
    }
  }

  // 2. Standard browser Blob download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return true;
}

export interface DrpExportParams {
  items: InventoryItem[];
  transferRecommendations: {
    code: string;
    description: string;
    source: string;
    destination: string;
    quantity: number;
    leadTimeDays: number;
    priority: 'high' | 'normal';
  }[];
  primaryDc: string;
  branches: string[];
  language: Language;
  selectedLocation?: string;
}

export async function exportDrpReport(params: DrpExportParams): Promise<boolean> {
  const isAr = params.language === 'ar';
  
  // Sheet 1: Transfer Recommendations
  const recRows = params.transferRecommendations.map(r => ({
    [isAr ? 'كود الصنف' : 'Item Code']: formatItemCode(r.code),
    [isAr ? 'اسم الصنف' : 'Description']: r.description,
    [isAr ? 'المستودع المصدر' : 'Source DC']: r.source,
    [isAr ? 'الفرع المستلم' : 'Destination Branch']: r.destination,
    [isAr ? 'كمية المناقلة' : 'Transfer Qty']: r.quantity,
    [isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (Days)']: r.leadTimeDays,
    [isAr ? 'أولوية المناقلة' : 'Priority']: r.priority === 'high' 
      ? (isAr ? 'عاجلة (نفاذ مخزون)' : 'Urgent (Stockout)')
      : (isAr ? 'قياسية' : 'Standard'),
  }));

  if (recRows.length === 0) {
    recRows.push({
      [isAr ? 'كود الصنف' : 'Item Code']: '-',
      [isAr ? 'اسم الصنف' : 'Description']: isAr ? 'لا توجد مناقلات مطلوبة حالياً، المخزون متوازن عبر الفروع' : 'No urgent intersite transfers needed; network inventory is balanced',
      [isAr ? 'المستودع المصدر' : 'Source DC']: params.primaryDc,
      [isAr ? 'الفرع المستلم' : 'Destination Branch']: params.branches.join(', ') || '-',
      [isAr ? 'كمية المناقلة' : 'Transfer Qty']: 0,
      [isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (Days)']: 0,
      [isAr ? 'أولوية المناقلة' : 'Priority']: isAr ? 'متوازن' : 'Balanced',
    });
  }

  // Sheet 2: Regional Branch Balances (ALL matching items)
  const balanceRows = params.items.map(i => ({
    [isAr ? 'كود الصنف' : 'Item Code']: formatItemCode(i.code),
    [isAr ? 'اسم الصنف' : 'Description']: i.description,
    [isAr ? 'الموقع / الفرع' : 'Location']: i.location || params.primaryDc,
    [isAr ? 'الرصيد الحالي' : 'On Hand']: Number(i.onHand || 0),
    [isAr ? 'مخزون الأمان' : 'Safety Stock']: Number(i.safetyStock || 0),
    [isAr ? 'نقطة إعادة الطلب' : 'Reorder Point']: Number(i.reorderPoint || 0),
    [isAr ? 'الطلب الفوري' : 'Order Now']: Number(i.orderNow || 0),
    [isAr ? 'سعر البيع' : 'Sales Price']: Number((i.salesPrice || 0).toFixed(2)),
    [isAr ? 'سعر الشراء' : 'Purchase Price']: Number((i.purchasePrice || 0).toFixed(2)),
  }));

  const hasLoc = Boolean(params.selectedLocation && params.selectedLocation !== 'ALL');
  const locTag = hasLoc ? `_${params.selectedLocation!.trim()}` : '';
  const filename = `DRP_Transfers_Report${locTag}.xlsx`;

  return exportSheetsToExcel([
    { name: isAr ? 'توصيات المناقلات' : 'Transfer Recommendations', rows: recRows },
    { name: isAr ? 'أرصدة الفروع الإقليمية' : 'Regional Branch Balances', rows: balanceRows }
  ], filename);
}

export interface MrpExportParams {
  selectedParent: InventoryItem;
  productionPlanQty: number;
  components: {
    item: InventoryItem;
    qtyPerParent: number;
    grossReq: number;
    netShortage: number;
    componentOrder: number;
  }[];
  language: Language;
}

export async function exportMrpReport(params: MrpExportParams): Promise<boolean> {
  const isAr = params.language === 'ar';
  const p = params.selectedParent;

  const rows: Record<string, any>[] = [];

  // Metadata block in row 1
  rows.push({
    [isAr ? 'كود المكون' : 'Component SKU']: isAr ? 'المنتج التام المحدد:' : 'Finished Parent SKU:',
    [isAr ? 'اسم المكون' : 'Description']: `${formatItemCode(p.code)} — ${p.description}`,
    [isAr ? 'الكمية لكل وحدة' : 'Qty Per Parent']: '',
    [isAr ? 'الرصيد المتوفر' : 'On Hand']: isAr ? `خطة الإنتاج: ${params.productionPlanQty}` : `Plan Qty: ${params.productionPlanQty}`,
    [isAr ? 'قيد التوريد' : 'On Order']: '',
    [isAr ? 'إجمالي الاحتياج' : 'Gross Req']: '',
    [isAr ? 'صافي العجز' : 'Net Shortage']: '',
    [isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (Days)']: isAr ? `مهلة التوريد: ${p.leadTimeDays || 14} يوم` : `Lead Time: ${p.leadTimeDays || 14}d`,
    [isAr ? 'كمية أمر التوريد الموصى بها' : 'Recommended Order Qty']: '',
  });

  let totalGross = 0;
  let totalShortage = 0;
  let totalOrder = 0;

  params.components.forEach(c => {
    totalGross += c.grossReq;
    totalShortage += c.netShortage;
    totalOrder += c.componentOrder;

    rows.push({
      [isAr ? 'كود المكون' : 'Component SKU']: formatItemCode(c.item.code),
      [isAr ? 'اسم المكون' : 'Description']: c.item.description,
      [isAr ? 'الكمية لكل وحدة' : 'Qty Per Parent']: `${c.qtyPerParent}.0x`,
      [isAr ? 'الرصيد المتوفر' : 'On Hand']: Number(c.item.onHand || 0),
      [isAr ? 'قيد التوريد' : 'On Order']: Number(c.item.onOrder || 0),
      [isAr ? 'إجمالي الاحتياج' : 'Gross Req']: Number(c.grossReq),
      [isAr ? 'صافي العجز' : 'Net Shortage']: Number(c.netShortage),
      [isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (Days)']: Number(c.item.leadTimeDays || 14),
      [isAr ? 'كمية أمر التوريد الموصى بها' : 'Recommended Order Qty']: Number(c.componentOrder),
    });
  });

  // Summary Row
  rows.push({
    [isAr ? 'كود المكون' : 'Component SKU']: isAr ? 'الإجمالي العام' : 'Total Summary',
    [isAr ? 'اسم المكون' : 'Description']: isAr ? `${params.components.length} مكونات تابعة` : `${params.components.length} Components`,
    [isAr ? 'الكمية لكل وحدة' : 'Qty Per Parent']: '-',
    [isAr ? 'الرصيد المتوفر' : 'On Hand']: '-',
    [isAr ? 'قيد التوريد' : 'On Order']: '-',
    [isAr ? 'إجمالي الاحتياج' : 'Gross Req']: totalGross,
    [isAr ? 'صافي العجز' : 'Net Shortage']: totalShortage,
    [isAr ? 'مهلة التوريد (يوم)' : 'Lead Time (Days)']: '-',
    [isAr ? 'كمية أمر التوريد الموصى بها' : 'Recommended Order Qty']: totalOrder,
  });

  const safeParentCode = formatItemCode(p.code).replace(/[\\/*?:\[\]]/g, '_');
  const filename = `MRP_BOM_Explosion_${safeParentCode}.xlsx`;

  return exportSheetsToExcel([
    { name: isAr ? 'شجرة تراكيب المواد' : 'BOM Explosion', rows }
  ], filename);
}

export interface AbcXyzExportParams {
  matrix: {
    cell: string;
    policy: string;
  }[];
  classifiedItems: (InventoryItem & {
    turnoverRatio?: number;
    inventoryValue?: number;
  })[];
  language: Language;
  selectedLocation?: string;
}

export async function exportAbcXyzReport(params: AbcXyzExportParams): Promise<boolean> {
  const isAr = params.language === 'ar';
  
  const totalRev = params.classifiedItems.reduce((sum, i) => sum + ((i.salesPrice || 0) * (i.meanDailyDemand || 0) * 365), 0) || 1;

  // Sheet 1: Matrix Summary (9 cells AX..CZ)
  const summaryRows = params.matrix.map(m => {
    const matched = params.classifiedItems.filter(i => `${i.abcClass}${i.xyzClass}` === m.cell);
    const cellCount = matched.length;
    const cellInvValue = matched.reduce((sum, i) => sum + (i.inventoryValue || (i.onHand * (i.purchasePrice || 0))), 0);
    const cellRevenue = matched.reduce((sum, i) => sum + ((i.salesPrice || 0) * (i.meanDailyDemand || 0) * 365), 0);
    const revSharePct = Number(((cellRevenue / totalRev) * 100).toFixed(1));

    return {
      [isAr ? 'الخلية' : 'Cell']: m.cell,
      [isAr ? 'استراتيجية التخطيط والسياسة' : 'Replenishment Policy']: m.policy,
      [isAr ? 'عدد الأصناف' : 'SKU Count']: cellCount,
      [isAr ? 'حصة الإيرادات %' : 'Revenue Share %']: revSharePct,
      [isAr ? 'إجمالي قيمة المخزون' : 'Total Inventory Value']: Number(cellInvValue.toFixed(2)),
    };
  });

  // Sheet 2: SKU Classifications
  const detailRows = params.classifiedItems.map(i => {
    const invVal = i.inventoryValue ?? Number(((i.onHand || 0) * (i.purchasePrice || 0)).toFixed(2));
    const annualRev = Number(((i.salesPrice || 0) * (i.meanDailyDemand || 0) * 365).toFixed(2));
    return {
      [isAr ? 'كود الصنف' : 'Item Code']: formatItemCode(i.code),
      [isAr ? 'اسم الصنف' : 'Description']: i.description,
      [isAr ? 'القسم / الفئة' : 'Category']: i.category || 'General',
      [isAr ? 'الموقع / الفرع' : 'Location']: i.location || 'Central DC',
      [isAr ? 'تصنيف ABC' : 'ABC Class']: i.abcClass || 'C',
      [isAr ? 'تصنيف XYZ' : 'XYZ Class']: i.xyzClass || 'Z',
      [isAr ? 'التصنيف المزدوج' : 'Combined Class']: `${i.abcClass || 'C'}${i.xyzClass || 'Z'}`,
      [isAr ? 'سعر البيع' : 'Sales Price']: Number((i.salesPrice || 0).toFixed(2)),
      [isAr ? 'سعر الشراء' : 'Purchase Price']: Number((i.purchasePrice || 0).toFixed(2)),
      [isAr ? 'معدل الدوران السنوي' : 'Turnover Ratio']: Number(i.turnoverRatio ?? 0),
      [isAr ? 'الرصيد المتوفر' : 'On Hand']: Number(i.onHand || 0),
      [isAr ? 'قيمة المخزون' : 'Inventory Value']: invVal,
    };
  });

  const hasLoc = Boolean(params.selectedLocation && params.selectedLocation !== 'ALL');
  const locTag = hasLoc ? `_${params.selectedLocation!.trim()}` : '';
  const filename = `ABC_XYZ_Matrix_Report${locTag}.xlsx`;

  return exportSheetsToExcel([
    { name: isAr ? 'ملخص المصفوفة' : 'Matrix Summary', rows: summaryRows },
    { name: isAr ? 'تفاصيل الأصناف' : 'SKU Classifications', rows: detailRows }
  ], filename);
}
