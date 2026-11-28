/**
 * Troubleshooting Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Technical troubleshooting for Club Commander issues
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import { ChevronDown, AlertTriangle, Wifi, Smartphone, Server, Bell, Shield, Clock, Search, CheckCircle, XCircle } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';

const TROUBLESHOOTING_SECTIONS = [
  {
    id: 'connectivity',
    title: 'Connection Issues',
    icon: Wifi,
    issues: [
      {
        title: 'Dashboard Not Loading Or Shows Blank Page',
        severity: 'high',
        symptoms: ['Page Stays Blank', 'Loading Spinner Never Finishes', 'Error Message Displayed'],
        causes: ['Network Connectivity Issue', 'Browser Cache Corruption', 'Server Outage'],
        solutions: [
          {
            step: 'Check Internet Connection',
            details: 'Verify WiFi Is Connected And Has Internet Access. Try Loading Another Website.',
          },
          {
            step: 'Force Refresh The Page',
            details: 'Press Ctrl+Shift+R (Windows) Or Cmd+Shift+R (Mac) To Bypass Cache.',
          },
          {
            step: 'Clear Browser Cache',
            details:
              'Go to browser settings > Privacy > Clear browsing data. Select cached images and files.',
          },
          {
            step: 'Try A Different Browser',
            details: 'If Using Chrome, Try Firefox Or Edge To Rule Out Browser-Specific Issues.',
          },
          {
            step: 'Check System Status',
            details: 'Visit status.smarter.poker To Check For Any Service Outages.',
          },
        ],
      },
      {
        title: 'Real-Time Updates Not Working',
        severity: 'medium',
        symptoms: [
          'Waitlist Not Updating Automatically',
          'Need To Refresh To See Changes',
          'Tournament Clock Frozen',
        ],
        causes: ['WebSocket Connection Lost', 'Firewall Blocking', 'Network Instability'],
        solutions: [
          {
            step: 'Refresh The Page',
            details: 'This Re-Establishes The WebSocket Connection.',
          },
          {
            step: 'Check For Connection Indicator',
            details: 'Look For Connection Status Icon In The Header. Red = Disconnected.',
          },
          {
            step: 'Disable VPN Or Proxy',
            details: 'VPNs can interfere with WebSocket connections. Try disabling temporarily.',
          },
          {
            step: 'Check Firewall Settings',
            details: 'Ensure WebSocket Connections To Supabase.co Are Not Blocked.',
          },
        ],
      },
      {
        title: 'Slow Performance',
        severity: 'low',
        symptoms: ['Pages Take Long To Load', 'Actions Feel Sluggish', 'Timeouts Occurring'],
        causes: ['Poor Network Connection', 'Device Overload', 'Large Data Volume'],
        solutions: [
          {
            step: 'Test Network Speed',
            details: 'Run A Speed Test. Minimum Recommended: 5 Mbps Download.',
          },
          {
            step: 'Close Unnecessary Browser Tabs',
            details: 'Too Many Open Tabs Consume Memory And Slow Down Performance.',
          },
          {
            step: 'Restart The Browser',
            details: 'This Clears Memory And Resets Connections.',
          },
          {
            step: 'Reduce Display Devices',
            details: 'If Running Multiple Displays, Reduce The Number Of Concurrent Connections.',
          },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notification Issues',
    icon: Bell,
    issues: [
      {
        title: 'SMS notifications not being delivered',
        severity: 'high',
        symptoms: [
          'Players Not Receiving Seat Calls',
          'Tournament Reminders Not Arriving',
          'Notification Shows As Sent But Not Received',
        ],
        causes: [
          'Incorrect Phone Number',
          'Carrier Blocking',
          'Twilio Configuration Issue',
          'Player Opted Out',
        ],
        solutions: [
          {
            step: 'Verify Phone Number Format',
            details: 'Ensure Number Includes Country Code And Is In E.164 Format (+1XXXXXXXXXX).',
          },
          {
            step: 'Check Notification History',
            details:
              'Go to player profile > Notification History to see delivery status and any errors.',
          },
          {
            step: 'Test With A Different Number',
            details: 'Send a test notification to your own phone to verify the system is working.',
          },
          {
            step: 'Check Twilio Dashboard',
            details: 'Log Into Twilio To View Message Logs And Identify Delivery Failures.',
          },
          {
            step: 'Verify Player Preferences',
            details: "Ensure The Player Hasn't Disabled SMS Notifications In Their Settings.",
          },
        ],
      },
      {
        title: 'Push Notifications Not Appearing',
        severity: 'medium',
        symptoms: ['App Notifications Not Showing', 'Works On Some Devices But Not Others'],
        causes: ['App Permissions Denied', 'Do Not Disturb Enabled', 'App Not Installed'],
        solutions: [
          {
            step: 'Check App Permissions',
            details: "Go To Phone Settings > Apps > Smarter.Poker > Notifications. Ensure They're Enabled.",
          },
          {
            step: 'Disable Do Not Disturb',
            details: 'Check That DND Is Not Blocking Notifications.',
          },
          {
            step: 'Re-Enable Push Subscription',
            details: 'In The App, Go To Settings > Notifications > Reset Push Notifications.',
          },
          {
            step: 'Reinstall The App',
            details: 'Uninstall And Reinstall To Reset Notification Permissions.',
          },
        ],
      },
      {
        title: 'Duplicate Notifications Being Sent',
        severity: 'low',
        symptoms: [
          'Players Receiving Multiple Identical Messages',
          'Same Notification Appearing Twice',
        ],
        causes: ['API called multiple times', 'System Retry On Timeout'],
        solutions: [
          {
            step: 'Check Notification Logs',
            details: 'Review Audit Logs For Duplicate Send Attempts.',
          },
          {
            step: 'Verify Cooldown Settings',
            details: 'Ensure Notification Cooldown Is Configured (Default: 5 Minutes).',
          },
          {
            step: 'Contact Support',
            details: 'If Duplicates Persist, Report To Support With Specific Timestamps.',
          },
        ],
      },
    ],
  },
  {
    id: 'authentication',
    title: 'Login & Authentication',
    icon: Shield,
    issues: [
      {
        title: 'Staff Cannot Log In',
        severity: 'high',
        symptoms: ['Login Fails With Error', 'Redirected Back To Login Page'],
        causes: ['Wrong Credentials', 'Account Deactivated', 'Session Expired'],
        solutions: [
          {
            step: 'Verify Email Address',
            details: 'Ensure The Correct Email Is Being Used. Check For Typos.',
          },
          {
            step: 'Reset PIN',
            details: 'Manager can reset PIN from Staff page. New PIN sent to staff email.',
          },
          {
            step: 'Check Account Status',
            details: 'Verify The Staff Account Has Not Been Deactivated.',
          },
          {
            step: 'Clear Browser Cookies',
            details: 'Clear Cookies For The Site And Try Logging In Again.',
          },
          {
            step: 'Try Password Reset',
            details: 'Use "Forgot Password" To Reset Account Credentials.',
          },
        ],
      },
      {
        title: 'Session Keeps Expiring',
        severity: 'medium',
        symptoms: ['Frequently Logged Out', 'Need To Re-Authenticate Often'],
        causes: ['Session Timeout Settings', 'Cookie Issues', 'Multiple Tabs'],
        solutions: [
          {
            step: 'Check Session Timeout Setting',
            details: 'Default Is 8 Hours. Manager Can Adjust In Settings > Security.',
          },
          {
            step: 'Ensure Cookies Are Enabled',
            details: 'Browser Must Accept Cookies From smarter.poker Domain.',
          },
          {
            step: 'Use A Single Tab',
            details: 'Multiple Tabs Can Sometimes Cause Session Conflicts.',
          },
        ],
      },
      {
        title: 'Access Denied Errors',
        severity: 'medium',
        symptoms: [
          'FORBIDDEN error when accessing pages',
          'Features Not Visible That Should Be',
        ],
        causes: ['Insufficient Permissions', 'Role Not Assigned Correctly', 'Venue Mismatch'],
        solutions: [
          {
            step: 'Verify Role Assignment',
            details:
              'Check Staff page to confirm correct role is assigned (Owner, Manager, Floor, etc.).',
          },
          {
            step: 'Check Venue Association',
            details: 'Ensure Staff Is Associated With The Correct Venue.',
          },
          {
            step: 'Review Role Permissions',
            details:
              'See Manager Guide for role permission details. Some actions require Manager or Owner role.',
          },
        ],
      },
    ],
  },
  {
    id: 'data',
    title: 'Data Issues',
    icon: Server,
    issues: [
      {
        title: 'Waitlist Data Not Saving',
        severity: 'high',
        symptoms: ['Added Players Disappear', 'Changes Not Persisting', 'Data Reverts To Old State'],
        causes: ['Network Interruption', 'Concurrent Editing Conflict', 'Database Timeout'],
        solutions: [
          {
            step: 'Check For Error Messages',
            details: 'Look For Any Error Toasts Or Console Errors When Saving.',
          },
          {
            step: 'Verify Network Connection',
            details: 'Ensure Stable Internet Connection During Data Entry.',
          },
          {
            step: 'Refresh And Retry',
            details: 'Refresh The Page And Try The Operation Again.',
          },
          {
            step: 'Check Audit Log',
            details: 'Review Audit Log To See If The Action Was Recorded.',
          },
        ],
      },
      {
        title: 'Incorrect Player Counts',
        severity: 'medium',
        symptoms: [
          'Table Shows Wrong Player Count',
          'Waitlist Count Doesn\'t Match Display',
        ],
        causes: ['Sync Issue', 'Cache Stale', 'Race Condition'],
        solutions: [
          {
            step: 'Refresh The Page',
            details: 'Force Refresh With Ctrl+Shift+R To Get Latest Data.',
          },
          {
            step: 'Verify Individual Entries',
            details: 'Click Into The Table/Waitlist To See Actual Entries.',
          },
          {
            step: 'Check For Stuck Entries',
            details: 'Look For Entries That Should Have Been Removed But Weren\'t.',
          },
          {
            step: 'Report To Support',
            details: 'If Count Consistently Wrong, Report With Specific Table/Waitlist ID.',
          },
        ],
      },
      {
        title: 'Export Failing Or Incomplete',
        severity: 'low',
        symptoms: ['Export Times Out', 'Downloaded File Is Empty', 'Missing Data In Export'],
        causes: ['Large Data Volume', 'Network Timeout', 'Filter Misconfiguration'],
        solutions: [
          {
            step: 'Reduce Date Range',
            details: 'Export Smaller Time Periods If Dealing With Large Amounts Of Data.',
          },
          {
            step: 'Check Filter Settings',
            details: 'Verify Filters Aren\'t Excluding The Data You Need.',
          },
          {
            step: 'Try A Different Format',
            details: 'CSV is fastest. Excel (XLSX) may be slower for large datasets.',
          },
          {
            step: 'Wait For Background Processing',
            details: 'Large Exports Are Processed In Background. Check Export Status Page.',
          },
        ],
      },
    ],
  },
  {
    id: 'devices',
    title: 'Device Issues',
    icon: Smartphone,
    issues: [
      {
        title: 'Display Device Showing Wrong Content',
        severity: 'medium',
        symptoms: ['Wrong Venue Displayed', 'Outdated Information Shown', 'Rotation Not Working'],
        causes: ['Device Misconfigured', 'Cache Issue', 'Configuration Changed'],
        solutions: [
          {
            step: 'Check Device Configuration',
            details: 'Go To Displays > Select Device > Verify Settings Are Correct.',
          },
          {
            step: 'Force Refresh Display',
            details: 'Click "Refresh" In Device Management To Push New Configuration.',
          },
          {
            step: 'Restart The Display App',
            details: 'Close And Reopen The Display App On The Device.',
          },
          {
            step: 'Re-Register Device',
            details: 'Delete And Re-Add The Device If Issues Persist.',
          },
        ],
      },
      {
        title: 'Device Showing Offline',
        severity: 'medium',
        symptoms: ['Device Status Shows Offline', 'Last Seen Timestamp Old'],
        causes: ['Network Disconnection', 'App Crashed', 'Device Powered Off'],
        solutions: [
          {
            step: 'Check Physical Device',
            details: 'Verify The Device Is Powered On And Connected To WiFi.',
          },
          {
            step: 'Restart The App',
            details: 'Force Close And Reopen The Display Application.',
          },
          {
            step: 'Check WiFi Connection',
            details: 'Verify Device Can Reach The Internet (Try Opening A Webpage).',
          },
          {
            step: 'Restart Device',
            details: 'Full Device Restart If App Restart Doesn\'t Help.',
          },
        ],
      },
    ],
  },
  {
    id: 'tournaments',
    title: 'Tournament Issues',
    icon: Clock,
    issues: [
      {
        title: 'Tournament Clock Not Syncing',
        severity: 'high',
        symptoms: ['Different Devices Show Different Times', 'Clock Jumps Around'],
        causes: ['Network Latency', 'Server Time Sync Issue', 'Local Time Zone Mismatch'],
        solutions: [
          {
            step: 'Refresh All Displays',
            details: 'Refresh The Tournament Clock On All Devices Simultaneously.',
          },
          {
            step: 'Use Official Clock Only',
            details: 'Designate One Device As The Official Clock Source.',
          },
          {
            step: 'Check Network Latency',
            details: 'High Latency Causes Sync Issues. Ensure Good WiFi Connectivity.',
          },
          {
            step: 'Verify Time Zone',
            details: 'Ensure All Devices Are Set To The Correct Time Zone.',
          },
        ],
      },
      {
        title: 'Cannot Register Players',
        severity: 'high',
        symptoms: ['Registration Button Disabled', 'Error When Registering'],
        causes: ['Registration Closed', 'Tournament Full', 'Player Already Registered'],
        solutions: [
          {
            step: 'Check Tournament Status',
            details: 'Verify Registration Is Still Open (Check Scheduled Times).',
          },
          {
            step: 'Check Capacity',
            details: 'Confirm Tournament Hasn\'t Reached Max Entries.',
          },
          {
            step: 'Search For Existing Entry',
            details: 'Player May Already Be Registered. Search In Entry List.',
          },
          {
            step: 'Check For Exclusion',
            details: 'Player May Be Self-Excluded From The Venue.',
          },
        ],
      },
    ],
  },
];

export default function TroubleshootingPage() {
  useEffect(() => { busEmit.sessionStart('commander-docs-troubleshooting'); }, []);
  const [activeSection, setActiveSection] = useState('connectivity');
  const [expandedIssue, setExpandedIssue] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const currentSection = TROUBLESHOOTING_SECTIONS.find((s) => s.id === activeSection);

  const filteredSections = searchTerm
    ? TROUBLESHOOTING_SECTIONS.map((section) => ({
        ...section,
        issues: section.issues.filter(
          (issue) =>
            issue.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            issue.symptoms.some((s) => s.toLowerCase().includes(searchTerm.toLowerCase())) ||
            issue.causes.some((c) => c.toLowerCase().includes(searchTerm.toLowerCase()))
        ),
      })).filter((section) => section.issues.length > 0)
    : TROUBLESHOOTING_SECTIONS;

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'medium':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'low':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <CommanderLayout title="Troubleshooting Guide" backHref="/commander/dashboard?card=reports">
      <SEOHead
                title="Commander - Troubleshooting"
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
                placeholder="Search Issues..."
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
            <nav className="w-56 flex-shrink-0">
              <div className="cmd-panel p-4 sticky top-24">
                <h2 className="font-semibold text-white mb-4">Categories</h2>
                <ul className="space-y-1">
                  {filteredSections.map((section) => {
                    const Icon = section.icon;
                    return (
                      <li key={section.id}>
                        <button
                          onClick={() => {
                            setActiveSection(section.id);
                            setExpandedIssue(null);
                            setSearchTerm('');
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                            activeSection === section.id && !searchTerm
                              ? 'bg-[#0C55C0]/10 text-[#86DAFF]'
                              : 'text-[#BDD0E2] hover:text-white hover:bg-[#374151]'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-sm">{section.title}</span>
                          {section.issues.length > 0 && (
                            <span className="ml-auto text-xs bg-[#374151] px-2 py-0.5 rounded">
                              {section.issues.length}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              {searchTerm ? (
                // Search Results
                <div className="space-y-4">
                  <p className="text-[#BDD0E2] mb-4">
                    Found{' '}
                    {filteredSections.reduce((sum, s) => sum + s.issues.length, 0)} Issues Matching
                    "{searchTerm}"
                  </p>
                  {filteredSections.flatMap((section) =>
                    section.issues.map((issue, idx) => (
                      <IssueCard
                        key={`${section.id}-${idx}`}
                        issue={issue}
                        isExpanded={expandedIssue === `${section.id}-${idx}`}
                        onToggle={() =>
                          setExpandedIssue(
                            expandedIssue === `${section.id}-${idx}` ? null : `${section.id}-${idx}`
                          )
                        }
                        getSeverityColor={getSeverityColor}
                      />
                    ))
                  )}
                </div>
              ) : currentSection ? (
                // Category View
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-6">
                    {(() => {
                      const Icon = currentSection.icon;
                      return (
                        <div className="w-10 h-10 bg-[#22D3EE]/10 rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-[#22D3EE]" />
                        </div>
                      );
                    })()}
                    <h2 className="text-2xl font-bold text-white">{currentSection.title}</h2>
                  </div>

                  {currentSection.issues.map((issue, idx) => (
                    <IssueCard
                      key={idx}
                      issue={issue}
                      isExpanded={expandedIssue === idx}
                      onToggle={() => setExpandedIssue(expandedIssue === idx ? null : idx)}
                      getSeverityColor={getSeverityColor}
                    />
                  ))}
                </div>
              ) : null}

              {/* Emergency Contact */}
              <div className="mt-8 cmd-panel p-6 border-l-4 border-red-500">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Emergency Support
                </h3>
                <p className="text-[#A9BDD1] mb-4">
                  For Critical Issues Affecting Active Games Or Tournaments:
                </p>
                <div className="space-y-2">
                  <p className="text-white">
                    <strong>Email:</strong> support@smarter.poker
                  </p>
                  <p className="text-white">
                    <strong>Status Page:</strong> status.smarter.poker
                  </p>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </CommanderLayout>
  );
}

function IssueCard({ issue, isExpanded, onToggle, getSeverityColor }) {
  return (
    <div className="cmd-panel overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 text-xs rounded border ${getSeverityColor(issue.severity)}`}>
            {issue.severity}
          </span>
          <span className="font-medium text-white">{issue.title}</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#BDD0E2] flex-shrink-0 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-[#374151]">
          {/* Symptoms */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              Symptoms
            </h4>
            <ul className="list-disc list-inside text-sm text-[#A9BDD1] space-y-1 ml-6">
              {issue.symptoms.map((symptom, idx) => (
                <li key={idx}>{symptom}</li>
              ))}
            </ul>
          </div>

          {/* Causes */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-400" />
              Possible Causes
            </h4>
            <ul className="list-disc list-inside text-sm text-[#A9BDD1] space-y-1 ml-6">
              {issue.causes.map((cause, idx) => (
                <li key={idx}>{cause}</li>
              ))}
            </ul>
          </div>

          {/* Solutions */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Solutions
            </h4>
            <ol className="space-y-3">
              {issue.solutions.map((solution, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-[#0C55C0]/20 rounded-full flex items-center justify-center text-xs text-[#86DAFF] font-medium">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-medium text-white text-sm">{solution.step}</p>
                    <p className="text-sm text-[#BDD0E2] mt-1">{solution.details}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
