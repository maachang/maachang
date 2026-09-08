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

function getVersion() {
    try {
        const pkgPath = path.join(frameworkDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            return pkg.version || '1.0.0';
        }
    } catch (e) {}
    return '1.0.0';
}

function showHelp() {
    console.log(`
mcbuild - 本番デプロイ用 JHTML テンプレート事前コンパイラ

使用方法:
  mcbuild [オプション]

説明:
  プロジェクト内の public/ 配下にある *.mt.html および *.jhtml テンプレートを
  再帰的に探索し、本番最速実行用の *.jhtml.js へ一括コンパイルします。

オプション:
  -v, --version    バージョン情報を表示
  -h, --help       このヘルプメッセージを表示

使用例:
  cd my-app
  mcbuild
  maachang --prod
`);
}

const args = process.argv.slice(2);
for (const arg of args) {
    if (arg === '-v' || arg === '--version') {
        console.log(`mcbuild (maachang) v${getVersion()}`);
        process.exit(0);
    } else if (arg === '-h' || arg === '--help') {
        showHelp();
        process.exit(0);
    }
}

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
