/**
 * Commander Staff Management Page
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Plus, Edit2, Trash2, User, Loader2, X, Eye, EyeOff, AlertTriangle, CreditCard, QrCode, Link2, Copy, CheckCircle, Search } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import useDebounce from '../../src/hooks/useDebounce';
import Pagination from '../../src/components/commander/shared/Pagination';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getToken, getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const ID_TYPES = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'state_id', label: 'State ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'military_id', label: 'Military ID' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

const ROLES = [
  { value: 'owner', label: 'Owner', color: 'bg-[#7C3AED] text-white' },
  { value: 'manager', label: 'Manager', color: 'bg-[#2563EB] text-white' },
  { value: 'dualrate', label: 'Dual Rate', color: 'bg-[#0D9488] text-white' },
  { value: 'floor', label: 'Floor', color: 'bg-[#059669] text-white' },
  { value: 'brush', label: 'Brush', color: 'bg-[#D97706] text-white' },
  { value: 'cashier', label: 'Cashier', color: 'bg-[#7C3AED]/80 text-white' },
  { value: 'dealer', label: 'Dealer', color: 'bg-[#6B7280] text-white' },
  { value: 'security', label: 'Security', color: 'bg-[#DC2626] text-white' },
];

export default function CommanderStaffPage() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-staff'); }, []);

  const [currentStaff, setCurrentStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [revealedPinId, setRevealedPinId] = useState(null);
  const [linkCodeData, setLinkCodeData] = useState(null); // { staffId, token, url }
  const [linkCodeLoading, setLinkCodeLoading] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchQuery = useDebounce(searchTerm, 300);

  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');
  const ITEMS_PER_PAGE = 50;

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { setPage(1); }, [debouncedSearchQuery]);

  // Check staff session
  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) {
        router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }
      // Role access check is handled by CommanderLayout PIN gate
      setCurrentStaff(staffData);
      setVenueId(staffData.venue_id);
      if (staffData.venue_name) {
        setVenue({ id: staffData.venue_id, name: staffData.venue_name });
      }
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  // Fetch staff
  const fetchStaff = useCallback(async (signal) => {
    if (!venueId) return;
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/staff/venue/${venueId}`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        setStaffList(data.data.staff || []);
      }
    } catch (err) {
      console.warn('Failed to fetch staff:', err);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) { const ctrl = new AbortController(); fetchStaff(ctrl.signal); return () => ctrl.abort(); }
  }, [venueId, fetchStaff]);

  // Commander Data Bus — sync staff changes across tabs
  useCommanderSync(venueId, fetchStaff, { entities: ['staff'] });

  async function handleAddStaff(staffData) {
    try {
      const token = getToken();
const res = await commanderFetch('/api/commander/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...staffData, venue_id: venueId })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        fetchStaff();
        broadcastChange('staff');
        busEmit.celebration('confetti');
        setShowAddModal(false);
        // Auto-print QR badge
        const staff = data.data?.staff;
        if (staff?.qr_code) {
          printQRBadge(staff);
        }
        return { success: true };
      }
      return { success: false, error: data.error?.message || 'Failed to add staff' };
    } catch (err) {
      console.warn('Failed to add staff:', err);
      return { success: false, error: 'Network error' };
    }
  }

  function printQRBadge(staff) {
    const qrCode = staff.qr_code || '';
    const name = staff.display_name || 'Staff';
    const role = (staff.role || 'employee').charAt(0).toUpperCase() + (staff.role || 'employee').slice(1);
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`;

    const printWindow = window.open('', '_blank', 'width=400,height=500');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Staff QR Badge — ${name}</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f5f5f5;
          }
          .badge {
            width: 3in;
            padding: 20px;
            background: #fff;
            border: 2px solid #000;
            border-radius: 12px;
            text-align: center;
          }
          .badge-header {
            font-size: 10px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 8px;
          }
          .badge-name {
            font-size: 18px;
            font-weight: 800;
            color: #000;
            margin-bottom: 4px;
          }
          .badge-role {
            font-size: 12px;
            font-weight: 600;
            color: #1877F2;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
          }
          .badge-qr { margin-bottom: 8px; }
          .badge-qr img { width: 160px; height: 160px; }
          .badge-code {
            font-family: monospace;
            font-size: 10px;
            color: #999;
            word-break: break-all;
          }
          @media print {
            body { background: #fff; }
            .badge { border: 2px solid #000; }
          }
        </style>
      </head>
      <body>
        <div class="badge">
          <div class="badge-header">Club Commander</div>
          <div class="badge-name">${name}</div>
          <div class="badge-role">${role}</div>
          <div class="badge-qr">
            <img src="${qrImageUrl}" alt="QR Code" onload="window.print();"  loading="lazy" />
          </div>
          <div class="badge-code">${qrCode}</div>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  async function handleUpdateStaff(staffId, staffData) {
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staffData)
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        fetchStaff();
        broadcastChange('staff');
        setEditingStaff(null);
        return { success: true };
      }
      return { success: false, error: data.error?.message || 'Failed to update staff' };
    } catch (err) {
      console.warn('Failed to update staff:', err);
      return { success: false, error: 'Network error' };
    }
  }

  // Delete staff
  async function handleDeleteStaff(staffId) {
    if (confirmDeleteId !== staffId) {
      setConfirmDeleteId(staffId);
      setTimeout(() => setConfirmDeleteId(null), 4000); // auto-cancel after 4s
      return;
    }
    setConfirmDeleteId(null);
    try {
      const token = getToken();
const data = await commanderFetchJSON(`/api/commander/staff/${staffId}`, {
        method: 'DELETE'});
      if (data.success) {
        fetchStaff();
        broadcastChange('staff');
      }
    } catch (err) {
      console.warn('Failed to delete staff:', err);
      setError('Failed to delete staff member. Please try again.');
    }
  }

  // Check permissions
  const canManageStaff = currentStaff?.permissions?.manage_staff !== false;

  // Filter staff list based on search
  const filteredStaff = staffList.filter(s => {
    if (!debouncedSearchQuery) return true;
    const q = debouncedSearchQuery.toLowerCase();
    const name = (s.profiles?.display_name || s.display_name || 'Staff Member').toLowerCase();
    const roleMatch = (ROLES.find(r => r.value === s.role)?.label || '').toLowerCase().includes(q);
    return name.includes(q) || roleMatch;
  });

  const totalPages = Math.ceil(filteredStaff.length / ITEMS_PER_PAGE);
  const paginatedStaff = filteredStaff.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) setPage(totalPages);
  }, [totalPages, page]);

  // Generate link code for staff member
  async function handleGenerateLinkCode(staffId) {
    setLinkCodeLoading(staffId);
    try {
      const token = getToken();
const res = await commanderFetch('/api/commander/staff/generate-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, staff_id: staffId }) });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        setLinkCodeData({ staffId, token: data.data.token, url: data.data.claim_url });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to generate code' });
      }
    } catch (e) {
      setError('Network error');
    }
    setLinkCodeLoading(null);
  }

  if (!currentStaff || loading) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Staff Management" backHref="/commander/dashboard?card=staff">
      <SEOHead
        title="Commander — Staff Management"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="cmd-page">
        {/* Action Bar */}
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[#B0B3B8]">{venue?.name}</p>
          {canManageStaff && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 cmd-btn cmd-btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Staff
            </button>
          )}
        </div>

        {/* Main Content */}
        <main className="max-w-4xl mx-auto px-4 py-6">
          {!canManageStaff && (
            <div className="mb-6 p-4 bg-[#F59E0B]/10 rounded-xl">
              <p className="text-sm text-[#F59E0B]">
                You don't have permission to manage staff.
              </p>
            </div>
          )}

          {staffList.length === 0 ? (
            <div className="cmd-panel p-8 text-center">
              <User className="w-12 h-12 text-[#3A3B3C] mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-white mb-2">No Staff Yet</h2>
              <p className="text-[#B0B3B8] mb-4">Add Staff Members To Manage Your Venue</p>
              {canManageStaff && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 cmd-btn cmd-btn-primary"
                >
                  Add First Staff Member
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
                <input
                  type="text"
                  placeholder="Search staff by name or role..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cmd-input w-full pl-10 h-10"
                />
              </div>

              <div className="cmd-panel divide-y divide-[#3A3B3C]">
                {paginatedStaff.length === 0 ? (
                  <div className="p-8 text-center text-[#B0B3B8]">No staff matched your search</div>
                ) : (
                  paginatedStaff.map((staff) => {
                    const role = ROLES.find(r => r.value === staff.role) || ROLES[4];
                    return (
                      <div
                        key={staff.id}
                        className="p-4 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-[#3A3B3C] rounded-full flex items-center justify-center">
                            <User className="w-6 h-6 text-[#B0B3B8]" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-white">
                              {staff.profiles?.display_name || staff.display_name || 'Staff Member'}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${role.color}`}>
                                {role.label}
                              </span>
                              {staff.pin_code && (() => {
                                const isAdmin = currentStaff?.role === 'owner' || currentStaff?.role === 'manager';
                                const isSelf = staff.id === currentStaff?.id;
                                const canReveal = isAdmin || isSelf;
                                const isRevealed = revealedPinId === staff.id;
                                return (
                                  <span className="inline-flex items-center gap-1 text-xs text-[#B0B3B8]">
                                    PIN: {isRevealed ? staff.pin_code : '****'}
                                    {canReveal && (
                                      <button
                                        type="button"
                                        onClick={() => setRevealedPinId(isRevealed ? null : staff.id)}
                                        className="p-0.5 hover:text-[#1877F2] transition-colors"
                                        title={isRevealed ? 'Hide PIN' : 'Show PIN'}
                                      >
                                        {isRevealed
                                          ? <EyeOff className="w-3.5 h-3.5" />
                                          : <Eye className="w-3.5 h-3.5" />
                                        }
                                      </button>
                                    )}
                                  </span>
                                );
                              })()}
                            </div>
                            {staff.linked_user_id ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">
                                <CheckCircle className="w-3 h-3" /> Linked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-[#65676B] rounded-full bg-[#3A3B3C]/50">
                                Not linked
                              </span>
                            )}
                          </div>
                        </div>

                        {canManageStaff && staff.id !== currentStaff.id && (
                          <div className="flex gap-2">
                            {!staff.linked_user_id && (
                              linkCodeData?.staffId === staff.id ? (
                                <div className="flex items-center gap-2 px-2 py-1 bg-[#1877F2]/10 rounded-lg border border-[#1877F2]/30">
                                  <span className="text-xs font-mono font-bold text-[#1877F2] tracking-wider">{linkCodeData.token}</span>
                                  <button
                                    onClick={() => { navigator.clipboard.writeText(linkCodeData.url); }}
                                    className="p-1 text-[#1877F2] hover:bg-[#1877F2]/20 rounded transition-colors"
                                    title="Copy claim URL"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleGenerateLinkCode(staff.id)}
                                  disabled={linkCodeLoading === staff.id}
                                  className="p-2 text-[#1877F2] hover:bg-[#1877F2]/10 rounded-lg transition-colors"
                                  title="Generate link code for employee"
                                >
                                  <Link2 className="w-4 h-4" />
                                </button>
                              )
                            )}
                            <button
                              onClick={() => setEditingStaff(staff)}
                              className="p-2 text-[#B0B3B8] hover:bg-[#3A3B3C] rounded-lg transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {confirmDeleteId === staff.id ? (
                              <button
                                onClick={() => handleDeleteStaff(staff.id)}
                                className="px-3 py-1.5 text-xs font-semibold bg-[#EF4444] text-white rounded-lg transition-colors hover:bg-red-600"
                              >
                                Confirm?
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDeleteStaff(staff.id)}
                                className="p-2 text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors"
                                title="Remove staff member"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <Pagination
                className="mt-6"
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </main>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingStaff) && (
        <StaffModal
          staff={editingStaff}
          existingStaff={staffList}
          onClose={() => {
            setShowAddModal(false);
            setEditingStaff(null);
          }}
          onSubmit={async (data) => {
            if (editingStaff) {
              return handleUpdateStaff(editingStaff.id, data);
            } else {
              return handleAddStaff(data);
            }
          }}
        />
      )}
      <style>{`
`}</style>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
  );
}

function StaffModal({ staff, existingStaff = [], onClose, onSubmit }) {
  const [displayName, setDisplayName] = useState(staff?.display_name || staff?.profiles?.display_name || '');
  const [email, setEmail] = useState(staff?.email || '');
  const [phone, setPhone] = useState(staff?.phone || '');
  const [role, setRole] = useState(staff?.role || 'floor');
  const [pinCode, setPinCode] = useState(staff?.pin_code || '');
  const [isActive, setIsActive] = useState(staff?.is_active !== false);
  const [idType, setIdType] = useState(staff?.id_type || 'drivers_license');
  const [idNumber, setIdNumber] = useState(staff?.id_number || '');
  const [idState, setIdState] = useState(staff?.id_state || '');
  const [idExpiry, setIdExpiry] = useState(staff?.id_expiry || '');
  const [dateOfBirth, setDateOfBirth] = useState(staff?.date_of_birth || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const isEditing = !!staff;

  // Real-time duplicate PIN check
  const isDuplicatePin = pinCode.length === 4 && existingStaff.some(s => s.id !== staff?.id && s.pin_code === pinCode);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!isEditing && !displayName.trim()) {
      setError('Employee name is required');
      return;
    }
    if (!pinCode || pinCode.length !== 4) {
      setError('A 4-digit PIN is required for all employees');
      return;
    }
    if (isDuplicatePin) {
      setError('This PIN is already in use by another employee. Please choose a different PIN.');
      return;
    }
    setSubmitting(true);
    const result = await onSubmit({
      display_name: displayName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      role,
      pin_code: pinCode || null,
      is_active: isActive,
      id_type: idType || null,
      id_number: idNumber.trim() || null,
      id_state: idState || null,
      id_expiry: idExpiry || null,
      date_of_birth: dateOfBirth || null });
    if (result && !result.success) {
      setError(result.error || 'Failed to save');
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Staff' : 'Add Employee'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3A3B3C] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-sm text-[#EF4444]">{error}</div>
          )}

          {/* Employee Name */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Employee Name *
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., John Smith"
              className="w-full h-12 px-3 cmd-input"
              required
              autoFocus={!isEditing}
            />
          </div>

          {/* Email (optional) */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Email <span className="text-[#6A6B6D]">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full h-12 px-3 cmd-input"
            />
          </div>

          {/* Phone (optional) */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Phone <span className="text-[#6A6B6D]">(optional)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full h-12 px-3 cmd-input"
            />
          </div>

          {/* Government ID */}
          <div className="border border-[#3A3B3C] rounded-lg p-3 space-y-3">
            <p className="text-sm font-medium text-[#B0B3B8] flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Government ID
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#B0B3B8] mb-1">ID Type</label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="w-full h-10 px-2 cmd-input text-sm"
                >
                  {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#B0B3B8] mb-1">ID Number</label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="DL12345678"
                  className="w-full h-10 px-2 cmd-input text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#B0B3B8] mb-1">State</label>
                <select
                  value={idState}
                  onChange={(e) => setIdState(e.target.value)}
                  className="w-full h-10 px-2 cmd-input text-sm"
                >
                  <option value="">--</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#B0B3B8] mb-1">ID Expiry</label>
                <input
                  type="date"
                  value={idExpiry}
                  onChange={(e) => setIdExpiry(e.target.value)}
                  className="w-full h-10 px-2 cmd-input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#B0B3B8] mb-1">DOB</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full h-10 px-2 cmd-input text-sm"
                />
              </div>
            </div>
          </div>

          {/* QR Code (show when editing) */}
          {isEditing && staff?.qr_code && (
            <div className="flex items-center gap-3 p-3 bg-[#18191A] rounded-lg">
              <QrCode className="w-5 h-5 text-[#10B981]" />
              <div>
                <p className="text-xs text-[#B0B3B8]">Staff QR Code</p>
                <p className="text-sm text-white font-mono">{staff.qr_code}</p>
              </div>
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`p-3 rounded-lg text-sm font-medium transition-colors ${role === r.value
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-[#3A3B3C] text-white hover:bg-[#4A4B4C]'
                    }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* PIN Code */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              4-Digit PIN <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={pinCode}
              onChange={(e) => { setPinCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              required
              className="w-full h-12 px-3 cmd-input text-center text-2xl tracking-[0.5em] font-mono"
            />
            {isDuplicatePin && (
              <div className="flex items-center gap-1.5 mt-1.5 p-2 rounded-lg bg-[#EF4444]/10">
                <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0" />
                <span className="text-xs text-[#EF4444] font-medium">This PIN is already in use by another employee</span>
              </div>
            )}
            {!isDuplicatePin && pinCode.length === 4 && (
              <p className="text-xs text-[#31A24C] mt-1">✓ PIN available</p>
            )}
            {pinCode.length > 0 && pinCode.length < 4 && (
              <p className="text-xs text-[#B0B3B8] mt-1">Enter {4 - pinCode.length} more digit{4 - pinCode.length > 1 ? 's' : ''}</p>
            )}
            <p className="text-xs text-[#F59E0B] mt-1">🔒 Required for all financial transactions</p>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-3 bg-[#3A3B3C] rounded-lg">
            <span className="font-medium text-white">Active</span>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`w-12 h-7 rounded-full transition-colors relative ${isActive ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'
                }`}
            >
              <span
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'right-1' : 'left-1'
                  }`}
              />
            </button>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 cmd-btn cmd-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 h-12 cmd-btn cmd-btn-primary disabled:opacity-50"
            >
              {submitting ? 'Saving...' : staff ? 'Update' : 'Add Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
