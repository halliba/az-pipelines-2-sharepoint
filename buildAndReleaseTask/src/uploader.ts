import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import { DriveItem } from "@microsoft/microsoft-graph-types";
import fs from 'fs';
import { ConflictBehaviour } from "./task-inputs";
import { ILogger, logProgress } from './logger';
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

interface UploaderAuthOptions {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}

interface UploaderOptions {
    auth: UploaderAuthOptions;
    conflictBehaviour: ConflictBehaviour;
}

class Uploader {
    private static _defaults = {
        aadScope: 'https://graph.microsoft.com/.default'
    };

    private _options: UploaderOptions;
    private _client?: MicrosoftGraph.Client;
    private _logger: ILogger;

    constructor(options: UploaderOptions, logger: ILogger) {
        this._options = options;
        this._logger = logger;
    }

    setConflictBehaviour(conflictBehaviour: ConflictBehaviour): void {
        this._options.conflictBehaviour = conflictBehaviour;
    }

    static createClient(authOptions: UploaderAuthOptions): MicrosoftGraph.Client {
        const credential = new ClientSecretCredential(
            authOptions.tenantId,
            authOptions.clientId,
            authOptions.clientSecret
        );
        
        const authProvider = new TokenCredentialAuthenticationProvider(
            credential,
            {
                scopes: [this._defaults.aadScope],
            },
        );
    
        const client = MicrosoftGraph.Client.initWithMiddleware({
            authProvider: authProvider
        });

        return client;
    }

    async getClientAsync(): Promise<MicrosoftGraph.Client> {
        if (!!this._client) {
            return this._client;
        }

        const client = Uploader.createClient(this._options.auth);

        this._client = client;
        return client;
    }

    static constructFileUrl(driveId: string, fileName: string, path: string = '/'): string {
        let pathComponents = path.split("/")
            .concat(fileName.split("/"));

        let encodedPath = pathComponents
            .map((p) => encodeURIComponent(p))
            .filter((p) => p !== '')
            .join("/");

        return `/drives/${driveId}/root:/${encodedPath}`;
    }

    async uploadFileAsync(localFilePath: string, driveId: string, remotePath: string, remoteFileName: string): Promise<MicrosoftGraph.UploadResult | null> {
        const client = await this.getClientAsync();

        const requestUrl = Uploader.constructFileUrl(driveId, remoteFileName, remotePath)
            + ':/createUploadSession';

        const fileStats = fs.statSync(localFilePath);
        const fileSize = fileStats.size;

        if (fileSize === 0) {
            const byte0Msg = `SharePoint Online does not support 0-Byte files: '${localFilePath}'.`;
            this._logger.warning(byte0Msg);

            return null;
        }

        const payload = {
            "item": {
                "@microsoft.graph.conflictBehavior": this._options.conflictBehaviour,
                "name": remoteFileName,
            },
            "deferCommit": fileSize === 0
        };

        this._logger.debug(`Local file path: '${localFilePath}'.`);
        this._logger.debug(`Remote folder path: '${remotePath}'.`);
        this._logger.debug(`Remote file name: '${remoteFileName}'.`);
        this._logger.debug(`Request url: '${requestUrl}'.`);

        const readStream = fs.createReadStream(localFilePath);
        const fileObject = new MicrosoftGraph.StreamUpload(readStream, remoteFileName, fileSize);

        const uploadSession = await MicrosoftGraph.LargeFileUploadTask.createUploadSession(client, requestUrl, payload);

        const uploadTask = new MicrosoftGraph.LargeFileUploadTask(client, fileObject, uploadSession);

        const uploadedFile = await uploadTask.upload();
        return uploadedFile;
    }

    async cleanFolderAsync(driveId: string, remotePath: string): Promise<void> {
        this._logger.info(`Cleaning target folder '${remotePath}'.`);

        const client = await this.getClientAsync();

        const folderUrl = Uploader.constructFileUrl(driveId, '', remotePath);

        let result: any;
        try {
            result = await client.api(`${folderUrl}:/children?$select=name,id,folder`)
                .get();
        } catch (error: unknown) {
            if ((error as any).statusCode !== 404) {
                throw error;
            }
        }

        if(!result || !result.value)
            return;

        const items = result.value as DriveItem[];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            logProgress(this._logger, items.length, i, `Deleting '${(!!item.folder ? item.name + '/' : item.name)}'`);

            const itemUrl = `/drives/${driveId}/items/${item.id}`;
            await client.api(itemUrl).delete();
        }
    }
}

export default Uploader;
