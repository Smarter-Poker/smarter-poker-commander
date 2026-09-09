/**
 * Which Grok model is actually sent, for a name a caller asked for.
 *
 * Dependency-free on purpose: grokClient.js imports `openai` (a peer
 * dependency the consumer provides), and this decision has to be testable
 * without it.
 */

/**
 * Model mapping: OpenAI-era aliases and RETIRED Grok names to what exists.
 *
 * Measured against api.x.ai on 2026-09-08 with no credential (a missing model
 * answers "Model not found" before authentication; an existing one asks for
 * a key): grok-beta, grok-2-latest, grok-2-vision, grok-2-vision-latest,
 * grok-2-vision-1212 and grok-vision-beta do not exist. grok-3, grok-3-mini,
 * grok-3-latest, grok-4, grok-4-fast, grok-imagine-image and grok-2-image-1212
 * do. grok-3 reads images; the earlier note that grok-vision-beta was
 * "confirmed for vision" was wrong, and the only reason routes asking for it
 * worked was the fallback below.
 */
export const MODEL_MAP = {
    'gpt-4o': 'grok-3',
    'gpt-4o-mini': 'grok-3-mini',
    'gpt-3.5-turbo': 'grok-3',
    'gpt-4': 'grok-3',
    'gpt-4-turbo': 'grok-3',
    'gpt-4-vision-preview': 'grok-3',
    'dall-e-3': 'grok-imagine-image',
    'dall-e-2': 'grok-imagine-image',
    // Retired Grok names, kept so an old caller degrades to a model that exists.
    'grok-beta': 'grok-3',
    'grok-2-latest': 'grok-3',
    'grok-2-vision': 'grok-3',
    'grok-2-vision-latest': 'grok-3',
    'grok-2-vision-1212': 'grok-3',
    'grok-vision-beta': 'grok-3',
    'grok-2-image': 'grok-imagine-image',
};

/**
 * Resolve the model a caller named to the model that is sent.
 *
 * An alias in MODEL_MAP is translated. A real Grok name passes through
 * UNCHANGED: before 2026-09-08 anything not in the map became grok-3, so a
 * route asking for grok-3-mini silently paid for grok-3. Anything else falls
 * back to grok-3, which is the one model every route here is known to work on.
 */
export function mapModelToGrok(requested) {
    if (MODEL_MAP[requested]) return MODEL_MAP[requested];
    if (typeof requested === 'string' && /^grok-/.test(requested)) return requested;
    return 'grok-3';
}
