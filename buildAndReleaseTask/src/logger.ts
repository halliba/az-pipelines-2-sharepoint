import { warning, error, debug } from 'azure-pipelines-task-lib/task';

interface ILogger {
    debug(message: string): void;
    info(message: string): void;
    error(message: string): void;
    warning(message: string): void;
}

const noLogger = (): ILogger => ({
    debug: () => { },
    info: () => { },
    error: () => { },
    warning: () => { }
});

const consoleLogger = (): ILogger => ({
    debug: console.debug,
    info: console.log,
    error: console.error,
    warning: console.warn
});

const azPipelinesLogger = (): ILogger => ({
    debug: (s) => debug(s),
    info: (s) => console.log(s),
    error: (s) => error(s),
    warning: (s) => warning(s),
});

const logProgress = function (logger: ILogger, totalItems: number, index: number, message: string) {
    const padSize = totalItems.toString().length;
    logger.info(`[${(index + 1).toString().padStart(padSize, '0')}`
        + `/${totalItems}] ${message}`);
}

export type {
    ILogger
};

export {
    noLogger,
    azPipelinesLogger,
    consoleLogger,
    logProgress
};
