import { getBoolInput, getInput, getInputRequired } from "azure-pipelines-task-lib";
import { defaultRetryOptions } from "./retry";

type ConflictBehaviour = "fail" | "replace" | "rename";

interface TaskInputs {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    driveId: string;
    targetFolder: string;
    sourceFolder: string;
    contents: string;
    conflictBehaviour: ConflictBehaviour;
    cleanTargetFolder: boolean;
    flattenFolders: boolean;
    failOnEmptySource: boolean;
    maxRetries: number;
}

const TaskInputNames = {
    tenantId: "tenantId",
    clientId: 'clientId',
    clientSecret: 'clientSecret',
    driveId: 'driveId',
    targetFolder: 'targetFolder',
    sourceFolder: 'sourceFolder',
    contents: 'contents',
    conflictBehaviour: 'conflictBehaviour',
    cleanTargetFolder: 'cleanTargetFolder',
    flattenFolders: 'flattenFolders',
    failOnEmptySource: 'failOnEmptySource',
    maxRetries: 'maxRetries'
};

function readInputs(): TaskInputs {
    return {
        tenantId: getInputRequired(TaskInputNames.tenantId),
        clientId: getInputRequired(TaskInputNames.clientId)!,
        clientSecret: getInputRequired(TaskInputNames.clientSecret),
        driveId: getInputRequired(TaskInputNames.driveId),
        targetFolder: getInput(TaskInputNames.targetFolder, false) ?? '',
        sourceFolder: getInput(TaskInputNames.sourceFolder, false) ?? '',
        contents: getInputRequired(TaskInputNames.contents),
        conflictBehaviour: getInputRequired(TaskInputNames.conflictBehaviour) as ConflictBehaviour,
        cleanTargetFolder: getBoolInput(TaskInputNames.cleanTargetFolder, true),
        flattenFolders: getBoolInput(TaskInputNames.flattenFolders, true),
        failOnEmptySource: getBoolInput(TaskInputNames.failOnEmptySource, false) ?? false,
        maxRetries: parseMaxRetries(getInput(TaskInputNames.maxRetries, false))
    };
}

/**
 * Empty or missing (e.g. in definitions saved before the input existed) means the default.
 */
function parseMaxRetries(value: string | undefined): number {
    if (value === undefined || value.trim() === '') {
        return defaultRetryOptions.maxRetries;
    }

    const retries = Number(value.trim());
    if (!Number.isInteger(retries) || retries < 0 || retries > 20) {
        throw new Error(`Input '${TaskInputNames.maxRetries}' must be a whole number from 0 to 20, got '${value}'.`);
    }
    return retries;
}

export {
    ConflictBehaviour,
    TaskInputs,
    TaskInputNames,
    parseMaxRetries,
    readInputs
};
