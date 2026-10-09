import * as assert from "assert";
import { PassThrough } from "stream";
import { GraphError } from "@microsoft/microsoft-graph-client";
import { ContextError, describeError, formatError, redactSecrets } from "../../src/errors";

const uploadUrl = 'https://contoso.sharepoint.com/sites/x/_api/v2.0/drives/b!abc/items/01X/uploadSession'
    + '?guid=%271%27&overwrite=True&rename=False&dc=0&tempauth=v1.secret-token-value';
const redactedUploadUrl = 'https://contoso.sharepoint.com/sites/x/_api/v2.0/drives/b!abc/items/01X/uploadSession?<redacted>';

const errorPage = '<!DOCTYPE html><html><head><title>Service Unavailable</title><style>body{}</style></head>'
    + '<body><h1>Service Unavailable</h1><p>The server is temporarily&nbsp;unable to service your request.</p></body></html>';

function graphError(status: number, code: string | null, message: string, requestId?: string): GraphError {
    const error = new GraphError(status, message);
    error.code = code;
    error.requestId = requestId ?? null;
    return error;
}

function streamOf(text: string): PassThrough {
    const stream = new PassThrough();
    stream.end(text);
    return stream;
}

describe("errors", () => {
    describe("redactSecrets", () => {
        it("removes the query of pre-authenticated upload URLs", () => {
            assert.strictEqual(
                redactSecrets(`request to ${uploadUrl} failed, reason: read ECONNRESET`),
                `request to ${redactedUploadUrl} failed, reason: read ECONNRESET`);
        });

        it("removes a tempauth parameter outside of a URL", () => {
            assert.strictEqual(redactSecrets('tempauth=abc.def&x=1'), 'tempauth=<redacted>&x=1');
        });
    });

    describe("describeError", () => {
        it("describes a Graph error response", async () => {
            const description = await describeError(graphError(409, 'nameAlreadyExists', 'The specified item name already exists.', '702f'));

            assert.strictEqual(description.message, 'HTTP 409 nameAlreadyExists: The specified item name already exists. (request-id: 702f)');
            assert.match(description.hint!, /already exists/);
        });

        it("describes a network error wrapped by the Graph client without the upload token", async () => {
            const fetchError = new Error(`request to ${uploadUrl} failed, reason: read ECONNRESET`);
            fetchError.name = 'FetchError';
            const wrapped = new GraphError(-1, '', fetchError);
            wrapped.code = 'FetchError';

            const description = await describeError(wrapped);

            assert.strictEqual(description.message, `Network error: request to ${redactedUploadUrl} failed, reason: read ECONNRESET`);
            assert.match(description.hint!, /connection/);
            assert.ok(!(description.details ?? '').includes('secret-token-value'), 'details must not contain the token');
        });

        it("describes a network error thrown by fetch directly", async () => {
            const fetchError = Object.assign(new Error('request to https://login.microsoftonline.com/t/oauth2/v2.0/token failed, reason: connect ETIMEDOUT 1.2.3.4:443'), {
                name: 'FetchError',
                code: 'ETIMEDOUT'
            });

            const description = await describeError(fetchError);

            assert.strictEqual(description.message, 'Network error: request to https://login.microsoftonline.com/t/oauth2/v2.0/token failed, reason: connect ETIMEDOUT 1.2.3.4:443');
            assert.match(description.hint!, /connection/);
        });

        it("reads the HTML error page that the upload task throws as a stream", async () => {
            const description = await describeError(streamOf(errorPage));

            assert.strictEqual(description.message, 'SharePoint returned an error page: Service Unavailable - The server is temporarily unable to service your request.');
            assert.match(description.hint!, /temporary error/);
        });

        it("reads the error page in the body of a Graph error without message", async () => {
            const error = new GraphError(503);
            error.body = streamOf(errorPage);

            const description = await describeError(error);

            assert.strictEqual(description.message, 'HTTP 503: SharePoint returned an error page: Service Unavailable - The server is temporarily unable to service your request.');
            assert.match(description.hint!, /temporary error/);
        });

        it("reads web streams (native fetch of Node 18+)", async function () {
            const WebReadableStream = (globalThis as any).ReadableStream;
            if (!WebReadableStream) {
                this.skip();
            }
            const stream = new WebReadableStream({
                start(controller: any) {
                    controller.enqueue(Buffer.from(errorPage));
                    controller.close();
                }
            });

            const description = await describeError(stream);

            assert.strictEqual(description.message, 'SharePoint returned an error page: Service Unavailable - The server is temporarily unable to service your request.');
        });

        it("reads a JSON error body from a stream", async () => {
            const description = await describeError(streamOf('{"error":{"code":"serviceNotAvailable","message":"The service is not available."}}'));

            assert.strictEqual(description.message, 'SharePoint returned an error page: serviceNotAvailable: The service is not available.');
        });

        it("describes a JSON error object thrown without status", async () => {
            const description = await describeError({ error: { code: 'serviceNotAvailable', message: 'The service is not available.' } });

            assert.strictEqual(description.message, 'serviceNotAvailable: The service is not available.');
            assert.match(description.hint!, /temporary error/);
        });

        it("points to the secret for AADSTS7000215", async () => {
            const fromTokenRequest = await describeError(new Error("Token request for tenant 't' failed with HTTP 401. invalid_client: AADSTS7000215: Invalid client secret provided."));
            const fromObject = await describeError({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });

            assert.strictEqual(fromObject.message, 'invalid_client: AADSTS7000215: Invalid client secret provided.');
            assert.match(fromTokenRequest.hint!, /secret value, not the secret ID/);
            assert.match(fromObject.hint!, /secret value, not the secret ID/);
        });

        it("points to admin consent for tokens without roles", async () => {
            const description = await describeError(graphError(403, 'AccessDenied', 'Either scp or roles claim need to be present in the token.'));

            assert.match(description.hint!, /admin consent/);
        });

        it("adds the context of wrapped errors", async () => {
            const error = new ContextError("Could not validate drive 'https://contoso.sharepoint.com/sites/x//Docs'",
                graphError(404, 'itemNotFound', 'The provided path does not exist, or does not represent a site'));

            const description = await describeError(error);

            assert.strictEqual(description.message, "Could not validate drive 'https://contoso.sharepoint.com/sites/x//Docs': HTTP 404 itemNotFound: The provided path does not exist, or does not represent a site");
            assert.match(description.hint!, /double slash/);
        });

        it("handles strings, null and unknown objects", async () => {
            assert.strictEqual((await describeError('boom')).message, 'boom');
            assert.strictEqual((await describeError(null)).message, 'Unknown error');
            assert.strictEqual((await describeError(undefined)).message, 'Unknown error');
            assert.strictEqual((await describeError({ foo: 1 })).message, '{"foo":1}');
        });
    });

    describe("formatError", () => {
        it("appends the hint", () => {
            assert.strictEqual(formatError({ message: 'Failed.', hint: 'Check X.' }), 'Failed. Hint: Check X.');
            assert.strictEqual(formatError({ message: 'Failed.' }), 'Failed.');
        });
    });
});
