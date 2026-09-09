/**
 * Grok API Client (xAI) - GROK ONLY
 * 
 * OpenAI-compatible wrapper for xAI's Grok API.
 * Uses a proxy to automatically map legacy OpenAI model names to Grok equivalents.
 * 
 * Base URL: https://api.x.ai/v1
 * API Key: XAI_API_KEY environment variable
 * 
 * NOTE: As of 2026-01-29, this is GROK ONLY - no OpenAI fallback.
 * 
 * @see https://docs.x.ai/docs/models
 */

import OpenAI from 'openai';

import { MODEL_MAP, mapModelToGrok } from './grokModels.js';
export { MODEL_MAP, mapModelToGrok };

/**
 * Create a proxied OpenAI client that automatically maps models
 */
function createGrokProxyClient() {
    if (!process.env.XAI_API_KEY) {
        console.warn('[GrokClient] XAI_API_KEY not set - API calls will fail');
    }

    // Create the base Grok client
    const baseClient = new OpenAI({
        apiKey: process.env.XAI_API_KEY || 'not-set',
        baseURL: 'https://api.x.ai/v1',
    });

    // Create proxied chat.completions.create that maps models
    const originalCreate = baseClient.chat.completions.create.bind(baseClient.chat.completions);
    baseClient.chat.completions.create = async function (params) {
        const mappedModel = mapModelToGrok(params.model);
        console.debug(`[GrokClient] Model mapping: ${params.model} → ${mappedModel}`);
        return originalCreate({
            ...params,
            model: mappedModel,
        });
    };

    // Create proxied images.generate that maps models
    const originalImagesGenerate = baseClient.images.generate.bind(baseClient.images);
    baseClient.images.generate = async function (params) {
        const mappedModel = mapModelToGrok(params.model);
        console.debug(`[GrokClient] Image model mapping: ${params.model} → ${mappedModel}`);
        return originalImagesGenerate({
            ...params,
            model: mappedModel,
        });
    };

    return baseClient;
}

// Initialize Grok client
let grokClient = null;

/**
 * Get the Grok AI client
 * Returns a proxied client that automatically maps legacy model names to Grok equivalents
 */
export function getAIClient() {
    if (!grokClient) {
        grokClient = createGrokProxyClient();
    }
    return grokClient;
}

/**
 * Alias for getAIClient - for backwards compatibility
 */
export const getGrokClient = getAIClient;

/**
 * Create a chat completion with automatic model mapping
 */
export async function createChatCompletion(params) {
    const client = getAIClient();
    return client.chat.completions.create(params);
}

/**
 * Generate an image with automatic model mapping
 */
export async function generateImage(params) {
    const client = getAIClient();
    return client.images.generate(params);
}

/**
 * Check if Grok API is enabled (always true now)
 */
export function isGrokEnabled() {
    return true;
}

/**
 * Get the current provider name
 */
export function getProviderName() {
    return 'Grok (xAI)';
}

// Default export - the Grok client with auto model mapping
export default getAIClient();
// Deploy trigger 1769670877
