import React, { useState, useEffect, useCallback } from 'react';
import { Shield, MessageSquare, PlusCircle, ArrowDownCircle, ArrowUpCircle, Play, Pause, ChevronDown, Filter, Search, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

// Map actions to visual branding
const ACTION_MAP = {
  chat_message: { icon: MessageSquare, color: '#3B82F6', label: 'Chat Message' },
  sit_down: { icon: User, color: '#10B981', label: 'Seated' },
  stand_up: { icon: User, color: '#EF4444', label: 'Stood Up' },
  buy_in: { icon: PlusCircle, color: '#F59E0B', label: 'Buy In' },
  cash_out: { icon: ArrowUpCircle, color: '#6366F1', label: 'Cash Out' },
  fold: { icon: ArrowDownCircle, color: '#6B7280', label: 'Fold' },
  bet: { icon: PlusCircle, color: '#8B5CF6', label: 'Bet/Raise' },
  check: { icon: Pause, color: '#9CA3AF', label: 'Check' },
  call: { icon: Play, color: '#34D399', label: 'Call' },
  hand_complete: { icon: Shield, color: '#F59E0B', label: 'Hand Complete' }
};

export default function ArenaLedger({ clubId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Initial Load of the last 150 events
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch audits
      const { data: audits } = await supabase
        .from('club_arena_audit_logs')
        .select('*')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
        .limit(100);
        
      // Fetch chats
      const { data: chats } = await supabase
        .from('club_arena_messages')
        .select('*')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
        .limit(50);

      // Normalize shape
      const normalizedAudits = (audits || []).map(a => ({
        ...a,
        is_chat: false,
        display_type: a.action_type,
        actor_name: a.user_id ? `User ${a.user_id.substring(0,6)}` : 'System'
      }));

      const normalizedChats = (chats || []).map(c => ({
        ...c,
        is_chat: true,
        display_type: 'chat_message',
        action_type: 'chat_message',
        actor_name: c.player_name,
        details: { message: c.message },
        amount: null
      }));

      const combined = [...normalizedAudits, ...normalizedChats]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setLogs(combined.slice(0, 150));
    } catch (e) {
      console.warn('[ArenaLedger] Init Error:', e);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (clubId) fetchLogs();
  }, [clubId, fetchLogs]);

  // 2. Real-time Subscription via pg_changes + polling fallback
  useEffect(() => {
    if (!clubId) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      const channel = supabase.channel(`arena-ledger-${clubId}-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_arena_audit_logs', filter: `club_id=eq.${clubId}` }, (payload) => {
          const newLog = {
            ...payload.new,
            is_chat: false,
            display_type: payload.new.action_type,
            actor_name: payload.new.user_id ? `User ${payload.new.user_id.substring(0,6)}` : 'System'
          };
          setLogs(prev => [newLog, ...prev].slice(0, 300));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_arena_messages', filter: `club_id=eq.${clubId}` }, (payload) => {
          const newChat = {
            ...payload.new,
            is_chat: true,
            display_type: 'chat_message',
            action_type: 'chat_message',
            actor_name: payload.new.player_name,
            details: { message: payload.new.message },
            amount: null
          };
          setLogs(prev => [newChat, ...prev].slice(0, 300));
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnects = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[ArenaLedger] Realtime channel error: ${status}`);
            if (reconnects < MAX_RECONNECT) {
              reconnects++;
              setTimeout(connectChannel, 3000 * reconnects);
            }
          }
        });
      currentChannel = channel;
    }

    connectChannel();

    // Polling fallback - every 15s in case Realtime is down
    const poll = setInterval(fetchLogs, 15000);

    return () => {
      clearInterval(poll);
      if (currentChannel) supabase.removeChannel(currentChannel);
    };
  }, [clubId, fetchLogs]);

  const filteredLogs = logs.filter(log => {
    if (filterType === 'CHAT' && !log.is_chat) return false;
    if (filterType === 'TRANSACTIONS' && !['buy_in', 'cash_out'].includes(log.action_type)) return false;
    if (filterType === 'GAMEPLAY' && ['chat_message', 'buy_in', 'cash_out', 'sit_down', 'stand_up'].includes(log.action_type)) return false;
    
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      if (!log.table_id?.toLowerCase().includes(s) && 
          !log.actor_name?.toLowerCase().includes(s) &&
          !log.details?.message?.toLowerCase().includes(s)) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
            <Shield className="text-[#22D3EE]" size={28} />
            LIVE ARENA LEDGER
          </h2>
          <p className="text-[#9CA3AF] text-sm mt-1">Immutable absolute accounting record for table interactions</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5E78]" />
            <input
              type="text"
              placeholder="Search table or user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-[#0f172a] border border-[#1e293b] text-white text-sm rounded-lg pl-9 pr-4 py-2 focus:ring-1 focus:ring-[#22D3EE] focus:border-[#22D3EE] outline-none w-full md:w-64 transition-all"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-[#0f172a] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#22D3EE]"
          >
            <option value="ALL">All Events</option>
            <option value="TRANSACTIONS">Transactions Only</option>
            <option value="GAMEPLAY">Gameplay Action</option>
            <option value="CHAT">Chat Logs</option>
          </select>
        </div>
      </div>

      {/* Ledger Stream UI */}
      <div className="bg-[#1e293b]/50 border border-[#334155] rounded-xl overflow-hidden shadow-2xl">
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-[#0f172a]/80 border-b border-[#334155] text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">
          <div className="col-span-2">Time</div>
          <div className="col-span-2">Table ID</div>
          <div className="col-span-2">Actor</div>
          <div className="col-span-2">Event</div>
          <div className="col-span-4">Payload / Amount</div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto thin-scrollbar">
          {loading ? (
            <div className="flex justify-center items-center py-20 text-[#22D3EE] animate-pulse">
              SYNCING LEDGER...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-20 text-[#64748B]">
              No matching records found.
            </div>
          ) : (
            <div className="divide-y divide-[#334155]/50">
              {filteredLogs.map(log => {
                const conf = ACTION_MAP[log.action_type] || { icon: Shield, color: '#9CA3AF', label: log.action_type.toUpperCase() };
                const Icon = conf.icon;
                
                return (
                  <div key={log.id} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-[#334155]/30 transition-colors group">
                    {/* Timestamp */}
                    <div className="col-span-2 text-xs text-[#64748B] font-mono group-hover:text-[#94a3b8] transition-colors">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    
                    {/* Table ID */}
                    <div className="col-span-2 text-xs text-[#cbd5e1] font-mono truncate" title={log.table_id}>
                      {log.table_id.length > 12 ? log.table_id.substring(0,10)+'...' : log.table_id}
                    </div>

                    {/* Actor */}
                    <div className="col-span-2 text-sm text-[#f8fafc] truncate font-medium">
                      {log.actor_name}
                    </div>

                    {/* Event Type Badge */}
                    <div className="col-span-2 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold border"
                           style={{ color: conf.color, backgroundColor: `${conf.color}15`, borderColor: `${conf.color}30` }}>
                        <Icon size={12} />
                        {conf.label}
                      </div>
                    </div>

                    {/* Payload / Amount */}
                    <div className="col-span-4 text-sm text-[#94a3b8]">
                      {log.amount != null && (
                        <span className="text-[#10B981] font-mono font-bold mr-3">
                          {Number(log.amount) > 0 ? '+' : ''}{Number(log.amount)} chips
                        </span>
                      )}
                      
                      {log.is_chat ? (
                        <span className="text-[#f1f5f9] italic">"{log.details?.message}"</span>
                      ) : (
                        <span className="text-xs font-mono text-[#64748B] opacity-80 truncate block">
                          {log.details ? JSON.stringify(log.details) : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`
        .thin-scrollbar::-webkit-scrollbar { width: 6px; }
        .thin-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .thin-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .thin-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
}
