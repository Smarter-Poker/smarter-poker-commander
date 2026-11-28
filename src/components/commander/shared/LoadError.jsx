/**
 * LoadError - the one "Could Not Load ..., Try Again" panel a staff page shows
 * when its data did not arrive (2026-11-28). It renders inside the page's
 * CommanderLayout, so the global header and the page image header stay; the
 * page never white-screens on a bad API answer.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function LoadError({ message, onRetry, children }) {
  return (
    <div className="max-w-md mx-auto my-10 bg-[#0A1829] border border-[#445E77] rounded-xl p-6 text-center" role="alert" data-load-error="">
      <AlertTriangle className="w-10 h-10 text-[#22D3EE] mx-auto mb-3" aria-hidden="true" />
      <p className="text-[#F2F7FF] text-lg mb-4">{message || 'Could Not Load This Page'}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 min-h-[44px] px-6 py-3 bg-[#0C55C0] text-white rounded-lg text-base font-medium"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try Again
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
