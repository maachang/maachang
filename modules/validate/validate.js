///////////////////////////////////////////////
// 汎用オブジェクトバリデーター.
//
// $request().params() で取得したリクエストパラメータに限らず、
// 任意のJSオブジェクトを対象に、フィールド単位のスキーマ定義に
// 沿って検証する. 型システムは modules/s3table/s3MasterTable.js /
// s3IndexTable.js と共通の string/int/float/boolean/date の
// 5種類のみをサポートする(json/array/ネストオブジェクトは対象外).
//
// GETリクエストの$request().params()(=queryStringParameters)は値が
// 全て文字列で渡ってくるため、int/floatは数値型に加えて「数字として
// 妥当な文字列」(例: "20", "-1.5")も型チェックOKとする(値そのものは
// 文字列のまま保持し、数値へは変換しない。min/maxの範囲比較のみ内部で
// 数値化して行う)。boolean/dateは文字列を許容しない(true/falseや日付
// 文字列の解釈は曖昧さがあるため、呼び出し側で事前にBoolean/Dateへ
// 変換すること)。
//
// スキーマ定義例:
//   validate.check(data, {
//     name:     { type: "string", required: true, minLen: 1, maxLen: 50, messages: { required: "名前は必須です" } },
//     age:      { type: "int", min: 0, max: 150, range: [0, 150] },
//     email:    { type: "string", mail: true },
//     siteUrl:  { type: "string", url: true },
//     zipCode:  { type: "string", zip: true },
//     phone:    { type: "string", tel: true },
//     birthday: { type: "string", date: true },
//     wakeTime: { type: "string", time: true },
//     userId:   { type: "string", alphaNum: true }
//   });
//
// 戻り値: { valid, errors: [{field, rule, message}], data }
//   - dataはdefault値を補完したオブジェクト(元のdataは変更しない).
//   - スキーマに定義の無いプロパティはチェック対象外で、そのまま
//     dataに素通りする(strictチェックは行わない).
//   - 1フィールドにつき最初に失敗したルールのみをerrorsに積む
//     (同一フィールドで複数エラーは重ねない).
///////////////////////////////////////////////
(function () {
    'use strict';

    // デフォルトエラーメッセージ生成.
    // rule 対象のルール名を設定します.
    // field 対象のフィールド名を設定します.
    // params ルールに応じた付加情報(min/max/minLen/maxLen等)を設定します.
    const _defaultMessage = function (rule, field, params) {
        switch (rule) {
            case "required":
                return field + "は必須です";
            case "type":
                return field + "の型が不正です";
            case "minLen":
                return field + "は" + params.minLen + "文字以上で入力してください";
            case "maxLen":
                return field + "は" + params.maxLen + "文字以内で入力してください";
            case "min":
                return field + "は" + params.min + "以上で入力してください";
            case "max":
                return field + "は" + params.max + "以下で入力してください";
            case "range":
                return field + "は" + params.min + "から" + params.max + "の範囲で入力してください";
            case "mail":
                return field + "は有効なメールアドレス形式で入力してください";
            case "url":
                return field + "は有効なURL形式(http/https)で入力してください";
            case "zip":
                return field + "は有効な郵便番号形式で入力してください";
            case "tel":
                return field + "は有効な電話番号形式で入力してください";
            case "date":
                return field + "は有効な日付形式(YYYY-MM-DD等)で入力してください";
            case "time":
                return field + "は有効な時刻形式(HH:mm:ss等)で入力してください";
            case "alphaNum":
                return field + "は半角英数字のみで入力してください";
            case "pattern":
                return field + "の形式が不正です";
            case "enum":
                return field + "は許可された値ではありません";
            case "custom":
                return field + "の値が不正です";
            default:
                return field + "が不正です";
        }
    };

    // 各種フォーマット検証用 正規表現
    const _REGEX_MAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const _REGEX_URL = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
    const _REGEX_ZIP = /^\d{3}-?\d{4}$/;
    const _REGEX_TEL = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;
    const _REGEX_DATE = /^(\d{4})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])$/;
    const _REGEX_TIME = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
    const _REGEX_ALPHANUM = /^[a-zA-Z0-9]+$/;

    // 文字列が日付として妥当かチェック (yyyy-MM-dd / yyyy/MM/dd)
    const _isValidDateString = function (s) {
        if (typeof s !== 'string') return false;
        const m = s.match(_REGEX_DATE);
        if (!m) return false;
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const d = parseInt(m[3], 10);
        const dt = new Date(y, mo, d);
        return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d;
    };

    // 文字列が整数表記(符号+数字のみ)かチェック.
    const _isIntString = function (s) {
        return /^-?[0-9]+$/.test(s);
    };

    // 文字列が数値表記(整数/小数)かチェック.
    const _isFloatString = function (s) {
        return s.trim() !== "" && isFinite(Number(s));
    };

    // 値の型チェック.
    // $request().params()のGETパラメータ(queryStringParameters)はJSの
    // 型を持たず全て文字列で渡ってくるため、int/floatは数値型に加えて
    // 「数字として妥当な文字列」も許容する(値そのものは文字列のまま扱い、
    // 数値へは変換しない。変換無しで済むよう_numeric側で比較時のみ数値化する).
    // type スキーマで指定された型名を設定します.
    // value 検証対象の値を設定します.
    // 戻り値: 型が一致する場合true.
    const _checkType = function (type, value) {
        switch (type) {
            case "string":
                return typeof value === "string";
            case "int":
                return (typeof value === "number" && Number.isInteger(value)) ||
                    (typeof value === "string" && _isIntString(value));
            case "float":
                return (typeof value === "number" && isFinite(value)) ||
                    (typeof value === "string" && _isFloatString(value));
            case "boolean":
                return typeof value === "boolean";
            case "date":
                return value instanceof Date && !isNaN(value.getTime());
            default:
                throw new Error("Unknown type: " + type);
        }
    };

    // min/max/range比較用に値を数値化(date型はgetTime()、数字文字列はNumber化、
    // それ以外はそのまま).
    const _numeric = function (value) {
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof value === "string" && _isFloatString(value)) {
            return Number(value);
        }
        return value;
    };

    // 1フィールド分の検証を実施.
    // field フィールド名を設定します.
    // rule スキーマ定義({type, required, default, minLen, maxLen,
    //      min, max, range, mail, url, zip, tel, date, time, alphaNum,
    //      pattern, enum, custom, messages})を設定します.
    // value 検証対象の値(dataからの取得値)を設定します.
    // hasValue dataにこのフィールドのキー自体が存在するかを設定します.
    // data 検証対象のオブジェクト全体を設定します(rule.customへ
    //      フィールド間の相関チェック用に渡すため).
    // 戻り値: { error: {field, rule, message} または null, value: 補完後の値 }
    const _checkField = function (field, rule, value, hasValue, data) {
        const messages = rule.messages || {};

        const makeError = function (ruleName, params) {
            const message = messages[ruleName] != undefined ?
                messages[ruleName] : _defaultMessage(ruleName, field, params || {});
            return { field: field, rule: ruleName, message: message };
        };

        // 値が存在しない(undefined/null)場合.
        if (!hasValue || value === undefined || value === null) {
            if (rule.required == true) {
                return { error: makeError("required"), value: value };
            }
            // defaultが定義されている場合は補完する(以降の検証は行わない).
            if (rule.default !== undefined) {
                const def = typeof rule.default === "function" ?
                    rule.default() : rule.default;
                return { error: null, value: def };
            }
            // 未設定かつrequiredでもdefaultでも無い場合はそのまま許容.
            return { error: null, value: value };
        }

        // 型チェック.
        if (rule.type != undefined && !_checkType(rule.type, value)) {
            return { error: makeError("type"), value: value };
        }

        // 文字列長チェック.
        if (rule.type === "string") {
            if (rule.minLen != undefined && value.length < rule.minLen) {
                return { error: makeError("minLen", { minLen: rule.minLen }), value: value };
            }
            if (rule.maxLen != undefined && value.length > rule.maxLen) {
                return { error: makeError("maxLen", { maxLen: rule.maxLen }), value: value };
            }
        }

        // 数値/日付の範囲チェック (min / max).
        if (rule.type === "int" || rule.type === "float" || rule.type === "date" || typeof value === "number") {
            const n = _numeric(value);
            if (rule.min != undefined && n < _numeric(rule.min)) {
                return { error: makeError("min", { min: rule.min }), value: value };
            }
            if (rule.max != undefined && n > _numeric(rule.max)) {
                return { error: makeError("max", { max: rule.max }), value: value };
            }
        }

        // range (範囲) チェック (配列 [min, max] または オブジェクト { min, max })
        if (rule.range != undefined) {
            let rMin, rMax;
            if (Array.isArray(rule.range)) {
                rMin = rule.range[0];
                rMax = rule.range[1];
            } else if (typeof rule.range === 'object') {
                rMin = rule.range.min;
                rMax = rule.range.max;
            }
            const n = _numeric(value);
            if ((rMin != undefined && n < _numeric(rMin)) || (rMax != undefined && n > _numeric(rMax))) {
                return { error: makeError("range", { min: rMin, max: rMax }), value: value };
            }
        }

        // mail (メールアドレス) チェック
        if (rule.mail === true) {
            if (typeof value !== 'string' || !_REGEX_MAIL.test(value)) {
                return { error: makeError("mail"), value: value };
            }
        }

        // url (HTTP/HTTPS URL) チェック
        if (rule.url === true) {
            if (typeof value !== 'string' || !_REGEX_URL.test(value)) {
                return { error: makeError("url"), value: value };
            }
        }

        // zip (郵便番号) チェック
        if (rule.zip === true) {
            if (typeof value !== 'string' || !_REGEX_ZIP.test(value)) {
                return { error: makeError("zip"), value: value };
            }
        }

        // tel (電話番号) チェック
        if (rule.tel === true) {
            if (typeof value !== 'string' || !_REGEX_TEL.test(value)) {
                return { error: makeError("tel"), value: value };
            }
        }

        // date (日付文字列) チェック
        if (rule.date === true) {
            if (!_isValidDateString(value)) {
                return { error: makeError("date"), value: value };
            }
        }

        // time (時刻文字列) チェック
        if (rule.time === true) {
            if (typeof value !== 'string' || !_REGEX_TIME.test(value)) {
                return { error: makeError("time"), value: value };
            }
        }

        // alphaNum (半角英数字) チェック
        if (rule.alphaNum === true) {
            if (typeof value !== 'string' || !_REGEX_ALPHANUM.test(value)) {
                return { error: makeError("alphaNum"), value: value };
            }
        }

        // 正規表現チェック(string限定 / pattern).
        if (rule.type === "string" && rule.pattern != undefined) {
            if (!rule.pattern.test(value)) {
                return { error: makeError("pattern"), value: value };
            }
        }

        // enumチェック.
        if (rule.enum != undefined && rule.enum.indexOf(value) === -1) {
            return { error: makeError("enum"), value: value };
        }

        // カスタム検証.
        // rule.custom(value, data) が false を返した場合エラー、
        // 文字列を返した場合はそれをそのままメッセージとして採用する.
        if (typeof rule.custom === "function") {
            const customRet = rule.custom(value, data);
            if (customRet === false) {
                return { error: makeError("custom"), value: value };
            }
            if (typeof customRet === "string") {
                return { error: { field: field, rule: "custom", message: customRet }, value: value };
            }
        }

        return { error: null, value: value };
    };

    // dataをschemaに従って検証する.
    // data 検証対象のJSオブジェクトを設定します.
    // schema { フィールド名: ルール定義 } のオブジェクトを設定します.
    // 戻り値: { valid, errors: [{field, rule, message}], data }
    //         data はdefault値を補完したオブジェクト(元のdataは変更しない).
    exports.check = function (data, schema) {
        if (data == undefined || data == null) {
            data = {};
        }
        const result = Object.assign({}, data);
        const errors = [];
        for (let field in schema) {
            const hasValue = Object.prototype.hasOwnProperty.call(data, field);
            const ret = _checkField(field, schema[field], data[field], hasValue, data);
            if (ret.error != null) {
                errors.push(ret.error);
            } else {
                result[field] = ret.value;
            }
        }
        return {
            valid: errors.length === 0,
            errors: errors,
            data: result
        };
    };
})();
