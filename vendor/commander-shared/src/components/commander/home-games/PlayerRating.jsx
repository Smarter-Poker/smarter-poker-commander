/**
 * PlayerRating Component - Rate and review home game experiences
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import { Star, Send, User } from 'lucide-react';

function StarRating({ value, onChange, size = 24, readonly = false }) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => !readonly && onChange?.(star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <Star
            size={size}
            fill={(hovered || value) >= star ? '#F59E0B' : 'transparent'}
            className={(hovered || value) >= star ? 'text-[#F59E0B]' : 'text-[#4A5E78]'}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * PlayerRating - Submit a review form for a home game
 */
export default function PlayerRating({
  event,
  onSubmit,
  isLoading = false,
  existingReview = null
}) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [gameQuality, setGameQuality] = useState(existingReview?.game_quality || 0);
  const [hostRating, setHostRating] = useState(existingReview?.host_rating || 0);
  const [locationRating, setLocationRating] = useState(existingReview?.location_rating || 0);
  const [reviewText, setReviewText] = useState(existingReview?.review_text || '');
  const [submitted, setSubmitted] = useState(!!existingReview);

  const handleSubmit = async () => {
    if (rating === 0) return;
    const review = {
      rating,
      game_quality: gameQuality || undefined,
      host_rating: hostRating || undefined,
      location_rating: locationRating || undefined,
      review_text: reviewText.trim() || undefined
    };
    await onSubmit?.(review);
    setSubmitted(true);
  };

  if (submitted && !existingReview) {
    return (
      <div className="cmd-panel p-6 text-center">
        <Star size={36} className="mx-auto text-[#F59E0B] mb-2" fill="#F59E0B" />
        <h3 className="text-lg font-medium text-white">Thanks For Your Review</h3>
        <p className="text-sm text-[#64748B] mt-1">Your Feedback Helps The Community</p>
      </div>
    );
  }

  return (
    <div className="cmd-panel p-5 space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white">
          {existingReview ? 'Your Review' : 'Rate This Game'}
        </h3>
        {event && (
          <p className="text-sm text-[#64748B] mt-1">{event.title}</p>
        )}
      </div>

      {/* Overall Rating */}
      <div>
        <label className="block text-sm font-medium text-[#94A3B8] mb-2">
          Overall Rating <span className="text-[#EF4444]">*</span>
        </label>
        <StarRating
          value={rating}
          onChange={existingReview ? undefined : setRating}
          size={32}
          readonly={!!existingReview}
        />
      </div>

      {/* Sub-ratings */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5">
            Game Quality
          </label>
          <StarRating
            value={gameQuality}
            onChange={existingReview ? undefined : setGameQuality}
            size={20}
            readonly={!!existingReview}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5">
            Host
          </label>
          <StarRating
            value={hostRating}
            onChange={existingReview ? undefined : setHostRating}
            size={20}
            readonly={!!existingReview}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5">
            Location
          </label>
          <StarRating
            value={locationRating}
            onChange={existingReview ? undefined : setLocationRating}
            size={20}
            readonly={!!existingReview}
          />
        </div>
      </div>

      {/* Review Text */}
      <div>
        <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
          Review (optional)
        </label>
        {existingReview ? (
          <p className="text-sm text-white">{existingReview.review_text || 'No written review'}</p>
        ) : (
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="How Was The Game?"
            className="w-full cmd-input min-h-[80px] resize-none"
            maxLength={500}
          />
        )}
        {!existingReview && (
          <p className="text-xs text-[#4A5E78] mt-1 text-right">{reviewText.length}/500</p>
        )}
      </div>

      {/* Submit */}
      {!existingReview && (
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || isLoading}
          className="w-full cmd-btn cmd-btn-primary h-11 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Send size={16} />
          {isLoading ? 'Submitting...' : 'Submit Review'}
        </button>
      )}
    </div>
  );
}

/**
 * ReviewCard - Display a single review (read-only)
 */
export function ReviewCard({ review }) {
  const playerName = review.player_name || review.profiles?.display_name || 'Anonymous';

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#0D192E] flex items-center justify-center flex-shrink-0">
          {review.profiles?.avatar_url ? (
            <img
              src={review.profiles.avatar_url}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <User size={18} className="text-[#64748B]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-medium text-white">{playerName}</span>
            {review.created_at && (
              <span className="text-xs text-[#4A5E78]">
                {new Date(review.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="mt-1">
            <StarRating value={review.rating} readonly size={16} />
          </div>
          {review.review_text && (
            <p className="text-sm text-[#94A3B8] mt-2">{review.review_text}</p>
          )}
          {(review.game_quality || review.host_rating || review.location_rating) && (
            <div className="flex gap-4 mt-2 text-xs text-[#64748B]">
              {review.game_quality && <span>Game: {review.game_quality}/5</span>}
              {review.host_rating && <span>Host: {review.host_rating}/5</span>}
              {review.location_rating && <span>Location: {review.location_rating}/5</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
