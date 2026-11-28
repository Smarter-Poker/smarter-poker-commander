/**
 * The global-header profile photo for Club Commander.
 *
 * 2026-11-27, Dan: the Commander header was "not pulling the profile image"
 * and showed a green letter disc instead of the photo every other Smarter.Poker
 * header shows. Root cause: Commander guessed the photo from browser storage -
 * commander_staff (no avatar field), the hub's 'sp-cached-header-user' cache
 * (written only on the smarter.poker origin, so never present here), then
 * smarter-poker-auth user_metadata.avatar_url, which for a Google sign-in is
 * Google's generated initial tile. So the letter tile won, every time.
 *
 * The hub header (src/components/ui/UniversalHeader.js + src/lib/headerPortrait.js
 * in World Hub) reads profiles.avatar_url / arena_avatar_url /
 * use_avatar_as_profile_pic. This module reads the SAME row with the SAME rule,
 * so Commander shows exactly the photo the hub shows, and falls back to the
 * same /default-avatar.png - never to an OAuth provider's tile.
 */
import { useEffect, useState } from 'react';

export const DEFAULT_HEADER_PORTRAIT = '/default-avatar.png';
const CACHE_KEY = 'commander_header_portrait';

/** Byte-for-byte the hub rule (World Hub src/lib/headerPortrait.js). */
export function resolveHeaderPortrait(profilePhotoUrl, arenaAvatarUrl, useAvatarAsProfilePic) {
  if (useAvatarAsProfilePic) return arenaAvatarUrl || profilePhotoUrl || null;
  return profilePhotoUrl || null;
}

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached && typeof cached.url === 'string' ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(userId, url) {
  try {
    if (userId && url) localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, url }));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable */ }
}

/** Resolve the signed-in user's header photo from their profile row. */
export async function loadHeaderPortrait(supabase) {
  const { data } = await supabase.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) {
    writeCache(null, null);
    return DEFAULT_HEADER_PORTRAIT;
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, arena_avatar_url, use_avatar_as_profile_pic')
    .eq('id', userId)
    .maybeSingle();
  const url = resolveHeaderPortrait(
    profile?.avatar_url || null,
    profile?.arena_avatar_url || null,
    profile?.use_avatar_as_profile_pic === true,
  );
  writeCache(userId, url);
  return url || DEFAULT_HEADER_PORTRAIT;
}

/**
 * Live header photo. Paints the last resolved photo immediately (no flash),
 * then re-reads the profile row; refreshes on the hub's avatar events
 * ('profile-updated', the 'smarter_poker_avatar_sync' channel) and when the
 * platform session changes in another tab.
 */
export function useHeaderPortrait(supabase) {
  const [portrait, setPortrait] = useState(DEFAULT_HEADER_PORTRAIT);

  useEffect(() => {
    let alive = true;
    const cached = readCache();
    if (cached?.url) setPortrait(cached.url);

    const reload = () => {
      loadHeaderPortrait(supabase)
        .then((url) => { if (alive) setPortrait(url); })
        .catch(() => { /* keep what is painted */ });
    };
    const onProfileUpdated = (event) => {
      const next = event?.detail?.avatar_url;
      if (next && alive) setPortrait(next);
      reload();
    };
    const onStorage = (event) => {
      if (event.key === 'smarter-poker-auth') reload();
    };

    let channel = null;
    try {
      channel = new BroadcastChannel('smarter_poker_avatar_sync');
      channel.onmessage = onProfileUpdated;
    } catch { /* optional */ }

    reload();
    window.addEventListener('profile-updated', onProfileUpdated);
    window.addEventListener('storage', onStorage);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') reload();
    }) || { data: null };

    return () => {
      alive = false;
      window.removeEventListener('profile-updated', onProfileUpdated);
      window.removeEventListener('storage', onStorage);
      try { channel?.close(); } catch { /* noop */ }
      try { sub?.subscription?.unsubscribe(); } catch { /* noop */ }
    };
  }, [supabase]);

  return portrait;
}

export default useHeaderPortrait;
