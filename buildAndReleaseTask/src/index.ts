import 'isomorphic-unfetch';

import * as tl from 'azure-pipelines-task-lib/task';
import runTaskAsync from './task';

async function run() {
    try {
        await runTaskAsync();
    }
    catch (err) {
        console.error(err);
        tl.setResult(tl.TaskResult.Failed, err?.message);
    }
}

run();
