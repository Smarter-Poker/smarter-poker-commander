/**
 * Documentation Index
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.4
 *
 * Central hub for all Commander documentation
 */
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { Users, Settings, HelpCircle, AlertTriangle, ExternalLink, FileText } from 'lucide-react';
import { useEffect } from 'react';
import { busEmit } from '../../../src/engine/EventBus';

const DOCUMENTATION = [
  {
    id: 'staff-guide',
    title: 'Staff Training Guide',
    description: 'Learn How to Manage Waitlists, Seat Players, Handle Notifications, and Support Tournaments as Floor Staff.',
    icon: Users,
    href: '/commander/docs/staff-guide',
    audience: 'Floor Staff, Brush',
    sections: ['Getting Started', 'Waitlist Management', 'Game Operations', 'Notifications', 'Tournament Support', 'Promotions'],
  },
  {
    id: 'manager-guide',
    title: 'Manager Admin Guide',
    description: 'Configure Your Venue, Manage Staff, Set up Promotions, and Access Analytics and Reports.',
    icon: Settings,
    href: '/commander/docs/manager-guide',
    audience: 'Managers, Owners',
    sections: ['Venue Setup', 'Staff Management', 'Analytics', 'Promotions', 'Tournaments', 'Security'],
  },
  {
    id: 'faq',
    title: 'Player FAQ',
    description: 'Answers to Common Questions About Using Club Commander as a Player.',
    icon: HelpCircle,
    href: '/hub/commander/faq',
    audience: 'Players',
    sections: ['Waitlist', 'Notifications', 'Tournaments', 'Home Games', 'Rewards', 'Account'],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting Guide',
    description: 'Diagnose and Resolve Common Technical Issues with Step-by-step Solutions.',
    icon: AlertTriangle,
    href: '/commander/docs/troubleshooting',
    audience: 'All Staff',
    sections: ['Connectivity', 'Notifications', 'Authentication', 'Data Issues', 'Devices', 'Tournaments'],
  },
];

const QUICK_LINKS = [
  { label: 'API Documentation', href: '/commander/docs/api', icon: FileText },
  { label: 'Status Page', href: 'https://status.smarter.poker', icon: ExternalLink, external: true },
  { label: 'Contact Support', href: 'mailto:support@smarter.poker', icon: ExternalLink, external: true },
];

export default function DocumentationIndexPage() {
  useEffect(() => { busEmit.sessionStart('commander-docs-index'); }, []);
  return (
    <CommanderLayout title="Documentation | Commander" backHref="/commander/dashboard">
      <SEOHead
        title="Commander — Documentation"
        description="Club Commander Documentation Hub."
        noindex={true}
      />

      <div className="cmd-page min-h-screen">

        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Hero */}
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Club Commander Documentation</h2>
            <p className="text-[#94A3B8] max-w-2xl mx-auto">
              Everything you need to know about using Club Commander. Select a guide below based on your role.
            </p>
          </div>

          {/* Documentation Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {DOCUMENTATION.map((doc) => {
              const Icon = doc.icon;
              return (
                <Link
                  key={doc.id}
                  href={doc.href}
                  className="cmd-panel p-6 hover:border-[#1877F2]/50 transition-colors group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#1877F2]/10 rounded-lg flex items-center justify-center group-hover:bg-[#1877F2]/20 transition-colors">
                      <Icon className="w-6 h-6 text-[#1877F2]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-[#1877F2] transition-colors">
                        {doc.title}
                      </h3>
                      <p className="text-[#B0B3B8] text-sm mb-3">{doc.description}</p>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs bg-[#374151] text-[#94A3B8] px-2 py-1 rounded">
                          {doc.audience}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {doc.sections.slice(0, 4).map((section, idx) => (
                          <span
                            key={idx}
                            className="text-xs text-[#B0B3B8] bg-[#1E293B] px-2 py-0.5 rounded"
                          >
                            {section}
                          </span>
                        ))}
                        {doc.sections.length > 4 && (
                          <span className="text-xs text-[#B0B3B8]">
                            +{doc.sections.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Quick Links */}
          <div className="cmd-panel p-6">
            <h3 className="font-semibold text-white mb-4">Quick Links</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              {QUICK_LINKS.map((link, idx) => {
                const Icon = link.icon;
                const LinkComponent = link.external ? 'a' : Link;
                const linkProps = link.external
                  ? { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
                  : { href: link.href };

                return (
                  <LinkComponent
                    key={idx}
                    {...linkProps}
                    className="flex items-center gap-3 p-3 bg-[#1E293B] rounded-lg hover:bg-[#374151] transition-colors"
                  >
                    <Icon className="w-5 h-5 text-[#B0B3B8]" />
                    <span className="text-[#94A3B8]">{link.label}</span>
                    {link.external && <ExternalLink className="w-4 h-4 text-[#B0B3B8] ml-auto" />}
                  </LinkComponent>
                );
              })}
            </div>
          </div>

          {/* Need Help */}
          <div className="text-center mt-12">
            <p className="text-[#B0B3B8] mb-4">Can't Find What You're Looking For?</p>
            <a
              href="mailto:support@smarter.poker"
              className="cmd-btn cmd-btn-primary inline-flex items-center gap-2"
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </CommanderLayout>
  );
}
