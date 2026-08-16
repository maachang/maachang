/**
 * AIメモ:
 * - 新規 maachang プロジェクトを作成する JS スクリプト (minto の makeMt 相当)。
 * - 使い方: mkmc <project-name>
 * - プロジェクト用の標準ディレクトリ構成 (public, conf, lib, data) およびサンプルファイルを展開する。
 * - package.json には start / build コマンドを定義し、プロジェクト単独で bun start 可能にする。
 * - CommonJS 形式。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectName = process.argv[2];

if (!projectName) {
    console.error('使用方法: mkmc <プロジェクト名>');
    process.exit(1);
}

const targetDir = path.resolve(process.cwd(), projectName);

if (fs.existsSync(targetDir)) {
    console.error(`エラー: ディレクトリ '${projectName}' は既に存在します。`);
    process.exit(1);
}

console.log(`✨ 新しい maachang プロジェクト '${projectName}' を作成中...`);

// ディレクトリ作成
const dirs = [
    '',
    'conf',
    'public',
    'public/api',
    'lib',
    'data',
    '.claude'
];

for (const d of dirs) {
    fs.mkdirSync(path.join(targetDir, d), { recursive: true });
}

// 1. conf/server.json
fs.writeFileSync(path.join(targetDir, 'conf', 'server.json'), JSON.stringify({
    port: 3000,
    hostname: '0.0.0.0'
}, null, 2) + '\n');

// 2. conf/session.json
fs.writeFileSync(path.join(targetDir, 'conf', 'session.json'), JSON.stringify({
    dbPath: './data/session.db',
    cookieName: `${projectName}_sid`,
    timeoutMin: 60,
    sameSite: 'Lax',
    httpOnly: true,
    secure: false
}, null, 2) + '\n');

// 3. public/index.html
fs.writeFileSync(path.join(targetDir, 'public', 'index.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName} - maachang</title>
    <style>
        body { font-family: sans-serif; margin: 40px; background: #fafafa; color: #333; }
        .card { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
        h1 { margin-top: 0; color: #111; }
        ul { line-height: 1.8; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 ${projectName} サーバーが起動しました</h1>
        <p>オンプレミス向け Bun 超最小フレームワーク <strong>maachang</strong> へようこそ！</p>
        <h3>動作確認リンク</h3>
        <ul>
            <li><a href="/api/hello">/api/hello (.mt.js サンプルAPI)</a></li>
            <li><a href="/sample.jhtml">/sample.jhtml (JHTML テンプレートサンプル)</a></li>
        </ul>
    </div>
</body>
</html>
`);

// 4. public/filter.mt.js
fs.writeFileSync(path.join(targetDir, 'public', 'filter.mt.js'), `/**
 * リクエスト共通フィルター (filter.mt.js)
 * true を返すと後続の処理に進みます。
 */
exports.handler = async function() {
    // アクセスログ出力などの共通処理
    // console.log(\`[\${new Date().toISOString()}] \${$request.method} \${$request.path}\`);
    
    return true;
};
`);

// 5. public/api/hello.mt.js
fs.writeFileSync(path.join(targetDir, 'public', 'api', 'hello.mt.js'), `/**
 * API エンドポイントサンプル (.mt.js)
 */
exports.handler = async function() {
    const sessionMod = $loadLib('session.js');
    let session = sessionMod.getSession($request);

    if (!session) {
        session = sessionMod.createSession($response, {
            visitedAt: new Date().toISOString(),
            count: 1
        });
    } else {
        session.data.count = (session.data.count || 0) + 1;
        sessionMod.setSession(session.sid, session.data);
    }

    return {
        message: "Hello from maachang!",
        serverTime: new Date().toISOString(),
        clientIp: $request.ip,
        sessionCount: session.data.count
    };
};
`);

// 6. public/sample.mt.html
fs.writeFileSync(path.join(targetDir, 'public', 'sample.mt.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>JHTML Sample</title>
    <style>
        body { font-family: sans-serif; margin: 40px; }
        .box { border: 1px solid #ddd; padding: 16px; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>JHTML テンプレートサンプル</h1>
    <div class="box">
        <% 
            const now = new Date().toLocaleString('ja-JP');
            const items = ['りんご', 'みかん', 'バナナ'];
        %>
        <p>現在日時: \${now}</p>
        <h3>アイテム一覧:</h3>
        <ul>
            <% for (const item of items) { %>
                <li><%= item %></li>
            <% } %>
        </ul>
    </div>
</body>
</html>
`);

// 7. package.json
fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '1.0.0',
    private: true,
    scripts: {
        start: 'maachang',
        build: 'mcbuild'
    }
}, null, 2) + '\n');

// 8. .gitignore
fs.writeFileSync(path.join(targetDir, '.gitignore'), `node_modules/
data/
log/
*.local.json
.DS_Store
.claudeWork/
`);

// 9. .claude/CLAUDE.md
const frameworkDir = process.env.MAACHANG_HOME || path.resolve(__dirname, '..');
const templateClaudeMd = path.join(frameworkDir, 'src', 'project', 'claude.md');
if (fs.existsSync(templateClaudeMd)) {
    const rawTemplate = fs.readFileSync(templateClaudeMd, 'utf-8');
    const projectClaudeMd = rawTemplate.replaceAll('${PROJECT_NAME}', projectName);
    fs.writeFileSync(path.join(targetDir, '.claude', 'CLAUDE.md'), projectClaudeMd);
}

console.log(`✅ プロジェクト '${projectName}' の作成が完了しました！\n`);
console.log(`起動方法:`);
console.log(`  cd ${projectName}`);
console.log(`  maachang (または bun run start)\n`);
