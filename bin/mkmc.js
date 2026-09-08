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
    'schema',
    'validates',
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

// 3. conf/env.json
fs.writeFileSync(path.join(targetDir, 'conf', 'env.json'), JSON.stringify({
    APP_NAME: projectName,
    APP_ENV: 'development'
}, null, 2) + '\n');

// 3. public/index.html
fs.writeFileSync(path.join(targetDir, 'public', 'index.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName} - maachang</title>
    <script src="/jhtml.browser.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; background: #f8fafc; color: #1e293b; }
        .card { background: white; padding: 28px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 680px; margin: 0 auto; }
        h1 { margin-top: 0; color: #0f172a; font-size: 1.6rem; display: flex; align-items: center; gap: 8px; }
        .status-badge { background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; }
        .info-box { background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; font-family: monospace; font-size: 0.9rem; }
        .btn { background: #2563eb; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 0.95rem; font-weight: 500; transition: background 0.2s; }
        .btn:hover { background: #1d4ed8; }
        .btn-outline { background: transparent; color: #2563eb; border: 1px solid #2563eb; margin-left: 8px; }
        .btn-outline:hover { background: #eff6ff; }
        ul { line-height: 2; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 ${projectName} <span class="status-badge">起動中</span></h1>
        <p>オンプレミス向け Bun 超最小フレームワーク <strong>maachang</strong> へようこそ！</p>
        
        <h3>動作確認リンク</h3>
        <ul>
            <li><a href="/api/hello">/api/hello (.mt.js サンプルAPI - JSON応答)</a></li>
            <li><a href="/sample.jhtml">/sample.jhtml (JHTML テンプレートサンプル)</a></li>
        </ul>

        <h3>フロントエンド連携 (jhtml.browser.js)</h3>
        <p>画面遷移なしで API とセッションカウントの更新をテストできます：</p>
        <div>
            <button id="btnFetch" class="btn">API を呼び出す (jhtml.api)</button>
            <a href="/sample.jhtml" class="btn btn-outline">テンプレート画面へ</a>
        </div>

        <div id="resultBox" class="info-box" style="display: none;">
            <!-- jhtml.html で動的描画 -->
        </div>
    </div>

    <script>
        const { $, html, on, api, show, toast } = jhtml;

        on('#btnFetch', 'click', async () => {
            try {
                // jhtml.api による簡単JSON取得
                const data = await api.get('/api/hello', { loading: '#btnFetch' });
                
                // jhtml.html による安全な自動エスケープ描画
                $('#resultBox').innerHTML = html\`
                    <div><strong>Server Message:</strong> \${data.message}</div>
                    <div><strong>Client IP:</strong> \${data.clientIp}</div>
                    <div><strong>Protocol:</strong> \${data.protocol} (isSecure: \${data.isSecure})</div>
                    <div><strong>Session Count:</strong> <span style="color: #2563eb; font-weight: bold;">\${data.sessionCount}</span> 回目のアクセス</div>
                    <div><strong>Server Time:</strong> \${data.serverTime}</div>
                \`;
                show('#resultBox');
                toast.success('API から最新データを取得しました');
            } catch (err) {
                toast.error('API 呼び出しに失敗しました: ' + err.message);
            }
        });
    </script>
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
        clientIps: $request.ips,
        protocol: $request.protocol,
        isSecure: $request.isSecure,
        host: $request.host,
        baseUrl: $request.baseUrl,
        sessionCount: session.data.count
    };
};
`);

// 6. public/sample.mt.html
fs.writeFileSync(path.join(targetDir, 'public', 'sample.mt.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JHTML Sample - ${projectName}</title>
    <script src="/jhtml.browser.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; background: #f8fafc; color: #1e293b; }
        .card { background: white; padding: 28px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 680px; margin: 0 auto; }
        .box { border: 1px solid #e2e8f0; background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .tag { background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 600; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <p><a href="/">&larr; トップ画面へ戻る</a></p>
        <h1>JHTML サーバーサイドレンダリング</h1>
        <p>サーバーサイド（<code>.mt.html</code>）で実行され、HTML として出力されます（本番では <code>mcbuild</code> で事前コンパイル可能）。</p>

        <div class="box">
            <% 
                const now = new Date().toLocaleString('ja-JP');
                const fruits = [
                    { name: 'りんご', price: 150 },
                    { name: 'みかん', price: 100 },
                    { name: 'バナナ', price: 200 }
                ];
            %>
            <p><strong>サーバー実行日時:</strong> \${now}</p>
            <p><strong>クライアント IP:</strong> \${$request.ip} <span class="tag">\${$request.protocol}</span></p>

            <h3>アイテム一覧 (ループ展開):</h3>
            <ul>
                <% for (const item of fruits) { %>
                    <li><%= item.name %> - <strong><%= item.price %> 円</strong></li>
                <% } %>
            </ul>
        </div>
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

// 9. schema/README.md
fs.writeFileSync(path.join(targetDir, 'schema', 'README.md'), `# テーブルスキーマ定義 (${projectName})

このディレクトリにはプロジェクトで利用するデータベースのテーブルスキーマ定義（DDL、SQL、テーブル仕様書）を保存・管理します。

- テーブル作成・変更時は、最新の DDL（例: \`schema.sql\` や \`tables.sql\`）をここに出力・更新してください。
`);

// 10. validates/sample.js
fs.writeFileSync(path.join(targetDir, 'validates', 'sample.js'), `/**
 * バリデーション定義サンプル (validates/sample.js)
 * 
 * 利用方法:
 *   const validate = $loadLib('validate.js');
 *   const sampleSchema = $loadLib('validates/sample.js'); // または $loadLib('sample.js')
 *   const result = validate.check($request.body, sampleSchema);
 *   if (!result.valid) {
 *       return $response.json({ errors: result.errors }, 400);
 *   }
 */
module.exports = {
    name: {
        type: 'string',
        required: true,
        minLen: 1,
        maxLen: 50,
        messages: {
            required: '名前は必須です',
            maxLen: '名前は50文字以内で入力してください'
        }
    },
    email: {
        type: 'string',
        required: false,
        mail: true,
        messages: {
            mail: '有効なメールアドレス形式で入力してください'
        }
    },
    age: {
        type: 'int',
        required: false,
        range: [0, 150],
        messages: {
            type: '年齢は数値で入力してください',
            range: '年齢は0歳から150歳の間で入力してください'
        }
    }
};
`);

// 11. .claude/CLAUDE.md
const frameworkDir = process.env.MAACHANG_HOME || path.resolve(__dirname, '..');
const templateClaudeMd = path.join(frameworkDir, 'src', 'project', 'claude.md');
if (fs.existsSync(templateClaudeMd)) {
    const rawTemplate = fs.readFileSync(templateClaudeMd, 'utf-8');
    const projectClaudeMd = rawTemplate.replaceAll('${PROJECT_NAME}', projectName);
    fs.writeFileSync(path.join(targetDir, '.claude', 'CLAUDE.md'), projectClaudeMd);
}

// 12. public/jhtml.browser.js (フロントエンド用ランタイムを自動同梱)
const frameworkBrowserJs = path.join(frameworkDir, 'public', 'jhtml.browser.js');
if (fs.existsSync(frameworkBrowserJs)) {
    fs.copyFileSync(frameworkBrowserJs, path.join(targetDir, 'public', 'jhtml.browser.js'));
}

console.log(`✅ プロジェクト '${projectName}' の作成が完了しました！\n`);
console.log(`起動方法:`);
console.log(`  cd ${projectName}`);
console.log(`  maachang (または bun run start)\n`);
