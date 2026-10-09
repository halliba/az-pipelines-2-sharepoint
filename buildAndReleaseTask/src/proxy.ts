import * as tl from "azure-pipelines-task-lib/task";
import createHttpsProxyAgent from "https-proxy-agent";
import { AgentSelector } from "./fetch-handler";

/**
 * The agent's proxy (Agent.ProxyUrl with credentials) for a request URL, or null without a
 * proxy or when the URL matches Agent.ProxyBypassList.
 */
type ProxyLookup = (requestUrl?: string) => tl.ProxyConfiguration | null;

const agentProxy: ProxyLookup = (requestUrl) => tl.getHttpProxyConfiguration(requestUrl);

/**
 * Agents for the requests of the Graph client and the token request: through the agent's
 * proxy unless the URL is bypassed. One agent per proxy, so connections are reused.
 */
function createProxyAgentSelector(lookup: ProxyLookup = agentProxy): AgentSelector {
    const agents: { [proxyUrl: string]: any } = {};

    return (url: string) => {
        const proxy = lookup(url);
        if (!proxy || !proxy.proxyFormattedUrl) {
            return undefined;
        }

        if (!agents[proxy.proxyFormattedUrl]) {
            agents[proxy.proxyFormattedUrl] = createHttpsProxyAgent(proxy.proxyFormattedUrl);
        }
        return agents[proxy.proxyFormattedUrl];
    };
}

interface IdentityProxyOptions {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

/**
 * The agent's proxy in the form @azure/identity expects (host including the scheme).
 */
function getIdentityProxyOptions(lookup: ProxyLookup = agentProxy): IdentityProxyOptions | undefined {
    const proxy = lookup('https://login.microsoftonline.com/');
    if (!proxy || !proxy.proxyUrl) {
        return undefined;
    }

    const url = new URL(proxy.proxyUrl);
    return {
        host: `${url.protocol}//${url.hostname}`,
        port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
        username: proxy.proxyUsername || undefined,
        password: proxy.proxyPassword || undefined
    };
}

/**
 * The proxy URL for the log, without credentials; undefined without a proxy.
 */
function describeProxy(lookup: ProxyLookup = agentProxy): string | undefined {
    const proxy = lookup();
    return proxy?.proxyUrl || undefined;
}

export type {
    IdentityProxyOptions,
    ProxyLookup
};

export {
    agentProxy,
    createProxyAgentSelector,
    describeProxy,
    getIdentityProxyOptions
};
