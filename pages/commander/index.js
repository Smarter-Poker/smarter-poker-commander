/**
 * Club Commander - Marketing Landing Page
 * Public page for poker rooms to learn about and sign up for Commander
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Users, Clock, Trophy, Monitor, Check, Play, Star, ArrowRight, Zap, Shield, BarChart3, Bell, Gift, Home } from 'lucide-react';
import { COMMANDER_FREE_MODE, COMMANDER_FREE_TAGLINE } from '../../src/lib/commander/tierConfig';

const FEATURES = [
  {
    icon: Users,
    title: 'Digital Waitlist',
    description: 'Players Join From Their Phone. Staff Manage Everything From One Screen. no More Paper Lists.'
  },
  {
    icon: Clock,
    title: 'Smart Wait Times',
    description: 'AI-powered Predictions Tell Players Exactly When Their Seat Will Be Ready.'
  },
  {
    icon: Bell,
    title: 'SMS & Push Notifications',
    description: 'Automatic Alerts When Seats Are Ready. Players Can Shop, Eat, or Wait at the Bar.'
  },
  {
    icon: Trophy,
    title: 'Tournament Management',
    description: 'Full Tournament System with Clock, Blind Structures, Registration, and Hendon Mob Export.'
  },
  {
    icon: Gift,
    title: 'Promotions & Comps',
    description: 'High Hand Jackpots, Happy Hours, and Automated Comp Tracking Based on Play Time.'
  },
  {
    icon: BarChart3,
    title: 'Analytics Dashboard',
    description: 'Track Player Visits, Table Hours, Revenue Trends, and More in Real-time.'
  },
  {
    icon: Home,
    title: 'Home Games',
    description: 'Let Players Organize and Discover Home Games. QR Codes and Invite Codes Make Joining Easy.'
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'Row-level Security, Audit Logs, Rate Limiting, and API Key Management for Integrations.'
  }
];

const PRICING = [
  {
    name: 'Home Game',
    price: COMMANDER_FREE_MODE ? 'Free' : '$99',
    period: COMMANDER_FREE_MODE ? '' : '/month',
    description: 'Perfect for Home Games & Small Private Events',
    features: [
      'Up to 5 tables',
      'Digital waitlist',
      'Tournament management',
      'Free member cards',
      'Basic analytics',
      'Social Hub page',
      'SMS notifications (100/mo)'
    ],
    cta: 'Get Started',
    highlighted: false
  },
  {
    name: 'Charity',
    price: COMMANDER_FREE_MODE ? 'Free' : '$199',
    period: COMMANDER_FREE_MODE ? '' : '/month',
    description: 'Full Operations Suite for Charity Poker Rooms',
    features: [
      'Everything in Home Game',
      'Up to 15 tables',
      'Floor view & map',
      'Dealer rotation',
      'Player kiosk & displays',
      'Staff accounts & scheduling',
      'Promotions engine',
      'Advanced analytics & reports',
      'SMS notifications (500/mo)'
    ],
    cta: COMMANDER_FREE_MODE ? 'Get Started Free' : 'Start Free Trial',
    highlighted: true
  },
  {
    name: 'Club',
    price: COMMANDER_FREE_MODE ? 'Free' : '$399',
    period: COMMANDER_FREE_MODE ? '' : '/month',
    description: 'Full Texas-style Card Room with Revenue Tools',
    features: [
      'Everything in Charity',
      'Unlimited tables & staff',
      'Paid memberships (fees)',
      'Time-based seat billing',
      'Unlimited SMS',
      'Priority support'
    ],
    cta: COMMANDER_FREE_MODE ? 'Get Started Free' : 'Start Free Trial',
    highlighted: false
  }
];

const TESTIMONIALS = [
  {
    quote: "We cut our waitlist chaos in half. Players love getting texts when their seat is ready.",
    author: "Mike R.",
    role: "Floor Manager, Texas Card House",
    rating: 5
  },
  {
    quote: "The tournament clock alone is worth it. Export to Hendon Mob with one click saved us hours.",
    author: "Sarah L.",
    role: "Tournament Director, Bay 101",
    rating: 5
  },
  {
    quote: "Finally a modern system that doesn't cost $10k. Our players think we're a big casino now.",
    author: "James T.",
    role: "Owner, Private Club",
    rating: 5
  }
];

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="cmd-panel p-6 hover:border-[#1877F2]/30 transition-all">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ backgroundColor: '#1877F220' }}
      >
        <Icon size={24} style={{ color: '#1877F2' }} />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-[#B0B3B8]">{description}</p>
    </div>
  );
}

function PricingCard({ plan, highlighted, onAction }) {
  return (
    <div
      className={`p-6 rounded-2xl border ${highlighted
        ? 'border-[#1877F2] ring-2 ring-[#1877F2] ring-opacity-50 bg-[#0F2A3E]'
        : 'border-[#3A3B3C] bg-[#0F1D32]'
        }`}
    >
      {highlighted && (
        <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-[#1877F2]/10 text-[#1877F2] mb-4">
          Most Popular
        </span>
      )}
      <h3 className="text-xl font-bold text-white">{plan.name}</h3>
      <div className="mt-2 mb-4">
        <span className="text-4xl font-bold text-white">{plan.price}</span>
        {plan.period && <span className="text-[#B0B3B8]">{plan.period}</span>}
      </div>
      <p className="text-[#B0B3B8] mb-6">{plan.description}</p>
      <ul className="space-y-3 mb-6">
        {plan.features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check size={18} className="text-[#31A24C] flex-shrink-0 mt-0.5" />
            <span className="text-[#94A3B8]">{feature}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onAction?.(plan)}
        className={`w-full py-3 rounded-xl font-medium transition-colors ${highlighted
          ? 'cmd-btn cmd-btn-primary'
          : 'cmd-btn cmd-btn-secondary'
          }`}
      >
        {plan.cta}
      </button>
    </div>
  );
}

export default function CommanderLanding() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [showDemo, setShowDemo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleGetStarted() {
    router.push('/commander/onboarding');
  }

  function handleFreeTrial() {
    router.push('/commander/onboarding?plan=pro');
  }

  function handleContactSales() {
    window.location.href = 'mailto:sales@smarter.poker?subject=Commander Enterprise Inquiry';
  }

  function handleWatchDemo() {
    setShowDemo(true);
  }

  function handlePricingAction(plan) {
    if (plan.name === 'Home Game') {
      handleGetStarted();
    } else if (plan.name === 'Charity') {
      handleFreeTrial();
    } else if (plan.name === 'Club') {
      handleFreeTrial();
    }
  }

  async function handleEmailSubmit(signal) {
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      // Store lead email
      const res = await fetch('/api/commander/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing_page' })
      });
      if (res.ok) {
        router.push(`/commander/onboarding?email=${encodeURIComponent(email)}`);
      } else {
        router.push('/commander/onboarding');
      }
    } catch (err) {
      console.warn('Submit error:', err);
      router.push('/commander/onboarding');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SEOHead
                title="Club Commander — Poker Room Management Suite"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />

      <div className="min-h-screen" style={{ fontFamily: 'Inter, sans-serif', backgroundColor: '#18191A' }}>
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 bg-[#0F1D32]/80 backdrop-blur-md z-50 border-b border-[#3A3B3C]">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: '#1877F2' }}
              >
                <Zap size={24} className="text-white" />
              </div>
              <span className="text-xl font-bold text-white">Club Commander</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-[#B0B3B8] hover:text-white">Features</a>
              <a href="#pricing" className="text-[#B0B3B8] hover:text-white">Pricing</a>
              <a href="#testimonials" className="text-[#B0B3B8] hover:text-white">Reviews</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/commander/login" className="text-[#B0B3B8] hover:text-white">
                Staff Login
              </Link>
              <button
                onClick={handleGetStarted}
                className="cmd-btn cmd-btn-primary"
              >
                Get Started
              </button>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section className="pt-32 pb-20 px-4 bg-[#18191A]">
          <div className="max-w-7xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-6">
              Poker Room Management
              <br />
              <span style={{ color: '#1877F2' }}>Made Simple</span>
            </h1>
            <p className="text-xl text-[#B0B3B8] max-w-2xl mx-auto mb-8">
              Digital waitlists, tournament clocks, player comps, and analytics.
              Everything you need to run a modern poker room.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <button
                onClick={handleFreeTrial}
                className="cmd-btn cmd-btn-primary px-8 py-4 text-lg flex items-center gap-2"
              >
                {COMMANDER_FREE_MODE ? 'Get Started Free' : 'Start Free Trial'}
                <ArrowRight size={20} />
              </button>
              <button
                onClick={handleWatchDemo}
                className="cmd-btn cmd-btn-secondary px-8 py-4 text-lg flex items-center gap-2"
              >
                <Play size={20} />
                Watch Demo
              </button>
            </div>

            {/* Hero Feature Showcase */}
            <div className="max-w-5xl mx-auto rounded-2xl shadow-2xl overflow-hidden border border-[#3A3B3C] bg-[#0F1D32]">
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#3A3B3C]">
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#1877F220' }}>
                    <Users size={28} style={{ color: '#1877F2' }} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Waitlist Management</h3>
                  <p className="text-sm text-[#B0B3B8]">Players Join Digitally From Anywhere. Real-Time Position Updates And SMS Alerts When Seats Open.</p>
                </div>
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#1877F220' }}>
                    <Monitor size={28} style={{ color: '#1877F2' }} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Table Tracking</h3>
                  <p className="text-sm text-[#B0B3B8]">Live View Of Every Table, Game Type, Stakes, And Seat Availability. One Dashboard For Your Entire Floor.</p>
                </div>
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#1877F220' }}>
                    <Trophy size={28} style={{ color: '#1877F2' }} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Tournament System</h3>
                  <p className="text-sm text-[#B0B3B8]">Built-In Clock, Blind Structures, Registration, And One-Click Hendon Mob Export.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <section className="py-12 border-y border-[#3A3B3C] bg-[#0F1D32]">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-16">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">500+</p>
                <p className="text-sm text-[#B0B3B8]">Poker Rooms</p>
              </div>
              <div className="hidden sm:block w-px h-10 bg-[#3A3B3C]" />
              <div className="text-center">
                <p className="text-3xl font-bold text-white">50,000+</p>
                <p className="text-sm text-[#B0B3B8]">Players Served</p>
              </div>
              <div className="hidden sm:block w-px h-10 bg-[#3A3B3C]" />
              <div className="text-center">
                <p className="text-3xl font-bold text-white">1M+</p>
                <p className="text-sm text-[#B0B3B8]">Waitlist Entries</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20 px-4 bg-[#0F1D32]">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Everything Your Poker Room Needs
              </h2>
              <p className="text-xl text-[#B0B3B8] max-w-2xl mx-auto">
                From waitlist management to tournament operations, we've got you covered.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {FEATURES.map((feature, i) => (
                <FeatureCard key={i} {...feature} />
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-20 px-4 bg-[#18191A]">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Simple, Transparent Pricing
              </h2>
              <p className="text-xl text-[#B0B3B8] max-w-2xl mx-auto">
                Start free, upgrade as you grow. No hidden fees.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {PRICING.map((plan, i) => (
                <PricingCard key={i} plan={plan} highlighted={plan.highlighted} onAction={handlePricingAction} />
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="py-20 px-4 bg-[#0F1D32]">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Loved by Poker Rooms
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {TESTIMONIALS.map((t, i) => (
                <div key={i} className="cmd-panel p-6">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} size={18} fill="#F59E0B" className="text-yellow-500" />
                    ))}
                  </div>
                  <p className="text-[#94A3B8] mb-4">"{t.quote}"</p>
                  <div>
                    <p className="font-semibold text-white">{t.author}</p>
                    <p className="text-sm text-[#B0B3B8]">{t.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cmd-header-full py-20 px-4">
          <div className="max-w-3xl mx-auto text-center text-white">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to Modernize Your Poker Room?
            </h2>
            <p className="text-xl opacity-90 mb-8">
              Join hundreds of poker rooms already using Club Commander.
              Start your free trial today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <input
                type="email"
                placeholder="Enter Your Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
                className="cmd-input w-full sm:w-80"
              />
              <button
                onClick={handleEmailSubmit}
                disabled={submitting}
                className="w-full sm:w-auto px-8 py-3 rounded-xl bg-white text-[#18191A] font-semibold hover:bg-gray-100 disabled:opacity-50"
              >
                {submitting ? 'Loading...' : 'Get Started'}
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-4 bg-[#070D1A] text-[#B0B3B8]">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#1877F2]">
                  <Zap size={18} className="text-white" />
                </div>
                <span className="font-bold text-white">Club Commander</span>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <Link href="/terms" className="hover:text-white">Privacy</Link>
                <Link href="/terms" className="hover:text-white">Terms</Link>
                <a href="mailto:support@smarter.poker" className="hover:text-white">Support</a>
                <a href="mailto:contact@smarter.poker" className="hover:text-white">Contact</a>
              </div>
              <p className="text-sm">Part Of Smarter.Poker</p>
            </div>
          </div>
        </footer>

        {/* Demo Modal */}
        {showDemo && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="cmd-panel cmd-corner-lights w-full max-w-4xl">
              <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
                <h3 className="text-lg font-semibold text-white">Club Commander Demo</h3>
                <button
                  onClick={() => setShowDemo(false)}
                  className="p-2 hover:bg-[#3A3B3C] rounded-lg text-[#B0B3B8]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="bg-[#070D1A] p-6">
                <h4 className="text-lg font-semibold text-white mb-4 text-center">Platform Feature Highlights</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <Users size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">Digital Waitlist</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <Clock size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">AI Wait Times</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <Trophy size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">Tournaments</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <Bell size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">SMS Alerts</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <BarChart3 size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">Analytics</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0F1D32] border border-[#3A3B3C] text-center">
                    <Gift size={28} className="mx-auto mb-2 text-[#1877F2]" />
                    <p className="text-sm font-medium text-white">Promotions</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm text-[#B0B3B8] mb-3">{COMMANDER_FREE_MODE ? 'Experience The Full Platform - Free While In Beta' : 'Experience The Full Platform With A Free Trial'}</p>
                  <button
                    onClick={() => {
                      setShowDemo(false);
                      handleFreeTrial();
                    }}
                    className="cmd-btn cmd-btn-primary"
                  >
                    {COMMANDER_FREE_MODE ? 'Get Started Free' : 'Start Free Trial'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
