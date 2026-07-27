/**
 * ExportManager Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import {
  Download, FileText, FileJson, Table,
  Clock, CheckCircle, XCircle, Loader, RefreshCw,
  Users, Activity, Trophy, Gift, DollarSign, Shield
} from 'lucide-react';

const EXPORT_TYPES = [
  { value: 'players', label: 'Player Stats', icon: Users, description: 'Player Statistics and Visit History' },
  { value: 'sessions', label: 'Sessions', icon: Activity, description: 'Player Session Data' },
  { value: 'tournaments', label: 'Tournaments', icon: Trophy, description: 'Tournament Results and Entries' },
  { value: 'analytics', label: 'Analytics', icon: Table, description: 'Daily Analytics Data' },
  { value: 'promotions', label: 'Promotions', icon: Gift, description: 'Promotion Awards' },
  { value: 'comps', label: 'Comps', icon: DollarSign, description: 'Comp Transactions' },
  { value: 'audit_logs', label: 'Audit Logs', icon: Shield, description: 'Activity Audit Trail' }
];

const FORMAT_OPTIONS = [
  { value: 'csv', label: 'CSV', icon: Table },
  { value: 'json', label: 'JSON', icon: FileJson }
];

const STATUS_CONFIG = {
  pending: { color: '#F59E0B', icon: Clock, label: 'Pending' },
  processing: { color: '#3B82F6', icon: Loader, label: 'Processing' },
  completed: { color: '#10B981', icon: CheckCircle, label: 'Completed' },
  failed: { color: '#EF4444', icon: XCircle, label: 'Failed' },
  expired: { color: '#6B7280', icon: Clock, label: 'Expired' }
};

function ExportJobCard({ job, onDownload, onRefresh }) {
  const status = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;
  const TypeIcon = EXPORT_TYPES.find(t => t.value === job.export_type)?.icon || FileText;

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#0D192E]">
            <TypeIcon size={20} className="text-[#64748B]" />
          </div>
          <div>
            <div className="font-medium text-white capitalize">
              {job.export_type.replace(/_/g, ' ')} Export
            </div>
            <div className="text-xs text-[#4A5E78]">
              {job.format?.toUpperCase()} - {new Date(job.created_at).toLocaleString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ backgroundColor: `${status.color}20`, color: status.color }}
          >
            <StatusIcon size={12} className={job.status === 'processing' ? 'animate-spin' : ''} />
            {status.label}
          </div>
          {job.status === 'processing' && (
            <button
              onClick={() => onRefresh?.(job.id)}
              className="p-1 text-[#4A5E78] hover:text-white"
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar for processing */}
      {job.status === 'processing' && job.progress !== undefined && (
        <div className="mt-3">
          <div className="h-1 rounded-full overflow-hidden bg-[#0D192E]">
            <div
              className="h-full transition-all"
              style={{ width: `${job.progress}%`, backgroundColor: '#22D3EE' }}
            />
          </div>
          <div className="text-xs text-[#4A5E78] mt-1">{job.progress}% complete</div>
        </div>
      )}

      {/* Details for completed exports */}
      {job.status === 'completed' && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-[#4A5E78]">
            <span>{job.row_count?.toLocaleString() || 0} rows</span>
            <span>{formatFileSize(job.file_size)}</span>
            {job.date_from && job.date_to && (
              <span>{job.date_from} to {job.date_to}</span>
            )}
          </div>
          <button
            onClick={() => onDownload?.(job)}
            className="cmd-btn cmd-btn-primary flex items-center gap-1 px-3 py-1.5 text-sm"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      )}

      {/* Error message */}
      {job.status === 'failed' && job.error_message && (
        <div className="mt-3 p-2 rounded-lg bg-[#EF4444]/10 text-xs text-red-400">
          {job.error_message}
        </div>
      )}

      {/* Expiration warning */}
      {job.status === 'completed' && job.expires_at && (
        <div className="mt-2 text-xs text-[#4A5E78]">
          Expires: {new Date(job.expires_at).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export default function ExportManager({
  exports = [],
  isLoading = false,
  onCreateExport,
  onDownload,
  onRefresh
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    export_type: 'players',
    format: 'csv',
    date_from: '',
    date_to: ''
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await onCreateExport?.(formData);
      setShowCreateForm(false);
      setFormData({ export_type: 'players', format: 'csv', date_from: '', date_to: '' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Data Exports</h2>
          <p className="text-sm text-[#4A5E78]">Export Your Data For Analysis Or Reporting</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="cmd-btn cmd-btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          <Download size={16} />
          New Export
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="cmd-panel p-4 space-y-4">
          <h3 className="font-medium text-white">Create New Export</h3>

          {/* Export type */}
          <div>
            <label className="block text-sm text-[#64748B] mb-2">Export Type</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {EXPORT_TYPES.map(type => {
                const TypeIcon = type.icon;
                const isSelected = formData.export_type === type.value;
                return (
                  <button
                    key={type.value}
                    onClick={() => setFormData({ ...formData, export_type: type.value })}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected ? 'ring-2 ring-[#22D3EE] border-[#22D3EE] bg-[#22D3EE]/10' : 'border-[#4A5E78] bg-[#0D192E]'
                    }`}
                  >
                    <TypeIcon size={20} className={isSelected ? 'text-[#22D3EE]' : 'text-[#64748B]'} />
                    <div className="mt-2 font-medium text-white text-sm">{type.label}</div>
                    <div className="text-xs text-[#4A5E78]">{type.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Format */}
          <div>
            <label className="block text-sm text-[#64748B] mb-2">Format</label>
            <div className="flex gap-2">
              {FORMAT_OPTIONS.map(format => {
                const FormatIcon = format.icon;
                const isSelected = formData.format === format.value;
                return (
                  <button
                    key={format.value}
                    onClick={() => setFormData({ ...formData, format: format.value })}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                      isSelected ? 'ring-2 ring-[#22D3EE] border-[#22D3EE] bg-[#22D3EE]/10' : 'border-[#4A5E78] bg-[#0D192E]'
                    }`}
                  >
                    <FormatIcon size={16} className={isSelected ? 'text-[#22D3EE]' : 'text-[#64748B]'} />
                    <span className={isSelected ? 'text-white' : 'text-gray-300'}>{format.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#64748B] mb-2">From Date (optional)</label>
              <input
                type="date"
                value={formData.date_from}
                onChange={(e) => setFormData({ ...formData, date_from: e.target.value })}
                className="cmd-input w-full px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-[#64748B] mb-2">To Date (optional)</label>
              <input
                type="date"
                value={formData.date_to}
                onChange={(e) => setFormData({ ...formData, date_to: e.target.value })}
                className="cmd-input w-full px-3 py-2"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreateForm(false)}
              className="cmd-btn cmd-btn-secondary px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="cmd-btn cmd-btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Download size={14} />
                  Create Export
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Hendon Mob notice */}
      <div className="cmd-panel p-4 flex items-start gap-3">
        <Trophy size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-white">Hendon Mob Integration</h4>
          <p className="text-sm text-[#64748B] mt-1">
            For tournament results, use the dedicated Hendon Mob export format via the API:
          </p>
          <code className="block mt-2 p-2 rounded bg-[#0B1426] text-xs text-green-400">
            GET /api/commander/exports/hendon-mob?tournament_id=YOUR_ID
          </code>
        </div>
      </div>

      {/* Export list */}
      {isLoading && exports.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-24 rounded-xl animate-pulse bg-[#0D192E]"
            />
          ))}
        </div>
      ) : exports.length === 0 ? (
        <div className="cmd-panel p-8 text-center">
          <Download size={32} className="mx-auto text-[#4A5E78] mb-2" />
          <p className="text-[#64748B]">No Exports Yet</p>
          <p className="text-sm text-[#4A5E78]">Create An Export To Download Your Data</p>
        </div>
      ) : (
        <div className="space-y-3">
          {exports.map(job => (
            <ExportJobCard
              key={job.id}
              job={job}
              onDownload={onDownload}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
