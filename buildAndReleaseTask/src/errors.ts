/**
 * Turns whatever a failed Graph or SharePoint request throws into one readable line without
 * secrets, plus a hint for the most common setup problems.
 *
 * The Graph client does not always throw an Error: for an HTML error page it throws the raw
 * response stream (or a GraphError with an empty message and the stream as body), and the
 * message of a network error contains the pre-authenticated upload URL including its token.
 */

interface ErrorDescription {
    /** One line, secrets removed. */
    message: string;
    /** What to check, for well-known causes. */
    hint?: string;
    /** Stack trace or raw details for debug output, secrets removed. */
    details?: string;
}

/**
 * Wraps an error with what the task was doing when it happened.
 */
class ContextError extends Error {
    readonly inner: unknown;

    constructor(context: string, inner: unknown) {
        super(context);
        Object.setPrototypeOf(this, ContextError.prototype);
        this.name = 'ContextError';
        this.inner = inner;
    }
}

const maxMessageLength = 1500;
const maxBodyBytes = 64 * 1024;
const bodyReadTimeoutMs = 5000;

const networkErrorPattern = /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed/i;

/**
 * Removes the access token that pre-authenticated SharePoint upload URLs carry in their query.
 */
function redactSecrets(text: string): string {
    return text
        .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*tempauth=[^\s"'<>]*/gi, '$1?<redacted>')
        .replace(/(tempauth=)[^&\s"'<>]+/gi, '$1<redacted>');
}

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, length: number): string {
    return text.length > length ? text.substring(0, length - 1) + '…' : text;
}

function isNodeReadable(value: any): boolean {
    return !!value && typeof value.on === 'function' && typeof value.read === 'function' && typeof value.pipe === 'function';
}

function isWebReadable(value: any): boolean {
    return !!value && typeof value.getReader === 'function';
}

function isReadable(value: unknown): boolean {
    return isNodeReadable(value) || isWebReadable(value);
}

function isGraphError(value: any): boolean {
    return value instanceof Error && typeof (value as any).statusCode === 'number';
}

function waitAtMost(promise: Promise<void>, milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        const done = () => {
            clearTimeout(timer);
            resolve();
        };
        promise.then(done, done);
    });
}

/**
 * Reads the start of a response body stream (Node stream with node-fetch, web stream with the
 * native fetch of Node 18+). Gives up after a few seconds and returns what arrived until then.
 */
async function readBody(stream: any): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    const add = (chunk: unknown) => {
        if (size >= maxBodyBytes) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk
            : chunk instanceof Uint8Array ? Buffer.from(chunk)
            : Buffer.from(String(chunk));
        chunks.push(buffer);
        size += buffer.length;
    };

    let reading: Promise<void>;
    if (isWebReadable(stream)) {
        reading = (async () => {
            const reader = stream.getReader();
            try {
                while (size < maxBodyBytes) {
                    const result = await reader.read();
                    if (result.done) break;
                    add(result.value);
                }
            } finally {
                reader.releaseLock();
            }
        })();
    } else {
        reading = new Promise<void>((resolve) => {
            stream.on('data', add);
            stream.on('end', resolve);
            stream.on('error', () => resolve());
        });
    }

    await waitAtMost(reading, bodyReadTimeoutMs);
    return Buffer.concat(chunks).toString('utf8');
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&amp;/gi, '&');
}

/**
 * Reads the error of a Graph response ({ error: { code, message } }) or of the token endpoint
 * ({ error, error_description }).
 */
function describeErrorObject(value: any): string | undefined {
    if (!value || typeof value !== 'object') return undefined;

    const error = value.error;
    if (error && typeof error === 'object' && (error.code || error.message)) {
        return [error.code, error.message].filter(Boolean).join(': ');
    }
    if (typeof error === 'string') {
        return [error, value.error_description].filter(Boolean).join(': ');
    }
    if (typeof value.code === 'string' && typeof value.message === 'string') {
        return `${value.code}: ${value.message}`;
    }
    return undefined;
}

/**
 * Shortens a response body to what matters: the error of a JSON body, or the title and the
 * beginning of the text of an HTML error page.
 */
function summarizeBody(body: string): string {
    const trimmed = body.trim();
    if (trimmed === '') return '';

    try {
        const fromJson = describeErrorObject(JSON.parse(trimmed));
        if (fromJson) return fromJson;
    } catch {
        // not JSON
    }

    if (/<html|<!doctype|<body|<title/i.test(trimmed)) {
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(trimmed);
        const title = titleMatch ? collapseWhitespace(decodeHtmlEntities(titleMatch[1])) : '';
        let text = collapseWhitespace(decodeHtmlEntities(trimmed
            .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')));
        if (title !== '' && text.startsWith(title)) {
            text = text.substring(title.length).trim();
        }
        return truncate([title, text].filter((part) => part !== '').join(' - '), 300);
    }

    return truncate(collapseWhitespace(trimmed), 300);
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function getHint(status: number | undefined, code: string | undefined, text: string, isNetworkError: boolean, isErrorPage: boolean): string | undefined {
    if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(text)) {
        return 'Check the client secret: use the secret value, not the secret ID, and make sure it has not expired.';
    }
    if (/AADSTS700016/i.test(text)) {
        return 'The client ID is unknown in this tenant. Check the client ID and the tenant ID.';
    }
    if (/AADSTS90002|AADSTS900023|AADSTS90013/i.test(text)) {
        return 'Check the tenant ID.';
    }
    if (/CompactToken parsing failed|JWT is not well formed|IDX14100/i.test(text)) {
        return 'Microsoft Graph rejected the access token. Check the tenant ID, the client ID and the client secret (the value, not the secret ID).';
    }
    if (/Either scp or roles claim/i.test(text)) {
        return 'The token has no application permissions. Add Files.ReadWrite.All or Sites.Selected as an application permission and grant admin consent.';
    }
    if (/does not represent a site/i.test(text)) {
        return 'The site of the drive URL was not found. Check the URL, e.g. for a double slash or a missing site path.';
    }
    if (status === 403 || /^accessDenied$/i.test(code ?? '')) {
        return 'The app has no write access to this site or library. With Sites.Selected, grant the app write access to the site.';
    }
    if (status === 409 && /nameAlreadyExists/i.test(`${code} ${text}`)) {
        return "A file with this name already exists, or an interrupted earlier upload still holds the name. With 'File conflict behaviour' set to 'Fail', choose 'Replace' or 'Rename'; otherwise re-run the job later.";
    }
    if (status === 423 || /resourceLocked|checked out/i.test(text)) {
        return 'The file is locked or checked out in SharePoint.';
    }
    if (status === 404) {
        return 'The drive, folder or file was not found. Check the drive ID or URL and the target folder.';
    }
    if (isNetworkError) {
        return 'The agent lost the connection to Microsoft 365. If this happens only occasionally, re-run the job; otherwise check the network and proxy settings of the agent.';
    }
    if (status === 429 || (status !== undefined && status >= 500) || isErrorPage
        || /serviceNotAvailable|activityLimitReached|tooManyRequests|throttl/i.test(text)) {
        return 'SharePoint or Microsoft Graph reported a temporary error. Re-run the job; if it keeps failing, check the Microsoft 365 service health.';
    }
    return undefined;
}

/**
 * Describes any thrown value. Never throws itself.
 */
async function describeError(error: unknown): Promise<ErrorDescription> {
    try {
        if (error instanceof ContextError) {
            const inner = await describeError(error.inner);
            return {
                message: truncate(`${redactSecrets(error.message)}: ${inner.message}`, maxMessageLength),
                hint: inner.hint,
                details: inner.details
            };
        }

        let status: number | undefined;
        let code: string | undefined;
        let requestId: string | undefined;
        let text: string;
        let isErrorPage = false;
        let details: string | undefined;

        if (isReadable(error)) {
            text = summarizeBody(await readBody(error));
            isErrorPage = true;
        } else if (isGraphError(error)) {
            const graphError = error as any;
            status = graphError.statusCode > 0 ? graphError.statusCode : undefined;
            code = graphError.code ?? undefined;
            requestId = graphError.requestId ?? undefined;
            if (graphError.message) {
                text = graphError.message;
            } else if (isReadable(graphError.body)) {
                text = summarizeBody(await readBody(graphError.body));
                isErrorPage = true;
            } else if (typeof graphError.body === 'string') {
                text = summarizeBody(graphError.body);
            } else {
                text = describeErrorObject(graphError.body) ?? '';
            }
            details = graphError.stack;
        } else if (error instanceof Error) {
            text = error.message || error.name;
            code = typeof (error as any).code === 'string' ? (error as any).code : undefined;
            details = error.stack;
        } else if (typeof error === 'string') {
            text = error;
        } else if (error === null || error === undefined) {
            text = '';
        } else {
            text = describeErrorObject(error) ?? safeStringify(error);
            details = safeStringify(error);
        }

        text = collapseWhitespace(redactSecrets(text));
        const isNetworkError = status === undefined && (code === 'FetchError' || networkErrorPattern.test(text));

        const parts: string[] = [];
        if (status !== undefined) parts.push(`HTTP ${status}`);
        if (code && !/^(Error|TypeError|FetchError)$/.test(code) && text.indexOf(code) === -1) parts.push(code);
        let message = parts.join(' ');

        if (text === '') {
            text = isErrorPage ? 'SharePoint returned an empty error response' : 'Unknown error';
        } else if (isErrorPage) {
            text = `SharePoint returned an error page: ${text}`;
        } else if (isNetworkError) {
            text = `Network error: ${text}`;
        }
        message = message === '' ? text : `${message}: ${text}`;
        if (requestId) message += ` (request-id: ${requestId})`;

        return {
            message: truncate(message, maxMessageLength),
            hint: getHint(status, code, text, isNetworkError, isErrorPage),
            details: details ? redactSecrets(details) : undefined
        };
    } catch (unexpected) {
        return { message: `Unknown error (${redactSecrets(String(unexpected))})` };
    }
}

/**
 * The message for the task result: description and hint in one line.
 */
function formatError(description: ErrorDescription): string {
    return description.hint ? `${description.message} Hint: ${description.hint}` : description.message;
}

export type {
    ErrorDescription
};

export {
    ContextError,
    describeError,
    formatError,
    redactSecrets
};
