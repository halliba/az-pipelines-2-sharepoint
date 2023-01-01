import * as MicrosoftGraph from "@microsoft/microsoft-graph-client"
import * as assert from "assert";
import { getDriveFromUrl, validateDrive } from "../src/drive-utils";
import 'cross-fetch/polyfill';
import { consoleLogger, noLogger } from "../src/logger";
import { getInput, getInputRequired } from "azure-pipelines-task-lib/task";
import { getTestClientAsync, TestInputNames } from "./test-helpers";

describe("drive-utils", () => {
    const logger = consoleLogger();
    const config = {
        rootUrl: getInput(TestInputNames.rootUrl, true) as string
    };

    let client: MicrosoftGraph.Client;
    before(function (done) {    
        getTestClientAsync().then(c => {
            client = c;
            done();
        }).catch(done);
    });

    describe("validateDrive", () => {
        it("Should throw on missing driveId", async () => {
            const client = (null as unknown) as MicrosoftGraph.Client;
            await assert.rejects(validateDrive(((null as unknown) as string),client, logger));
            await assert.rejects(validateDrive("", client, logger));
        });

        it("should reject invalid drive id", async () => {
            await assert.rejects(validateDrive("xx",client, logger));
        });
        
        it("should reject not existing drive id", async () => {
            const id = "b!bp-fL257902xrWQ7azGge8Bbz1xT-wJAvjIIOWk_yHaGSmPlbO_fR5IrErDrWoVl";
            await assert.rejects(validateDrive(id,client, logger));
        });
    });
    
    describe("getDriveFromUrl", () => {
        it("Should throw on missing or malformed url", async () => {
            const client = (null as unknown) as MicrosoftGraph.Client;
            await assert.rejects(getDriveFromUrl(((null as unknown) as string),client));
            await assert.rejects(getDriveFromUrl("", client));
            await assert.rejects(getDriveFromUrl("http://someurl", client));
        });

        const cases = [
            {
                label: 'normal site',
                url: `${config.rootUrl}/sites/dev-tests/Shared%20Documents/`,
                driveId: getInputRequired(TestInputNames.driveIdLibraryNormalSite)
            },
            {
                label: 'subsite',
                url: `${config.rootUrl}/sites/dev-tests/subsite/Shared%20Documents/`,
                driveId: getInputRequired(TestInputNames.driveIdLibrarySubsite)
            },
            {
                label: 'root site',
                url: `${config.rootUrl}/test`,
                driveId: getInputRequired(TestInputNames.driveIdLibraryRootsite)
            }
        ];
        
        cases.forEach((c) => {
            it(`Should get driveId from valid url (${c.label})`, async () => {
                const drive = await getDriveFromUrl(c.url, client);
                
                assert.notStrictEqual(drive, null);
                assert.notStrictEqual(drive, undefined);
                
                assert.strictEqual(drive?.id, c.driveId);
            });
        });
        
        it(`Should throw for not existing drive`, async () => {
            const url = `${config.rootUrl}/sites/site-that-does-not-exist/Shared%20Documents`; 
            assert.rejects(getDriveFromUrl(url, client));
        });
    });
});
