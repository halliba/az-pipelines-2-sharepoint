import { getBoolInput, getInput, getInputRequired } from "azure-pipelines-task-lib";

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
    failOnEmptySource: 'failOnEmptySource'
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
        failOnEmptySource: getBoolInput(TaskInputNames.failOnEmptySource, true)
    };
}

export {
    ConflictBehaviour,
    TaskInputs,
    TaskInputNames,
    readInputs
};
