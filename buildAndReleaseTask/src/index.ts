import 'cross-fetch/polyfill';

import * as tl from 'azure-pipelines-task-lib/task';
import { runTaskAsync } from './task';

async function run() {
    try {
        var result = await runTaskAsync();
        tl.setResult(result.result, result.message ?? "");
    }
    catch (err: unknown) {
        console.error(err);
        tl.setResult(tl.TaskResult.Failed, (err as Error)?.message);
    }
}

run();
