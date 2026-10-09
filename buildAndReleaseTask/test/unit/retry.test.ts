import * as assert from "assert";
import { PassThrough } from "stream";
import { Response } from "cross-fetch";
import { Context, LargeFileUploadTask, Middleware, StreamUpload } from "@microsoft/microsoft-graph-client";
import { createClient } from "../../src/auth";
import { describeError } from "../../src/errors";
import { NetworkError } from "../../src/fetch-handler";
import { ILogger } from "../../src/logger";
import {
    canResend, defaultRetryOptions, getRetryableErrorCode, getRetryDelay, parseRetryAfter, RetryMiddleware, RetryOptions
} from "../../src/retry";

const uploadUrl = 'https://contoso.sharepoint.com/sites/x/_api/v2.0/drives/b!d/items/01X/uploadSession?guid=1&tempauth=secret-token-value';
const errorPage = '<html><head><title>Service Unavailable</title></head><body><h1>Service Unavailable</h1></body></html>';

type Step = { status: number; body?: string; headers?: { [name: string]: string } } | Error;

function respond(step: { status: number; body?: string; headers?: { [name: string]: string } }): Response {
    const isHtml = (step.body ?? '').startsWith('<');
    return new Response(step.body ?? '{}', {
        status: step.status,
        headers: Object.assign({ 'Content-Type': isHtml ? 'text/html' : 'application/json' }, step.headers)
    });
}

/**
 * Stands in for the fetch at the end of the chain and answers with the scripted steps.
 */
class ScriptedFetch {
    readonly calls: { method: string; url: string; body: unknown; headers: any; agent: unknown; timeout: unknown }[] = [];
    private readonly steps: Step[];

    // No parameter properties in tests: Node 22.6+ first tries to load them with its type stripping.
    constructor(steps: Step[]) {
        this.steps = steps;
    }

    fetch = async (url: string, init: any): Promise<Response> => {
        this.calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url, body: init?.body, headers: init?.headers, agent: init?.agent, timeout: init?.timeout });
        const step = this.steps.shift();
        if (!step) throw new Error(`No scripted response for ${url}`);
        if (step instanceof Error) throw step;
        return respond(step);
    };
}

class ScriptedMiddleware implements Middleware {
    readonly scripted: ScriptedFetch;

    constructor(steps: Step[]) {
        this.scripted = new ScriptedFetch(steps);
    }

    async execute(context: Context): Promise<void> {
        context.response = await this.scripted.fetch(String(context.request), context.options);
    }
}

function recordingLogger(): ILogger & { lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        debug: () => { },
        info: (message: string) => { lines.push(message); },
        warning: (message: string) => { lines.push(message); },
        error: (message: string) => { lines.push(message); }
    };
}

function retryChain(steps: Step[], options: Partial<RetryOptions> = {}) {
    const delays: number[] = [];
    const logger = recordingLogger();
    const middleware = new RetryMiddleware(Object.assign({}, defaultRetryOptions, options), logger, async (ms) => { delays.push(ms); }, () => 0);
    const terminal = new ScriptedMiddleware(steps);
    middleware.setNext(terminal);
    return { middleware, calls: terminal.scripted.calls, delays, logger };
}

function connectionReset(url: string): Error {
    return Object.assign(new Error(`request to ${url} failed, reason: read ECONNRESET`), { name: 'FetchError', code: 'ECONNRESET', type: 'system' });
}

describe("retry", () => {
    describe("parseRetryAfter", () => {
        it("reads seconds and HTTP dates", () => {
            assert.strictEqual(parseRetryAfter('3'), 3000);
            assert.strictEqual(parseRetryAfter('1.5'), 1500);
            const now = Date.parse('Thu, 01 Jan 2026 00:00:00 GMT');
            assert.strictEqual(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now), 10000);
        });

        it("ignores missing and invalid values", () => {
            assert.strictEqual(parseRetryAfter(null), undefined);
            assert.strictEqual(parseRetryAfter(''), undefined);
            assert.strictEqual(parseRetryAfter('soon'), undefined);
        });
    });

    describe("getRetryDelay", () => {
        it("doubles from 2 s and adds up to one second of jitter", () => {
            assert.deepStrictEqual([1, 2, 3, 4, 5].map((retry) => getRetryDelay(retry, undefined, defaultRetryOptions, () => 0)), [2000, 4000, 8000, 16000, 32000]);
            assert.strictEqual(getRetryDelay(1, undefined, defaultRetryOptions, () => 0.5), 2500);
            assert.strictEqual(getRetryDelay(10, undefined, defaultRetryOptions, () => 0), 60000);
        });

        it("follows Retry-After up to two minutes", () => {
            assert.strictEqual(getRetryDelay(1, 3000, defaultRetryOptions), 3000);
            assert.strictEqual(getRetryDelay(1, 600000, defaultRetryOptions), 120000);
        });
    });

    describe("getRetryableErrorCode", () => {
        it("recognizes dropped connections of node-fetch, NetworkError and the native fetch", () => {
            assert.strictEqual(getRetryableErrorCode({ code: 'ECONNRESET' }), 'ECONNRESET');
            assert.strictEqual(getRetryableErrorCode({ type: 'request-timeout', message: 'network timeout at: https://x' }), 'ETIMEDOUT');
            assert.strictEqual(getRetryableErrorCode(new NetworkError('PUT https://x failed: read ECONNRESET', 'ECONNRESET')), 'ECONNRESET');
            assert.strictEqual(getRetryableErrorCode(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })), 'UND_ERR_SOCKET');
            assert.strictEqual(getRetryableErrorCode(new Error('socket hang up')), 'ECONNRESET');
        });

        it("does not retry other errors", () => {
            assert.strictEqual(getRetryableErrorCode({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }), undefined);
            assert.strictEqual(getRetryableErrorCode(new Error('Token request failed with HTTP 401.')), undefined);
            assert.strictEqual(getRetryableErrorCode(undefined), undefined);
        });
    });

    describe("canResend", () => {
        it("repeats buffered bodies but not streams", () => {
            assert.ok(canResend(undefined));
            assert.ok(canResend('{"item":{}}'));
            assert.ok(canResend(Buffer.from('chunk')));
            assert.ok(canResend(new Uint8Array(4)));
            assert.ok(!canResend(new PassThrough()));
        });
    });

    describe("RetryMiddleware", () => {
        it("retries 503 until the request succeeds", async () => {
            const { middleware, calls, delays, logger } = retryChain([{ status: 503 }, { status: 503, body: errorPage }, { status: 503 }, { status: 200 }]);
            const context: Context = { request: 'https://graph.microsoft.com/v1.0/drives/x', options: { method: 'GET' } };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 200);
            assert.strictEqual(calls.length, 4);
            assert.deepStrictEqual(delays, [2000, 4000, 8000]);
            assert.strictEqual(logger.lines[0], 'HTTP 503 on GET https://graph.microsoft.com/v1.0/drives/x; retrying in 2 s (attempt 2 of 6).');
        });

        it("waits as long as Retry-After asks", async () => {
            const { middleware, delays } = retryChain([{ status: 429, headers: { 'Retry-After': '3' } }, { status: 200 }]);

            await middleware.execute({ request: 'https://graph.microsoft.com/v1.0/x', options: {} });

            assert.deepStrictEqual(delays, [3000]);
        });

        it("retries dropped connections", async () => {
            const { middleware, calls, logger } = retryChain([
                connectionReset('https://graph.microsoft.com/v1.0/x'),
                new NetworkError('GET https://graph.microsoft.com/v1.0/x failed: connect ETIMEDOUT 1.2.3.4:443', 'ETIMEDOUT'),
                Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }),
                { status: 200 }
            ]);
            const context: Context = { request: 'https://graph.microsoft.com/v1.0/x', options: {} };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 200);
            assert.strictEqual(calls.length, 4);
            assert.match(logger.lines[0], /^Connection error \(ECONNRESET\) on GET /);
        });

        [400, 401, 403, 404, 409, 416, 501].forEach((status) => {
            it(`does not retry HTTP ${status}`, async () => {
                const { middleware, calls } = retryChain([{ status }, { status: 200 }]);
                const context: Context = { request: 'https://graph.microsoft.com/v1.0/x', options: {} };

                await middleware.execute(context);

                assert.strictEqual(context.response!.status, status);
                assert.strictEqual(calls.length, 1);
            });
        });

        it("passes other errors on at once", async () => {
            const { middleware, calls } = retryChain([new Error('Token request for tenant failed with HTTP 401.'), { status: 200 }]);

            await assert.rejects(middleware.execute({ request: 'https://graph.microsoft.com/v1.0/x', options: {} }), /HTTP 401/);
            assert.strictEqual(calls.length, 1);
        });

        it("gives up after maxRetries and keeps the last response", async () => {
            const { middleware, calls } = retryChain([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200 }], { maxRetries: 2 });
            const context: Context = { request: 'https://graph.microsoft.com/v1.0/x', options: {} };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 503);
            assert.strictEqual(calls.length, 3);
        });

        it("throws the last connection error after maxRetries", async () => {
            const url = 'https://graph.microsoft.com/v1.0/x';
            const { middleware, calls } = retryChain([connectionReset(url), connectionReset(url), connectionReset(url)], { maxRetries: 2 });

            await assert.rejects(middleware.execute({ request: url, options: {} }), /ECONNRESET/);
            assert.strictEqual(calls.length, 3);
        });

        it("does not retry with maxRetries 0", async () => {
            const { middleware, calls } = retryChain([{ status: 503 }, { status: 200 }], { maxRetries: 0 });
            const context: Context = { request: 'https://graph.microsoft.com/v1.0/x', options: {} };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 503);
            assert.strictEqual(calls.length, 1);
        });

        it("repeats an upload chunk with the same bytes and keeps the token out of the log", async () => {
            const chunk = Buffer.from('chunk bytes');
            const { middleware, calls, logger } = retryChain([{ status: 503, body: errorPage }, { status: 201 }]);
            const context: Context = {
                request: uploadUrl,
                options: { method: 'PUT', body: chunk, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-10/11' } }
            };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 201);
            assert.strictEqual(calls.length, 2);
            assert.strictEqual(calls[1].body, chunk);
            assert.strictEqual(logger.lines[0], 'HTTP 503 on PUT https://contoso.sharepoint.com/sites/x/_api/v2.0/drives/b!d/items/01X/uploadSession?<redacted>; retrying in 2 s (attempt 2 of 6).');
        });

        it("does not repeat a stream body", async () => {
            const { middleware, calls } = retryChain([{ status: 503 }, { status: 201 }]);
            const context: Context = { request: uploadUrl, options: { method: 'PUT', body: new PassThrough() as any } };

            await middleware.execute(context);

            assert.strictEqual(context.response!.status, 503);
            assert.strictEqual(calls.length, 1);
        });
    });

    describe("Graph client from createClient", () => {
        const auth = { tenantId: 't', clientId: 'c', clientSecret: 's' };
        const authProvider = { getAccessToken: async () => 'fake-token' };
        const noProxy = () => null;

        function client(steps: Step[], logger: ILogger = recordingLogger(), maxRetries = 5) {
            const scripted = new ScriptedFetch(steps);
            const delays: number[] = [];
            const graph = createClient(auth, {
                authProvider, logger, proxy: noProxy, retry: { maxRetries },
                fetch: scripted.fetch, sleep: async (ms) => { delays.push(ms); }
            });
            return { graph, calls: scripted.calls, delays };
        }

        it("retries a Graph request and authenticates every attempt", async () => {
            const { graph, calls } = client([{ status: 503, body: errorPage }, { status: 429, headers: { 'Retry-After': '1' } }, { status: 200, body: '{"id":"b!d","name":"Docs"}' }]);

            const drive = await graph.api('/drives/b!d?$select=id,name').get();

            assert.strictEqual(drive.name, 'Docs');
            assert.strictEqual(calls.length, 3);
            calls.forEach((call) => assert.strictEqual(call.headers.Authorization, 'Bearer fake-token'));
            calls.forEach((call) => assert.strictEqual(call.timeout, 300000));
        });

        it("reports the last error when the retries are used up", async () => {
            const { graph, calls } = client([{ status: 503, body: errorPage }, { status: 503, body: errorPage }], recordingLogger(), 1);

            const error = await graph.api('/drives/b!d').get().then(() => undefined, (e: unknown) => e);
            const description = await describeError(error);

            assert.strictEqual(calls.length, 2);
            assert.strictEqual(description.message, 'HTTP 503: SharePoint returned an error page: Service Unavailable');
        });

        it("uploads a file whose chunk first gets an error page, then a connection reset", async () => {
            const content = Buffer.from('hello from the upload test');
            const logger = recordingLogger();
            const { graph, calls } = client([
                { status: 200, body: JSON.stringify({ uploadUrl, expirationDateTime: '2099-01-01T00:00:00Z', nextExpectedRanges: ['0-'] }) },
                { status: 503, body: errorPage },
                connectionReset(uploadUrl),
                { status: 201, body: '{"id":"item-1","name":"hello.txt"}' }
            ], logger);

            const session = await LargeFileUploadTask.createUploadSession(graph, '/drives/b!d/root:/target/hello.txt:/createUploadSession', { item: { name: 'hello.txt' } });
            const stream = new PassThrough();
            stream.end(content);
            const task = new LargeFileUploadTask(graph, new StreamUpload(stream, 'hello.txt', content.length), session);
            const result = await task.upload();

            assert.strictEqual((result.responseBody as any).id, 'item-1');
            assert.deepStrictEqual(calls.map((call) => call.method), ['POST', 'PUT', 'PUT', 'PUT']);
            assert.ok(calls.slice(1).every((call) => Buffer.from(call.body as Buffer).equals(content)), 'every attempt sends the same bytes');
            assert.ok(calls.slice(1).every((call) => call.headers.Authorization === undefined), 'no token on the pre-authenticated upload URL');
            assert.ok(logger.lines.every((line) => !line.includes('secret-token-value')), 'no tempauth in the log');
            assert.strictEqual(logger.lines.length, 2);
        });
    });
});
