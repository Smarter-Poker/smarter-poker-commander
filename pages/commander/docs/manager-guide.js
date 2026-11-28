/**
 * Manager Admin Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Comprehensive guide for venue managers using Club Commander
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
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
          'Log In At /commander/login With Owner Credentials',
          'Navigate To Settings > Venue Configuration',
          'Enter Venue Name, Address, And Contact Information',
          'Upload venue logo (recommended size: 200x200px)',
          'Set Operating Hours For Each Day Of The Week',
          'Save Changes And Verify On Public Venue Page',
        ],
      },
      {
        title: 'Table Configuration',
        steps: [
          'Go To Tables Section From The Sidebar',
          'Click "Add Table" For Each Physical Table',
          'Enter Table Number And Optional Name (e.g., "Feature Table")',
          'Set Maximum Seats (Default: 9)',
          'Add Features If Applicable (USB Ports, Shuffler)',
          'Tables Will Appear In Game Grid After Creation',
        ],
      },
      {
        title: 'Game Types & Stakes',
        steps: [
          'Navigate To Settings > Game Configuration',
          'Enable Game Types Offered (NLH, PLO, Mixed, Etc.)',
          'Add Available Stakes For Each Game Type',
          'Set Default Buy-In Ranges Per Stake Level',
          'Configure Must-Move Rules If Applicable',
        ],
      },
      {
        title: 'Notification Settings',
        steps: [
          'Go To Settings > Notifications',
          'Enable SMS Notifications (Requires Twilio Setup)',
          'Configure Push Notification Preferences',
          'Set Cooldown Periods Between Notifications',
          'Customize Notification Message Templates',
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
          'Navigate To Staff Section',
          'Click "Add Staff Member"',
          'Enter Staff Email (Must Have Smarter.Poker Account)',
          'Select Role: Owner, Manager, Floor, Brush, Or Dealer',
          'Set A 4-6 Digit PIN For Quick Access',
          'Staff Member Receives Email Invitation',
        ],
      },
      {
        title: 'Role Permissions',
        steps: [
          'Owner: Full Access Including Billing And Settings',
          'Manager: Staff Management, Reports, Settings (No Billing)',
          'Floor: Waitlist, Games, Tournaments, Promotions',
          'Brush: Waitlist And Seating Operations Only',
          'Dealer: Tournament Management, Rotation Tracking',
        ],
      },
      {
        title: 'PIN Management',
        steps: [
          'PINs allow quick authentication for tablets/kiosks',
          'To Reset PIN: Staff > Select User > Reset PIN',
          'New PIN Is Sent To Staff Email',
          'PINs expire after 90 days by default (configurable)',
        ],
      },
      {
        title: 'Deactivating Staff',
        steps: [
          'Open Staff Member Profile',
          'Click "Deactivate" (Does Not Delete Data)',
          'Staff Loses Access Immediately',
          'Their Historical Actions Remain In Audit Log',
          'Can Be Reactivated Later If Needed',
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
          'Analytics Page Shows Today\'s Key Metrics',
          'Total Players, Unique Players, New Players',
          'Waitlist Signups By Source (App Vs Walk-In)',
          'Average Wait Times By Game Type',
          'Table Utilization Percentage',
        ],
      },
      {
        title: 'Historical Reports',
        steps: [
          'Use Date Picker To Select Custom Range',
          'Compare To Previous Periods (Week Over Week, Etc.)',
          'Charts Show Trends Over Time',
          'Identify Peak Days And Hours',
          'Track Player Retention Rates',
        ],
      },
      {
        title: 'Exporting Data',
        steps: [
          'Navigate To Reports > Export',
          'Select Data Type (Players, Sessions, Analytics)',
          'Choose Date Range',
          'Select Format (CSV, JSON, Or Excel)',
          'Click "Generate Export"',
          'Download Link Available When Ready',
        ],
        note: 'Exports Are Available For 7 Days After Generation.',
      },
      {
        title: 'Player Analytics',
        steps: [
          'View Individual Player Statistics',
          'Session History And Average Duration',
          'Favorite Games And Stakes',
          'Waitlist Behavior (Shows, No-Shows)',
          'Comp Earnings And Redemptions',
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
        title: 'Creating A High Hand Promotion',
        steps: [
          'Navigate To Promotions > Create New',
          'Select Type: "High Hand"',
          'Enter Promotion Name And Description',
          'Set Start And End Times',
          'Configure Qualifying Games And Stakes',
          'Set Minimum Qualifying Hand (e.g., Aces Full)',
          'Enter Prize Amount Or Progressive Rules',
          'Click "Create Promotion"',
        ],
      },
      {
        title: 'Recurring Promotions',
        steps: [
          'Enable "Recurring" When Creating',
          'Select Days Of The Week',
          'Set Start And End Times For Each Occurrence',
          'Promotion Automatically Activates/Deactivates',
          'Edit Recurring Rules Anytime',
        ],
      },
      {
        title: 'Managing Active Promotions',
        steps: [
          'View All Promotions On Promotions Page',
          'Active Promotions Shown With Green Status',
          'Pause Promotions Without Deleting',
          'Record Winners From Promotion Detail Page',
          'View Winner History And Totals',
        ],
      },
      {
        title: 'Promotion Analytics',
        steps: [
          'Track Promotion Cost Vs Player Engagement',
          'Measure Impact On Table Hours',
          'Compare Similar Promotions Over Time',
          'Identify Most Effective Promotion Types',
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
        title: 'Creating A Tournament',
        steps: [
          'Navigate To Tournaments > Create New',
          'Enter Tournament Name And Description',
          'Select Type: Freezeout, Rebuy, Bounty, Or Satellite',
          'Set Buy-In Amount And House Fee',
          'Configure Starting Chips',
          'Set Scheduled Start Time',
        ],
      },
      {
        title: 'Blind Structure',
        steps: [
          'Use Blind Structure Editor',
          'Add Levels With SB, BB, And Ante',
          'Set Level Duration (Typically 15-30 Min)',
          'Insert Breaks Between Levels',
          'Use Templates For Common Structures',
          'Preview Total Tournament Length',
        ],
      },
      {
        title: 'Payout Structure',
        steps: [
          'Configure Payout Percentages Or Fixed Amounts',
          'Set Number Of Places Paid',
          'System Calculates Actual Payouts From Prize Pool',
          'Adjust For Guaranteed Tournaments',
        ],
      },
      {
        title: 'Running The Tournament',
        steps: [
          'Click "Start Tournament" At Scheduled Time',
          'Clock Begins Automatically',
          'Use Clock Controls: Pause, Resume, Skip Level',
          'Record Eliminations As They Occur',
          'System Handles Rebuy/Addon Windows Automatically',
          'Final Table Auto-Detected',
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
          'Go To Settings > Comp Configuration',
          'Set Earning Rate Per Hour Of Play',
          'Optionally Set Different Rates By Game/Stakes',
          'Configure Tournament Earning Rates',
          'Set Redemption Conversion Ratio',
        ],
      },
      {
        title: 'Issuing Comps',
        steps: [
          'Navigate To Player Profile',
          'Click "Issue Comp"',
          'Enter Dollar Amount',
          'Add Reason/Note',
          'Comp Immediately Available To Player',
        ],
      },
      {
        title: 'Redemption Setup',
        steps: [
          'Configure Redemption Options In Settings',
          'Set Up Restaurant/Food Partner Items',
          'Add Merchandise Options If Applicable',
          'Set Redemption Limits Per Day/Week',
        ],
      },
      {
        title: 'Comp Reports',
        steps: [
          'View Total Comps Issued And Redeemed',
          'Track Outstanding Comp Liability',
          'Identify Top Comp Earners',
          'Monitor Redemption Patterns',
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
          'Navigate To Admin > Audit Logs',
          'View All System Actions With Timestamps',
          'Filter By User, Action Type, Or Date Range',
          'Export Logs For Compliance Purposes',
          'Logs Retained For 90 Days By Default',
        ],
      },
      {
        title: 'Security Audit',
        steps: [
          'Run Security Audit From Admin > Security',
          'Review All Security Checks',
          'Address Any Failed Or Warning Items',
          'Re-Run Audit After Making Changes',
          'Target Score: 90% Or Higher',
        ],
      },
      {
        title: 'API Keys',
        steps: [
          'Generate API Keys For Integrations',
          'Set Specific Permissions Per Key',
          'Configure Rate Limits',
          'Optionally Whitelist IP Addresses',
          'Rotate Keys Periodically For Security',
        ],
      },
      {
        title: 'Responsible Gaming',
        steps: [
          'Review Self-Exclusion Requests',
          'Cannot Be Overridden By Venue Staff',
          'Excluded Players Blocked From Check-In',
          'Reports Available For Gaming Commission',
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
          'Configure Displays At Displays Section',
          'Add Each Tablet/Screen Device',
          'Select Content To Display (Waitlist, Clock, Promos)',
          'Customize Rotation Settings',
          'Monitor Device Health Status',
        ],
      },
      {
        title: 'SMS (Twilio)',
        steps: [
          'Obtain Twilio Account Credentials',
          'Enter Account SID And Auth Token In Settings',
          'Configure Sender Phone Number',
          'Test With A Sample Notification',
          'Monitor SMS Delivery Rates',
        ],
      },
      {
        title: 'Webhooks',
        steps: [
          'Configure Outgoing Webhooks For Events',
          'Receive Real-Time Data At Your Endpoint',
          'Available Events: Waitlist, Seating, Tournaments',
          'Verify Webhook Signatures For Security',
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
          'Verify Staff Email Is Correct',
          'Reset Their PIN If They Can\'t Log In',
          'Check If Account Is Deactivated',
          'Verify Role Has Required Permissions',
          'Check Audit Log For Failed Login Attempts',
        ],
      },
      {
        title: 'Data Discrepancies',
        steps: [
          'Review Audit Log For Changes',
          'Check If Multiple Staff Editing Same Data',
          'Verify Real-Time Sync Is Working',
          'Export Data To Verify Against Source',
          'Contact Support With Audit Log Evidence',
        ],
      },
      {
        title: 'Performance Issues',
        steps: [
          'Check System Health At Admin > Health',
          'Review Recent Error Rates',
          'Check Database Latency Metrics',
          'Clear Browser Cache On Affected Devices',
          'Reduce Concurrent Display Updates If Needed',
        ],
      },
      {
        title: 'Escalation',
        steps: [
          'Document The Issue With Screenshots',
          'Note Exact Time And Affected Users',
          'Check Known Issues At Status Page',
          'Contact Support With Ticket Number',
          'Emergency Contact Available 24/7 For Outages',
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
    <CommanderLayout title="Manager Admin Guide" backHref="/commander/dashboard?card=reports">
      <SEOHead
                title="Commander - Manager Guide"
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
                          <div className="flex items-start gap-2 p-3 bg-[#0C55C0]/5 border border-[#1981EC]/20 rounded-lg mt-4">
                            <AlertTriangle className="w-5 h-5 text-[#86DAFF] flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-[#86DAFF]">{item.note}</p>
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
