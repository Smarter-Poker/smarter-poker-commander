/**
 * Staff Training Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Comprehensive guide for floor staff using Club Commander
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
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
          'Navigate To /commander/login',
          'Enter Your Venue Email Address',
          'Enter Your 4-6 Digit Staff PIN',
          'Click "Sign In" To Access The Dashboard',
        ],
        note: 'Your PIN is provided by your manager. Contact them if you need to reset it.',
      },
      {
        title: 'Dashboard Overview',
        steps: [
          'The Main Dashboard Shows All Active Tables And Waitlists',
          'Game Grid Displays Current Games With Player Counts',
          'Waitlist Manager Shows All Players Waiting For Seats',
          'Quick Actions Provide Common Tasks (Call Player, Seat Player)',
          'Activity Feed Shows Recent Actions And Events',
        ],
      },
      {
        title: 'Navigation',
        steps: [
          'Use The Sidebar To Switch Between Different Sections',
          'Dashboard - Main Operational View',
          'Tables - Manage Physical Tables',
          'Promotions - View And Manage Active Promotions',
          'Reports - Access Daily Summaries',
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
        title: 'Adding A Walk-In Player',
        steps: [
          'Click "Add Walk-In" Button In The Waitlist Manager',
          'Enter The Player\'s Name',
          'Enter Their Phone Number (Required For Notifications)',
          'Select The Game Type (NLH, PLO, Etc.)',
          'Select Stakes (1/3, 2/5, Etc.)',
          'Click "Add To Waitlist"',
        ],
        note: 'Players With Smarter.Poker Accounts Can Join Via The App - They Appear Automatically.',
      },
      {
        title: 'Calling A Player',
        steps: [
          'Find The Player In The Waitlist',
          'Click The "Call" Button Next To Their Name',
          'Choose Notification Method (SMS, Push, Or Both)',
          'Player Receives Notification With 5-Minute Window',
          'Player Status Changes To "Called"',
        ],
        tip: 'SMS Notifications Go To The Phone Number On File. Ensure It\'s correct.',
      },
      {
        title: 'Seating A Player',
        steps: [
          'After Calling, Click "Seat" When Player Arrives',
          'Select The Game/Table From The Dropdown',
          'Choose An Available Seat Number',
          'Optionally Enter Buy-In Amount',
          'Click "Confirm Seat"',
        ],
      },
      {
        title: 'Handling Passed Players',
        steps: [
          'If A Player Doesn\'t Respond, Click "Pass"',
          'Choose: Remove From List Or Move To Bottom',
          'Add Optional Notes About Why They Passed',
          'Player Is Notified Of Their Status Change',
        ],
      },
      {
        title: 'Managing Multiple Lists',
        steps: [
          'Each Game Type/Stakes Has Its Own Waitlist',
          'Players Can Be On Multiple Lists Simultaneously',
          'Position Is Determined By Signup Time Per List',
          'Cross-List View Shows All Waitlists At Once',
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
        title: 'Opening A New Game',
        steps: [
          'Click "Open Game" In The Game Grid',
          'Select The Physical Table Number',
          'Choose Game Type And Stakes',
          'Set Minimum And Maximum Buy-In',
          'Click "Open Game"',
          '9 empty seats are automatically created',
        ],
      },
      {
        title: 'Managing Seats',
        steps: [
          'Click On Any Table Card To View Seats',
          'Green Seats Are Empty, Blue Seats Are Occupied',
          'Click An Empty Seat To Seat A Player Directly',
          'Click An Occupied Seat To View Player Details',
          'Use "Remove" To Remove A Player From Their Seat',
        ],
      },
      {
        title: 'Handling Table Changes',
        steps: [
          'Player Requests Table Change From Their Phone Or Verbally',
          'Open The Player\'s Current Seat',
          'Click "Request Table Change"',
          'Player Is Added To The Waitlist For Other Games',
          'When A Seat Opens, They\'re Automatically Notified',
        ],
      },
      {
        title: 'Closing A Game',
        steps: [
          'Ensure All Players Have Cashed Out',
          'Click The Table Card, Then "Close Game"',
          'Confirm The Closure',
          'Table Becomes Available For New Games',
          'Analytics Are Recorded For The Session',
        ],
      },
      {
        title: 'Must-Move Games',
        steps: [
          'Must-Move Games Feed Into A Main Game',
          'When Opening, Select "Must-Move" And Link To Parent Game',
          'Players Are Automatically Queued For The Main Game',
          'When Main Game Has An Opening, Must-Move Player Is Called First',
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
          'Seat Available - Sent When Player Is Called',
          'Tournament Starting - 30 Min And 5 Min Warnings',
          'Position Update - When Waitlist Position Changes Significantly',
          'Promotion Alerts - High Hand Wins, Jackpots',
        ],
      },
      {
        title: 'Manual Notifications',
        steps: [
          'Click "Send Message" In Player Details',
          'Type Your Custom Message',
          'Select Channel (SMS Or Push)',
          'Click "Send"',
        ],
        note: 'Use Sparingly - Players Can Opt Out If They Receive Too Many Messages.',
      },
      {
        title: 'Notification Troubleshooting',
        steps: [
          'If Player Says They Didn\'t Receive: Check Phone Number Is Correct',
          'Verify Player Hasn\'t Opted Out Of Notifications',
          'Check Notification History In Player Profile',
          'Try Alternate Channel (Push Vs SMS)',
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
          'Direct App Users To Register Through Their Phone',
          'For Walk-Ins, Click "Register Player" On Tournament Page',
          'Enter Player Name And Phone',
          'Collect Buy-In And Mark As Paid',
          'Player Receives Confirmation Notification',
        ],
      },
      {
        title: 'Seating Players',
        steps: [
          'When Tournament Starts, Click "Generate Seating"',
          'System Assigns Random Table/Seat',
          'Players Can View Their Assignment In The App',
          'Announce Table Assignments Via PA Or Display',
        ],
      },
      {
        title: 'During Tournament',
        steps: [
          'Clock Is Managed By Tournament Director',
          'Report Eliminations Via Player List',
          'Record Any Rebuys Or Add-Ons',
          'Update Chip Counts When Requested',
        ],
      },
      {
        title: 'Payouts',
        steps: [
          'System Calculates Payouts Based On Structure',
          'Mark Players As "Cashed" When Eliminated In Money',
          'Record Payout Amounts For Tax Purposes',
          'High Payouts Automatically Flag For W-2G Review',
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
        title: 'Recording A High Hand',
        steps: [
          'Navigate To Promotions Section',
          'Click On Active High Hand Promotion',
          'Click "Record Winner"',
          'Enter Player Name And Table Number',
          'Enter Hand Details (Cards Shown)',
          'Enter Prize Amount',
          'Click "Submit" - Requires Verification',
        ],
        note: 'Always Verify The Hand With A Second Staff Member.',
      },
      {
        title: 'Verifying High Hands',
        steps: [
          'Check That The Hand Qualifies (Meets Minimum)',
          'Verify Both Hole Cards Were Used',
          'Confirm Board Cards Match',
          'Sign Off On The Entry',
        ],
      },
      {
        title: 'Promotion Displays',
        steps: [
          'Displays Automatically Show Active Promotions',
          'Current High Hand Leader Is Displayed',
          'Time Remaining Until Promotion Ends',
          'Prize Amount Is Updated In Real-Time',
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
          'Verify Phone Number Is Correct',
          'Check Player Hasn\'t Opted Out (Settings > Notifications)',
          'Try Sending A Test Notification',
          'Check If Phone Has Service',
          'Offer To Call Them Manually As Backup',
        ],
      },
      {
        title: 'Waitlist Position Disputes',
        steps: [
          'Show Player Their Signup Time In The System',
          'Explain Position Is Based On Exact Signup Time',
          'Show Activity Log If Needed',
          'Manager Can Adjust Position Manually If Error Confirmed',
        ],
      },
      {
        title: 'System Running Slowly',
        steps: [
          'Refresh The Browser Page',
          'Clear Browser Cache If Issues Persist',
          'Check Internet Connection',
          'Contact Support If Problem Continues',
        ],
      },
      {
        title: 'Player Can\'t Log In',
        steps: [
          'Verify They\'re Using Correct Email',
          'Have Them Try "Forgot Password"',
          'Check If Account Is Verified',
          'They Can Use Walk-In Process As Fallback',
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
    <CommanderLayout title="Staff Training Guide" backHref="/commander/dashboard?card=reports">
      <SEOHead
                title="Commander - Staff Guide"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />

      <div className="cmd-page min-h-screen">
        {/* Header */}
        <header className="cmd-header-bar sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="relative w-64 ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#BDD0E2]" />
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
                              ? 'bg-[#0C55C0]/10 text-[#86DAFF]'
                              : 'text-[#BDD0E2] hover:text-white hover:bg-[#374151]'
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
                        <div className="w-10 h-10 bg-[#0C55C0]/10 rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-[#86DAFF]" />
                        </div>
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
                              <span className="flex-shrink-0 w-6 h-6 bg-[#132A42] rounded-full flex items-center justify-center text-xs text-white font-medium">
                                {stepIdx + 1}
                              </span>
                              <span className="text-[#A9BDD1] pt-0.5">{step}</span>
                            </li>
                          ))}
                        </ol>

                        {item.note && (
                          <div className="flex items-start gap-2 p-3 bg-[#0C55C0]/5 border border-[#1981EC]/20 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-[#86DAFF] flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-[#86DAFF]">{item.note}</p>
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
                        className="flex items-center gap-2 text-[#BDD0E2] hover:text-white transition-colors"
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
                        className="flex items-center gap-2 text-[#86DAFF] hover:text-white transition-colors"
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
    </CommanderLayout>
  );
}
