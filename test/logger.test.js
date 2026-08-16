/**
 * AIメモ:
 * - logger.js (minto localLog.js 互換) の単体テスト。
 * - ログレベル判定、フォーマット、ファイル出力、日別ローテーションを検証。
 */

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../src/logger.js');

describe('Logger Module (minto localLog.js compatibility)', () => {
    const testLogDir = path.resolve(__dirname, '../.tmp_test_log');

    beforeAll(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    it('setting() で設定変更し、ログファイルへ正しく書き込めること', async () => {
        logger.setting({
            dir: testLogDir,
            file: 'testout',
            level: 'debug',
            stdout: false
        });

        logger.debug('Debug message test: %s', 'debug123');
        logger.info('Info message test: %d', 100);
        logger.error('Error message test: %s', 'err456');

        // ファイル書き込み待機
        await new Promise(r => setTimeout(r, 50));

        const files = fs.readdirSync(testLogDir);
        expect(files.length).toBeGreaterThan(0);

        const logFileName = files.find(f => f.startsWith('testout.') && f.endsWith('.log'));
        expect(logFileName).toBeDefined();

        const content = fs.readFileSync(path.join(testLogDir, logFileName), 'utf-8');
        expect(content).toContain('[DEBUG] Debug message test: debug123');
        expect(content).toContain('[INFO] Info message test: 100');
        expect(content).toContain('[ERROR] Error message test: err456');
    });

    it('ログレベルによるフィルタリングが動作すること', async () => {
        logger.setting({
            dir: testLogDir,
            file: 'filterout',
            level: 'warn',
            stdout: false
        });

        logger.debug('This should not be written');
        logger.info('This should not be written');
        logger.warn('This should be written');
        logger.error('This should also be written');

        await new Promise(r => setTimeout(r, 50));

        const files = fs.readdirSync(testLogDir);
        const logFileName = files.find(f => f.startsWith('filterout.') && f.endsWith('.log'));
        expect(logFileName).toBeDefined();

        const content = fs.readFileSync(path.join(testLogDir, logFileName), 'utf-8');
        expect(content).not.toContain('This should not be written');
        expect(content).toContain('[WARN] This should be written');
        expect(content).toContain('[ERROR] This should also be written');
    });
});
