/**
 * Paths inside a SharePoint drive always use '/'. Local paths on Windows agents use '\',
 * which is not allowed in SharePoint names and must not reach the request.
 */

/**
 * Splits a drive path at '/' and '\' and drops empty and '.' segments.
 */
function splitDrivePath(drivePath: string): string[] {
    return (drivePath ?? '')
        .split(/[\\/]+/)
        .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Joins drive paths with '/', e.g. ('/target/', 'sub\\dir', 'file.txt') -> 'target/sub/dir/file.txt'.
 */
function joinDrivePath(...parts: string[]): string {
    return parts
        .map(splitDrivePath)
        .reduce((all, segments) => all.concat(segments), [] as string[])
        .join('/');
}

/**
 * Graph address of a drive item by its path, e.g. '/drives/{id}/root:/folder/file.txt'.
 * An empty path is the drive root, which has no path form: '/drives/{id}/root'.
 */
function driveItemUrl(driveId: string, drivePath: string): string {
    const segments = splitDrivePath(drivePath).map((segment) => encodeURIComponent(segment));
    return segments.length === 0
        ? `/drives/${driveId}/root`
        : `/drives/${driveId}/root:/${segments.join('/')}`;
}

/**
 * Graph address of the children of a folder; for the drive root '/drives/{id}/root/children'.
 */
function folderChildrenUrl(driveId: string, folderPath: string): string {
    return splitDrivePath(folderPath).length === 0
        ? `${driveItemUrl(driveId, folderPath)}/children`
        : `${driveItemUrl(driveId, folderPath)}:/children`;
}

export {
    splitDrivePath,
    joinDrivePath,
    driveItemUrl,
    folderChildrenUrl
};
