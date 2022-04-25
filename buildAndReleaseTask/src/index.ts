import 'cross-fetch/polyfill';

import * as tl from 'azure-pipelines-task-lib/task';
import runTaskAsync from './task';

async function run() {
    try {
        await runTaskAsync();
    }
    catch (err: unknown) {
        console.error(err);
        tl.setResult(tl.TaskResult.Failed, (err as Error)?.message);
    }
}

run();
