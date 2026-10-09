import * as assert from "assert";
import Uploader from "../../src/uploader";
import { driveItemUrl, folderChildrenUrl, joinDrivePath } from "../../src/drive-paths";
import { normalizeDriveUrl } from "../../src/drive-utils";

describe("drive-paths", () => {
    describe("joinDrivePath", () => {
        const cases: { parts: string[]; expected: string; }[] = [
            { parts: ['/target/', 'sub\\dir', 'file.txt'], expected: 'target/sub/dir/file.txt' },
            { parts: ['smoke/target', 'sub', 'hello.txt'], expected: 'smoke/target/sub/hello.txt' },
            { parts: ['', '.', 'a.zip'], expected: 'a.zip' },
            { parts: ['Abhängige Apps (Entwickler)/', ''], expected: 'Abhängige Apps (Entwickler)' },
            { parts: ['//a//b//'], expected: 'a/b' },
            { parts: [], expected: '' }
        ];

        cases.forEach((c) => {
            it(`joins ${JSON.stringify(c.parts)} to '${c.expected}'`, () => {
                assert.strictEqual(joinDrivePath(...c.parts), c.expected);
            });
        });
    });

    describe("driveItemUrl", () => {
        it("addresses the drive root without a path", () => {
            assert.strictEqual(driveItemUrl('d', ''), '/drives/d/root');
            assert.strictEqual(driveItemUrl('d', '/'), '/drives/d/root');
        });

        it("escapes every segment", () => {
            assert.strictEqual(driveItemUrl('d', 'a b/c#d%e&f.txt'), '/drives/d/root:/a%20b/c%23d%25e%26f.txt');
        });

        it("never sends backslashes", () => {
            assert.strictEqual(driveItemUrl('d', 'smoke\\target\\sub\\hello.txt'), '/drives/d/root:/smoke/target/sub/hello.txt');
        });
    });

    describe("folderChildrenUrl", () => {
        it("lists the children of the drive root (#11)", () => {
            assert.strictEqual(folderChildrenUrl('d', ''), '/drives/d/root/children');
            assert.strictEqual(folderChildrenUrl('d', '/'), '/drives/d/root/children');
        });

        it("lists the children of a folder", () => {
            assert.strictEqual(folderChildrenUrl('d', '/folder/sub/'), '/drives/d/root:/folder/sub:/children');
        });
    });

    describe("Uploader.constructFileUrl", () => {
        const cases: { path: string; file: string; expected: string; }[] = [
            { path: '', file: 'some-file', expected: 'some-file' },
            { path: 'path1/path2/', file: '/file1', expected: 'path1/path2/file1' },
            { path: '//path1/path2/', file: '/path3/file2//', expected: 'path1/path2/path3/file2' },
            { path: '/path 1/', file: '/ file 1', expected: 'path%201/%20file%201' },
            { path: 'smoke\\target\\sub', file: 'hello.txt', expected: 'smoke/target/sub/hello.txt' }
        ];

        cases.forEach((c) => {
            it(`constructs '${c.expected}'`, () => {
                assert.strictEqual(Uploader.constructFileUrl('drive-id', c.file, c.path), `/drives/drive-id/root:/${c.expected}`);
            });
        });
    });

    describe("normalizeDriveUrl", () => {
        const cases: { url: string; expected: string; }[] = [
            { url: 'https://contoso.sharepoint.com/projekte/SEC//Objektauslieferung', expected: 'https://contoso.sharepoint.com/projekte/SEC/Objektauslieferung' },
            { url: ' https://contoso.sharepoint.com/sites/x/Shared%20Documents/ ', expected: 'https://contoso.sharepoint.com/sites/x/Shared%20Documents' },
            { url: 'https://contoso.sharepoint.com//sites///x//Docs//', expected: 'https://contoso.sharepoint.com/sites/x/Docs' },
            { url: 'https://contoso.sharepoint.com/test', expected: 'https://contoso.sharepoint.com/test' }
        ];

        cases.forEach((c) => {
            it(`normalizes '${c.url}'`, () => {
                assert.strictEqual(normalizeDriveUrl(c.url), c.expected);
            });
        });
    });
});
