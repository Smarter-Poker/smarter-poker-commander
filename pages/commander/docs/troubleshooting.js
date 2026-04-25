/**
 * Troubleshooting Guide
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Technical troubleshooting for Club Commander issues
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import { ChevronLeft, ChevronDown, AlertTriangle, Wifi, Smartphone, Server, Bell, Shield, Clock, Search, CheckCircle, XCircle } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';

const TROUBLESHOOTING_SECTIONS = [
  {
    id: 'connectivity',
    title: 'Connection Issues',
    icon: Wifi,
    issues: [
      {
        title: 'Dashboard not loading or shows blank page',
        severity: 'high',
        symptoms: ['Page stays blank', 'Loading spinner never finishes', 'Error message displayed'],
        causes: ['Network connectivity issue', 'Browser cache corruption', 'Server outage'],
        solutions: [
          {
            step: 'Check internet connection',
            details: 'Verify WiFi is connected and has internet access. Try loading another website.',
          },
          {
            step: 'Force refresh the page',
            details: 'Press Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac) to bypass cache.',
          },
          {
            step: 'Clear browser cache',
            details:
              'Go to browser settings > Privacy > Clear browsing data. Select cached images and files.',
          },
          {
            step: 'Try a different browser',
            details: 'If using Chrome, try Firefox or Edge to rule out browser-specific issues.',
          },
          {
            step: 'Check system status',
            details: 'Visit status.smarter.poker to check for any service outages.',
          },
        ],
      },
      {
        title: 'Real-time updates not working',
        severity: 'medium',
        symptoms: [
          'Waitlist not updating automatically',
          'Need to refresh to see changes',
          'Tournament clock frozen',
        ],
        causes: ['WebSocket connection lost', 'Firewall blocking', 'Network instability'],
        solutions: [
          {
            step: 'Refresh the page',
            details: 'This re-establishes the WebSocket connection.',
          },
          {
            step: 'Check for connection indicator',
            details: 'Look for connection status icon in the header. Red = disconnected.',
          },
          {
            step: 'Disable VPN or proxy',
            details: 'VPNs can interfere with WebSocket connections. Try disabling temporarily.',
          },
          {
            step: 'Check firewall settings',
            details: 'Ensure WebSocket connections to supabase.co are not blocked.',
          },
        ],
      },
      {
        title: 'Slow performance',
        severity: 'low',
        symptoms: ['Pages take long to load', 'Actions feel sluggish', 'Timeouts occurring'],
        causes: ['Poor network connection', 'Device overload', 'Large data volume'],
        solutions: [
          {
            step: 'Test network speed',
            details: 'Run a speed test. Minimum recommended: 5 Mbps download.',
          },
          {
            step: 'Close unnecessary browser tabs',
            details: 'Too many open tabs consume memory and slow down performance.',
          },
          {
            step: 'Restart the browser',
            details: 'This clears memory and resets connections.',
          },
          {
            step: 'Reduce display devices',
            details: 'If running multiple displays, reduce the number of concurrent connections.',
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
          'Players not receiving seat calls',
          'Tournament reminders not arriving',
          'Notification shows as sent but not received',
        ],
        causes: [
          'Incorrect phone number',
          'Carrier blocking',
          'Twilio configuration issue',
          'Player opted out',
        ],
        solutions: [
          {
            step: 'Verify phone number format',
            details: 'Ensure number includes country code and is in E.164 format (+1XXXXXXXXXX).',
          },
          {
            step: 'Check notification history',
            details:
              'Go to player profile > Notification History to see delivery status and any errors.',
          },
          {
            step: 'Test with a different number',
            details: 'Send a test notification to your own phone to verify the system is working.',
          },
          {
            step: 'Check Twilio dashboard',
            details: 'Log into Twilio to view message logs and identify delivery failures.',
          },
          {
            step: 'Verify player preferences',
            details: "Ensure the player hasn't disabled SMS notifications in their settings.",
          },
        ],
      },
      {
        title: 'Push notifications not appearing',
        severity: 'medium',
        symptoms: ['App notifications not showing', 'Works on some devices but not others'],
        causes: ['App permissions denied', 'Do Not Disturb enabled', 'App not installed'],
        solutions: [
          {
            step: 'Check app permissions',
            details: "Go to phone settings > Apps > Smarter.Poker > Notifications. Ensure they're enabled.",
          },
          {
            step: 'Disable Do Not Disturb',
            details: 'Check that DND is not blocking notifications.',
          },
          {
            step: 'Re-enable push subscription',
            details: 'In the app, go to Settings > Notifications > Reset Push Notifications.',
          },
          {
            step: 'Reinstall the app',
            details: 'Uninstall and reinstall to reset notification permissions.',
          },
        ],
      },
      {
        title: 'Duplicate notifications being sent',
        severity: 'low',
        symptoms: [
          'Players receiving multiple identical messages',
          'Same notification appearing twice',
        ],
        causes: ['API called multiple times', 'System retry on timeout'],
        solutions: [
          {
            step: 'Check notification logs',
            details: 'Review audit logs for duplicate send attempts.',
          },
          {
            step: 'Verify cooldown settings',
            details: 'Ensure notification cooldown is configured (default: 5 minutes).',
          },
          {
            step: 'Contact support',
            details: 'If duplicates persist, report to support with specific timestamps.',
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
        title: 'Staff cannot log in',
        severity: 'high',
        symptoms: ['Login fails with error', 'Redirected back to login page'],
        causes: ['Wrong credentials', 'Account deactivated', 'Session expired'],
        solutions: [
          {
            step: 'Verify email address',
            details: 'Ensure the correct email is being used. Check for typos.',
          },
          {
            step: 'Reset PIN',
            details: 'Manager can reset PIN from Staff page. New PIN sent to staff email.',
          },
          {
            step: 'Check account status',
            details: 'Verify the staff account has not been deactivated.',
          },
          {
            step: 'Clear browser cookies',
            details: 'Clear cookies for the site and try logging in again.',
          },
          {
            step: 'Try password reset',
            details: 'Use "Forgot Password" to reset account credentials.',
          },
        ],
      },
      {
        title: 'Session keeps expiring',
        severity: 'medium',
        symptoms: ['Frequently logged out', 'Need to re-authenticate often'],
        causes: ['Session timeout settings', 'Cookie issues', 'Multiple tabs'],
        solutions: [
          {
            step: 'Check session timeout setting',
            details: 'Default is 8 hours. Manager can adjust in Settings > Security.',
          },
          {
            step: 'Ensure cookies are enabled',
            details: 'Browser must accept cookies from smarter.poker domain.',
          },
          {
            step: 'Use a single tab',
            details: 'Multiple tabs can sometimes cause session conflicts.',
          },
        ],
      },
      {
        title: 'Access denied errors',
        severity: 'medium',
        symptoms: [
          'FORBIDDEN error when accessing pages',
          'Features not visible that should be',
        ],
        causes: ['Insufficient permissions', 'Role not assigned correctly', 'Venue mismatch'],
        solutions: [
          {
            step: 'Verify role assignment',
            details:
              'Check Staff page to confirm correct role is assigned (Owner, Manager, Floor, etc.).',
          },
          {
            step: 'Check venue association',
            details: 'Ensure staff is associated with the correct venue.',
          },
          {
            step: 'Review role permissions',
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
        title: 'Waitlist data not saving',
        severity: 'high',
        symptoms: ['Added players disappear', 'Changes not persisting', 'Data reverts to old state'],
        causes: ['Network interruption', 'Concurrent editing conflict', 'Database timeout'],
        solutions: [
          {
            step: 'Check for error messages',
            details: 'Look for any error toasts or console errors when saving.',
          },
          {
            step: 'Verify network connection',
            details: 'Ensure stable internet connection during data entry.',
          },
          {
            step: 'Refresh and retry',
            details: 'Refresh the page and try the operation again.',
          },
          {
            step: 'Check audit log',
            details: 'Review audit log to see if the action was recorded.',
          },
        ],
      },
      {
        title: 'Incorrect player counts',
        severity: 'medium',
        symptoms: [
          'Table shows wrong player count',
          'Waitlist count doesn\'t match display',
        ],
        causes: ['Sync issue', 'Cache stale', 'Race condition'],
        solutions: [
          {
            step: 'Refresh the page',
            details: 'Force refresh with Ctrl+Shift+R to get latest data.',
          },
          {
            step: 'Verify individual entries',
            details: 'Click into the table/waitlist to see actual entries.',
          },
          {
            step: 'Check for stuck entries',
            details: 'Look for entries that should have been removed but weren\'t.',
          },
          {
            step: 'Report to support',
            details: 'If count consistently wrong, report with specific table/waitlist ID.',
          },
        ],
      },
      {
        title: 'Export failing or incomplete',
        severity: 'low',
        symptoms: ['Export times out', 'Downloaded file is empty', 'Missing data in export'],
        causes: ['Large data volume', 'Network timeout', 'Filter misconfiguration'],
        solutions: [
          {
            step: 'Reduce date range',
            details: 'Export smaller time periods if dealing with large amounts of data.',
          },
          {
            step: 'Check filter settings',
            details: 'Verify filters aren\'t excluding the data you need.',
          },
          {
            step: 'Try a different format',
            details: 'CSV is fastest. Excel (XLSX) may be slower for large datasets.',
          },
          {
            step: 'Wait for background processing',
            details: 'Large exports are processed in background. Check export status page.',
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
        title: 'Display device showing wrong content',
        severity: 'medium',
        symptoms: ['Wrong venue displayed', 'Outdated information shown', 'Rotation not working'],
        causes: ['Device misconfigured', 'Cache issue', 'Configuration changed'],
        solutions: [
          {
            step: 'Check device configuration',
            details: 'Go to Displays > Select device > Verify settings are correct.',
          },
          {
            step: 'Force refresh display',
            details: 'Click "Refresh" in device management to push new configuration.',
          },
          {
            step: 'Restart the display app',
            details: 'Close and reopen the display app on the device.',
          },
          {
            step: 'Re-register device',
            details: 'Delete and re-add the device if issues persist.',
          },
        ],
      },
      {
        title: 'Device showing offline',
        severity: 'medium',
        symptoms: ['Device status shows offline', 'Last seen timestamp old'],
        causes: ['Network disconnection', 'App crashed', 'Device powered off'],
        solutions: [
          {
            step: 'Check physical device',
            details: 'Verify the device is powered on and connected to WiFi.',
          },
          {
            step: 'Restart the app',
            details: 'Force close and reopen the display application.',
          },
          {
            step: 'Check WiFi connection',
            details: 'Verify device can reach the internet (try opening a webpage).',
          },
          {
            step: 'Restart device',
            details: 'Full device restart if app restart doesn\'t help.',
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
        title: 'Tournament clock not syncing',
        severity: 'high',
        symptoms: ['Different devices show different times', 'Clock jumps around'],
        causes: ['Network latency', 'Server time sync issue', 'Local time zone mismatch'],
        solutions: [
          {
            step: 'Refresh all displays',
            details: 'Refresh the tournament clock on all devices simultaneously.',
          },
          {
            step: 'Use official clock only',
            details: 'Designate one device as the official clock source.',
          },
          {
            step: 'Check network latency',
            details: 'High latency causes sync issues. Ensure good WiFi connectivity.',
          },
          {
            step: 'Verify time zone',
            details: 'Ensure all devices are set to the correct time zone.',
          },
        ],
      },
      {
        title: 'Cannot register players',
        severity: 'high',
        symptoms: ['Registration button disabled', 'Error when registering'],
        causes: ['Registration closed', 'Tournament full', 'Player already registered'],
        solutions: [
          {
            step: 'Check tournament status',
            details: 'Verify registration is still open (check scheduled times).',
          },
          {
            step: 'Check capacity',
            details: 'Confirm tournament hasn\'t reached max entries.',
          },
          {
            step: 'Search for existing entry',
            details: 'Player may already be registered. Search in entry list.',
          },
          {
            step: 'Check for exclusion',
            details: 'Player may be self-excluded from the venue.',
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
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'low':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <>
      <SEOHead
                title="Commander — Troubleshooting"
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
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-[#F59E0B]" />
                <h1 className="text-xl font-bold text-white">Troubleshooting Guide</h1>
              </div>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0B3B8]" />
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
                              ? 'bg-[#1877F2]/10 text-[#1877F2]'
                              : 'text-[#B0B3B8] hover:text-white hover:bg-[#374151]'
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
                  <p className="text-[#B0B3B8] mb-4">
                    Found{' '}
                    {filteredSections.reduce((sum, s) => sum + s.issues.length, 0)} issues matching
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
                        <CommanderLayout title="Troubleshooting Guide" backHref="/commander/dashboard?card=reports">
                        <div className="w-10 h-10 bg-[#F59E0B]/10 rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-[#F59E0B]" />
                        </div>
                        </CommanderLayout>
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
                <p className="text-[#94A3B8] mb-4">
                  For critical issues affecting active games or tournaments:
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
    </>
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
          className={`w-5 h-5 text-[#B0B3B8] flex-shrink-0 transition-transform ${
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
            <ul className="list-disc list-inside text-sm text-[#94A3B8] space-y-1 ml-6">
              {issue.symptoms.map((symptom, idx) => (
                <li key={idx}>{symptom}</li>
              ))}
            </ul>
          </div>

          {/* Causes */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              Possible Causes
            </h4>
            <ul className="list-disc list-inside text-sm text-[#94A3B8] space-y-1 ml-6">
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
                  <span className="flex-shrink-0 w-6 h-6 bg-[#1877F2]/20 rounded-full flex items-center justify-center text-xs text-[#1877F2] font-medium">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-medium text-white text-sm">{solution.step}</p>
                    <p className="text-sm text-[#B0B3B8] mt-1">{solution.details}</p>
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
