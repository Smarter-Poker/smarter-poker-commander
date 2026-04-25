/**
 * MultiVenueDashboard Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import {
  Building2, Users, DollarSign, Activity,
  TrendingUp, TrendingDown, ChevronRight, MapPin, LayoutGrid, LayoutList
} from 'lucide-react';

function VenueCard({ venue, onSelect, isSelected }) {
  const stats = venue.stats || {};

  return (
    <div
      onClick={() => onSelect(venue)}
      className={`cmd-panel p-4 cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-[#22D3EE] border-[#22D3EE]' : 'hover:border-[#22D3EE]'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {venue.logo_url ? (
            <img
              src={venue.logo_url}
              alt={venue.name}
              className="w-10 h-10 rounded-lg object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#0D192E]">
              <Building2 size={20} className="text-[#64748B]" />
            </div>
          )}
          <div>
            <h3 className="font-semibold text-white">{venue.name}</h3>
            <div className="flex items-center gap-1 text-xs text-[#4A5E78]">
              <MapPin size={12} />
              {venue.city}, {venue.state}
            </div>
          </div>
        </div>
        <span
          className="px-2 py-1 text-xs font-medium rounded"
          style={{
            backgroundColor: venue.role === 'owner' ? '#22D3EE20' : '#0D192E',
            color: venue.role === 'owner' ? '#22D3EE' : '#4A5E78'
          }}
        >
          {venue.role}
        </span>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="p-2 rounded-lg bg-[#0D192E]">
          <div className="flex items-center gap-1 text-xs text-[#4A5E78] mb-1">
            <Activity size={12} />
            Active Games
          </div>
          <div className="text-lg font-bold text-white">{stats.active_games || 0}</div>
        </div>
        <div className="p-2 rounded-lg bg-[#0D192E]">
          <div className="flex items-center gap-1 text-xs text-[#4A5E78] mb-1">
            <Users size={12} />
            Waitlist
          </div>
          <div className="text-lg font-bold text-white">{stats.waitlist_count || 0}</div>
        </div>
      </div>

      {/* Today's stats */}
      <div className="border-t border-[#4A5E78] pt-3">
        <div className="text-xs text-[#4A5E78] mb-2">Today</div>
        <div className="flex justify-between text-sm">
          <span className="text-[#64748B]">{stats.today?.sessions || 0} sessions</span>
          <span className="text-[#64748B]">{stats.today?.players || 0} players</span>
          <span className="text-green-400">${(stats.today?.buyin || 0).toLocaleString()}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end">
        <span className="text-xs text-[#22D3EE] flex items-center gap-1">
          View Details <ChevronRight size={14} />
        </span>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, change, color = '#22D3EE' }) {
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-center justify-between">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-xs ${
            isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-[#4A5E78]'
          }`}>
            {isPositive ? <TrendingUp size={14} /> : IsNegative ? <TrendingDown size={14} /> : null}
            {Math.abs(change).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-[#64748B]">{label}</div>
      </div>
    </div>
  );
}

export default function MultiVenueDashboard({
  venues = [],
  summary = {},
  isLoading = false,
  onVenueSelect
}) {
  const [viewMode, setViewMode] = useState('grid');
  const [selectedVenue, setSelectedVenue] = useState(null);

  const handleVenueSelect = (venue) => {
    setSelectedVenue(venue.id === selectedVenue?.id ? null : venue);
    onVenueSelect?.(venue);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-28 rounded-xl animate-pulse bg-[#0D192E]"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-48 rounded-xl animate-pulse bg-[#0D192E]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Summary */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            icon={Building2}
            label="Total Venues"
            value={summary.total_venues || venues.length}
            color="#8B5CF6"
          />
          <SummaryCard
            icon={Activity}
            label="Active Games"
            value={summary.total_active_games || 0}
            color="#3B82F6"
          />
          <SummaryCard
            icon={Users}
            label="Total Waitlist"
            value={summary.total_waitlist || 0}
            color="#10B981"
          />
          <SummaryCard
            icon={DollarSign}
            label="Today's Buy-ins"
            value={`$${(summary.today?.buyin || 0).toLocaleString()}`}
            color="#F59E0B"
          />
        </div>
      </div>

      {/* Weekly Summary */}
      {summary.week && (
        <div className="cmd-panel p-4">
          <h3 className="font-medium text-white mb-3">This Week (All Venues)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-2xl font-bold text-white">{summary.week.sessions || 0}</div>
              <div className="text-sm text-[#64748B]">Total Sessions</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{summary.week.players || 0}</div>
              <div className="text-sm text-[#64748B]">Unique Players</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{(summary.week.hours || 0).toFixed(0)}h</div>
              <div className="text-sm text-[#64748B]">Play Hours</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">${(summary.week.buyin || 0).toLocaleString()}</div>
              <div className="text-sm text-[#64748B]">Total Buy-ins</div>
            </div>
          </div>
        </div>
      )}

      {/* Venues List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Your Venues</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-[#22D3EE] text-white' : 'text-[#64748B] hover:bg-[#132240]'
              }`}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'list' ? 'bg-[#22D3EE] text-white' : 'text-[#64748B] hover:bg-[#132240]'
              }`}
            >
              <LayoutList size={18} />
            </button>
          </div>
        </div>

        {venues.length === 0 ? (
          <div className="cmd-panel p-8 text-center">
            <Building2 size={48} className="mx-auto text-[#4A5E78] mb-3" />
            <p className="text-[#64748B]">No Venues Found</p>
            <p className="text-sm text-[#4A5E78]">You Need To Be Added As Staff To A Venue</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {venues.map(venue => (
              <VenueCard
                key={venue.id}
                venue={venue}
                onSelect={handleVenueSelect}
                isSelected={selectedVenue?.id === venue.id}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {venues.map(venue => (
              <div
                key={venue.id}
                onClick={() => handleVenueSelect(venue)}
                className={`cmd-panel p-4 cursor-pointer flex items-center justify-between ${
                  selectedVenue?.id === venue.id ? 'ring-2 ring-[#22D3EE] border-[#22D3EE]' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {venue.logo_url ? (
                    <img src={venue.logo_url} alt={venue.name} className="w-10 h-10 rounded-lg object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#0D192E]">
                      <Building2 size={20} className="text-[#64748B]" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-white">{venue.name}</h3>
                    <div className="text-xs text-[#4A5E78]">{venue.city}, {venue.state}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-white font-medium">{venue.stats?.active_games || 0}</div>
                    <div className="text-xs text-[#4A5E78]">Games</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white font-medium">{venue.stats?.waitlist_count || 0}</div>
                    <div className="text-xs text-[#4A5E78]">Waiting</div>
                  </div>
                  <div className="text-center">
                    <div className="text-green-400 font-medium">${(venue.stats?.today?.buyin || 0).toLocaleString()}</div>
                    <div className="text-xs text-[#4A5E78]">Today</div>
                  </div>
                  <ChevronRight size={20} className="text-[#4A5E78]" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
