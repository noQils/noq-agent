import { lookup as dnsLookup } from 'node:dns/promises';

import TurndownService from 'turndown';

import { InternalTool } from './index';

const requestTimeoutMs = 10_000;
const maxBodyBytes = 2 * 1024 * 1024;
const maxOutputChars = 20_000;
const maxRedirects = 5;
const truncationMarker = '\n...[truncated]';

const turndownService = new TurndownService();
turndownService.remove(['script', 'style', 'noscript']);

// Seam for tests to stub DNS resolution without hitting the real network.
export const webFetchInternals = {
    lookup: dnsLookup,
};

const blockedIpv4Ranges = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
];

function ipv4ToInt(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
    const [range, bitsText] = cidr.split('/');
    const bits = Number(bitsText);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range ?? '0.0.0.0') & mask);
}

function isBlockedIpv4(ip: string): boolean {
    return blockedIpv4Ranges.some((cidr) => isIpv4InCidr(ip, cidr));
}

function isBlockedIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    if (normalized === '::1' || normalized === '::') {
        return true;
    }

    const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    const mappedV4Address = mappedV4?.[1];
    if (mappedV4Address) {
        return isBlockedIpv4(mappedV4Address);
    }

    const firstGroup = normalized.split(':')[0];
    const value = firstGroup ? parseInt(firstGroup, 16) : NaN;
    if (!Number.isNaN(value)) {
        if (value >= 0xfc00 && value <= 0xfdff) {
            return true; // unique local, fc00::/7
        }
        if (value >= 0xfe80 && value <= 0xfebf) {
            return true; // link-local, fe80::/10
        }
    }

    return false;
}

async function assertHostIsPublic(hostname: string): Promise<void> {
    const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');

    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await webFetchInternals.lookup(normalizedHost, { all: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not resolve host "${normalizedHost}": ${message}`);
    }

    for (const { address, family } of addresses) {
        const blocked = family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
        if (blocked) {
            throw new Error(
                `Refusing to fetch "${normalizedHost}": it resolves to a private/internal address (${address}).`
            );
        }
    }
}

async function validateUrl(url: string): Promise<URL> {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported URL protocol "${parsed.protocol}". Only http and https are allowed.`);
    }

    await assertHostIsPublic(parsed.hostname);

    return parsed;
}

async function readBodyWithLimit(response: Response): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBodyBytes) {
        throw new Error(`Response body too large: ${contentLength} bytes exceeds the ${maxBodyBytes} byte limit.`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return response.text();
    }

    const decoder = new TextDecoder();
    let received = 0;
    let text = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        received += value.byteLength;
        if (received > maxBodyBytes) {
            await reader.cancel();
            throw new Error(`Response body too large: exceeds the ${maxBodyBytes} byte limit.`);
        }

        text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
}

function truncate(text: string): string {
    if (text.length <= maxOutputChars) {
        return text;
    }

    return text.slice(0, maxOutputChars) + truncationMarker;
}

function formatJson(body: string): string {
    try {
        return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
        return body;
    }
}

async function fetchFollowingValidatedRedirects(startUrl: URL): Promise<Response> {
    let currentUrl = startUrl;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
        const response = await fetch(currentUrl, {
            redirect: 'manual',
            signal: AbortSignal.timeout(requestTimeoutMs),
        });

        const isRedirect = response.status >= 300 && response.status < 400;
        const location = response.headers.get('location');

        if (!isRedirect || !location) {
            return response;
        }

        if (redirectCount === maxRedirects) {
            throw new Error(`Too many redirects while fetching ${startUrl.toString()}.`);
        }

        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
            throw new Error(`Redirect to unsupported protocol "${nextUrl.protocol}".`);
        }

        await assertHostIsPublic(nextUrl.hostname);
        currentUrl = nextUrl;
    }

    throw new Error(`Too many redirects while fetching ${startUrl.toString()}.`);
}

export async function fetchUrl(url: string): Promise<string> {
    const parsedUrl = await validateUrl(url);

    let response: Response;
    try {
        response = await fetchFollowingValidatedRedirects(parsedUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch ${url}: ${message}`);
    }

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await readBodyWithLimit(response);

    if (contentType.includes('text/html')) {
        return truncate(turndownService.turndown(body));
    }

    if (contentType.includes('application/json')) {
        return truncate(formatJson(body));
    }

    if (contentType.startsWith('text/') || contentType.length === 0) {
        return truncate(body);
    }

    throw new Error(`Unsupported content type "${contentType}" for ${url}.`);
}

export const webFetchTool: InternalTool = {
    name: 'web_fetch',
    description: 'Fetch a specific URL and return its content. HTML pages are converted to markdown; JSON and plain text are returned as-is.',
    allowedModes: ['plan', 'build'],
    permission: {
        scope: 'web_fetch',
        getTarget: (args) => typeof args.url === 'string' ? args.url : '',
    },
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The http(s) URL to fetch',
                required: true,
            },
        },
    },

    execute: async (args: { url: string }) => {
        return fetchUrl(args.url);
    },
};
