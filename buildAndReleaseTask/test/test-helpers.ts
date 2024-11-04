import { Client } from "@microsoft/microsoft-graph-client"
import { getInputRequired } from "azure-pipelines-task-lib";
import { TaskInputNames } from "../src/task-inputs";
import { createClient } from "../src/auth";

const TestInputNames = {
    rootUrl: "TESTS_rootUrl",
    driveIdLibraryNormalSite: "TESTS_driveIdLibraryNormalSite",
    driveIdLibrarySubsite: "TESTS_driveIdLibrarySubsite",
    driveIdLibraryRootsite: "TESTS_driveIdLibraryRootsite"
};

async function getTestClientAsync(): Promise<Client> {
    const client = createClient({
        tenantId: getInputRequired(TaskInputNames.tenantId),
        clientId: getInputRequired(TaskInputNames.clientId),
        clientSecret: getInputRequired(TaskInputNames.clientSecret)
    });
    return client;
}

export {
    TestInputNames,
    getTestClientAsync
};
