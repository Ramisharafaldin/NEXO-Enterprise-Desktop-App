import React from 'react';

interface NexoLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  isArabic?: boolean;
  className?: string;
}

export const NexoLogo: React.FC<NexoLogoProps> = ({
  size = 'md',
  showWordmark = false,
  isArabic = false,
  className = '',
}) => {
  const dimensions = {
    sm: { box: 24, text: 'text-sm' },
    md: { box: 36, text: 'text-lg' },
    lg: { box: 52, text: 'text-2xl' },
    xl: { box: 72, text: 'text-4xl' },
  }[size];

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Sleek Geometric Vector "N" Emblem */}
      <svg
        width={dimensions.box}
        height={dimensions.box}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-xs"
      >
        <defs>
          {/* Left Vertical Pillar Gradient */}
          <linearGradient id="nexoPillarLeft" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0284C7" />
          </linearGradient>

          {/* Dynamic Diagonal Slash Gradient */}
          <linearGradient id="nexoDiagonal" x1="20" y1="15" x2="80" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00E5FF" />
            <stop offset="50%" stopColor="#2196F3" />
            <stop offset="100%" stopColor="#1E40AF" />
          </linearGradient>

          {/* Right Vertical Pillar Gradient */}
          <linearGradient id="nexoPillarRight" x1="100" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2196F3" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>

          {/* Charcoal Background Accent */}
          <linearGradient id="nexoBg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#343D46" />
            <stop offset="100%" stopColor="#1E293B" />
          </linearGradient>
        </defs>

        {/* Rounded Diamond/Shield Badge Background */}
        <rect x="2" y="2" width="96" height="96" rx="22" fill="url(#nexoBg)" />
        <rect x="2" y="2" width="96" height="96" rx="22" stroke="#475569" strokeWidth="2" strokeOpacity="0.5" />

        {/* Geometric "N" Monogram */}
        {/* 1. Left Vertical Beam */}
        <path
          d="M24 82V26C24 21.5817 27.5817 18 32 18H36C40.4183 18 44 21.5817 44 26V56L24 82Z"
          fill="url(#nexoPillarLeft)"
        />

        {/* 2. Bold High-Speed Diagonal Slash */}
        <path
          d="M32 18L76 74C78.5 77.5 76 82 71.5 82H63C59.5 82 56.5 80 54.5 77.5L25 36C23 33 24 29 27.5 27L32 18Z"
          fill="url(#nexoDiagonal)"
        />

        {/* 3. Right Vertical Beam */}
        <path
          d="M56 44L76 18H68C63.5817 18 60 21.5817 60 26V40L76 18Z"
          fill="#38BDF8"
          opacity="0.6"
        />
        <path
          d="M68 82H76C80.4183 82 84 78.4183 84 74V26C84 21.5817 80.4183 18 76 18V74C76 78.4183 72.4183 82 68 82Z"
          fill="url(#nexoPillarRight)"
        />

        {/* Glowing Apex Spark */}
        <circle cx="76" cy="22" r="4.5" fill="#00E5FF" />
      </svg>

      {/* Optional Wordmark */}
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-1.5">
            <span className={`font-black tracking-wider text-slate-900 ${dimensions.text}`}>
              NEXO
            </span>
            {isArabic && (
              <span className="text-xs font-bold text-[#2196F3] font-arabic">
                نيكسو
              </span>
            )}
          </div>
          <span className="text-[9px] font-semibold tracking-widest uppercase text-slate-400 mt-0.5">
            Enterprise Planning
          </span>
        </div>
      )}
    </div>
  );
};
