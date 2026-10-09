import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import { DriveItem } from "@microsoft/microsoft-graph-types";
import fs from 'fs';
import fetch from 'cross-fetch';
import { ConflictBehaviour } from "./task-inputs";
import { ILogger, logProgress } from './logger';
import { AuthOptions, createClient } from "./auth";
import { driveItemUrl, folderChildrenUrl, joinDrivePath } from "./drive-paths";

interface UploaderOptions {
    auth: AuthOptions;
    conflictBehaviour: ConflictBehaviour;
    /** Retries on temporary errors; the client's default when not set. */
    maxRetries?: number;
}

class Uploader {
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

    async getClientAsync(): Promise<MicrosoftGraph.Client> {
        if (!!this._client) {
            return this._client;
        }

        const client = createClient(this._options.auth, {
            retry: { maxRetries: this._options.maxRetries },
            logger: this._logger
        });

        this._client = client;
        return client;
    }

    static constructFileUrl(driveId: string, fileName: string, path: string = '/'): string {
        return driveItemUrl(driveId, joinDrivePath(path, fileName));
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

        let result: any;
        try {
            result = await client.api(`${folderChildrenUrl(driveId, remotePath)}?$select=name,id,folder`)
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
