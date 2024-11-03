import * as assert from "assert";
import Uploader from "../src/uploader";
import { getInputRequired } from "azure-pipelines-task-lib";
import { TaskInputNames } from "../src/task-inputs";
import { noLogger } from "../src/logger";
import { getDriveFromUrl } from "../src/drive-utils";
import { TestInputNames } from "./test-helpers";
import { DriveItem } from "@microsoft/microsoft-graph-types";
import { UploadResult } from "@microsoft/microsoft-graph-client";

describe("uploader", () => {
    const authOptions = {
        tenantId: getInputRequired(TaskInputNames.tenantId),
        clientId: getInputRequired(TaskInputNames.clientId),
        clientSecret: getInputRequired(TaskInputNames.clientSecret),
    };

    describe("constructFileUrl", () => {
        const cases: {path: string; file: string; expected: string;}[] = [
            {
                path: '',
                file: 'some-file',
                expected: 'some-file'
            }, {
                path: 'path1/path2/',
                file: '/file1',
                expected: 'path1/path2/file1'
            }, {
                path: '//path1/path2/',
                file: '/path3/file2//',
                expected: 'path1/path2/path3/file2'
            }, {
                path: '/path 1/',
                file: '/ file 1',
                expected: 'path%201/%20file%201'
            }
        ];
        
        cases.forEach((c, i) => {
            it(`Should construct correct file path: (${c.expected})`, async () => {    
                const result = Uploader.constructFileUrl('drive-id', c.file, c.path);
                const expected = `/drives/drive-id/root:/${c.expected}`;
                assert.strictEqual(result, expected);
            });
        });
    });

    describe("",  () => {
        let uploader: Uploader;
        let driveId: string;

        before(async function () {    
            uploader = new Uploader({
                auth: authOptions,
                conflictBehaviour: 'replace'
            }, noLogger());
            
            const url = getInputRequired(TestInputNames.rootUrl) + '/sites/dev-tests/Shared%20Documents';
            const client = await uploader.getClientAsync();
            
            const drive = await getDriveFromUrl(url, client);
            assert.notStrictEqual(drive?.id, null);
            driveId = drive?.id!;
        });

        it(`Should upload file`, async () => {
            uploader.setConflictBehaviour("replace");
            const result = await uploader.uploadFileAsync('src/index.ts', driveId, '/tests/uploader/', 'index.ts');
            
            const file = result?.responseBody as DriveItem;
            assert.strictEqual(file.name, "index.ts");
        }).timeout(5000);
        
        it(`Should fail for duplicate file if conflictBehaviour=fail`, async () => {
            let result: UploadResult | null;
            
            uploader.setConflictBehaviour("replace");
            result = await uploader.uploadFileAsync('src/index.ts', driveId, '/tests/uploader/', 'index.ts');
            const file = result?.responseBody as DriveItem;
            assert.strictEqual(file.name, "index.ts");

            uploader.setConflictBehaviour("fail");
            await assert.rejects(async () => {
                await uploader.uploadFileAsync('src/index.ts', driveId, '/tests/uploader/', 'index.ts');
            });
        }).timeout(5000);
    });
});
