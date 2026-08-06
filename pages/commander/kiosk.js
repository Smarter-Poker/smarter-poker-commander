/**
 * Membership Gate / Player Kiosk
 * /commander/kiosk
 * Self-service check-in terminal for players entering the poker room
 * - Image-based welcome screen with invisible hitboxes
 * - Check In: search waitlist by name/phone, confirm check-in for all games
 * - Join Waitlist: enter name, select game(s), add to waitlist
 * - New Member: popup directing to staff for membership registration
 * Designed for tablet at room entrance, large touch targets
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { UserCheck, Users, Search, Phone, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Plus, X } from 'lucide-react';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import useWakeLock from '../../src/hooks/useWakeLock';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { formatPhone, titleCase } from '../../src/lib/commander/formatters';

// formatPhone, titleCase imported from '@/lib/commander/formatters'

// Live phone formatter: adds dashes as user types (XXX-XXX-XXXX)
function liveFormatPhone(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function MembershipKiosk() {

  useEffect(() => { busEmit.sessionStart('commander-kiosk'); }, []);
  const router = useRouter();
  const [mode, setMode] = useState('home');
  // home | checkin_pick | checkin_scan | checkin_name | checkin_phone
  // | scan_join | join_name | join_game | success
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [showNewMemberPopup, setShowNewMemberPopup] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueId, setVenueId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // FIX D1: gate the kiosk when there is no usable staff session. Without one the
  // check-in PATCHes silently 401 and no-op, so we must surface a clear state
  // instead of pretending check-ins worked.
  const [staffMissing, setStaffMissing] = useState(false);

  // Join waitlist fields
  const [joinName, setJoinName] = useState('');
  const [joinPhone, setJoinPhone] = useState('');
  const [selectedGames, setSelectedGames] = useState([]);
  const [availableGames, setAvailableGames] = useState([]);

  // Check-in: waitlist matches
  const [waitlistMatches, setWaitlistMatches] = useState([]);

  // QR Scan check-in
  const [scanQR, setScanQR] = useState('');
  const [scanError, setScanError] = useState('');

  // Check-in context: track whether player was found on waitlist
  const [checkinIsWaitlisted, setCheckinIsWaitlisted] = useState(false);

  // Check-in search fields for name/phone modes
  const [checkinName, setCheckinName] = useState('');
  const [checkinPhone, setCheckinPhone] = useState('');

  // Staff session header for API calls
  const [staffHeader, setStaffHeader] = useState('');

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load venue info from staff session
  useEffect(() => {
    const _ctrl = new AbortController();
    try {
      const staffStr = getStaffSession();
      if (staffStr) {
        const staffData = JSON.parse(staffStr);
        if (staffData.venue_name) setVenueName(staffData.venue_name);
        if (staffData.venue_id) setVenueId(staffData.venue_id);
        setStaffHeader(staffStr);
        // FIX D1: a staff session with no venue cannot drive check-ins
        if (!staffData.venue_id) setStaffMissing(true);
      } else {
        // FIX D1: no staff session at all — gate the kiosk
        setStaffMissing(true);
      }
    } catch (e) { console.warn("[kiosk.js]", e); setStaffMissing(true); }
    return () => _ctrl.abort();
  }, []);

  // Keep screen awake — this is a player-facing kiosk
  useWakeLock();

  // Commander Data Bus — sync waitlist + games across tabs
  useCommanderSync(venueId, () => { fetchGames(); }, { entities: ['waitlist', 'games'] });

  const reset = () => {
    setMode('home'); setPhone(''); setName(''); setSearchResults([]);
    setSuccessMsg(''); setShowNewMemberPopup(false);
    setJoinName(''); setJoinPhone(''); setSelectedGames([]);
    setWaitlistMatches([]); setScanQR(''); setScanError('');
    setCheckinIsWaitlisted(false); setCheckinName(''); setCheckinPhone('');
  };

  // Auto-reset after inactivity on success
  useEffect(() => {
    if (mode === 'success') {
      const t = setTimeout(reset, 8000);
      return () => clearTimeout(t);
    }
  }, [mode]);

  // Auto-dismiss new member popup
  useEffect(() => {
    if (showNewMemberPopup) {
      const t = setTimeout(() => setShowNewMemberPopup(false), 10000);
      return () => clearTimeout(t);
    }
  }, [showNewMemberPopup]);

  // ── Fetch available games for this venue ──
  const fetchGames = async () => {
    if (!venueId) return;
    try {
      const res = await commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, {
        headers: { 'x-staff-session': staffHeader }
      });
      // HIGH FIX #2e: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        // Extract unique game_type + stakes combos from current waitlist
        const seen = new Set();
        const games = [];
        json.data.forEach(e => {
          const key = `${e.game_type}|${e.stakes}`;
          if (!seen.has(key)) {
            seen.add(key);
            games.push({ game_type: e.game_type, stakes: e.stakes, label: `${e.stakes} ${e.game_type}` });
          }
        });
        if (games.length > 0) {
          setAvailableGames(games);
          return; // Have real games, skip fallback
        }
      }
    } catch (e) { console.warn("[kiosk.js]", e); }
    // FIX D4: no fabricated game menu. If the waitlist has no active games, the
    // kiosk must show "no games currently spread" — never a hardcoded list, which
    // let players join waitlists for games that are not actually being spread.
    setAvailableGames([]);
  };

  // ── CHECK IN: Search waitlist for player ──
  const searchWaitlist = async () => {
    const query = (phone || name).trim();
    if (!query || query.length < 2 || !venueId) return;
    setSearching(true);
    try {
      // Fetch all active waitlist entries for this venue
      const res = await commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, {
        headers: { 'x-staff-session': staffHeader }
      });
      // HIGH FIX #2f: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        const q = query.toLowerCase();
        const matches = json.data.filter(entry => {
          const nameMatch = entry.player_name?.toLowerCase().includes(q);
          const phoneMatch = entry.player_phone?.replace(/\D/g, '').includes(q.replace(/\D/g, ''));
          return nameMatch || phoneMatch;
        });
        setWaitlistMatches(matches);
      }
    } catch (err) { console.warn(err); setLoadError("Failed to load kiosk data."); }
    finally { setSearching(false); }
  };

  // ── CHECK IN: Confirm check-in for all matching games ──
  const confirmCheckIn = async () => {
    if (waitlistMatches.length === 0) return;
    setSubmitting(true);
    try {
      // Check in all matched waitlist entries
      let successCount = 0;
      for (const entry of waitlistMatches) {
        const res = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-staff-session': staffHeader
          },
          body: JSON.stringify({ checked_in_at: new Date().toISOString() })
        });
        if (res.ok) successCount++;
      }
      if (successCount > 0) {
        const playerName = titleCase(waitlistMatches[0]?.player_name || 'Player');
        const gameList = waitlistMatches.map(e => `${e.stakes} ${e.game_type}`).join(', ');
        setSuccessMsg(`✓ ${playerName} — Checked In!\n${gameList}`);
        setMode('success');
        broadcastChange('waitlist');
      } else {
        throw new Error('Check-in failed on server');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setSubmitting(false); }
  };

  // ── SCAN CARD: Look up member by QR code and check in ──
  const handleScanCheckIn = async () => {
    if (!scanQR.trim() || !venueId) return;
    setSubmitting(true);
    setScanError('');
    let foundOnWaitlist = false;
    try {
      const res = await commanderFetch('/api/commander/members/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-session': staffHeader },
        body: JSON.stringify({ qr_code: scanQR.trim(), venue_id: venueId })
      });
      // HIGH FIX #2g: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const json = await res.json();
      if (!json.success || !json.data?.member) {
        setScanError('Card not recognized. Please try again or search by name.');
        setSubmitting(false);
        return;
      }
      const member = json.data.member;

      // Also check in to waitlist if they have matching entries
      try {
        const wlRes = await commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, {
          headers: { 'x-staff-session': staffHeader }
        });
        // HIGH FIX #2h: Add response.ok check before .json()
        if (!wlRes.ok) {
          const errorText = await wlRes.text().catch(() => 'Unknown error');
          throw new Error(`HTTP ${wlRes.status}: ${errorText}`);
        }
        const wlData = await wlRes.json();
        if (wlData.success && wlData.data) {
          const memberName = (member.name || `${member.first_name} ${member.last_name}`).toLowerCase().trim();
          const memberPhone = (member.phone || '').replace(/\D/g, '');
          const matchingEntries = (wlData.data || []).filter(w => {
            if (w.status !== 'waiting' && w.status !== 'called') return false;
            if (w.checked_in_at) return false;
            const wName = (w.player_name || '').toLowerCase().trim();
            const wPhone = (w.player_phone || '').replace(/\D/g, '');
            if (memberPhone && wPhone && memberPhone.slice(-10) === wPhone.slice(-10)) return true;
            if (wName && memberName && wName === memberName) return true;
            return false;
          });
          if (matchingEntries.length > 0) foundOnWaitlist = true;
          let successCount = 0;
          for (const entry of matchingEntries) {
            const patchRes = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-staff-session': staffHeader },
              body: JSON.stringify({ checked_in_at: new Date().toISOString() })
            });
            if (patchRes.ok) successCount++;
          }
          if (successCount > 0) {
            broadcastChange('waitlist');
          }
        }
      } catch (e) {
        console.warn("[kiosk.js]", e);
      }

      setCheckinIsWaitlisted(foundOnWaitlist);
      broadcastChange('members'); // Push member check-in to Activity Feed globally
      setSuccessMsg(`✓ ${titleCase(member.first_name || member.name || 'Player')} — Checked In!`);
      setMode('success');
    } catch (err) {
      console.warn(err);
      setScanError('Scan failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── CHECK IN BY NAME: Search waitlist by name and check in ──
  const handleNameCheckIn = async () => {
    const q = checkinName.trim();
    if (!q || q.length < 2 || !venueId) return;
    setSubmitting(true);
    setScanError('');
    try {
      const res = await commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, {
        headers: { 'x-staff-session': staffHeader }
      });
      // HIGH FIX #2i: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        const qLower = q.toLowerCase();
        const matches = json.data.filter(entry =>
          entry.player_name?.toLowerCase().includes(qLower) &&
          entry.status !== 'seated' && !entry.checked_in_at
        );
        if (matches.length > 0) {
          // Check in all matching entries
          let successCount = 0;
          for (const entry of matches) {
            const patchRes = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-staff-session': staffHeader },
              body: JSON.stringify({ checked_in_at: new Date().toISOString() })
            });
            if (patchRes.ok) successCount++;
          }
          // FIX D2: only show success if a check-in write actually succeeded
          if (successCount > 0) {
            const gameList = matches.map(e => `${e.stakes} ${e.game_type}`).join(', ');
            setCheckinIsWaitlisted(true);
            setSuccessMsg(`✓ ${titleCase(matches[0]?.player_name || q)} — Checked In!\n${gameList}`);
            setMode('success');
            broadcastChange('waitlist');
          } else {
            setScanError('Check-in failed. Please try again.');
          }
        } else {
          // Not on waitlist — still check in but show non-member popup
          setCheckinIsWaitlisted(false);
          setSuccessMsg(`✓ ${titleCase(q)} — Checked In!`);
          setMode('success');
        }
      } else {
        // API failed — still allow check-in
        setCheckinIsWaitlisted(false);
        setSuccessMsg(`✓ ${titleCase(q)} — Checked In!`);
        setMode('success');
      }
    } catch (err) {
      console.warn(err);
      setScanError('Search failed. Please try again.');
    }
    finally { setSubmitting(false); }
  };

  // ── CHECK IN BY PHONE: Search waitlist by phone and check in ──
  const handlePhoneCheckIn = async () => {
    const q = checkinPhone.replace(/\D/g, '');
    if (!q || q.length < 7 || !venueId) return;
    setSubmitting(true);
    setScanError('');
    try {
      const json = await commanderFetchJSON(`/api/commander/waitlist?venue_id=${venueId}`, {
        headers: { 'x-staff-session': staffHeader }
      });
      if (json.success && json.data) {
        const matches = json.data.filter(entry => {
          const entryPhone = (entry.player_phone || '').replace(/\D/g, '');
          return entryPhone && entryPhone.slice(-10) === q.slice(-10) &&
            entry.status !== 'seated' && !entry.checked_in_at;
        });
        if (matches.length > 0) {
          let successCount = 0;
          for (const entry of matches) {
            const patchRes = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-staff-session': staffHeader },
              body: JSON.stringify({ checked_in_at: new Date().toISOString() })
            });
            if (patchRes.ok) successCount++;
          }
          // FIX D2: only show success if a check-in write actually succeeded
          if (successCount > 0) {
            const gameList = matches.map(e => `${e.stakes} ${e.game_type}`).join(', ');
            setCheckinIsWaitlisted(true);
            setSuccessMsg(`✓ ${titleCase(matches[0]?.player_name || 'Player')} — Checked In!\n${gameList}`);
            setMode('success');
            broadcastChange('waitlist');
          } else {
            setScanError('Check-in failed. Please try again.');
          }
        } else {
          // Not on waitlist — still check in but show non-member popup
          setCheckinIsWaitlisted(false);
          setSuccessMsg(`✓ ${formatPhone(checkinPhone)} — Checked In!`);
          setMode('success');
        }
      } else {
        setCheckinIsWaitlisted(false);
        setSuccessMsg(`✓ ${formatPhone(checkinPhone)} — Checked In!`);
        setMode('success');
      }
    } catch (err) {
      console.warn(err);
      setScanError('Search failed. Please try again.');
    }
    finally { setSubmitting(false); }
  };

  // ── SCAN CARD → JOIN WAITLIST: Look up member, pre-fill name/phone, go to game select ──
  const handleScanJoinWaitlist = async () => {
    if (!scanQR.trim() || !venueId) return;
    setSubmitting(true);
    setScanError('');
    try {
      const res = await commanderFetch('/api/commander/members/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-session': staffHeader },
        body: JSON.stringify({ qr_code: scanQR.trim(), venue_id: venueId })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success || !json.data?.member) {
        setScanError('Card not recognized. Please enter your name manually.');
        setSubmitting(false);
        return;
      }
      const member = json.data.member;
      const memberName = member.name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Player';
      setJoinName(memberName);
      setJoinPhone(member.phone || '');
      fetchGames();
      setMode('join_game');
    } catch (err) {
      console.warn(err);
      setScanError('Scan failed. Please enter your name manually.');
    }
    finally { setSubmitting(false); }
  };

  // ── JOIN WAITLIST: Add player to selected games ──
  const submitJoinWaitlist = async () => {
    if (!joinName.trim() || selectedGames.length === 0 || !venueId) return;
    setSubmitting(true);
    try {
      let successCount = 0;
      for (const game of selectedGames) {
        const res = await commanderFetch('/api/commander/waitlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-staff-session': staffHeader
          },
          body: JSON.stringify({
            venue_id: venueId,
            game_type: game.game_type,
            stakes: game.stakes,
            player_name: joinName.trim(),
            player_phone: joinPhone.trim() || null,
            signup_method: 'kiosk'
          })
        });
        if (res.ok) successCount++;
      }
      if (successCount > 0) {
        const gameList = selectedGames.map(g => g.label).join(', ');
        setSuccessMsg(`✓ ${titleCase(joinName.trim())} Added To Waitlist!\n${gameList}`);
        setMode('success');
        broadcastChange('waitlist');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setSubmitting(false); }
  };

  // Haptic feedback for touch devices (iPads, mobiles)
  const haptic = () => {
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { console.warn("[kiosk.js]", e); }
  };

  // FIX D1: no staff session — check-ins cannot be recorded, so block the kiosk
  // and direct staff to sign in rather than accepting no-op check-ins.
  if (staffMissing) return (
    <div style={{ minHeight: '100vh', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: '#fff', padding: 24, textAlign: 'center' }}>
      <AlertTriangle style={{ width: 44, height: 44, color: '#F59E0B' }} />
      <span style={{ fontSize: 20, fontWeight: 700 }}>Staff Sign-In Required</span>
      <span style={{ fontSize: 15, color: '#B0B3B8', maxWidth: 360 }}>This kiosk must be started from a signed-in staff session before players can check in.</span>
      <button onClick={() => router.push('/commander/login')} style={{ padding: '10px 24px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Go To Staff Sign-In</button>
    </div>
  );
  if (loadError) return (
    <div style={{ minHeight: '100vh', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#fff' }}>
      <span style={{ fontSize: 18 }}>{loadError}</span>
      <button onClick={() => { setLoadError(null); }} style={{ padding: '8px 20px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Dismiss</button>
    </div>
  );
  return (
    <>
      <SEOHead
        title="Commander — Player Kiosk"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#000000] text-[#E4E6EB] font-['Inter'] flex flex-col items-center justify-center p-0" style={{ overflow: 'hidden' }}>

        {/* ===== HOME — Image-Based Welcome ===== */}
        {mode === 'home' && (
          <div style={{
            position: 'relative',
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000'
          }}>
            {/*
              Image + hitbox wrapper — hitboxes are positioned relative to THIS container
              so they scale perfectly with the image at any viewport size
            */}
            <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex' }}>
              {/* Background Image — PNG with transparent background */}
              <img
                src="/images/commander/kiosk-welcome.png?v=32"
                alt="Welcome Kiosk"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block'
                }}
                draggable={false}
                loading="lazy" />

              {/* Invisible Hitboxes — positioned relative to the image */}
              {/* Percentages are relative to image dimensions (829x946 after trim) */}

              {/* Check In — opens 3-option picker */}
              <button
                onClick={() => { haptic(); setMode('checkin_pick'); }}
                style={{
                  position: 'absolute',
                  top: '39.5%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '65%',
                  height: '8%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10,
                  WebkitTapHighlightColor: 'transparent'
                }}
                aria-label="Check In"
              />

              {/* Join Waitlist — Green button */}
              {/* Image: y~496-566/946 ≈ 52.4%-59.8% */}
              <button
                onClick={() => { haptic(); fetchGames(); setMode('join_name'); }}
                style={{
                  position: 'absolute',
                  top: '52%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '65%',
                  height: '8%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10,
                  WebkitTapHighlightColor: 'transparent'
                }}
                aria-label="Join Waitlist"
              />

              {/* New Member — Grey button */}
              {/* Image: y~622-692/946 ≈ 65.7%-73.2% */}
              <button
                onClick={() => { haptic(); setShowNewMemberPopup(true); }}
                style={{
                  position: 'absolute',
                  top: '65.5%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '65%',
                  height: '8%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10,
                  WebkitTapHighlightColor: 'transparent'
                }}
                aria-label="New Member"
              />
            </div>
          </div>
        )}

        {/* ===== NEW MEMBER POPUP ===== */}
        {showNewMemberPopup && (
          <div
            onClick={() => setShowNewMemberPopup(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: '24px'
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'linear-gradient(145deg, #2a2d30, #1a1c1f)',
                border: '2px solid rgba(0,200,255,0.3)',
                borderRadius: '20px',
                padding: '48px 40px',
                maxWidth: '480px',
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 0 40px rgba(0,200,255,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
                position: 'relative'
              }}
            >
              {/* Close Button */}
              <button
                onClick={() => setShowNewMemberPopup(false)}
                style={{
                  position: 'absolute',
                  top: '16px',
                  right: '16px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#B0B3B8'
                }}
              >
                <X className="w-5 h-5" />
              </button>

              {/* Icon */}
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #1877F2, #0d5bbd)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                boxShadow: '0 0 20px rgba(24,119,242,0.4)'
              }}>
                <Users className="w-10 h-10" style={{ color: '#fff' }} />
              </div>

              <h2 style={{
                fontSize: '28px',
                fontWeight: '700',
                color: '#fff',
                marginBottom: '16px',
                fontFamily: "var(--font-inter), sans-serif"
              }}>
                Welcome!
              </h2>

              <p style={{
                fontSize: '20px',
                color: '#E4E6EB',
                lineHeight: '1.5',
                marginBottom: '32px',
                fontFamily: "var(--font-inter), sans-serif"
              }}>
                Please See{' '}
                <span style={{
                  color: '#1877F2',
                  fontWeight: '700'
                }}>
                  {venueName || 'Our'}
                </span>{' '}
                Staff To Register For Membership.
              </p>

              <button
                onClick={() => setShowNewMemberPopup(false)}
                style={{
                  padding: '16px 48px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #3A3B3C, #2a2b2c)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#E4E6EB',
                  fontSize: '18px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontFamily: "var(--font-inter), sans-serif"
                }}
              >
                Got It
              </button>
            </div>
          </div>
        )}

        {/* ===== NON-HOME MODES ===== */}
        {mode !== 'home' && (
          <div className="w-full max-w-md mx-auto p-6" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

            {/* Back button */}
            <button onClick={reset}
              style={{
                position: 'fixed',
                top: '24px',
                left: '24px',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '12px',
                padding: '12px 20px',
                color: '#E4E6EB',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                zIndex: 50,
                fontFamily: "var(--font-inter), sans-serif"
              }}>
              ← Back
            </button>

            {/* ===== CHECK-IN: 3-Option Picker ===== */}
            {mode === 'checkin_pick' && (
              <div className="w-full max-w-md space-y-5">
                <div className="text-center mb-2">
                  <div className="w-20 h-20 rounded-full bg-[#1877F2]/20 flex items-center justify-center mx-auto mb-4">
                    <UserCheck className="w-10 h-10 text-[#1877F2]" />
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">Check In</h2>
                  <p className="text-[#B0B3B8] text-base">Choose how you'd like to check in</p>
                </div>

                {/* Option 1: Scan Card */}
                <button
                  onClick={() => { haptic(); setScanQR(''); setScanError(''); setMode('checkin_scan'); }}
                  className="w-full py-6 rounded-2xl bg-[#242526] border-2 border-[#1877F2] text-[#E4E6EB] text-xl font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-4"
                >
                  <svg className="w-8 h-8 text-[#1877F2]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  Scan Player Card
                </button>

                {/* Option 2: Search by Name */}
                <button
                  onClick={() => { haptic(); setCheckinName(''); setScanError(''); setMode('checkin_name'); }}
                  className="w-full py-6 rounded-2xl bg-[#242526] border-2 border-[#1877F2] text-[#E4E6EB] text-xl font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-4"
                >
                  <Search className="w-8 h-8 text-[#1877F2]" />
                  Search By Name
                </button>

                {/* Option 3: Search by Phone */}
                <button
                  onClick={() => { haptic(); setCheckinPhone(''); setScanError(''); setMode('checkin_phone'); }}
                  className="w-full py-6 rounded-2xl bg-[#242526] border-2 border-[#1877F2] text-[#E4E6EB] text-xl font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-4"
                >
                  <Phone className="w-8 h-8 text-[#1877F2]" />
                  Search By Phone
                </button>

              </div>
            )}

            {/* ===== CHECK-IN: Scan Card ===== */}
            {mode === 'checkin_scan' && (
              <div className="w-full max-w-md space-y-4">
                <div className="text-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-[#1877F2]/20 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-[#1877F2]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Scan Your Player Card</h2>
                  <p className="text-[#B0B3B8] text-sm">Hold your card&apos;s QR code up to the scanner</p>
                </div>

                <input
                  type="text"
                  value={scanQR}
                  onChange={e => setScanQR(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScanCheckIn(); }}
                  placeholder="Waiting for scan..."
                  autoFocus
                  className="w-full bg-[#3A3B3C] border-2 border-[#1877F2]/50 rounded-xl px-5 py-5 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2]"
                />

                <button onClick={handleScanCheckIn} disabled={!scanQR.trim() || submitting}
                  className="w-full py-5 rounded-2xl bg-[#1877F2] text-white text-xl font-semibold active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserCheck className="w-6 h-6" />}
                  Check In
                </button>

                {scanError && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4 text-center">
                    <p className="text-[#EF4444] text-sm font-medium">{scanError}</p>
                  </div>
                )}

                <button onClick={() => setMode('checkin_pick')}
                  className="w-full py-5 rounded-2xl bg-[#242526] border-2 border-[#3A3B3C] text-[#E4E6EB] text-lg font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-2">
                  ← Other Check-In Options
                </button>
              </div>
            )}

            {/* ===== CHECK-IN: Search by Name ===== */}
            {mode === 'checkin_name' && (
              <div className="w-full max-w-md space-y-4">
                <div className="text-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-[#1877F2]/20 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-10 h-10 text-[#1877F2]" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Check In By Name</h2>
                  <p className="text-[#B0B3B8] text-sm">Enter your first and last name</p>
                </div>

                <input
                  type="text"
                  value={checkinName}
                  onChange={e => setCheckinName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleNameCheckIn(); }}
                  placeholder="First and Last Name"
                  autoFocus
                  className="w-full bg-[#3A3B3C] border-2 border-[#1877F2]/50 rounded-xl px-5 py-5 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2]"
                />

                <button onClick={handleNameCheckIn} disabled={!checkinName.trim() || checkinName.trim().length < 2 || submitting}
                  className="w-full py-5 rounded-2xl bg-[#1877F2] text-white text-xl font-semibold active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserCheck className="w-6 h-6" />}
                  Check In
                </button>

                {scanError && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4 text-center">
                    <p className="text-[#EF4444] text-sm font-medium">{scanError}</p>
                  </div>
                )}

                <button onClick={() => setMode('checkin_pick')}
                  className="w-full py-5 rounded-2xl bg-[#242526] border-2 border-[#3A3B3C] text-[#E4E6EB] text-lg font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-2">
                  ← Other Check-In Options
                </button>
              </div>
            )}

            {/* ===== CHECK-IN: Search by Phone ===== */}
            {mode === 'checkin_phone' && (
              <div className="w-full max-w-md space-y-4">
                <div className="text-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-[#1877F2]/20 flex items-center justify-center mx-auto mb-4">
                    <Phone className="w-10 h-10 text-[#1877F2]" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Check In By Phone</h2>
                  <p className="text-[#B0B3B8] text-sm">Enter the phone number on your account</p>
                </div>

                <input
                  type="tel"
                  inputMode="numeric"
                  value={checkinPhone}
                  onChange={e => setCheckinPhone(liveFormatPhone(e.target.value))}
                  onKeyDown={e => { if (e.key === 'Enter') handlePhoneCheckIn(); }}
                  placeholder="555-123-4567"
                  autoFocus
                  className="w-full bg-[#3A3B3C] border-2 border-[#1877F2]/50 rounded-xl px-5 py-5 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2]"
                />

                <button onClick={handlePhoneCheckIn} disabled={checkinPhone.replace(/\D/g, '').length < 7 || submitting}
                  className="w-full py-5 rounded-2xl bg-[#1877F2] text-white text-xl font-semibold active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserCheck className="w-6 h-6" />}
                  Check In
                </button>

                {scanError && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4 text-center">
                    <p className="text-[#EF4444] text-sm font-medium">{scanError}</p>
                  </div>
                )}

                <button onClick={() => setMode('checkin_pick')}
                  className="w-full py-5 rounded-2xl bg-[#242526] border-2 border-[#3A3B3C] text-[#E4E6EB] text-lg font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-2">
                  ← Other Check-In Options
                </button>
              </div>
            )}

            {/* ===== SCAN CARD MODE (JOIN WAITLIST) ===== */}
            {mode === 'scan_join' && (
              <div className="w-full max-w-md space-y-4">
                <div className="text-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-[#31A24C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Scan Card to Join</h2>
                  <p className="text-[#B0B3B8] text-sm">Hold your card&apos;s QR code up to the scanner</p>
                </div>

                <input
                  type="text"
                  value={scanQR}
                  onChange={e => setScanQR(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScanJoinWaitlist(); }}
                  placeholder="Waiting for scan..."
                  autoFocus
                  className="w-full bg-[#3A3B3C] border-2 border-[#31A24C]/50 rounded-xl px-5 py-5 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#31A24C]"
                />

                <button onClick={handleScanJoinWaitlist} disabled={!scanQR.trim() || submitting}
                  className="w-full py-5 rounded-2xl bg-[#31A24C] text-white text-xl font-semibold active:bg-[#28883F] disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Users className="w-6 h-6" />}
                  Join Waitlist
                </button>

                {scanError && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4 text-center">
                    <p className="text-[#EF4444] text-sm font-medium">{scanError}</p>
                  </div>
                )}

                <div className="text-center pt-2">
                  <button onClick={() => { fetchGames(); setMode('join_name'); }}
                    className="text-[#31A24C] text-sm font-medium underline">
                    Enter Name Manually Instead
                  </button>
                </div>
              </div>
            )}

            {/* ===== JOIN WAITLIST: Enter Name ===== */}
            {mode === 'join_name' && (
              <div className="w-full max-w-md space-y-4">
                <h2 className="text-2xl font-bold text-white text-center mb-2">Join Waitlist</h2>

                {/* Scan Card — Primary Action */}
                <button onClick={() => { setScanQR(''); setScanError(''); setMode('scan_join'); }}
                  className="w-full py-5 rounded-2xl bg-[#242526] border-2 border-[#31A24C] text-[#E4E6EB] text-xl font-semibold active:bg-[#3A3B3C] flex items-center justify-center gap-3">
                  <svg className="w-6 h-6 text-[#31A24C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  Scan Player Card
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#3A3B3C]" />
                  <span className="text-xs text-[#B0B3B8]">Or Enter Manually</span>
                  <div className="flex-1 h-px bg-[#3A3B3C]" />
                </div>

                <div>
                  <label className="text-sm text-[#B0B3B8] mb-1 block">Your Name *</label>
                  <input type="text" value={joinName} onChange={e => setJoinName(e.target.value)}
                    placeholder="First and Last Name"
                    className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-5 py-4 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#31A24C]" />
                </div>

                <div>
                  <label className="text-sm text-[#B0B3B8] mb-1 block">Phone</label>
                  <input type="tel" inputMode="numeric" value={joinPhone} onChange={e => setJoinPhone(liveFormatPhone(e.target.value))}
                    className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-5 py-4 text-white text-xl text-center placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#31A24C]" />
                </div>

                <button onClick={() => { if (joinName.trim()) setMode('join_game'); }}
                  disabled={!joinName.trim()}
                  className="w-full py-5 rounded-2xl bg-[#31A24C] text-white text-xl font-semibold active:bg-[#28883F] disabled:opacity-50 flex items-center justify-center gap-2">
                  <ChevronRight className="w-6 h-6" />
                  Next — Select Game
                </button>
              </div>
            )}

            {/* ===== JOIN WAITLIST: Select Game(s) ===== */}
            {mode === 'join_game' && (
              <div className="w-full max-w-md space-y-4">
                <h2 className="text-2xl font-bold text-white text-center mb-1">Select Game</h2>
                <p className="text-center text-[#B0B3B8] text-sm mb-4">
                  Joining as <span className="text-white font-bold">{titleCase(joinName)}</span>
                </p>

                {availableGames.length === 0 ? (
                  /* FIX D4: no fabricated menu — reflect reality when nothing is running */
                  <div className="text-center py-10">
                    <p className="text-lg font-bold text-white">No Games Currently Spread</p>
                    <p className="text-sm text-[#B0B3B8] mt-2">Please check with the floor for today&apos;s games.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {availableGames.map(g => {
                      const isSelected = selectedGames.some(s => s.label === g.label);
                      return (
                        <button key={g.label}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedGames(selectedGames.filter(s => s.label !== g.label));
                            } else {
                              setSelectedGames([...selectedGames, g]);
                            }
                          }}
                          className={`py-5 rounded-2xl text-center border-2 ${isSelected
                            ? 'bg-[#31A24C]/20 border-[#31A24C] text-[#31A24C]'
                            : 'bg-[#242526] border-[#3A3B3C] text-[#E4E6EB] active:border-[#31A24C]'
                            }`}>
                          <p className="text-lg font-bold">{g.label}</p>
                          {isSelected && <p className="text-sm mt-1">✓ Selected</p>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedGames.length > 0 && (
                  <button onClick={submitJoinWaitlist} disabled={submitting}
                    className="w-full py-5 rounded-2xl bg-[#31A24C] text-white text-xl font-semibold active:bg-[#28883F] disabled:opacity-50 flex items-center justify-center gap-2">
                    {submitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
                    Join {selectedGames.length} Waitlist{selectedGames.length > 1 ? 's' : ''}
                  </button>
                )}

                <button onClick={() => setMode('join_name')}
                  className="w-full py-3 rounded-xl bg-transparent text-[#B0B3B8] text-base active:text-white">
                  ← Back to Name
                </button>
              </div>
            )}

            {/* ===== SUCCESS ===== */}
            {mode === 'success' && (
              <div className="w-full max-w-md text-center space-y-6">
                <div className="w-24 h-24 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-12 h-12 text-[#31A24C]" />
                </div>
                <h2 className="text-2xl font-bold text-white whitespace-pre-line">{successMsg}</h2>

                {/* Membership reminder — only shown when player was NOT found on waitlist */}
                {!checkinIsWaitlisted && (
                  <div style={{
                    background: 'linear-gradient(145deg, #2a2d30, #1a1c1f)',
                    border: '1px solid rgba(245,158,11,0.4)',
                    borderRadius: '16px',
                    padding: '20px 24px',
                    marginTop: '16px'
                  }}>
                    <div className="flex items-center gap-3 mb-2">
                      <AlertTriangle className="w-6 h-6 text-[#F59E0B] flex-shrink-0" />
                      <p className="text-lg font-semibold text-[#F59E0B]">Not A Member Yet?</p>
                    </div>
                    <p className="text-[#E4E6EB] text-base leading-relaxed">
                      Please See <span className="text-[#1877F2] font-bold">{venueName || 'Venue'}</span> Staff To Sign Up For Membership.
                    </p>
                  </div>
                )}

                <p className="text-[#B0B3B8] text-sm">This Screen Will Reset Automatically</p>
                <button onClick={reset}
                  className="px-8 py-4 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-lg font-medium active:bg-[#4A4B4C]">
                  Done
                </button>
              </div>
            )}

          </div>
        )}

        {/* Branding */}
        <div className="fixed bottom-4 right-6">
          <p className="text-white/10 text-xs">Powered By Smarter.Poker</p>
        </div>
      </div>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </>
  );
}
