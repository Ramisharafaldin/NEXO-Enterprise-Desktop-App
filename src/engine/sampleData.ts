/**
 * NEXO - Comprehensive Production Sample Data
 * Authentic enterprise benchmarks with realistic supply chain dynamics
 */

import { InventoryItem, BomComponent, TimeSeriesPeriod } from './types';
import { autoSelectModel, calculateItemReplenishment, mean } from './math';

const MONTHS_HISTORICAL = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'
];

export const RAW_ITEMS: Omit<InventoryItem, 'periods' | 'safetyStock' | 'reorderPoint'>[] = [
  {
    id: 'sku_1',
    code: '004652-BLU',
    description: 'Swimwear Mediterranean Blue [Seasonal Model]',
    category: 'Fashion / Summer Style',
    location: 'WH-East (New Jersey)',
    channel: 'Direct Retail',
    supplier: 'Acme Apparel Ltd.',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 79.00,
    purchasePrice: 28.50,
    margin: 63.9,
    onHand: 120,
    onOrder: 350,
    backorders: 15,
    leadTimeDays: 45,
    leadTimeVarianceDays: 7,
    orderCycleDays: 30,
    serviceLevel: 0.95,
    minBatch: 100,
    batchRounding: 50,
    modelType: 'seasonal',
    replenishmentStrategy: 'periodic',
    checkState: 'checked',
    approvalState: 'approved',
  },
  {
    id: 'sku_2',
    code: '562156-01',
    description: 'Modern Oak Dining Table [Seasonal & Trend]',
    category: 'Consumer Goods / Furniture',
    location: 'WH-East (New Jersey)',
    channel: 'Direct Retail',
    supplier: 'Nordic Craft Co.',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 450.00,
    purchasePrice: 195.00,
    margin: 56.7,
    onHand: 14,
    onOrder: 0,
    backorders: 2,
    leadTimeDays: 60,
    leadTimeVarianceDays: 10,
    orderCycleDays: 45,
    serviceLevel: 0.98,
    minBatch: 20,
    batchRounding: 10,
    modelType: 'seasonal',
    replenishmentStrategy: 'periodic',
    checkState: 'attention',
    approvalState: 'unapproved',
  },
  {
    id: 'sku_3',
    code: '1866-MB',
    description: 'Executive Ergonomic Desk [Linear Trend]',
    category: 'Consumer Goods / Furniture',
    location: 'WH-West (San Francisco)',
    channel: 'Distributors',
    supplier: 'Nordic Craft Co.',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 320.00,
    purchasePrice: 140.00,
    margin: 56.3,
    onHand: 45,
    onOrder: 100,
    backorders: 0,
    leadTimeDays: 40,
    leadTimeVarianceDays: 5,
    orderCycleDays: 30,
    serviceLevel: 0.95,
    minBatch: 30,
    batchRounding: 15,
    modelType: 'linear',
    replenishmentStrategy: 'min_max',
    checkState: 'checked',
    approvalState: 'approved',
  },
  {
    id: 'sku_4',
    code: 'VB2166-150',
    description: 'Vital Blue Multivitamin 150g [Seasonal]',
    category: 'Pharmacies & Healthcare',
    location: 'WH-East (New Jersey)',
    channel: 'Direct Retail',
    supplier: 'BioHealth Pharma',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 24.50,
    purchasePrice: 8.20,
    margin: 66.5,
    onHand: 850,
    onOrder: 500,
    backorders: 0,
    leadTimeDays: 20,
    leadTimeVarianceDays: 3,
    orderCycleDays: 15,
    serviceLevel: 0.99,
    minBatch: 250,
    batchRounding: 50,
    shelfLifeDays: 365,
    modelType: 'seasonal',
    replenishmentStrategy: 'periodic',
    checkState: 'checked',
    approvalState: 'approved',
  },
  {
    id: 'sku_5',
    code: '56213-P',
    description: 'Belgian Milk Chocolate 200g Pack (12x) [Intermittent]',
    category: 'Food & Beverages / Chocolate',
    location: 'WH-East (New Jersey)',
    channel: 'Supermarkets',
    supplier: 'ChocoDelight BV',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 42.00,
    purchasePrice: 18.50,
    margin: 55.9,
    onHand: 60,
    onOrder: 0,
    backorders: 0,
    leadTimeDays: 30,
    leadTimeVarianceDays: 4,
    orderCycleDays: 30,
    serviceLevel: 0.95,
    minBatch: 50,
    batchRounding: 25,
    shelfLifeDays: 180,
    modelType: 'intermittent',
    replenishmentStrategy: 'periodic',
    checkState: 'undecided',
    approvalState: 'unapproved',
  },
  {
    id: 'sku_6',
    code: '056329-PW',
    description: 'Natural Spring Bottled Water 500ml [Constant]',
    category: 'Food & Beverages / Water',
    location: 'WH-West (San Francisco)',
    channel: 'Supermarkets',
    supplier: 'AquaPure Bottlers',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 1.25,
    purchasePrice: 0.42,
    margin: 66.4,
    onHand: 3400,
    onOrder: 5000,
    backorders: 0,
    leadTimeDays: 14,
    leadTimeVarianceDays: 2,
    orderCycleDays: 14,
    serviceLevel: 0.95,
    minBatch: 1000,
    batchRounding: 500,
    modelType: 'constant',
    replenishmentStrategy: 'min_max',
    checkState: 'checked',
    approvalState: 'approved',
  },
  {
    id: 'sku_7',
    code: 'C1020-BLK',
    description: 'Architectural Concrete Block [Constant]',
    category: 'Building Materials',
    location: 'Central Distribution Center',
    channel: 'Contractors',
    supplier: 'SolidBuild Industries',
    salesPrice: 8.50,
    purchasePrice: 3.10,
    margin: 63.5,
    onHand: 1800,
    onOrder: 2000,
    backorders: 0,
    leadTimeDays: 25,
    leadTimeVarianceDays: 5,
    orderCycleDays: 30,
    serviceLevel: 0.90,
    minBatch: 500,
    batchRounding: 250,
    modelType: 'constant',
    replenishmentStrategy: 'periodic',
    checkState: 'checked',
    approvalState: 'approved',
  },
  {
    id: 'sku_8',
    code: '45645-RP',
    description: 'Retro Radio Player Silver [Preorder / New Launch]',
    category: 'Consumer Goods / Electronics',
    location: 'WH-East (New Jersey)',
    channel: 'Direct Retail',
    supplier: 'Sonic Electronics Ltd.',
    dc: 'Central Distribution Center',
    bomType: 'finished',
    salesPrice: 120.00,
    purchasePrice: 52.00,
    margin: 56.6,
    onHand: 25,
    onOrder: 200,
    backorders: 0,
    leadTimeDays: 60,
    leadTimeVarianceDays: 8,
    orderCycleDays: 45,
    serviceLevel: 0.95,
    minBatch: 100,
    batchRounding: 20,
    modelType: 'preorder',
    replenishmentStrategy: 'periodic',
    checkState: 'attention',
    approvalState: 'unapproved',
  },
  {
    id: 'sku_9',
    code: 'OLD-990-DISC',
    description: 'Legacy Analog Converter [Inactive / Discontinued]',
    category: 'Consumer Goods / Electronics',
    location: 'WH-East (New Jersey)',
    channel: 'Direct Retail',
    supplier: 'Sonic Electronics Ltd.',
    salesPrice: 45.00,
    purchasePrice: 22.00,
    margin: 51.1,
    onHand: 180,
    onOrder: 0,
    backorders: 0,
    leadTimeDays: 90,
    leadTimeVarianceDays: 0,
    orderCycleDays: 90,
    serviceLevel: 0.80,
    minBatch: 50,
    batchRounding: 10,
    modelType: 'zero',
    replenishmentStrategy: 'periodic',
    checkState: 'attention',
    approvalState: 'unapproved',
  },
  {
    id: 'sku_10',
    code: 'MAT-OAK-01',
    description: 'Raw Timber Oak Planks (BOM Material for 562156-01)',
    category: 'Raw Materials / Timber',
    location: 'Manufacturing Plant',
    channel: 'Internal Production',
    supplier: 'ForestProducts SA',
    bomType: 'material',
    salesPrice: 0,
    purchasePrice: 45.00,
    margin: 0,
    onHand: 35,
    onOrder: 60,
    backorders: 0,
    leadTimeDays: 30,
    leadTimeVarianceDays: 4,
    orderCycleDays: 30,
    serviceLevel: 0.98,
    minBatch: 50,
    batchRounding: 10,
    modelType: 'auto',
    replenishmentStrategy: 'periodic',
    checkState: 'checked',
    approvalState: 'approved',
  }
];

// Realistic Monthly Sales Patterns
const SALES_PATTERNS: Record<string, number[]> = {
  '004652-BLU': [40, 45, 80, 150, 280, 390, 450, 410, 220, 90, 50, 40], // High summer seasonal
  '562156-01':  [12, 14, 15, 18, 22, 25, 24, 28, 30, 35, 45, 52],        // Seasonal + strong upward trend
  '1866-MB':    [20, 22, 25, 28, 30, 34, 37, 40, 44, 48, 52, 56],        // Linear trend
  'VB2166-150': [210, 230, 220, 205, 190, 180, 175, 185, 210, 240, 280, 310], // Winter seasonal (vitamins)
  '56213-P':    [0, 25, 0, 0, 40, 0, 0, 35, 0, 50, 0, 0],                // Intermittent (Croston)
  '056329-PW':  [850, 880, 890, 920, 950, 980, 1020, 1010, 940, 910, 870, 860], // High volume stable
  'C1020-BLK':  [300, 320, 350, 420, 450, 480, 460, 440, 380, 340, 310, 290], // Summer building season
  '45645-RP':   [0, 0, 0, 0, 0, 0, 0, 0, 15, 30, 55, 80],                // Preorder newly launched
  'OLD-990-DISC':[45, 30, 20, 10, 5, 2, 0, 0, 0, 0, 0, 0],               // Dying product -> 0
  'MAT-OAK-01': [24, 28, 30, 36, 44, 50, 48, 56, 60, 70, 90, 104],       // Dependent on dining table (2 planks/table)
};

export const BOM_COMPONENTS: BomComponent[] = [
  { parentCode: '562156-01', componentCode: 'MAT-OAK-01', quantityPerBatch: 2, batchRounding: 10 },
];

/**
 * Initializes full calculated inventory items with time-series and metrics.
 */
export function getInitialInventoryItems(): InventoryItem[] {
  return RAW_ITEMS.map(raw => {
    const pattern = SALES_PATTERNS[raw.code] || [50, 52, 55, 58, 60, 62, 65, 68, 70, 72, 75, 78];
    const periods = MONTHS_HISTORICAL.map((date, idx) => ({
      date,
      actual: pattern[idx],
    }));

    const actuals = periods.map(p => p.actual);
    const horizon = 6;
    
    // Fit chosen or auto model
    const forecastRes = autoSelectModel(actuals, horizon);
    const fitted = forecastRes.fitted;
    const forecast = forecastRes.forecast;
    const confUpper = forecastRes.confUpper;
    const confLower = forecastRes.confLower;

    // Attach forecast to periods
    const fullPeriods: TimeSeriesPeriod[] = periods.map((p, i) => ({
      ...p,
      model: Math.round(fitted[i] || p.actual),
    }));

    // Future periods
    for (let h = 0; h < horizon; h++) {
      const monthNum = 1 + h;
      const futureDate = `2026-${monthNum < 10 ? '0' + monthNum : monthNum}`;
      fullPeriods.push({
        date: futureDate,
        actual: 0,
        forecast: Math.round(forecast[h]),
        confUpper: Math.round(confUpper[h]),
        confLower: Math.round(confLower[h]),
      });
    }

    const meanDaily = mean(actuals) / 30;

    const baseItem: InventoryItem = {
      ...raw,
      periods: fullPeriods,
      fittedModelType: forecastRes.modelType,
      meanDailyDemand: meanDaily,
      demandVariance: Math.pow(meanDaily * 0.3, 2),
      mape: forecastRes.mape,
      wmape: forecastRes.wmape,
      accuracy: forecastRes.accuracy,
    };

    const metrics = calculateItemReplenishment(baseItem, forecast, 30);

    // ABC classification based on salesPrice * mean sales
    const annualVolume = mean(actuals) * 12;
    const annualVal = annualVolume * raw.salesPrice;
    let abcClass: 'A' | 'B' | 'C' = 'C';
    if (annualVal >= 25000) abcClass = 'A';
    else if (annualVal >= 8000) abcClass = 'B';

    // XYZ classification based on volatility
    let xyzClass: 'X' | 'Y' | 'Z' = 'Y';
    if (forecastRes.wmape < 20) xyzClass = 'X';
    else if (forecastRes.wmape > 45) xyzClass = 'Z';

    return {
      ...baseItem,
      ...metrics,
      abcClass,
      xyzClass,
    };
  });
}
