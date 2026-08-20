/**
 * Retired Route
 *
 * A page that has been consolidated into a newer screen, kept alive as a
 * redirect rather than deleted.
 *
 * WHY NOT JUST DELETE THE FILE
 * ----------------------------
 * Commander runs on tablets that live on a poker floor and are never closed.
 * A staff member can be sitting on a retired URL right now, and half the room's
 * tablets have it bookmarked or pinned to a home screen. Deleting the page
 * turns all of that into a 404 in the middle of a live event. A redirect turns
 * it into the new screen instead, and the route can be removed for real once
 * the analytics show nobody lands on it.
 *
 * router.replace, not push: the retired URL must not sit in the back stack,
 * or Back from the new screen bounces straight into the redirect again.
 *
 * @param {string} to        the modern route to send them to
 * @param {string} title     what the retired screen was called
 * @param {string} replacedBy  human name of the screen that replaced it
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Loader2 } from 'lucide-react';

export default function RetiredRoute({ to, title, replacedBy }) {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady || !to) return;
    router.replace(to).catch(err => console.warn('[RetiredRoute] redirect failed:', err?.message || err));
  }, [router, to]);

  return (
    <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] flex items-center justify-center px-4">
      <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-6 text-center max-w-sm w-full">
        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mx-auto mb-3" />
        <p className="text-sm font-semibold text-white">{title || 'This Screen'} Has Moved</p>
        <p className="text-xs text-[#B0B3B8] mt-1">
          Taking You To {replacedBy || 'The New Screen'}. Update Your Bookmark When You Get There.
        </p>
        {to && (
          <button
            onClick={() => router.replace(to)}
            className="w-full h-11 mt-4 rounded-xl bg-[#1877F2] text-white text-sm font-bold active:opacity-90"
          >
            Go Now
          </button>
        )}
      </div>
    </div>
  );
}
