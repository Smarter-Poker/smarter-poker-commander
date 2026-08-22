/**
 * Printable Member Card Component
 * Renders a credit-card-sized (3.375" x 2.125") player card with:
 * - Venue name/branding
 * - Member name, number, tier
 * - QR code for scanning
 * - Member since date
 *
 * Uses @media print CSS for clean output
 * NO EMOJIS - Lucide icons only (per /no-emoji-commander)
 */
import { useRef } from 'react';
import { Printer } from 'lucide-react';

const TIER_COLORS = {
    standard: { bg: '#3A3B3C', text: '#E4E6EB', accent: '#1877F2' },
    gold: { bg: '#78350F', text: '#FEF3C7', accent: '#F59E0B' },
    platinum: { bg: '#1E293B', text: '#F1F5F9', accent: '#94A3B8' },
    vip: { bg: '#2E1065', text: '#F3E8FF', accent: '#A855F7' },
};

export default function MemberCard({ member, venueName, qrCodeUrl, onPrint }) {
    const cardRef = useRef(null);
    const colors = TIER_COLORS[member?.membership_tier] || TIER_COLORS.standard;

    const handlePrint = () => {
        if (onPrint) {
            onPrint();
            return;
        }

        // Fallback: open print dialog with card content
        const printWindow = window.open('', '_blank', 'width=400,height=300');
        printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Member Card - ${member.first_name} ${member.last_name}</title>
          <style>
            @page { size: 3.375in 2.125in; margin: 0; }
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            .card { width: 3.375in; height: 2.125in; background: ${colors.bg}; color: ${colors.text}; padding: 0.15in; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; }
            .venue { font-size: 9pt; font-weight: 700; letter-spacing: 0.5px; color: ${colors.accent}; }
            .tier { font-size: 6pt; text-transform: uppercase; letter-spacing: 1px; padding: 2px 6px; border: 1px solid ${colors.accent}; border-radius: 3px; color: ${colors.accent}; }
            .body { display: flex; align-items: center; gap: 0.12in; }
            .qr { width: 0.85in; height: 0.85in; background: white; padding: 3px; border-radius: 4px; }
            .qr img { width: 100%; height: 100%; }
            .info { flex: 1; }
            .name { font-size: 11pt; font-weight: 700; line-height: 1.2; }
            .member-number { font-size: 8pt; color: ${colors.accent}; font-family: monospace; margin-top: 3px; }
            .footer { display: flex; justify-content: space-between; font-size: 6pt; opacity: 0.7; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <div class="venue">${venueName || 'Club Commander'}</div>
              <div class="tier">${member.membership_tier?.toUpperCase()}</div>
            </div>
            <div class="body">
              <div class="qr"><img src="${qrCodeUrl}" alt="QR" /></div>
              <div class="info">
                <div class="name">${member.first_name} ${member.last_name}</div>
                <div class="member-number">${member.member_number}</div>
              </div>
            </div>
            <div class="footer">
              <span>Member Since ${new Date(member.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
              <span>Powered By CLUB COMMANDER</span>
            </div>
          </div>
        </body>
      </html>
    `);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    };

    if (!member) return null;

    return (
        <div className="inline-block">
            {/* Card Preview (screen version) */}
            <div ref={cardRef} className="w-[324px] h-[204px] rounded-xl overflow-hidden shadow-2xl relative"
                style={{ background: colors.bg }}>

                <div className="absolute inset-0 p-3 flex flex-col justify-between">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                        <div className="text-xs font-bold tracking-wide" style={{ color: colors.accent }}>
                            {venueName || 'Club Commander'}
                        </div>
                        <div className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border"
                            style={{ borderColor: colors.accent, color: colors.accent }}>
                            {member.membership_tier}
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex items-center gap-3">
                        {/* QR Code */}
                        <div className="w-[82px] h-[82px] bg-white rounded-md p-1 flex-shrink-0">
                            {qrCodeUrl ? (
                                <img src={qrCodeUrl} alt="QR Code" className="w-full h-full" />
                            ) : (
                                <div className="w-full h-full bg-gray-200 rounded animate-pulse" />
                            )}
                        </div>

                        {/* Member Info */}
                        <div className="flex-1 min-w-0">
                            <div className="text-base font-bold truncate" style={{ color: colors.text }}>
                                {member.first_name} {member.last_name}
                            </div>
                            <div className="text-xs font-mono mt-0.5" style={{ color: colors.accent }}>
                                {member.member_number}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between text-[8px] opacity-60" style={{ color: colors.text }}>
                        <span>Member Since {new Date(member.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        <span>CLUB COMMANDER</span>
                    </div>
                </div>
            </div>

            {/* Print Button */}
            <button onClick={handlePrint}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg text-sm font-medium transition-colors">
                <Printer className="w-4 h-4" />
                Print Card
            </button>
        </div>
    );
}
