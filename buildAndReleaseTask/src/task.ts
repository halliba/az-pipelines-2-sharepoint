import * as tl from 'azure-pipelines-task-lib/task';
import Uploader from './uploader';
import glob from 'glob';
import path from 'path';

interface TaskInputs {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    driveId: string;
    targetFolder: string;
    sourceFolder: string;
    contents: string;
    conflictBehaviour: "fail" | "replace" | "rename"
}

function getSourceFilesAsync(sourceFolder: string, contents: string): Promise<string[]> {
    return new Promise<string[]>(
        (resolve, reject) => {
            const options: glob.IOptions = {
                cwd: sourceFolder,
                nodir: true
            }

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
        tenantId: tl.getInput('tenantId', true)!,
        clientId: tl.getInput('clientId', true)!,
        clientSecret: tl.getInput('clientSecret', true)!,
        driveId: tl.getInput('driveId', true)!,
        targetFolder: tl.getInput('targetFolder', true)!,
        sourceFolder: tl.getInput('sourceFolder', true)!,
        contents: tl.getInput('contents', true)!,
        conflictBehaviour: tl.getInput('conflictBehaviour', true) as "fail" | "replace" | "rename"
    };
}

async function processFilesAsync(files: string[], inputs: TaskInputs) {
    const uploader = new Uploader({
        auth: {
            clientId: inputs.clientId,
            clientSecret: inputs.clientSecret,
            tenantId: inputs.tenantId
        },
        conflictBehaviour: inputs.conflictBehaviour
    });

    const fileCount = files.length;

    const printProgress = function (index: number, localFilePath: string, remoteFilePath: string) {
        const padSize = fileCount.toString().length;
        console.log(`[${(index + 1).toString().padStart(padSize, '0')}`
            + `/${fileCount}] '${localFilePath}' -> '${remoteFilePath}'`)
    }

    for (let i = 0; i < fileCount; i++) {
        const localRelativeFilePath = files[i];
        
        const localAbsoluteFilePath = path.join(inputs.sourceFolder, localRelativeFilePath);

        const remoteRelativePath = path.dirname(localRelativeFilePath);
        const remoteFileName = path.basename(localRelativeFilePath);
        const remoteAbsolutePath = path.join(inputs.targetFolder, remoteRelativePath);

        printProgress(i, localRelativeFilePath, path.join(remoteAbsolutePath, remoteFileName))

        await uploader.uploadFileAsync(localAbsoluteFilePath, inputs.driveId
            , remoteAbsolutePath, remoteFileName);
    }
}

async function runTaskAsync(): Promise<void> {
    const inputs = readInputs();

    const files = await getSourceFilesAsync(inputs.sourceFolder, inputs.contents);
    console.log(`Found ${files.length} files in '${inputs.sourceFolder}'.`);

    if (files.length === 0) return;

    await processFilesAsync(files, inputs);
}


export default runTaskAsync;
