/**
 * Staff Training Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Comprehensive guide for floor staff using Club Commander
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Bell,
  Table,
  Trophy,
  Shield,
  HelpCircle,
  CheckCircle,
  AlertCircle,
  Play,
  Search,
} from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';

const GUIDE_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: Play,
    content: [
      {
        title: 'Logging In',
        steps: [
          'Navigate to /commander/login',
          'Enter your venue email address',
          'Enter your 4-6 digit staff PIN',
          'Click "Sign In" to access the dashboard',
        ],
        note: 'Your PIN is provided by your manager. Contact them if you need to reset it.',
      },
      {
        title: 'Dashboard Overview',
        steps: [
          'The main dashboard shows all active tables and waitlists',
          'Game Grid displays current games with player counts',
          'Waitlist Manager shows all players waiting for seats',
          'Quick Actions provide common tasks (call player, seat player)',
          'Activity Feed shows recent actions and events',
        ],
      },
      {
        title: 'Navigation',
        steps: [
          'Use the sidebar to switch between different sections',
          'Dashboard - Main operational view',
          'Tables - Manage physical tables',
          'Promotions - View and manage active promotions',
          'Reports - Access daily summaries',
        ],
      },
    ],
  },
  {
    id: 'waitlist-management',
    title: 'Waitlist Management',
    icon: Users,
    content: [
      {
        title: 'Adding a Walk-In Player',
        steps: [
          'Click "Add Walk-In" button in the Waitlist Manager',
          'Enter the player\'s name',
          'Enter their phone number (required for notifications)',
          'Select the game type (NLH, PLO, etc.)',
          'Select stakes (1/3, 2/5, etc.)',
          'Click "Add to Waitlist"',
        ],
        note: 'Players with Smarter.Poker accounts can join via the app - they appear automatically.',
      },
      {
        title: 'Calling a Player',
        steps: [
          'Find the player in the waitlist',
          'Click the "Call" button next to their name',
          'Choose notification method (SMS, Push, or Both)',
          'Player receives notification with 5-minute window',
          'Player status changes to "Called"',
        ],
        tip: 'SMS Notifications Go To The Phone Number On File. Ensure It\'s correct.',
      },
      {
        title: 'Seating a Player',
        steps: [
          'After calling, click "Seat" when player arrives',
          'Select the game/table from the dropdown',
          'Choose an available seat number',
          'Optionally enter buy-in amount',
          'Click "Confirm Seat"',
        ],
      },
      {
        title: 'Handling Passed Players',
        steps: [
          'If a player doesn\'t respond, click "Pass"',
          'Choose: Remove from list or Move to bottom',
          'Add optional notes about why they passed',
          'Player is notified of their status change',
        ],
      },
      {
        title: 'Managing Multiple Lists',
        steps: [
          'Each game type/stakes has its own waitlist',
          'Players can be on multiple lists simultaneously',
          'Position is determined by signup time per list',
          'Cross-list view shows all waitlists at once',
        ],
      },
    ],
  },
  {
    id: 'game-operations',
    title: 'Game Operations',
    icon: Table,
    content: [
      {
        title: 'Opening a New Game',
        steps: [
          'Click "Open Game" in the Game Grid',
          'Select the physical table number',
          'Choose game type and stakes',
          'Set minimum and maximum buy-in',
          'Click "Open Game"',
          '9 empty seats are automatically created',
        ],
      },
      {
        title: 'Managing Seats',
        steps: [
          'Click on any table card to view seats',
          'Green seats are empty, blue seats are occupied',
          'Click an empty seat to seat a player directly',
          'Click an occupied seat to view player details',
          'Use "Remove" to remove a player from their seat',
        ],
      },
      {
        title: 'Handling Table Changes',
        steps: [
          'Player requests table change from their phone or verbally',
          'Open the player\'s current seat',
          'Click "Request Table Change"',
          'Player is added to the waitlist for other games',
          'When a seat opens, they\'re automatically notified',
        ],
      },
      {
        title: 'Closing a Game',
        steps: [
          'Ensure all players have cashed out',
          'Click the table card, then "Close Game"',
          'Confirm the closure',
          'Table becomes available for new games',
          'Analytics are recorded for the session',
        ],
      },
      {
        title: 'Must-Move Games',
        steps: [
          'Must-move games feed into a main game',
          'When opening, select "Must-Move" and link to parent game',
          'Players are automatically queued for the main game',
          'When main game has an opening, must-move player is called first',
        ],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: Bell,
    content: [
      {
        title: 'Automatic Notifications',
        steps: [
          'Seat available - Sent when player is called',
          'Tournament starting - 30 min and 5 min warnings',
          'Position update - When waitlist position changes significantly',
          'Promotion alerts - High hand wins, jackpots',
        ],
      },
      {
        title: 'Manual Notifications',
        steps: [
          'Click "Send Message" in player details',
          'Type your custom message',
          'Select channel (SMS or Push)',
          'Click "Send"',
        ],
        note: 'Use sparingly - players can opt out if they receive too many messages.',
      },
      {
        title: 'Notification Troubleshooting',
        steps: [
          'If player says they didn\'t receive: Check phone number is correct',
          'Verify player hasn\'t opted out of notifications',
          'Check notification history in player profile',
          'Try alternate channel (push vs SMS)',
        ],
      },
    ],
  },
  {
    id: 'tournaments',
    title: 'Tournament Support',
    icon: Trophy,
    content: [
      {
        title: 'Registration Duties',
        steps: [
          'Direct app users to register through their phone',
          'For walk-ins, click "Register Player" on tournament page',
          'Enter player name and phone',
          'Collect buy-in and mark as paid',
          'Player receives confirmation notification',
        ],
      },
      {
        title: 'Seating Players',
        steps: [
          'When tournament starts, click "Generate Seating"',
          'System assigns random table/seat',
          'Players can view their assignment in the app',
          'Announce table assignments via PA or display',
        ],
      },
      {
        title: 'During Tournament',
        steps: [
          'Clock is managed by tournament director',
          'Report eliminations via player list',
          'Record any rebuys or add-ons',
          'Update chip counts when requested',
        ],
      },
      {
        title: 'Payouts',
        steps: [
          'System calculates payouts based on structure',
          'Mark players as "Cashed" when eliminated in money',
          'Record payout amounts for tax purposes',
          'High payouts automatically flag for W-2G review',
        ],
      },
    ],
  },
  {
    id: 'promotions',
    title: 'Promotions & High Hands',
    icon: Shield,
    content: [
      {
        title: 'Recording a High Hand',
        steps: [
          'Navigate to Promotions section',
          'Click on active high hand promotion',
          'Click "Record Winner"',
          'Enter player name and table number',
          'Enter hand details (cards shown)',
          'Enter prize amount',
          'Click "Submit" - requires verification',
        ],
        note: 'Always verify the hand with a second staff member.',
      },
      {
        title: 'Verifying High Hands',
        steps: [
          'Check that the hand qualifies (meets minimum)',
          'Verify both hole cards were used',
          'Confirm board cards match',
          'Sign off on the entry',
        ],
      },
      {
        title: 'Promotion Displays',
        steps: [
          'Displays automatically show active promotions',
          'Current high hand leader is displayed',
          'Time remaining until promotion ends',
          'Prize amount is updated in real-time',
        ],
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Common Issues',
    icon: HelpCircle,
    content: [
      {
        title: 'Player Not Receiving Notifications',
        steps: [
          'Verify phone number is correct',
          'Check player hasn\'t opted out (Settings > Notifications)',
          'Try sending a test notification',
          'Check if phone has service',
          'Offer to call them manually as backup',
        ],
      },
      {
        title: 'Waitlist Position Disputes',
        steps: [
          'Show player their signup time in the system',
          'Explain position is based on exact signup time',
          'Show activity log if needed',
          'Manager can adjust position manually if error confirmed',
        ],
      },
      {
        title: 'System Running Slowly',
        steps: [
          'Refresh the browser page',
          'Clear browser cache if issues persist',
          'Check internet connection',
          'Contact support if problem continues',
        ],
      },
      {
        title: 'Player Can\'t Log In',
        steps: [
          'Verify they\'re using correct email',
          'Have them try "Forgot Password"',
          'Check if account is verified',
          'They can use walk-in process as fallback',
        ],
      },
    ],
  },
];

export default function StaffGuidePage() {
  useEffect(() => { busEmit.sessionStart('commander-docs-staff-guide'); }, []);
  const [activeSection, setActiveSection] = useState('getting-started');
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
                title="Commander — Staff Guide"
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
              <h1 className="text-xl font-bold text-white">Staff Training Guide</h1>
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
                        <CommanderLayout title="Staff Training Guide" backHref="/commander/dashboard?card=reports">
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
                          <div className="flex items-start gap-2 p-3 bg-[#1877F2]/5 border border-[#1877F2]/20 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-[#1877F2] flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-[#1877F2]">{item.note}</p>
                          </div>
                        )}

                        {item.tip && (
                          <div className="flex items-start gap-2 p-3 bg-[#31A24C]/5 border border-[#31A24C]/20 rounded-lg">
                            <CheckCircle className="w-5 h-5 text-[#31A24C] flex-shrink-0 mt-0.5" />
                            <p className="text-sm text--[#31A24C]">{item.tip}</p>
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
