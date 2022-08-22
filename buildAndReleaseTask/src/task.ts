import { getBoolInput, getInput, getInputRequired, setResult, TaskResult } from 'azure-pipelines-task-lib/task';
import Uploader from './uploader';
import glob from 'glob';
import path from 'path';
import { TaskInputNames, TaskInputs, ConflictBehaviour } from './task-inputs';
import { validateDrive } from './drive-utils';
import { azPipelinesLogger, ILogger, logProgress } from './logger';

function getSourceFilesAsync(sourceFolder: string, contents: string): Promise<string[]> {
    return new Promise<string[]>(
        (resolve, reject) => {
            const options: glob.IOptions = {
                cwd: sourceFolder,
                nodir: true
            };

            glob(contents, options, (err, matches) => {
                if (err) {
                    reject(err);
                }

                resolve(matches);
            });
        }
    );
}

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
        flattenFolders: getBoolInput(TaskInputNames.flattenFolders, true)
    };
}

async function processFilesAsync(uploader: Uploader, files: string[], inputs: TaskInputs, logger: ILogger) {
    const fileCount = files.length;
    if (fileCount === 0) return;
    
    logger.info(`Copying files to ${inputs.targetFolder}'`);

    for (let i = 0; i < fileCount; i++) {
        const localRelativeFilePath = files[i];

        const localAbsoluteFilePath = path.join(inputs.sourceFolder, localRelativeFilePath);

        let remoteRelativePath: string;
        if (inputs.flattenFolders) {
            remoteRelativePath = '';
        } else {
            remoteRelativePath = path.dirname(localRelativeFilePath);
        }

        const remoteFileName = path.basename(localRelativeFilePath);
        const remoteAbsolutePath = path.join(inputs.targetFolder, remoteRelativePath);

        logProgress(logger, fileCount, i, `Copying '${localRelativeFilePath}' -> '${path.join(remoteAbsolutePath, remoteFileName)}'`)

        await uploader.uploadFileAsync(localAbsoluteFilePath, inputs.driveId
            , remoteAbsolutePath, remoteFileName);
    }
}

async function runTaskAsync(): Promise<void> {
    const logger = azPipelinesLogger();
    const inputs = readInputs();

    const files = await getSourceFilesAsync(inputs.sourceFolder, inputs.contents);
    logger.info(`Found ${files.length} files in '${inputs.sourceFolder}'.`);

    const uploader = new Uploader({
        auth: {
            clientId: inputs.clientId,
            clientSecret: inputs.clientSecret,
            tenantId: inputs.tenantId
        },
        conflictBehaviour: inputs.conflictBehaviour
    }, logger);

    const validate = await validateDrive(inputs.driveId, await uploader.getClientAsync(), logger);
    if(!validate.valid) {
        setResult(TaskResult.Failed, 'Invalid driveId');
        return;
    }

    inputs.driveId = validate.driveId;

    if (inputs.cleanTargetFolder) {
        await uploader.cleanFolderAsync(inputs.driveId, inputs.targetFolder);
    }

    await processFilesAsync(uploader, files, inputs, logger);
}


export {
    runTaskAsync
};
