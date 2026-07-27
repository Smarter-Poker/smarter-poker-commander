/**
 * PromotionCard Component — Premium SmarterPoker Dark Redesign
 * Features: Status badges, countdown timer, duplicate button, image banner
 */
import React, { useState, useEffect } from 'react';
import { Gift, Clock, Calendar, DollarSign, Users, Trophy, Star, Edit3, Award, Copy, Timer } from 'lucide-react';

const PROMOTION_TYPE_LABELS = {
  high_hand: 'High Hand',
  bad_beat: 'Bad Beat',
  splash_pot: 'Splash Pot',
  happy_hour: 'Happy Hour',
  new_player: 'New Player',
  referral: 'Referral',
  loyalty: 'Loyalty',
  tournament_bonus: 'Tournament Bonus',
  cash_back: 'Cash Back',
  drawing: 'Drawing',
  custom: 'Custom',
  other: 'Other'
};

const PROMOTION_TYPE_ICONS = {
  high_hand: Trophy,
  bad_beat: Gift,
  splash_pot: DollarSign,
  happy_hour: Clock,
  new_player: Star,
  referral: Users,
  loyalty: Award,
  tournament_bonus: Trophy,
  cash_back: DollarSign,
  drawing: Gift,
  custom: Gift,
  other: Gift
};

const PROMOTION_TYPE_COLORS = {
  high_hand: '#F59E0B',
  bad_beat: '#EF4444',
  splash_pot: '#1877F2',
  happy_hour: '#F59E0B',
  new_player: '#8B5CF6',
  referral: '#EC4899',
  loyalty: '#22D3EE',
  tournament_bonus: '#10B981',
  cash_back: '#6366F1',
  drawing: '#F97316',
  custom: '#6B7280',
  other: '#6B7280'
};

const STATUS_STYLES = {
  draft: { bg: 'rgba(107,114,128,0.15)', text: '#9CA3AF', border: 'rgba(107,114,128,0.3)', label: 'Draft' },
  scheduled: { bg: 'rgba(59,130,246,0.15)', text: '#60A5FA', border: 'rgba(59,130,246,0.3)', label: 'Scheduled' },
  active: { bg: 'rgba(34,197,94,0.15)', text: '#4ADE80', border: 'rgba(34,197,94,0.3)', label: 'Active' },
  paused: { bg: 'rgba(245,158,11,0.15)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)', label: 'Paused' },
  expired: { bg: 'rgba(239,68,68,0.15)', text: '#F87171', border: 'rgba(239,68,68,0.3)', label: 'Expired' },
  completed: { bg: 'rgba(107,114,128,0.15)', text: '#9CA3AF', border: 'rgba(107,114,128,0.3)', label: 'Completed' },
  cancelled: { bg: 'rgba(239,68,68,0.15)', text: '#F87171', border: 'rgba(239,68,68,0.3)', label: 'Cancelled' }
};

function titleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/** Compute effective status: auto-detect "expired" if end_date is past */
function getEffectiveStatus(promotion) {
  if (promotion.end_date) {
    const end = new Date(promotion.end_date);
    end.setHours(23, 59, 59, 999);
    if (end < new Date() && (promotion.status === 'active' || promotion.is_active)) {
      return 'expired';
    }
  }
  // Map is_active to status if status not set
  if (!promotion.status || promotion.status === 'draft') {
    if (promotion.is_active) return 'active';
  }
  return promotion.status || 'active';
}

/** Calculate time remaining for countdown */
function getTimeRemaining(promotion) {
  const now = new Date();
  // Check end_date
  if (promotion.end_date) {
    const end = new Date(promotion.end_date);
    end.setHours(23, 59, 59, 999);
    const diff = end - now;
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 7) return { text: `${days} days left`, urgent: false };
    if (days > 0) return { text: `${days}d ${hours}h left`, urgent: days <= 3 };
    if (hours > 0) return { text: `${hours}h ${mins}m left`, urgent: true };
    return { text: `${mins}m left`, urgent: true };
  }
  return null;
}

export default function PromotionCard({
  promotion,
  onEdit,
  onViewAwards,
  onDuplicate,
  compact = false
}) {
  const typeColor = PROMOTION_TYPE_COLORS[promotion.promotion_type] || PROMOTION_TYPE_COLORS.other;
  const effectiveStatus = getEffectiveStatus(promotion);
  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.draft;
  const TypeIcon = PROMOTION_TYPE_ICONS[promotion.promotion_type] || Gift;

  // Countdown timer — updates every 60s
  const [countdown, setCountdown] = useState(() => getTimeRemaining(promotion));

  useEffect(() => {
    if (!promotion.end_date) return;
    const interval = setInterval(() => {
      setCountdown(getTimeRemaining(promotion));
    }, 60000);
    return () => clearInterval(interval);
  }, [promotion.end_date]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  const formatPrize = () => {
    if (promotion.prize_value) {
      if (promotion.prize_type === 'cash' || promotion.prize_type === 'chips') {
        return `$${Number(promotion.prize_value).toLocaleString()}`;
      }
      return `${promotion.prize_value} ${titleCase(promotion.prize_type)}`;
    }
    return promotion.prize_description || 'See Details';
  };

  if (compact) {
    return (
      <div
        style={{
          background: '#242526',
          border: '1px solid #3A3B3C',
          borderRadius: 10,
          padding: '12px 14px',
          cursor: 'pointer',
          transition: 'border-color 0.2s',
        }}
        onClick={() => onEdit?.(promotion)}
        onMouseEnter={e => e.currentTarget.style.borderColor = typeColor}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#3A3B3C'}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: typeColor, flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600, color: '#E4E6EB', fontSize: 14 }}>{promotion.name}</span>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
            background: statusStyle.bg, color: statusStyle.text,
            border: `1px solid ${statusStyle.border}`,
            textTransform: 'uppercase',
          }}>
            {statusStyle.label}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: '#8A8D91' }}>
          {PROMOTION_TYPE_LABELS[promotion.promotion_type]} — {formatPrize()}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: '#242526',
      border: '1px solid #3A3B3C',
      borderRadius: 14,
      overflow: 'hidden',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      fontFamily: 'Inter, sans-serif',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${typeColor}60`;
        e.currentTarget.style.boxShadow = `0 4px 20px ${typeColor}15`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#3A3B3C';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* ── Image Banner ── */}
      {promotion.image_url && (
        <div style={{
          width: '100%', height: 120, overflow: 'hidden',
          borderBottom: '1px solid #3A3B3C',
        }}>
          <img
            src={promotion.image_url}
            alt={promotion.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        padding: '16px 18px 14px',
        borderBottom: '1px solid #3A3B3C',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {/* Type Icon */}
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: `${typeColor}15`,
            border: `1px solid ${typeColor}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TypeIcon size={20} color={typeColor} />
          </div>
          {/* Name + Type */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{
              fontSize: 15, fontWeight: 700, color: '#E4E6EB', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              lineHeight: 1.3,
            }}>
              {promotion.name}
            </h3>
            <span style={{ fontSize: 12, fontWeight: 600, color: typeColor, lineHeight: 1.2 }}>
              {PROMOTION_TYPE_LABELS[promotion.promotion_type] || titleCase(promotion.promotion_type)}
            </span>
          </div>
        </div>

        {/* Status + Featured */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {promotion.is_featured && (
            <Star size={14} color="#F59E0B" fill="#F59E0B" />
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: '4px 10px', borderRadius: 20,
            background: statusStyle.bg, color: statusStyle.text,
            border: `1px solid ${statusStyle.border}`,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}>
            {statusStyle.label}
          </span>
        </div>
      </div>

      {/* ── Description ── */}
      {promotion.description && (
        <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(58,59,60,0.5)' }}>
          <p style={{
            fontSize: 13, color: '#B0B3B8', lineHeight: 1.5, margin: 0,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {promotion.description}
          </p>
        </div>
      )}

      {/* ── Details Grid ── */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Prize Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={14} color="#31A24C" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#8A8D91', flexShrink: 0 }}>Prize:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#E4E6EB' }}>{formatPrize()}</span>
        </div>

        {/* Date Range */}
        {(promotion.start_date || promotion.end_date) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={14} color="#1877F2" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#8A8D91' }}>
              {formatDate(promotion.start_date)} - {formatDate(promotion.end_date)}
            </span>
          </div>
        )}

        {/* Countdown Timer */}
        {countdown && effectiveStatus === 'active' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8,
            background: countdown.urgent ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.08)',
            border: `1px solid ${countdown.urgent ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.15)'}`,
          }}>
            <Timer size={14} color={countdown.urgent ? '#F87171' : '#4ADE80'} style={{ flexShrink: 0 }} />
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: countdown.urgent ? '#F87171' : '#4ADE80',
            }}>
              {countdown.text}
            </span>
          </div>
        )}

        {/* Requirements */}
        {(promotion.min_stakes || promotion.qualifying_hands) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={14} color="#F59E0B" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#8A8D91' }}>
              {promotion.min_stakes && `Min Stakes: ${promotion.min_stakes}`}
              {promotion.min_stakes && promotion.qualifying_hands && ' · '}
              {promotion.qualifying_hands}
            </span>
          </div>
        )}

        {/* Stats Row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          paddingTop: 10, borderTop: '1px solid rgba(58,59,60,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Users size={13} color="#8A8D91" />
            <span style={{ fontSize: 12, color: '#8A8D91' }}>
              {promotion.total_awarded || 0} Awarded
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <DollarSign size={13} color="#8A8D91" />
            <span style={{ fontSize: 12, color: '#8A8D91' }}>
              ${(promotion.total_value_awarded || 0).toLocaleString()} Total
            </span>
          </div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      {(onEdit || onViewAwards || onDuplicate) && (
        <div style={{
          display: 'flex', gap: 0,
          borderTop: '1px solid #3A3B3C',
        }}>
          {onEdit && (
            <button
              onClick={() => onEdit(promotion)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 16px', border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#1877F2',
                fontSize: 13, fontWeight: 600,
                transition: 'background 0.15s',
                borderRight: '1px solid #3A3B3C',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(24,119,242,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Edit3 size={14} />
              Edit
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={() => onDuplicate(promotion)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 16px', border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#22D3EE',
                fontSize: 13, fontWeight: 600,
                transition: 'background 0.15s',
                borderRight: onViewAwards ? '1px solid #3A3B3C' : 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,211,238,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Copy size={14} />
              Duplicate
            </button>
          )}
          {onViewAwards && (
            <button
              onClick={() => onViewAwards(promotion)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 16px', border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#B0B3B8',
                fontSize: 13, fontWeight: 600,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(176,179,184,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Award size={14} />
              View Awards
            </button>
          )}
        </div>
      )}
    </div>
  );
}
