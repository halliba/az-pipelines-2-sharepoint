import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import { Drive } from "@microsoft/microsoft-graph-types";
import { ILogger } from './logger';

interface ODataResult<T> {
    '@odata.context': string;
    value: T;
}

/**
 * Validates a driveId or url to a document library. Returns true if the site can be found and accessed.
 * @param driveId The driveId of document library or the full url to the document library
 * @param client The Microsoft Graph client
 * @param logger The logger to use
 * @returns Returns an object with the following properties:
 *         valid: true if the driveId is valid, false otherwise
 *         drive: the driveId of the found drive. (Important if the parameter was the full url)
 */
async function validateDrive(driveId: string, client: MicrosoftGraph.Client, logger: ILogger): Promise<string> {
    if(!driveId) {
        throw new Error('Parameter driveId is required.');
    }

    logger.info(`Validating drive id / url: '${driveId}'.`);

    let drive: Drive;
    if(driveId.startsWith('https://')) {
        drive = await getDriveFromUrl(driveId, client);
    } else {
        drive = await client.api(`/drives/${driveId}?$select=id,name`)
                .get();
    }

    if(!drive?.id) {
        throw new Error(`Could not find drive. API returned: ${JSON.stringify(drive)}.`);
    }

    logger.info(`Found drive '${drive?.name}'.`);
    return drive.id;
}

/**
 * Gets the drive object from a url to a document library.
 * @param url The full url to the document library (e.g. https://contoso.sharepoint.com/sites/my-site/Shared%20Documents)
 * @param client The Microsoft Graph client
 * @returns Returns the found drive object or null if not found.
 */
async function getDriveFromUrl(url: string, client: MicrosoftGraph.Client): Promise<Drive> {
    if(!url) throw new Error('Url is required');
    if(!client) throw new Error('Client is required');

    // url must not end with a slash
    if(url.endsWith("/")) url = url.substring(0, url.length - 1);

    if(!url.startsWith("https://")) throw new Error("Url must start with https://");
    const trimmedUrl = url.substring("https://".length);

    const firstSlash = trimmedUrl.indexOf('/');
    const lastSlash = trimmedUrl.lastIndexOf('/');

    if(firstSlash === -1) throw new Error("Url must be the full url to the document library.");

    const root = trimmedUrl.substring(0, firstSlash);
    const relSiteUrl = trimmedUrl.substring(firstSlash + 1, lastSlash);

    let encodedUrl: string;
    if(!relSiteUrl || relSiteUrl == '/') {
        encodedUrl = encodeURIComponent(root);
    } else {
        encodedUrl = encodeURIComponent(root + ":/" + relSiteUrl + ':');
    }

    let drives: ODataResult<Drive[]>;
    drives = await client.api(`sites/${encodedUrl}/drives?$select=id,name,webUrl`)
    .get();

    const drive = drives.value.find(d => d.webUrl?.toLowerCase() == url.toLowerCase());
    if(!drive) {
        throw new Error("Could not find drive in site. Found drives: " + JSON.stringify(drives.value));
    }

    return drive;
}

export {
    validateDrive,
    getDriveFromUrl
};
