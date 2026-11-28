import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { Check } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import InlineStyle from '../../src/components/commander/shared/InlineStyle';
import { PLATFORMS, RELEASES_PAGE_URL, platformFromUserAgent } from '../../src/lib/commander/desktopRelease';

// Everything about the files on this page comes from the latest published
// release of Smarter-Poker/club-commander-desktop, through
// /api/commander/desktop-release (pages/api/desktop-release.js). Nothing here
// names a version or a file. Changelog:
// docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md

const PLATFORM_NAMES = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

function requirementsFor(platform, release) {
  if (platform === 'windows') return ['Windows 10 Or Later', '4GB RAM Minimum', '200MB Disk Space'];
  if (platform === 'linux') return ['Ubuntu 20.04+ Or Equivalent', '4GB RAM Minimum', '200MB Disk Space'];
  const arches = (release && release.macArches) || [];
  const chip = arches.includes('arm64') && arches.includes('x64')
    ? 'Apple Silicon Or Intel Mac'
    : arches.includes('x64') ? 'Intel Mac' : 'Apple Silicon (M1 And Later)';
  return ['macOS 11 (Big Sur) Or Later', chip, '4GB RAM Minimum', '200MB Disk Space'];
}

const MAC_INSTALL_NOTE = 'If You See "Club Commander Is Damaged And Can\'t Be Opened", Open Terminal And Run: xattr -cr /Applications/Club\\ Commander.app. Then Re-Open The App. This Removes The macOS Quarantine Flag From Unsigned Apps.';

function releasedOn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}

export default function DownloadsPage() {
  useEffect(() => { busEmit.sessionStart('commander-downloads'); }, []);
  const [platform, setPlatform] = useState('windows');
  const [status, setStatus] = useState('loading');
  const [release, setRelease] = useState(null);

  useEffect(() => {
    setPlatform(platformFromUserAgent(navigator.userAgent));
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/commander/desktop-release', { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.available && body.release) {
        setRelease(body.release);
        setStatus('ready');
      } else {
        setStatus('unavailable');
      }
    } catch {
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const files = (release && release.platforms && release.platforms[platform]) || [];
  const primary = files[0] || null;
  const others = files.slice(1);
  const releasesUrl = (release && release.releaseUrl) || RELEASES_PAGE_URL;

  const features = [
    { title: 'Native Desktop Experience', desc: 'Faster Performance And Offline Capabilities' },
    { title: 'Auto-Updates', desc: 'Always Stay On The Latest Version Automatically' },
    { title: 'Print Support', desc: 'Print Player Lists, Reports, And Receipts Directly' },
    { title: 'Quick Launch', desc: 'Launch From Your Desktop Or Taskbar Instantly' }
  ];

  return (
    <CommanderLayout title="Download Club Commander - Desktop App" backHref="/commander/dashboard?card=reports">
      <div className="min-h-screen bg-[#040D18]">
        <SEOHead
          title="Commander - Downloads"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="container mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex justify-center mb-4">
              <Image src="/images/club-commander-logo.jpg" alt="Club Commander" width={1584} height={656} className="w-full max-w-md rounded-lg" />
            </div>
            <h1 className="text-4xl font-bold text-[#F2F7FF] mb-3">Club Commander Desktop</h1>
            <p className="text-[#BDD0E2] text-lg">The Fastest Way To Manage Your Poker Room</p>
            {status === 'ready' && release && (
              <p className="text-[#31A24C] text-sm mt-2 flex items-center justify-center gap-1" data-desktop-release-version>
                <Check className="w-4 h-4" /> Version {release.version}{releasedOn(release.publishedAt) ? ` - Released ${releasedOn(release.publishedAt)}` : ''}
              </p>
            )}
          </div>

          {/* Main Download Card */}
          <div className="max-w-2xl mx-auto bg-[#0A1829] rounded-xl p-8 border border-[#445E77] mb-8">
            {status === 'loading' && (
              <div className="text-center py-10" data-desktop-downloads-state="loading">
                <p className="text-[#BDD0E2]">Loading Downloads</p>
              </div>
            )}

            {status === 'unavailable' && (
              <div className="text-center py-6" data-desktop-downloads-state="unavailable">
                <h3 className="text-[#F2F7FF] font-bold text-lg mb-2">Downloads Unavailable, Try Again</h3>
                <p className="text-[#BDD0E2] text-sm mb-5">The Latest Release Could Not Be Loaded Right Now. Every Installer Is Also On The Releases Page.</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    type="button"
                    onClick={load}
                    className="px-6 py-3 rounded-xl bg-[#0C55C0] hover:bg-[#0A4AA8] text-white font-bold"
                  >
                    Try Again
                  </button>
                  <a
                    href={RELEASES_PAGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 rounded-xl bg-[#132A42] text-[#F2F7FF] font-bold"
                  >
                    Open Releases Page
                  </a>
                </div>
              </div>
            )}

            {status === 'ready' && release && (
              <div data-desktop-downloads-state="ready">
                {/* Platform Tabs */}
                <div className="flex justify-center gap-2 mb-8">
                  {PLATFORMS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPlatform(key)}
                      className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${platform === key
                        ? 'bg-[#0C55C0] text-white'
                        : 'bg-[#132A42] text-[#BDD0E2] hover:bg-[#1B3753]'
                        }`}
                    >
                      {PLATFORM_NAMES[key]}
                    </button>
                  ))}
                </div>

                {/* Download Button */}
                <div className="text-center mb-8">
                  {primary ? (
                    <>
                      <a
                        href={primary.url}
                        rel="noopener noreferrer"
                        data-desktop-download={primary.kind}
                        className="w-full max-w-md mx-auto bg-[#0C55C0] hover:bg-[#0A4AA8] text-white font-bold py-4 px-8 rounded-xl text-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download {primary.label}
                      </a>
                      <p className="text-[#BDD0E2] text-sm mt-3 break-all">
                        {primary.fileName}{primary.sizeLabel ? ` (${primary.sizeLabel})` : ''}
                      </p>
                      {others.length > 0 && (
                        <ul className="mt-4 space-y-2">
                          {others.map((file) => (
                            <li key={file.fileName}>
                              <a
                                href={file.url}
                                rel="noopener noreferrer"
                                data-desktop-download={file.kind}
                                className="text-[#86DAFF] hover:underline text-sm"
                              >
                                Or Download {file.label}
                              </a>
                              <span className="text-[#7F97B0] text-xs ml-2 break-all">{file.fileName}{file.sizeLabel ? ` (${file.sizeLabel})` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-[#BDD0E2]">This Release Has No {PLATFORM_NAMES[platform]} Download. See The Releases Page For Earlier Builds.</p>
                  )}
                </div>

                {/* Requirements */}
                <div className="border-t border-[#445E77] pt-6">
                  <h3 className="text-[#F2F7FF] font-medium mb-3">System Requirements</h3>
                  <ul className="text-[#BDD0E2] text-sm space-y-1">
                    {requirementsFor(platform, release).map((req) => (
                      <li key={req} className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#31A24C] flex-shrink-0" /> {req}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Mac Installation Note */}
                {platform === 'mac' && (
                  <div className="border-t border-[#445E77] pt-6 mt-4">
                    <h3 className="text-[#F2F7FF] font-medium mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-[#22D3EE]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      macOS Installation
                    </h3>
                    <p className="text-[#BDD0E2] text-sm">{MAC_INSTALL_NOTE}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Features Grid */}
          <div className="max-w-2xl mx-auto grid grid-cols-2 gap-4 mb-8">
            {features.map((feature, i) => (
              <div key={i} className="bg-[#0A1829] rounded-lg p-4 border border-[#445E77]">
                <h4 className="text-[#F2F7FF] font-medium mb-1">{feature.title}</h4>
                <p className="text-[#BDD0E2] text-sm">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Tablet / Phone Install */}
          <div className="max-w-2xl mx-auto bg-[#0A1829] rounded-xl p-6 border border-[#445E77] mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-[#31A24C]/15 flex items-center justify-center shrink-0">
                <span className="text-3xl"></span>
              </div>
              <div className="flex-1">
                <h3 className="text-[#F2F7FF] font-bold text-lg mb-1">iPad & Android</h3>
                <p className="text-[#BDD0E2] text-sm">Add Commander To Your Tablet Home Screen, No App Store Needed. Perfect For Front-Desk Kiosks And Dealer Stations.</p>
              </div>
            </div>
            <Link href="/commander/install"
              className="mt-4 w-full py-3 rounded-xl bg-[#31A24C] text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#2B8C42] transition-colors">
              View iPad & Android Install Guide
            </Link>
          </div>

          {/* All Downloads Link */}
          <div className="text-center">
            <a
              href={releasesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#86DAFF] hover:underline"
            >
              View All Releases On GitHub →
            </a>
          </div>

        </div>
        <InlineStyle css={`
`} />
      </div>
    </CommanderLayout>
  );
}
