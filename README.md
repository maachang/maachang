# maachang (オンプレミス向け Bun 超最小 Web アプリケーションフレームワーク)

**maachang** は、オンプレミス（物理サーバー / Nginx 等のリバースプロキシ配下）で `Bun.serve` を用いて動作する、超軽量・最小構成の Web アプリケーションフレームワークです。

[minto](https://github.com/maachang/minto) の設計思想（`.mt.js` による動的処理、`jhtml` テンプレート、`filter.mt.js` によるリクエスト共通前処理、`$loadLib("session.js")` 等の組み込み機構）を踏襲し、**mkmc による新規プロジェクト作成からプロジェクト単位でのローカル起動・本番デプロイビルドまで** を完結できます。

---

## 🧭 設計思想: 「ファイル配置 ＝ URL」の直感的な PHP 的アプローチ

現代の Web 開発は、SPA（React/Vue 等）とバックエンド API の分離、複雑な状態管理、ビルド設定、肥大化する `node_modules` の依存関係など、**「動かす前の準備とメンテナンス」に膨大なコスト** がかかっています。

maachang はあえてこれらと距離を置き、**「PHP のようにディレクトリ構造がそのまま URL に対応し、最小限の JHTML テンプレートで画面が動く」** という、扱いやすく無駄のないクラシカルな SSR モデルを現代の Bun ランタイム上に再構築しました。

### 🌟 4 つのコアバリュー

1. **「ファイル配置 ＝ URL」による認知負荷ゼロ**:
   - `public/admin/users.mt.html` にファイルを置くだけで `/admin/users` にアクセス可能。ルーティング設定ファイルを探す必要はありません。
2. **AI Native（Claude Code / Antigravity 親和性）**:
   - 1〜2 ファイルでサーバーサイド処理と HTML 描画が完結するため、AI エージェントのコンテキスト消費が極小で、プロンプト一発で破綻のないコード生成が可能です。
3. **ゼロ外部依存 ＆ 爆速起動**:
   - 外部 npm パッケージ依存なし（Zero Dependency）。`node_modules` の脆弱性管理疲れから解放され、Bun の C++ 高速サーバーによりミリ秒単位で起動します。
4. **小規模・社内 Web アプリの最適解**:
   - 業務管理画面、社内ツール、API エンドポイントなど、大規模 SPA が不要な用途において、開発工数・サーバーリソース・運用コストを極限まで圧縮します。

---

## 💡 特徴

1. **Bun.serve による超高速・ゼロ依存**:
   - Node.js 不要、外部 npm パッケージ依存なしで高速動作。
2. **minto 規約の踏襲**:
   - **`.mt.js`**: サーバーサイド JavaScript を直接ルーティング・実行。
   - **JHTML (`.mt.html` / `.jhtml`)**: `<% %>`, `<%= %>`, `${ }` を備えたシンプルなテンプレートエンジン。
   - **共通フィルター (`filter.mt.js`)**: 認証やロギングなどの前処理を一元管理。
   - **安全なアクセス制御**: 内部ファイル（`.mt.js`, `.jhtml.js`, `.mt.html`, `/filter` 等）への直接アクセスは自動で 403 Forbidden 応答。
3. **SQLite3 標準セッション管理**:
   - `bun:sqlite` を利用した軽量 SQLite3 セッション管理モジュール（`modules/session.js`）を標準搭載。
4. **日別ローテーションロガー**:
   - 日別ファイル出力（`./log/logout.YYYY-MM-DD.log`）と標準出力を兼ね備えたロガー（`modules/logger.js`）を内蔵。
5. **プロジェクト単位の実行 ＆ 本番事前コンパイル**:
   - `mkmc` コマンドで独立したプロジェクト雛形をどこにでも即座に生成。
   - ローカル開発時は `.mt.html` / `.jhtml` をオンデマンド変換して即時確認。
   - 本番環境では `mcbuild` コマンドで事前コンパイル（`.jhtml.js`）して最速実行。

---

## 📁 ディレクトリ構成

```
maachang/ (フレームワーク本体)
├── bin/
│   ├── initMaachang             # 初期セットアップスクリプト (.bashrc / .zshrc に PATH 追加)
│   ├── maachang                 # プロジェクトディレクトリでサーバーを起動する CLI
│   ├── mkmc                     # 新規プロジェクト作成 CLI
│   └── mcbuild                  # 本番デプロイ用 JHTML 事前コンパイル CLI
├── conf/
│   └── mime.json                # 標準 MIME タイプ定義
├── modules/                     # 共通モジュール群 (詳細は modules/README.md 参照)
│   ├── session.js               # SQLite3 セッション管理
│   ├── logger.js / localLog.js  # 日別ローテーションロガー
│   ├── dateEx.js                # 拡張日時操作・フォーマット
│   ├── format.js                # 日本語・データ整形 (金額, カナ, バイト等)
│   ├── encrypt.js               # AES-256-GCM 可逆暗号化・復号
│   ├── http.js                  # タイムアウト・リトライ付き HTTP クライアント
│   ├── fileUtil.js / file.js    # ファイル・JSON入出力支援
│   ├── auth/                    # password, jwt, csrf, rbac, corsFilter
│   ├── csv/                     # csvReader, csvWriter
│   ├── validate/                # validate (スキーマバリデーション)
│   ├── notification/            # sendSlack, sendGithub
│   └── http/                    # multipart (ファイルアップロード解析)
├── src/
│   ├── index.js                 # Bun.serve メインエントリ
│   ├── router.js                # ルーティング・静的配信・JS/JHTML 実行
│   ├── jhtml.js                 # JHTML テンプレートコンパイラ
│   ├── context.js               # $request, $response, $loadConf, $loadLib, $db
│   ├── db.js                    # bun:sqlite ラッパー
│   ├── logger.js                # ロガーコア
│   └── project/
│       └── claude.md            # 新規プロジェクト用 CLAUDE.md テンプレート
├── public/                      # フレームワーク本体側は空（.gitkeep）
├── test/                        # 単体・統合テスト群
├── package.json
└── README.md
```

---

## 🚀 クイックスタート

### 1. 初期セットアップ (initMaachang)

リポジトリ直下で `./bin/initMaachang` を実行すると、`MAACHANG_HOME` と `PATH` がシェルの設定ファイル（`.bashrc` / `.zshrc`）へ自動追加されます。

```bash
cd maachang
./bin/initMaachang

# 設定を反映 (またはターミナルを再起動)
source ~/.bashrc  # (zsh の場合は source ~/.zshrc)
```

### 2. 新規プロジェクトの作成 (`mkmc`)

```bash
# 任意の場所で新しい Web アプリプロジェクトを作成
mkmc my-app

cd my-app
```

生成されるプロジェクト構成:
```
my-app/
├── conf/
│   ├── server.json      # ポート・ホスト設定
│   ├── session.json     # セッション設定 (SQLite)
│   └── env.json         # 環境変数定義 (process.env へ自動展開)
├── public/
│   ├── index.html       # トップページ
│   ├── filter.mt.js     # 共通リクエストフィルター
│   ├── sample.mt.html   # JHTML テンプレートサンプル
│   └── api/
│       └── hello.mt.js  # API サンプル
├── schema/              # テーブルスキーマ定義 (DDL, SQL, 設計書)
│   └── README.md
├── validates/           # バリデーション定義 (入力検証スキーマ)
│   └── sample.js
├── lib/                 # プロジェクト固有の共通ライブラリ置き場
├── data/                # SQLite DB などの保存先 (Git管理外)
├── .claude/
│   └── CLAUDE.md        # AI 開発用指示書 (プロジェクト名展開済み)
└── package.json
```

### 3. プロジェクトのサーバー起動 (`maachang`)

```bash
# プロジェクトディレクトリ内で実行
maachang

# オプション指定例 (ポート 8080 で起動)
maachang -p 8080

# または bun start で起動
bun start
```

ブラウザで `http://localhost:3000` にアクセスします。

---

## 🛠️ 開発作法

### 1. API の作成 (`.mt.js`)
`public/` 配下に `{パス名}.mt.js` を作成し、`exports.handler` を定義します。

```javascript
// public/api/users.mt.js
exports.handler = async function() {
    const sessionMod = $loadLib('session.js');
    const session = sessionMod.getSession($request);

    // オブジェクトを返すと自動的に application/json で応答
    return {
        success: true,
        users: ['Alice', 'Bob'],
        sessionUser: session ? session.data.user : null
    };
};
```

### 2. JHTML テンプレートの作成 (`.mt.html` / `.jhtml`)
`public/` 配下に `{パス名}.mt.html` または `{パス名}.jhtml` を作成します。

```html
<!-- public/profile.mt.html -->
<!DOCTYPE html>
<html>
<body>
    <% const name = $request.getQuery('name', 'ゲスト'); %>
    <h1>ようこそ、${name} さん！</h1>

    <% const items = ['通知1', '通知2']; %>
    <ul>
        <% for (const item of items) { %>
            <li><%= item %></li>
        <% } %>
    </ul>
</body>
</html>
```

#### 🧩 パーツ共通化 (`$include`) ＆ レイアウト継承 (`$layout`)

maachang の JHTML は、ヘッダー・フッターの部品化やページ共通レイアウトをサポートしています。
（※ `_` で始まるファイルやディレクトリは外部から直接アクセス不可（403）となり安全に保護されます）

```html
<!-- 1. 共通パーツ: public/components/_header.mt.html -->
<header class="navbar">
    <h2>${$data.title}</h2>
    <span>ログイン中: ${$data.user || 'ゲスト'}</span>
</header>
```

```html
<!-- 2. 親レイアウト: public/layouts/_base.mt.html -->
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>${$data.title} - 社内ポータル</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <%- await $include('/components/_header.mt.html', { title: $data.title, user: $data.user }) %>
    <main class="container">
        <%- $body %> <!-- 子テンプレートの内容がここに挿入されます -->
    </main>
</body>
</html>
```

```html
<!-- 3. 個別ページ: public/dashboard.mt.html -->
<% $layout('/layouts/_base.mt.html', { title: 'ダッシュボード', user: '山田太郎' }) %>

<div class="card">
    <h3>売上サマリー</h3>
    <p>今月の売上: 1,200,000 円</p>
</div>
```


### 3. セッション管理 (`modules/session.js`)

```javascript
const sessionMod = $loadLib('session.js');

// セッションの作成 (Cookie も自動セット)
const session = sessionMod.createSession($response, { userId: '12345' });

// セッションの取得
const current = sessionMod.getSession($request);

// セッションの更新
sessionMod.setSession(current.sid, { userId: '12345', role: 'admin' });

// セッションの破棄
sessionMod.deleteSession($request, $response);
```

### 4. 日付ユーティリティ (`modules/dateEx.js`)

```javascript
const DateEx = $loadLib('dateEx.js');

// 日付インスタンスの生成とフォーマット
const now = DateEx();
console.log(now.toFormatString('{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}')); // 2026/08/16(日) 14:50:00

// 日時加減算 (チェーン可能)
const nextMonth = DateEx().change('month', 1).change('date', -3);

// 期間内外の判定 (今月内かどうか)
const monthRange = DateEx.between(now, 'month');
const inRange = monthRange.isBetween('2026-08-20'); // true
```

### 5. CSV 操作 (`modules/csv/`)

```javascript
const { createCsv } = $loadLib('csvWriter.js');
const { readCsv } = $loadLib('csvReader.js');

// CSV 文字列の生成
const csvString = createCsv(['id', 'name'], [{ id: 1, name: '山田' }, { id: 2, name: '田中' }]);

// CSV 文字列のパース
const { headers, rows } = readCsv(csvString);
```

### 6. 入力バリデーション (`modules/validate/validate.js` & `validates/`)
プロジェクトの `validates/` 配下に定義したスキーマを `$loadLib` で読み込んで検証できます。

```javascript
// validates/user.js で定義
// module.exports = {
//     name:  { type: 'string', required: true, minLen: 1, maxLen: 50 },
//     email: { type: 'string', mail: true },
//     age:   { type: 'int', range: [0, 150] }
// };

const validate = $loadLib('validate.js');
const userSchema = $loadLib('validates/user.js'); // または $loadLib('user.js')

const result = validate.check($request.body, userSchema);
if (!result.valid) {
    return $response.json({ errors: result.errors }, 400);
}
// result.data は default 値が補完された安全なデータ
```
※ `range`, `mail`, `url`, `zip`, `tel`, `date`, `time`, `alphaNum` などの事前定義ルールを標準サポートしています。

### 7. 環境変数の管理 (`conf/env.json` & `process.env`)
`conf/env.json`（およびローカル上書き用の `conf/env.local.json`）に記述したキー・バリューは、サーバー起動時およびリクエスト実行時に自動的に `process.env` に直接展開されます。

```javascript
// conf/env.json: { "API_URL": "https://api.example.com" }
const apiUrl = process.env.API_URL;
```

### 8. パスワードハッシュ ＆ JWT (`modules/auth/`)

```javascript
const password = $loadLib('password.js');
const jwt = $loadLib('jwt.js');

// パスワードの安全なハッシュ化と照合 (PBKDF2-HMAC-SHA256)
const hashed = password.hash('myPassword');
const isMatch = password.verify('myPassword', hashed); // true

// JWT の署名と検証 (HS256)
const token = jwt.sign({ userId: '123' }, 'secretKey', { expiresIn: 3600 });
const payload = jwt.verify(token, 'secretKey');
```

### 9. 日本語整形・暗号化・HTTPクライアント (`modules/`)

```javascript
// 1. フォーマット整形
const format = $loadLib('format.js');
format.money(1250000); // "1,250,000"
format.parseMoney('¥1,250,000'); // 1250000 (逆変換)
format.toHalfWidth('ＡＢＣ　１２３'); // "ABC 123"
format.bytes(1048576); // "1.0 MB"
format.mask('09012345678', 3, 4); // "090****5678"

// 2. AES-256-GCM 可逆暗号化
const encrypt = $loadLib('encrypt.js');
const cipher = encrypt.encrypt('SecretData', 'myKey');
const plain = encrypt.decrypt(cipher, 'myKey'); // "SecretData"

// 3. タイムアウト・リトライ付き HTTP クライアント
const http = $loadLib('http.js');
const data = await http.getJson('https://api.example.com/items', { timeout: 3000, retry: 2 });

// 4. ファイル・JSON 入出力支援
const fileUtil = $loadLib('fileUtil.js');
fileUtil.writeJson('./data/backup.json', { key: 'value' }); // ディレクトリ自動作成
const config = fileUtil.readJson('./conf/app.json', { defaultVal: 1 });
const safeName = fileUtil.safeFileName('avatar.PNG', ['png', 'jpg'], 'user_');
```

### 10. 組み込みオブジェクト
- `$request` / `$request()`: `method`, `path`, `query`, `body`, `headers`, `cookies`, `ip`, `getHeader()`, `getQuery()`, `getCookie()`
- `$response` / `$response()`: `status(code)`, `contentType(type, charset)`, `header(k, v)`, `setCookie(k, v, opts)`, `json(data)`, `html(str)`, `text(str)`, `redirect(url)`
- `$loadConf(name)`: `conf/{name}.local.json` または `conf/{name}.json` をロード
- `$loadLib(name)`: `lib/` → `validates/` → `${MAACHANG_HOME}/modules/` からモジュールをロード
- `$db`: SQLite3 操作（`get`, `all`, `run`, `exec`, `transaction`）

---

## 📦 本番デプロイ対応 (`mcbuild`)

本番環境へデプロイする際、JHTML テンプレートを事前に `.jhtml.js` へ一括コンパイルすることで最速の起動・レスポンスを実現します。

```bash
cd my-app
mcbuild
```

---

## 🧪 テスト実行

```bash
bun test
```
