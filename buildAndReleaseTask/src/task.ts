import * as tl from 'azure-pipelines-task-lib/task';
import Uploader from './uploader';
import glob from 'glob';
import path from 'path';
import { TaskInputNames, TaskInputs, ConflictBehaviour } from './task-inputs';
import { printProgress } from './utils';

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
        tenantId: tl.getInput(TaskInputNames.tenantId, true)!,
        clientId: tl.getInput(TaskInputNames.clientId, true)!,
        clientSecret: tl.getInput(TaskInputNames.clientSecret, true)!,
        driveId: tl.getInput(TaskInputNames.driveId, true)!,
        targetFolder: tl.getInput(TaskInputNames.targetFolder, false) ?? '',
        sourceFolder: tl.getInput(TaskInputNames.sourceFolder, false) ?? '',
        contents: tl.getInput(TaskInputNames.contents, true)!,
        conflictBehaviour: tl.getInput(TaskInputNames.conflictBehaviour, true) as ConflictBehaviour,
        cleanTargetFolder: (tl.getInput(TaskInputNames.cleanTargetFolder, true) === "true"),
        flattenFolders: (tl.getInput(TaskInputNames.flattenFolders, true) === "true")
    };
}

async function processFilesAsync(uploader: Uploader, files: string[], inputs: TaskInputs) {
    const fileCount = files.length;
    if (fileCount === 0) return;
    
    console.log(`Copying files to ${inputs.targetFolder}'`);

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

        printProgress(fileCount, i, `Copying '${localRelativeFilePath}' -> '${path.join(remoteAbsolutePath, remoteFileName)}'`)

        await uploader.uploadFileAsync(localAbsoluteFilePath, inputs.driveId
            , remoteAbsolutePath, remoteFileName);
    }
}

async function runTaskAsync(): Promise<void> {
    const inputs = readInputs();

    const files = await getSourceFilesAsync(inputs.sourceFolder, inputs.contents);
    console.log(`Found ${files.length} files in '${inputs.sourceFolder}'.`);

    const uploader = new Uploader({
        auth: {
            clientId: inputs.clientId,
            clientSecret: inputs.clientSecret,
            tenantId: inputs.tenantId
        },
        conflictBehaviour: inputs.conflictBehaviour
    });

    if (inputs.cleanTargetFolder) {
        await uploader.cleanFolderAsync(inputs.driveId, inputs.targetFolder);
    }

    await processFilesAsync(uploader, files, inputs);
}


export default runTaskAsync;
