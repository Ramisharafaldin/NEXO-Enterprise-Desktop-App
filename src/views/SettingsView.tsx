import React, { useState, useEffect } from 'react';
import { AppSettings } from '../engine/types';
import { translations, Language } from '../i18n/translations';
import { 
  SUPPORTED_CURRENCIES, 
  DEFAULT_APP_SETTINGS, 
  formatCurrency, 
  calculateZScore,
  getCurrencySymbol 
} from '../utils/formatters';
import { 
  Globe, 
  DollarSign, 
  Calendar, 
  ShieldCheck, 
  RotateCcw, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Layers,
  Sparkles,
  Sliders,
  Percent
} from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => Promise<void>;
  onResetSettings: () => Promise<void>;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetSettings,
  language,
  onLanguageChange,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  // Local editable draft state initialized from props
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  // Sync draft state if prop settings change externally
  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  // Handle field change
  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      // If language changed in form, synchronize language immediately
      if (key === 'language' && (value === 'en' || value === 'ar')) {
        onLanguageChange(value);
      }
      // If currency changed, auto-update symbol and sensible position default
      if (key === 'currency_code') {
        const curCode = value as string;
        next.currency_symbol = getCurrencySymbol(curCode, language);
        if (curCode === 'USD' || curCode === 'EUR') {
          next.currency_position = 'before';
        } else {
          next.currency_position = 'after';
        }
      }
      return next;
    });
  };

  // Save handler
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveSettings(formData);
      setToastMessage({ text: t.settings.savedToast, type: 'success' });
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      alert(`Error saving settings: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset handler
  const handleReset = async () => {
    if (window.confirm(isAr ? 'هل أنت متأكد من استعادة الإعدادات الافتراضية القياسية؟' : 'Are you sure you want to reset all preferences to defaults?')) {
      setIsSaving(true);
      try {
        await onResetSettings();
        setFormData(DEFAULT_APP_SETTINGS);
        setToastMessage({ text: t.settings.resetToast, type: 'info' });
        setTimeout(() => setToastMessage(null), 4000);
      } catch (err: any) {
        alert(`Error resetting settings: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const currentZ = calculateZScore(formData.default_service_level);
  const sampleVal = 12450.75;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8F9FA] select-none text-[#1E293B] text-[12px]">
      {/* 1. Header & Action Ribbon */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#CBD5E1] shrink-0 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                {t.settings.title}
              </h2>
              <p className="text-[11px] text-slate-500">
                {t.settings.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] text-slate-700 font-semibold rounded text-[11px] shadow-xs transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.settings.resetBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2196F3] hover:bg-blue-600 text-white font-bold rounded text-[11px] shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? t.settings.saving : t.settings.saveBtn}</span>
          </button>
        </div>
      </div>

      {/* Toast Notification Alert */}
      {toastMessage && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded border flex items-center justify-between animate-fade-in bg-emerald-50 border-emerald-300 text-emerald-800 text-[11px] font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage.text}</span>
          </div>
          <button 
            onClick={() => setToastMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Main Scrollable Settings Grid */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <form onSubmit={handleSave} className="space-y-6 max-w-6xl mx-auto">
          
          {/* ============================================================== */}
          {/* CARD 1: LANGUAGE & CURRENCY (اللغة والعملة)                      */}
          {/* ============================================================== */}
          <section className="bg-white border border-[#CBD5E1] rounded-lg shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-[#ECEFF1]/60 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#2196F3]" />
                <h3 className="font-bold text-slate-900 text-[13px]">
                  {t.settings.cardLanguageCurrency}
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                {t.settings.cardLanguageCurrencyDesc}
              </span>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 text-xs">
              {/* Language Selector */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.languageLabel}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChange('language', 'en')}
                    className={`py-2 px-3 rounded border text-center font-semibold transition ${
                      formData.language === 'en'
                        ? 'bg-blue-50 border-[#2196F3] text-[#2196F3] shadow-xs'
                        : 'bg-white border-[#CBD5E1] text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    English (LTR)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('language', 'ar')}
                    className={`py-2 px-3 rounded border text-center font-semibold font-arabic transition ${
                      formData.language === 'ar'
                        ? 'bg-blue-50 border-[#2196F3] text-[#2196F3] shadow-xs'
                        : 'bg-white border-[#CBD5E1] text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    العربية (RTL)
                  </button>
                </div>
              </div>

              {/* Currency Selector (Featuring EGP / Egyptian Pound) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.currencyLabel}
                </label>
                <select
                  value={formData.currency_code}
                  onChange={e => handleChange('currency_code', e.target.value)}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
                >
                  {SUPPORTED_CURRENCIES.map(curr => (
                    <option key={curr.code} value={curr.code}>
                      {isAr ? curr.nameAr : curr.nameEn} ({curr.code} — {isAr ? curr.symbolAr : curr.symbolEn})
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Preview Card */}
              <div className="bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {t.settings.currencyPreview}
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold font-mono text-[#2196F3]">
                    {formatCurrency(sampleVal, formData, language)}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-1">
                  {isAr ? 'يتم تطبيق هذا التنسيق على كافة الأسعار وتقييمات المخزون' : 'Applied across all valuations, orders, and KPI tiles'}
                </span>
              </div>

              {/* Symbol Position */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.symbolPosition}
                </label>
                <select
                  value={formData.currency_position}
                  onChange={e => handleChange('currency_position', e.target.value as 'before' | 'after')}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
                >
                  <option value="after">{t.settings.positionAfter}</option>
                  <option value="before">{t.settings.positionBefore}</option>
                </select>
              </div>

              {/* Decimal Precision */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.decimalPlaces}
                </label>
                <select
                  value={formData.decimal_places}
                  onChange={e => handleChange('decimal_places', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer font-mono"
                >
                  <option value={0}>0 ({isAr ? 'أعداد صحيحة' : 'Integer, e.g. 12,450'})</option>
                  <option value={2}>2 ({isAr ? 'قياسي' : 'Standard, e.g. 12,450.75'})</option>
                  <option value={3}>3 ({isAr ? 'ثلاث خانات كالدينار' : 'Precise 3-decimals, e.g. 12,450.750'})</option>
                </select>
              </div>

              {/* Exchange Rate Multiplier */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.exchangeRate}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.0001"
                  value={formData.exchange_rate}
                  onChange={e => handleChange('exchange_rate', parseFloat(e.target.value) || 1.0)}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-mono font-bold bg-white focus:outline-none focus:border-[#2196F3]"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {t.settings.exchangeRateHelp}
                </span>
              </div>
            </div>
          </section>

          {/* ============================================================== */}
          {/* CARD 2: ANALYSIS & FORECAST HORIZONS (مدد التحليل والتوقع)     */}
          {/* ============================================================== */}
          <section className="bg-white border border-[#CBD5E1] rounded-lg shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-[#ECEFF1]/60 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#2196F3]" />
                <h3 className="font-bold text-slate-900 text-[13px]">
                  {t.settings.cardHorizons}
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                {t.settings.cardHorizonsDesc}
              </span>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
              {/* Historical Lookback Periods */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.lookbackLabel}
                </label>
                <select
                  value={formData.analysis_lookback_periods}
                  onChange={e => handleChange('analysis_lookback_periods', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer font-mono"
                >
                  <option value={6}>6 {isAr ? 'أشهر' : 'Months (Half Year)'}</option>
                  <option value={12}>12 {isAr ? 'شهراً (سنة كاملة)' : 'Months (1 Full Year)'}</option>
                  <option value={18}>18 {isAr ? 'شهراً' : 'Months (1.5 Years)'}</option>
                  <option value={24}>24 {isAr ? 'شهراً (سنتان كاملتان)' : 'Months (2 Full Years)'}</option>
                  <option value={36}>36 {isAr ? 'شهراً (3 سنوات)' : 'Months (3 Full Years)'}</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {t.settings.lookbackHelp}
                </span>
              </div>

              {/* Forecast Planning Horizon */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.horizonLabel}
                </label>
                <select
                  value={formData.forecast_horizon_periods}
                  onChange={e => handleChange('forecast_horizon_periods', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-bold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer font-mono text-[#2196F3]"
                >
                  <option value={3}>+3 {isAr ? 'فترات مقبلة (ربع سنوي)' : 'Periods (Quarterly)'}</option>
                  <option value={6}>+6 {isAr ? 'فترات مقبلة (نصف سنوي)' : 'Periods (Bi-Annual)'}</option>
                  <option value={12}>+12 {isAr ? 'فترة مقبلة (سنة كاملة)' : 'Periods (Annual)'}</option>
                  <option value={18}>+18 {isAr ? 'فترة مقبلة' : 'Periods (18 Months)'}</option>
                  <option value={24}>+24 {isAr ? 'فترة مقبلة (سنتان)' : 'Periods (24 Months)'}</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {t.settings.horizonHelp}
                </span>
              </div>

              {/* Time Granularity */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.granularityLabel}
                </label>
                <select
                  value={formData.period_granularity}
                  onChange={e => handleChange('period_granularity', e.target.value as any)}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
                >
                  <option value="monthly">{t.settings.granularityMonthly}</option>
                  <option value="weekly">{t.settings.granularityWeekly}</option>
                  <option value="daily">{t.settings.granularityDaily}</option>
                </select>
              </div>

              {/* Default Forecasting Engine */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  {t.settings.defaultModelLabel}
                </label>
                <select
                  value={formData.default_forecast_model}
                  onChange={e => handleChange('default_forecast_model', e.target.value)}
                  className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
                >
                  <option value="auto">{t.settings.modelAuto}</option>
                  <option value="seasonal">{t.settings.modelSeasonal}</option>
                  <option value="intermittent">{t.settings.modelIntermittent}</option>
                  <option value="linear">{t.settings.modelLinear}</option>
                  <option value="constant">{t.settings.modelConstant}</option>
                </select>
              </div>
            </div>
          </section>

          {/* ============================================================== */}
          {/* CARD 3: CONFIDENCE LEVEL & INVENTORY POLICIES                  */}
          {/* ============================================================== */}
          <section className="bg-white border border-[#CBD5E1] rounded-lg shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-[#ECEFF1]/60 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-[13px]">
                  {t.settings.cardInventory}
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                {t.settings.cardInventoryDesc}
              </span>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {/* Row 1: Service Level and Live Z-Score badge */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Service Level Select */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.serviceLevelLabel}
                  </label>
                  <select
                    value={formData.default_service_level}
                    onChange={e => handleChange('default_service_level', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-bold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer font-mono"
                  >
                    <option value={0.90}>90.0% (Z ≈ 1.2816)</option>
                    <option value={0.95}>95.0% (Z ≈ 1.6449 - Standard)</option>
                    <option value={0.97}>97.0% (Z ≈ 1.8808)</option>
                    <option value={0.98}>98.0% (Z ≈ 2.0537 - High Value)</option>
                    <option value={0.99}>99.0% (Z ≈ 2.3263 - Critical)</option>
                    <option value={0.995}>99.5% (Z ≈ 2.5758 - Aerospace/Pharma)</option>
                  </select>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {t.settings.serviceLevelHelp}
                  </span>
                </div>

                {/* Live Z-Score Metric Badge */}
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                    {t.settings.zScoreBadge}
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black font-mono text-emerald-700">
                      Z = {currentZ}
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-600 mt-1">
                    SS = {currentZ} × √(L × σ_D² + D̄² × σ_L²)
                  </span>
                </div>

                {/* Default Replenishment Strategy */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.replenishmentPolicyLabel}
                  </label>
                  <select
                    value={formData.default_replenishment_policy}
                    onChange={e => handleChange('default_replenishment_policy', e.target.value as any)}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-semibold bg-white focus:outline-none focus:border-[#2196F3] cursor-pointer"
                  >
                    <option value="periodic">{t.settings.policyPeriodic}</option>
                    <option value="minmax">{t.settings.policyMinMax}</option>
                  </select>
                </div>

                {/* Default Lead Time Days */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.leadTimeLabel}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.default_lead_time_days}
                    onChange={e => handleChange('default_lead_time_days', Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-mono font-bold bg-white focus:outline-none focus:border-[#2196F3]"
                  />
                </div>
              </div>

              {/* Row 2: Overstock, Dead Stock & Review Cycle */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3 border-t border-[#F1F5F9]">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.orderCycleLabel}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.default_order_cycle_days}
                    onChange={e => handleChange('default_order_cycle_days', Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-slate-800 font-mono font-bold bg-white focus:outline-none focus:border-[#2196F3]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.overstockThresholdLabel}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.overstock_threshold_days}
                    onChange={e => handleChange('overstock_threshold_days', Number(e.target.value) || 30)}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-amber-900 font-mono font-bold bg-white focus:outline-none focus:border-[#2196F3]"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {t.settings.overstockHelp}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    {t.settings.deadStockThresholdLabel}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.dead_stock_days}
                    onChange={e => handleChange('dead_stock_days', Number(e.target.value) || 30)}
                    className="w-full px-3 py-2 border border-[#CBD5E1] rounded text-rose-900 font-mono font-bold bg-white focus:outline-none focus:border-[#2196F3]"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {t.settings.deadStockHelp}
                  </span>
                </div>
              </div>

              {/* Row 3: ABC / XYZ Classification Thresholds */}
              <div className="pt-3 border-t border-[#F1F5F9]">
                <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#2196F3]" />
                  <span>{isAr ? 'معايير مصفوفة محفظة الأصناف (ABC / XYZ Classification Thresholds):' : 'Portfolio Classification Matrix Thresholds (ABC / XYZ):'}</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* ABC A Cutoff */}
                  <div className="p-3 bg-[#F8F9FA] rounded border border-[#E2E8F0]">
                    <span className="block text-[10px] font-bold text-emerald-800 uppercase mb-1">
                      {t.settings.abcACutoff}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={formData.abc_a_cutoff}
                        onChange={e => handleChange('abc_a_cutoff', Number(e.target.value) || 80)}
                        className="w-20 px-2 py-1 border border-[#CBD5E1] rounded font-mono font-bold text-emerald-700 bg-white"
                      />
                      <span className="font-mono font-bold">%</span>
                    </div>
                  </div>

                  {/* ABC B Cutoff */}
                  <div className="p-3 bg-[#F8F9FA] rounded border border-[#E2E8F0]">
                    <span className="block text-[10px] font-bold text-blue-800 uppercase mb-1">
                      {t.settings.abcBCutoff}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={formData.abc_b_cutoff}
                        onChange={e => handleChange('abc_b_cutoff', Number(e.target.value) || 95)}
                        className="w-20 px-2 py-1 border border-[#CBD5E1] rounded font-mono font-bold text-blue-700 bg-white"
                      />
                      <span className="font-mono font-bold">%</span>
                    </div>
                  </div>

                  {/* XYZ X Cutoff */}
                  <div className="p-3 bg-[#F8F9FA] rounded border border-[#E2E8F0]">
                    <span className="block text-[10px] font-bold text-slate-800 uppercase mb-1">
                      {t.settings.xyzXCutoff}
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      value={formData.xyz_x_cv}
                      onChange={e => handleChange('xyz_x_cv', parseFloat(e.target.value) || 0.5)}
                      className="w-20 px-2 py-1 border border-[#CBD5E1] rounded font-mono font-bold text-slate-800 bg-white"
                    />
                  </div>

                  {/* XYZ Y Cutoff */}
                  <div className="p-3 bg-[#F8F9FA] rounded border border-[#E2E8F0]">
                    <span className="block text-[10px] font-bold text-slate-800 uppercase mb-1">
                      {t.settings.xyzYCutoff}
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      value={formData.xyz_y_cv}
                      onChange={e => handleChange('xyz_y_cv', parseFloat(e.target.value) || 1.0)}
                      className="w-20 px-2 py-1 border border-[#CBD5E1] rounded font-mono font-bold text-slate-800 bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Sticky Bottom Action Strip */}
          <div className="flex items-center justify-between p-4 bg-white border border-[#CBD5E1] rounded-lg shadow-xs">
            <span className="text-[11px] text-slate-500 font-medium">
              {isAr ? 'يتم حفظ كافة الإعدادات تلقائياً في قاعدة بيانات DuckDB وتطبيقها على حسابات التوريد فوراً.' : 'All preferences persist in local DuckDB and recalculate replenishment parameters immediately.'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                disabled={isSaving}
                className="px-4 py-2 bg-white border border-[#CBD5E1] hover:bg-[#F1F5F9] text-slate-700 font-semibold rounded text-[11px] transition cursor-pointer"
              >
                {t.settings.resetBtn}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-[#2196F3] hover:bg-blue-600 text-white font-bold rounded text-[11px] shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? t.settings.saving : t.settings.saveBtn}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
