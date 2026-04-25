/**
 * Club Commander — Install on iPad & Android
 * /commander/install
 * Step-by-step guide to add Commander to tablet/phone home screen
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import SEOHead from '../../src/components/seo/SEOHead';
import { Smartphone, Tablet, Monitor, ArrowRight, CheckCircle2, Download } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';

export default function CommanderInstall() {
  useEffect(() => { busEmit.sessionStart('commander-install'); }, []);
    const [tab, setTab] = useState('ipad');

    const steps = {
        ipad: [
            {
                num: 1,
                title: 'Open Safari',
                desc: 'Navigate to smarter.poker/commander in Safari. You must use Safari — Chrome does not support home screen installation on Apple devices.',
                icon: '🧭',
                highlight: 'Safari only'
            },
            {
                num: 2,
                title: 'Log Into Commander',
                desc: 'Enter your venue PIN to log in first. This ensures the app saves your session when installed.',
                icon: '🔐',
                highlight: 'Log in before installing'
            },
            {
                num: 3,
                title: 'Tap the Share Button',
                desc: 'Tap the Share icon (box with arrow pointing up) in the Safari toolbar. On iPad, it\'s in the top-right corner.',
                icon: '📤',
                highlight: 'Box with arrow ↑'
            },
            {
                num: 4,
                title: 'Tap "Add to Home Screen"',
                desc: 'Scroll down in the share sheet and tap "Add to Home Screen." The name will auto-fill as "Club Commander."',
                icon: '➕',
                highlight: 'Add to Home Screen'
            },
            {
                num: 5,
                title: 'Tap "Add" to Confirm',
                desc: 'Tap "Add" in the top-right corner. The Club Commander icon now appears on your home screen.',
                icon: '✅',
                highlight: 'Tap Add'
            },
            {
                num: 6,
                title: 'Launch & Manage',
                desc: 'Tap the icon to open Commander in full-screen mode — no browser bars, no tabs. Perfect for front-desk tablets and dealer stations.',
                icon: '🚀',
                highlight: 'Full-screen kiosk mode'
            }
        ],
        android: [
            {
                num: 1,
                title: 'Open Chrome',
                desc: 'Navigate to smarter.poker/commander in Google Chrome.',
                icon: '🌐',
                highlight: 'Chrome recommended'
            },
            {
                num: 2,
                title: 'Log Into Commander',
                desc: 'Enter your venue PIN to log in first. This ensures the app saves your session.',
                icon: '🔐',
                highlight: 'Log in before installing'
            },
            {
                num: 3,
                title: 'Tap the Three-Dot Menu',
                desc: 'Tap the ⋮ menu icon (three vertical dots) in the top-right corner of Chrome.',
                icon: '⋮',
                highlight: 'Three dots → top right'
            },
            {
                num: 4,
                title: 'Tap "Install App" or "Add to Home Screen"',
                desc: 'Chrome will show "Install app" if it detects the PWA, or "Add to Home screen" otherwise. Both work the same way.',
                icon: '📲',
                highlight: 'Install App'
            },
            {
                num: 5,
                title: 'Confirm Installation',
                desc: 'Tap "Install" or "Add" to confirm. The app will appear on your home screen and app drawer.',
                icon: '✅',
                highlight: 'Tap Install'
            },
            {
                num: 6,
                title: 'Launch & Manage',
                desc: 'Tap the Club Commander icon to open in full-screen standalone mode. Ideal for tablet-based poker room management.',
                icon: '🚀',
                highlight: 'Full-screen standalone mode'
            }
        ]
    };

    const useCases = [
        { icon: '🖥️', title: 'Front Desk', desc: 'Check-in kiosk, waitlist, cashier' },
        { icon: '🃏', title: 'Dealer Stations', desc: 'Seat players, manage time clocks' },
        { icon: '📊', title: 'Floor Manager', desc: 'Real-time table overview, reporting' },
        { icon: '🏆', title: 'Tournament Desk', desc: 'Clock, registration, payouts' },
    ];

    const currentSteps = steps[tab];

    return (
        <CommanderLayout title="Install on Tablet" backHref="/commander/downloads">
            <SEOHead
                title="Commander — Install on iPad & Android"
                description="Install Club Commander on your iPad or Android tablet for a full-screen poker room management experience."
                noindex={true}
            />
            <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

                {/* Hero */}
                <div className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#1877F2]/8 via-transparent to-transparent" />
                    <div className="relative px-4 pt-8 pb-4 text-center">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#31A24C]/15 border border-[#31A24C]/30 text-[#31A24C] text-xs font-medium mb-4">
                            <Tablet className="w-3.5 h-3.5" />
                            Free • No App Store Required
                        </div>
                        <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-2">
                            Install Club Commander
                        </h1>
                        <p className="text-[#B0B3B8] text-sm max-w-md mx-auto">
                            Add Commander to your tablet home screen for a full-screen, native management experience.
                        </p>
                    </div>
                </div>

                <div className="px-4 max-w-2xl mx-auto">
                    {/* Platform Tabs */}
                    <div className="flex gap-2 mb-6">
                        <button
                            onClick={() => setTab('ipad')}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${tab === 'ipad'
                                ? 'bg-white text-black shadow-lg shadow-white/10'
                                : 'bg-[#242526] text-[#B0B3B8] border border-[#3A3B3C]'
                                }`}
                        >
                            <Tablet className="w-4 h-4" />
                            iPad / iPhone
                        </button>
                        <button
                            onClick={() => setTab('android')}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${tab === 'android'
                                ? 'bg-[#34A853] text-white shadow-lg shadow-[#34A853]/20'
                                : 'bg-[#242526] text-[#B0B3B8] border border-[#3A3B3C]'
                                }`}
                        >
                            <Smartphone className="w-4 h-4" />
                            Android
                        </button>
                    </div>

                    {/* Steps */}
                    <div className="space-y-3 mb-8">
                        {currentSteps.map((step, idx) => (
                            <div
                                key={step.num}
                                className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 relative overflow-hidden"
                            >
                                <div className="flex gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-[#3A3B3C]/50 flex items-center justify-center text-xl shrink-0">
                                        {step.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-[10px] font-bold text-[#1877F2] bg-[#1877F2]/10 px-2 py-0.5 rounded-full">STEP {step.num}</span>
                                            <h3 className="text-white font-bold text-sm">{step.title}</h3>
                                        </div>
                                        <p className="text-[#B0B3B8] text-xs leading-relaxed mb-1.5">{step.desc}</p>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#31A24C]/10 border border-[#31A24C]/20 text-[#31A24C] text-[10px] font-medium">
                                            <CheckCircle2 className="w-2.5 h-2.5" />
                                            {step.highlight}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Use Cases */}
                    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 mb-6">
                        <h3 className="text-white font-bold text-sm mb-3">Best For</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {useCases.map((uc, i) => (
                                <div key={i} className="bg-[#18191A] rounded-lg p-3">
                                    <div className="text-xl mb-1">{uc.icon}</div>
                                    <p className="text-white text-xs font-bold">{uc.title}</p>
                                    <p className="text-[#6A6B6D] text-[10px]">{uc.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Desktop App CTA */}
                    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[#1877F2]/15 flex items-center justify-center shrink-0">
                                <Monitor className="w-5 h-5 text-[#1877F2]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-bold">Need the Desktop App?</p>
                                <p className="text-[#B0B3B8] text-xs">Download for Windows, Mac, or Linux</p>
                            </div>
                            <Link href="/commander/downloads" className="px-3 py-2 rounded-lg bg-[#3A3B3C] text-white text-xs font-medium flex items-center gap-1">
                                <Download className="w-3.5 h-3.5" /> Desktop
                            </Link>
                        </div>
                    </div>

                    {/* Open Commander CTA */}
                    <div className="text-center pb-12">
                        <Link href="/commander/dashboard"
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1877F2] text-white font-bold text-sm shadow-lg shadow-[#1877F2]/20">
                            Open Commander <ArrowRight className="w-4 h-4" />
                        </Link>
                        <p className="text-[#6A6B6D] text-[10px] mt-3">
                            Then follow the steps above to add it to your home screen
                        </p>
                    </div>
                </div>
            </div>
            <style>{``}</style>
        </CommanderLayout>
    );
}
