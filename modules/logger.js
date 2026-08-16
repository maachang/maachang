/**
 * AIメモ:
 * - $loadLib("logger.js") または $loadLib("localLog.js") で呼び出せるロガーモジュール。
 * - src/logger.js をラップ・エクスポートする。
 * - CommonJS 形式。
 */

'use strict';

module.exports = require('../src/logger.js');
