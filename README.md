# maachang (オンプレミス向け Bun 超最小 Web アプリケーションフレームワーク)

**maachang** は、オンプレミス（物理サーバー / Nginx 等のリバースプロキシ配下）で `Bun.serve` を用いて動作する、超軽量・最小構成の Web アプリケーションフレームワークです。

[minto](https://github.com/maachang/minto) の設計思想（`.mt.js` による動的処理、`jhtml` テンプレート、`filter.mt.js` によるリクエスト共通前処理、`$loadLib("session.js")` 等の組み込み機構）を踏襲し、**mkmc による新規プロジェクト作成からプロジェクト単位でのローカル起動・本番デプロイビルドまで** を完結できます。

---

## 💡 特徴

1. **Bun.serve による超高速・ゼロ依存**:
   - Node.js 不要、外部 npm パッケージ依存なし（ゼロ依存）で高速動作。
2. **minto 規約の踏襲**:
   - **`.mt.js`**: サーバーサイド JavaScript を直接ルーティング・実行。
   - **JHTML (`.mt.html` / `.jhtml`)**: `<% %>`, `<%= %>`, `${ }` を備えたシンプルなテンプレートエンジン。
   - **共通フィルター (`filter.mt.js`)**: 認証やロギングなどの前処理を一元管理。
   - **安全なアクセス制御**: 内部ファイル（`.mt.js`, `.jhtml.js`, `.mt.html`, `/filter` 等）への直接アクセスは自動で 403 Forbidden 応答。
3. **SQLite3 標準セッション管理**:
   - `bun:sqlite` を利用した軽量 SQLite3 セッション管理モジュール（`modules/session.js`）を標準搭載。
4. **プロジェクト単位の実行 ＆ 本番事前コンパイル**:
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
├── modules/
│   └── session.js               # SQLite3 セッション管理モジュール
├── src/
│   ├── index.js                 # Bun.serve メインエントリ
│   ├── router.js                # ルーティング・静的配信・JS/JHTML 実行
│   ├── jhtml.js                 # JHTML テンプレートコンパイラ
│   ├── context.js               # $request, $response, $loadConf, $loadLib, $db
│   └── db.js                    # bun:sqlite ラッパー
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
│   └── session.json     # セッション設定 (SQLite)
├── public/
│   ├── index.html       # トップページ
│   ├── filter.mt.js     # 共通リクエストフィルター
│   ├── sample.mt.html   # JHTML テンプレートサンプル
│   └── api/
│       └── hello.mt.js  # API サンプル
├── lib/                 # プロジェクト固有の共通ライブラリ置き場
├── data/                # SQLite DB などの保存先
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

### 4. 組み込みオブジェクト
- `$request`: `method`, `path`, `query`, `body`, `headers`, `cookies`, `ip`, `getHeader()`, `getQuery()`, `getCookie()`
- `$response`: `status(code)`, `header(k, v)`, `setCookie(k, v, opts)`, `json(data)`, `html(str)`, `text(str)`, `redirect(url)`
- `$loadConf(name)`: `conf/{name}.local.json` または `conf/{name}.json` をロード
- `$loadLib(name)`: `lib/{name}` または `modules/{name}` からモジュールをロード
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
