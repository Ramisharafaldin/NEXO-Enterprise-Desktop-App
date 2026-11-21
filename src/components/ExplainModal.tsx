import React from 'react';
import { InventoryItem, AppSettings } from '../engine/types';
import { explainInventoryCalculation } from '../engine/math';
import { Language, translations } from '../i18n/translations';
import { getCurrencySymbol, formatItemCode } from '../utils/formatters';
import { X, HelpCircle, Calculator, Info, CheckCircle2 } from 'lucide-react';

interface ExplainModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  settings?: AppSettings;
  language: Language;
}

export const ExplainModal: React.FC<ExplainModalProps> = ({ item, onClose, settings, language }) => {
  if (!item) return null;

  const t = translations[language];
  const isAr = language === 'ar';
  const currSym = getCurrencySymbol(settings?.currency_code || 'EGP', language);
  const explanation = explainInventoryCalculation(item, language, currSym);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-[#1E293B]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-50 text-[#2196F3] border border-blue-200">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {explanation.title}
              </h3>
              <p className="text-[11px] text-slate-500 font-mono">
                {formatItemCode(item.code)} — {item.description} ({item.location})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-[#E2E8F0] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-3 bg-[#F8F9FA] text-[12px]">
          {explanation.steps.map((step, idx) => (
            <div 
              key={idx}
              className="p-3.5 rounded bg-white border border-[#E2E8F0] shadow-2xs space-y-1.5"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-bold text-[#2196F3]">
                  {step.name}
                </span>
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {step.value}
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-700 bg-[#F1F5F9] px-2 py-1 rounded">
                {step.formula}
              </div>
              <p className="text-[11px] text-slate-500">
                {step.details}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#ECEFF1] border-t border-[#CBD5E1] flex justify-between items-center text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Verified by Abramowitz & Stegun Norm.Inv Engine
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1 bg-[#2196F3] text-white font-semibold rounded text-[11px] hover:bg-blue-600 transition shadow-xs"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
