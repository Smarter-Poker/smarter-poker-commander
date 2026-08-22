/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SEOHead - Reusable SEO Meta Tag Component
 * ═══════════════════════════════════════════════════════════════════════════════
 * Renders <title>, <meta description>, Open Graph, Twitter Card, canonical URL,
 * and optional JSON-LD structured data for any page on smarter.poker.
 *
 * Usage:
 *   <SEOHead
 *     title="Poker Near Me"
 *     description="Find Live Poker Rooms Near You..."
 *     canonical="/hub/poker-near-me/lobby"
 *     jsonLd={{ "@type": "WebApplication", ... }}
 *   />
 */

import Head from 'next/head';

const SITE_NAME = 'Smarter.Poker';
const SITE_URL = 'https://smarter.poker';
const DEFAULT_OG_IMAGE = 'https://smarter.poker/images/og-default.png';
const TWITTER_HANDLE = '@SmarterPoker';

export default function SEOHead({
    title,
    description,
    canonical,
    ogImage,
    ogType = 'website',
    noindex = false,
    jsonLd,
    twitterCard = 'summary_large_image',
    children,
}) {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} - The Future Of The Game`;
    const fullCanonical = canonical
        ? canonical.startsWith('http')
            ? canonical
            : `${SITE_URL}${canonical.startsWith('/') ? '' : '/'}${canonical}`
        : undefined;
    const ogImageUrl = ogImage || DEFAULT_OG_IMAGE;

    return (
        <Head>
            {/* Primary Meta Tags */}
            <title>{fullTitle}</title>
            {description && <meta name="description" content={description} />}
            {fullCanonical && <link rel="canonical" href={fullCanonical} />}

            {/* Robots */}
            {noindex ? (
                <meta name="robots" content="noindex, nofollow" />
            ) : (
                <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
            )}

            {/* Open Graph / SmarterPoker */}
            <meta property="og:type" content={ogType} />
            <meta property="og:site_name" content={SITE_NAME} />
            <meta property="og:title" content={title || SITE_NAME} />
            {description && <meta property="og:description" content={description} />}
            {fullCanonical && <meta property="og:url" content={fullCanonical} />}
            <meta property="og:image" content={ogImageUrl} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta property="og:locale" content="en_US" />

            {/* Twitter Card */}
            <meta name="twitter:card" content={twitterCard} />
            <meta name="twitter:site" content={TWITTER_HANDLE} />
            <meta name="twitter:title" content={title || SITE_NAME} />
            {description && <meta name="twitter:description" content={description} />}
            <meta name="twitter:image" content={ogImageUrl} />

            {/* JSON-LD Structured Data */}
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            ...jsonLd,
                        }),
                    }}
                />
            )}

            {/* Additional head elements passed as children */}
            {children}
        </Head>
    );
}

/**
 * Pre-built JSON-LD schemas for common page types
 */
export const schemas = {
    organization: {
        '@type': 'Organization',
        name: 'Smarter.Poker',
        url: 'https://smarter.poker',
        logo: 'https://smarter.poker/smarter-poker-logo.png',
        sameAs: [],
        description: 'The Ultimate Poker Platform for GTO Training, Live Venue Discovery, Bankroll Tracking, and Community.',
    },

    website: {
        '@type': 'WebSite',
        name: 'Smarter.Poker',
        url: 'https://smarter.poker',
        potentialAction: {
            '@type': 'SearchAction',
            target: 'https://smarter.poker/hub/poker-near-me/lobby?q={search_term_string}',
            'query-input': 'required name=search_term_string',
        },
    },

    softwareApp: {
        '@type': 'SoftwareApplication',
        name: 'Smarter.Poker',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web',
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
        },
    },

    pokerTraining: (title, description) => ({
        '@type': 'Course',
        name: title,
        description: description,
        provider: {
            '@type': 'Organization',
            name: 'Smarter.Poker',
            url: 'https://smarter.poker',
        },
        isAccessibleForFree: true,
    }),

    localBusiness: (venue) => ({
        '@type': 'LocalBusiness',
        name: venue.name,
        description: venue.description,
        address: venue.address,
        geo: venue.geo,
        url: `https://smarter.poker/hub/venues/${venue.id}`,
    }),

    event: (eventData) => ({
        '@type': 'Event',
        name: eventData.name,
        startDate: eventData.startDate,
        endDate: eventData.endDate,
        location: eventData.location,
        description: eventData.description,
        organizer: {
            '@type': 'Organization',
            name: 'Smarter.Poker',
        },
    }),
};
