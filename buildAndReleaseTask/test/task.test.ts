import * as assert from "assert";
import 'cross-fetch/polyfill';
import { TaskResult } from "azure-pipelines-task-lib";
import { readInputs } from "../src/task-inputs";
import { runTaskAsync } from "../src/task";
import { consoleLogger } from "../src/logger";

describe("task", () => {
    describe("runTaskAsync", () => {
        it(`Should fail for empty source if failOnEmptySource=true`, async () => {
            const inputs = readInputs();
            inputs.sourceFolder = 'src';
            inputs.contents = '**.xyz'
            inputs.failOnEmptySource = true;

            const result = await runTaskAsync(inputs, consoleLogger());
            assert.strictEqual(result.result, TaskResult.Failed);
            assert.strictEqual(result.message, 'No files found in source folder.');
        });
    });
});
