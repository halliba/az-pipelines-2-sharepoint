import crossFetch from "cross-fetch";
import { Context, Middleware } from "@microsoft/microsoft-graph-client";
import { redactSecrets } from "./errors";
import { getRetryableErrorCode, requestUrl } from "./retry";

/**
 * Picks the agent (e.g. a proxy agent) for a request URL; undefined for a direct connection.
 */
type AgentSelector = (url: string) => any;

/**
 * Upper bound for one request including its body, so a stalled connection fails (and is
 * retried) instead of hanging until the job times out. Generous for a 5 MiB upload chunk.
 */
const requestTimeoutMs = 5 * 60 * 1000;

/**
 * A request that did not get a response. The message names the request without secrets and
 * the cause, which the native fetch of Node 18+ only keeps on error.cause ("fetch failed").
 */
class NetworkError extends Error {
    readonly code: string | undefined;

    constructor(message: string, code: string | undefined) {
        super(message);
        Object.setPrototypeOf(this, NetworkError.prototype);
        this.name = 'NetworkError';
        this.code = code;
    }
}

function getReason(error: any): string {
    const message = String(error?.message ?? error);
    // node-fetch: "request to <url> failed, reason: read ECONNRESET"
    const match = /reason: (.*)$/.exec(message);
    if (match) return match[1];

    const cause = error?.cause;
    if (cause) {
        return `${message}: ${cause.message ?? cause.code ?? cause}`;
    }
    return message;
}

function toNetworkError(error: any, method: string, url: string): NetworkError {
    const code = getRetryableErrorCode(error) ?? error?.code ?? error?.cause?.code;
    return new NetworkError(
        redactSecrets(`${method} ${url} failed: ${getReason(error)}`),
        typeof code === 'string' ? code : undefined);
}

/**
 * Last middleware of the Graph client chain. Replaces the client's HTTPMessageHandler, which
 * calls the global fetch: on Node 18+ that is the native fetch, which ignores proxy agents.
 * node-fetch (via cross-fetch) behaves the same on every Node version the task runs on.
 */
class FetchHandler implements Middleware {
    constructor(
        private readonly agentFor: AgentSelector = () => undefined,
        private readonly timeoutMs: number = requestTimeoutMs,
        private readonly fetchImpl: (url: string, init: any) => Promise<Response> = crossFetch as any) {
    }

    async execute(context: Context): Promise<void> {
        const url = requestUrl(context.request);
        const options: any = Object.assign({}, context.options, { timeout: this.timeoutMs });
        const agent = this.agentFor(url);
        if (agent) {
            options.agent = agent;
        }

        try {
            context.response = await this.fetchImpl(url, options);
        } catch (error) {
            throw toNetworkError(error, (options.method ?? 'GET').toUpperCase(), url);
        }
    }
}

export type {
    AgentSelector
};

export {
    FetchHandler,
    NetworkError,
    requestTimeoutMs
};
