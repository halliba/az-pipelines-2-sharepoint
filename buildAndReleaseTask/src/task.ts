import { TaskResult } from 'azure-pipelines-task-lib/task';
import Uploader from './uploader';
import glob from 'glob';
import path from 'path';
import { TaskInputs, readInputs } from './task-inputs';
import { validateDrive } from './drive-utils';
import { joinDrivePath } from './drive-paths';
import { ContextError, describeError, formatError } from './errors';
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

async function processFilesAsync(uploader: Uploader, files: string[], inputs: TaskInputs, logger: ILogger) {
    const fileCount = files.length;
    if (fileCount === 0) return;
    
    logger.info(`Copying files to '${inputs.targetFolder}'`);

    for (let i = 0; i < fileCount; i++) {
        const localRelativeFilePath = files[i];

        const localAbsoluteFilePath = path.join(inputs.sourceFolder, localRelativeFilePath);

        // Paths in the drive use '/' only; path.join would put '\' into them on Windows agents.
        const localSegments = localRelativeFilePath.split(/[\\/]+/);
        const remoteFileName = localSegments[localSegments.length - 1];
        const remoteRelativePath = inputs.flattenFolders ? '' : joinDrivePath(...localSegments.slice(0, -1));
        const remoteAbsolutePath = joinDrivePath(inputs.targetFolder, remoteRelativePath);
        const remoteFilePath = joinDrivePath(remoteAbsolutePath, remoteFileName);

        logProgress(logger, fileCount, i, `Copying '${localRelativeFilePath}' -> '${remoteFilePath}'`)

        try {
            await uploader.uploadFileAsync(localAbsoluteFilePath, inputs.driveId
                , remoteAbsolutePath, remoteFileName);
        } catch (error) {
            throw new ContextError(`Uploading '${localRelativeFilePath}' to '${remoteFilePath}' failed`, error);
        }
    }
}

async function runTaskAsync(inputs?: TaskInputs, logger?: ILogger): Promise<{
    result: TaskResult;
    message?: string;
}> {
    if(!logger) logger = azPipelinesLogger();
    if(!inputs) inputs = readInputs();

    const files = await getSourceFilesAsync(inputs.sourceFolder, inputs.contents);
    logger.info(`Found ${files.length} files in '${inputs.sourceFolder}'.`);
    logger.debug(`Files: ${JSON.stringify(files)}`);

    if(inputs.failOnEmptySource && files.length === 0) {
        return { result: TaskResult.Failed, message: 'No files found in source folder.' };
    }

    if(files.length === 0) {
        logger.warning(`No files match '${inputs.contents}' in '${inputs.sourceFolder}'; nothing will be uploaded.`);
    }

    const uploader = new Uploader({
        auth: {
            clientId: inputs.clientId,
            clientSecret: inputs.clientSecret,
            tenantId: inputs.tenantId
        },
        conflictBehaviour: inputs.conflictBehaviour,
        maxRetries: inputs.maxRetries
    }, logger);

    try {
        const driveId = await validateDrive(inputs.driveId, await uploader.getClientAsync(), logger);
        inputs.driveId = driveId;
    } catch(error) {
        const description = await describeError(new ContextError(`Could not validate drive '${inputs.driveId}'`, error));
        if (description.details) {
            logger.debug(description.details);
        }
        return { result: TaskResult.Failed, message: formatError(description) };
    }

    if (inputs.cleanTargetFolder) {
        try {
            await uploader.cleanFolderAsync(inputs.driveId, inputs.targetFolder);
        } catch (error) {
            throw new ContextError(`Cleaning target folder '${inputs.targetFolder}' failed`, error);
        }
    }

    await processFilesAsync(uploader, files, inputs, logger);

    logger.debug('Done.');
    return { result: TaskResult.Succeeded };
}

export {
    runTaskAsync
};
