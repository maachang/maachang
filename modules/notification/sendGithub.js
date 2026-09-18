///////////////////////////////////////////////
// GithubRepogitoryに対する送信実装.
//
// GithubToken利用でのGithubRepogitory送信処理.
///////////////////////////////////////////////
(function () {
    'use strict';

    // issue作成対象のURLを取得.
    const _getURL = function (oganization, repository) {
        let path;
        if (oganization == undefined || oganization == null ||
            oganization == "") {
            path = "repos/" + repository + "/issues";
        } else {
            path = "repos/" + oganization +
                "/" + repository + "/issues";
        }
        return {
            host: "api.github.com",
            path: path
        }
    }

    // [(await)httpClient]POSTリクエスト実行.
    const _requetPost = async function (host, path, options) {
        options.method = "POST";
        options.headers["content-length"] = Buffer.byteLength(options.body);
        const response = await fetch(
            "https://" + host + "/" + path, options);
        return {
            status: response["status"],
            headers: response["headers"],
            body: function () {
                return response.json();
            }
        }
    }

    // githubRepogitoryに新しいissueを作成.
    // 形式1: createIssue({ token, owner, repo, title, body, labels })
    // 形式2: createIssue(token, oganization, repository, title, body, labels)
    // token 対象のTokenを設定します.
    // oganization 組織契約しているrepositoryの場合は設定します (owner).
    // repository 対象のrepository名を設定します (repo).
    // title issueタイトルを設定します.
    // body issueボディを設定します.
    // labels ラベル群をArray(string)で設定します.
    //        ここでのラベルはissueに付くラベル名群.
    // 戻り値: {url, title, number}
    //         url: 新しいissueのURL.
    //         title: issueのタイトル.
    //         number: issueの番号.
    const createIssue = async function (
        token, oganization, repository, title, body, labels) {
        // オブジェクト引数形式に対応
        if (typeof token === 'object' && token !== null) {
            const opts = token;
            token = opts.token || opts.accessToken || process.env.GITHUB_TOKEN;
            oganization = opts.organization || opts.owner || opts.org;
            repository = opts.repository || opts.repo;
            title = opts.title;
            body = opts.body;
            labels = opts.labels;
        }

        // URLを生成.
        const url = _getURL(oganization, repository);

        // HTTPヘッダにトークンセット.
        const headers = {
            "Authorization": "token " + token,
            "User-Agent": "maachang/" + Date.now(),
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        };

        // labelsが存在しない場合は空をセット.
        if (labels == undefined || labels == null) {
            labels = [];
        }

        // 送信Payloadを設定.
        const payload = JSON.stringify({
            title: title,
            body: body,
            labels: labels
        });

        // POST送信処理.
        const response = await _requetPost(
            url.host, url.path,
            {
                headers: headers,
                body: payload
            }
        );
        // responseのstatusが400以上の場合.
        if (response.status >= 400) {
            // エラー表示.
            throw new Error("HTTP status " +
                response.status + " error occurred: " +
                JSON.stringify(url, null, "  "));
        }
        // json返却値を取得.
        const result = await response.body();
        return {
            url: result.html_url,
            title: result.title,
            number: result.number
        };
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.createIssue = createIssue;

})();