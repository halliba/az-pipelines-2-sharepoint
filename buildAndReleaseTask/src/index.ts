import 'cross-fetch/polyfill';

import * as tl from 'azure-pipelines-task-lib/task';
import { runTaskAsync } from './task';
import { describeError, formatError } from './errors';

async function run() {
    try {
        const result = await runTaskAsync();
        tl.setResult(result.result, result.message ?? "");
    }
    catch (err: unknown) {
        // Not console.error(err): it prints stream objects instead of the error and the full
        // upload URL including its access token.
        const description = await describeError(err);
        if (description.details) {
            tl.debug(description.details);
        }
        tl.setResult(tl.TaskResult.Failed, formatError(description));
    }
}

run();
