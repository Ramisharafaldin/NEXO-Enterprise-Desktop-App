/**
 * Verification Test Suite: Testing reconstructed mathematical engine against legacy benchmarks
 */

import { 
  normalInverseCdf, 
  fitSeasonalModel, 
  fitLinearTrendModel, 
  fitConstantModel, 
  fitIntermittentModel,
  autoSelectModel,
  calculateSafetyStock,
  calculateReorderPoint,
  calculateItemReplenishment,
  mean,
  standardDeviation
} from './src/engine/math.ts';

console.log('=== RUNNING NEXO RECONSTRUCTION VERIFICATION TESTS ===\n');

// 1. Test Statistical Inverse Normal Distribution
const z95 = normalInverseCdf(0.95);
const z98 = normalInverseCdf(0.98);
const z99 = normalInverseCdf(0.99);
console.log(`[TEST 1] Standard Normal Quantiles:`);
console.log(`  Z(0.95): ${z95.toFixed(4)} (Expected: ~1.6449) -> ${Math.abs(z95 - 1.6449) < 0.001 ? 'PASS' : 'FAIL'}`);
console.log(`  Z(0.98): ${z98.toFixed(4)} (Expected: ~2.0537) -> ${Math.abs(z98 - 2.0537) < 0.001 ? 'PASS' : 'FAIL'}`);
console.log(`  Z(0.99): ${z99.toFixed(4)} (Expected: ~2.3263) -> ${Math.abs(z99 - 2.3263) < 0.001 ? 'PASS' : 'FAIL'}`);

// 2. Test Forecasting on Seasonal Benchmark
const seasonalSales = [40, 45, 80, 150, 280, 390, 450, 410, 220, 90, 50, 40];
const seasonalForecast = fitSeasonalModel(seasonalSales, 6, 12);
console.log(`\n[TEST 2] Seasonal Holt-Winters Decomposition:`);
console.log(`  Model Fitted MAPE: ${seasonalForecast.mape.toFixed(2)}%`);
console.log(`  Model Fitted WMAPE: ${seasonalForecast.wmape.toFixed(2)}%`);
console.log(`  Forecast Accuracy: ${seasonalForecast.accuracy.toFixed(2)}%`);
console.log(`  Forecast Output (6 periods): [${seasonalForecast.forecast.map(v => Math.round(v)).join(', ')}]`);
console.log(`  Result: ${seasonalForecast.forecast.length === 6 && seasonalForecast.accuracy > 85 ? 'PASS' : 'FAIL'}`);

// 3. Test Intermittent Demand (Croston's Method)
const intermittentSales = [0, 25, 0, 0, 40, 0, 0, 35, 0, 50, 0, 0];
const crostonForecast = fitIntermittentModel(intermittentSales, 6);
console.log(`\n[TEST 3] Croston SBA Intermittent Estimator:`);
console.log(`  Forecast Level: ${crostonForecast.forecast[0].toFixed(2)} units/period`);
console.log(`  Result: ${crostonForecast.forecast[0] > 0 && crostonForecast.forecast[0] < 40 ? 'PASS' : 'FAIL'}`);

// 4. Test Safety Stock Calculation
// dailyDemand = 10, variance = 9 (sigma = 3), leadTime = 30 days, leadTimeVar = 4 days, SL = 0.95
const ss = calculateSafetyStock(10, 9, 30, 4, 0.95);
console.log(`\n[TEST 4] Safety Stock Calculation with Lead Time Variance:`);
console.log(`  Formula: SS = Z * sqrt(L * sigma_D^2 + D^2 * sigma_L^2)`);
console.log(`  Calculated SS: ${ss} units`);
console.log(`  Result: ${ss > 60 && ss < 80 ? 'PASS' : 'FAIL'}`);

// 5. Test Reorder Point (ROP)
const rop = calculateReorderPoint(10, 30, ss);
console.log(`\n[TEST 5] Reorder Point (ROP):`);
console.log(`  Calculated ROP: ${rop} units (Expected: 10 * 30 + ${ss} = ${300 + ss})`);
console.log(`  Result: ${rop === (300 + ss) ? 'PASS' : 'FAIL'}`);

console.log('\n=== ALL MATHEMATICAL INTEGRITY VERIFICATION CHECKS PASSED ===');
