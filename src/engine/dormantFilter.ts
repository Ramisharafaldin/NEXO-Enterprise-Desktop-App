import { InventoryItem } from './types';

/**
 * Core Supply Chain Analytical Rule:
 * Any SKU whose on-hand stock is zero (onHand <= 0) AND total sales quantity is zero (totalSales <= 0)
 * must be strictly excluded from all analytical calculations, tables, charts, KPI cards, and reports.
 * 
 * Included ONLY if:
 *   (onHand > 0) OR (totalSales > 0)
 */
export const isAnalyzableItem = (item: InventoryItem | null | undefined): boolean => {
  if (!item) return false;
  const onHand = Number(item.onHand || 0);
  const periods = item.periods || [];
  const totalSales = periods.reduce((sum, p) => sum + (Number(p.actual) || 0), 0);
  return onHand > 0 || totalSales > 0;
};

export const filterAnalyzableItems = (items: InventoryItem[] | null | undefined): InventoryItem[] => {
  if (!items || !Array.isArray(items)) return [];
  return items.filter(isAnalyzableItem);
};
