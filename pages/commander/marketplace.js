/**
 * Staff Marketplace Management Page
 * Browse and book freelance dealers and equipment
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Users, Package, Star, MapPin, Calendar, CheckCircle, Search, Loader2, X } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { getToken, getStaffSession } from '../../src/lib/commander/clientAuth';
import { busEmit } from '../../src/engine/EventBus';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import useDebounce from '../../src/hooks/useDebounce';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const GAME_TYPES = ['nlhe', 'plo', 'plo8', 'mixed', 'stud', 'razz', 'omaha'];

function RentEquipmentModal({ isOpen, onClose, equipment, venueId, onSuccess }) {
  const [formData, setFormData] = useState({
    start_date: '',
    end_date: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Calculate days
  const days = formData.start_date && formData.end_date
    ? Math.max(1, Math.ceil((new Date(formData.end_date) - new Date(formData.start_date)) / (1000 * 60 * 60 * 24)) + 1)
    : 1;

  async function handleSubmit() {
    if (!formData.start_date || !formData.end_date) return;

    setSubmitting(true);
    try {
const res = await commanderFetch(`/api/commander/marketplace/equipment/${equipment.id}/rent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          venue_id: venueId,
          start_date: formData.start_date,
          end_date: formData.end_date,
          notes: formData.notes
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        onSuccess?.();
        setTimeout(() => {
          onClose();
          setSuccess(false);
          setFormData({ start_date: '', end_date: '', notes: '' });
        }, 2000);
      }
    } catch (error) {
      console.warn('Rent equipment failed:', error);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !equipment) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h3 className="text-lg font-semibold text-white">Request Equipment Rental</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-[#31A24C] mx-auto mb-3" />
            <p className="font-semibold text-white">Rental Request Sent</p>
            <p className="text-sm text-[#B0B3B8]">The Equipment Owner Will Be Notified</p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-[#3A3B3C] rounded-lg">
                <div className="w-12 h-12 bg-[#31A24C]/10 rounded-lg flex items-center justify-center">
                  <Package className="w-6 h-6 text-[#31A24C]" />
                </div>
                <div>
                  <p className="font-semibold text-white">{equipment.name}</p>
                  <p className="text-sm text-[#B0B3B8]">${equipment.daily_rate}/day</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="cmd-input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                  min={formData.start_date || new Date().toISOString().split('T')[0]}
                  className="cmd-input w-full"
                />
              </div>

              <div className="p-3 bg-[#18191A] rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-[#B0B3B8]">Duration</span>
                  <span className="font-medium text-white">{days} Day{days > 1 ? 's' : ''}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-[#B0B3B8]">Estimated Cost</span>
                  <span className="font-semibold text-white">
                    ${(equipment.daily_rate || 50) * days}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Notes (Optional)</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Pickup Location, Special Requirements..."
                  rows={2}
                  className="cmd-input w-full resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#3A3B3C]">
              <button
                onClick={handleSubmit}
                disabled={!formData.start_date || !formData.end_date || submitting}
                className="w-full h-12 bg-[#31A24C] text-white font-semibold rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Package className="w-5 h-5" />}
                Send Rental Request
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BookDealerModal({ isOpen, onClose, dealer, venueId, onSuccess }) {
  const [formData, setFormData] = useState({
    date: '',
    start_time: '18:00',
    hours: 8,
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (!formData.date) return;

    setSubmitting(true);
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/marketplace/dealers/${dealer.id}/book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          venue_id: venueId,
          date: formData.date,
          start_time: formData.start_time,
          hours: formData.hours,
          notes: formData.notes
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        onSuccess?.();
        setTimeout(() => {
          onClose();
          setSuccess(false);
          setFormData({ date: '', start_time: '18:00', hours: 8, notes: '' });
        }, 2000);
      }
    } catch (error) {
      console.warn('Book dealer failed:', error);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !dealer) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h3 className="text-lg font-semibold text-white">Book Dealer</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-[#31A24C] mx-auto mb-3" />
            <p className="font-semibold text-white">Booking Request Sent</p>
            <p className="text-sm text-[#B0B3B8]">{dealer.name} Will Be Notified</p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-[#3A3B3C] rounded-lg">
                <div className="w-12 h-12 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-[#1877F2]" />
                </div>
                <div>
                  <p className="font-semibold text-white">{dealer.name}</p>
                  <p className="text-sm text-[#B0B3B8]">${dealer.hourly_rate}/hr</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="cmd-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Start Time</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                    className="cmd-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Hours</label>
                  <input
                    type="number"
                    value={formData.hours}
                    onChange={(e) => setFormData(prev => ({ ...prev, hours: parseInt(e.target.value) || 1 }))}
                    min="1"
                    max="12"
                    className="cmd-input w-full"
                  />
                </div>
              </div>

              <div className="p-3 bg-[#18191A] rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-[#B0B3B8]">Estimated Cost</span>
                  <span className="font-semibold text-white">
                    ${(dealer.hourly_rate || 25) * formData.hours}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">Notes (Optional)</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any Special Requirements..."
                  rows={2}
                  className="cmd-input w-full resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#3A3B3C]">
              <button
                onClick={handleSubmit}
                disabled={!formData.date || submitting}
                className="cmd-btn cmd-btn-primary w-full h-12 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
                Send Booking Request
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DealerCard({ dealer, onBook }) {
  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
            {dealer.profiles?.avatar_url ? (
              <img src={dealer.profiles.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover" loading="lazy" />
            ) : (
              <Users className="w-6 h-6 text-[#1877F2]" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">{dealer.name}</h3>
              {dealer.verified && (
                <CheckCircle className="w-4 h-4 text-[#31A24C]" />
              )}
            </div>
            {dealer.rating && (
              <div className="flex items-center gap-1 text-sm text-[#F59E0B]">
                <Star className="w-4 h-4 fill-current" />
                <span>{dealer.rating.toFixed(1)}</span>
                {dealer.reviews_count && (
                  <span className="text-[#B0B3B8]">({dealer.reviews_count})</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-white">${dealer.hourly_rate}/hr</p>
          {dealer.experience_years && (
            <p className="text-xs text-[#B0B3B8]">{dealer.experience_years}+ Years</p>
          )}
        </div>
      </div>

      {dealer.bio && (
        <p className="text-sm text-[#B0B3B8] mb-3 line-clamp-2">{dealer.bio}</p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {(dealer.games_offered || []).slice(0, 4).map((game) => (
          <span
            key={game}
            className="px-2 py-1 bg-[#3A3B3C] rounded text-xs font-medium text-white uppercase"
          >
            {game}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4 text-sm text-[#B0B3B8] mb-4">
        {dealer.service_area && (
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {Array.isArray(dealer.service_area) ? dealer.service_area[0] : dealer.service_area}
          </span>
        )}
        {dealer.available_days && (
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {Array.isArray(dealer.available_days) ? dealer.available_days.length : 7} Days
          </span>
        )}
      </div>

      <button
        onClick={() => onBook(dealer)}
        className="cmd-btn cmd-btn-primary w-full h-10"
      >
        Book Dealer
      </button>
    </div>
  );
}

function EquipmentCard({ equipment, onRent }) {
  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 bg-[#31A24C]/10 rounded-lg flex items-center justify-center">
          <Package className="w-6 h-6 text-[#31A24C]" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">{equipment.name}</h3>
          <p className="text-sm text-[#B0B3B8]">{equipment.category}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-white">${equipment.daily_rate}/day</p>
        </div>
      </div>

      {equipment.description && (
        <p className="text-sm text-[#B0B3B8] mb-3 line-clamp-2">{equipment.description}</p>
      )}

      <div className="flex items-center gap-4 text-sm text-[#B0B3B8] mb-4">
        <span className="flex items-center gap-1">
          <MapPin className="w-4 h-4" />
          {equipment.location || 'Local Pickup'}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${equipment.available ? 'bg-[#31A24C]/10 text-[#31A24C]' : 'bg-[#EF4444]/10 text-[#EF4444]'
          }`}>
          {equipment.available ? 'Available' : 'Rented'}
        </span>
      </div>

      <button
        onClick={() => onRent(equipment)}
        disabled={!equipment.available}
        className="w-full h-10 bg-[#31A24C] text-white font-medium rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {equipment.available ? 'Request Rental' : 'Not Available'}
      </button>
    </div>
  );
}

export default function MarketplacePage() {
  useEffect(() => { busEmit.sessionStart('commander-marketplace'); }, []);
  const router = useRouter();

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [activeTab, setActiveTab] = useState('dealers');
  const [dealers, setDealers] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [showBookModal, setShowBookModal] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showRentModal, setShowRentModal] = useState(false);

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }
    try {
      const staffData = JSON.parse(storedStaff);
      setStaff(staffData);
      setVenueId(staffData.venue_id);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  const fetchDealers = useCallback(async () => {
    try {
      const token = getToken();
const data = await commanderFetchJSON('/api/commander/marketplace/dealers?limit=50', {});
      if (data.success) {
        setDealers(data.data?.dealers || []);
      }
    } catch (error) {
      console.warn('Fetch dealers failed:', error);
    }
  }, []);

  const fetchEquipment = useCallback(async () => {
    try {
const data = await commanderFetchJSON('/api/commander/marketplace/equipment?limit=50', {});
      if (data.success) {
        setEquipment(data.data?.equipment || []);
      }
    } catch (error) {
      console.warn('Fetch equipment failed:', error);
    }
  }, []);

  const fetchAll = useCallback(() => {
    Promise.all([fetchDealers(), fetchEquipment()]).finally(() => setLoading(false));
  }, [fetchDealers, fetchEquipment]);

  useEffect(() => {
    if (venueId) fetchAll();
  }, [venueId, fetchAll]);

  // Commander Data Bus - both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(venueId || '', fetchAll, { entities: ['settings', 'marketplace'] });

  function handleBookDealer(dealer) {
    setSelectedDealer(dealer);
    setShowBookModal(true);
  }

  function handleRentEquipment(item) {
    setSelectedEquipment(item);
    setShowRentModal(true);
  }

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const filteredDealers = dealers.filter(d =>
    d.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
    d.games_offered?.some(g => g.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
  );

  const filteredEquipment = equipment.filter(e =>
    e.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
    e.category?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
  );

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Marketplace | Commander" backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander - Marketplace"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="cmd-page">
          <header className="cmd-header-bar sticky top-0 z-40">
            <div className="max-w-4xl mx-auto px-4 flex gap-1 border-t border-[#3A3B3C]">
              <button
                onClick={() => setActiveTab('dealers')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dealers'
                  ? 'border-[#1877F2] text-[#1877F2]'
                  : 'border-transparent text-[#B0B3B8] hover:text-white'
                  }`}
              >
                <Users className="w-4 h-4 inline-block mr-2" />
                Dealers
              </button>
              <button
                onClick={() => setActiveTab('equipment')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'equipment'
                  ? 'border-[#31A24C] text-[#31A24C]'
                  : 'border-transparent text-[#B0B3B8] hover:text-white'
                  }`}
              >
                <Package className="w-4 h-4 inline-block mr-2" />
                Equipment
              </button>
            </div>
          </header>

          <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={activeTab === 'dealers' ? 'Search Dealers, Games...' : 'Search Equipment...'}
                className="cmd-input w-full pl-10"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
              </div>
            ) : activeTab === 'dealers' ? (
              filteredDealers.length === 0 ? (
                <div className="cmd-panel p-8 text-center">
                  <Users className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                  <p className="text-[#B0B3B8]">No Dealers Found</p>
                  <p className="text-sm text-[#3A3B3C] mt-1">Try Adjusting Your Search</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredDealers.map((dealer) => (
                    <DealerCard
                      key={dealer.id}
                      dealer={dealer}
                      onBook={handleBookDealer}
                    />
                  ))}
                </div>
              )
            ) : (
              filteredEquipment.length === 0 ? (
                <div className="cmd-panel p-8 text-center">
                  <Package className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                  <p className="text-[#B0B3B8]">No Equipment Found</p>
                  <p className="text-sm text-[#3A3B3C] mt-1">Try Adjusting Your Search</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredEquipment.map((item) => (
                    <EquipmentCard
                      key={item.id}
                      equipment={item}
                      onRent={handleRentEquipment}
                    />
                  ))}
                </div>
              )
            )}
          </main>
        </div>

        <BookDealerModal
          isOpen={showBookModal}
          onClose={() => {
            setShowBookModal(false);
            setSelectedDealer(null);
          }}
          dealer={selectedDealer}
          venueId={venueId}
          onSuccess={() => broadcastChange('marketplace')}
        />

        <RentEquipmentModal
          isOpen={showRentModal}
          onClose={() => {
            setShowRentModal(false);
            setSelectedEquipment(null);
          }}
          equipment={selectedEquipment}
          venueId={venueId}
          onSuccess={() => broadcastChange('marketplace')}
        />
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
