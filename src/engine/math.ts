/**
 * NEXO - Core Mathematical, Statistical & Replenishment Engine
 * High-performance enterprise forecasting and replenishment algorithms
 */

import { TimeSeriesPeriod, InventoryItem, ModelType } from './types';

// ==========================================
// 1. STATISTICAL & DISTRIBUTION FUNCTIONS
// ==========================================

/**
 * Rational approximation of the inverse standard normal cumulative distribution (probit).
 * Accurate to within 1.5e-7 (Abramowitz & Stegun 26.2.23)
 */
export function normalInverseCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p <= 0) return -Infinity;
    return Infinity;
  }
  if (p === 0.5) return 0;

  // Coefficients for rational approximation
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

  const p_low = 0.02425;
  const p_high = 1 - p_low;

  let q: number, r: number;

  if (p < p_low) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
           ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  } else if (p <= p_high) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q /
           (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
            ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  }
}

/**
 * Returns formatted Z-Score for a given service level probability (e.g. 0.95 -> 1.6449)
 */
export function calculateZScore(serviceLevel: number): number {
  if (serviceLevel <= 0 || serviceLevel >= 1) return 0;
  return Number(normalInverseCdf(serviceLevel).toFixed(4));
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function variance(arr: number[], sample = true): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  const sumSq = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0);
  return sumSq / (arr.length - (sample ? 1 : 0));
}

export function standardDeviation(arr: number[], sample = true): number {
  return Math.sqrt(variance(arr, sample));
}

/**
 * Autocorrelation at lag k
 */
export function autocorrelation(arr: number[], lag: number): number {
  const n = arr.length;
  if (n <= lag) return 0;
  const m = mean(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += Math.pow(arr[i] - m, 2);
    if (i < n - lag) {
      num += (arr[i] - m) * (arr[i + lag] - m);
    }
  }
  return den === 0 ? 0 : num / den;
}

// ==========================================
// 2. FORECASTING ACCURACY METRICS
// ==========================================

export function calculateMape(actuals: number[], predicted: number[]): number {
  let count = 0;
  let sumErr = 0;
  for (let i = 0; i < actuals.length; i++) {
    if (actuals[i] > 0) {
      sumErr += Math.abs(actuals[i] - predicted[i]) / actuals[i];
      count++;
    }
  }
  return count > 0 ? (sumErr / count) * 100 : 0;
}

export function calculateWmape(actuals: number[], predicted: number[]): number {
  let sumAbsErr = 0;
  let sumActual = 0;
  for (let i = 0; i < actuals.length; i++) {
    sumAbsErr += Math.abs(actuals[i] - predicted[i]);
    sumActual += actuals[i];
  }
  return sumActual > 0 ? (sumAbsErr / sumActual) * 100 : 0;
}

// ==========================================
// 3. TIME-SERIES FORECASTING ALGORITHMS
// ==========================================

export interface ForecastResult {
  modelType: ModelType;
  fitted: number[];      // fitted on historical data
  forecast: number[];    // predicted future values
  confUpper: number[];   // 95% upper limit
  confLower: number[];   // 95% lower limit
  mape: number;
  wmape: number;
  accuracy: number;
}

/**
 * Constant Level Model (Exponential / Simple Moving Average Level)
 */
export function fitConstantModel(actuals: number[], horizon: number): ForecastResult {
  const m = Math.max(0, mean(actuals));
  const s = standardDeviation(actuals);
  const fitted = actuals.map(() => m);
  const forecast = Array(horizon).fill(m);
  const z = normalInverseCdf(0.975); // 95% two-sided = 1.96

  return {
    modelType: 'constant',
    fitted,
    forecast,
    confUpper: forecast.map((f, i) => Math.max(0, f + z * s * Math.sqrt(1 + i * 0.1))),
    confLower: forecast.map((f, i) => Math.max(0, f - z * s * Math.sqrt(1 + i * 0.1))),
    mape: calculateMape(actuals, fitted),
    wmape: calculateWmape(actuals, fitted),
    accuracy: Math.max(0, 100 - calculateWmape(actuals, fitted)),
  };
}

/**
 * Linear Trend Model (Least Squares OLS)
 */
export function fitLinearTrendModel(actuals: number[], horizon: number): ForecastResult {
  const n = actuals.length;
  if (n <= 1) return fitConstantModel(actuals, horizon);

  const tMean = (n - 1) / 2;
  const yMean = mean(actuals);

  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    num += (t - tMean) * (actuals[t] - yMean);
    den += Math.pow(t - tMean, 2);
  }

  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * tMean;

  const fitted = actuals.map((_, t) => Math.max(0, intercept + slope * t));
  const forecast: number[] = [];
  const phi = 0.85; // Trend damping factor (Gardner & McKenzie) to prevent linear extrapolation explosion
  let cumulativeTrend = 0;
  for (let h = 0; h < horizon; h++) {
    cumulativeTrend += Math.pow(phi, h + 1);
    forecast.push(Math.max(0, intercept + slope * (n - 1) + slope * cumulativeTrend));
  }

  const residuals = actuals.map((y, t) => y - fitted[t]);
  const s = standardDeviation(residuals);
  const z = normalInverseCdf(0.975);

  return {
    modelType: 'linear',
    fitted,
    forecast,
    confUpper: forecast.map((f, i) => Math.max(0, f + z * s * Math.sqrt(1 + (n + i) / n))),
    confLower: forecast.map((f, i) => Math.max(0, f - z * s * Math.sqrt(1 + (n + i) / n))),
    mape: calculateMape(actuals, fitted),
    wmape: calculateWmape(actuals, fitted),
    accuracy: Math.max(0, 100 - calculateWmape(actuals, fitted)),
  };
}

/**
 * Seasonal & Trend Model (Holt-Winters / Classical Multiplicative Decomposition)
 */
export function fitSeasonalModel(actuals: number[], horizon: number, seasonLength = 12): ForecastResult {
  const n = actuals.length;
  if (n < seasonLength) {
    return fitLinearTrendModel(actuals, horizon);
  }

  // 1. Calculate seasonal indices relative to overall mean or centered moving average
  const yMean = mean(actuals);
  const seasonalSums = Array(seasonLength).fill(0);
  const seasonalCounts = Array(seasonLength).fill(0);

  for (let i = 0; i < n; i++) {
    const idx = i % seasonLength;
    seasonalSums[idx] += actuals[i];
    seasonalCounts[idx]++;
  }

  const rawIndices = seasonalSums.map((sum, i) => {
    const count = seasonalCounts[i];
    const seasonAvg = count > 0 ? sum / count : yMean;
    return yMean > 0 ? seasonAvg / yMean : 1.0;
  });

  const avgFactor = mean(rawIndices);
  const normIndices = rawIndices.map(factor => avgFactor > 0 ? factor / avgFactor : 1.0);

  // 2. Deseasonalize and fit linear trend
  const deseasonalized = actuals.map((y, i) => {
    const factor = normIndices[i % seasonLength];
    return factor > 0 ? y / factor : y;
  });

  const tMean = (n - 1) / 2;
  const dMean = mean(deseasonalized);
  let num = 0, den = 0;
  for (let t = 0; t < n; t++) {
    num += (t - tMean) * (deseasonalized[t] - dMean);
    den += Math.pow(t - tMean, 2);
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = dMean - slope * tMean;

  // 3. Generate fitted and forecast with damped linear trend
  const fitted = actuals.map((_, t) => {
    const trend = Math.max(0, intercept + slope * t);
    const season = normIndices[t % seasonLength];
    return Math.max(0, trend * season);
  });

  const forecast: number[] = [];
  const phi = 0.85; // Trend damping factor
  let cumulativeTrend = 0;
  for (let h = 0; h < horizon; h++) {
    cumulativeTrend += Math.pow(phi, h + 1);
    const trend = Math.max(0, intercept + slope * (n - 1) + slope * cumulativeTrend);
    const season = normIndices[(n + h) % seasonLength];
    forecast.push(Math.max(0, trend * season));
  }

  const residuals = actuals.map((y, t) => y - fitted[t]);
  const s = standardDeviation(residuals);
  const z = normalInverseCdf(0.975);

  return {
    modelType: 'seasonal',
    fitted,
    forecast,
    confUpper: forecast.map((f, i) => Math.max(0, f + z * s * Math.sqrt(1 + (n + i) / n))),
    confLower: forecast.map((f, i) => Math.max(0, f - z * s * Math.sqrt(1 + (n + i) / n))),
    mape: calculateMape(actuals, fitted),
    wmape: calculateWmape(actuals, fitted),
    accuracy: Math.max(0, 100 - calculateWmape(actuals, fitted)),
  };
}

/**
 * Intermittent Demand Model (Croston's Method with Syntetos-Boylan Approximation)
 */
export function fitIntermittentModel(actuals: number[], horizon: number, alpha = 0.15): ForecastResult {
  const n = actuals.length;
  let z = 0; // demand size
  let p = 1; // inter-arrival intervals
  let q = 1; // periods elapsed since last demand
  let firstDemand = true;

  const fitted: number[] = [];

  for (let t = 0; t < n; t++) {
    const y = actuals[t];
    if (y > 0) {
      if (firstDemand) {
        z = y;
        p = q;
        firstDemand = false;
      } else {
        z = alpha * y + (1 - alpha) * z;
        p = alpha * q + (1 - alpha) * p;
      }
      q = 1;
    } else {
      q++;
    }

    // Syntetos-Boylan Approximation (SBA) adjustment: (1 - alpha/2) * (z / p)
    const rate = p > 0 ? (1 - alpha / 2) * (z / p) : 0;
    fitted.push(Math.max(0, rate));
  }

  const currentRate = p > 0 ? (1 - alpha / 2) * (z / p) : 0;
  const forecast = Array(horizon).fill(Math.max(0, currentRate));

  const residuals = actuals.map((y, t) => y - fitted[t]);
  const s = standardDeviation(residuals);
  const zScore = normalInverseCdf(0.975);

  return {
    modelType: 'intermittent',
    fitted,
    forecast,
    confUpper: forecast.map(f => Math.max(0, f + zScore * s)),
    confLower: forecast.map(f => Math.max(0, f - zScore * s)),
    mape: calculateMape(actuals, fitted),
    wmape: calculateWmape(actuals, fitted),
    accuracy: Math.max(0, 100 - calculateWmape(actuals, fitted)),
  };
}

/**
 * Automatic Model Selection: Evaluates time series characteristics
 * and selects the model with the highest validation accuracy.
 */
export function autoSelectModel(actuals: number[], horizon: number, seasonLength = 12): ForecastResult {
  const n = actuals.length;
  if (n === 0) {
    return {
      modelType: 'zero',
      fitted: [],
      forecast: Array(horizon).fill(0),
      confUpper: Array(horizon).fill(0),
      confLower: Array(horizon).fill(0),
      mape: 0,
      wmape: 0,
      accuracy: 100,
    };
  }

  // 1. Check for Zero demand
  const total = actuals.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return {
      modelType: 'zero',
      fitted: actuals.map(() => 0),
      forecast: Array(horizon).fill(0),
      confUpper: Array(horizon).fill(0),
      confLower: Array(horizon).fill(0),
      mape: 0,
      wmape: 0,
      accuracy: 100,
    };
  }

  // 2. Check for Intermittency
  const zerosCount = actuals.filter(x => x === 0).length;
  const zeroRatio = zerosCount / n;
  if (zeroRatio >= 0.35) {
    const intermittent = fitIntermittentModel(actuals, horizon);
    return { ...intermittent, modelType: 'intermittent' };
  }

  // 3. Test Seasonality Autocorrelation (skip if seasonLength <= 0 or user requested no seasonality)
  let hasSeasonality = false;
  if (seasonLength > 0 && n >= seasonLength * 1.5) {
    const r12 = autocorrelation(actuals, seasonLength);
    if (r12 >= 0.25) {
      hasSeasonality = true;
    }
  }

  // 4. Candidate evaluations
  const candidates: ForecastResult[] = [
    fitConstantModel(actuals, horizon),
    fitLinearTrendModel(actuals, horizon)
  ];

  if (hasSeasonality && seasonLength > 0) {
    candidates.push(fitSeasonalModel(actuals, horizon, seasonLength));
  }

  // Pick lowest WMAPE
  candidates.sort((a, b) => a.wmape - b.wmape);
  return candidates[0];
}

// ==========================================
// 4. INVENTORY REPLENISHMENT & SIMULATION
// ==========================================

export interface ReplenishmentMetrics {
  safetyStock: number;
  reorderPoint: number;
  maxInventory: number;
  orderNow: number;
  orderNowValue: number;
  daysOfSupply: number;
  projectedDaysOfSupply: number;
  isStockout: boolean;
  stockoutDate?: string;
  isOverstock: boolean;
  overstockValue: number;
  isDeadInventory: boolean;
  deadInventoryValue: number;
  expectedWriteOffValue: number;
}

/**
 * Calculates Safety Stock based on Service Level, Lead Time, and Variance:
 * SS = Z * sqrt(L * sigma_D^2 + D^2 * sigma_L^2)
 */
export function calculateSafetyStock(
  dailyDemand: number,
  demandVariance: number,
  leadTimeDays: number,
  leadTimeVarianceDays: number,
  serviceLevel: number
): number {
  if (dailyDemand <= 0) return 0;
  const z = normalInverseCdf(serviceLevel);
  // Workstream 3: Clamp lead time variance so std dev never exceeds lead time itself
  const effectiveLt = Math.max(1, leadTimeDays || 3);
  const effectiveLtVar = Math.min(Math.max(0, leadTimeVarianceDays ?? 1), effectiveLt);
  const leadTimeVariance = effectiveLtVar > 0 ? Math.pow(effectiveLtVar, 2) : 0;
  const combinedVariance = effectiveLt * demandVariance + Math.pow(dailyDemand, 2) * leadTimeVariance;
  const ss = z * Math.sqrt(Math.max(0, combinedVariance));
  return Math.max(0, Math.round(ss));
}

/**
 * Reorder Point: ROP = (Daily Demand * Lead Time) + Safety Stock
 */
export function calculateReorderPoint(
  dailyDemand: number,
  leadTimeDays: number,
  safetyStock: number
): number {
  const leadTimeDemand = dailyDemand * leadTimeDays;
  return Math.round(leadTimeDemand + safetyStock);
}

/**
 * Simulates Inventory Trajectory over the planning horizon and calculates Planned Orders.
 */
export function calculateItemReplenishment(
  item: InventoryItem,
  forecastPeriods: number[],
  periodDays = 30
): ReplenishmentMetrics {
  const totalForecast = forecastPeriods.reduce((a, b) => a + b, 0);
  const totalDays = forecastPeriods.length * periodDays;
  const dailyDemand = totalDays > 0 ? totalForecast / totalDays : 0;
  
  // Historical variance estimation from periods
  const actuals = item.periods.map(p => p.actual);
  const periodVariance = variance(actuals);
  const dailyVariance = periodVariance / periodDays;

  // 1. Safety Stock & Reorder Point
  const safetyStock = calculateSafetyStock(
    dailyDemand,
    dailyVariance,
    item.leadTimeDays,
    item.leadTimeVarianceDays,
    item.serviceLevel
  );

  const reorderPoint = calculateReorderPoint(dailyDemand, item.leadTimeDays, safetyStock);

  // 2. Max Inventory for Min/Max strategy
  const reviewDemand = dailyDemand * (item.leadTimeDays + item.orderCycleDays);
  const maxInventory = Math.round(reviewDemand + safetyStock);

  // 3. Current Inventory Position
  // Workstream 3: Clamp negative onHand to 0.0
  const effectiveOnHand = Math.max(0, item.onHand || 0);
  const netInventoryPosition = effectiveOnHand + (item.onOrder || 0) - (item.backorders || 0);

  // 4. Order Now Calculation (Workstream 5: Order-Up-To with Anti-Dead-SKU trigger guard)
  let orderNow = 0;
  if (item.replenishmentStrategy === 'min_max') {
    if (dailyDemand > 0 && netInventoryPosition <= reorderPoint) {
      const rawNeed = maxInventory - netInventoryPosition;
      if (rawNeed >= 0.5) {
        orderNow = rawNeed;
      }
    }
  } else {
    // Periodic (JIT) strategy: Target Stock = Demand during (Lead Time + Order Cycle) + Safety Stock
    const targetStock = reviewDemand + safetyStock;
    const rawNeed = targetStock - netInventoryPosition;
    if (dailyDemand > 0 && rawNeed >= 0.5) {
      orderNow = rawNeed;
    }
  }

  // Apply Minimum Order Quantity (MOQ) and Batch Rounding
  if (orderNow > 0) {
    if (item.minBatch > 0 && orderNow < item.minBatch) {
      orderNow = item.minBatch;
    }
    if (item.batchRounding > 0) {
      orderNow = Math.ceil(orderNow / item.batchRounding) * item.batchRounding;
    }
  } else {
    orderNow = 0;
  }

  const orderNowValue = orderNow * item.purchasePrice;

  // 5. Days of Supply
  const daysOfSupply = dailyDemand > 0 ? Math.round(item.onHand / dailyDemand) : 999;
  const projectedDaysOfSupply = dailyDemand > 0 ? Math.round((item.onHand + item.onOrder) / dailyDemand) : 999;

  // 6. Risk Assessments
  const isStockout = netInventoryPosition <= 0 || (dailyDemand > 0 && item.onHand / dailyDemand < item.leadTimeDays);
  const isOverstock = item.onHand > (maxInventory * 1.5) && item.onHand > 0;
  const overstockQty = isOverstock ? Math.max(0, item.onHand - maxInventory) : 0;
  const overstockValue = overstockQty * item.purchasePrice;

  // Dead inventory: No sales in last 6 periods and OnHand > 0
  const recentSales = actuals.slice(-6).reduce((a, b) => a + b, 0);
  const isDeadInventory = recentSales === 0 && item.onHand > 0;
  const deadInventoryValue = isDeadInventory ? item.onHand * item.purchasePrice : 0;

  // Shelf life write-off risk
  let expectedWriteOffValue = 0;
  if (item.shelfLifeDays && item.shelfLifeDays > 0) {
    if (daysOfSupply > item.shelfLifeDays) {
      const expiringQty = Math.max(0, item.onHand - dailyDemand * item.shelfLifeDays);
      expectedWriteOffValue = expiringQty * item.purchasePrice;
    }
  }

  return {
    safetyStock,
    reorderPoint,
    maxInventory,
    orderNow,
    orderNowValue,
    daysOfSupply,
    projectedDaysOfSupply,
    isStockout,
    isOverstock,
    overstockValue,
    isDeadInventory,
    deadInventoryValue,
    expectedWriteOffValue
  };
}

/**
 * Step-by-step breakdown of inventory formulas for the Explain Modal.
 */
export function explainInventoryCalculation(item: InventoryItem, lang: 'en' | 'ar' = 'en', currencySymbol?: string) {
  const isAr = lang === 'ar';
  const sym = currencySymbol || (isAr ? 'ج.م' : 'EGP');
  const dailyDemand = item.meanDailyDemand || 1;
  const ss = item.safetyStock || 0;
  const rop = item.reorderPoint || 0;
  const netPos = item.onHand + item.onOrder - item.backorders;
  const targetStock = Math.round(dailyDemand * (item.leadTimeDays + item.orderCycleDays) + ss);

  return {
    title: isAr ? 'شرح معادلات المخزون وإعادة التوريد' : 'Inventory & Replenishment Calculation Breakdown',
    steps: [
      {
        name: isAr ? '1. متوسط الطلب اليومي (Daily Demand)' : '1. Average Daily Demand',
        formula: isAr ? 'إجمالي التنبؤ ÷ عدد الأيام' : 'Total Forecast Demand ÷ Total Days',
        value: dailyDemand.toFixed(2),
        details: isAr 
          ? `معدل الاستهلاك اليومي المتوقع للصنف: ${dailyDemand.toFixed(2)} وحدة/يوم.`
          : `Expected daily consumption rate: ${dailyDemand.toFixed(2)} units/day.`
      },
      {
        name: isAr ? '2. مخزون الأمان (Safety Stock)' : '2. Safety Stock (SS)',
        formula: 'SS = Z × √(L × σ_D² + D̄² × σ_L²)',
        value: `${ss} ${isAr ? 'وحدة' : 'units'}`,
        details: isAr
          ? `يحمي من تقلبات الطلب عند مستوى خدمة ${(item.serviceLevel * 100).toFixed(0)}% مع فترة توريد ${item.leadTimeDays} يوماً.`
          : `Protects against demand fluctuations at ${(item.serviceLevel * 100).toFixed(0)}% service level with ${item.leadTimeDays} days lead time.`
      },
      {
        name: isAr ? '3. نقطة إعادة الطلب (Reorder Point - ROP)' : '3. Reorder Point (ROP)',
        formula: 'ROP = (Daily Demand × Lead Time) + Safety Stock',
        value: `${rop} ${isAr ? 'وحدة' : 'units'}`,
        details: isAr
          ? `الطلب خلال فترة التوريد (${(dailyDemand * item.leadTimeDays).toFixed(1)}) + مخزون الأمان (${ss}) = ${rop}.`
          : `Demand during lead time (${(dailyDemand * item.leadTimeDays).toFixed(1)}) + Safety Stock (${ss}) = ${rop}.`
      },
      {
        name: isAr ? '4. صافي المركز المخزوني (Net Inventory Position)' : '4. Net Inventory Position',
        formula: 'Net Position = On Hand + On Order - Backorders',
        value: `${netPos} ${isAr ? 'وحدة' : 'units'}`,
        details: isAr
          ? `المخزون الفعلي (${item.onHand}) + قيد الشحن (${item.onOrder}) - الطلبات المتأخرة (${item.backorders}) = ${netPos}.`
          : `On Hand (${item.onHand}) + On Order (${item.onOrder}) - Backorders (${item.backorders}) = ${netPos}.`
      },
      {
        name: isAr ? '5. قرار التوريد والكمية المطلوبة (Order Now)' : '5. Replenishment Order Decision',
        formula: item.replenishmentStrategy === 'periodic'
          ? 'Order Now = Target Stock - Net Position (with MOQ & Rounding)'
          : 'Order Now = Max Inventory - Net Position (if Net <= ROP)',
        value: `${item.orderNow || 0} ${isAr ? 'وحدة' : 'units'} (${(item.orderNowValue || 0).toLocaleString()} ${sym})`,
        details: isAr
          ? `المخزون المستهدف: ${targetStock}. الحد الأدنى للطلب (MOQ): ${item.minBatch}، ومضاعف التجميع: ${item.batchRounding}.`
          : `Target stock: ${targetStock}. Minimum order quantity (MOQ): ${item.minBatch}, batch rounding: ${item.batchRounding}.`
      }
    ]
  };
}

/**
 * Classifies inventory items into 9-box ABC / XYZ portfolio matrix using dynamic Pareto thresholds.
 */
export function classifyAbcXyz(
  items: InventoryItem[],
  aCutoff = 80,
  bCutoff = 95,
  xCv = 0.5,
  yCv = 1.0
): InventoryItem[] {
  if (!items || items.length === 0) return [];

  const itemsWithVal = items.map(item => {
    const actuals = item.periods ? item.periods.filter(p => p.actual > 0).map(p => p.actual) : [];
    const avgMonthly = actuals.length > 0 ? mean(actuals) : (item.meanDailyDemand || 1) * 30;
    const annualVal = avgMonthly * 12 * (item.salesPrice || 1);
    
    const std = actuals.length > 1 ? standardDeviation(actuals) : 0;
    const cv = avgMonthly > 0 ? std / avgMonthly : 0.5;

    return {
      item,
      annualVal,
      cv,
    };
  });

  // Sort descending by annual revenue contribution
  itemsWithVal.sort((a, b) => b.annualVal - a.annualVal);

  const totalVal = itemsWithVal.reduce((sum, i) => sum + i.annualVal, 0) || 1;
  let cumVal = 0;

  return itemsWithVal.map(({ item, annualVal, cv }, index) => {
    cumVal += annualVal;
    const cumPct = (cumVal / totalVal) * 100;

    let abcClass: 'A' | 'B' | 'C' = 'C';
    if (cumPct <= aCutoff || index === 0) {
      abcClass = 'A';
    } else if (cumPct <= bCutoff) {
      abcClass = 'B';
    }

    let xyzClass: 'X' | 'Y' | 'Z' = 'Z';
    if (cv <= xCv) {
      xyzClass = 'X';
    } else if (cv <= yCv) {
      xyzClass = 'Y';
    }

    return {
      ...item,
      abcClass,
      xyzClass,
    };
  });
}

/**
 * Configuration and resolution interface for time-horizon planning.
 */
export interface HorizonConfig {
  key: string;               // Normalized key, e.g. '1w', '2w', '3w', '1m', '3m', '6m', '12m', '18m', '24m'
  forecastPeriods: number;   // Number of discrete periods to project
  totalDays: number;         // Total horizon duration in calendar days
  periodDays: number;        // Effective days per period for dailyDemand calculation
  isSubMonthly: boolean;     // True if sub-monthly horizon in monthly mode (1w, 2w, 3w)
  prorationFactor: number;   // Multiplier applied to monthly statistical forecast (e.g. 7/30)
  subLabelAr: string;        // Localized suffix label for Arabic display
  subLabelEn: string;        // Localized suffix label for English display
}

/**
 * Normalizes any horizon input (including legacy integers 3, 6, 12, etc.) to a standardized key.
 */
export function normalizeHorizonKey(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return '12m';
  const s = String(raw).trim().toLowerCase();
  if (['1w', '2w', '3w', '1m', '3m', '6m', '12m', '18m', '24m'].includes(s)) {
    return s;
  }
  const numMap: Record<string, string> = {
    '1': '1m',
    '3': '3m',
    '6': '6m',
    '9': '3m',
    '12': '12m',
    '18': '18m',
    '24': '24m',
    '36': '24m',
  };
  if (numMap[s]) return numMap[s];
  if (s.endsWith('w') || s.endsWith('m')) return s;
  return '12m';
}

/**
 * Resolves forecast horizon based on selected period granularity ('daily' | 'weekly' | 'monthly').
 */
export function resolveHorizon(
  raw: string | number | undefined | null,
  granularity: 'daily' | 'weekly' | 'monthly' = 'monthly'
): HorizonConfig {
  const key = normalizeHorizonKey(raw);

  if (granularity === 'daily') {
    const dailyMap: Record<string, number> = {
      '1w': 7,
      '2w': 14,
      '3w': 21,
      '1m': 30,
      '3m': 90,
      '6m': 180,
      '12m': 365,
      '18m': 540,
      '24m': 720,
    };
    const days = dailyMap[key] || 365;
    return {
      key,
      forecastPeriods: days,
      totalDays: days,
      periodDays: 1,
      isSubMonthly: false,
      prorationFactor: 1.0,
      subLabelAr: '',
      subLabelEn: '',
    };
  }

  if (granularity === 'weekly') {
    const weeklyMap: Record<string, { periods: number; days: number }> = {
      '1w': { periods: 1, days: 7 },
      '2w': { periods: 2, days: 14 },
      '3w': { periods: 3, days: 21 },
      '1m': { periods: 4, days: 28 },
      '3m': { periods: 13, days: 91 },
      '6m': { periods: 26, days: 182 },
      '12m': { periods: 52, days: 364 },
      '18m': { periods: 78, days: 546 },
      '24m': { periods: 104, days: 728 },
    };
    const conf = weeklyMap[key] || { periods: 52, days: 364 };
    return {
      key,
      forecastPeriods: conf.periods,
      totalDays: conf.days,
      periodDays: 7,
      isSubMonthly: false,
      prorationFactor: 1.0,
      subLabelAr: '',
      subLabelEn: '',
    };
  }

  // Monthly mode
  if (key === '1w') {
    return {
      key,
      forecastPeriods: 1,
      totalDays: 7,
      periodDays: 7,
      isSubMonthly: true,
      prorationFactor: 7 / 30,
      subLabelAr: ' (أسبوع واحد)',
      subLabelEn: ' (1w)',
    };
  }
  if (key === '2w') {
    return {
      key,
      forecastPeriods: 1,
      totalDays: 14,
      periodDays: 14,
      isSubMonthly: true,
      prorationFactor: 14 / 30,
      subLabelAr: ' (أسبوعان)',
      subLabelEn: ' (2w)',
    };
  }
  if (key === '3w') {
    return {
      key,
      forecastPeriods: 1,
      totalDays: 21,
      periodDays: 21,
      isSubMonthly: true,
      prorationFactor: 21 / 30,
      subLabelAr: ' (3 أسابيع)',
      subLabelEn: ' (3w)',
    };
  }

  const monthlyMap: Record<string, { periods: number; days: number }> = {
    '1m': { periods: 1, days: 30 },
    '3m': { periods: 3, days: 90 },
    '6m': { periods: 6, days: 180 },
    '12m': { periods: 12, days: 365 },
    '18m': { periods: 18, days: 540 },
    '24m': { periods: 24, days: 720 },
  };
  const conf = monthlyMap[key] || { periods: 12, days: 365 };
  return {
    key,
    forecastPeriods: conf.periods,
    totalDays: conf.days,
    periodDays: 30,
    isSubMonthly: false,
    prorationFactor: 1.0,
    subLabelAr: '',
    subLabelEn: '',
  };
}

/**
 * Computes sequential date string for future planning periods.
 */
export function getNextPeriodDate(
  lastDate: string,
  step: number,
  granularity: 'daily' | 'weekly' | 'monthly' = 'monthly'
): string {
  // If YYYY-MM
  if (/^\d{4}-\d{2}$/.test(lastDate)) {
    const [yearStr, monthStr] = lastDate.split('-');
    let y = parseInt(yearStr, 10);
    let m = parseInt(monthStr, 10) + step;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  // If YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
    const d = new Date(lastDate);
    if (granularity === 'daily') {
      d.setDate(d.getDate() + step);
    } else if (granularity === 'weekly') {
      d.setDate(d.getDate() + step * 7);
    } else {
      d.setMonth(d.getMonth() + step);
    }
    return d.toISOString().split('T')[0];
  }

  return `${lastDate}+${step}`;
}

/**
 * Detects the actual cadence/granularity of historical periods based on date strings and intervals.
 */
export function detectPeriodsGranularity(periods: TimeSeriesPeriod[]): 'daily' | 'weekly' | 'monthly' {
  if (!periods || periods.length === 0) return 'monthly';

  // Check if any dates are YYYY-MM (standard monthly)
  const dateStrings = periods.map(p => p.date).filter(Boolean);
  if (dateStrings.some(d => /^\d{4}-\d{2}$/.test(d))) {
    return 'monthly';
  }

  // Parse YYYY-MM-DD dates
  const timestamps = dateStrings
    .map(d => new Date(d).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) {
    return 'monthly';
  }

  const diffDays: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.round((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24));
    if (diff > 0) {
      diffDays.push(diff);
    }
  }

  if (diffDays.length === 0) return 'monthly';

  diffDays.sort((a, b) => a - b);
  const mid = Math.floor(diffDays.length / 2);
  const medianDiff = diffDays.length % 2 !== 0 ? diffDays[mid] : (diffDays[mid - 1] + diffDays[mid]) / 2;

  if (medianDiff >= 25) {
    return 'monthly';
  } else if (medianDiff >= 5 && medianDiff <= 10) {
    return 'weekly';
  } else {
    return 'daily';
  }
}


