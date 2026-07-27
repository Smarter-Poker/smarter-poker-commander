/**
 * Member Detail Panel — Full member profile view with PIN-protected edit
 * NO EMOJIS (per /no-emoji-commander)
 * 
 * Features:
 * - Full profile display (name, email, phone, address, DOB, ID)
 * - Expanded edit form with all fields
 * - PIN-protected save (floor, manager, dualrate, owner)
 * - Audit trail: last_edited_by + last_edited_at
 * - Bottom section: Club Status, Available Time, Comps Available
 */
import { useState, useRef } from 'react';
import {
    X, User, Mail, Phone, MapPin, Calendar, CreditCard,
    Clock, FileText, Edit2, Shield, Printer,
    DollarSign, AlertTriangle, Lock
} from 'lucide-react';
import MemberCard from './MemberCard';

const TIER_COLORS = { daily: '#3B82F6', weekly: '#F59E0B', monthly: '#10B981', yearly: '#A855F7' };
const TIER_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const STATUS_COLORS = { active: '#31A24C', suspended: '#EF4444', expired: '#8A8D91', banned: '#DC2626' };

const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

export default function MemberDetailPanel({ member, venueName, onClose, onUpdate }) {
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [showCard, setShowCard] = useState(false);

    // PIN verification
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinValue, setPinValue] = useState('');
    const [pinError, setPinError] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const pinInputRef = useRef(null);

    if (!member) return null;

    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(member.qr_code)}&bgcolor=ffffff&color=000000`;

    const startEdit = () => {
        const addr = member.address || {};
        setEditForm({
            first_name: member.first_name || '',
            last_name: member.last_name || '',
            email: member.email || '',
            phone: member.phone || '',
            date_of_birth: member.date_of_birth || '',
            id_type: member.id_type || 'drivers_license',
            id_number: member.id_number || '',
            id_state: member.id_state || '',
            id_expiry: member.id_expiry || '',
            address_street: addr.street || '',
            address_city: addr.city || '',
            address_state: addr.state || '',
            address_zip: addr.zip || '',
            membership_tier: member.membership_tier || 'daily',
            membership_status: member.membership_status || 'active',
            notes: member.notes || '',
        });
        setEditing(true);
    };

    // Trigger save flow — show PIN modal
    const requestSave = () => {
        setPinValue('');
        setPinError('');
        setShowPinModal(true);
        setTimeout(() => pinInputRef.current?.focus(), 100);
    };

    // Verify PIN and save
    const verifyPinAndSave = async () => {
        if (!pinValue || pinValue.length < 4) {
            setPinError('Enter your PIN');
            return;
        }
        setPinLoading(true);
        setPinError('');

        try {
            // Get venue_id from staff session
            const staffData = JSON.parse(localStorage.getItem('commander_staff') || '{}');
            const venueId = staffData.venue_id;

            const pinRes = await fetch('/api/commander/staff/verify-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ venue_id: venueId, pin_code: pinValue }),
            });
            if (!pinRes.ok) throw new Error('Request failed');
            const pinJson = await pinRes.json();

            if (!pinJson.success || !pinJson.data?.valid) {
                setPinError('Invalid PIN');
                setPinLoading(false);
                return;
            }

            // Check role — only floor, manager, dualrate, owner allowed
            const staffRole = pinJson.data.staff?.role;
            const allowedRoles = ['floor', 'manager', 'dualrate', 'owner'];
            if (!allowedRoles.includes(staffRole)) {
                setPinError('Insufficient permissions — floor manager or above required');
                setPinLoading(false);
                return;
            }

            const editorName = pinJson.data.staff?.display_name || 'Staff';
            const editorStaffId = pinJson.data.staff?.id;

            // Build update payload
            const payload = { ...editForm };
            // Restructure address into JSON object
            payload.address = {
                street: editForm.address_street || '',
                city: editForm.address_city || '',
                state: editForm.address_state || '',
                zip: editForm.address_zip || '',
            };
            delete payload.address_street;
            delete payload.address_city;
            delete payload.address_state;
            delete payload.address_zip;

            // Audit trail
            payload.last_edited_by = editorName;
            payload.last_edited_by_staff_id = editorStaffId;
            payload.last_edited_at = new Date().toISOString();

            const res = await fetch(`/api/commander/members/${member.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-staff-session': localStorage.getItem('commander_staff') || '',
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('Request failed');
            const data = await res.json();
            if (data.success && onUpdate) onUpdate(data.data.member);
            setEditing(false);
            setShowPinModal(false);
        } catch (err) {
            console.warn('Update error:', err);
            setPinError('Network error — try again');
        } finally {
            setPinLoading(false);
        }
    };

    const formatTime = (minutes) => {
        if (!minutes && minutes !== 0) return '--';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const formatCurrency = (amount) => {
        if (!amount && amount !== 0) return '$0.00';
        return `$${Number(amount).toFixed(2)}`;
    };

    const addr = member.address || {};
    const fullAddress = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');

    // Input field component for edit form
    const Field = ({ label, children }) => (
        <div>
            <label className="block text-xs text-[#B0B3B8] mb-1 font-medium">{label}</label>
            {children}
        </div>
    );

    const inputClass = "w-full px-3 py-2 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none";
    const selectClass = inputClass;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />
            <div className="relative bg-[#242526] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#3A3B3C] shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-[#242526] border-b border-[#3A3B3C] p-4 flex items-center justify-between z-10">
                    <h2 className="text-lg font-bold text-[#E4E6EB]">Member Profile</h2>
                    <div className="flex items-center gap-2">
                        {!editing && <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3A3B3C] hover:bg-[#4E4F50] rounded-lg text-sm text-[#B0B3B8] transition-colors"><Edit2 className="w-3.5 h-3.5" /> Edit</button>}
                        <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    {/* Profile Header */}
                    <div className="text-center">
                        <div className="w-20 h-20 bg-[#3A3B3C] rounded-full flex items-center justify-center mx-auto mb-3 overflow-hidden">
                            {member.photo_url ? <img src={member.photo_url} alt="" className="w-20 h-20 rounded-full object-cover" /> : <User className="w-10 h-10 text-[#B0B3B8]" />}
                        </div>
                        <h3 className="text-xl font-bold text-[#E4E6EB]">{member.first_name} {member.last_name}</h3>
                        <p className="text-sm font-mono text-[#1877F2]">{member.member_number}</p>
                        <div className="flex items-center justify-center gap-2 mt-2">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: (TIER_COLORS[member.membership_tier] || '#B0B3B8') + '20', color: TIER_COLORS[member.membership_tier] || '#B0B3B8' }}>{(TIER_LABELS[member.membership_tier] || member.membership_tier || '—').toUpperCase()}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: (STATUS_COLORS[member.membership_status] || '#8A8D91') + '20', color: STATUS_COLORS[member.membership_status] }}>{member.membership_status?.toUpperCase()}</span>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-[#18191A] rounded-lg p-3 text-center">
                            <div className="text-lg font-bold text-[#E4E6EB]">{member.total_visits || 0}</div>
                            <div className="text-xs text-[#8A8D91]">Visits</div>
                        </div>
                        <div className="bg-[#18191A] rounded-lg p-3 text-center">
                            <div className="text-lg font-bold text-[#E4E6EB]">{Number(member.total_hours_played || 0).toFixed(0)}h</div>
                            <div className="text-xs text-[#8A8D91]">Hours</div>
                        </div>
                        <div className="bg-[#18191A] rounded-lg p-3 text-center">
                            <div className="text-lg font-bold text-[#E4E6EB]">{member.last_visit ? new Date(member.last_visit).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}</div>
                            <div className="text-xs text-[#8A8D91]">Last Visit</div>
                        </div>
                    </div>

                    {/* Edit Mode */}
                    {editing ? (
                        <div className="space-y-4">
                            {/* Personal Info Section */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">Personal Information</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="First Name">
                                        <input type="text" value={editForm.first_name} onChange={e => setEditForm(p => ({ ...p, first_name: e.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="Last Name">
                                        <input type="text" value={editForm.last_name} onChange={e => setEditForm(p => ({ ...p, last_name: e.target.value }))} className={inputClass} />
                                    </Field>
                                </div>
                                <Field label="Date of Birth">
                                    <input type="date" value={editForm.date_of_birth} onChange={e => setEditForm(p => ({ ...p, date_of_birth: e.target.value }))} className={inputClass} />
                                </Field>
                            </div>

                            {/* Contact Section */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">Contact</h4>
                                <Field label="Email">
                                    <input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className={inputClass} placeholder="email@example.com" />
                                </Field>
                                <Field label="Phone">
                                    <input type="tel" value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} className={inputClass} placeholder="(555) 555-5555" />
                                </Field>
                            </div>

                            {/* Address Section */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">Address</h4>
                                <Field label="Street">
                                    <input type="text" value={editForm.address_street} onChange={e => setEditForm(p => ({ ...p, address_street: e.target.value }))} className={inputClass} placeholder="123 Main St" />
                                </Field>
                                <div className="grid grid-cols-6 gap-3">
                                    <div className="col-span-3">
                                        <Field label="City">
                                            <input type="text" value={editForm.address_city} onChange={e => setEditForm(p => ({ ...p, address_city: e.target.value }))} className={inputClass} />
                                        </Field>
                                    </div>
                                    <div className="col-span-1">
                                        <Field label="State">
                                            <select value={editForm.address_state} onChange={e => setEditForm(p => ({ ...p, address_state: e.target.value }))} className={selectClass}>
                                                <option value="">--</option>
                                                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </Field>
                                    </div>
                                    <div className="col-span-2">
                                        <Field label="ZIP">
                                            <input type="text" value={editForm.address_zip} onChange={e => setEditForm(p => ({ ...p, address_zip: e.target.value }))} className={inputClass} placeholder="75001" />
                                        </Field>
                                    </div>
                                </div>
                            </div>

                            {/* ID Section */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">ID Information</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="ID Type">
                                        <select value={editForm.id_type} onChange={e => setEditForm(p => ({ ...p, id_type: e.target.value }))} className={selectClass}>
                                            <option value="drivers_license">Driver's License</option>
                                            <option value="state_id">State ID</option>
                                            <option value="passport">Passport</option>
                                            <option value="military_id">Military ID</option>
                                        </select>
                                    </Field>
                                    <Field label="ID Number">
                                        <input type="text" value={editForm.id_number} onChange={e => setEditForm(p => ({ ...p, id_number: e.target.value }))} className={inputClass} />
                                    </Field>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Issuing State">
                                        <select value={editForm.id_state} onChange={e => setEditForm(p => ({ ...p, id_state: e.target.value }))} className={selectClass}>
                                            <option value="">--</option>
                                            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Expiry">
                                        <input type="date" value={editForm.id_expiry} onChange={e => setEditForm(p => ({ ...p, id_expiry: e.target.value }))} className={inputClass} />
                                    </Field>
                                </div>
                            </div>

                            {/* Membership Section */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">Membership</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Tier">
                                        <select value={editForm.membership_tier} onChange={e => setEditForm(p => ({ ...p, membership_tier: e.target.value }))} className={selectClass}>
                                            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                                        </select>
                                    </Field>
                                    <Field label="Status">
                                        <select value={editForm.membership_status} onChange={e => setEditForm(p => ({ ...p, membership_status: e.target.value }))} className={selectClass}>
                                            <option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="banned">Banned</option>
                                        </select>
                                    </Field>
                                </div>
                            </div>

                            {/* Notes */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider">Notes</h4>
                                <textarea value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className={inputClass + " resize-none"} rows={3} placeholder="Internal notes about this member..." />
                            </div>

                            {/* Save / Cancel */}
                            <div className="flex gap-2">
                                <button onClick={() => setEditing(false)} className="flex-1 py-2.5 bg-[#3A3B3C] text-[#B0B3B8] rounded-lg text-sm font-medium hover:bg-[#4E4F50] transition-colors">Cancel</button>
                                <button onClick={requestSave} disabled={saving} className="flex-1 py-2.5 bg-[#1877F2] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#1664d9] transition-colors">
                                    <Lock className="w-3.5 h-3.5" /> Save with PIN
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Contact Info */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-2.5 text-sm">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider mb-2">Contact Information</h4>
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><Mail className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">{member.email || 'No email on file'}</span></div>
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><Phone className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">{member.phone || 'No phone on file'}</span></div>
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><MapPin className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">{fullAddress || 'No address on file'}</span></div>
                            </div>

                            {/* Personal Info */}
                            <div className="bg-[#18191A] rounded-xl p-4 space-y-2.5 text-sm">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider mb-2">Personal Details</h4>
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><Calendar className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">{member.date_of_birth ? new Date(member.date_of_birth + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'No DOB on file'}</span></div>
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><CreditCard className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">{member.id_number ? `${(member.id_type || 'ID').replace('_', ' ')} - ${member.id_number}${member.id_state ? ` (${member.id_state})` : ''}` : 'No ID on file'}</span></div>
                                {member.notes && <div className="flex items-start gap-3 text-[#B0B3B8]"><FileText className="w-4 h-4 flex-shrink-0 mt-0.5" /><span className="text-[#E4E6EB]">{member.notes}</span></div>}
                                <div className="flex items-center gap-3 text-[#B0B3B8]"><Clock className="w-4 h-4 flex-shrink-0" /><span className="text-[#E4E6EB]">Joined {new Date(member.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
                            </div>

                            {/* ── BOTTOM SECTION: Club Status, Time, Comps ── */}
                            <div className="bg-[#18191A] rounded-xl p-4">
                                <h4 className="text-xs font-bold text-[#8A8D91] uppercase tracking-wider mb-3">Account Status</h4>
                                <div className="grid grid-cols-3 gap-2">
                                    {/* Club Status */}
                                    <button
                                        onClick={() => window.location.href = `/commander/cashier?action=membership&member=${encodeURIComponent((member.first_name + ' ' + member.last_name).trim())}&member_id=${member.id}`}
                                        className="bg-[#242526] rounded-lg p-3 text-center border border-[#3A3B3C] hover:bg-[#3A3B3C]/50 transition-colors cursor-pointer block w-full"
                                    >
                                        <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center"
                                            style={{ backgroundColor: (STATUS_COLORS[member.membership_status] || '#8A8D91') + '20' }}>
                                            <Shield className="w-4 h-4" style={{ color: STATUS_COLORS[member.membership_status] || '#8A8D91' }} />
                                        </div>
                                        <div className="text-sm font-bold capitalize" style={{ color: STATUS_COLORS[member.membership_status] || '#8A8D91' }}>
                                            {member.membership_status || 'Unknown'}
                                        </div>
                                        <div className={`text-[10px] mt-0.5 ${member.membership_expires && new Date(member.membership_expires) < new Date() ? 'text-[#EF4444] font-bold' : 'text-[#8A8D91]'}`}>
                                            {member.membership_expires ? `Expires ${new Date(member.membership_expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Club Status'}
                                        </div>
                                    </button>

                                    {/* Available Time */}
                                    <button
                                        onClick={() => window.location.href = `/commander/cashier?action=addtime&member=${encodeURIComponent((member.first_name + ' ' + member.last_name).trim())}&member_id=${member.id}`}
                                        className="bg-[#242526] rounded-lg p-3 text-center border border-[#3A3B3C] hover:bg-[#3A3B3C]/50 transition-colors cursor-pointer block w-full"
                                    >
                                        <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center bg-[#3B82F6]/20">
                                            <Clock className="w-4 h-4 text-[#3B82F6]" />
                                        </div>
                                        <div className="text-sm font-bold text-[#3B82F6]">
                                            {formatTime(member.time_balance_minutes)}
                                        </div>
                                        <div className="text-[10px] text-[#8A8D91] mt-0.5">Available Time</div>
                                    </button>

                                    {/* Comps Available */}
                                    <button
                                        onClick={() => window.location.href = `/commander/comps?member=${encodeURIComponent((member.first_name + ' ' + member.last_name).trim())}&member_id=${member.id}`}
                                        className="bg-[#242526] rounded-lg p-3 text-center border border-[#3A3B3C] hover:bg-[#3A3B3C]/50 transition-colors cursor-pointer block w-full"
                                    >
                                        <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center bg-[#10B981]/20">
                                            <DollarSign className="w-4 h-4 text-[#10B981]" />
                                        </div>
                                        <div className="text-sm font-bold text-[#10B981]">
                                            {formatCurrency(member.comp_balance)}
                                        </div>
                                        <div className="text-[10px] text-[#8A8D91] mt-0.5">Comps Available</div>
                                    </button>
                                </div>
                            </div>

                            {/* Audit Trail */}
                            {member.last_edited_by && (
                                <div className="text-xs text-[#8A8D91] text-center px-4">
                                    Last edited by <span className="text-[#B0B3B8] font-medium">{member.last_edited_by}</span>
                                    {member.last_edited_at && <> on {new Date(member.last_edited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(member.last_edited_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</>}
                                </div>
                            )}

                            {/* Card Preview */}
                            {showCard ? (
                                <div className="flex flex-col items-center">
                                    <MemberCard member={member} venueName={venueName} qrCodeUrl={qrCodeUrl} />
                                    <button onClick={() => setShowCard(false)} className="mt-2 text-sm text-[#B0B3B8]">Hide Card</button>
                                </div>
                            ) : (
                                <button onClick={() => setShowCard(true)} className="w-full py-2.5 bg-[#3A3B3C] text-[#E4E6EB] rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#4E4F50] transition-colors">
                                    <Printer className="w-4 h-4" /> Show / Print Card
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* PIN Verification Modal */}
            {showPinModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setShowPinModal(false)} />
                    <div className="relative bg-[#242526] rounded-xl w-full max-w-xs p-6 border border-[#3A3B3C] shadow-2xl text-center">
                        <div className="w-14 h-14 bg-[#1877F2]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock className="w-7 h-7 text-[#1877F2]" />
                        </div>
                        <h3 className="text-lg font-bold text-[#E4E6EB] mb-1">Manager PIN Required</h3>
                        <p className="text-xs text-[#8A8D91] mb-4">Floor manager or above to save changes</p>

                        <input
                            ref={pinInputRef}
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            value={pinValue}
                            onChange={e => { setPinValue(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') verifyPinAndSave(); }}
                            placeholder="Enter PIN"
                            className="w-full px-4 py-3 bg-[#18191A] border-2 border-[#3A3B3C] rounded-xl text-center text-2xl font-mono text-[#E4E6EB] tracking-[0.5em] focus:border-[#1877F2] focus:outline-none mb-3"
                        />

                        {pinError && (
                            <div className="flex items-center justify-center gap-1.5 text-xs text-[#EF4444] mb-3">
                                <AlertTriangle className="w-3.5 h-3.5" /> {pinError}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button onClick={() => setShowPinModal(false)} className="flex-1 py-2.5 bg-[#3A3B3C] text-[#B0B3B8] rounded-lg text-sm font-medium">Cancel</button>
                            <button onClick={verifyPinAndSave} disabled={pinLoading} className="flex-1 py-2.5 bg-[#1877F2] text-white rounded-lg text-sm font-medium">
                                {pinLoading ? 'Verifying...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
