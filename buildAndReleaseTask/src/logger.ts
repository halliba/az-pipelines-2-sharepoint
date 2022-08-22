import { warning, error } from 'azure-pipelines-task-lib/task';

interface ILogger {
    info(message: string): void;
    error(message: string): void;
    warning(message: string): void;
}

const noLogger = (): ILogger => ({
    info: () => { },
    error: () => { },
    warning: () => { }
});

const azPipelinesLogger = (): ILogger => ({
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
    logProgress
};
