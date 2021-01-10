import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import * as tl from 'azure-pipelines-task-lib/task';
import { DriveItem } from "@microsoft/microsoft-graph-types";
import fs from 'fs';
import fetch from 'node-fetch';

interface AadAuthToken {
    token_type: "Bearer"
    expires_in: number,
    access_token: string
}

interface UploaderAuthOptions {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}

interface UploaderOptions {
    auth: UploaderAuthOptions;
    conflictBehaviour: "fail" | "replace" | "rename";
}

class Uploader {
    private static _defaults = {
        aadScope: 'https://graph.microsoft.com/.default'
    };

    private _options: UploaderOptions;
    private _client?: MicrosoftGraph.Client;

    constructor(options: UploaderOptions) {
        this._options = options;
    }

    static getAccessTokenEndpoint(tenantId: string): string {
        return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    }

    static async getAccessTokenAsync(authOptions: UploaderAuthOptions): Promise<AadAuthToken> {
        const endpointUrl = this.getAccessTokenEndpoint(authOptions.tenantId);

        const body = `client_id=${encodeURIComponent(authOptions.clientId)}`
            + `&scope=${encodeURIComponent(this._defaults.aadScope)}`
            + `&client_secret=${encodeURIComponent(authOptions.clientSecret)}`
            + `&grant_type=client_credentials`;

        var response = await fetch(endpointUrl, {
            body: body,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        var result = await response.json() as AadAuthToken;

        return result;
    }

    static createClient(aadToken: AadAuthToken): MicrosoftGraph.Client {
        const client = MicrosoftGraph.Client.initWithMiddleware({
            authProvider: {
                getAccessToken: () => Promise.resolve(aadToken.access_token)
            }
        });

        return client;
    }

    async getClientAsync(): Promise<MicrosoftGraph.Client> {
        if (!!this._client) {
            return this._client;
        }

        const aadToken = await Uploader.getAccessTokenAsync(this._options.auth);
        const client = Uploader.createClient(aadToken);

        this._client = client;
        return client;
    }

    static constructFileUrl(driveId: string, fileName: string, path: string = '/'): string {
        fileName = fileName.trim();
        path = path.trim();
        if (path === "") {
            path = "/";
        }
        if (path[0] !== "/") {
            path = `/${path}`;
        }
        if (path[path.length - 1] !== "/") {
            path = `${path}/`;
        }
        
        return `/drives/${driveId}/root:${path
            .split("/")
            .map((p) => encodeURIComponent(p))
            .join("/")}${encodeURIComponent(fileName)}`;
    }

    async uploadFileAsync(localFilePath: string, driveId: string, remotePath: string, remoteFileName: string): Promise<DriveItem | null> {
        const client = await this.getClientAsync();

        const file = await fs.promises.readFile(localFilePath)

        var uploadedFile: DriveItem | null;

        const requestUrl = Uploader.constructFileUrl(driveId, remoteFileName, remotePath)
            + ':/createUploadSession';

        const payload = {
            "item": {
                "@microsoft.graph.conflictBehavior": this._options.conflictBehaviour,
                "name": remoteFileName,
            },
            "deferCommit": file.length === 0
        };

        const fileObject: MicrosoftGraph.FileObject = {
            size: file.length,
            content: file,
            name: remoteFileName,
        };

        const uploadSession = await MicrosoftGraph.LargeFileUploadTask.createUploadSession(client, requestUrl, payload);

        const uploadTask = new MicrosoftGraph.LargeFileUploadTask(client, fileObject, uploadSession);

        if (file.length === 0) {
            const byte0Msg = `SharePoint Online does not support 0-Byte files: '${localFilePath}'.`;
            tl.warning(byte0Msg)
            console.warn(byte0Msg);

            uploadedFile = null;
        } else {
            uploadedFile = await uploadTask.upload();
        }

        return uploadedFile;
    }
}

export default Uploader;
