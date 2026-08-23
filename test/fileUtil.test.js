/**
 * AIメモ:
 * - fileUtil.js (ファイル・JSON操作ユーティリティ) の単体テスト。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const fileUtil = require('../modules/fileUtil.js');

describe('fileUtil Module', () => {
    const testDir = path.resolve(__dirname, '../.tmp_test_fileutil');

    beforeAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        fileUtil.ensureDir(testDir);
    });

    afterAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('JSON の読み書き (writeJson, readJson) が正しく動作すること', () => {
        const jsonPath = path.join(testDir, 'sub', 'test.json');
        const data = { name: 'maachang', version: 1, tags: ['bun', 'server'] };

        expect(fileUtil.writeJson(jsonPath, data)).toBe(true);
        expect(fileUtil.exists(jsonPath)).toBe(true);

        const loaded = fileUtil.readJson(jsonPath);
        expect(loaded).toEqual(data);

        // 存在しないファイルは defaultValue を返す
        expect(fileUtil.readJson(path.join(testDir, 'not_found.json'), { def: 1 })).toEqual({ def: 1 });
    });

    it('JSコメント (// および /* ... */) や末尾カンマを含む JSONC の読み込みが正しく動作すること', () => {
        const jsoncContent = `
        // 設定ファイルのヘッダーコメント
        /* 
         * 複数行の
         * ブロックコメント
         */
        {
            // サーバーポート
            "port": 3000,
            "host": "0.0.0.0", /* バインドホスト */
            "url": "http://localhost:3000/api", // URL内の // はコメントとして除去されないこと
            "commentStr": "/* not a comment */",
            "items": [
                "item1",
                "item2", // リスト内コメント
            ], // 配列末尾カンマ
        } // オブジェクト末尾カンマ
        `;

        const jsoncPath = path.join(testDir, 'config.jsonc');
        fs.writeFileSync(jsoncPath, jsoncContent, 'utf-8');

        const parsed = fileUtil.readJson(jsoncPath);
        expect(parsed).not.toBeNull();
        expect(parsed.port).toBe(3000);
        expect(parsed.host).toBe('0.0.0.0');
        expect(parsed.url).toBe('http://localhost:3000/api');
        expect(parsed.commentStr).toBe('/* not a comment */');
        expect(parsed.items).toEqual(['item1', 'item2']);
    });

    it('テキストおよびバイナリの読み書き・サイズ取得が動作すること', () => {
        const txtPath = path.join(testDir, 'hello.txt');
        fileUtil.writeText(txtPath, 'こんにちは maachang');
        expect(fileUtil.readText(txtPath)).toBe('こんにちは maachang');
        expect(fileUtil.size(txtPath)).toBeGreaterThan(0);

        const binPath = path.join(testDir, 'binary.dat');
        const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
        fileUtil.writeBuffer(binPath, buf);
        const readBuf = fileUtil.readBuffer(binPath);
        expect(readBuf).toEqual(buf);
    });

    it('コピーと削除 (copy, remove) が動作すること', () => {
        const src = path.join(testDir, 'hello.txt');
        const dest = path.join(testDir, 'backup', 'hello_copy.txt');

        expect(fileUtil.copy(src, dest)).toBe(true);
        expect(fileUtil.exists(dest)).toBe(true);

        expect(fileUtil.remove(dest)).toBe(true);
        expect(fileUtil.exists(dest)).toBe(false);
    });

    it('ディレクトリ一覧取得 (list) がフィルタ・再帰を含め動作すること', () => {
        fileUtil.writeText(path.join(testDir, 'file1.txt'), '1');
        fileUtil.writeText(path.join(testDir, 'file2.json'), '{}');
        fileUtil.writeText(path.join(testDir, 'nested', 'file3.txt'), '3');

        // 直下
        const allDirect = fileUtil.list(testDir);
        expect(allDirect).toContain('file1.txt');
        expect(allDirect).toContain('file2.json');
        expect(allDirect).not.toContain('file3.txt');

        // 再帰 + 拡張子フィルタ (.txt)
        const txtFiles = fileUtil.list(testDir, { ext: 'txt', recursive: true });
        expect(txtFiles).toContain('file1.txt');
        expect(txtFiles).toContain(path.join('nested', 'file3.txt'));
        expect(txtFiles).not.toContain('file2.json');
    });

    it('safeFileName で安全なユニークファイル名が生成され、拡張子検証が行われること', () => {
        // 正常系
        const safe1 = fileUtil.safeFileName('../../../evil_name.JPG', ['jpg', 'png'], 'avatar_');
        expect(safe1.startsWith('avatar_')).toBe(true);
        expect(safe1.endsWith('.jpg')).toBe(true);
        expect(safe1).not.toContain('..');
        expect(safe1).not.toContain('/');

        // 異常系 (許可されていない拡張子)
        expect(() => {
            fileUtil.safeFileName('script.exe', ['jpg', 'png', 'pdf']);
        }).toThrow('許可されていないファイル拡張子');
    });
});
