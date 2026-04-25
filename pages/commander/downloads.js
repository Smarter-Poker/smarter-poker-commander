import { useState, useEffect } from 'react';
import Image from 'next/image';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { Check } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';

export default function DownloadsPage() {
  useEffect(() => { busEmit.sessionStart('commander-downloads'); }, []);
  const [platform, setPlatform] = useState('windows');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) {
      setPlatform('mac');
    } else if (userAgent.includes('linux')) {
      setPlatform('linux');
    } else {
      setPlatform('windows');
    }
  }, []);

  const platforms = {
    windows: {
      name: 'Windows',
      icon: '',
      filename: 'Club.Commander.Setup.1.0.5.exe',
      size: '72.9 MB',
      downloadUrl: '/api/commander/download?platform=win-setup',
      altDownload: {
        name: 'Portable Version',
        filename: 'Club.Commander.1.0.5.exe',
        url: '/api/commander/download?platform=win-portable'
      },
      requirements: ['Windows 10 or later', '4GB RAM minimum', '200MB disk space']
    },
    mac: {
      name: 'macOS',
      icon: '',
      filename: 'Club.Commander-1.0.5-arm64.dmg',
      size: '89.8 MB',
      downloadUrl: '/api/commander/download?platform=mac-dmg',
      altDownload: {
        name: 'ZIP Archive',
        filename: 'Club.Commander-1.0.5-arm64-mac.zip',
        url: '/api/commander/download?platform=mac-zip'
      },
      requirements: ['macOS 11 (Big Sur) or later', 'Apple Silicon (M1/M2/M3)', '4GB RAM minimum', '200MB disk space'],
      installNote: 'If you see "Club Commander is damaged and can\'t be opened", open Terminal and run: xattr -cr /Applications/Club\\ Commander.app — then re-open the app. This removes the macOS quarantine flag from unsigned apps.'
    },
    linux: {
      name: 'Linux',
      icon: '',
      filename: 'Club.Commander-1.0.5.AppImage',
      size: '99.6 MB',
      downloadUrl: '/api/commander/download?platform=linux-appimage',
      altDownload: {
        name: 'Debian Package',
        filename: 'club-commander_1.0.5_amd64.deb',
        url: '/api/commander/download?platform=linux-deb'
      },
      requirements: ['Ubuntu 20.04+ or equivalent', '4GB RAM minimum', '200MB disk space']
    }
  };

  const currentPlatform = platforms[platform];

  const handleDownload = () => {
    setDownloading(true);
    window.location.href = currentPlatform.downloadUrl;
    setTimeout(() => setDownloading(false), 3000);
  };

  const features = [
    { title: 'Native Desktop Experience', desc: 'Faster performance and offline capabilities' },
    { title: 'Auto-Updates', desc: 'Always stay on the latest version automatically' },
    { title: 'Print Support', desc: 'Print player lists, reports, and receipts directly' },
    { title: 'Quick Launch', desc: 'Launch from your desktop or taskbar instantly' }
  ];

  return (
    <CommanderLayout title="Download Club Commander - Desktop App" backHref="/commander/dashboard?card=reports">
      <div className="min-h-screen bg-[#18191A]">
        <SEOHead
          title="Commander — Downloads"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="container mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex justify-center mb-4">
              <Image src="/images/club-commander-logo.jpg" alt="Club Commander" width={1584} height={656} className="w-full max-w-md rounded-lg" />
            </div>
            <h1 className="text-4xl font-bold text-[#E4E6EB] mb-3">Club Commander Desktop</h1>
            <p className="text-[#B0B3B8] text-lg">The Fastest Way To Manage Your Poker Room</p>
            <p className="text-[#31A24C] text-sm mt-2 flex items-center justify-center gap-1"><Check className="w-4 h-4" /> Version 1.0.6 - Released February 2026</p>
          </div>

          {/* Main Download Card */}
          <div className="max-w-2xl mx-auto bg-[#242526] rounded-xl p-8 border border-[#3A3B3C] mb-8">
            {/* Platform Tabs */}
            <div className="flex justify-center gap-2 mb-8">
              {Object.entries(platforms || {}).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => setPlatform(key)}
                  className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${platform === key
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-[#3A3B3C] text-[#B0B3B8] hover:bg-[#4E4F50]'
                    }`}
                >

                  {p.name}
                </button>
              ))}
            </div>

            {/* Download Button */}
            <div className="text-center mb-8">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="w-full max-w-md bg-[#1877F2] hover:bg-[#1664d9] disabled:bg-[#3A3B3C] text-white font-bold py-4 px-8 rounded-xl text-lg transition-colors"
              >
                {downloading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Starting Download...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download for {currentPlatform.name}
                  </span>
                )}
              </button>
              <p className="text-[#B0B3B8] text-sm mt-3">
                {currentPlatform.filename} ({currentPlatform.size})
              </p>
              {currentPlatform.altDownload && (
                <a
                  href={currentPlatform.altDownload.url}
                  className="text-[#1877F2] hover:underline text-sm mt-2 inline-block"
                >
                  Or download {currentPlatform.altDownload.name} →
                </a>
              )}
            </div>

            {/* Requirements */}
            <div className="border-t border-[#3A3B3C] pt-6">
              <h3 className="text-[#E4E6EB] font-medium mb-3">System Requirements</h3>
              <ul className="text-[#B0B3B8] text-sm space-y-1">
                {currentPlatform.requirements.map((req, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#31A24C] flex-shrink-0" /> {req}
                  </li>
                ))}
              </ul>
            </div>

            {/* Mac Installation Note */}
            {currentPlatform.installNote && (
              <div className="border-t border-[#3A3B3C] pt-6 mt-4">
                <h3 className="text-[#E4E6EB] font-medium mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#F0AD4E]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  macOS Installation
                </h3>
                <p className="text-[#B0B3B8] text-sm">{currentPlatform.installNote}</p>
              </div>
            )}
          </div>

          {/* Features Grid */}
          <div className="max-w-2xl mx-auto grid grid-cols-2 gap-4 mb-8">
            {features.map((feature, i) => (
              <div key={i} className="bg-[#242526] rounded-lg p-4 border border-[#3A3B3C]">
                <h4 className="text-[#E4E6EB] font-medium mb-1">{feature.title}</h4>
                <p className="text-[#B0B3B8] text-sm">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Tablet / Phone Install */}
          <div className="max-w-2xl mx-auto bg-[#242526] rounded-xl p-6 border border-[#3A3B3C] mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-[#31A24C]/15 flex items-center justify-center shrink-0">
                <span className="text-3xl">📱</span>
              </div>
              <div className="flex-1">
                <h3 className="text-[#E4E6EB] font-bold text-lg mb-1">iPad & Android</h3>
                <p className="text-[#B0B3B8] text-sm">Add Commander to your tablet home screen — no app store needed. Perfect for front-desk kiosks and dealer stations.</p>
              </div>
            </div>
            <Link href="/commander/install"
              className="mt-4 w-full py-3 rounded-xl bg-[#31A24C] text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#2B8C42] transition-colors">
              📲 View iPad & Android Install Guide
            </Link>
          </div>

          {/* All Downloads Link */}
          <div className="text-center">
            <a
              href="https://github.com/Smarter-Poker/club-commander-desktop/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1877F2] hover:underline"
            >
              View all releases on GitHub →
            </a>
          </div>

        </div>
        <style>{`
`}</style>
      </div>
    </CommanderLayout>
  );
}
