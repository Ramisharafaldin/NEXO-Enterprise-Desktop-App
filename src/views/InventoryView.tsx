import React, { useState, useRef, useEffect } from 'react';
import { InventoryItem, ReplenishmentStrategy, AppSettings } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { 
  Search, 
  Settings, 
  Download, 
  Upload, 
  ShoppingCart, 
  Box, 
  Network, 
  HelpCircle, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle,
  ArrowRightLeft,
  Truck,
  Plus,
  X,
  Filter,
  Check
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, SavedFilter, InTransitionRecord } from '../api/client';

interface InventoryViewProps {
  items: InventoryItem[];
  projectId?: string;
  onStrategyChange: (strategy: ReplenishmentStrategy) => void;
  onExplainItem: (item: InventoryItem) => void;
  onOpenPlannedOrdersModal: () => void;
  onOpenContainersModal: () => void;
  onOpenDrpModal: () => void;
  onRefreshProject?: () => void;
  settings?: AppSettings;
  language: Language;
}

const DEFAULT_VISIBLE_COLS = {
  code: true,
  desc: true,
  category: true,
  location: true,
  abc: true,
  onHand: true,
  onOrder: true,
  backorders: true,
  leadTime: true,
  safetyStock: true,
  rop: true,
  coverage: true,
  orderNow: true,
  orderValue: true,
  transfer: true,
  status: true,
};

export const InventoryView: React.FC<InventoryViewProps> = ({
  items,
  projectId = 'proj_default_retail',
  onStrategyChange,
  onExplainItem,
  onOpenPlannedOrdersModal,
  onOpenContainersModal,
  onOpenDrpModal,
  onRefreshProject,
  settings,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'toOrder' | 'stockout' | 'overstock' | 'transition' | string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showInTransitionOnly, setShowInTransitionOnly] = useState(false);

  // Saved Filters from DuckDB
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterColumn, setFilterColumn] = useState('daysOfSupply');
  const [filterOperator, setFilterOperator] = useState('<');
  const [filterVal, setFilterVal] = useState('30');

  // Column Visibility State with LocalStorage Persistence
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<typeof DEFAULT_VISIBLE_COLS>(() => {
    try {
      const saved = localStorage.getItem('nexo_inventory_visible_cols');
      if (saved) return { ...DEFAULT_VISIBLE_COLS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_VISIBLE_COLS;
  });

  const toggleCol = (colKey: string, checked: boolean) => {
    setVisibleCols(prev => {
      const next = { ...prev, [colKey]: checked };
      try {
        localStorage.setItem('nexo_inventory_visible_cols', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // In Transition Shipments Modal State
  const [isInTransitionModalOpen, setIsInTransitionModalOpen] = useState(false);
  const [transitions, setTransitions] = useState<InTransitionRecord[]>([]);
  const [newShipment, setNewShipment] = useState({
    item_code: '',
    order_no: '',
    origin: '',
    destination: '',
    quantity: 100,
    eta_date: '2026-03-25',
    carrier: 'Maersk Line'
  });

  // Load saved filters and shipments from DuckDB
  useEffect(() => {
    if (projectId) {
      api.getFilters(projectId).then(setSavedFilters).catch(() => {});
      api.getTransitions(projectId).then(setTransitions).catch(() => {});
    }
  }, [projectId]);

  // Handle new filter creation
  const handleCreateFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filterName.trim()) return;
    try {
      const created = await api.createFilter(projectId, {
        name: filterName.trim(),
        filter_column: filterColumn,
        operator: filterOperator,
        filter_value: filterVal.trim(),
      });
      setSavedFilters(prev => [...prev, created]);
      setActiveFilterTab(created.id);
      setIsFilterModalOpen(false);
      setFilterName('');
    } catch (err: any) {
      alert(`Error creating filter: ${err.message}`);
    }
  };

  // Handle filter deletion
  const handleDeleteFilter = async (filterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteFilter(projectId, filterId);
      setSavedFilters(prev => prev.filter(f => f.id !== filterId));
      if (activeFilterTab === filterId) {
        setActiveFilterTab('all');
      }
    } catch (err: any) {
      alert(`Error deleting filter: ${err.message}`);
    }
  };

  // Handle adding transition record
  const handleAddShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShipment.item_code.trim() || !newShipment.order_no.trim()) return;
    try {
      const added = await api.addTransition(projectId, newShipment);
      setTransitions(prev => [...prev, added]);
      setNewShipment({
        item_code: '',
        order_no: '',
        origin: '',
        destination: '',
        quantity: 100,
        eta_date: '2026-03-25',
        carrier: 'Maersk Line'
      });
    } catch (err: any) {
      alert(`Error adding shipment: ${err.message}`);
    }
  };

  // Export / Import parameter files
  const handleExportParameters = () => {
    const params = items.map(i => ({
      code: i.code,
      description: i.description,
      modelType: i.modelType,
      replenishmentStrategy: i.replenishmentStrategy,
      leadTimeDays: i.leadTimeDays,
      leadTimeVarianceDays: i.leadTimeVarianceDays,
      orderCycleDays: i.orderCycleDays,
      serviceLevel: i.serviceLevel,
      minBatch: i.minBatch,
      batchRounding: i.batchRounding,
      safetyStock: i.safetyStock,
      reorderPoint: i.reorderPoint,
    }));
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NEXO_Inventory_Parameters_${projectId}.json`;
    a.click();
  };

  const paramFileInputRef = useRef<HTMLInputElement>(null);
  const handleImportParameters = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            const match = items.find(it => it.code === p.code);
            if (match) {
              await api.updateItemParameters(projectId, match.id, {
                modelType: p.modelType,
                replenishmentStrategy: p.replenishmentStrategy,
                leadTimeDays: p.leadTimeDays,
                serviceLevel: p.serviceLevel,
                minBatch: p.minBatch,
              });
            }
          }
          alert(isAr ? 'تم استيراد المعلمات وتحديث قاعدة البيانات بنجاح.' : 'Parameters imported and saved to DuckDB successfully.');
          if (onRefreshProject) {
            onRefreshProject();
          }
        }
      } catch (err: any) {
        alert(`Error parsing parameter JSON: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Filtered items logic
  const filteredItems = items.filter(item => {
    const matchesSearch = !searchTerm || 
      item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (showInTransitionOnly) return (item.onOrder || 0) > 0;

    if (activeFilterTab === 'all') return true;
    if (activeFilterTab === 'toOrder') return (item.orderNow || 0) > 0;
    if (activeFilterTab === 'stockout') return !!item.isStockout;
    if (activeFilterTab === 'overstock') return !!item.isOverstock;
    if (activeFilterTab === 'transition') return (item.onOrder || 0) > 0;

    // Check custom DuckDB saved filter
    const customFilt = savedFilters.find(f => f.id === activeFilterTab);
    if (customFilt) {
      const colVal = (item as any)[customFilt.filter_column];
      const targetVal = isNaN(Number(customFilt.filter_value)) ? customFilt.filter_value : Number(customFilt.filter_value);
      if (customFilt.operator === '<') return Number(colVal) < Number(targetVal);
      if (customFilt.operator === '>') return Number(colVal) > Number(targetVal);
      if (customFilt.operator === '=') return String(colVal).toLowerCase() === String(targetVal).toLowerCase();
      if (customFilt.operator === '!=') return String(colVal).toLowerCase() !== String(targetVal).toLowerCase();
    }

    return true;
  });

  const handleExportTable = () => {
    const wb = XLSX.utils.book_new();
    const data = filteredItems.map(i => ({
      'Item Code': i.code,
      'Description': i.description,
      'Category': i.category,
      'Location': i.location,
      'ABC/XYZ': `${i.abcClass}${i.xyzClass}`,
      'On Hand': i.onHand,
      'On Order': i.onOrder,
      'Backorders': i.backorders,
      'Lead Time (Days)': i.leadTimeDays,
      'Safety Stock': i.safetyStock,
      'Reorder Point': i.reorderPoint,
      'Days of Supply': i.daysOfSupply,
      'Order Now': i.orderNow,
      [`Order Value (${getCurrencySymbol(settings?.currency_code || 'EGP', language)})`]: i.orderNowValue,
      'Transfer Suggestion': i.transferQty ? `${i.transferQty} units from ${i.transferSource}` : 'None',
      'Approval': i.approvalState,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory Replenishment');
    XLSX.writeFile(wb, `NEXO_Inventory_Replenishment_${projectId}.xlsx`);
  };

  const toOrderCount = items.filter(i => (i.orderNow || 0) > 0).length;
  const stockoutCount = items.filter(i => i.isStockout).length;
  const overstockCount = items.filter(i => i.isOverstock).length;
  const transitionCount = items.filter(i => (i.onOrder || 0) > 0).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8F9FA] select-none text-[#1E293B] text-[12px]">
      <input
        type="file"
        ref={paramFileInputRef}
        onChange={handleImportParameters}
        accept=".json"
        className="hidden"
      />

      {/* 1. Top Filter Tabs */}
      <div className="flex items-center justify-between px-3 h-8 bg-[#ECEFF1] border-b border-[#CBD5E1] shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveFilterTab('all')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'all'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-[#2196F3] shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.inventory.filterTabs.all} ({items.length})
          </button>
          <button
            onClick={() => setActiveFilterTab('toOrder')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'toOrder'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-[#2196F3] shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.inventory.filterTabs.toOrder} ({toOrderCount})
          </button>
          <button
            onClick={() => setActiveFilterTab('stockout')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'stockout'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-rose-600 shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.inventory.filterTabs.stockoutRisk} ({stockoutCount})
          </button>
          <button
            onClick={() => setActiveFilterTab('overstock')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'overstock'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-amber-600 shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.inventory.filterTabs.overstocked} ({overstockCount})
          </button>
          <button
            onClick={() => setActiveFilterTab('transition')}
            className={`px-3 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
              activeFilterTab === 'transition'
                ? 'bg-white border-[#CBD5E1] border-b-transparent text-emerald-600 shadow-xs'
                : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
            }`}
          >
            {t.inventory.filterTabs.inTransition} ({transitionCount})
          </button>

          {/* Dynamic Saved Filter Tabs */}
          {savedFilters.map(f => (
            <div
              key={f.id}
              onClick={() => setActiveFilterTab(f.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t border-t border-x text-[11px] font-semibold transition cursor-pointer ${
                activeFilterTab === f.id
                  ? 'bg-white border-[#CBD5E1] border-b-transparent text-purple-700 shadow-xs'
                  : 'border-transparent text-slate-600 hover:bg-[#E2E8F0]'
              }`}
            >
              <Filter className="w-3 h-3 text-purple-500" />
              <span>{f.name}</span>
              <button
                onClick={e => handleDeleteFilter(f.id, e)}
                className="hover:text-rose-600 ml-1 text-slate-400"
                title={isAr ? 'حذف الفلتر' : 'Delete Filter'}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* + New Filter Builder Trigger */}
          <button
            onClick={() => setIsFilterModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#2196F3] hover:text-blue-700 font-bold hover:bg-white/60 rounded transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.inventory.filterTabs.newFilter}</span>
          </button>
        </div>

        {/* Global Strategy Mode Pill */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 font-medium">
            {isAr ? 'الاستراتيجية:' : 'Strategy:'}
          </span>
          <div className="inline-flex rounded border border-[#CBD5E1] bg-white p-0.5 text-[10px] font-semibold">
            <button
              onClick={() => onStrategyChange('periodic')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                items[0]?.replenishmentStrategy === 'periodic'
                  ? 'bg-[#2196F3] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isAr ? 'دوري (Periodic JIT)' : 'Periodic (JIT)'}
            </button>
            <button
              onClick={() => onStrategyChange('minmax')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                items[0]?.replenishmentStrategy === 'minmax'
                  ? 'bg-[#2196F3] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isAr ? 'أدنى/أقصى (Min/Max)' : 'Min/Max'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Horizontal Action Bar */}
      <div className="flex items-center justify-between px-3 h-9 bg-white border-b border-[#D1D5DB] shrink-0 text-[11px] font-medium text-slate-700">
        <div className="flex items-center gap-1.5">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t.inventory.toolbar.search}
              className="pl-7 pr-2 py-1 text-[11px] border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] bg-white w-48"
            />
          </div>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* Planned Orders Button */}
          <button
            onClick={onOpenPlannedOrdersModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-50 border border-sky-300 text-[#2196F3] font-semibold hover:bg-sky-100 transition shadow-xs cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t.inventory.toolbar.plannedOrders}</span>
            {toOrderCount > 0 && (
              <span className="text-[10px] bg-[#2196F3] text-white px-1.5 rounded-full font-bold">
                {toOrderCount}
              </span>
            )}
          </button>

          {/* Containers and Groups Button */}
          <button
            onClick={onOpenContainersModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-300 text-emerald-700 font-semibold hover:bg-emerald-100 transition shadow-xs cursor-pointer"
          >
            <Box className="w-3.5 h-3.5" />
            <span>{t.inventory.toolbar.containers}</span>
          </button>

          {/* DRP Button */}
          <button
            onClick={onOpenDrpModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-50 border border-purple-300 text-purple-700 font-semibold hover:bg-purple-100 transition shadow-xs cursor-pointer"
          >
            <Network className="w-3.5 h-3.5" />
            <span>{t.inventory.toolbar.drp}</span>
          </button>

          <div className="w-[1px] h-5 bg-[#CBD5E1] mx-1" />

          {/* In Transition Modal Button */}
          <button
            onClick={() => setIsInTransitionModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#CBD5E1] hover:bg-[#E2E8F0] text-slate-700 font-semibold transition cursor-pointer"
          >
            <Truck className="w-3.5 h-3.5 text-blue-600" />
            <span>{t.inventory.toolbar.inTransition}</span>
            <span className="text-[10px] bg-slate-200 text-slate-800 px-1.5 rounded-full font-mono">
              {transitions.length}
            </span>
          </button>
        </div>

        {/* Right side actions: Parameters Import/Export, Export Table, Show Columns */}
        <div className="flex items-center gap-1.5 relative">
          <button
            onClick={handleExportParameters}
            className="flex items-center gap-1 px-2 py-1 border border-[#CBD5E1] rounded hover:bg-[#E2E8F0] text-slate-700 cursor-pointer"
            title={isAr ? 'تصدير معلمات المخزون كملف JSON' : 'Export inventory parameters JSON'}
          >
            <Download className="w-3 h-3 text-slate-500" />
            <span>{t.inventory.toolbar.exportParams}</span>
          </button>

          <button
            onClick={() => paramFileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 border border-[#CBD5E1] rounded hover:bg-[#E2E8F0] text-slate-700 cursor-pointer"
            title={isAr ? 'استيراد وتحديث معلمات المخزون' : 'Import inventory parameters JSON'}
          >
            <Upload className="w-3 h-3 text-slate-500" />
            <span>{t.inventory.toolbar.importParams}</span>
          </button>

          <button
            onClick={handleExportTable}
            className="flex items-center gap-1 px-2.5 py-1 border border-[#CBD5E1] rounded hover:bg-[#E2E8F0] text-slate-700 shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.inventory.toolbar.exportTable}</span>
          </button>

          {/* Show Columns Toggle Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setIsColumnDropdownOpen(prev => !prev)}
              className="flex items-center gap-1 px-2 py-1 border border-[#CBD5E1] rounded hover:bg-[#E2E8F0] text-slate-700 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
              <span>{t.inventory.toolbar.showColumns}</span>
            </button>

            {isColumnDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-[#CBD5E1] rounded-md shadow-xl z-50 p-2 space-y-1.5 text-[11px]">
                <div className="font-bold text-slate-700 pb-1 border-b border-slate-100 flex items-center justify-between">
                  <span>{isAr ? 'تخصيص الأعمدة' : 'Toggle Columns'}</span>
                  <button onClick={() => setIsColumnDropdownOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {Object.entries(visibleCols).map(([colKey, isVisible]) => (
                  <label key={colKey} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={e => toggleCol(colKey, e.target.checked)}
                      className="w-3.5 h-3.5 text-[#2196F3] rounded"
                    />
                    <span className="capitalize">{colKey.replace(/([A-Z])/g, ' $1')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Full-Width High-Density Replenishment Table */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="nexo-grid w-full text-right">
          <thead>
            <tr className="bg-[#ECEFF1] text-slate-700 font-semibold sticky top-0 z-10 text-[11px]">
              {visibleCols.code && (
                <th className="text-left w-24 sticky left-0 bg-[#ECEFF1] z-20 border-r border-[#CBD5E1]">
                  {t.inventory.table.code}
                </th>
              )}
              {visibleCols.desc && <th className="text-left min-w-[160px]">{t.inventory.table.desc}</th>}
              {visibleCols.category && <th className="text-left min-w-[90px]">{t.inventory.table.category}</th>}
              {visibleCols.location && <th className="text-left min-w-[90px]">{t.inventory.table.location}</th>}
              {visibleCols.abc && <th className="text-center min-w-[50px]">{t.inventory.table.abc}</th>}
              {visibleCols.onHand && <th className="min-w-[65px]">{t.inventory.table.onHand}</th>}
              {visibleCols.onOrder && <th className="min-w-[65px]">{t.inventory.table.onOrder}</th>}
              {visibleCols.backorders && <th className="min-w-[65px]">{t.inventory.table.backorders}</th>}
              {visibleCols.leadTime && <th className="min-w-[75px]">{t.inventory.table.leadTime}</th>}
              {visibleCols.safetyStock && <th className="min-w-[75px] bg-sky-50 text-sky-900">{t.inventory.table.safetyStock}</th>}
              {visibleCols.rop && <th className="min-w-[75px] bg-sky-50 text-sky-900">{t.inventory.table.rop}</th>}
              {visibleCols.coverage && <th className="min-w-[75px]">{t.inventory.table.coverage}</th>}
              {visibleCols.orderNow && <th className="min-w-[80px] bg-amber-50 text-amber-900 font-bold">{t.inventory.table.orderNow}</th>}
              {visibleCols.orderValue && <th className="min-w-[90px] bg-amber-50 text-amber-900">{t.inventory.table.orderValue}</th>}
              {visibleCols.transfer && <th className="text-left min-w-[140px]">{t.inventory.table.transfer}</th>}
              {visibleCols.status && <th className="text-center min-w-[75px]">{t.inventory.table.status}</th>}
              <th className="text-center min-w-[60px]">{t.inventory.table.action}</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, idx) => {
              const isToOrder = (item.orderNow || 0) > 0;
              return (
                <tr 
                  key={item.id} 
                  className={`hover:bg-blue-50/50 transition border-b border-[#E2E8F0] ${
                    isToOrder ? 'bg-amber-50/20' : idx % 2 === 0 ? 'bg-white' : 'bg-[#F8F9FA]/60'
                  }`}
                >
                  {visibleCols.code && (
                    <td className="text-left font-mono font-bold text-slate-800 sticky left-0 bg-inherit z-10 border-r border-[#CBD5E1]">
                      {item.code}
                    </td>
                  )}
                  {visibleCols.desc && (
                    <td className="text-left text-slate-700 truncate max-w-[200px]" title={item.description}>
                      {item.description}
                    </td>
                  )}
                  {visibleCols.category && (
                    <td className="text-left text-slate-600 truncate max-w-[120px]">
                      {item.category}
                    </td>
                  )}
                  {visibleCols.location && (
                    <td className="text-left text-slate-600 truncate max-w-[120px]">
                      {item.location}
                    </td>
                  )}
                  {visibleCols.abc && (
                    <td className="text-center font-bold font-mono">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        item.abcClass === 'A' ? 'bg-emerald-100 text-emerald-800' :
                        item.abcClass === 'B' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {item.abcClass}{item.xyzClass}
                      </span>
                    </td>
                  )}
                  {visibleCols.onHand && (
                    <td className="font-mono text-slate-800">
                      {item.onHand.toLocaleString()}
                    </td>
                  )}
                  {visibleCols.onOrder && (
                    <td className="font-mono text-slate-700">
                      {item.onOrder > 0 ? (
                        <span className="text-[#2196F3] font-semibold">+{item.onOrder.toLocaleString()}</span>
                      ) : '-'}
                    </td>
                  )}
                  {visibleCols.backorders && (
                    <td className="font-mono text-slate-700">
                      {item.backorders > 0 ? (
                        <span className="text-rose-600 font-bold">-{item.backorders}</span>
                      ) : '-'}
                    </td>
                  )}
                  {visibleCols.leadTime && (
                    <td className="font-mono text-slate-700">
                      {item.leadTimeDays}d
                    </td>
                  )}
                  {visibleCols.safetyStock && (
                    <td className="font-mono font-bold bg-sky-50/60 text-sky-900">
                      {item.safetyStock?.toLocaleString() || '-'}
                    </td>
                  )}
                  {visibleCols.rop && (
                    <td className="font-mono font-bold bg-sky-50/60 text-[#2196F3]">
                      {item.reorderPoint?.toLocaleString() || '-'}
                    </td>
                  )}
                  {visibleCols.coverage && (
                    <td className="font-mono">
                      <span className={`font-semibold ${
                        (item.daysOfSupply || 0) < 14 ? 'text-rose-600' :
                        (item.daysOfSupply || 0) < 30 ? 'text-amber-600' : 'text-emerald-700'
                      }`}>
                        {item.daysOfSupply}d
                      </span>
                    </td>
                  )}
                  {visibleCols.orderNow && (
                    <td className="font-mono font-black bg-amber-50/70 text-amber-900">
                      {isToOrder ? item.orderNow?.toLocaleString() : '-'}
                    </td>
                  )}
                  {visibleCols.orderValue && (
                    <td className="font-mono bg-amber-50/70 text-amber-900">
                      {isToOrder ? formatCurrency(item.orderNowValue || 0, settings, language) : '-'}
                    </td>
                  )}
                  {visibleCols.transfer && (
                    <td className="text-left font-mono text-[11px]">
                      {item.transferQty ? (
                        <span className="text-purple-700 bg-purple-50 px-1 py-0.5 rounded border border-purple-200">
                          {item.transferQty} ← {item.transferSource}
                        </span>
                      ) : '-'}
                    </td>
                  )}
                  {visibleCols.status && (
                    <td className="text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        item.approvalState === 'approved' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {item.approvalState === 'approved' ? (isAr ? 'معتمد' : 'Approved') : (isAr ? 'قيد المراجعة' : 'Pending')}
                      </span>
                    </td>
                  )}
                  <td className="text-center">
                    <button
                      onClick={() => onExplainItem(item)}
                      className="p-1 hover:bg-[#E2E8F0] rounded text-slate-400 hover:text-[#2196F3] transition cursor-pointer"
                      title={isAr ? 'شرح الحسابات' : 'Explain Calculation'}
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* New Filter Builder Modal */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-[#CBD5E1] w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-[#F8F9FA] px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#2196F3]" />
                <h3 className="text-sm font-bold text-slate-800">
                  {isAr ? 'إنشاء فلتر مخصص وحفظه في DuckDB' : 'Create Custom Inventory Filter'}
                </h3>
              </div>
              <button onClick={() => setIsFilterModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFilter} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {isAr ? 'اسم الفلتر' : 'Filter Name'} *
                </label>
                <input
                  type="text"
                  required
                  value={filterName}
                  onChange={e => setFilterName(e.target.value)}
                  placeholder={isAr ? 'مثال: أصناف حرجة ذات تغطية أقل من 20 يوم' : 'e.g. Critical Stock < 20 Days'}
                  className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3]"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    {isAr ? 'الحقل المستهدف' : 'Field'}
                  </label>
                  <select
                    value={filterColumn}
                    onChange={e => setFilterColumn(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] bg-white font-mono"
                  >
                    <option value="daysOfSupply">Days of Supply (Coverage)</option>
                    <option value="safetyStock">Safety Stock</option>
                    <option value="reorderPoint">Reorder Point (ROP)</option>
                    <option value="orderNow">Order Now Qty</option>
                    <option value="leadTimeDays">Lead Time (Days)</option>
                    <option value="abcClass">ABC Class (A, B, C)</option>
                    <option value="category">Category</option>
                    <option value="location">Location</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    {isAr ? 'المعامل' : 'Operator'}
                  </label>
                  <select
                    value={filterOperator}
                    onChange={e => setFilterOperator(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] bg-white font-mono"
                  >
                    <option value="<">Less Than (&lt;)</option>
                    <option value=">">Greater Than (&gt;)</option>
                    <option value="=">Equals (=)</option>
                    <option value="!=">Not Equals (!=)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  {isAr ? 'القيمة' : 'Threshold Value'} *
                </label>
                <input
                  type="text"
                  required
                  value={filterVal}
                  onChange={e => setFilterVal(e.target.value)}
                  placeholder="30"
                  className="w-full px-3 py-1.5 border border-[#CBD5E1] rounded focus:outline-none focus:border-[#2196F3] font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFilterModalOpen(false)}
                  className="px-3 py-1.5 border border-[#CBD5E1] text-slate-700 rounded font-semibold hover:bg-slate-100"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white rounded font-semibold shadow-xs"
                >
                  {isAr ? 'حفظ وتطبيق الفلتر' : 'Save & Apply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In Transition Tracking Modal */}
      {isInTransitionModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-[#CBD5E1] w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#F8F9FA] px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#2196F3]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isAr ? 'تتبع الشحنات قيد الانتقال والتوريد' : 'In-Transition Shipment Tracking'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {isAr ? 'مخزون قيد النقل مسجل في DuckDB ويحسب مباشرة ضمن المعادلة' : 'Live scheduled receipts recorded in DuckDB reducing calculated replenishment'}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsInTransitionModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Shipments Table */}
              <div className="border border-[#CBD5E1] rounded-md overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-[#ECEFF1] text-slate-700 font-semibold text-[11px]">
                    <tr>
                      <th className="p-2">{isAr ? 'رمز الصنف' : 'Item Code'}</th>
                      <th className="p-2">{isAr ? 'رقم أمر الشراء' : 'PO Number'}</th>
                      <th className="p-2">{isAr ? 'المصدر' : 'Origin'}</th>
                      <th className="p-2">{isAr ? 'الوجهة' : 'Destination'}</th>
                      <th className="p-2 text-right">{isAr ? 'الكمية' : 'Quantity'}</th>
                      <th className="p-2">{isAr ? 'تاريخ الوصول المتوقع' : 'ETA Date'}</th>
                      <th className="p-2">{isAr ? 'الناقل' : 'Carrier'}</th>
                      <th className="p-2 text-center">{isAr ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transitions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-slate-400">
                          {isAr ? 'لا توجد شحنات قيد النقل حالياً' : 'No in-transit shipments currently recorded'}
                        </td>
                      </tr>
                    ) : (
                      transitions.map((tr, idx) => (
                        <tr key={tr.id || idx} className="hover:bg-slate-50">
                          <td className="p-2 font-mono font-bold text-slate-800">{tr.item_code}</td>
                          <td className="p-2 font-mono text-[#2196F3]">{tr.order_no}</td>
                          <td className="p-2 text-slate-600">{tr.origin}</td>
                          <td className="p-2 text-slate-600">{tr.destination}</td>
                          <td className="p-2 font-mono font-bold text-right text-emerald-700">+{tr.quantity}</td>
                          <td className="p-2 font-mono text-slate-600">{tr.eta_date}</td>
                          <td className="p-2 text-slate-600">{tr.carrier}</td>
                          <td className="p-2 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#2196F3]">
                              {tr.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add New Shipment Form */}
              <form onSubmit={handleAddShipment} className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                <span className="font-bold text-slate-700 block">
                  {isAr ? 'إضافة شحنة جديدة قيد النقل:' : 'Record New In-Transit Shipment:'}
                </span>
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Item Code (e.g. 004652-BLU)"
                    value={newShipment.item_code}
                    onChange={e => setNewShipment({ ...newShipment, item_code: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white"
                  />
                  <input
                    type="text"
                    required
                    placeholder="PO Number (e.g. PO-98499)"
                    value={newShipment.order_no}
                    onChange={e => setNewShipment({ ...newShipment, order_no: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white"
                  />
                  <input
                    type="number"
                    required
                    placeholder="Quantity"
                    value={newShipment.quantity}
                    onChange={e => setNewShipment({ ...newShipment, quantity: Number(e.target.value) })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white"
                  />
                  <input
                    type="date"
                    required
                    value={newShipment.eta_date}
                    onChange={e => setNewShipment({ ...newShipment, eta_date: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Origin (e.g. Port of Rotterdam)"
                    value={newShipment.origin}
                    onChange={e => setNewShipment({ ...newShipment, origin: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  />
                  <input
                    type="text"
                    placeholder="Destination (e.g. WH-East)"
                    value={newShipment.destination}
                    onChange={e => setNewShipment({ ...newShipment, destination: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Carrier (e.g. Maersk)"
                      value={newShipment.carrier}
                      onChange={e => setNewShipment({ ...newShipment, carrier: e.target.value })}
                      className="px-2.5 py-1.5 border border-slate-300 rounded bg-white flex-1"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-[#2196F3] text-white rounded font-bold hover:bg-blue-600 transition shadow-xs cursor-pointer shrink-0"
                    >
                      {isAr ? 'إضافة' : 'Add'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="bg-[#F8F9FA] px-4 py-3 border-t border-[#E2E8F0] flex justify-end">
              <button
                onClick={() => setIsInTransitionModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-semibold"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
