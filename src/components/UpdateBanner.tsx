import React, { useState, useEffect, useCallback } from 'react';
import { api, UpdateInfo } from '../api/client';
import { Language } from '../i18n/translations';
import { 
  Rocket, 
  RefreshCw, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  DownloadCloud, 
  RotateCw,
  GitCommit
} from 'lucide-react';

export interface UpdateBannerProps {
  language: Language;
  onRegisterCheck?: (checkFn: () => Promise<void>) => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  language,
  onRegisterCheck,
}) => {
  const isAr = language === 'ar';

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const check = useCallback(async (isManual: boolean = false) => {
    setIsChecking(true);
    setErrorMessage(null);
    try {
      const res = await api.checkUpdate();
      setUpdateInfo(res);
      if (res.update_available) {
        setIsDismissed(false);
      } else if (isManual) {
        // Show brief notification if manual check found no updates
        setApplyStatus('up_to_date');
        setTimeout(() => setApplyStatus(null), 3500);
      }
    } catch (e: any) {
      if (isManual) {
        setErrorMessage(e.message || (isAr ? 'تعذر الاتصال بـ GitHub للتحقق من التحديثات' : 'Unable to connect to GitHub to check for updates'));
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } finally {
      setIsChecking(false);
    }
  }, [isAr]);

  useEffect(() => {
    if (onRegisterCheck) {
      onRegisterCheck(async () => {
        await check(true);
      });
    }
  }, [onRegisterCheck, check]);

  // Automatic silent check on startup after 2.5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      check(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [check]);

  const handleApplyUpdate = async () => {
    setIsApplying(true);
    setErrorMessage(null);
    setApplyStatus('downloading');

    try {
      // Step 1: Pull from GitHub & rebuild frontend bundle
      const result = await api.applyUpdate();
      setApplyStatus('restarting');

      // Step 2: Trigger application restart
      setTimeout(async () => {
        try {
          await api.restartApp();
        } catch (restartErr) {
          // If browser mode, reload page
          window.location.reload();
        }
      }, 1200);
    } catch (err: any) {
      setIsApplying(false);
      setApplyStatus(null);
      setErrorMessage(err.message || (isAr ? 'فشل تطبيق التحديث. يرجى المحاولة مرة أخرى.' : 'Failed to apply update. Please try again.'));
    }
  };

  // Up to date toast banner
  if (applyStatus === 'up_to_date') {
    return (
      <div className="bg-emerald-900/90 text-white px-4 py-2 text-[12px] flex items-center justify-between border-b border-emerald-500 shadow-md z-50 transition-all select-none">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">
            {isAr
              ? `أنت تستخدم أحدث إصدار من NEXO (${updateInfo?.current_version || 'v0.1.0'}). لا توجد تحديثات جديدة.`
              : `NEXO is up to date (${updateInfo?.current_version || 'v0.1.0'}). No new updates found.`}
          </span>
        </div>
        <button onClick={() => setApplyStatus(null)} className="text-emerald-300 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Updating In-Progress Full Overlay Banner
  if (isApplying) {
    return (
      <div className="bg-[#0F172A] border-b-2 border-[#2196F3] text-white px-4 py-2.5 text-[12px] shadow-xl z-50 select-none animate-pulse">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-[#00E5FF] animate-spin shrink-0" />
            <div className="space-y-0.5">
              <span className="font-bold text-[#00E5FF] text-[13px]">
                {applyStatus === 'restarting'
                  ? (isAr ? 'تم اكتمال التحديث بنجاح! جاري إعادة تشغيل NEXO...' : 'Update completed successfully! Restarting NEXO...')
                  : (isAr ? 'جاري سحب التحديث من GitHub وبناء النسخة الجديدة بأمان...' : 'Downloading update from GitHub & compiling bundle safely...')}
              </span>
              <p className="text-[11px] text-slate-300">
                {isAr
                  ? 'بيانات مشاريعك في DuckDB محمية بالكامل ولن تتأثر. سيتم فتح التطبيق تلقائياً فور الانتهاء.'
                  : 'Your DuckDB workspace data is 100% safe. The application will restart automatically.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-blue-500/20 text-[#00E5FF] rounded border border-blue-400/30 text-[11px] font-mono">
              {updateInfo?.remote_sha ? `v${updateInfo.remote_sha}` : 'GitHub'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Update Available Notification Banner
  if (updateInfo?.update_available && !isDismissed) {
    return (
      <div className="bg-[#1E293B] border-b border-[#2196F3] text-white px-4 py-2 text-[12px] shadow-lg z-50 select-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 max-w-7xl mx-auto">
          {/* Left: Message */}
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-[#2196F3]/20 text-[#00E5FF] border border-[#2196F3]/40">
              <Rocket className="w-4 h-4 animate-bounce" />
            </div>
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="font-bold text-white text-[12px]">
                {isAr ? 'يتوفر تحديث جديد لتطبيق NEXO' : 'A new update is available for NEXO'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-200 border border-blue-500/40 font-mono">
                {isAr ? `الإصدار الحالي: ${updateInfo.current_version || 'v0.1.0'}` : `Current: ${updateInfo.current_version || 'v0.1.0'}`}
              </span>
              <span className="text-slate-400 mx-1">—</span>
              <span className="text-[#38BDF8] font-medium font-mono text-[11px]">
                {updateInfo.commit_message || (isAr ? 'تحسينات جديدة على النظام' : 'New enhancements')}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                {updateInfo.remote_sha}
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleApplyUpdate}
              className="flex items-center gap-1.5 px-3.5 py-1 bg-[#2196F3] hover:bg-blue-500 text-white font-bold rounded text-[11px] shadow-sm transition cursor-pointer"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              <span>{isAr ? 'موافقة وتحديث الآن' : 'Approve & Update Now'}</span>
            </button>

            <button
              onClick={() => setIsDismissed(true)}
              title={isAr ? 'تجاهل الآن' : 'Dismiss'}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 text-[11px] transition cursor-pointer"
            >
              <span>{isAr ? 'تجاهل الآن' : 'Dismiss'}</span>
              <X className="w-3 h-3 text-slate-400" />
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-1.5 text-rose-300 text-[11px] flex items-center gap-1.5 bg-rose-950/60 p-1.5 rounded border border-rose-800">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    );
  }

  // Error Alert if manual check failed
  if (errorMessage) {
    return (
      <div className="bg-rose-900/90 text-white px-4 py-2 text-[12px] flex items-center justify-between border-b border-rose-500 shadow-md z-50 transition-all select-none">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
        <button onClick={() => setErrorMessage(null)} className="text-rose-300 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
};
