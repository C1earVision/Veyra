import React, { useState, useEffect } from "react";
import { Cpu, Database, Check, Loader2, Sparkles, AlertTriangle, RefreshCw, ArrowRight } from "lucide-react";

/**
 * AppLoadingScreen - High-polish startup loading screen.
 * Displays while AI models and active data sources load before the application interface opens.
 *
 * @param {object} props
 * @param {"loading" | "ready" | "error"} props.modelsStatus
 * @param {"loading" | "ready" | "error"} props.sourcesStatus
 * @param {number} props.modelsCount
 * @param {object} props.activeSource
 * @param {() => void} props.onRetry
 * @param {() => void} props.onContinue
 */
export default function AppLoadingScreen({
  modelsStatus = "loading",
  sourcesStatus = "loading",
  modelsCount = 0,
  activeSource = null,
  onRetry,
  onContinue,
}) {
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [showTimeoutControls, setShowTimeoutControls] = useState(false);

  useEffect(() => {
    const slowTimer = setTimeout(() => {
      setShowSlowNotice(true);
    }, 6000);

    const timeoutTimer = setTimeout(() => {
      setShowTimeoutControls(true);
    }, 12000);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    };
  }, []);

  // Compute overall progress percentage
  let progress = 15;
  if (modelsStatus === "ready" || modelsStatus === "error") progress += 42;
  if (sourcesStatus === "ready" || sourcesStatus === "error") progress += 43;

  return (
    <div className="min-h-screen w-full bg-[#0F1117] flex flex-col items-center justify-center relative overflow-hidden select-none px-4">
      {/* Background ambient radial glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] h-[540px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] bg-indigo-500/8 rounded-full blur-[100px] pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-[440px] p-7 sm:p-8 rounded-2xl bg-[#151821]/90 border border-[#272B35]/90 shadow-2xl backdrop-blur-xl relative z-10 flex flex-col items-center">
        {/* Animated Brand Badge */}
        <div className="relative mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-blue-400/30">
            <Sparkles className="w-7 h-7 text-white animate-pulse" />
          </div>
          <div className="absolute -inset-1 rounded-2xl bg-blue-500/20 blur-sm -z-10 animate-pulse" />
        </div>

        {/* Title & Tagline */}
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-bold text-[#F3F4F6] tracking-tight">
            Veyra
          </h1>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
            BI
          </span>
        </div>
        <p className="mt-1 text-[13px] text-[#9CA3AF] text-center">
          Initializing intelligent workspace...
        </p>

        {/* Progress Bar */}
        <div className="w-full mt-6 mb-5">
          <div className="w-full h-1.5 bg-[#1C202C] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Status Checklist */}
        <div className="w-full space-y-2.5">
          {/* Item 1: AI Models */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#1C202C]/60 border border-[#272B35]/70">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Cpu className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-[13px] font-medium text-[#F3F4F6] truncate">
                  AI Models
                </p>
                <p className="text-[11px] text-[#9CA3AF] truncate">
                  {modelsStatus === "loading" && "Discovering configured models..."}
                  {modelsStatus === "ready" &&
                    (modelsCount > 0 ? `${modelsCount} models ready` : "Models initialized")}
                  {modelsStatus === "error" && "Default models ready"}
                </p>
              </div>
            </div>

            <div className="flex-shrink-0 ml-3">
              {modelsStatus === "loading" && (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              )}
              {modelsStatus === "ready" && (
                <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
              )}
              {modelsStatus === "error" && (
                <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                </div>
              )}
            </div>
          </div>

          {/* Item 2: Active Data Sources */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#1C202C]/60 border border-[#272B35]/70">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Database className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-[13px] font-medium text-[#F3F4F6] truncate">
                  Active Sources
                </p>
                <p className="text-[11px] text-[#9CA3AF] truncate">
                  {sourcesStatus === "loading" && "Connecting & syncing data sources..."}
                  {sourcesStatus === "ready" &&
                    (activeSource?.name ? activeSource.name : "Data sources connected")}
                  {sourcesStatus === "error" && "Default source connected"}
                </p>
              </div>
            </div>

            <div className="flex-shrink-0 ml-3">
              {sourcesStatus === "loading" && (
                <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              )}
              {sourcesStatus === "ready" && (
                <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
              )}
              {sourcesStatus === "error" && (
                <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Slow startup notice (if backend cold-starting) */}
        {showSlowNotice && !showTimeoutControls && (
          <p className="mt-4 text-[11px] text-[#9CA3AF] text-center animate-pulse">
            Connecting to backend services... please wait a moment.
          </p>
        )}

        {/* Fallback timeout controls */}
        {showTimeoutControls && (
          <div className="w-full mt-5 pt-4 border-t border-[#272B35]/60 flex flex-col gap-2">
            <p className="text-[11px] text-[#9CA3AF] text-center">
              Initialization is taking longer than usual.
            </p>
            <div className="flex items-center gap-2 mt-1">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C202C] hover:bg-[#252A3A] border border-[#272B35] text-[12px] font-medium text-[#F3F4F6] transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <span>Retry</span>
                </button>
              )}
              {onContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-[12px] font-medium text-white transition-colors cursor-pointer shadow-sm shadow-blue-500/20"
                >
                  <span>Continue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
