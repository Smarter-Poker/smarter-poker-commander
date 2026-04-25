/**
 * AuditLogViewer Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import {
  Shield, User, Filter, Search, ChevronDown,
  LogIn, UserPlus, Play,
  DollarSign, Gift, Settings, Download, AlertCircle
} from 'lucide-react';

const ACTION_ICONS = {
  auth: LogIn,
  waitlist: User,
  game: Play,
  table: Settings,
  tournament: Shield,
  player: UserPlus,
  promotion: Gift,
  comp: DollarSign,
  settings: Settings,
  staff: UserPlus,
  export: Download,
  admin: Shield
};

const ACTION_COLORS = {
  auth: '#3B82F6',
  waitlist: '#8B5CF6',
  game: '#10B981',
  table: '#6B7280',
  tournament: '#F59E0B',
  player: '#EC4899',
  promotion: '#EF4444',
  comp: '#14B8A6',
  settings: '#6366F1',
  staff: '#F97316',
  export: '#06B6D4',
  admin: '#DC2626'
};

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'auth', label: 'Authentication' },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'game', label: 'Games' },
  { value: 'table', label: 'Tables' },
  { value: 'tournament', label: 'Tournaments' },
  { value: 'player', label: 'Players' },
  { value: 'promotion', label: 'Promotions' },
  { value: 'comp', label: 'Comps' },
  { value: 'settings', label: 'Settings' },
  { value: 'staff', label: 'Staff' },
  { value: 'export', label: 'Exports' },
  { value: 'admin', label: 'Admin' }
];

function LogEntry({ log }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ACTION_ICONS[log.action_category] || AlertCircle;
  const color = ACTION_COLORS[log.action_category] || '#6B7280';

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getActorName = () => {
    if (log.commander_staff?.display_name) return log.commander_staff.display_name;
    if (log.profiles?.display_name) return log.profiles.display_name;
    if (log.actor_name) return log.actor_name;
    return log.actor_type || 'Unknown';
  };

  return (
    <div
      className="p-3 border-b border-[#4A5E78] last:border-b-0 hover:bg-[#132240] transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon size={16} style={{ color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm">
              {log.action.replace(/_/g, ' ')}
            </span>
            <span
              className="px-1.5 py-0.5 text-xs rounded"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {log.action_category}
            </span>
            {log.status === 'failure' && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-400">
                Failed
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-[#4A5E78]">
            <span>{getActorName()}</span>
            {log.target_type && (
              <>
                <span>-</span>
                <span>{log.target_type}: {log.target_name || log.target_id}</span>
              </>
            )}
          </div>
        </div>

        {/* Time */}
        <div className="text-xs text-[#4A5E78] flex-shrink-0">
          {formatTime(log.created_at)}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 ml-11 space-y-2">
          {/* Changes */}
          {log.changes && Object.keys(log.changes || {}).length > 0 && (
            <div className="p-2 rounded-lg text-xs bg-[#0D192E]">
              <div className="text-[#64748B] mb-1">Changes:</div>
              {Object.entries(log.changes || {}).map(([field, change]) => (
                <div key={field} className="flex gap-2">
                  <span className="text-[#4A5E78]">{field}:</span>
                  <span className="text-red-400 line-through">{JSON.stringify(change.old)}</span>
                  <span className="text-[#4A5E78]">-</span>
                  <span className="text-green-400">{JSON.stringify(change.new)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Metadata */}
          {log.metadata && Object.keys(log.metadata || {}).length > 0 && (
            <div className="p-2 rounded-lg text-xs bg-[#0D192E]">
              <div className="text-[#64748B] mb-1">Details:</div>
              <pre className="text-gray-300 whitespace-pre-wrap">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* Error message */}
          {log.error_message && (
            <div className="p-2 rounded-lg text-xs bg-red-500/10 text-red-400">
              Error: {log.error_message}
            </div>
          )}

          {/* Full timestamp */}
          <div className="text-xs text-[#4A5E78]">
            {new Date(log.created_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditLogViewer({
  logs = [],
  total = 0,
  isLoading = false,
  onFilterChange,
  onLoadMore,
  hasMore = false
}) {
  const [filters, setFilters] = useState({
    category: '',
    search: '',
    dateFrom: '',
    dateTo: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  if (isLoading && logs.length === 0) {
    return (
      <div className="cmd-panel overflow-hidden">
        <div className="p-4 border-b border-[#4A5E78]">
          <div className="h-8 w-32 rounded animate-pulse bg-[#0D192E]" />
        </div>
        <div className="divide-y divide-[#4A5E78]">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="p-3 flex gap-3">
              <div className="w-8 h-8 rounded-lg animate-pulse bg-[#0D192E]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded animate-pulse bg-[#0D192E]" />
                <div className="h-3 w-32 rounded animate-pulse bg-[#0D192E]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cmd-panel overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#4A5E78] flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">Audit Logs</h3>
          <p className="text-xs text-[#4A5E78]">{total.toLocaleString()} total entries</p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            showFilters ? 'bg-[#22D3EE] text-white' : 'text-[#64748B] hover:bg-[#132240]'
          }`}
        >
          <Filter size={16} />
          Filters
          <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="p-4 border-b border-[#4A5E78] grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5E78]" />
            <input
              type="text"
              placeholder="Search..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="cmd-input w-full pl-9 pr-3 py-2 text-sm"
            />
          </div>

          {/* Category */}
          <select
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="cmd-input px-3 py-2 text-sm"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
            className="cmd-input px-3 py-2 text-sm"
          />

          {/* Date to */}
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => handleFilterChange('dateTo', e.target.value)}
            className="cmd-input px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* Logs */}
      {logs.length === 0 ? (
        <div className="p-8 text-center">
          <Shield size={32} className="mx-auto text-[#4A5E78] mb-2" />
          <p className="text-[#64748B]">No Audit Logs Found</p>
          <p className="text-xs text-[#4A5E78]">Logs Will Appear As Actions Are Performed</p>
        </div>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {logs.map(log => (
            <LogEntry key={log.id} log={log} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="p-4 border-t border-[#4A5E78]">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="w-full py-2 text-center text-sm text-[#22D3EE] hover:bg-[#132240] rounded-lg transition-colors"
          >
            {isLoading ? 'Loading...' : 'Load more logs'}
          </button>
        </div>
      )}
    </div>
  );
}
