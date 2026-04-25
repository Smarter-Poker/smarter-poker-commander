/**
 * Manager Admin Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Comprehensive guide for venue managers using Club Commander
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, BarChart3, Shield, Trophy, Key, Search, AlertTriangle, DollarSign, UserCog, Building2 } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';

const GUIDE_SECTIONS = [
  {
    id: 'venue-setup',
    title: 'Venue Setup',
    icon: Building2,
    content: [
      {
        title: 'Initial Configuration',
        steps: [
          'Log in at /commander/login with owner credentials',
          'Navigate to Settings > Venue Configuration',
          'Enter venue name, address, and contact information',
          'Upload venue logo (recommended size: 200x200px)',
          'Set operating hours for each day of the week',
          'Save changes and verify on public venue page',
        ],
      },
      {
        title: 'Table Configuration',
        steps: [
          'Go to Tables section from the sidebar',
          'Click "Add Table" for each physical table',
          'Enter table number and optional name (e.g., "Feature Table")',
          'Set maximum seats (default: 9)',
          'Add features if applicable (USB ports, shuffler)',
          'Tables will appear in Game Grid after creation',
        ],
      },
      {
        title: 'Game Types & Stakes',
        steps: [
          'Navigate to Settings > Game Configuration',
          'Enable game types offered (NLH, PLO, Mixed, etc.)',
          'Add available stakes for each game type',
          'Set default buy-in ranges per stake level',
          'Configure must-move rules if applicable',
        ],
      },
      {
        title: 'Notification Settings',
        steps: [
          'Go to Settings > Notifications',
          'Enable SMS notifications (requires Twilio setup)',
          'Configure push notification preferences',
          'Set cooldown periods between notifications',
          'Customize notification message templates',
        ],
      },
    ],
  },
  {
    id: 'staff-management',
    title: 'Staff Management',
    icon: UserCog,
    content: [
      {
        title: 'Adding Staff Members',
        steps: [
          'Navigate to Staff section',
          'Click "Add Staff Member"',
          'Enter staff email (must have Smarter.Poker account)',
          'Select role: Owner, Manager, Floor, Brush, or Dealer',
          'Set a 4-6 digit PIN for quick access',
          'Staff member receives email invitation',
        ],
      },
      {
        title: 'Role Permissions',
        steps: [
          'Owner: Full access including billing and settings',
          'Manager: Staff management, reports, settings (no billing)',
          'Floor: Waitlist, games, tournaments, promotions',
          'Brush: Waitlist and seating operations only',
          'Dealer: Tournament management, rotation tracking',
        ],
      },
      {
        title: 'PIN Management',
        steps: [
          'PINs allow quick authentication for tablets/kiosks',
          'To reset PIN: Staff > Select User > Reset PIN',
          'New PIN is sent to staff email',
          'PINs expire after 90 days by default (configurable)',
        ],
      },
      {
        title: 'Deactivating Staff',
        steps: [
          'Open staff member profile',
          'Click "Deactivate" (does not delete data)',
          'Staff loses access immediately',
          'Their historical actions remain in audit log',
          'Can be reactivated later if needed',
        ],
      },
    ],
  },
  {
    id: 'analytics-reports',
    title: 'Analytics & Reports',
    icon: BarChart3,
    content: [
      {
        title: 'Daily Dashboard',
        steps: [
          'Analytics page shows today\'s key metrics',
          'Total players, unique players, new players',
          'Waitlist signups by source (app vs walk-in)',
          'Average wait times by game type',
          'Table utilization percentage',
        ],
      },
      {
        title: 'Historical Reports',
        steps: [
          'Use date picker to select custom range',
          'Compare to previous periods (week over week, etc.)',
          'Charts show trends over time',
          'Identify peak days and hours',
          'Track player retention rates',
        ],
      },
      {
        title: 'Exporting Data',
        steps: [
          'Navigate to Reports > Export',
          'Select data type (players, sessions, analytics)',
          'Choose date range',
          'Select format (CSV, JSON, or Excel)',
          'Click "Generate Export"',
          'Download link available when ready',
        ],
        note: 'Exports are available for 7 days after generation.',
      },
      {
        title: 'Player Analytics',
        steps: [
          'View individual player statistics',
          'Session history and average duration',
          'Favorite games and stakes',
          'Waitlist behavior (shows, no-shows)',
          'Comp earnings and redemptions',
        ],
      },
    ],
  },
  {
    id: 'promotions',
    title: 'Promotions Setup',
    icon: Trophy,
    content: [
      {
        title: 'Creating a High Hand Promotion',
        steps: [
          'Navigate to Promotions > Create New',
          'Select type: "High Hand"',
          'Enter promotion name and description',
          'Set start and end times',
          'Configure qualifying games and stakes',
          'Set minimum qualifying hand (e.g., Aces Full)',
          'Enter prize amount or progressive rules',
          'Click "Create Promotion"',
        ],
      },
      {
        title: 'Recurring Promotions',
        steps: [
          'Enable "Recurring" when creating',
          'Select days of the week',
          'Set start and end times for each occurrence',
          'Promotion automatically activates/deactivates',
          'Edit recurring rules anytime',
        ],
      },
      {
        title: 'Managing Active Promotions',
        steps: [
          'View all promotions on Promotions page',
          'Active promotions shown with green status',
          'Pause promotions without deleting',
          'Record winners from promotion detail page',
          'View winner history and totals',
        ],
      },
      {
        title: 'Promotion Analytics',
        steps: [
          'Track promotion cost vs player engagement',
          'Measure impact on table hours',
          'Compare similar promotions over time',
          'Identify most effective promotion types',
        ],
      },
    ],
  },
  {
    id: 'tournaments',
    title: 'Tournament Management',
    icon: Trophy,
    content: [
      {
        title: 'Creating a Tournament',
        steps: [
          'Navigate to Tournaments > Create New',
          'Enter tournament name and description',
          'Select type: Freezeout, Rebuy, Bounty, or Satellite',
          'Set buy-in amount and house fee',
          'Configure starting chips',
          'Set scheduled start time',
        ],
      },
      {
        title: 'Blind Structure',
        steps: [
          'Use Blind Structure Editor',
          'Add levels with SB, BB, and Ante',
          'Set level duration (typically 15-30 min)',
          'Insert breaks between levels',
          'Use templates for common structures',
          'Preview total tournament length',
        ],
      },
      {
        title: 'Payout Structure',
        steps: [
          'Configure payout percentages or fixed amounts',
          'Set number of places paid',
          'System calculates actual payouts from prize pool',
          'Adjust for guaranteed tournaments',
        ],
      },
      {
        title: 'Running the Tournament',
        steps: [
          'Click "Start Tournament" at scheduled time',
          'Clock begins automatically',
          'Use clock controls: Pause, Resume, Skip Level',
          'Record eliminations as they occur',
          'System handles rebuy/addon windows automatically',
          'Final table auto-detected',
        ],
      },
    ],
  },
  {
    id: 'comps-rewards',
    title: 'Comps & Rewards',
    icon: DollarSign,
    content: [
      {
        title: 'Configuring Comp Rates',
        steps: [
          'Go to Settings > Comp Configuration',
          'Set earning rate per hour of play',
          'Optionally set different rates by game/stakes',
          'Configure tournament earning rates',
          'Set redemption conversion ratio',
        ],
      },
      {
        title: 'Issuing Comps',
        steps: [
          'Navigate to player profile',
          'Click "Issue Comp"',
          'Enter dollar amount',
          'Add reason/note',
          'Comp immediately available to player',
        ],
      },
      {
        title: 'Redemption Setup',
        steps: [
          'Configure redemption options in Settings',
          'Set up restaurant/food partner items',
          'Add merchandise options if applicable',
          'Set redemption limits per day/week',
        ],
      },
      {
        title: 'Comp Reports',
        steps: [
          'View total comps issued and redeemed',
          'Track outstanding comp liability',
          'Identify top comp earners',
          'Monitor redemption patterns',
        ],
      },
    ],
  },
  {
    id: 'security-compliance',
    title: 'Security & Compliance',
    icon: Shield,
    content: [
      {
        title: 'Audit Logs',
        steps: [
          'Navigate to Admin > Audit Logs',
          'View all system actions with timestamps',
          'Filter by user, action type, or date range',
          'Export logs for compliance purposes',
          'Logs retained for 90 days by default',
        ],
      },
      {
        title: 'Security Audit',
        steps: [
          'Run security audit from Admin > Security',
          'Review all security checks',
          'Address any failed or warning items',
          'Re-run audit after making changes',
          'Target score: 90% or higher',
        ],
      },
      {
        title: 'API Keys',
        steps: [
          'Generate API keys for integrations',
          'Set specific permissions per key',
          'Configure rate limits',
          'Optionally whitelist IP addresses',
          'Rotate keys periodically for security',
        ],
      },
      {
        title: 'Responsible Gaming',
        steps: [
          'Review self-exclusion requests',
          'Cannot be overridden by venue staff',
          'Excluded players blocked from check-in',
          'Reports available for gaming commission',
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    icon: Key,
    content: [
      {
        title: 'Display Devices',
        steps: [
          'Configure displays at Displays section',
          'Add each tablet/screen device',
          'Select content to display (waitlist, clock, promos)',
          'Customize rotation settings',
          'Monitor device health status',
        ],
      },
      {
        title: 'SMS (Twilio)',
        steps: [
          'Obtain Twilio account credentials',
          'Enter Account SID and Auth Token in Settings',
          'Configure sender phone number',
          'Test with a sample notification',
          'Monitor SMS delivery rates',
        ],
      },
      {
        title: 'Webhooks',
        steps: [
          'Configure outgoing webhooks for events',
          'Receive real-time data at your endpoint',
          'Available events: waitlist, seating, tournaments',
          'Verify webhook signatures for security',
        ],
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Manager Troubleshooting',
    icon: AlertTriangle,
    content: [
      {
        title: 'Staff Access Issues',
        steps: [
          'Verify staff email is correct',
          'Reset their PIN if they can\'t log in',
          'Check if account is deactivated',
          'Verify role has required permissions',
          'Check audit log for failed login attempts',
        ],
      },
      {
        title: 'Data Discrepancies',
        steps: [
          'Review audit log for changes',
          'Check if multiple staff editing same data',
          'Verify real-time sync is working',
          'Export data to verify against source',
          'Contact support with audit log evidence',
        ],
      },
      {
        title: 'Performance Issues',
        steps: [
          'Check system health at Admin > Health',
          'Review recent error rates',
          'Check database latency metrics',
          'Clear browser cache on affected devices',
          'Reduce concurrent display updates if needed',
        ],
      },
      {
        title: 'Escalation',
        steps: [
          'Document the issue with screenshots',
          'Note exact time and affected users',
          'Check known issues at status page',
          'Contact support with ticket number',
          'Emergency contact available 24/7 for outages',
        ],
      },
    ],
  },
];

export default function ManagerGuidePage() {
  useEffect(() => { busEmit.sessionStart('commander-docs-manager-guide'); }, []);
  const [activeSection, setActiveSection] = useState('venue-setup');
  const [searchTerm, setSearchTerm] = useState('');

  const currentSection = GUIDE_SECTIONS.find((s) => s.id === activeSection);
  const currentIndex = GUIDE_SECTIONS.findIndex((s) => s.id === activeSection);

  const filteredSections = searchTerm
    ? GUIDE_SECTIONS.filter(
        (section) =>
          section.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          section.content.some(
            (item) =>
              item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
              item.steps.some((step) =>
                step.toLowerCase().includes(searchTerm.toLowerCase())
              )
          )
      )
    : GUIDE_SECTIONS;

  return (
    <>
      <SEOHead
                title="Commander — Manager Guide"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />

      <div className="cmd-page min-h-screen">
        {/* Header */}
        <header className="cmd-header-bar sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/commander/dashboard" className="text-[#B0B3B8] hover:text-white">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-xl font-bold text-white">Manager Admin Guide</h1>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0B3B8]" />
              <input
                type="text"
                placeholder="Search Guide..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="cmd-input w-full pl-10 h-9 text-sm"
              />
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex gap-6">
            {/* Sidebar Navigation */}
            <nav className="w-64 flex-shrink-0">
              <div className="cmd-panel p-4 sticky top-24">
                <h2 className="font-semibold text-white mb-4">Contents</h2>
                <ul className="space-y-1">
                  {filteredSections.map((section) => {
                    const Icon = section.icon;
                    return (
                      <li key={section.id}>
                        <button
                          onClick={() => {
                            setActiveSection(section.id);
                            setSearchTerm('');
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                            activeSection === section.id
                              ? 'bg-[#1877F2]/10 text-[#1877F2]'
                              : 'text-[#B0B3B8] hover:text-white hover:bg-[#374151]'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-sm">{section.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              {currentSection && (
                <div className="cmd-panel p-6">
                  <div className="flex items-center gap-3 mb-6">
                    {(() => {
                      const Icon = currentSection.icon;
                      return (
                        <CommanderLayout title="Manager Admin Guide" backHref="/commander/dashboard?card=reports">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        </CommanderLayout>
                      );
                    })()}
                    <h2 className="text-2xl font-bold text-white">{currentSection.title}</h2>
                  </div>

                  <div className="space-y-8">
                    {currentSection.content.map((item, idx) => (
                      <div key={idx} className="border-b border-[#374151] pb-6 last:border-0">
                        <h3 className="text-lg font-semibold text-white mb-4">{item.title}</h3>

                        <ol className="space-y-3 mb-4">
                          {item.steps.map((step, stepIdx) => (
                            <li key={stepIdx} className="flex items-start gap-3">
                              <span className="flex-shrink-0 w-6 h-6 bg-[#3A3B3C] rounded-full flex items-center justify-center text-xs text-white font-medium">
                                {stepIdx + 1}
                              </span>
                              <span className="text-[#94A3B8] pt-0.5">{step}</span>
                            </li>
                          ))}
                        </ol>

                        {item.note && (
                          <div className="flex items-start gap-2 p-3 bg-[#1877F2]/5 border border-[#1877F2]/20 rounded-lg mt-4">
                            <AlertTriangle className="w-5 h-5 text-[#1877F2] flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-[#1877F2]">{item.note}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Navigation */}
                  <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#374151]">
                    {currentIndex > 0 ? (
                      <button
                        onClick={() => setActiveSection(GUIDE_SECTIONS[currentIndex - 1].id)}
                        className="flex items-center gap-2 text-[#B0B3B8] hover:text-white transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>{GUIDE_SECTIONS[currentIndex - 1].title}</span>
                      </button>
                    ) : (
                      <div />
                    )}

                    {currentIndex < GUIDE_SECTIONS.length - 1 ? (
                      <button
                        onClick={() => setActiveSection(GUIDE_SECTIONS[currentIndex + 1].id)}
                        className="flex items-center gap-2 text-[#1877F2] hover:text-white transition-colors"
                      >
                        <span>{GUIDE_SECTIONS[currentIndex + 1].title}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <div />
                    )}
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
