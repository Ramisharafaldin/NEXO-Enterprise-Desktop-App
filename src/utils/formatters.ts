/**
 * NEXO Enterprise Supply Chain Platform
 * Formatting Utilities: Currency, Numbers, Dates, and Z-Score Conversions
 */

import { AppSettings } from '../engine/types';
import { calculateZScore } from '../engine/math';

export interface CurrencyOption {
  code: string;
  nameEn: string;
  nameAr: string;
  symbolEn: string;
  symbolAr: string;
  defaultPosition: 'before' | 'after';
  defaultDecimals: number;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  {
    code: 'EGP',
    nameEn: 'Egyptian Pound',
    nameAr: 'الجنيه المصري',
    symbolEn: 'EGP',
    symbolAr: 'ج.م',
    defaultPosition: 'after',
    defaultDecimals: 2,
  },
  {
    code: 'USD',
    nameEn: 'US Dollar',
    nameAr: 'الدولار الأمريكي',
    symbolEn: '$',
    symbolAr: '$',
    defaultPosition: 'before',
    defaultDecimals: 2,
  },
  {
    code: 'SAR',
    nameEn: 'Saudi Riyal',
    nameAr: 'الريال السعودي',
    symbolEn: 'SAR',
    symbolAr: 'ر.س',
    defaultPosition: 'after',
    defaultDecimals: 2,
  },
  {
    code: 'AED',
    nameEn: 'UAE Dirham',
    nameAr: 'الدرهم الإماراتي',
    symbolEn: 'AED',
    symbolAr: 'د.إ',
    defaultPosition: 'after',
    defaultDecimals: 2,
  },
  {
    code: 'EUR',
    nameEn: 'Euro',
    nameAr: 'اليورو',
    symbolEn: '€',
    symbolAr: '€',
    defaultPosition: 'before',
    defaultDecimals: 2,
  },
  {
    code: 'KWD',
    nameEn: 'Kuwaiti Dinar',
    nameAr: 'الدينار الكويتي',
    symbolEn: 'KWD',
    symbolAr: 'د.ك',
    defaultPosition: 'after',
    defaultDecimals: 3,
  },
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'en',
  currency_code: 'EGP',
  currency_symbol: 'ج.م',
  currency_position: 'after',
  decimal_places: 2,
  exchange_rate: 1.0,
  analysis_lookback_periods: 12,
  forecast_horizon_periods: 12,
  period_granularity: 'monthly',
  default_forecast_model: 'auto',
  default_service_level: 0.95,
  default_replenishment_policy: 'periodic',
  default_order_cycle_days: 30,
  default_lead_time_days: 7,
  overstock_threshold_days: 90,
  dead_stock_days: 60,
  abc_a_cutoff: 80,
  abc_b_cutoff: 95,
  xyz_x_cv: 0.5,
  xyz_y_cv: 1.0,
};

/**
 * Returns the localized symbol for a currency code.
 */
export function getCurrencySymbol(code: string, lang: 'en' | 'ar' = 'en'): string {
  const match = SUPPORTED_CURRENCIES.find(c => c.code.toUpperCase() === (code || '').toUpperCase());
  if (match) {
    return lang === 'ar' ? match.symbolAr : match.symbolEn;
  }
  return code || (lang === 'ar' ? 'ج.م' : 'EGP');
}

/**
 * Formats a numeric monetary value using the active application settings.
 * Applies exchange rate multiplier, decimal places, and localized currency position.
 */
export function formatCurrency(
  val: number | undefined | null,
  settings?: Partial<AppSettings>,
  lang: 'en' | 'ar' = 'en'
): string {
  const num = val ?? 0;
  const rate = settings?.exchange_rate ?? 1.0;
  const converted = num * rate;
  
  const decimals = settings?.decimal_places ?? 2;
  const code = settings?.currency_code || 'EGP';
  const symbol = settings?.currency_symbol || getCurrencySymbol(code, lang);
  const position = settings?.currency_position ?? (code === 'USD' || code === 'EUR' ? 'before' : 'after');

  const formattedNum = converted.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (position === 'before') {
    return symbol === '$' || symbol === '€' ? `${symbol}${formattedNum}` : `${symbol} ${formattedNum}`;
  } else {
    return `${formattedNum} ${symbol}`;
  }
}

/**
 * Formats standard numeric counts with thousand separators.
 */
export function formatUnits(val: number | undefined | null): string {
  return (val ?? 0).toLocaleString();
}

export { calculateZScore };
