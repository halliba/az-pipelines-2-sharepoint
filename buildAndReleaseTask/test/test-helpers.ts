import { Client } from "@microsoft/microsoft-graph-client"
import { getInputRequired } from "azure-pipelines-task-lib";
import { TaskInputNames } from "../src/task-inputs";
import Uploader from "../src/uploader";

const TestInputNames = {
    rootUrl: "TESTS_rootUrl",
    driveIdLibraryNormalSite: "TESTS_driveIdLibraryNormalSite",
    driveIdLibrarySubsite: "TESTS_driveIdLibrarySubsite",
    driveIdLibraryRootsite: "TESTS_driveIdLibraryRootsite"
};

async function getTestClientAsync(): Promise<Client> {
    const aadToken = await Uploader.getAccessTokenAsync({
        tenantId: getInputRequired(TaskInputNames.tenantId),
        clientId: getInputRequired(TaskInputNames.clientId),
        clientSecret: getInputRequired(TaskInputNames.clientSecret),
    });
    const client = Uploader.createClient(aadToken);
    return client;
}

export {
    TestInputNames,
    getTestClientAsync
};
