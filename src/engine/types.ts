/**
 * NEXO - Supply Chain Demand Forecasting & Inventory Replenishment Platform
 * Core Type Definitions
 */

export type ModelType = 
  | 'auto'
  | 'constant'
  | 'linear'
  | 'seasonal'
  | 'intermittent'
  | 'preorder'
  | 'zero';

export type ReplenishmentStrategy = 'periodic' | 'minmax' | 'min_max';

export type CheckState = 'undecided' | 'checked' | 'attention';

export type ApprovalState = 'unapproved' | 'approved';

export type BomType = 'product' | 'finished' | 'intermediate' | 'material';

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface TimeSeriesPeriod {
  date: string; // YYYY-MM or YYYY-MM-DD
  actual: number;
  forecast?: number;
  model?: number; // fitted historical model
  confUpper?: number;
  confLower?: number;
  override?: number;
  promotion?: number; // % promo discount / lift
  label?: string;     // display label (e.g. for sub-monthly periods)
}

export interface InventoryItem {
  id: string;
  code: string;
  description: string;
  category: string;
  location: string;
  channel: string;
  supplier: string;
  dc?: string; // Distribution Center for multi-echelon
  bomType?: BomType;
  
  // Pricing & Value
  salesPrice: number;
  purchasePrice: number;
  margin?: number; // %
  inventoryValue?: number;
  turnoverRatio?: number;
  
  // Inventory Parameters
  onHand: number;
  onOrder: number; // in transit / scheduled receipts
  backorders: number;
  leadTimeDays: number;
  leadTimeVarianceDays: number;
  orderCycleDays: number;
  serviceLevel: number; // e.g. 0.95 or 0.98
  minBatch: number; // Minimum Order Quantity (MOQ)
  batchRounding: number; // Multiple / box round
  shelfLifeDays?: number;
  unitCbm?: number;
  unitWeightKg?: number;
  
  // Model Settings
  modelType: ModelType;
  replenishmentStrategy: ReplenishmentStrategy;
  
  // Calculated Demand Metrics
  periods: TimeSeriesPeriod[];
  fittedModelType?: ModelType;
  meanDailyDemand?: number;
  demandVariance?: number;
  demandStdDev?: number;
  mape?: number;
  wmape?: number;
  accuracy?: number; // 100 - MAPE
  
  // Calculated Replenishment Metrics
  safetyStock?: number;
  reorderPoint?: number;
  maxInventory?: number;
  orderNow?: number;
  orderNowValue?: number;
  daysOfSupply?: number;
  projectedDaysOfSupply?: number;
  transferQty?: number;
  transferSource?: string;
  
  // Risk & Status Flags
  isStockout?: boolean;
  stockoutDate?: string;
  isOverstock?: boolean;
  overstockValue?: number;
  isDeadInventory?: boolean;
  deadInventoryValue?: number;
  expectedWriteOffValue?: number;
  
  // Classifications
  abcClass?: AbcClass;
  xyzClass?: XyzClass;
  checkState: CheckState;
  approvalState: ApprovalState;
  notes?: string;
  totalSales?: number;
  isDormant?: boolean;
}

export { isAnalyzableItem, filterAnalyzableItems } from './dormantFilter';

export interface OrderItem {
  id: string;
  itemCode: string;
  itemDescription: string;
  supplier: string;
  location: string;
  quantity: number;
  purchasePrice: number;
  totalValue: number;
  orderDate: string;
  expectedArrivalDate: string;
  reorderPoint: number;
  onHand: number;
  safetyStock: number;
  minBatch: number;
  rounding: number;
  status: 'draft' | 'approved' | 'submitted';
}

export interface BomComponent {
  parentCode: string;
  componentCode: string;
  quantityPerBatch: number;
  batchRounding?: number;
}

export interface DashboardKpis {
  totalInventoryValue: number;
  totalOverstockValue: number;
  totalStockoutLossValue: number;
  totalDeadInventoryValue: number;
  projectedAnnualRevenue: number;
  grossMarginPct: number;
  inventoryTurns: number;
  daysOfSupply: number;
  carryingCostSavings: number;
  releasedCapital: number;
  overallForecastAccuracy: number;
  totalSkus: number;
  activeOrdersCount: number;
}

export interface AppSettings {
  language: 'en' | 'ar';
  currency_code: string;
  currency_symbol: string;
  currency_position: 'before' | 'after';
  decimal_places: number;
  exchange_rate: number;
  analysis_lookback_periods: number;
  forecast_horizon_periods: number | string;
  period_granularity: 'daily' | 'weekly' | 'monthly';
  default_forecast_model: string;
  default_service_level: number;
  default_replenishment_policy: 'periodic' | 'minmax' | 'min_max';
  default_order_cycle_days: number;
  default_lead_time_days: number;
  overstock_threshold_days: number;
  dead_stock_days: number;
  abc_a_cutoff: number;
  abc_b_cutoff: number;
  xyz_x_cv: number;
  xyz_y_cv: number;
  updated_at?: string;
}
