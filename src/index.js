/**
 * AIメモ:
 * - maachang サーバーのメインエントリポイント (Bun.serve)。
 * - カレントディレクトリ (または -d / --dir 引数) をプロジェクトルート (baseDir) として起動。
 * - conf/server.json (または server.local.json) から port, hostname 等を自動ロード。
 * - CLI 引数 (例: -p 8080, --host 0.0.0.0) による上書きに対応。
 * - CommonJS 形式。
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { handleRequest } = require('./router.js');
const { loadEnv, parseJson } = require('./context.js');
const { handleServerError } = require('./errorHandler.js');
const logger = require('./logger.js');
const dbWrapper = require('./db.js');

/**
 * ログ設定を初期化
 * @param {string} baseDir 
 */
function initLogger(baseDir) {
    const localLogConf = path.join(baseDir, 'conf', 'log.local.json');
    const projectLogConf = path.join(baseDir, 'conf', 'log.json');

    let logOptions = null;
    if (fs.existsSync(localLogConf)) {
        try {
            logOptions = parseJson(fs.readFileSync(localLogConf, 'utf-8'));
        } catch (e) {}
    } else if (fs.existsSync(projectLogConf)) {
        try {
            logOptions = parseJson(fs.readFileSync(projectLogConf, 'utf-8'));
        } catch (e) {}
    }

    if (logOptions) {
        if (logOptions.dir && !path.isAbsolute(logOptions.dir)) {
            logOptions.dir = path.resolve(baseDir, logOptions.dir);
        }
        logger.setting(logOptions);
    } else {
        logger.setting({
            dir: path.resolve(baseDir, 'log'),
            file: 'logout',
            level: 'info',
            stdout: true
        });
    }
}

/**
 * コマンドライン引数をパース
 * @param {string[]} args 
 * @returns {Object}
 */
function parseArgs(args) {
    const options = {
        port: null,
        hostname: null,
        baseDir: process.cwd(),
        isDev: true
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-p' || arg === '--port') {
            options.port = parseInt(args[++i], 10);
        } else if (arg === '-h' || arg === '--host' || arg === '--hostname') {
            options.hostname = args[++i];
        } else if (arg === '-d' || arg === '--dir') {
            options.baseDir = path.resolve(args[++i]);
        } else if (arg === '--prod' || arg === '--production') {
            options.isDev = false;
        }
    }
    return options;
}

/**
 * サーバー設定を取得
 * @param {string} baseDir 
 * @param {string} frameworkDir 
 * @param {Object} cliOptions 
 * @returns {{ port: number, hostname: string }}
 */
function resolveServerConfig(baseDir, frameworkDir, cliOptions) {
    let conf = {};

    const localConf = path.join(baseDir, 'conf', 'server.local.json');
    const projectConf = path.join(baseDir, 'conf', 'server.json');
    const frameworkConf = path.join(frameworkDir, 'conf', 'server.json');

    if (fs.existsSync(localConf)) {
        try {
            conf = parseJson(fs.readFileSync(localConf, 'utf-8')) || {};
        } catch (e) {}
    } else if (fs.existsSync(projectConf)) {
        try {
            conf = parseJson(fs.readFileSync(projectConf, 'utf-8')) || {};
        } catch (e) {}
    } else if (fs.existsSync(frameworkConf)) {
        try {
            conf = parseJson(fs.readFileSync(frameworkConf, 'utf-8')) || {};
        } catch (e) {}
    }

    const port = cliOptions.port || conf.port || parseInt(process.env.PORT, 10) || 3000;
    const hostname = cliOptions.hostname || conf.hostname || process.env.HOST || '0.0.0.0';

    return { port, hostname };
}

/**
 * サーバーを起動
 * @param {Object} [customOptions] 
 * @returns {import('bun').Server}
 */
function startServer(customOptions = {}) {
    const cliOptions = parseArgs(process.argv.slice(2));
    const baseDir = customOptions.baseDir || cliOptions.baseDir || process.cwd();
    const frameworkDir = process.env.MAACHANG_HOME || path.resolve(__dirname, '..');
    const isDev = customOptions.isDev !== undefined ? customOptions.isDev : cliOptions.isDev;

    // 環境変数の読み込み (conf/env.json, conf/env.local.json -> process.env)
    loadEnv(baseDir);

    // ログ初期化
    initLogger(baseDir);

    const { port, hostname } = resolveServerConfig(baseDir, frameworkDir, {
        port: customOptions.port || cliOptions.port,
        hostname: customOptions.hostname || cliOptions.hostname
    });

    console.log('====================================================');
    console.log(' 🚀 maachang server (Bun.serve on-premise framework)');
    console.log('====================================================');
    console.log(` - Project Dir   : ${baseDir}`);
    console.log(` - Framework Dir : ${frameworkDir}`);
    console.log(` - Mode          : ${isDev ? 'Development (on-demand JHTML)' : 'Production'}`);
    console.log(` - Listening on  : http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
    console.log('====================================================\n');

    const server = Bun.serve({
        port,
        hostname,
        idleTimeout: 255,
        async fetch(req) {
            try {
                return await handleRequest(req, {
                    baseDir,
                    frameworkDir,
                    isDev
                });
            } catch (err) {
                return handleServerError(err, req, {
                    isDev,
                    title: 'Unhandled Server Error'
                });
            }
        },
        error(err) {
            logger.error(`[Bun Server Error]\n${err && err.stack ? err.stack : err}`);
            return new Response(JSON.stringify({ error: 'Server Error', message: isDev ? err.message : 'Internal Server Error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }
    });

    // Graceful Shutdown ハンドラーの登録 (テスト等で自動終了を無効化したい場合は handleSignals: false を指定可能)
    if (customOptions.handleSignals !== false) {
        registerShutdownHandlers(server);
    }

    return server;
}

let _isShuttingDown = false;

/**
 * サーバーおよびリソースを安全に停止 (Graceful Shutdown)
 * @param {import('bun').Server} server 
 * @param {Object} [options]
 * @param {boolean} [options.closeDb=true]
 * @returns {Promise<void>}
 */
async function stopServer(server, options = {}) {
    if (_isShuttingDown) return;
    _isShuttingDown = true;

    logger.info('🛑 Graceful shutdown initiated. Stopping server...');

    try {
        if (server && typeof server.stop === 'function') {
            server.stop(true); // true = 処理中リクエストを完了させてから停止
        }
    } catch (e) {
        logger.error(`Error stopping Bun server: ${e.message}`);
    }

    if (options.closeDb !== false) {
        try {
            dbWrapper.closeAll();
        } catch (e) {
            logger.error(`Error closing database connections: ${e.message}`);
        }
    }

    logger.info('✅ maachang server stopped cleanly.');
}

/**
 * プロセスシグナル (SIGINT, SIGTERM) を監視し Graceful Shutdown を実行
 * @param {import('bun').Server} server 
 */
function registerShutdownHandlers(server) {
    const onSignal = async (signal) => {
        logger.info(`Received ${signal}. Starting shutdown process...`);
        await stopServer(server);
        process.exit(0);
    };

    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));
}

// 直接実行された場合はサーバー起動
if (import.meta.main || require.main === module) {
    startServer();
}

module.exports = {
    startServer,
    stopServer,
    registerShutdownHandlers,
    parseArgs,
    resolveServerConfig
};
