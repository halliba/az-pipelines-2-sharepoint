const printProgress = function (totalItems: number, index: number, message: string) {
    const padSize = totalItems.toString().length;
    console.log(`[${(index + 1).toString().padStart(padSize, '0')}`
        + `/${totalItems}] ${message}`);
}

export {
    printProgress
};
