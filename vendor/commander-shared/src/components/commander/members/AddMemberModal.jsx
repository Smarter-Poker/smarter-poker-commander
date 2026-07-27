/**
 * Add Member Modal — Multi-step registration flow
 * Step 1: ID Scan / Manual Entry (name, DOB, ID info)
 * Step 2: Contact & Address
 * Step 3: Membership tier selection
 * Step 4: Review & Confirm
 * 
 * NO EMOJIS — Lucide icons only (per /no-emoji-commander)
 */
import { useState, useRef, useCallback } from 'react';
import {
    X, Camera, User, CreditCard, MapPin, Phone, Mail, Calendar,
    FileText, Shield, ChevronRight, ChevronLeft, Check, AlertCircle, Loader2
} from 'lucide-react';

const ID_TYPES = [
    { value: 'drivers_license', label: "Driver's License" },
    { value: 'state_id', label: 'State ID' },
    { value: 'passport', label: 'Passport' },
    { value: 'military_id', label: 'Military ID' },
    { value: 'tribal_id', label: 'Tribal ID' },
];

const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

const TIERS = [
    { value: 'daily', label: 'Daily', desc: 'Single-day access pass', color: '#3B82F6' },
    { value: 'weekly', label: 'Weekly', desc: '7-day membership', color: '#F59E0B' },
    { value: 'monthly', label: 'Monthly', desc: '30-day membership', color: '#10B981' },
    { value: 'yearly', label: 'Yearly', desc: 'Full year membership', color: '#A855F7' },
];

export default function AddMemberModal({ isOpen, onClose, onSubmit, venueId }) {
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [showCamera, setShowCamera] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    const [form, setForm] = useState({
        first_name: '',
        last_name: '',
        date_of_birth: '',
        id_type: 'drivers_license',
        id_number: '',
        id_state: '',
        id_expiry: '',
        email: '',
        phone: '',
        address_street: '',
        address_city: '',
        address_state: '',
        address_zip: '',
        membership_tier: 'daily',
        notes: '',
        photo_url: '',
    });

    const updateForm = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
        setError('');
    };

    // Camera for ID scanning / photo capture
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setShowCamera(true);
        } catch (err) {
            console.warn('Camera error:', err);
            setError('Camera access denied. Please enter information manually.');
        }
    }, []);

    const capturePhoto = useCallback(() => {
        if (!videoRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        updateForm('photo_url', dataUrl);
        stopCamera();
    }, []);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
    }, []);

    const validateStep = (s) => {
        if (s === 1) {
            if (!form.first_name.trim() || !form.last_name.trim()) {
                setError('First and last name are required');
                return false;
            }
        }
        return true;
    };

    const nextStep = () => {
        if (validateStep(step)) {
            setStep(prev => Math.min(prev + 1, 4));
            setError('');
        }
    };

    const prevStep = () => {
        setStep(prev => Math.max(prev - 1, 1));
        setError('');
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        setError('');

        try {
            const res = await fetch('/api/commander/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    venue_id: venueId,
                    first_name: form.first_name.trim(),
                    last_name: form.last_name.trim(),
                    date_of_birth: form.date_of_birth || null,
                    id_type: form.id_type,
                    id_number: form.id_number.trim() || null,
                    id_state: form.id_state || null,
                    id_expiry: form.id_expiry || null,
                    email: form.email.trim() || null,
                    phone: form.phone.trim() || null,
                    photo_url: form.photo_url || null,
                    address: {
                        street: form.address_street.trim(),
                        city: form.address_city.trim(),
                        state: form.address_state,
                        zip: form.address_zip.trim(),
                    },
                    membership_tier: form.membership_tier,
                    notes: form.notes.trim() || null,
                }),
            });
            if (!res.ok) throw new Error('Request failed');

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to create member');
            }

            onSubmit(data.data.member);
            handleClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        stopCamera();
        setStep(1);
        setForm({
            first_name: '', last_name: '', date_of_birth: '', id_type: 'drivers_license',
            id_number: '', id_state: '', id_expiry: '', email: '', phone: '',
            address_street: '', address_city: '', address_state: '', address_zip: '',
            membership_tier: 'daily', notes: '', photo_url: '',
        });
        setError('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

            <div className="relative bg-[#242526] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#3A3B3C] shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-[#242526] border-b border-[#3A3B3C] p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-[#E4E6EB]">New Club Member</h2>
                            <p className="text-xs text-[#B0B3B8]">Step {step} of 4</p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
                        <X className="w-5 h-5 text-[#B0B3B8]" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="px-4 pt-3">
                    <div className="flex gap-1">
                        {[1, 2, 3, 4].map(s => (
                            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'
                                }`} />
                        ))}
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-4 mt-3 p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                        <p className="text-sm text-[#EF4444]">{error}</p>
                    </div>
                )}

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Step 1: ID & Personal Info */}
                    {step === 1 && (
                        <>
                            <p className="text-sm text-[#B0B3B8] font-medium">Identification</p>

                            {/* Camera / Photo Section */}
                            <div className="bg-[#18191A] rounded-lg p-4">
                                {showCamera ? (
                                    <div className="space-y-3">
                                        <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg bg-black" />
                                        <div className="flex gap-2">
                                            <button onClick={capturePhoto} className="flex-1 py-2 bg-[#1877F2] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                                                <Camera className="w-4 h-4" /> Capture Photo
                                            </button>
                                            <button onClick={stopCamera} className="px-4 py-2 bg-[#3A3B3C] text-[#B0B3B8] rounded-lg text-sm">
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : form.photo_url ? (
                                    <div className="text-center space-y-2">
                                        <img src={form.photo_url} alt="ID Photo" className="w-48 h-32 object-cover rounded-lg mx-auto" />
                                        <button onClick={() => updateForm('photo_url', '')} className="text-xs text-[#1877F2]">Remove Photo</button>
                                    </div>
                                ) : (
                                    <button onClick={startCamera} className="w-full py-6 border-2 border-dashed border-[#3A3B3C] rounded-lg flex flex-col items-center gap-2 hover:border-[#1877F2] transition-colors">
                                        <Camera className="w-8 h-8 text-[#B0B3B8]" />
                                        <span className="text-sm text-[#B0B3B8]">Scan ID Or Take Photo</span>
                                        <span className="text-xs text-[#8A8D91]">Optional - Position ID In Front Of Camera</span>
                                    </button>
                                )}
                            </div>

                            {/* Name Fields */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">First Name *</label>
                                    <input type="text" value={form.first_name} onChange={e => updateForm('first_name', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                        placeholder="John" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">Last Name *</label>
                                    <input type="text" value={form.last_name} onChange={e => updateForm('last_name', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                        placeholder="Smith" />
                                </div>
                            </div>

                            {/* DOB */}
                            <div>
                                <label className="block text-xs text-[#B0B3B8] mb-1 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Date of Birth
                                </label>
                                <input type="date" value={form.date_of_birth} onChange={e => updateForm('date_of_birth', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none" />
                            </div>

                            {/* ID Info */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1 flex items-center gap-1">
                                        <CreditCard className="w-3 h-3" /> ID Type
                                    </label>
                                    <select value={form.id_type} onChange={e => updateForm('id_type', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none">
                                        {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">ID Number</label>
                                    <input type="text" value={form.id_number} onChange={e => updateForm('id_number', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                        placeholder="DL12345678" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">Issuing State</label>
                                    <select value={form.id_state} onChange={e => updateForm('id_state', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none">
                                        <option value="">Select...</option>
                                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">ID Expiry</label>
                                    <input type="date" value={form.id_expiry} onChange={e => updateForm('id_expiry', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none" />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Step 2: Contact & Address */}
                    {step === 2 && (
                        <>
                            <p className="text-sm text-[#B0B3B8] font-medium">Contact Information</p>

                            <div>
                                <label className="block text-xs text-[#B0B3B8] mb-1 flex items-center gap-1">
                                    <Mail className="w-3 h-3" /> Email
                                </label>
                                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                    placeholder="john@example.com" />
                            </div>

                            <div>
                                <label className="block text-xs text-[#B0B3B8] mb-1 flex items-center gap-1">
                                    <Phone className="w-3 h-3" /> Phone
                                </label>
                                <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                    placeholder="(555) 123-4567" />
                            </div>

                            <p className="text-sm text-[#B0B3B8] font-medium mt-4 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Address
                            </p>

                            <div>
                                <label className="block text-xs text-[#B0B3B8] mb-1">Street</label>
                                <input type="text" value={form.address_street} onChange={e => updateForm('address_street', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                    placeholder="123 Main St" />
                            </div>

                            <div className="grid grid-cols-4 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#B0B3B8] mb-1">City</label>
                                    <input type="text" value={form.address_city} onChange={e => updateForm('address_city', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                        placeholder="City" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">State</label>
                                    <select value={form.address_state} onChange={e => updateForm('address_state', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none">
                                        <option value="">--</option>
                                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] mb-1">ZIP</label>
                                    <input type="text" value={form.address_zip} onChange={e => updateForm('address_zip', e.target.value)}
                                        className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                                        placeholder="40202" maxLength={10} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-[#B0B3B8] mb-1 flex items-center gap-1">
                                    <FileText className="w-3 h-3" /> Notes
                                </label>
                                <textarea value={form.notes} onChange={e => updateForm('notes', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none resize-none"
                                    rows={2} placeholder="Optional Notes About This Member..." />
                            </div>
                        </>
                    )}

                    {/* Step 3: Membership Tier */}
                    {step === 3 && (
                        <>
                            <p className="text-sm text-[#B0B3B8] font-medium flex items-center gap-1">
                                <Shield className="w-3 h-3" /> Select Membership Tier
                            </p>

                            <div className="space-y-3">
                                {TIERS.map(tier => (
                                    <button key={tier.value} onClick={() => updateForm('membership_tier', tier.value)}
                                        className={`w-full p-4 rounded-xl border-2 text-left transition-all ${form.membership_tier === tier.value
                                            ? 'border-[#1877F2] bg-[#1877F2]/5'
                                            : 'border-[#3A3B3C] bg-[#18191A] hover:border-[#4E4F50]'
                                            }`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${form.membership_tier === tier.value ? 'border-[#1877F2] bg-[#1877F2]' : 'border-[#8A8D91]'
                                                    }`}>
                                                    {form.membership_tier === tier.value && <Check className="w-3 h-3 text-white" />}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-[#E4E6EB]">{tier.label}</div>
                                                    <div className="text-xs text-[#B0B3B8]">{tier.desc}</div>
                                                </div>
                                            </div>
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tier.color }} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {/* Step 4: Review & Confirm */}
                    {step === 4 && (
                        <>
                            <p className="text-sm text-[#B0B3B8] font-medium">Review Member Information</p>

                            <div className="bg-[#18191A] rounded-xl p-4 space-y-3">
                                {/* Photo */}
                                {form.photo_url && (
                                    <div className="text-center">
                                        <img src={form.photo_url} alt="Member" className="w-24 h-24 object-cover rounded-full mx-auto border-2 border-[#3A3B3C]" />
                                    </div>
                                )}

                                {/* Name */}
                                <div className="text-center">
                                    <h3 className="text-xl font-bold text-[#E4E6EB]">{form.first_name} {form.last_name}</h3>
                                    <span className="inline-block mt-1 px-3 py-1 rounded-full text-xs font-medium"
                                        style={{
                                            backgroundColor: TIERS.find(t => t.value === form.membership_tier)?.color + '20',
                                            color: TIERS.find(t => t.value === form.membership_tier)?.color
                                        }}>
                                        {TIERS.find(t => t.value === form.membership_tier)?.label} Member
                                    </span>
                                </div>

                                {/* Details Grid */}
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    {form.date_of_birth && (
                                        <div><span className="text-[#8A8D91]">DOB:</span> <span className="text-[#E4E6EB]">{form.date_of_birth}</span></div>
                                    )}
                                    {form.id_number && (
                                        <div><span className="text-[#8A8D91]">ID:</span> <span className="text-[#E4E6EB]">{form.id_number}</span></div>
                                    )}
                                    {form.email && (
                                        <div><span className="text-[#8A8D91]">Email:</span> <span className="text-[#E4E6EB]">{form.email}</span></div>
                                    )}
                                    {form.phone && (
                                        <div><span className="text-[#8A8D91]">Phone:</span> <span className="text-[#E4E6EB]">{form.phone}</span></div>
                                    )}
                                    {form.address_city && (
                                        <div className="col-span-2"><span className="text-[#8A8D91]">Address:</span> <span className="text-[#E4E6EB]">{form.address_street}{form.address_street && ', '}{form.address_city}, {form.address_state} {form.address_zip}</span></div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer / Navigation */}
                <div className="sticky bottom-0 bg-[#242526] border-t border-[#3A3B3C] p-4 flex items-center justify-between">
                    {step > 1 ? (
                        <button onClick={prevStep} className="flex items-center gap-1 px-4 py-2.5 text-[#B0B3B8] hover:bg-[#3A3B3C] rounded-lg text-sm font-medium">
                            <ChevronLeft className="w-4 h-4" /> Back
                        </button>
                    ) : (
                        <div />
                    )}

                    {step < 4 ? (
                        <button onClick={nextStep} className="flex items-center gap-1 px-6 py-2.5 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg text-sm font-medium">
                            Next <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button onClick={handleSubmit} disabled={submitting}
                            className="flex items-center gap-2 px-6 py-2.5 bg-[#31A24C] hover:bg-[#2b8f43] disabled:bg-[#3A3B3C] text-white rounded-lg text-sm font-medium">
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {submitting ? 'Creating...' : 'Create Member'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
