import * as assert from "assert";
import { Context } from "@microsoft/microsoft-graph-client";
import { FetchHandler } from "../../src/fetch-handler";
import { agentProxy, createProxyAgentSelector, describeProxy, getIdentityProxyOptions, ProxyLookup } from "../../src/proxy";
import { parseMaxRetries } from "../../src/task-inputs";

const proxy = {
    proxyUrl: 'http://proxy.local:8080',
    proxyUsername: 'user',
    proxyPassword: 'secret',
    proxyBypassHosts: ['sharepoint\\.com'],
    proxyFormattedUrl: 'http://user:secret@proxy.local:8080'
};

// Same behaviour as tl.getHttpProxyConfiguration: null for bypassed URLs.
const lookup: ProxyLookup = (url) => url && /sharepoint\.com/.test(url) ? null : proxy;

describe("proxy", () => {
    describe("createProxyAgentSelector", () => {
        it("routes Graph through the agent proxy and reuses the agent", () => {
            const agentFor = createProxyAgentSelector(lookup);

            const agent = agentFor('https://graph.microsoft.com/v1.0/drives/x');

            assert.strictEqual(agent.proxy.host, 'proxy.local');
            assert.strictEqual(agent.proxy.port, 8080);
            assert.strictEqual(agent.proxy.auth, 'user:secret');
            assert.strictEqual(agentFor('https://login.microsoftonline.com/t/oauth2/v2.0/token'), agent);
        });

        it("connects directly to bypassed hosts and without a proxy", () => {
            assert.strictEqual(createProxyAgentSelector(lookup)('https://contoso.sharepoint.com/x'), undefined);
            assert.strictEqual(createProxyAgentSelector(() => null)('https://graph.microsoft.com/v1.0/x'), undefined);
        });
    });

    describe("agentProxy", () => {
        const variables = ['AGENT_PROXYURL', 'AGENT_PROXYBYPASSLIST'];
        afterEach(() => variables.forEach((name) => delete process.env[name]));

        it("reads Agent.ProxyUrl and Agent.ProxyBypassList", () => {
            process.env['AGENT_PROXYURL'] = 'http://proxy.local:8080';
            process.env['AGENT_PROXYBYPASSLIST'] = '["\\\\.sharepoint\\\\.com"]';

            assert.strictEqual(agentProxy('https://graph.microsoft.com/v1.0/x')!.proxyUrl, 'http://proxy.local:8080');
            assert.strictEqual(agentProxy('https://contoso.sharepoint.com/x'), null);
        });

        it("is null without a proxy", () => {
            assert.strictEqual(agentProxy('https://graph.microsoft.com/v1.0/x'), null);
        });
    });

    describe("getIdentityProxyOptions", () => {
        it("converts the agent proxy for @azure/identity", () => {
            assert.deepStrictEqual(getIdentityProxyOptions(lookup), { host: 'http://proxy.local', port: 8080, username: 'user', password: 'secret' });
        });

        it("uses the default port of the scheme", () => {
            const withoutPort: ProxyLookup = () => ({ proxyUrl: 'http://proxy.local', proxyFormattedUrl: 'http://proxy.local' });
            assert.deepStrictEqual(getIdentityProxyOptions(withoutPort), { host: 'http://proxy.local', port: 80, username: undefined, password: undefined });
        });

        it("is undefined without a proxy", () => {
            assert.strictEqual(getIdentityProxyOptions(() => null), undefined);
        });
    });

    describe("describeProxy", () => {
        it("names the proxy without credentials", () => {
            assert.strictEqual(describeProxy(lookup), 'http://proxy.local:8080');
            assert.strictEqual(describeProxy(() => null), undefined);
        });
    });

    describe("FetchHandler", () => {
        it("passes the agent and the timeout to fetch", async () => {
            const sentinel = { name: 'agent' };
            let init: any;
            const handler = new FetchHandler(() => sentinel, 1234, async (url, options) => {
                init = options;
                return { status: 200 } as any;
            });
            const context: Context = { request: 'https://graph.microsoft.com/v1.0/x', options: { method: 'GET' } };

            await handler.execute(context);

            assert.strictEqual(init.agent, sentinel);
            assert.strictEqual(init.timeout, 1234);
            assert.strictEqual(context.response!.status, 200);
        });

        it("names the request and the cause of a failed fetch without the upload token", async () => {
            const url = 'https://contoso.sharepoint.com/_api/v2.0/drives/b!d/items/x/uploadSession?guid=1&tempauth=secret-token-value';
            const handler = new FetchHandler(undefined, undefined, async () => {
                throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
            });

            await assert.rejects(handler.execute({ request: url, options: { method: 'PUT' } }), (error: any) => {
                assert.strictEqual(error.name, 'NetworkError');
                assert.strictEqual(error.code, 'ECONNRESET');
                assert.strictEqual(error.message, 'PUT https://contoso.sharepoint.com/_api/v2.0/drives/b!d/items/x/uploadSession?<redacted> failed: fetch failed: read ECONNRESET');
                return true;
            });
        });
    });
});

describe("task-inputs", () => {
    describe("parseMaxRetries", () => {
        it("uses the default when the input is missing or empty", () => {
            assert.strictEqual(parseMaxRetries(undefined), 5);
            assert.strictEqual(parseMaxRetries(' '), 5);
        });

        it("reads whole numbers from 0 to 20", () => {
            assert.strictEqual(parseMaxRetries('0'), 0);
            assert.strictEqual(parseMaxRetries(' 3 '), 3);
            assert.strictEqual(parseMaxRetries('20'), 20);
        });

        it("rejects everything else", () => {
            ['21', '-1', '2.5', 'abc'].forEach((value) => assert.throws(() => parseMaxRetries(value), /whole number from 0 to 20/));
        });
    });
});
