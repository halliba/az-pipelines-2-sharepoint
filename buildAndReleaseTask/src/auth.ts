import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { AgentSelector, FetchHandler } from './fetch-handler';
import { ILogger, noLogger } from './logger';
import { agentProxy, createProxyAgentSelector, describeProxy, getIdentityProxyOptions, ProxyLookup } from './proxy';
import { defaultRetryOptions, RetryMiddleware, RetryOptions, Sleep, sleep } from './retry';

interface AadAuthToken {
    token_type: "Bearer"
    expires_in: number,
    access_token: string
}

export interface AuthOptions {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}

/**
 * How the client sends requests. Everything has a default; proxy, sleep, fetch and
 * authProvider exist for tests.
 */
export interface ClientOptions {
    retry?: Partial<RetryOptions>;
    logger?: ILogger;
    proxy?: ProxyLookup;
    sleep?: Sleep;
    fetch?: (url: string, init: any) => Promise<Response>;
    authProvider?: MicrosoftGraph.AuthenticationProvider;
}

type Send = (url: string, init: any) => Promise<Response>;

const nodeMajorVersion = parseInt(process.versions.node.split('.')[0]);

const aadScope = 'https://graph.microsoft.com/.default';

const getAccessTokenAsync = async (authOptions: AuthOptions, send: Send): Promise<AadAuthToken> => {
    const endpointUrl = `https://login.microsoftonline.com/${authOptions.tenantId}/oauth2/v2.0/token`;

    const body = `client_id=${encodeURIComponent(authOptions.clientId)}`
        + `&scope=${encodeURIComponent(aadScope)}`
        + `&client_secret=${encodeURIComponent(authOptions.clientSecret)}`
        + `&grant_type=client_credentials`;

    var response = await send(endpointUrl, {
        body: body,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    // On failure the endpoint answers { error, error_description } (e.g. AADSTS7000215 for a wrong
    // secret); without this check Graph would only report an unparsable token.
    const text = await response.text();
    let aadToken: any;
    try {
        aadToken = JSON.parse(text);
    } catch {
        aadToken = undefined;
    }

    if(!response.ok || !aadToken?.access_token) {
        const reason = aadToken?.error
            ? `${aadToken.error}: ${aadToken.error_description ?? ''}`
            : text.substring(0, 300);
        throw new Error(`Token request for tenant '${authOptions.tenantId}' failed with HTTP ${response.status}. ${reason}`.trim());
    }

    return aadToken as AadAuthToken;
}

/**
 * The plain token request; the token is reused until five minutes before it expires.
 */
const getAuthProviderLegacy = (authOptions: AuthOptions, send: Send): MicrosoftGraph.AuthenticationProvider => {
    let cached: { token: string; expiresAt: number } | undefined;

    var authProvider: MicrosoftGraph.AuthenticationProvider = {
        getAccessToken: async () => {
            if (!cached || Date.now() >= cached.expiresAt) {
                const aadToken = await getAccessTokenAsync(authOptions, send);
                const lifetimeSeconds = Number(aadToken.expires_in) || 0;
                cached = {
                    token: aadToken.access_token,
                    expiresAt: Date.now() + Math.max(0, lifetimeSeconds - 300) * 1000
                };
            }
            return cached.token;
        }
    }
    return authProvider;
}

const getAuthProvider = (authOptions: AuthOptions, retry: RetryOptions, proxy: ProxyLookup): MicrosoftGraph.AuthenticationProvider => {
    const azureIdentity = require('@azure/identity');

    // Azure Core retries the token request on 408, 5xx, 429/503 with Retry-After and dropped
    // connections; it only needs the number of retries and the agent's proxy.
    const credential = new azureIdentity.ClientSecretCredential(
        authOptions.tenantId,
        authOptions.clientId,
        authOptions.clientSecret,
        {
            retryOptions: { maxRetries: retry.maxRetries },
            proxyOptions: getIdentityProxyOptions(proxy)
        }
    );

    const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        {
            scopes: [aadScope],
        },
    );

    return authProvider;
}

function resolveRetryOptions(retry: Partial<RetryOptions> | undefined): RetryOptions {
    const resolved: RetryOptions = Object.assign({}, defaultRetryOptions);
    for (const key of Object.keys(retry ?? {}) as (keyof RetryOptions)[]) {
        if (typeof retry![key] === 'number') {
            resolved[key] = retry![key]!;
        }
    }
    return resolved;
}

/**
 * Sends a single request through the retry and fetch middleware of the Graph client.
 */
function createSender(retry: RetryOptions, logger: ILogger, wait: Sleep, fetchHandler: FetchHandler): Send {
    const retryMiddleware = new RetryMiddleware(retry, logger, wait);
    retryMiddleware.setNext(fetchHandler);

    return async (url, init) => {
        const context: MicrosoftGraph.Context = { request: url, options: init };
        await retryMiddleware.execute(context);
        return context.response!;
    };
}

export const createClient = (authOptions: AuthOptions, options: ClientOptions = {}): MicrosoftGraph.Client => {
    const logger = options.logger ?? noLogger();
    const retry = resolveRetryOptions(options.retry);
    const wait = options.sleep ?? sleep;
    const proxy = options.proxy ?? agentProxy;
    const agentFor: AgentSelector = createProxyAgentSelector(proxy);
    const fetchHandler = () => new FetchHandler(agentFor, undefined, options.fetch);

    const proxyUrl = describeProxy(proxy);
    if (proxyUrl) {
        logger.info(`Using the agent proxy '${proxyUrl}'.`);
    }

    let authProvider;
    // @azure/identity 4.x requires Node 18+; the Node10 and Node16 handlers use the plain token request.
    if(options.authProvider) {
        authProvider = options.authProvider;
    } else if(nodeMajorVersion < 18) {
        authProvider = getAuthProviderLegacy(authOptions, createSender(retry, logger, wait, fetchHandler()));
    } else {
        authProvider = getAuthProvider(authOptions, retry, proxy);
    }

    // The client's default chain has a RetryHandler that skips upload chunks and network errors,
    // and an HTTPMessageHandler that ignores proxies on Node 18+; both are replaced. Retrying
    // comes after the handlers that append headers, which would otherwise be sent twice.
    const client = MicrosoftGraph.Client.initWithMiddleware({
        middleware: [
            new MicrosoftGraph.AuthenticationHandler(authProvider),
            new MicrosoftGraph.TelemetryHandler(),
            new RetryMiddleware(retry, logger, wait),
            new MicrosoftGraph.RedirectHandler(new MicrosoftGraph.RedirectHandlerOptions()),
            fetchHandler()
        ]
    });

    return client;
}
