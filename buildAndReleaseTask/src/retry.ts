import { Context, Middleware } from "@microsoft/microsoft-graph-client";
import { redactSecrets } from "./errors";
import { ILogger } from "./logger";

/**
 * Retries requests that failed for a temporary reason: throttling (429), server errors (408,
 * 500, 502, 503, 504) and dropped connections. The Graph client's own RetryHandler only knows
 * 429/503/504, never repeats a request with an application/octet-stream body - every chunk of
 * an upload session - and does not retry network errors at all.
 */

interface RetryOptions {
    /** Retries after the first attempt; 0 disables retrying. */
    maxRetries: number;
    /** Wait before the first retry when the service sends no Retry-After; doubles per retry. */
    baseDelayMs: number;
    /** Upper bound of the doubling wait. */
    maxDelayMs: number;
    /** Upper bound of a wait the service asks for with Retry-After. */
    maxRetryAfterMs: number;
}

const defaultRetryOptions: RetryOptions = {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    maxRetryAfterMs: 120000
};

type Sleep = (milliseconds: number) => Promise<void>;

const sleep: Sleep = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const retryableStatusCodes = [408, 429, 500, 502, 503, 504];

const retryableErrorCodes = [
    'ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN',
    'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
];

function isRetryableStatus(status: number): boolean {
    return retryableStatusCodes.indexOf(status) !== -1;
}

/**
 * The code of a dropped connection, if the error is one. node-fetch and NetworkError carry it on
 * the error, the native fetch of Node 18+ on its cause; a node-fetch timeout only has a type.
 */
function getRetryableErrorCode(error: any): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    if (error.type === 'request-timeout') return 'ETIMEDOUT';

    const candidates = [error.code, error.errno, error.cause && error.cause.code];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && retryableErrorCodes.indexOf(candidate) !== -1) {
            return candidate;
        }
    }

    const message = String(error.message);
    const match = /\b(ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|EPIPE|EAI_AGAIN)\b/.exec(message);
    if (match) return match[1];
    if (/socket hang up/i.test(message)) return 'ECONNRESET';
    return undefined;
}

/**
 * Reads Retry-After (seconds or HTTP date) as milliseconds; undefined if absent or invalid.
 */
function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
    if (!value) return undefined;

    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return Math.round(parseFloat(trimmed) * 1000);
    }

    const date = Date.parse(trimmed);
    return isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Wait before the given retry (1 = first retry): what the service asks for, otherwise
 * 2, 4, 8, 16, 32 s ... plus up to one second of jitter.
 */
function getRetryDelay(retry: number, retryAfterMs: number | undefined, options: RetryOptions, random: () => number = Math.random): number {
    if (retryAfterMs !== undefined) {
        return Math.min(retryAfterMs, options.maxRetryAfterMs);
    }

    const exponential = Math.min(options.baseDelayMs * Math.pow(2, retry - 1), options.maxDelayMs);
    return Math.round(exponential + random() * 1000);
}

/**
 * Only bodies that survive being sent can be sent again; streams are consumed by the first attempt.
 */
function canResend(body: unknown): boolean {
    return body === undefined || body === null
        || typeof body === 'string'
        || Buffer.isBuffer(body)
        || body instanceof ArrayBuffer
        || ArrayBuffer.isView(body)
        || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);
}

function requestUrl(request: RequestInfo): string {
    return typeof request === 'string' ? request : (request as any).url;
}

function formatDelay(milliseconds: number): string {
    return `${Math.round(milliseconds / 100) / 10} s`;
}

async function discardBody(response: Response | undefined): Promise<void> {
    try {
        // Frees the connection of the failed attempt.
        await response?.arrayBuffer();
    } catch {
        // nothing to free
    }
}

/**
 * Middleware of the Graph client chain. It sits after the authentication and telemetry
 * handlers: they append their headers, so running them again for a retry would send
 * "Authorization: Bearer x, Bearer x". The token is fetched when the request starts and
 * renewed five minutes before it expires, so it outlives all retries of a request.
 */
class RetryMiddleware implements Middleware {
    private nextMiddleware?: Middleware;

    constructor(
        private readonly options: RetryOptions,
        private readonly logger: ILogger,
        private readonly wait: Sleep = sleep,
        private readonly random: () => number = Math.random) {
    }

    setNext(next: Middleware): void {
        this.nextMiddleware = next;
    }

    async execute(context: Context): Promise<void> {
        if (!this.nextMiddleware) {
            throw new Error('RetryMiddleware needs a next middleware.');
        }

        const method = (context.options?.method ?? 'GET').toUpperCase();
        const target = `${method} ${redactSecrets(requestUrl(context.request))}`;
        const resendable = canResend(context.options?.body);

        // 'retry' is the number of the retry that follows if this attempt fails.
        for (let retry = 1; ; retry++) {
            let reason: string | undefined;
            let retryAfterMs: number | undefined;

            try {
                await this.nextMiddleware.execute(context);
            } catch (error) {
                const code = getRetryableErrorCode(error);
                if (!code || retry > this.options.maxRetries || !resendable) {
                    throw error;
                }
                reason = `Connection error (${code})`;
                context.response = undefined;
            }

            if (reason === undefined) {
                const response = context.response;
                if (!response || !isRetryableStatus(response.status) || retry > this.options.maxRetries || !resendable) {
                    return;
                }
                reason = `HTTP ${response.status}`;
                retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
                await discardBody(response);
                context.response = undefined;
            }

            const delay = getRetryDelay(retry, retryAfterMs, this.options, this.random);
            this.logger.info(`${reason} on ${target}; retrying in ${formatDelay(delay)} (attempt ${retry + 1} of ${this.options.maxRetries + 1}).`);
            await this.wait(delay);
        }
    }
}

export type {
    RetryOptions,
    Sleep
};

export {
    RetryMiddleware,
    canResend,
    defaultRetryOptions,
    getRetryDelay,
    getRetryableErrorCode,
    isRetryableStatus,
    parseRetryAfter,
    requestUrl,
    sleep
};
