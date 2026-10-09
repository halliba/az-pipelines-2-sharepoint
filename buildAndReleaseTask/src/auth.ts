import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import fetch from 'cross-fetch';

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

const nodeMajorVersion = parseInt(process.versions.node.split('.')[0]);

const aadScope = 'https://graph.microsoft.com/.default';

const getAccessTokenAsync = async (authOptions: AuthOptions): Promise<AadAuthToken> => {
    const endpointUrl = `https://login.microsoftonline.com/${authOptions.tenantId}/oauth2/v2.0/token`;

    const body = `client_id=${encodeURIComponent(authOptions.clientId)}`
        + `&scope=${encodeURIComponent(aadScope)}`
        + `&client_secret=${encodeURIComponent(authOptions.clientSecret)}`
        + `&grant_type=client_credentials`;

    var response = await fetch(endpointUrl, {
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

const getAuthProviderLegacy = (authOptions: AuthOptions): MicrosoftGraph.AuthenticationProvider => {
    var authProvider: MicrosoftGraph.AuthenticationProvider = {
        getAccessToken: async () => (await getAccessTokenAsync(authOptions)).access_token
    }
    return authProvider;
}

const getAuthProvider = (authOptions: AuthOptions): MicrosoftGraph.AuthenticationProvider => {
    const azureIdentity = require('@azure/identity');

    const credential = new azureIdentity.ClientSecretCredential(
        authOptions.tenantId,
        authOptions.clientId,
        authOptions.clientSecret
    );
    
    const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        {
            scopes: [aadScope],
        },
    );

    return authProvider;
}

export const createClient = (authOptions: AuthOptions): MicrosoftGraph.Client => {
    let authProvider;
    if(nodeMajorVersion < 16) {
        authProvider = getAuthProviderLegacy(authOptions);
    } else {
        authProvider = getAuthProvider(authOptions);
    }

    const client = MicrosoftGraph.Client.initWithMiddleware({
        authProvider: authProvider
    });

    return client;
}
