/**
 * AIメモ:
 * - 本番デプロイ用 JHTML 事前コンパイル JS スクリプト (minto の mtpk JHTML 変換相当)。
 * - プロジェクト内の public/ 配下にある *.mt.html / *.jhtml テンプレートを再帰探索し、
 *   対応する *.jhtml.js にコンパイル・保存する。
 * - MAACHANG_HOME または自身の配置位置から jhtml.js をロードして実行。
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const frameworkDir = process.env.MAACHANG_HOME || path.resolve(__dirname, '..');
const { compileToJs } = require(path.join(frameworkDir, 'src', 'jhtml.js'));

const projectDir = process.cwd();
const publicDir = path.join(projectDir, 'public');

if (!fs.existsSync(publicDir)) {
    console.error(`エラー: public ディレクトリが見つかりません (${publicDir})`);
    process.exit(1);
}

console.log('🔨 JHTML テンプレートを事前コンパイル中...');

let count = 0;

/**
 * ディレクトリを再帰的に走査してコンパイル
 * @param {string} dir 
 */
function scanAndCompile(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            scanAndCompile(fullPath);
        } else if (entry.isFile()) {
            if (entry.name.endsWith('.mt.html')) {
                const baseName = entry.name.slice(0, -'.mt.html'.length);
                const outPath = path.join(dir, `${baseName}.jhtml.js`);
                compileSingle(fullPath, outPath);
                count++;
            } else if (entry.name.endsWith('.jhtml')) {
                const baseName = entry.name.slice(0, -'.jhtml'.length);
                const outPath = path.join(dir, `${baseName}.jhtml.js`);
                compileSingle(fullPath, outPath);
                count++;
            }
        }
    }
}

/**
 * 1ファイルをコンパイル
 * @param {string} srcPath 
 * @param {string} dstPath 
 */
function compileSingle(srcPath, dstPath) {
    const template = fs.readFileSync(srcPath, 'utf-8');
    const compiledJs = compileToJs(template);
    fs.writeFileSync(dstPath, compiledJs, 'utf-8');
    const relSrc = path.relative(projectDir, srcPath);
    const relDst = path.relative(projectDir, dstPath);
    console.log(`  ✓ ${relSrc} -> ${relDst}`);
}

scanAndCompile(publicDir);

console.log(`\n🎉 コンパイル完了: 合計 ${count} 個の JHTML テンプレートをコンパイルしました。`);
