/**
 * AIメモ:
 * - dateEx.js (日付操作ユーティリティ) の単体テスト。
 * - 生成、日時加減算、クリア、フォーマット出力、between 範囲判定を検証。
 */

const { describe, it, expect } = require('bun:test');
const DateEx = require('../modules/dateEx.js');

describe('DateEx Utility Module', () => {
    it('様々な引数から DateEx インスタンスが正しく作成できること', () => {
        const d1 = DateEx(2026, 7, 16, 15, 30, 0); // 2026-08-16 15:30:00
        expect(d1.getFullYear()).toBe(2026);
        expect(d1.getMonth()).toBe(7); // 8月 (0-indexed)
        expect(d1.getDate()).toBe(16);
        expect(d1.getHours()).toBe(15);
        expect(d1.getMinutes()).toBe(30);

        const d2 = DateEx.create('2026-01-01T00:00:00Z');
        expect(d2.getTime()).toBe(new Date('2026-01-01T00:00:00Z').getTime());

        const d3 = DateEx(d1);
        expect(d3.getTime()).toBe(d1.getTime());
    });

    it('ハイフン・スラッシュ・8桁・日本語日付がすべてローカル0時として統一パースされること (UTC時差罠の解消)', () => {
        const dHyphen = DateEx('2025-01-01');
        const dSlash = DateEx('2025/01/01');
        const dDot = DateEx('2025.01.01');
        const d8Digits = DateEx('20250101');
        const dJp = DateEx('2025年1月1日');

        // すべて時・分・秒が 0 になっていること (JavaScript 標準の 9時にならない)
        expect(dHyphen.getHours()).toBe(0);
        expect(dSlash.getHours()).toBe(0);
        expect(dDot.getHours()).toBe(0);
        expect(d8Digits.getHours()).toBe(0);
        expect(dJp.getHours()).toBe(0);

        expect(dHyphen.getMinutes()).toBe(0);
        expect(dHyphen.getSeconds()).toBe(0);

        // すべての日付・月・年が一致すること
        expect(dHyphen.getFullYear()).toBe(2025);
        expect(dHyphen.getMonth()).toBe(0);
        expect(dHyphen.getDate()).toBe(1);

        // エポックタイムがすべて完全に一致すること
        expect(dHyphen.getTime()).toBe(dSlash.getTime());
        expect(dHyphen.getTime()).toBe(dDot.getTime());
        expect(dHyphen.getTime()).toBe(d8Digits.getTime());
        expect(dHyphen.getTime()).toBe(dJp.getTime());
    });

    it('日時加減算 (change) がチェーン可能で正しく動作すること', () => {
        const d = DateEx(2026, 0, 15); // 2026-01-15
        d.change('date', 5)
         .change('month', 2)
         .change('year', -1);

        expect(d.getFullYear()).toBe(2025);
        expect(d.getMonth()).toBe(2); // 3月
        expect(d.getDate()).toBe(20);
    });

    it('リセット (clear) が正しく動作すること', () => {
        const d = DateEx(2026, 7, 16, 15, 30, 45, 500);
        d.clear('hours'); // 0時0分0秒0ミリ秒に
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
        expect(d.getSeconds()).toBe(0);
        expect(d.getMilliseconds()).toBe(0);
        expect(d.getDate()).toBe(16);

        d.clear('date'); // 月初 (1日) に
        expect(d.getDate()).toBe(1);
    });

    it('toString() で様々なモードの文字列が出力できること', () => {
        const d = DateEx(2026, 7, 5, 9, 8, 7, 123); // 2026-08-05 09:08:07.123

        expect(d.toString('date')).toBe('2026-08-05');
        expect(d.toString('month')).toBe('2026-08');
        expect(d.toString('year')).toBe('2026');
        expect(d.toString('hm')).toBe('09:08');
        expect(d.toString('hms')).toBe('09:08:07');
        expect(d.toString('full')).toBe('2026-08-05 09:08:07.123');

        // フォーマットなし (none: true)
        expect(d.toString('date', { none: true })).toBe('20260805');
    });

    it('toFormatString() で自由なパターンのフォーマットができること', () => {
        const d = DateEx(2026, 7, 16, 14, 30, 45); // 2026-08-16 (日)
        const formatted = d.toFormatString('{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}');
        expect(formatted).toBe('2026/08/16(日) 14:30:45');

        const formattedEn = d.toFormatString('{yyyy}-{MM}-{dd} [{dw}]');
        expect(formattedEn).toBe('2026-08-16 [Sun]');
    });

    it('between と isBetween で期間判定が正しく行えること', () => {
        const target = DateEx(2026, 7, 15); // 2026-08-15
        const monthRange = DateEx.between(target, 'month');

        expect(monthRange.start.getDate()).toBe(1);
        expect(monthRange.start.getHours()).toBe(0);
        expect(monthRange.end.getDate()).toBe(31);
        expect(monthRange.end.getHours()).toBe(23);

        // 範囲内
        expect(monthRange.isBetween('2026-08-15 12:00:00')).toBe(true);
        expect(monthRange.isBetween(DateEx(2026, 7, 1))).toBe(true);
        expect(monthRange.isBetween(DateEx(2026, 7, 31, 23, 59, 59, 999))).toBe(true);

        // 範囲外
        expect(monthRange.isBetween('2026-07-31 23:59:59')).toBe(false);
        expect(monthRange.isBetween('2026-09-01 00:00:00')).toBe(false);
    });

    it('曜日取得が日本語・英語で正しく取得できること', () => {
        const sunday = DateEx(2026, 7, 16); // 2026-08-16 (日)
        expect(sunday.getDayToString(true)).toBe('日');
        expect(sunday.getDayToString(false)).toBe('Sun');

        const monday = DateEx(2026, 7, 17); // 2026-08-17 (月)
        expect(monday.getDayToString(true)).toBe('月');
        expect(monday.getDayToString(false)).toBe('Mon');
    });
});
