import React from 'react';
import { translations, Language } from '../i18n/translations';
import { 
  BookOpen, 
  TrendingUp, 
  ShieldCheck, 
  CheckCircle2, 
  Layers, 
  Server, 
  Globe2,
  Code2
} from 'lucide-react';

interface UserGuideViewProps {
  language: Language;
}

export const UserGuideView: React.FC<UserGuideViewProps> = ({ language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  return (
    <div className="flex-1 overflow-y-auto bg-white p-8 text-[#1E293B] select-none text-[13px]">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-[#E2E8F0] pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#2196F3]/10 text-[#2196F3] rounded-lg">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">
                {t.guide.title}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {t.guide.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Section 1: Forecasting Methodology */}
        <div className="space-y-3 bg-[#F8F9FA] p-5 rounded-lg border border-[#E2E8F0]">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#2196F3]" />
            {t.guide.sec1Title}
          </h2>
          <p className="text-slate-700 leading-relaxed text-[12px]">
            {t.guide.sec1Content}
          </p>
          <div className="bg-white p-3 rounded border border-[#CBD5E1] text-[11px] font-mono text-slate-800 space-y-1">
            <div className="font-bold text-[#2196F3]">// Models Available in pre:: Engine</div>
            <div>• Constant Level: ŷ(t) = μ</div>
            <div>• Linear Trend: ŷ(t) = a + b·t (OLS slope & intercept)</div>
            <div>{"• Seasonal Holt-Winters: ŷ(t) = (L_t + k·T_t) · S_(t+k-m)"}</div>
            <div>• Croston SBA: ŷ = (1 - α/2) · (z_t / p_t) for intermittent demand</div>
            <div>• Model Evaluation: WMAPE = Σ |Actual - Forecast| / Σ Actual</div>
          </div>
        </div>

        {/* Section 2: Dynamic Safety Stock Formula */}
        <div className="space-y-3 bg-[#F8F9FA] p-5 rounded-lg border border-[#E2E8F0]">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            {t.guide.sec2Title}
          </h2>
          <p className="text-slate-700 leading-relaxed text-[12px] whitespace-pre-line">
            {t.guide.sec2Content}
          </p>
          <div className="bg-white p-3 rounded border border-[#CBD5E1] text-[12px] font-mono font-bold text-emerald-800 text-center">
            SS = Z(ServiceLevel) × √( L × σ_D² + D̄² × σ_L² )
          </div>
          <div className="text-[11px] text-slate-500">
            {isAr
              ? 'تعتمد دالة Z على تقريب أبراموفيتز وستيجون الكسري للتوزيع الطبيعي المعياري بدقة تامة تصل إلى 10^-5.'
              : 'The Z quantile uses the Abramowitz & Stegun rational approximation with absolute error < 7.5e-8.'}
          </div>
        </div>

        {/* Section 3: ROP & Lot Sizing */}
        <div className="space-y-3 bg-[#F8F9FA] p-5 rounded-lg border border-[#E2E8F0]">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber-600" />
            {t.guide.sec3Title}
          </h2>
          <p className="text-slate-700 leading-relaxed text-[12px]">
            {t.guide.sec3Content}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
            <div className="bg-white p-2.5 rounded border border-[#CBD5E1]">
              <span className="font-bold text-slate-800 block mb-1">Periodic Review (JIT):</span>
              Target Stock = (D̄ × (L + R)) + SS
            </div>
            <div className="bg-white p-2.5 rounded border border-[#CBD5E1]">
              <span className="font-bold text-slate-800 block mb-1">Min/Max Strategy:</span>
              Min = ROP = (D̄ × L) + SS; Max = Min + OCYC
            </div>
          </div>
        </div>

        {/* Section 4: Multi-Echelon DRP */}
        <div className="space-y-3 bg-[#F8F9FA] p-5 rounded-lg border border-[#E2E8F0]">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-600" />
            {t.guide.sec4Title}
          </h2>
          <p className="text-slate-700 leading-relaxed text-[12px]">
            {t.guide.sec4Content}
          </p>
        </div>

        {/* Section 5: Bilingual Support & Architecture */}
        <div className="space-y-3 bg-[#F8F9FA] p-5 rounded-lg border border-[#E2E8F0]">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-sky-600" />
            {t.guide.sec5Title}
          </h2>
          <p className="text-slate-700 leading-relaxed text-[12px]">
            {t.guide.sec5Content}
          </p>
        </div>
      </div>
    </div>
  );
};
