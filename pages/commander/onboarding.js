/**
 * Venue Onboarding Page
 * New venue signup and demo request flow
 * Per IMPLEMENTATION_PHASES.md Step 6.5
 * Dark industrial sci-fi gaming theme
 */
import { useState } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import Head from 'next/head';
import Link from 'next/link';
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  User,
  Check,
  Loader2,
  ArrowRight,
  ChevronLeft,
  Clock,
  Users,
  BarChart3,
  Shield,
  Smartphone,
  Zap,
  Tag
} from 'lucide-react';

const FEATURES = [
  {
    icon: Users,
    title: 'Digital Waitlist',
    description: 'Let Players Join From Anywhere with Real-time Position Updates'
  },
  {
    icon: Clock,
    title: 'AI Wait Predictions',
    description: 'Smart Predictions Help Players Plan Their Visit'
  },
  {
    icon: BarChart3,
    title: 'Analytics Dashboard',
    description: 'Track Player Traffic, Table Utilization, and Trends'
  },
  {
    icon: Shield,
    title: 'Responsible Gaming',
    description: 'Built-in Tools for Player Protection and Compliance'
  },
  {
    icon: Smartphone,
    title: 'Mobile-First',
    description: 'Works on Any Device - no App Download Required'
  },
  {
    icon: Zap,
    title: 'Real-Time Updates',
    description: 'Instant Notifications Keep Players Informed'
  }
];

const STEPS = [
  { id: 1, label: 'Submit Request' },
  { id: 2, label: 'Demo Call' },
  { id: 3, label: 'Agreement' },
  { id: 4, label: 'Setup' },
  { id: 5, label: 'Go Live' }
];

export default function VenueOnboardingPage() {
  const [step, setStep] = useState('info');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    venueName: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    tableCount: '',
    currentSystem: '',
    notes: '',
    promoCode: ''
  });

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/commander/onboarding/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      // HIGH FIX #2d: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.message || 'Failed to submit. Please try again.');
      }
    } catch (err) {
      console.warn('Submit failed:', err);
      setError('Failed to submit. Please try again.');
      setSubmitted(false);
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <>
        <SEOHead
          title="Club Commander — Onboarding"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="cmd-page flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 bg-[#31A24C] rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Request Submitted</h1>
            <p className="text-[#B0B3B8] mb-6">
              Thank you for your interest in Club Commander. Our team will contact you within 1 business day to schedule a demo.
            </p>

            <div className="cmd-panel p-4 mb-6">
              <h3 className="font-medium text-white mb-3">What Happens Next?</h3>
              <div className="space-y-3 text-left">
                {STEPS.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${i === 0 ? 'bg-[#31A24C] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                      }`}>
                      {i === 0 ? <Check className="w-3 h-3" /> : s.id}
                    </div>
                    <span className={i === 0 ? 'text-[#31A24C]' : 'text-[#B0B3B8]'}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[#1877F2] hover:underline"
            >
              <ChevronLeft className="w-4 h-4" />
              Return to Home
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Get Started | Club Commander</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="description" content="Request A Demo Of Club Commander For Your Poker Room" />
      </Head>

      <div className="cmd-page">
        {/* Header */}
        <header className="cmd-header-bar">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <Link href="/" className="flex items-center gap-2">
              <Building2 className="w-8 h-8 text-[#1877F2]" />
              <span className="text-xl font-bold text-white">Club Commander</span>
            </Link>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          {step === 'info' ? (
            /* Features Overview */
            <div className="space-y-8">
              <div className="text-center max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold text-white mb-4">
                  Modern Poker Room Management
                </h1>
                <p className="text-lg text-[#B0B3B8]">
                  Replace outdated waitlist systems with a digital-first platform that players love and staff find easy to use.
                </p>
              </div>

              {/* Features Grid */}
              <div className="grid md:grid-cols-3 gap-4">
                {FEATURES.map((feature, i) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={i}
                      className="cmd-panel p-5"
                    >
                      <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center mb-3">
                        <Icon className="w-5 h-5 text-[#1877F2]" />
                      </div>
                      <h3 className="font-semibold text-white mb-1">{feature.title}</h3>
                      <p className="text-sm text-[#B0B3B8]">{feature.description}</p>
                    </div>
                  );
                })}
              </div>

              {/* CTA */}
              <div className="text-center">
                <button
                  onClick={() => setStep('form')}
                  className="cmd-btn cmd-btn-primary inline-flex items-center gap-2 px-8 py-4 text-lg"
                >
                  Request a Demo
                  <ArrowRight className="w-5 h-5" />
                </button>
                <p className="text-sm text-[#B0B3B8] mt-3">
                  Free demo, no obligation
                </p>
              </div>

              {/* Onboarding Process */}
              <div className="cmd-panel p-6">
                <h2 className="font-semibold text-white mb-4 text-center">Onboarding Process</h2>
                <div className="flex justify-between items-center max-w-2xl mx-auto">
                  {STEPS.map((s, i) => (
                    <div key={s.id} className="flex flex-col items-center relative">
                      <div className="w-10 h-10 bg-[#1877F2]/10 rounded-full flex items-center justify-center text-[#1877F2] font-medium">
                        {s.id}
                      </div>
                      <span className="text-xs text-[#B0B3B8] mt-2 text-center">{s.label}</span>
                      {i < STEPS.length - 1 && (
                        <div className="absolute left-[calc(50%+20px)] top-5 w-[calc(100%-40px)] h-0.5 bg-[#3A3B3C]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Contact Form */
            <div className="max-w-xl mx-auto">
              <button
                onClick={() => setStep('info')}
                className="flex items-center gap-2 text-[#B0B3B8] hover:text-white mb-6"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div className="cmd-panel p-6">
                <h2 className="text-xl font-bold text-white mb-6">Request A Demo</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Venue Name */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Venue Name *
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                      <input
                        type="text"
                        name="venueName"
                        value={formData.venueName}
                        onChange={handleChange}
                        required
                        placeholder="Bellagio Poker Room"
                        className="cmd-input w-full pl-10"
                      />
                    </div>
                  </div>

                  {/* Contact Name */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Your Name *
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                      <input
                        type="text"
                        name="contactName"
                        value={formData.contactName}
                        onChange={handleChange}
                        required
                        placeholder="John Smith"
                        className="cmd-input w-full pl-10"
                      />
                    </div>
                  </div>

                  {/* Email & Phone */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        Email *
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          placeholder="john@venue.com"
                          className="cmd-input w-full pl-10"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        Phone *
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          required
                          placeholder="(555) 123-4567"
                          className="cmd-input w-full pl-10"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        City *
                      </label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                        <input
                          type="text"
                          name="city"
                          value={formData.city}
                          onChange={handleChange}
                          required
                          placeholder="Las Vegas"
                          className="cmd-input w-full pl-10"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        State *
                      </label>
                      <select
                        name="state"
                        value={formData.state}
                        onChange={handleChange}
                        required
                        className="cmd-input w-full"
                      >
                        <option value="">Select State...</option>
                        <option value="NV">Nevada</option>
                        <option value="CA">California</option>
                        <option value="TX">Texas</option>
                        <option value="FL">Florida</option>
                        <option value="AZ">Arizona</option>
                        <option value="CO">Colorado</option>
                        <option value="NJ">New Jersey</option>
                        <option value="PA">Pennsylvania</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Table Count */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Number of Poker Tables
                    </label>
                    <select
                      name="tableCount"
                      value={formData.tableCount}
                      onChange={handleChange}
                      className="cmd-input w-full"
                    >
                      <option value="">Select Range...</option>
                      <option value="1-5">1-5 Tables</option>
                      <option value="6-10">6-10 Tables</option>
                      <option value="11-20">11-20 Tables</option>
                      <option value="21-40">21-40 Tables</option>
                      <option value="40+">40+ Tables</option>
                    </select>
                  </div>

                  {/* Current System */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Current Waitlist System
                    </label>
                    <select
                      name="currentSystem"
                      value={formData.currentSystem}
                      onChange={handleChange}
                      className="cmd-input w-full"
                    >
                      <option value="">Select Current System...</option>
                      <option value="poker_atlas">PokerAtlas</option>
                      <option value="bravo">Bravo Poker Live</option>
                      <option value="paper">Paper/Whiteboard</option>
                      <option value="custom">Custom Solution</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Additional Notes
                    </label>
                    <textarea
                      name="notes"
                      value={formData.notes}
                      onChange={handleChange}
                      rows={3}
                      placeholder="Tell Us About Your Needs Or Questions..."
                      className="cmd-input w-full resize-none"
                    />
                  </div>

                  {/* Promo Code */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Promo Code <span className="text-[#B0B3B8] font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                      <input
                        type="text"
                        name="promoCode"
                        value={formData.promoCode}
                        onChange={(e) => setFormData(prev => ({ ...prev, promoCode: e.target.value.toUpperCase() }))}
                        placeholder="ENTER CODE"
                        maxLength={30}
                        className="cmd-input w-full pl-10 uppercase tracking-wider"
                        style={{ fontFamily: 'monospace', letterSpacing: '2px' }}
                      />
                    </div>
                    <p className="text-xs text-[#B0B3B8] mt-1">Have A Promo Code? Enter It Here For Special Pricing Or Perks.</p>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="cmd-btn cmd-btn-primary w-full h-12 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Submit Request
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>

                  <p className="text-xs text-[#B0B3B8] text-center">
                    By submitting, you agree to be contacted about Club Commander.
                  </p>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
