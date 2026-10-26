#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/sisteransi/src/index.js
var require_src = __commonJS((exports, module) => {
  var ESC = "\x1B";
  var CSI = `${ESC}[`;
  var beep = "\x07";
  var cursor = {
    to(x, y) {
      if (!y)
        return `${CSI}${x + 1}G`;
      return `${CSI}${y + 1};${x + 1}H`;
    },
    move(x, y) {
      let ret = "";
      if (x < 0)
        ret += `${CSI}${-x}D`;
      else if (x > 0)
        ret += `${CSI}${x}C`;
      if (y < 0)
        ret += `${CSI}${-y}A`;
      else if (y > 0)
        ret += `${CSI}${y}B`;
      return ret;
    },
    up: (count = 1) => `${CSI}${count}A`,
    down: (count = 1) => `${CSI}${count}B`,
    forward: (count = 1) => `${CSI}${count}C`,
    backward: (count = 1) => `${CSI}${count}D`,
    nextLine: (count = 1) => `${CSI}E`.repeat(count),
    prevLine: (count = 1) => `${CSI}F`.repeat(count),
    left: `${CSI}G`,
    hide: `${CSI}?25l`,
    show: `${CSI}?25h`,
    save: `${ESC}7`,
    restore: `${ESC}8`
  };
  var scroll = {
    up: (count = 1) => `${CSI}S`.repeat(count),
    down: (count = 1) => `${CSI}T`.repeat(count)
  };
  var erase = {
    screen: `${CSI}2J`,
    up: (count = 1) => `${CSI}1J`.repeat(count),
    down: (count = 1) => `${CSI}J`.repeat(count),
    line: `${CSI}2K`,
    lineEnd: `${CSI}K`,
    lineStart: `${CSI}1K`,
    lines(count) {
      let clear = "";
      for (let i = 0;i < count; i++)
        clear += this.line + (i < count - 1 ? cursor.up() : "");
      if (count)
        clear += cursor.left;
      return clear;
    }
  };
  module.exports = { cursor, scroll, erase, beep };
});

// node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS((exports, module) => {
  var p = process || {};
  var argv = p.argv || [];
  var env = p.env || {};
  var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
  var formatter = (open, close, replace = open) => (input) => {
    let string = "" + input, index = string.indexOf(close, open.length);
    return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
  };
  var replaceClose = (string, close, replace, index) => {
    let result = "", cursor = 0;
    do {
      result += string.substring(cursor, index) + replace;
      cursor = index + close.length;
      index = string.indexOf(close, cursor);
    } while (~index);
    return result + string.substring(cursor);
  };
  var createColors = (enabled = isColorSupported) => {
    let f = enabled ? formatter : () => String;
    return {
      isColorSupported: enabled,
      reset: f("\x1B[0m", "\x1B[0m"),
      bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
      dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
      italic: f("\x1B[3m", "\x1B[23m"),
      underline: f("\x1B[4m", "\x1B[24m"),
      inverse: f("\x1B[7m", "\x1B[27m"),
      hidden: f("\x1B[8m", "\x1B[28m"),
      strikethrough: f("\x1B[9m", "\x1B[29m"),
      black: f("\x1B[30m", "\x1B[39m"),
      red: f("\x1B[31m", "\x1B[39m"),
      green: f("\x1B[32m", "\x1B[39m"),
      yellow: f("\x1B[33m", "\x1B[39m"),
      blue: f("\x1B[34m", "\x1B[39m"),
      magenta: f("\x1B[35m", "\x1B[39m"),
      cyan: f("\x1B[36m", "\x1B[39m"),
      white: f("\x1B[37m", "\x1B[39m"),
      gray: f("\x1B[90m", "\x1B[39m"),
      bgBlack: f("\x1B[40m", "\x1B[49m"),
      bgRed: f("\x1B[41m", "\x1B[49m"),
      bgGreen: f("\x1B[42m", "\x1B[49m"),
      bgYellow: f("\x1B[43m", "\x1B[49m"),
      bgBlue: f("\x1B[44m", "\x1B[49m"),
      bgMagenta: f("\x1B[45m", "\x1B[49m"),
      bgCyan: f("\x1B[46m", "\x1B[49m"),
      bgWhite: f("\x1B[47m", "\x1B[49m"),
      blackBright: f("\x1B[90m", "\x1B[39m"),
      redBright: f("\x1B[91m", "\x1B[39m"),
      greenBright: f("\x1B[92m", "\x1B[39m"),
      yellowBright: f("\x1B[93m", "\x1B[39m"),
      blueBright: f("\x1B[94m", "\x1B[39m"),
      magentaBright: f("\x1B[95m", "\x1B[39m"),
      cyanBright: f("\x1B[96m", "\x1B[39m"),
      whiteBright: f("\x1B[97m", "\x1B[39m"),
      bgBlackBright: f("\x1B[100m", "\x1B[49m"),
      bgRedBright: f("\x1B[101m", "\x1B[49m"),
      bgGreenBright: f("\x1B[102m", "\x1B[49m"),
      bgYellowBright: f("\x1B[103m", "\x1B[49m"),
      bgBlueBright: f("\x1B[104m", "\x1B[49m"),
      bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
      bgCyanBright: f("\x1B[106m", "\x1B[49m"),
      bgWhiteBright: f("\x1B[107m", "\x1B[49m")
    };
  };
  module.exports = createColors();
  module.exports.createColors = createColors;
});

// node_modules/@clack/prompts/dist/index.mjs
import { stripVTControlCharacters as T2 } from "util";

// node_modules/@clack/core/dist/index.mjs
var import_sisteransi = __toESM(require_src(), 1);
var import_picocolors = __toESM(require_picocolors(), 1);
import { stdin as $, stdout as j } from "process";
import * as f from "readline";
import M from "readline";
import { WriteStream as U } from "tty";
function J({ onlyFirst: t = false } = {}) {
  const F = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
  return new RegExp(F, t ? undefined : "g");
}
var Q = J();
function T(t) {
  if (typeof t != "string")
    throw new TypeError(`Expected a \`string\`, got \`${typeof t}\``);
  return t.replace(Q, "");
}
function O(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var P = { exports: {} };
(function(t) {
  var u = {};
  t.exports = u, u.eastAsianWidth = function(e) {
    var s = e.charCodeAt(0), i = e.length == 2 ? e.charCodeAt(1) : 0, D = s;
    return 55296 <= s && s <= 56319 && 56320 <= i && i <= 57343 && (s &= 1023, i &= 1023, D = s << 10 | i, D += 65536), D == 12288 || 65281 <= D && D <= 65376 || 65504 <= D && D <= 65510 ? "F" : D == 8361 || 65377 <= D && D <= 65470 || 65474 <= D && D <= 65479 || 65482 <= D && D <= 65487 || 65490 <= D && D <= 65495 || 65498 <= D && D <= 65500 || 65512 <= D && D <= 65518 ? "H" : 4352 <= D && D <= 4447 || 4515 <= D && D <= 4519 || 4602 <= D && D <= 4607 || 9001 <= D && D <= 9002 || 11904 <= D && D <= 11929 || 11931 <= D && D <= 12019 || 12032 <= D && D <= 12245 || 12272 <= D && D <= 12283 || 12289 <= D && D <= 12350 || 12353 <= D && D <= 12438 || 12441 <= D && D <= 12543 || 12549 <= D && D <= 12589 || 12593 <= D && D <= 12686 || 12688 <= D && D <= 12730 || 12736 <= D && D <= 12771 || 12784 <= D && D <= 12830 || 12832 <= D && D <= 12871 || 12880 <= D && D <= 13054 || 13056 <= D && D <= 19903 || 19968 <= D && D <= 42124 || 42128 <= D && D <= 42182 || 43360 <= D && D <= 43388 || 44032 <= D && D <= 55203 || 55216 <= D && D <= 55238 || 55243 <= D && D <= 55291 || 63744 <= D && D <= 64255 || 65040 <= D && D <= 65049 || 65072 <= D && D <= 65106 || 65108 <= D && D <= 65126 || 65128 <= D && D <= 65131 || 110592 <= D && D <= 110593 || 127488 <= D && D <= 127490 || 127504 <= D && D <= 127546 || 127552 <= D && D <= 127560 || 127568 <= D && D <= 127569 || 131072 <= D && D <= 194367 || 177984 <= D && D <= 196605 || 196608 <= D && D <= 262141 ? "W" : 32 <= D && D <= 126 || 162 <= D && D <= 163 || 165 <= D && D <= 166 || D == 172 || D == 175 || 10214 <= D && D <= 10221 || 10629 <= D && D <= 10630 ? "Na" : D == 161 || D == 164 || 167 <= D && D <= 168 || D == 170 || 173 <= D && D <= 174 || 176 <= D && D <= 180 || 182 <= D && D <= 186 || 188 <= D && D <= 191 || D == 198 || D == 208 || 215 <= D && D <= 216 || 222 <= D && D <= 225 || D == 230 || 232 <= D && D <= 234 || 236 <= D && D <= 237 || D == 240 || 242 <= D && D <= 243 || 247 <= D && D <= 250 || D == 252 || D == 254 || D == 257 || D == 273 || D == 275 || D == 283 || 294 <= D && D <= 295 || D == 299 || 305 <= D && D <= 307 || D == 312 || 319 <= D && D <= 322 || D == 324 || 328 <= D && D <= 331 || D == 333 || 338 <= D && D <= 339 || 358 <= D && D <= 359 || D == 363 || D == 462 || D == 464 || D == 466 || D == 468 || D == 470 || D == 472 || D == 474 || D == 476 || D == 593 || D == 609 || D == 708 || D == 711 || 713 <= D && D <= 715 || D == 717 || D == 720 || 728 <= D && D <= 731 || D == 733 || D == 735 || 768 <= D && D <= 879 || 913 <= D && D <= 929 || 931 <= D && D <= 937 || 945 <= D && D <= 961 || 963 <= D && D <= 969 || D == 1025 || 1040 <= D && D <= 1103 || D == 1105 || D == 8208 || 8211 <= D && D <= 8214 || 8216 <= D && D <= 8217 || 8220 <= D && D <= 8221 || 8224 <= D && D <= 8226 || 8228 <= D && D <= 8231 || D == 8240 || 8242 <= D && D <= 8243 || D == 8245 || D == 8251 || D == 8254 || D == 8308 || D == 8319 || 8321 <= D && D <= 8324 || D == 8364 || D == 8451 || D == 8453 || D == 8457 || D == 8467 || D == 8470 || 8481 <= D && D <= 8482 || D == 8486 || D == 8491 || 8531 <= D && D <= 8532 || 8539 <= D && D <= 8542 || 8544 <= D && D <= 8555 || 8560 <= D && D <= 8569 || D == 8585 || 8592 <= D && D <= 8601 || 8632 <= D && D <= 8633 || D == 8658 || D == 8660 || D == 8679 || D == 8704 || 8706 <= D && D <= 8707 || 8711 <= D && D <= 8712 || D == 8715 || D == 8719 || D == 8721 || D == 8725 || D == 8730 || 8733 <= D && D <= 8736 || D == 8739 || D == 8741 || 8743 <= D && D <= 8748 || D == 8750 || 8756 <= D && D <= 8759 || 8764 <= D && D <= 8765 || D == 8776 || D == 8780 || D == 8786 || 8800 <= D && D <= 8801 || 8804 <= D && D <= 8807 || 8810 <= D && D <= 8811 || 8814 <= D && D <= 8815 || 8834 <= D && D <= 8835 || 8838 <= D && D <= 8839 || D == 8853 || D == 8857 || D == 8869 || D == 8895 || D == 8978 || 9312 <= D && D <= 9449 || 9451 <= D && D <= 9547 || 9552 <= D && D <= 9587 || 9600 <= D && D <= 9615 || 9618 <= D && D <= 9621 || 9632 <= D && D <= 9633 || 9635 <= D && D <= 9641 || 9650 <= D && D <= 9651 || 9654 <= D && D <= 9655 || 9660 <= D && D <= 9661 || 9664 <= D && D <= 9665 || 9670 <= D && D <= 9672 || D == 9675 || 9678 <= D && D <= 9681 || 9698 <= D && D <= 9701 || D == 9711 || 9733 <= D && D <= 9734 || D == 9737 || 9742 <= D && D <= 9743 || 9748 <= D && D <= 9749 || D == 9756 || D == 9758 || D == 9792 || D == 9794 || 9824 <= D && D <= 9825 || 9827 <= D && D <= 9829 || 9831 <= D && D <= 9834 || 9836 <= D && D <= 9837 || D == 9839 || 9886 <= D && D <= 9887 || 9918 <= D && D <= 9919 || 9924 <= D && D <= 9933 || 9935 <= D && D <= 9953 || D == 9955 || 9960 <= D && D <= 9983 || D == 10045 || D == 10071 || 10102 <= D && D <= 10111 || 11093 <= D && D <= 11097 || 12872 <= D && D <= 12879 || 57344 <= D && D <= 63743 || 65024 <= D && D <= 65039 || D == 65533 || 127232 <= D && D <= 127242 || 127248 <= D && D <= 127277 || 127280 <= D && D <= 127337 || 127344 <= D && D <= 127386 || 917760 <= D && D <= 917999 || 983040 <= D && D <= 1048573 || 1048576 <= D && D <= 1114109 ? "A" : "N";
  }, u.characterLength = function(e) {
    var s = this.eastAsianWidth(e);
    return s == "F" || s == "W" || s == "A" ? 2 : 1;
  };
  function F(e) {
    return e.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || [];
  }
  u.length = function(e) {
    for (var s = F(e), i = 0, D = 0;D < s.length; D++)
      i = i + this.characterLength(s[D]);
    return i;
  }, u.slice = function(e, s, i) {
    textLen = u.length(e), s = s || 0, i = i || 1, s < 0 && (s = textLen + s), i < 0 && (i = textLen + i);
    for (var D = "", C = 0, o = F(e), E = 0;E < o.length; E++) {
      var a = o[E], n = u.length(a);
      if (C >= s - (n == 2 ? 1 : 0))
        if (C + n <= i)
          D += a;
        else
          break;
      C += n;
    }
    return D;
  };
})(P);
var X = P.exports;
var DD = O(X);
var uD = function() {
  return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|(?:\uD83E\uDDD1\uD83C\uDFFF\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFC-\uDFFF])|\uD83D\uDC68(?:\uD83C\uDFFB(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|[\u2695\u2696\u2708]\uFE0F|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))?|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])\uFE0F|\u200D(?:(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D[\uDC66\uDC67])|\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC)?|(?:\uD83D\uDC69(?:\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC69(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83E\uDDD1(?:\u200D(?:\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDE36\u200D\uD83C\uDF2B|\uD83C\uDFF3\uFE0F\u200D\u26A7|\uD83D\uDC3B\u200D\u2744|(?:(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\uD83C\uDFF4\u200D\u2620|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])\u200D[\u2640\u2642]|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600-\u2604\u260E\u2611\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u3030\u303D\u3297\u3299]|\uD83C[\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]|\uD83D[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3])\uFE0F|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDE35\u200D\uD83D\uDCAB|\uD83D\uDE2E\u200D\uD83D\uDCA8|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83E\uDDD1(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83D\uDC69(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83D\uDC08\u200D\u2B1B|\u2764\uFE0F\u200D(?:\uD83D\uDD25|\uD83E\uDE79)|\uD83D\uDC41\uFE0F|\uD83C\uDFF3\uFE0F|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|[#\*0-9]\uFE0F\u20E3|\u2764\uFE0F|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|\uD83C\uDFF4|(?:[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270C\u270D]|\uD83D[\uDD74\uDD90])(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC08\uDC15\uDC3B\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE2E\uDE35\uDE36\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5]|\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD]|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF]|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0D\uDD0E\uDD10-\uDD17\uDD1D\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78\uDD7A-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCB\uDDD0\uDDE0-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6]|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26A7\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5-\uDED7\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDD77\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
};
var FD = O(uD);
function A(t, u = {}) {
  if (typeof t != "string" || t.length === 0 || (u = { ambiguousIsNarrow: true, ...u }, t = T(t), t.length === 0))
    return 0;
  t = t.replace(FD(), "  ");
  const F = u.ambiguousIsNarrow ? 1 : 2;
  let e = 0;
  for (const s of t) {
    const i = s.codePointAt(0);
    if (i <= 31 || i >= 127 && i <= 159 || i >= 768 && i <= 879)
      continue;
    switch (DD.eastAsianWidth(s)) {
      case "F":
      case "W":
        e += 2;
        break;
      case "A":
        e += F;
        break;
      default:
        e += 1;
    }
  }
  return e;
}
var m = 10;
var L = (t = 0) => (u) => `\x1B[${u + t}m`;
var N = (t = 0) => (u) => `\x1B[${38 + t};5;${u}m`;
var I = (t = 0) => (u, F, e) => `\x1B[${38 + t};2;${u};${F};${e}m`;
var r = { modifier: { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], overline: [53, 55], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29] }, color: { black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], blackBright: [90, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39] }, bgColor: { bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgBlackBright: [100, 49], bgGray: [100, 49], bgGrey: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49] } };
Object.keys(r.modifier);
var tD = Object.keys(r.color);
var eD = Object.keys(r.bgColor);
[...tD, ...eD];
function sD() {
  const t = new Map;
  for (const [u, F] of Object.entries(r)) {
    for (const [e, s] of Object.entries(F))
      r[e] = { open: `\x1B[${s[0]}m`, close: `\x1B[${s[1]}m` }, F[e] = r[e], t.set(s[0], s[1]);
    Object.defineProperty(r, u, { value: F, enumerable: false });
  }
  return Object.defineProperty(r, "codes", { value: t, enumerable: false }), r.color.close = "\x1B[39m", r.bgColor.close = "\x1B[49m", r.color.ansi = L(), r.color.ansi256 = N(), r.color.ansi16m = I(), r.bgColor.ansi = L(m), r.bgColor.ansi256 = N(m), r.bgColor.ansi16m = I(m), Object.defineProperties(r, { rgbToAnsi256: { value: (u, F, e) => u === F && F === e ? u < 8 ? 16 : u > 248 ? 231 : Math.round((u - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(u / 255 * 5) + 6 * Math.round(F / 255 * 5) + Math.round(e / 255 * 5), enumerable: false }, hexToRgb: { value: (u) => {
    const F = /[a-f\d]{6}|[a-f\d]{3}/i.exec(u.toString(16));
    if (!F)
      return [0, 0, 0];
    let [e] = F;
    e.length === 3 && (e = [...e].map((i) => i + i).join(""));
    const s = Number.parseInt(e, 16);
    return [s >> 16 & 255, s >> 8 & 255, s & 255];
  }, enumerable: false }, hexToAnsi256: { value: (u) => r.rgbToAnsi256(...r.hexToRgb(u)), enumerable: false }, ansi256ToAnsi: { value: (u) => {
    if (u < 8)
      return 30 + u;
    if (u < 16)
      return 90 + (u - 8);
    let F, e, s;
    if (u >= 232)
      F = ((u - 232) * 10 + 8) / 255, e = F, s = F;
    else {
      u -= 16;
      const C = u % 36;
      F = Math.floor(u / 36) / 5, e = Math.floor(C / 6) / 5, s = C % 6 / 5;
    }
    const i = Math.max(F, e, s) * 2;
    if (i === 0)
      return 30;
    let D = 30 + (Math.round(s) << 2 | Math.round(e) << 1 | Math.round(F));
    return i === 2 && (D += 60), D;
  }, enumerable: false }, rgbToAnsi: { value: (u, F, e) => r.ansi256ToAnsi(r.rgbToAnsi256(u, F, e)), enumerable: false }, hexToAnsi: { value: (u) => r.ansi256ToAnsi(r.hexToAnsi256(u)), enumerable: false } }), r;
}
var iD = sD();
var v = new Set(["\x1B", "\x9B"]);
var CD = 39;
var w = "\x07";
var W = "[";
var rD = "]";
var R = "m";
var y = `${rD}8;;`;
var V = (t) => `${v.values().next().value}${W}${t}${R}`;
var z = (t) => `${v.values().next().value}${y}${t}${w}`;
var ED = (t) => t.split(" ").map((u) => A(u));
var _ = (t, u, F) => {
  const e = [...u];
  let s = false, i = false, D = A(T(t[t.length - 1]));
  for (const [C, o] of e.entries()) {
    const E = A(o);
    if (D + E <= F ? t[t.length - 1] += o : (t.push(o), D = 0), v.has(o) && (s = true, i = e.slice(C + 1).join("").startsWith(y)), s) {
      i ? o === w && (s = false, i = false) : o === R && (s = false);
      continue;
    }
    D += E, D === F && C < e.length - 1 && (t.push(""), D = 0);
  }
  !D && t[t.length - 1].length > 0 && t.length > 1 && (t[t.length - 2] += t.pop());
};
var nD = (t) => {
  const u = t.split(" ");
  let F = u.length;
  for (;F > 0 && !(A(u[F - 1]) > 0); )
    F--;
  return F === u.length ? t : u.slice(0, F).join(" ") + u.slice(F).join("");
};
var oD = (t, u, F = {}) => {
  if (F.trim !== false && t.trim() === "")
    return "";
  let e = "", s, i;
  const D = ED(t);
  let C = [""];
  for (const [E, a] of t.split(" ").entries()) {
    F.trim !== false && (C[C.length - 1] = C[C.length - 1].trimStart());
    let n = A(C[C.length - 1]);
    if (E !== 0 && (n >= u && (F.wordWrap === false || F.trim === false) && (C.push(""), n = 0), (n > 0 || F.trim === false) && (C[C.length - 1] += " ", n++)), F.hard && D[E] > u) {
      const B = u - n, p = 1 + Math.floor((D[E] - B - 1) / u);
      Math.floor((D[E] - 1) / u) < p && C.push(""), _(C, a, u);
      continue;
    }
    if (n + D[E] > u && n > 0 && D[E] > 0) {
      if (F.wordWrap === false && n < u) {
        _(C, a, u);
        continue;
      }
      C.push("");
    }
    if (n + D[E] > u && F.wordWrap === false) {
      _(C, a, u);
      continue;
    }
    C[C.length - 1] += a;
  }
  F.trim !== false && (C = C.map((E) => nD(E)));
  const o = [...C.join(`
`)];
  for (const [E, a] of o.entries()) {
    if (e += a, v.has(a)) {
      const { groups: B } = new RegExp(`(?:\\${W}(?<code>\\d+)m|\\${y}(?<uri>.*)${w})`).exec(o.slice(E).join("")) || { groups: {} };
      if (B.code !== undefined) {
        const p = Number.parseFloat(B.code);
        s = p === CD ? undefined : p;
      } else
        B.uri !== undefined && (i = B.uri.length === 0 ? undefined : B.uri);
    }
    const n = iD.codes.get(Number(s));
    o[E + 1] === `
` ? (i && (e += z("")), s && n && (e += V(n))) : a === `
` && (s && n && (e += V(s)), i && (e += z(i)));
  }
  return e;
};
function G(t, u, F) {
  return String(t).normalize().replace(/\r\n/g, `
`).split(`
`).map((e) => oD(e, u, F)).join(`
`);
}
var aD = ["up", "down", "left", "right", "space", "enter", "cancel"];
var c = { actions: new Set(aD), aliases: new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"], ["\x03", "cancel"], ["escape", "cancel"]]) };
function k(t, u) {
  if (typeof t == "string")
    return c.aliases.get(t) === u;
  for (const F of t)
    if (F !== undefined && k(F, u))
      return true;
  return false;
}
function lD(t, u) {
  if (t === u)
    return;
  const F = t.split(`
`), e = u.split(`
`), s = [];
  for (let i = 0;i < Math.max(F.length, e.length); i++)
    F[i] !== e[i] && s.push(i);
  return s;
}
var xD = globalThis.process.platform.startsWith("win");
var S = Symbol("clack:cancel");
function BD(t) {
  return t === S;
}
function d(t, u) {
  const F = t;
  F.isTTY && F.setRawMode(u);
}
function cD({ input: t = $, output: u = j, overwrite: F = true, hideCursor: e = true } = {}) {
  const s = f.createInterface({ input: t, output: u, prompt: "", tabSize: 1 });
  f.emitKeypressEvents(t, s), t.isTTY && t.setRawMode(true);
  const i = (D, { name: C, sequence: o }) => {
    const E = String(D);
    if (k([E, C, o], "cancel")) {
      e && u.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!F)
      return;
    const a = C === "return" ? 0 : -1, n = C === "return" ? -1 : 0;
    f.moveCursor(u, a, n, () => {
      f.clearLine(u, 1, () => {
        t.once("keypress", i);
      });
    });
  };
  return e && u.write(import_sisteransi.cursor.hide), t.once("keypress", i), () => {
    t.off("keypress", i), e && u.write(import_sisteransi.cursor.show), t.isTTY && !xD && t.setRawMode(false), s.terminal = false, s.close();
  };
}
var AD = Object.defineProperty;
var pD = (t, u, F) => (u in t) ? AD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var h = (t, u, F) => (pD(t, typeof u != "symbol" ? u + "" : u, F), F);

class x {
  constructor(u, F = true) {
    h(this, "input"), h(this, "output"), h(this, "_abortSignal"), h(this, "rl"), h(this, "opts"), h(this, "_render"), h(this, "_track", false), h(this, "_prevFrame", ""), h(this, "_subscribers", new Map), h(this, "_cursor", 0), h(this, "state", "initial"), h(this, "error", ""), h(this, "value");
    const { input: e = $, output: s = j, render: i, signal: D, ...C } = u;
    this.opts = C, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = i.bind(this), this._track = F, this._abortSignal = D, this.input = e, this.output = s;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(u, F) {
    const e = this._subscribers.get(u) ?? [];
    e.push(F), this._subscribers.set(u, e);
  }
  on(u, F) {
    this.setSubscriber(u, { cb: F });
  }
  once(u, F) {
    this.setSubscriber(u, { cb: F, once: true });
  }
  emit(u, ...F) {
    const e = this._subscribers.get(u) ?? [], s = [];
    for (const i of e)
      i.cb(...F), i.once && s.push(() => e.splice(e.indexOf(i), 1));
    for (const i of s)
      i();
  }
  prompt() {
    return new Promise((u, F) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted)
          return this.state = "cancel", this.close(), u(S);
        this._abortSignal.addEventListener("abort", () => {
          this.state = "cancel", this.close();
        }, { once: true });
      }
      const e = new U(0);
      e._write = (s, i, D) => {
        this._track && (this.value = this.rl?.line.replace(/\t/g, ""), this._cursor = this.rl?.cursor ?? 0, this.emit("value", this.value)), D();
      }, this.input.pipe(e), this.rl = M.createInterface({ input: this.input, output: e, tabSize: 2, prompt: "", escapeCodeTimeout: 50 }), M.emitKeypressEvents(this.input, this.rl), this.rl.prompt(), this.opts.initialValue !== undefined && this._track && this.rl.write(this.opts.initialValue), this.input.on("keypress", this.onKeypress), d(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u(S);
      });
    });
  }
  onKeypress(u, F) {
    if (this.state === "error" && (this.state = "active"), F?.name && (!this._track && c.aliases.has(F.name) && this.emit("cursor", c.aliases.get(F.name)), c.actions.has(F.name) && this.emit("cursor", F.name)), u && (u.toLowerCase() === "y" || u.toLowerCase() === "n") && this.emit("confirm", u.toLowerCase() === "y"), u === "\t" && this.opts.placeholder && (this.value || (this.rl?.write(this.opts.placeholder), this.emit("value", this.opts.placeholder))), u && this.emit("key", u.toLowerCase()), F?.name === "return") {
      if (this.opts.validate) {
        const e = this.opts.validate(this.value);
        e && (this.error = e instanceof Error ? e.message : e, this.state = "error", this.rl?.write(this.value));
      }
      this.state !== "error" && (this.state = "submit");
    }
    k([u, F?.name, F?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), d(this.input, false), this.rl?.close(), this.rl = undefined, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const u = G(this._prevFrame, process.stdout.columns, { hard: true }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, u * -1));
  }
  render() {
    const u = G(this._render(this) ?? "", process.stdout.columns, { hard: true });
    if (u !== this._prevFrame) {
      if (this.state === "initial")
        this.output.write(import_sisteransi.cursor.hide);
      else {
        const F = lD(this._prevFrame, u);
        if (this.restoreCursor(), F && F?.length === 1) {
          const e = F[0];
          this.output.write(import_sisteransi.cursor.move(0, e)), this.output.write(import_sisteransi.erase.lines(1));
          const s = u.split(`
`);
          this.output.write(s[e]), this._prevFrame = u, this.output.write(import_sisteransi.cursor.move(0, s.length - e - 1));
          return;
        }
        if (F && F?.length > 1) {
          const e = F[0];
          this.output.write(import_sisteransi.cursor.move(0, e)), this.output.write(import_sisteransi.erase.down());
          const s = u.split(`
`).slice(e);
          this.output.write(s.join(`
`)), this._prevFrame = u;
          return;
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(u), this.state === "initial" && (this.state = "active"), this._prevFrame = u;
    }
  }
}

class fD extends x {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(u) {
    super(u, false), this.value = !!u.initialValue, this.on("value", () => {
      this.value = this._value;
    }), this.on("confirm", (F) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = F, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
}
var yD = Object.defineProperty;
var _D = (t, u, F) => (u in t) ? yD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var Z = (t, u, F) => (_D(t, typeof u != "symbol" ? u + "" : u, F), F);

class kD extends x {
  constructor({ mask: u, ...F }) {
    super(F), Z(this, "valueWithCursor", ""), Z(this, "_mask", "\u2022"), this._mask = u ?? "\u2022", this.on("finalize", () => {
      this.valueWithCursor = this.masked;
    }), this.on("value", () => {
      if (this.cursor >= this.value.length)
        this.valueWithCursor = `${this.masked}${import_picocolors.default.inverse(import_picocolors.default.hidden("_"))}`;
      else {
        const e = this.masked.slice(0, this.cursor), s = this.masked.slice(this.cursor);
        this.valueWithCursor = `${e}${import_picocolors.default.inverse(s[0])}${s.slice(1)}`;
      }
    });
  }
  get cursor() {
    return this._cursor;
  }
  get masked() {
    return this.value.replaceAll(/./g, this._mask);
  }
}
var SD = Object.defineProperty;
var $D = (t, u, F) => (u in t) ? SD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var q = (t, u, F) => ($D(t, typeof u != "symbol" ? u + "" : u, F), F);

class jD extends x {
  constructor(u) {
    super(u, false), q(this, "options"), q(this, "cursor", 0), this.options = u.options, this.cursor = this.options.findIndex(({ value: F }) => F === u.initialValue), this.cursor === -1 && (this.cursor = 0), this.changeValue(), this.on("cursor", (F) => {
      switch (F) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
      }
      this.changeValue();
    });
  }
  get _value() {
    return this.options[this.cursor];
  }
  changeValue() {
    this.value = this._value.value;
  }
}
class PD extends x {
  get valueWithCursor() {
    if (this.state === "submit")
      return this.value;
    if (this.cursor >= this.value.length)
      return `${this.value}\u2588`;
    const u = this.value.slice(0, this.cursor), [F, ...e] = this.value.slice(this.cursor);
    return `${u}${import_picocolors.default.inverse(F)}${e.join("")}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(u) {
    super(u), this.on("finalize", () => {
      this.value || (this.value = u.defaultValue);
    });
  }
}

// node_modules/@clack/prompts/dist/index.mjs
var import_picocolors2 = __toESM(require_picocolors(), 1);
var import_sisteransi2 = __toESM(require_src(), 1);
import p from "process";
function X2() {
  return p.platform !== "win32" ? p.env.TERM !== "linux" : !!p.env.CI || !!p.env.WT_SESSION || !!p.env.TERMINUS_SUBLIME || p.env.ConEmuTask === "{cmd::Cmder}" || p.env.TERM_PROGRAM === "Terminus-Sublime" || p.env.TERM_PROGRAM === "vscode" || p.env.TERM === "xterm-256color" || p.env.TERM === "alacritty" || p.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var E = X2();
var u = (s, n) => E ? s : n;
var ee = u("\u25C6", "*");
var A2 = u("\u25A0", "x");
var B = u("\u25B2", "x");
var S2 = u("\u25C7", "o");
var te = u("\u250C", "T");
var a = u("\u2502", "|");
var m2 = u("\u2514", "\u2014");
var j2 = u("\u25CF", ">");
var R2 = u("\u25CB", " ");
var V2 = u("\u25FB", "[\u2022]");
var M2 = u("\u25FC", "[+]");
var G2 = u("\u25FB", "[ ]");
var se = u("\u25AA", "\u2022");
var N2 = u("\u2500", "-");
var re = u("\u256E", "+");
var ie = u("\u251C", "+");
var ne = u("\u256F", "+");
var ae = u("\u25CF", "\u2022");
var oe = u("\u25C6", "*");
var ce = u("\u25B2", "!");
var le = u("\u25A0", "x");
var y2 = (s) => {
  switch (s) {
    case "initial":
    case "active":
      return import_picocolors2.default.cyan(ee);
    case "cancel":
      return import_picocolors2.default.red(A2);
    case "error":
      return import_picocolors2.default.yellow(B);
    case "submit":
      return import_picocolors2.default.green(S2);
  }
};
var k2 = (s) => {
  const { cursor: n, options: t, style: i } = s, r2 = s.maxItems ?? Number.POSITIVE_INFINITY, c2 = Math.max(process.stdout.rows - 4, 0), o = Math.min(c2, Math.max(r2, 5));
  let l2 = 0;
  n >= l2 + o - 3 ? l2 = Math.max(Math.min(n - o + 3, t.length - o), 0) : n < l2 + 2 && (l2 = Math.max(n - 2, 0));
  const $2 = o < t.length && l2 > 0, d2 = o < t.length && l2 + o < t.length;
  return t.slice(l2, l2 + o).map((w2, b2, C) => {
    const I2 = b2 === 0 && $2, x2 = b2 === C.length - 1 && d2;
    return I2 || x2 ? import_picocolors2.default.dim("...") : i(w2, b2 + l2 === n);
  });
};
var ue = (s) => new PD({ validate: s.validate, placeholder: s.placeholder, defaultValue: s.defaultValue, initialValue: s.initialValue, render() {
  const n = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, t = s.placeholder ? import_picocolors2.default.inverse(s.placeholder[0]) + import_picocolors2.default.dim(s.placeholder.slice(1)) : import_picocolors2.default.inverse(import_picocolors2.default.hidden("_")), i = this.value ? this.valueWithCursor : t;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors2.default.yellow(a)}  ${i}
${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(this.value || s.placeholder)}`;
    case "cancel":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(this.value ?? ""))}${this.value?.trim() ? `
${import_picocolors2.default.gray(a)}` : ""}`;
    default:
      return `${n}${import_picocolors2.default.cyan(a)}  ${i}
${import_picocolors2.default.cyan(m2)}
`;
  }
} }).prompt();
var $e = (s) => new kD({ validate: s.validate, mask: s.mask ?? se, render() {
  const n = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, t = this.valueWithCursor, i = this.masked;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors2.default.yellow(a)}  ${i}
${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(i)}`;
    case "cancel":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(i ?? ""))}${i ? `
${import_picocolors2.default.gray(a)}` : ""}`;
    default:
      return `${n}${import_picocolors2.default.cyan(a)}  ${t}
${import_picocolors2.default.cyan(m2)}
`;
  }
} }).prompt();
var me = (s) => {
  const n = s.active ?? "Yes", t = s.inactive ?? "No";
  return new fD({ active: n, inactive: t, initialValue: s.initialValue ?? true, render() {
    const i = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, r2 = this.value ? n : t;
    switch (this.state) {
      case "submit":
        return `${i}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(r2)}`;
      case "cancel":
        return `${i}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r2))}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${i}${import_picocolors2.default.cyan(a)}  ${this.value ? `${import_picocolors2.default.green(j2)} ${n}` : `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(n)}`} ${import_picocolors2.default.dim("/")} ${this.value ? `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(t)}` : `${import_picocolors2.default.green(j2)} ${t}`}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var de = (s) => {
  const n = (t, i) => {
    const r2 = t.label ?? String(t.value);
    switch (i) {
      case "selected":
        return `${import_picocolors2.default.dim(r2)}`;
      case "active":
        return `${import_picocolors2.default.green(j2)} ${r2} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}`;
      case "cancelled":
        return `${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r2))}`;
      default:
        return `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(r2)}`;
    }
  };
  return new jD({ options: s.options, initialValue: s.initialValue, render() {
    const t = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`;
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options[this.cursor], "selected")}`;
      case "cancel":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options[this.cursor], "cancelled")}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${t}${import_picocolors2.default.cyan(a)}  ${k2({ cursor: this.cursor, options: this.options, maxItems: s.maxItems, style: (i, r2) => n(i, r2 ? "active" : "inactive") }).join(`
${import_picocolors2.default.cyan(a)}  `)}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var ye = (s = "", n = "") => {
  const t = `
${s}
`.split(`
`), i = T2(n).length, r2 = Math.max(t.reduce((o, l2) => {
    const $2 = T2(l2);
    return $2.length > o ? $2.length : o;
  }, 0), i) + 2, c2 = t.map((o) => `${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(o)}${" ".repeat(r2 - T2(o).length)}${import_picocolors2.default.gray(a)}`).join(`
`);
  process.stdout.write(`${import_picocolors2.default.gray(a)}
${import_picocolors2.default.green(S2)}  ${import_picocolors2.default.reset(n)} ${import_picocolors2.default.gray(N2.repeat(Math.max(r2 - i - 1, 1)) + re)}
${c2}
${import_picocolors2.default.gray(ie + N2.repeat(r2 + 2) + ne)}
`);
};
var ve = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(m2)}  ${import_picocolors2.default.red(s)}

`);
};
var we = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(te)}  ${s}
`);
};
var fe = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(a)}
${import_picocolors2.default.gray(m2)}  ${s}

`);
};
var v2 = { message: (s = "", { symbol: n = import_picocolors2.default.gray(a) } = {}) => {
  const t = [`${import_picocolors2.default.gray(a)}`];
  if (s) {
    const [i, ...r2] = s.split(`
`);
    t.push(`${n}  ${i}`, ...r2.map((c2) => `${import_picocolors2.default.gray(a)}  ${c2}`));
  }
  process.stdout.write(`${t.join(`
`)}
`);
}, info: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.blue(ae) });
}, success: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.green(oe) });
}, step: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.green(S2) });
}, warn: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.yellow(ce) });
}, warning: (s) => {
  v2.warn(s);
}, error: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.red(le) });
} };
var L2 = () => {
  const s = E ? ["\u25D2", "\u25D0", "\u25D3", "\u25D1"] : ["\u2022", "o", "O", "0"], n = E ? 80 : 120, t = process.env.CI === "true";
  let i, r2, c2 = false, o = "", l2;
  const $2 = (h2) => {
    const g2 = h2 > 1 ? "Something went wrong" : "Canceled";
    c2 && P2(g2, h2);
  }, d2 = () => $2(2), w2 = () => $2(1), b2 = () => {
    process.on("uncaughtExceptionMonitor", d2), process.on("unhandledRejection", d2), process.on("SIGINT", w2), process.on("SIGTERM", w2), process.on("exit", $2);
  }, C = () => {
    process.removeListener("uncaughtExceptionMonitor", d2), process.removeListener("unhandledRejection", d2), process.removeListener("SIGINT", w2), process.removeListener("SIGTERM", w2), process.removeListener("exit", $2);
  }, I2 = () => {
    if (l2 === undefined)
      return;
    t && process.stdout.write(`
`);
    const h2 = l2.split(`
`);
    process.stdout.write(import_sisteransi2.cursor.move(-999, h2.length - 1)), process.stdout.write(import_sisteransi2.erase.down(h2.length));
  }, x2 = (h2) => h2.replace(/\.+$/, ""), O2 = (h2 = "") => {
    c2 = true, i = cD(), o = x2(h2), process.stdout.write(`${import_picocolors2.default.gray(a)}
`);
    let g2 = 0, f2 = 0;
    b2(), r2 = setInterval(() => {
      if (t && o === l2)
        return;
      I2(), l2 = o;
      const W2 = import_picocolors2.default.magenta(s[g2]), _2 = t ? "..." : ".".repeat(Math.floor(f2)).slice(0, 3);
      process.stdout.write(`${W2}  ${o}${_2}`), g2 = g2 + 1 < s.length ? g2 + 1 : 0, f2 = f2 < s.length ? f2 + 0.125 : 0;
    }, n);
  }, P2 = (h2 = "", g2 = 0) => {
    c2 = false, clearInterval(r2), I2();
    const f2 = g2 === 0 ? import_picocolors2.default.green(S2) : g2 === 1 ? import_picocolors2.default.red(A2) : import_picocolors2.default.red(B);
    o = x2(h2 ?? o), process.stdout.write(`${f2}  ${o}
`), C(), i();
  };
  return { start: O2, stop: P2, message: (h2 = "") => {
    o = x2(h2 ?? o);
  } };
};
var be = async (s, n) => {
  const t = {}, i = Object.keys(s);
  for (const r2 of i) {
    const c2 = s[r2], o = await c2({ results: t })?.catch((l2) => {
      throw l2;
    });
    if (typeof n?.onCancel == "function" && BD(o)) {
      t[r2] = "canceled", n.onCancel({ results: t });
      continue;
    }
    t[r2] = o;
  }
  return t;
};

// deploy.ts
import { readFile, writeFile, mkdir, access, chmod } from "fs/promises";
import { execSync, exec as execCb } from "child_process";
import { createHash, randomBytes } from "crypto";
import { homedir } from "os";
import { join, basename, dirname } from "path";
var VERSION = "0.6.0";
var DEPLOY_SCRIPT_PATH = "/usr/local/lib/seed/deploy.js";
var DEFAULT_DATA_DIR = "/opt/seed";
var DEFAULT_SEED_DIR = dirname(process.argv[1] || "") === dirname(DEPLOY_SCRIPT_PATH) ? DEFAULT_DATA_DIR : dirname(process.argv[1] || "");
var DEFAULT_REPO_URL = "https://raw.githubusercontent.com/seed-hypermedia/seed/main";
function getOpsBaseUrl() {
  return process.env.SEED_DEPLOY_URL || (process.env.SEED_REPO_URL ? `${process.env.SEED_REPO_URL}/ops` : `${DEFAULT_REPO_URL}/ops`);
}
var OPS_BASE_URL = getOpsBaseUrl();
var DEFAULT_COMPOSE_URL = `${OPS_BASE_URL}/docker-compose.yml`;
var NOTIFY_SERVICE_HOST = "https://hyper.media/hm/api/notify";
var DEFAULT_UPSTREAM_API_URL = "https://hyper.media";
var AGENTS_API_PATH = "/hm/api/agents";
var NOTIFY_API_PATH = "/hm/api/notify";
var LIGHTNING_URL_MAINNET = "https://ln.seed.hyper.media";
var LIGHTNING_URL_TESTNET = "https://ln.testnet.seed.hyper.media";
function currentDeployUrl() {
  return getOpsBaseUrl().replace(/\/+$/, "");
}
function composeFileName(profile = "site") {
  return profile === "enterprise" ? "docker-compose.enterprise.yml" : "docker-compose.yml";
}
function currentComposeUrl(profile = "site") {
  return `${currentDeployUrl()}/${composeFileName(profile)}`;
}
function configuredDeployUrl(existing) {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL)
    return currentDeployUrl();
  if (existing?.deploy_url)
    return existing.deploy_url.replace(/\/+$/, "");
  return currentDeployUrl();
}
function configuredComposeUrl(existing, profile = "site") {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL)
    return currentComposeUrl(profile);
  if (existing?.deploy_url)
    return `${existing.deploy_url.replace(/\/+$/, "")}/${composeFileName(profile)}`;
  if (existing?.compose_url)
    return existing.compose_url;
  return currentComposeUrl(profile);
}
var GITHUB_RELEASES_API = "https://api.github.com/repos/seed-hypermedia/seed/releases/latest";
var DEV_DEPLOY_SCRIPT_URL = "https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest/deploy.js";
function getDeployScriptUrl(deployUrl) {
  if (process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL) {
    return `${getOpsBaseUrl()}/dist/deploy.js`;
  }
  if (deployUrl) {
    return `${deployUrl.replace(/\/+$/, "")}/dist/deploy.js`;
  }
  return DEV_DEPLOY_SCRIPT_URL;
}
var CURL_INSTALL_CMD = `curl -fsSL ${DEFAULT_REPO_URL}/ops/deploy.sh | sh`;
var CLI_INSTALLED = process.env.SEED_DEPLOY_CLI_INSTALLED !== "0";
function cmd(subcommand) {
  if (CLI_INSTALLED) {
    return subcommand ? `seed-deploy ${subcommand}` : "seed-deploy";
  }
  if (subcommand) {
    return `${CURL_INSTALL_CMD} -s -- ${subcommand}`;
  }
  return CURL_INSTALL_CMD;
}
function makePaths(seedDir = DEFAULT_SEED_DIR) {
  return {
    seedDir,
    configPath: join(seedDir, "config.json"),
    composePath: join(seedDir, "docker-compose.yml"),
    deployLog: join(seedDir, "deploy.log")
  };
}
var DEFAULT_EXEC_TIMEOUT_MS = 120000;
var IMAGE_PULL_TIMEOUT_MS = 8 * 60000;
function makeShellRunner() {
  return {
    run(cmd2) {
      return execSync(cmd2, { encoding: "utf-8", timeout: 30000 }).trim();
    },
    runSafe(cmd2) {
      try {
        return this.run(cmd2);
      } catch {
        return null;
      }
    },
    exec(cmd2, timeoutMs = DEFAULT_EXEC_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        execCb(cmd2, { timeout: timeoutMs }, (err, stdout, stderr) => {
          if (err) {
            const killed = err.killed;
            const detail = stderr.toString().trim() || stdout.toString().trim();
            if (killed)
              err.message = `${err.message} (killed after ${Math.round(timeoutMs / 1000)}s timeout)`;
            if (detail)
              err.message = `${err.message}
${detail}`;
            reject(err);
          } else
            resolve({
              stdout: stdout.toString().trim(),
              stderr: stderr.toString().trim()
            });
        });
      });
    }
  };
}
function checkDockerAccess(shell) {
  if (shell.runSafe("docker info >/dev/null 2>&1") === null) {
    throw new Error([
      "Cannot connect to Docker. Ensure Docker is installed and your user",
      "has permission to access the Docker socket.",
      "",
      "  Fix: sudo usermod -aG docker $USER",
      "  Then log out and back in, or run: newgrp docker"
    ].join(`
`));
  }
}
var DEPLOY_PROFILES = ["site", "enterprise"];
function redirectHostnames(config) {
  const current = extractDns(config.domain).toLowerCase();
  return [...new Set((config.redirect_hostnames ?? []).map((h2) => extractDns(h2).toLowerCase()).filter(Boolean))].filter((h2) => h2 !== current);
}
function enterpriseRedirects(domain, existing) {
  const previous = existing && extractDns(existing.domain) !== extractDns(domain) ? [extractDns(existing.domain)] : [];
  const list = redirectHostnames({ domain, redirect_hostnames: [...existing?.redirect_hostnames ?? [], ...previous] });
  return list.length ? { redirect_hostnames: list } : {};
}
function isEnterprise(config) {
  return config.profile === "enterprise";
}
function composeProfiles(config) {
  const profiles = [];
  if (isEnterprise(config) && config.notify)
    profiles.push("notify");
  if (config.agents)
    profiles.push("agents");
  if (config.metrics)
    profiles.push("metrics");
  return profiles;
}
function notifyHost(config) {
  if (!isEnterprise(config))
    return NOTIFY_SERVICE_HOST;
  return config.notify ? `https://${extractDns(config.domain)}${NOTIFY_API_PATH}` : "";
}
function agentsHost(config) {
  if (!config.agents)
    return "";
  return `https://${extractDns(config.domain)}${AGENTS_API_PATH}`;
}
function enterpriseTestnetName(domain) {
  return `ent-${extractDns(domain).replace(/[^A-Za-z0-9-]+/g, "-")}`;
}
function environmentPresets(env) {
  switch (env) {
    case "dev":
      return { testnet: true };
    case "prod":
    default:
      return { testnet: false };
  }
}
function configWarnings(config) {
  const warnings = [];
  if (isEnterprise(config)) {
    if (config.release_channel !== "latest") {
      warnings.push(`Tracking the '${config.release_channel}' image channel (bleeding-edge images). ` + `On this channel the node updates only when '${cmd("deploy")}' is run by hand; on 'latest' it follows releases automatically.`);
    }
    return warnings;
  }
  if (config.testnet) {
    warnings.push("This node is on the TESTNET (devnet) P2P network \u2014 it will NOT see or sync mainnet content. " + `If this is a production site, run '${cmd("deploy --reconfigure")}' and choose Mainnet.`);
  }
  if (!config.testnet && config.release_channel !== "latest") {
    warnings.push(`Tracking the '${config.release_channel}' image channel on mainnet (bleeding-edge images, stable network). ` + "New images here update the code only \u2014 they never change your P2P network.");
  }
  return warnings;
}
var DEFAULT_RELEASE_CHANNEL = "latest";
var CUSTOM_RELEASE_CHANNEL = "__custom__";
function isPresetReleaseChannel(channel) {
  return channel === "latest" || channel === "dev";
}
function validateDockerImageTag(tag) {
  if (!tag)
    return "Required";
  if (tag.trim() !== tag)
    return "Remove leading or trailing spaces";
  if (tag.length > 128)
    return "Must be 128 characters or fewer";
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tag)) {
    return "Use a Docker image tag: letters, numbers, _, . or -; must start with a letter, number or _";
  }
}
function validateDockerImageRef(ref) {
  if (!ref)
    return;
  if (ref.trim() !== ref)
    return "Remove leading or trailing spaces";
  if (/\s/.test(ref))
    return "Docker image refs cannot contain spaces";
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= lastSlash)
    return "Include an explicit image tag, for example ghcr.io/horacioh/seed-web:main";
  const name = ref.slice(0, lastColon);
  const tag = ref.slice(lastColon + 1);
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name) || name.includes("://")) {
    return "Use a Docker image ref such as ghcr.io/horacioh/seed-web:main";
  }
  const tagError = validateDockerImageTag(tag);
  if (tagError)
    return `Invalid image tag: ${tagError}`;
}
async function promptReleaseChannel(options) {
  const initialTag = options.initialTag ?? DEFAULT_RELEASE_CHANNEL;
  const hasCustomTag = !isPresetReleaseChannel(initialTag);
  const showCustom = options.advanced || hasCustomTag;
  const channelOptions = [
    {
      value: "latest",
      label: "Stable",
      hint: "official releases, recommended for production"
    },
    {
      value: "dev",
      label: "Bleeding edge",
      hint: "main branch builds, may be unstable"
    }
  ];
  if (showCustom) {
    channelOptions.push({
      value: CUSTOM_RELEASE_CHANNEL,
      label: "Custom tag",
      hint: "run images from a specific Docker tag or branch build"
    });
  }
  const selected = await de({
    message: "Release channel",
    initialValue: hasCustomTag ? CUSTOM_RELEASE_CHANNEL : initialTag,
    options: channelOptions
  });
  if (BD(selected) || selected !== CUSTOM_RELEASE_CHANNEL) {
    return selected;
  }
  return ue({
    message: "Custom Docker image tag",
    initialValue: hasCustomTag ? initialTag : undefined,
    placeholder: hasCustomTag ? initialTag : "feature-branch",
    validate: validateDockerImageTag
  });
}
async function configExists(paths) {
  try {
    await access(paths.configPath);
    return true;
  } catch {
    return false;
  }
}
async function readConfig(paths) {
  const raw = await readFile(paths.configPath, "utf-8");
  return JSON.parse(raw);
}
async function writeConfig(config, paths) {
  await mkdir(paths.seedDir, { recursive: true });
  await writeFile(paths.configPath, JSON.stringify(config, null, 2) + `
`, "utf-8");
}
function generateSecret(length = 10) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return Array.from(bytes).map((b2) => chars[b2 % chars.length]).join("");
}
function log(msg) {
  const ts = new Date().toISOString();
  if (!process.stdout.isTTY) {
    console.log(`[${ts}] ${msg}`);
  }
}
var RESUME_HINT = `
Run '${cmd()}' to resume installation at any time.
`;
var MANAGE_HINT = `Manage your node anytime with '${cmd()}'. Run '${cmd("--help")}' for options.`;
function inferEnvironment(old) {
  return old.testnet ? "dev" : "prod";
}
function parseDaemonEnv(envJson) {
  let logLevel = null;
  let testnet = false;
  try {
    const envs = JSON.parse(envJson);
    for (const e2 of envs) {
      if (e2.startsWith("SEED_LOG_LEVEL="))
        logLevel = e2.split("=")[1];
      if (e2.startsWith("SEED_P2P_TESTNET_NAME=") && e2.split("=")[1])
        testnet = true;
    }
  } catch {}
  return { logLevel, testnet };
}
function parseWebEnv(envJson) {
  let hostname = null;
  let gateway = false;
  let trafficStats = false;
  try {
    const envs = JSON.parse(envJson);
    for (const e2 of envs) {
      if (e2.startsWith("SEED_BASE_URL="))
        hostname = e2.split("=")[1];
      if (e2.startsWith("SEED_IS_GATEWAY=true"))
        gateway = true;
      if (e2.startsWith("SEED_ENABLE_STATISTICS=true"))
        trafficStats = true;
    }
  } catch {}
  return { hostname, gateway, trafficStats };
}
function parseImageTag(imageStr) {
  const parts = imageStr.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "latest";
}
async function detectOldInstall(shell) {
  const home = homedir();
  const candidates = [join(home, ".seed-site"), "/shm/gateway", "/shm"];
  let workspace = null;
  for (const dir of candidates) {
    try {
      await access(dir);
      workspace = dir;
      break;
    } catch {}
  }
  const hasContainers = shell.runSafe("docker ps --format '{{.Names}}' 2>/dev/null | grep -q seed");
  if (!workspace && hasContainers === null) {
    return null;
  }
  if (!workspace) {
    workspace = join(home, ".seed-site");
  }
  let secret = null;
  let secretConsumed = false;
  const secretPaths = [
    join(workspace, "web", "config.json"),
    "/shm/gateway/web/config.json",
    join(home, ".seed-site", "web", "config.json")
  ];
  for (const sp of secretPaths) {
    try {
      const raw = await readFile(sp, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.availableRegistrationSecret) {
        secret = parsed.availableRegistrationSecret;
        break;
      }
      if (parsed.registeredAccountUid || parsed.sourcePeerId) {
        secretConsumed = true;
      }
    } catch {}
  }
  let hostname = null;
  let logLevel = null;
  let imageTag = null;
  let testnet = false;
  let gateway = false;
  let trafficStats = false;
  const daemonEnv = shell.runSafe("docker inspect seed-daemon --format '{{json .Config.Env}}' 2>/dev/null");
  if (daemonEnv) {
    const parsed = parseDaemonEnv(daemonEnv);
    logLevel = parsed.logLevel;
    testnet = parsed.testnet;
  }
  const webEnv = shell.runSafe("docker inspect seed-web --format '{{json .Config.Env}}' 2>/dev/null");
  if (webEnv) {
    const parsed = parseWebEnv(webEnv);
    hostname = parsed.hostname;
    gateway = parsed.gateway;
    trafficStats = parsed.trafficStats;
  }
  const webImage = shell.runSafe("docker inspect seed-web --format '{{.Config.Image}}' 2>/dev/null");
  if (webImage) {
    imageTag = parseImageTag(webImage);
  }
  return {
    workspace,
    secret,
    secretConsumed,
    hostname,
    logLevel,
    imageTag,
    testnet,
    gateway,
    trafficStats
  };
}
var SEED_PUBLISHED_PORTS = [80, 443, 3000, 56000];
var LEGACY_AUTOUPDATER_IMAGES = ["containrrr/watchtower", "v2tec/watchtower"];
var LEGACY_CONTAINER_NAMES = [
  "seed-site",
  "seed-daemon",
  "seed-web",
  "seed-proxy",
  "seed-vault",
  "seed-notify",
  "seed-agents",
  "autoupdater",
  "prometheus",
  "grafana"
];
function composeProjectName(paths) {
  return basename(paths.seedDir).toLowerCase();
}
function removeLegacyAutoupdaters(shell) {
  const filters = LEGACY_AUTOUPDATER_IMAGES.map((img) => `--filter "ancestor=${img}"`).join(" ");
  const out = shell.runSafe(`docker ps -aq ${filters} 2>/dev/null`);
  if (!out)
    return [];
  const ids = out.split(`
`).filter(Boolean);
  for (const id of ids) {
    shell.runSafe(`docker rm -f ${id} 2>/dev/null`);
  }
  if (ids.length > 0) {
    log(`Removed ${ids.length} legacy autoupdater container(s).`);
  }
  return ids;
}
function freeConflictingPortBindings(shell, projectName) {
  const portFilters = SEED_PUBLISHED_PORTS.map((p2) => `--filter "publish=${p2}"`).join(" ");
  const portOut = shell.runSafe(`docker ps -aq ${portFilters} 2>/dev/null`) ?? "";
  const nameFilters = LEGACY_CONTAINER_NAMES.map((n) => `--filter "name=^${n}$"`).join(" ");
  const nameOut = shell.runSafe(`docker ps -aq ${nameFilters} 2>/dev/null`) ?? "";
  const allIds = Array.from(new Set([...portOut.split(`
`).filter(Boolean), ...nameOut.split(`
`).filter(Boolean)]));
  const removed = [];
  for (const id of allIds) {
    const proj = shell.runSafe(`docker inspect ${id} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`);
    if (proj === projectName)
      continue;
    shell.runSafe(`docker rm -f ${id} 2>/dev/null`);
    removed.push(id);
  }
  if (removed.length > 0) {
    log(`Removed ${removed.length} legacy/orphan container(s) holding our published ports or names.`);
  }
  return removed;
}
function removeLegacyHostCronLines(existing) {
  const filtered = existing.split(`
`).filter((line) => !line.includes("website_deployment.sh") && !line.includes("# website-deploy")).join(`
`).trim();
  return filtered ? filtered + `
` : "";
}
function removeLegacyHostCron(shell) {
  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  if (!existing.includes("website_deployment.sh") && !existing.includes("# website-deploy")) {
    return false;
  }
  const cleaned = removeLegacyHostCronLines(existing);
  try {
    shell.run(`echo '${cleaned}' | crontab -`);
    log("Removed legacy website_deployment.sh cron entries.");
    return true;
  } catch (err) {
    log(`Warning: failed to remove legacy cron entries: ${err}`);
    return false;
  }
}
function describeBindFailure(errMsg) {
  const match = errMsg.match(/Bind for 0\.0\.0\.0:(\d+) failed/);
  if (!match)
    return null;
  const port = match[1];
  return [
    `Port ${port} is held by a non-Docker process.`,
    `Likely a leftover seed-daemon binary or systemd unit from an old installation.`,
    `Run \`ss -lntup '( sport = :${port} )'\` to identify it,`,
    `then stop it and re-run \`${cmd("deploy")}\`.`
  ].join(" ");
}
function describePullFailure(errMsg, releaseChannel) {
  const isPullFailure = /manifest\s+(?:for\s+\S+\s+)?(?:unknown|not found)/i.test(errMsg) || /not found:\s*manifest/i.test(errMsg) || /repository .* not found|pull access denied|requested access to the resource is denied/i.test(errMsg) || /Error response from daemon:.*(no such image|manifest)/i.test(errMsg);
  if (!isPullFailure)
    return null;
  return [
    `Could not pull the '${releaseChannel}' images from the registry.`,
    `Both seedhypermedia/web:${releaseChannel} and seedhypermedia/site:${releaseChannel} must exist and be public.`,
    `Check the tag is correct (and that a build was pushed for it), or run \`${cmd("deploy --reconfigure")}\``,
    `and pick the Stable channel.`
  ].join(" ");
}
async function migrateDataFromOldInstall(paths, shell) {
  const oldInstall = await detectOldInstall(shell);
  if (!oldInstall || oldInstall.workspace === paths.seedDir)
    return;
  removeLegacyHostCron(shell);
  removeLegacyAutoupdaters(shell);
  const daemonDir = join(paths.seedDir, "daemon");
  const daemonEmpty = shell.runSafe(`find "${daemonDir}" -mindepth 1 -maxdepth 1 2>/dev/null | head -1`) === "";
  if (!daemonEmpty)
    return;
  log("Stopping old containers before migrating data...");
  freeConflictingPortBindings(shell, composeProjectName(paths));
  log(`Copying ${oldInstall.workspace} \u2192 ${paths.seedDir} ...`);
  if (!shell.runSafe(`cp -a "${oldInstall.workspace}/." "${paths.seedDir}/" 2>/dev/null`)) {
    shell.run(`sudo cp -a "${oldInstall.workspace}/." "${paths.seedDir}/"`);
  }
  log("Migrated all data from old installation.");
  const webDir = join(paths.seedDir, "web");
  const currentUid = String(process.getuid());
  const currentGid = String(process.getgid());
  const owner = shell.runSafe(`stat -c '%u:%g' "${webDir}" 2>/dev/null`);
  if (owner && owner !== `${currentUid}:${currentGid}`) {
    log(`Updating ownership of ${webDir} from ${owner} to ${currentUid}:${currentGid}`);
    if (!shell.runSafe(`chown -R ${currentUid}:${currentGid} "${webDir}" 2>/dev/null`)) {
      shell.runSafe(`sudo chown -R ${currentUid}:${currentGid} "${webDir}"`);
    }
  }
}
async function runMigrationWizard(old, paths, shell, advanced = false) {
  we(`Seed Node Migration v${VERSION}`);
  ye([
    `Detected an existing Seed installation at: ${old.workspace}`,
    "",
    "We'll import your current settings and migrate to the new deployment system.",
    `After migration, your node will be managed from ${paths.seedDir}/ and updated via cron.`,
    "",
    "Please review and confirm the detected values below."
  ].join(`
`), "Existing installation found");
  const answers = await be({
    domain: () => ue({
      message: "Public hostname (including https://)",
      placeholder: old.hostname || "https://node1.seed.run",
      validate: (v3) => {
        if (!v3)
          return "Required";
        if (!v3.startsWith("https://") && !v3.startsWith("http://"))
          return "Must start with https:// or http://";
      }
    }),
    network: () => de({
      message: "P2P network",
      initialValue: inferEnvironment(old) === "dev" ? "testnet" : "mainnet",
      options: [
        {
          value: "mainnet",
          label: "Mainnet",
          hint: "the public Seed network \u2014 recommended for production"
        },
        {
          value: "testnet",
          label: "Testnet (devnet)",
          hint: "isolated development network; will NOT see mainnet content"
        }
      ]
    }),
    release_channel: () => promptReleaseChannel({
      initialTag: old.imageTag,
      advanced
    }),
    web_image: () => ue({
      message: "Full web image ref (optional)",
      placeholder: "ghcr.io/horacioh/seed-web:main",
      validate: validateDockerImageRef
    }),
    site_image: () => ue({
      message: "Full site/daemon image ref (optional)",
      placeholder: "ghcr.io/horacioh/seed-site:main",
      validate: validateDockerImageRef
    }),
    log_level: () => de({
      message: "Log level",
      initialValue: old.logLevel ?? "info",
      options: [
        {
          value: "debug",
          label: "Debug",
          hint: "verbose, useful for troubleshooting"
        },
        {
          value: "info",
          label: "Info",
          hint: "standard operational logging"
        },
        { value: "warn", label: "Warn", hint: "only warnings and errors" },
        { value: "error", label: "Error", hint: "only errors" }
      ]
    }),
    gateway: () => me({
      message: "Run as public gateway?",
      initialValue: old.gateway
    }),
    email: () => ue({
      message: "Contact email (optional) \u2014 lets us notify you about security updates. Not shared publicly.",
      placeholder: "you@example.com",
      validate: (v3) => {
        if (v3 && !v3.includes("@"))
          return "Must be a valid email";
      }
    })
  }, {
    onCancel: () => {
      ve("Migration cancelled.");
      console.log(RESUME_HINT);
      process.exit(0);
    }
  });
  const secret = old.secret ?? generateSecret();
  if (old.secret) {
    v2.success(`Registration secret imported from existing installation.`);
  } else if (old.secretConsumed) {
    v2.info(`Node is already registered (secret was consumed). Generated a new secret for future registrations.`);
  } else {
    v2.warn(`No existing registration secret found. Generated a new one.`);
  }
  const testnet = answers.network === "testnet";
  const env = testnet ? "dev" : "prod";
  const config = {
    domain: answers.domain,
    email: answers.email || "",
    deploy_url: currentDeployUrl(),
    compose_url: currentComposeUrl(),
    compose_sha: "",
    compose_env_sha: "",
    compose_envs: {
      LOG_LEVEL: answers.log_level
    },
    environment: env,
    release_channel: answers.release_channel,
    web_image: answers.web_image || undefined,
    site_image: answers.site_image || undefined,
    testnet,
    link_secret: secret,
    analytics: old.trafficStats,
    gateway: answers.gateway,
    last_script_run: ""
  };
  const summary = Object.entries(config).filter(([k3]) => k3 !== "analytics").map(([k3, v3]) => `  ${k3}: ${typeof v3 === "object" ? JSON.stringify(v3) : v3}`).join(`
`);
  ye(summary, "Configuration summary");
  const confirmed = await me({
    message: "Write config and proceed with deployment?"
  });
  if (BD(confirmed) || !confirmed) {
    ve("Migration cancelled.");
    console.log(RESUME_HINT);
    process.exit(0);
  }
  await writeConfig(config, paths);
  v2.success(`Config written to ${paths.configPath}`);
  return config;
}
async function runFreshWizard(paths, existing, advanced = false) {
  const isReconfig = !!existing;
  we(isReconfig ? `Seed Node Reconfiguration v${VERSION}` : `Seed Node Setup v${VERSION}`);
  if (!isReconfig) {
    ye([
      "Welcome! This wizard will configure your new Seed node.",
      "",
      "Seed is a peer-to-peer hypermedia publishing system. This script sets up",
      "the Docker containers, reverse proxy, and networking so your node is",
      "reachable on the public internet.",
      "",
      `This node's install location is ${paths.seedDir}/ (config + data live here).`,
      "Subsequent runs of this script will deploy automatically (headless mode)."
    ].join(`
`), "First-time setup");
  } else {
    ye([
      "Editing your current configuration. Each prompt shows the current value \u2014 press Enter to keep it. Grey suggestions fill in with Tab.",
      "",
      `Configuration: ${paths.configPath}`
    ].join(`
`), "Reconfiguration");
  }
  const answers = await be({
    domain: () => ue({
      message: "Public hostname (including https://)",
      placeholder: existing?.domain || "https://node1.seed.run",
      validate: (v3) => {
        if (!v3)
          return "Required";
        if (!v3.startsWith("https://") && !v3.startsWith("http://"))
          return "Must start with https:// or http://";
      }
    }),
    network: () => de({
      message: "P2P network",
      initialValue: existing?.testnet ? "testnet" : "mainnet",
      options: [
        {
          value: "mainnet",
          label: "Mainnet",
          hint: "the public Seed network \u2014 recommended for production"
        },
        {
          value: "testnet",
          label: "Testnet (devnet)",
          hint: "isolated development network; will NOT see mainnet content"
        }
      ]
    }),
    release_channel: () => promptReleaseChannel({
      initialTag: existing?.release_channel,
      advanced
    }),
    web_image: () => ue({
      message: "Full web image ref (optional)",
      initialValue: existing?.web_image,
      placeholder: "ghcr.io/horacioh/seed-web:main",
      validate: validateDockerImageRef
    }),
    site_image: () => ue({
      message: "Full site/daemon image ref (optional)",
      initialValue: existing?.site_image,
      placeholder: "ghcr.io/horacioh/seed-site:main",
      validate: validateDockerImageRef
    }),
    log_level: () => de({
      message: "Log level for Seed services",
      initialValue: existing?.compose_envs?.LOG_LEVEL ?? "info",
      options: [
        {
          value: "debug",
          label: "Debug",
          hint: "very verbose, useful for troubleshooting"
        },
        {
          value: "info",
          label: "Info",
          hint: "standard operational logging \u2014 recommended"
        },
        { value: "warn", label: "Warn", hint: "only warnings and errors" },
        { value: "error", label: "Error", hint: "only critical errors" }
      ]
    }),
    gateway: () => me({
      message: "Run as a public gateway? (serves all known public content)",
      initialValue: existing?.gateway ?? false
    }),
    agents: () => me({
      message: "Run the agents service? (served at <your domain>/hm/api/agents; calls model providers)",
      initialValue: existing?.agents ?? false
    }),
    email: () => ue({
      message: "Contact email (optional) \u2014 lets us notify you about security updates. Not shared publicly.",
      placeholder: existing ? existing.email || undefined : "you@example.com",
      validate: (v3) => {
        if (v3 && !v3.includes("@"))
          return "Must be a valid email";
      }
    })
  }, {
    onCancel: () => {
      ve(isReconfig ? "Reconfiguration cancelled." : "Setup cancelled.");
      console.log(RESUME_HINT);
      process.exit(0);
    }
  });
  const secret = existing?.link_secret ?? generateSecret();
  const testnet = answers.network === "testnet";
  const env = testnet ? "dev" : "prod";
  const config = {
    domain: answers.domain,
    email: answers.email || "",
    deploy_url: configuredDeployUrl(existing),
    compose_url: configuredComposeUrl(existing),
    compose_sha: existing?.compose_sha ?? "",
    compose_env_sha: existing?.compose_env_sha ?? "",
    compose_envs: {
      LOG_LEVEL: answers.log_level
    },
    environment: env,
    release_channel: answers.release_channel,
    web_image: answers.web_image || undefined,
    site_image: answers.site_image || undefined,
    testnet,
    link_secret: secret,
    analytics: existing?.analytics ?? false,
    gateway: answers.gateway,
    agents: answers.agents,
    agents_kvm: answers.agents ? existing?.agents_kvm ?? false : false,
    last_script_run: existing?.last_script_run ?? ""
  };
  const userFields = [
    ["domain", config.domain],
    ["email", config.email],
    ["network", config.testnet ? "testnet (devnet)" : "mainnet"],
    ["release_channel", config.release_channel],
    ["web_image", config.web_image || "(default)"],
    ["site_image", config.site_image || "(default)"],
    ["log_level", config.compose_envs.LOG_LEVEL],
    ["gateway", String(config.gateway)],
    ["agents", String(config.agents)]
  ];
  const oldFields = existing ? {
    domain: existing.domain,
    email: existing.email,
    network: existing.testnet ? "testnet (devnet)" : "mainnet",
    release_channel: existing.release_channel,
    web_image: existing.web_image || "(default)",
    site_image: existing.site_image || "(default)",
    log_level: existing.compose_envs?.LOG_LEVEL ?? "info",
    gateway: String(existing.gateway),
    agents: String(existing.agents ?? false)
  } : undefined;
  const summary = userFields.map(([k3, v3]) => {
    if (oldFields && String(v3) !== String(oldFields[k3] ?? "")) {
      return `  \u270E ${k3}: ${v3}`;
    }
    return `    ${k3}: ${v3}`;
  }).join(`
`);
  ye(summary, "Configuration summary");
  const confirmed = await me({
    message: isReconfig ? "Save changes and redeploy?" : "Write config and proceed with deployment?"
  });
  if (BD(confirmed) || !confirmed) {
    ve(isReconfig ? "Reconfiguration cancelled." : "Setup cancelled.");
    console.log(RESUME_HINT);
    process.exit(0);
  }
  await writeConfig(config, paths);
  v2.success(`Config written to ${paths.configPath}`);
  return config;
}
var VAULT_ADMIN_SECRET_LENGTH = 40;
var SESSION_SECRET_LENGTH = 64;
function bootstrapOptionsFrom(opts, env = process.env) {
  return {
    siteName: opts.siteName || undefined,
    ownerPassword: opts.ownerPassword || env.SEED_OWNER_PASSWORD || undefined
  };
}
function smtpFromEnv(env = process.env) {
  if (!env.SEED_SMTP_HOST)
    return;
  return {
    host: env.SEED_SMTP_HOST,
    port: env.SEED_SMTP_PORT && /^\d+$/.test(env.SEED_SMTP_PORT) ? Number(env.SEED_SMTP_PORT) : undefined,
    user: env.SEED_SMTP_USER ?? "",
    password: env.SEED_SMTP_PASSWORD ?? "",
    sender: env.SEED_SMTP_SENDER ?? ""
  };
}
function emailRelayFromEnv(env = process.env) {
  if (!env.SEED_EMAIL_RELAY_URL)
    return;
  return { url: env.SEED_EMAIL_RELAY_URL, token: env.SEED_EMAIL_RELAY_TOKEN ?? "" };
}
function emailRelayOf(config) {
  if (!config?.email_relay_url)
    return;
  return { url: config.email_relay_url, token: config.email_relay_token ?? "" };
}
function headlessEnterpriseConfig(opts, existing, env = process.env) {
  const domain = opts.hostname ?? existing?.domain;
  if (!domain)
    throw new Error("--hostname https://\u2026 is required for a non-interactive enterprise install");
  const urlError = validateUrl(domain);
  if (urlError)
    throw new Error(`--hostname: ${urlError}`);
  const tag = opts.tag ?? existing?.release_channel ?? DEFAULT_RELEASE_CHANNEL;
  const tagError = validateDockerImageTag(tag);
  if (tagError)
    throw new Error(`--tag: ${tagError}`);
  const logLevel = opts.logLevel ?? existing?.compose_envs.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error(`--log-level must be one of debug, info, warn, error (got '${logLevel}')`);
  }
  const notify = opts.notify ?? existing?.notify ?? false;
  const smtp = smtpFromEnv(env) ?? existing?.smtp;
  const relay = opts.emailRelayUrl ? { url: opts.emailRelayUrl, token: opts.emailRelayToken ?? env.SEED_EMAIL_RELAY_TOKEN ?? "" } : emailRelayFromEnv(env) ?? emailRelayOf(existing);
  if (relay) {
    const urlError2 = validateUrl(relay.url);
    if (urlError2)
      throw new Error(`--email-relay-url: ${urlError2}`);
    if (!relay.token) {
      throw new Error("--email-relay-url needs --email-relay-token (or SEED_EMAIL_RELAY_TOKEN in the environment)");
    }
  }
  if (notify && !smtp && !relay) {
    throw new Error("--notify needs SEED_SMTP_HOST, SEED_SMTP_USER, SEED_SMTP_PASSWORD and SEED_SMTP_SENDER in the environment, " + "or the email relay (--email-relay-url and --email-relay-token, or SEED_EMAIL_RELAY_URL and SEED_EMAIL_RELAY_TOKEN)");
  }
  return buildEnterpriseConfig({
    domain,
    release_channel: tag,
    web_image: existing?.web_image,
    site_image: existing?.site_image,
    log_level: logLevel,
    agents: opts.agents ?? existing?.agents ?? false,
    notify,
    smtp,
    email_relay: relay ?? null,
    email: opts.email ?? existing?.email ?? "",
    site_name: opts.siteName
  }, existing);
}
function validateUrl(v3) {
  if (!v3)
    return "Required";
  if (!v3.startsWith("https://") && !v3.startsWith("http://"))
    return "Must start with https:// or http://";
}
function buildEnterpriseConfig(answers, existing) {
  const relay = answers.email_relay === undefined ? emailRelayOf(existing) : answers.email_relay ?? undefined;
  return {
    profile: "enterprise",
    domain: answers.domain,
    email: answers.email || "",
    deploy_url: configuredDeployUrl(existing),
    compose_url: configuredComposeUrl(existing, "enterprise"),
    compose_sha: existing?.compose_sha ?? "",
    compose_env_sha: existing?.compose_env_sha ?? "",
    compose_envs: { LOG_LEVEL: answers.log_level },
    environment: "prod",
    release_channel: answers.release_channel,
    web_image: answers.web_image || undefined,
    site_image: answers.site_image || undefined,
    testnet: false,
    gateway: false,
    analytics: false,
    link_secret: existing?.link_secret ?? generateSecret(),
    vault_admin_secret: existing?.vault_admin_secret ?? generateSecret(VAULT_ADMIN_SECRET_LENGTH),
    session_secret: existing?.session_secret ?? generateSecret(SESSION_SECRET_LENGTH),
    service_secret: existing?.service_secret ?? generateSecret(SESSION_SECRET_LENGTH),
    notify: answers.notify,
    smtp: answers.notify ? answers.smtp : existing?.smtp ?? undefined,
    email_relay_url: relay?.url || undefined,
    email_relay_token: relay?.url ? relay.token : undefined,
    agents: answers.agents,
    agents_kvm: answers.agents ? answers.agents_kvm ?? existing?.agents_kvm ?? false : false,
    metrics: existing?.metrics ?? false,
    site_name: answers.site_name?.trim() || existing?.site_name || extractDns(answers.domain),
    owner_account_uid: existing?.owner_account_uid,
    ...enterpriseRedirects(answers.domain, existing),
    last_script_run: existing?.last_script_run ?? ""
  };
}
function describeNotify(config) {
  if (!config.notify)
    return "false";
  if (config.email_relay_url)
    return `yes (email relay ${config.email_relay_url})`;
  return `yes (${config.smtp?.host}, sender ${config.smtp?.sender})`;
}
async function runEnterpriseWizard(paths, existing, advanced = false, bootstrap) {
  const isReconfig = !!existing;
  we(isReconfig ? `Seed Enterprise Reconfiguration v${VERSION}` : `Seed Enterprise Setup v${VERSION}`);
  if (!isReconfig) {
    ye([
      "This wizard configures a private, single-tenant Seed stack:",
      "web app, daemon (no peer-to-peer connectivity), identity vault (invite-only),",
      "and optionally email notifications and agents. Every page requires sign-in.",
      "",
      `This node's install location is ${paths.seedDir}/ (config + data live here).`,
      `Updates are manual: run '${cmd("deploy")}' when you want to update.`
    ].join(`
`), "Enterprise Edition");
  } else {
    ye([
      "Editing your current configuration. Each prompt shows the current value \u2014 press Enter to keep it.",
      "",
      `Configuration: ${paths.configPath}`
    ].join(`
`), "Reconfiguration");
  }
  const onCancel = () => {
    ve(isReconfig ? "Reconfiguration cancelled." : "Setup cancelled.");
    console.log(RESUME_HINT);
    process.exit(0);
  };
  const relayUrlOf = (results) => advanced ? (results.email_relay_url ?? "").trim() : existing?.email_relay_url ?? "";
  const answers = await be({
    domain: () => ue({
      message: "Public hostname (including https://)",
      placeholder: existing?.domain || "https://seed.example.org",
      validate: validateUrl
    }),
    site_name: ({ results }) => ue({
      message: "Name of the organization's space (shown as the site's title)",
      initialValue: existing?.site_name,
      placeholder: extractDns(results.domain || "seed.example.org")
    }),
    owner_password: () => isReconfig || bootstrap?.ownerPassword ? Promise.resolve(undefined) : $e({
      message: "Password for the space's owner key file (optional; Enter for none)"
    }),
    release_channel: () => promptReleaseChannel({
      initialTag: existing?.release_channel,
      advanced
    }),
    log_level: () => de({
      message: "Log level for Seed services",
      initialValue: existing?.compose_envs?.LOG_LEVEL ?? "info",
      options: [
        { value: "debug", label: "Debug", hint: "very verbose, useful for troubleshooting" },
        { value: "info", label: "Info", hint: "standard operational logging \u2014 recommended" },
        { value: "warn", label: "Warn", hint: "only warnings and errors" },
        { value: "error", label: "Error", hint: "only critical errors" }
      ]
    }),
    agents: () => me({
      message: "Run the agents service? (served at <your domain>/hm/api/agents, members only; calls model providers)",
      initialValue: existing?.agents ?? false
    }),
    email_relay_url: () => advanced ? ue({
      message: "Email relay URL from Seed hosting (optional; empty means SMTP, or no email)",
      initialValue: existing?.email_relay_url,
      placeholder: "https://host.seed.hyper.media/api/email-relay",
      validate: (v3) => v3 ? validateUrl(v3) : undefined
    }) : Promise.resolve(undefined),
    email_relay_token: ({ results }) => advanced && results.email_relay_url ? $e({
      message: existing?.email_relay_token ? "Email relay token (leave empty to keep the current one)" : "Email relay token",
      validate: (v3) => v3 || existing?.email_relay_token ? undefined : "Required"
    }) : Promise.resolve(undefined),
    notify: ({ results }) => me({
      message: relayUrlOf(results) ? "Run the notify service for email notifications? (sends through the email relay)" : "Run the notify service for email notifications? (needs an SMTP account)",
      initialValue: existing?.notify ?? false
    }),
    smtp_host: ({ results }) => results.notify && !relayUrlOf(results) ? ue({
      message: "SMTP host",
      initialValue: existing?.smtp?.host,
      placeholder: "smtp.example.org",
      validate: (v3) => v3 ? undefined : "Required"
    }) : Promise.resolve(undefined),
    smtp_user: ({ results }) => results.notify && !relayUrlOf(results) ? ue({
      message: "SMTP user",
      initialValue: existing?.smtp?.user,
      validate: (v3) => v3 ? undefined : "Required"
    }) : Promise.resolve(undefined),
    smtp_password: ({ results }) => results.notify && !relayUrlOf(results) ? $e({
      message: existing?.smtp?.password ? "SMTP password (leave empty to keep the current one)" : "SMTP password",
      validate: (v3) => v3 || existing?.smtp?.password ? undefined : "Required"
    }) : Promise.resolve(undefined),
    smtp_sender: ({ results }) => results.notify && !relayUrlOf(results) ? ue({
      message: "Sender address for emails",
      initialValue: existing?.smtp?.sender,
      placeholder: "Seed <seed@example.org>",
      validate: (v3) => v3 && v3.includes("@") ? undefined : "Must contain an email address"
    }) : Promise.resolve(undefined),
    email: () => ue({
      message: "Contact email (optional) \u2014 lets us notify you about security updates. Not shared publicly.",
      placeholder: existing ? existing.email || undefined : "you@example.com",
      validate: (v3) => {
        if (v3 && !v3.includes("@"))
          return "Must be a valid email";
      }
    })
  }, { onCancel });
  const notify = answers.notify;
  const relayUrl = relayUrlOf(answers);
  const email_relay = !advanced ? undefined : relayUrl ? { url: relayUrl, token: answers.email_relay_token || existing?.email_relay_token || "" } : null;
  const smtp = notify && !relayUrl ? {
    host: answers.smtp_host,
    port: existing?.smtp?.port,
    user: answers.smtp_user,
    password: answers.smtp_password || existing?.smtp?.password || "",
    sender: answers.smtp_sender
  } : existing?.smtp;
  const config = buildEnterpriseConfig({
    domain: answers.domain,
    release_channel: answers.release_channel,
    web_image: existing?.web_image,
    site_image: existing?.site_image,
    log_level: answers.log_level,
    agents: answers.agents,
    notify,
    smtp,
    email_relay,
    email: answers.email || "",
    site_name: answers.site_name
  }, existing);
  if (bootstrap && typeof answers.owner_password === "string" && answers.owner_password) {
    bootstrap.ownerPassword = answers.owner_password;
  }
  const userFields = [
    ["domain", config.domain],
    ["site_name", config.site_name ?? ""],
    ["release_channel", config.release_channel],
    ["log_level", config.compose_envs.LOG_LEVEL],
    ["agents", String(config.agents)],
    ["notify", describeNotify(config)],
    ["email", config.email]
  ];
  const summary = userFields.map(([k3, v3]) => `    ${k3}: ${v3}`).join(`
`);
  ye(summary, "Configuration summary");
  const confirmed = await me({
    message: isReconfig ? "Save changes and redeploy?" : "Write config and proceed with deployment?"
  });
  if (BD(confirmed) || !confirmed)
    onCancel();
  await writeConfig(config, paths);
  v2.success(`Config written to ${paths.configPath}`);
  return config;
}
function extractDns(domain) {
  return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
var ENTERPRISE_OPEN_PATHS = [
  "/hm/sign-in*",
  "/hm/auth/callback*",
  "/hm/api/config",
  "/hm/api/site-url",
  "/hm/api/auth",
  "/hm/api/auth/*",
  "/hm/api/session",
  "/hm/api/version",
  "/hm/api/register",
  "/hm/register*",
  "/hm/create-site*",
  "/hm/email-notifications*",
  "/healthz",
  "/assets/*",
  "/build/*",
  "/favicon*",
  "/robots.txt",
  "/.well-known/*",
  "/__manifest*"
];
var SESSION_CHECK_URI = "/hm/api/session";
var ENTERPRISE_MAX_BODY = "512MB";
var NOTIFY_PROXY_PATHS = [
  NOTIFY_API_PATH,
  `${NOTIFY_API_PATH}/*`,
  "/hm/api/notifications",
  "/hm/api/notification-config",
  "/hm/api/notification-inbox",
  "/hm/api/notification-read-state",
  "/hm/api/public-subscribe",
  "/hm/api/public-subscribe/*",
  "/hm/api/email-notif-token",
  "/hm/api/unsubscribe"
];
function notifyOpenBlock(config) {
  if (!config.notify)
    return "";
  return `	@notify path ${NOTIFY_PROXY_PATHS.join(" ")}
	handle @notify {
		reverse_proxy seed-notify:3000
	}
`;
}
function agentsWebhookBlock(config) {
  if (!config.agents)
    return "";
  return `	@agents_webhook {
		method POST
		path ${AGENTS_API_PATH}/webhooks/*
	}
	handle @agents_webhook {
		reverse_proxy seed-agents:3050
	}
`;
}
function agentsGatedBlock(config) {
  if (!config.agents)
    return "";
  return `
	@agents path ${AGENTS_API_PATH} ${AGENTS_API_PATH}/*
	handle @agents {
		import gate
		reverse_proxy seed-agents:3050
	}
`;
}
function generateEnterpriseCaddyfile(config) {
  const dns = extractDns(config.domain);
  const blocks = [];
  blocks.push(`# Ask the web app whether the request carries a member session.
(gate) {
	forward_auth seed-web:3000 {
		# The trailing "?" drops the original query string from the subrequest:
		# Remix treats "?_data=<route>" (a client-side navigation) as a data
		# request for that route, which does not match the session route and
		# fails with 403. The original URI still travels in X-Forwarded-Uri.
		uri ${SESSION_CHECK_URI}?
		copy_headers X-Forwarded-Uri
	}
}

${dns} {
	encode zstd gzip

	request_body {
		max_size ${ENTERPRISE_MAX_BODY}
	}

	# The vault serves itself under /vault; do not strip the prefix.
	@vault path /vault /vault/*
	handle @vault {
		reverse_proxy seed-vault:3000
	}

	# The vault UI uploads profile blobs to the daemon before any session exists.
	@ipfs_upload {
		method POST
		path /ipfs/*
	}
	handle @ipfs_upload {
		reverse_proxy seed-daemon:56001
	}

	# The sign-in callback stores delegation blobs and looks the account up;
	# the deploy script creates the organization's space on the first deploy
	# and republishes its address after a hostname change.
	@open_api_post {
		method POST
		path /api/PublishBlobs /hm/api/enterprise-bootstrap /hm/api/enterprise-site-url
	}
	@open_api_get {
		method GET HEAD
		path /api/Account
	}
	@open path ${ENTERPRISE_OPEN_PATHS.join(" ")}
${notifyOpenBlock(config)}${agentsWebhookBlock(config)}	handle @open_api_post {
		reverse_proxy seed-web:3000
	}
	handle @open_api_get {
		reverse_proxy seed-web:3000
	}
	handle @open {
		reverse_proxy seed-web:3000
	}

	# Everything below requires a session.
	@ipfs path /ipfs/*
	handle @ipfs {
		import gate
		reverse_proxy seed-daemon:56001
	}

	@metrics path /.metrics*
	handle @metrics {
		import gate
		reverse_proxy grafana:3001
	}
${agentsGatedBlock(config)}
	handle {
		import gate
		reverse_proxy seed-web:3000
	}
}`);
  for (const host of redirectHostnames(config)) {
    blocks.push(`${host} {
	redir https://${dns}{uri} permanent
}`);
  }
  return blocks.join(`

`) + `
`;
}
function generateCaddyfile(config) {
  if (isEnterprise(config))
    return generateEnterpriseCaddyfile(config);
  const agents = config.agents ? `
@agentsroute {
	path ${AGENTS_API_PATH} ${AGENTS_API_PATH}/*
}

reverse_proxy @agentsroute seed-agents:3050
` : "";
  return `{$SEED_SITE_HOSTNAME}

encode zstd gzip

@ipfsroute {
	path /ipfs/*
}

reverse_proxy /.metrics* grafana:{$SEED_SITE_MONITORING_PORT:3001}

reverse_proxy @ipfsroute seed-daemon:{$SEED_SITE_BACKEND_GRPCWEB_PORT:56001}
${agents}
reverse_proxy * seed-web:{$SEED_SITE_LOCAL_PORT:3000}
`;
}
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
function requiredContainers(config) {
  const names = ["seed-proxy", "seed-web", "seed-daemon"];
  if (config && isEnterprise(config)) {
    names.push("seed-vault");
    if (config.notify)
      names.push("seed-notify");
  }
  if (config?.agents)
    names.push("seed-agents");
  return names;
}
async function checkContainersHealthy(shell, config) {
  const required = requiredContainers(config);
  for (const name of required) {
    const running = shell.runSafe(`docker inspect ${name} --format '{{.State.Running}}' 2>/dev/null`);
    if (running !== "true")
      return false;
  }
  return true;
}
function containersMatchReleaseChannel(shell, config) {
  for (const { container, expectedImage } of expectedServiceImages(config)) {
    const got = shell.runSafe(`docker inspect ${container} --format '{{.Config.Image}}' 2>/dev/null`);
    if (got !== expectedImage)
      return false;
  }
  return true;
}
function detectForeignStack(shell, paths) {
  const ours = composeProjectName(paths);
  for (const name of ["seed-proxy", "seed-web", "seed-daemon"]) {
    const project = shell.runSafe(`docker inspect ${name} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`);
    if (project && project !== ours)
      return project;
  }
  return null;
}
function assertNoForeignStack(shell, paths) {
  const foreign = detectForeignStack(shell, paths);
  if (!foreign)
    return;
  throw new Error([
    `The seed containers on this host are managed by a different install (compose project '${foreign}').`,
    `This install is '${composeProjectName(paths)}' at ${paths.seedDir}.`,
    `Two seed stacks can't share one host \u2014 they use the same container names.`,
    `Stop the other one first ('stop' in its directory), or run this node on a separate host.`
  ].join(" "));
}
function stopStackByProject(shell, project) {
  shell.runSafe(`docker compose -p "${project}" down --remove-orphans`);
  for (const name of LEGACY_CONTAINER_NAMES) {
    const proj = shell.runSafe(`docker inspect ${name} --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`);
    if (proj === project)
      shell.runSafe(`docker rm -f ${name} 2>/dev/null`);
  }
}
function takeOverHost(shell, foreignProject) {
  clearSeedCron(shell);
  stopStackByProject(shell, foreignProject);
}
function getRunningInstallDir(shell) {
  const src = shell.runSafe(`docker inspect seed-daemon --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null`);
  if (!src)
    return null;
  return dirname(src);
}
async function handleForeignStack(shell, paths, interactive, takeoverApproved) {
  const foreign = detectForeignStack(shell, paths);
  if (!foreign)
    return;
  if (takeoverApproved) {
    takeOverHost(shell, foreign);
    return;
  }
  const foreignDir = getRunningInstallDir(shell);
  if (interactive) {
    const ok = await me({
      message: `The seed containers on this host belong to ${foreignDir ? `the node at ${foreignDir}` : `compose project '${foreign}'`}. Stop it and take over? (its data is kept)`
    });
    if (BD(ok) || !ok)
      assertNoForeignStack(shell, paths);
    takeOverHost(shell, foreign);
    return;
  }
  if (foreignDir && !await access(foreignDir).then(() => true, () => false)) {
    log(`Foreign stack '${foreign}' mounts ${foreignDir}, which no longer exists \u2014 removing the orphaned stack.`);
    stopStackByProject(shell, foreign);
    return;
  }
  assertNoForeignStack(shell, paths);
}
async function getContainerImages(shell, config) {
  const images = new Map;
  const containers = requiredContainers(config);
  for (const name of containers) {
    const image = shell.runSafe(`docker inspect ${name} --format '{{.Image}}' 2>/dev/null`);
    if (image)
      images.set(name, image);
  }
  return images;
}
function expectedServiceImages(config) {
  const tag = config.release_channel || DEFAULT_RELEASE_CHANNEL;
  const images = [
    { container: "seed-web", expectedImage: config.web_image || `seedhypermedia/web:${tag}` },
    { container: "seed-daemon", expectedImage: config.site_image || `seedhypermedia/site:${tag}` }
  ];
  if (isEnterprise(config)) {
    images.push({ container: "seed-vault", expectedImage: `seedhypermedia/vault:${tag}` });
    if (config.notify)
      images.push({ container: "seed-notify", expectedImage: `seedhypermedia/notify:${tag}` });
  }
  if (config.agents)
    images.push({ container: "seed-agents", expectedImage: `seedhypermedia/agents:${tag}` });
  return images;
}
function imageBase(ref) {
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > lastSlash)
    return ref.slice(0, lastColon);
  return ref;
}
function rollbackImageTargets(config) {
  return expectedServiceImages(config).map(({ expectedImage }) => ({
    base: imageBase(expectedImage),
    target: expectedImage
  }));
}
function rollbackTagRefs(container, runningImage, config) {
  const tags = new Set([`${imageBase(runningImage)}:rollback`]);
  const expected = expectedServiceImages(config).find((image) => image.container === container);
  if (expected) {
    tags.add(`${imageBase(expected.expectedImage)}:rollback`);
  }
  return [...tags];
}
async function checkForNewImages(config, paths, shell) {
  const env = buildComposeEnv(config, paths);
  const beforeImages = await getContainerImages(shell, config);
  if (beforeImages.size === 0)
    return false;
  try {
    const result = await shell.exec(`${env} docker compose -f ${paths.composePath} pull --quiet`, IMAGE_PULL_TIMEOUT_MS);
    if (result.stderr)
      log(`image pull: ${result.stderr}`);
  } catch (err) {
    log(`WARNING: image pull reported an error (continuing with per-image check): ${err}`);
    const pullMsg = describePullFailure(String(err), config.release_channel);
    if (pullMsg)
      log(`  ${pullMsg}`);
  }
  for (const [name, runningId] of beforeImages) {
    const imageName = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`);
    if (!imageName)
      continue;
    const pulledId = shell.runSafe(`docker image inspect ${imageName} --format '{{.Id}}' 2>/dev/null`);
    if (pulledId && runningId !== pulledId)
      return true;
  }
  return false;
}
function getContainerEnvs(shell, containerName) {
  const raw = shell.runSafe(`docker inspect ${containerName} --format '{{json .Config.Env}}' 2>/dev/null`);
  if (!raw)
    return {};
  try {
    const envs = JSON.parse(raw);
    const result = {};
    for (const entry of envs) {
      const idx = entry.indexOf("=");
      if (idx > 0) {
        result[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }
    return result;
  } catch {
    return {};
  }
}
function checkGpuAcceleration(shell) {
  const status = shell.runSafe(`docker inspect seed-daemon --format '{{.State.Status}}' 2>/dev/null`);
  if (status !== "running")
    return { available: false, reason: "not-running" };
  const renderNodes = shell.runSafe(`docker exec seed-daemon ls /dev/dri/renderD* 2>/dev/null`);
  if (!renderNodes)
    return { available: false, reason: "no-dev-dri" };
  const vulkanIcd = shell.runSafe(`docker exec seed-daemon ls /usr/share/vulkan/icd.d/*.json 2>/dev/null`);
  if (!vulkanIcd)
    return { available: false, reason: "no-vulkan-icd" };
  return { available: true };
}
function shellQuote(value) {
  if (/^[A-Za-z0-9_\/:.@=,+ -]*$/.test(value))
    return `"${value}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function buildComposeEnv(config, paths) {
  const dns = extractDns(config.domain);
  const enterprise = isEnterprise(config);
  const testnetName = enterprise ? enterpriseTestnetName(config.domain) : config.testnet ? "dev" : "";
  const lightningUrl = config.testnet ? LIGHTNING_URL_TESTNET : LIGHTNING_URL_MAINNET;
  const vars = {
    SEED_SITE_HOSTNAME: config.domain,
    SEED_SITE_DNS: dns,
    SEED_SITE_TAG: config.release_channel,
    SEED_SITE_WORKSPACE: paths.seedDir,
    SEED_UID: String(process.getuid()),
    SEED_GID: String(process.getgid()),
    SEED_LOG_LEVEL: config.compose_envs.LOG_LEVEL,
    SEED_IS_GATEWAY: String(config.gateway),
    SEED_ENABLE_STATISTICS: String(config.analytics),
    SEED_P2P_TESTNET_NAME: testnetName,
    SEED_LIGHTNING_URL: lightningUrl,
    NOTIFY_SERVICE_HOST: notifyHost(config),
    SEED_SITE_MONITORING_WORKDIR: join(paths.seedDir, "monitoring")
  };
  if (config.web_image) {
    vars.SEED_WEB_IMAGE = config.web_image;
  }
  if (config.site_image) {
    vars.SEED_SITE_IMAGE = config.site_image;
  }
  if (enterprise) {
    vars.SEED_SITE_NAME = config.site_name ?? dns;
    vars.SEED_VAULT_ADMIN_SECRET = config.vault_admin_secret ?? "";
    vars.SEED_SESSION_SECRET = config.session_secret ?? "";
    vars.SEED_SERVICE_SECRET = config.service_secret ?? "";
    vars.SEED_UPSTREAM_API_URL = config.upstream_api_url ?? DEFAULT_UPSTREAM_API_URL;
    vars.SEED_CONTACT_EMAIL = config.email ?? "";
    vars.SEED_NOTIFY_HOST = notifyHost(config);
    vars.SEED_AGENTS_HOST = agentsHost(config);
    vars.SEED_AGENTS_EXEC_BACKEND = config.agents_kvm ? "microsandbox" : "";
    vars.SEED_SMTP_HOST = config.smtp?.host ?? "";
    vars.SEED_SMTP_PORT = config.smtp?.port ? String(config.smtp.port) : "587";
    vars.SEED_SMTP_USER = config.smtp?.user ?? "";
    vars.SEED_SMTP_PASSWORD = config.smtp?.password ?? "";
    vars.SEED_SMTP_SENDER = config.smtp?.sender ?? "";
    vars.SEED_EMAIL_RELAY_URL = config.email_relay_url ?? "";
    vars.SEED_EMAIL_RELAY_TOKEN = config.email_relay_token ?? "";
  } else if (config.agents) {
    vars.SEED_AGENTS_HOST = agentsHost(config);
    vars.SEED_AGENTS_EXEC_BACKEND = config.agents_kvm ? "microsandbox" : "";
  }
  const profiles = composeProfiles(config);
  if (profiles.length > 0) {
    vars.COMPOSE_PROFILES = profiles.join(",");
  }
  return Object.entries(vars).map(([k3, v3]) => `${k3}=${shellQuote(v3)}`).join(" ");
}
function getWorkspaceDirs(paths, config) {
  const dirs = [
    join(paths.seedDir, "proxy"),
    join(paths.seedDir, "proxy", "data"),
    join(paths.seedDir, "proxy", "config"),
    join(paths.seedDir, "web"),
    join(paths.seedDir, "daemon"),
    join(paths.seedDir, "monitoring"),
    join(paths.seedDir, "monitoring", "grafana"),
    join(paths.seedDir, "monitoring", "prometheus")
  ];
  if (config && isEnterprise(config)) {
    dirs.push(join(paths.seedDir, "vault"), join(paths.seedDir, "notify"), join(paths.seedDir, "agents"));
  } else if (config?.agents) {
    dirs.push(join(paths.seedDir, "agents"));
  }
  return dirs;
}
var ENTERPRISE_DATA_DIRS = ["vault", "notify", "agents"];
async function ensureSeedDir(paths, shell) {
  try {
    await access(paths.seedDir);
  } catch {
    try {
      await mkdir(paths.seedDir, { recursive: true });
    } catch {
      log(`Creating ${paths.seedDir} requires elevated permissions`);
      shell.run(`sudo mkdir -p "${paths.seedDir}"`);
      shell.run(`sudo chown "$(id -u):$(id -g)" "${paths.seedDir}"`);
    }
  }
}
async function rollback(previousImages, config, paths, shell) {
  log("Deployment failed \u2014 rolling back to previous images...");
  for (const { base, target } of rollbackImageTargets(config)) {
    const hasRollback = shell.runSafe(`docker image inspect ${base}:rollback >/dev/null 2>&1 && echo yes`);
    if (hasRollback === "yes") {
      shell.runSafe(`docker tag ${base}:rollback ${target}`);
      log(`  Restored ${target} from rollback image`);
    }
  }
  for (const [name] of previousImages) {
    shell.runSafe(`docker stop ${name} 2>/dev/null`);
    shell.runSafe(`docker rm ${name} 2>/dev/null`);
  }
  log("  Running docker compose up with restored images...");
  const env = buildComposeEnv(config, paths);
  shell.runSafe(`${env} docker compose -f ${paths.composePath} up -d --quiet-pull 2>&1`);
  log("Rollback complete. Check container status with: docker ps");
}
async function selfUpdate(scriptPath = process.argv[1] || "", deployUrl) {
  const report = (msg) => {
    if (process.stdout.isTTY) {
      console.log(msg);
    } else {
      log(msg);
    }
  };
  if (!scriptPath.endsWith("deploy.js")) {
    report(`Upgrade: skipped \u2014 script path is not a deploy.js (${scriptPath}).`);
    return;
  }
  try {
    const url = getDeployScriptUrl(deployUrl);
    const response = await fetch(url);
    if (!response.ok) {
      report(`Upgrade: failed to fetch ${url}: ${response.status}`);
      return;
    }
    const remote = await response.text();
    let local = "";
    try {
      local = await readFile(scriptPath, "utf-8");
    } catch {}
    if (sha256(remote) !== sha256(local)) {
      await writeFile(scriptPath, remote, "utf-8");
      report(`Upgrade: deploy.js updated (takes effect on next run).`);
    } else {
      report("Upgrade: deploy.js is up to date.");
    }
  } catch (err) {
    report(`Upgrade: skipped (${err})`);
  }
}
function deviceDirectives(devices, groupIds) {
  const lines = ["    devices:", ...devices.map((d2) => `      - ${d2}:${d2}`)];
  if (groupIds.length > 0) {
    lines.push("    group_add:", ...groupIds.map((g2) => `      - ${g2}`));
  }
  return lines;
}
function injectServiceDirectives(compose, containerName, lines) {
  let inService = false;
  const result = [];
  for (const line of compose.split(`
`)) {
    if (new RegExp(`^\\s+container_name:\\s*${containerName}\\s*$`).test(line))
      inService = true;
    if (inService && /^\s{4}volumes:/.test(line)) {
      result.push(...lines);
      inService = false;
    }
    result.push(line);
  }
  return result.join(`
`);
}
async function deploy(config, paths, shell, takeoverApproved = false, bootstrap = {}, previousDomain) {
  const isInteractive = process.stdout.isTTY;
  const spinner = isInteractive ? L2() : null;
  const step = (msg) => {
    if (spinner)
      spinner.message(msg);
    log(msg);
  };
  if (isInteractive) {
    v2.step("Starting deployment...");
  }
  await handleForeignStack(shell, paths, isInteractive, takeoverApproved);
  for (const warning of configWarnings(config)) {
    if (isInteractive)
      v2.warn(warning);
    else
      log(`WARNING: ${warning}`);
  }
  spinner?.start("Fetching docker-compose.yml...");
  step("Fetching docker-compose.yml...");
  const hasEnvOverride = process.env.SEED_DEPLOY_URL || process.env.SEED_REPO_URL;
  const composeFile = composeFileName(config.profile);
  const composeUrl = hasEnvOverride ? `${getOpsBaseUrl()}/${composeFile}` : config.deploy_url ? `${config.deploy_url.replace(/\/+$/, "")}/${composeFile}` : config.compose_url;
  const composeResponse = await fetch(composeUrl);
  if (!composeResponse.ok) {
    spinner?.stop(`Failed to fetch ${composeFile}`);
    throw new Error(`Failed to fetch compose file from ${composeUrl}: ${composeResponse.status}`);
  }
  const composeContent = await composeResponse.text();
  const composeSha = sha256(composeContent);
  const envString = buildComposeEnv(config, paths);
  const envSha = sha256(envString);
  const containersHealthy = await checkContainersHealthy(shell, config);
  const containersOnConfiguredTag = containersMatchReleaseChannel(shell, config);
  const caddyfilePath = join(paths.seedDir, "proxy", "CaddyFile");
  const caddyfileCurrent = await readFile(caddyfilePath, "utf-8").then((existing) => existing === generateCaddyfile(config)).catch(() => false);
  if (config.compose_sha === composeSha && config.compose_env_sha === envSha && containersHealthy && containersOnConfiguredTag && caddyfileCurrent) {
    step("Checking for new images...");
    const hasNewImages = await checkForNewImages(config, paths, shell);
    if (!hasNewImages) {
      spinner?.stop("No changes detected \u2014 all containers healthy. Skipping redeployment.");
      log("No changes detected \u2014 compose SHA and env SHA match, images current, containers healthy. Skipping.");
      if (isInteractive) {
        console.log(`
  To change your node's configuration, run '${cmd("deploy --reconfigure")}'.
`);
      }
      config.last_script_run = new Date().toISOString();
      await writeConfig(config, paths);
      return;
    }
    step("New images available \u2014 proceeding with deployment.");
  }
  if (config.compose_sha && config.compose_sha !== composeSha) {
    step(`Compose file changed: ${config.compose_sha.slice(0, 8)} -> ${composeSha.slice(0, 8)}`);
  }
  if (config.compose_env_sha && config.compose_env_sha !== envSha) {
    step(`Configuration changed: ${config.compose_env_sha.slice(0, 8)} -> ${envSha.slice(0, 8)}`);
  }
  if (containersHealthy && !containersOnConfiguredTag) {
    step(`Running containers do not match the configured images (${expectedServiceImages(config).map((i) => `${i.container}=${i.expectedImage}`).join(", ")}) \u2014 redeploying to reconcile.`);
  }
  await ensureSeedDir(paths, shell);
  let finalCompose = composeContent;
  const hasGpu = shell.runSafe("test -d /dev/dri && echo yes") === "yes";
  if (hasGpu) {
    const groups = [];
    const videoGid = shell.runSafe("getent group video 2>/dev/null | cut -d: -f3");
    if (videoGid)
      groups.push(videoGid);
    const renderGid = shell.runSafe("getent group render 2>/dev/null | cut -d: -f3");
    if (renderGid)
      groups.push(renderGid);
    finalCompose = injectServiceDirectives(finalCompose, "seed-daemon", deviceDirectives(["/dev/dri"], groups));
    log(`GPU detected \u2014 added devices${groups.length ? ` and group_add (${groups.join(", ")})` : ""} to compose file.`);
  }
  if (config.agents && config.agents_kvm) {
    const kvmGid = shell.runSafe("getent group kvm 2>/dev/null | cut -d: -f3");
    finalCompose = injectServiceDirectives(finalCompose, "seed-agents", deviceDirectives(["/dev/kvm"], kvmGid ? [kvmGid] : []));
    log(`agents_kvm \u2014 added /dev/kvm${kvmGid ? ` and group_add (${kvmGid})` : ""} to seed-agents.`);
  }
  await writeFile(paths.composePath, finalCompose, "utf-8");
  step("Setting up workspace directories...");
  const dirs = getWorkspaceDirs(paths, config);
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  await migrateDataFromOldInstall(paths, shell);
  step("Generating Caddyfile...");
  const caddyfile = generateCaddyfile(config);
  const previousCaddyfile = await readFile(caddyfilePath, "utf-8").catch(() => null);
  await writeFile(caddyfilePath, caddyfile, "utf-8");
  const webConfigPath = join(paths.seedDir, "web", "config.json");
  let isFirstDeploy = false;
  try {
    await access(webConfigPath);
  } catch {
    isFirstDeploy = true;
    await writeFile(webConfigPath, JSON.stringify({ availableRegistrationSecret: config.link_secret }) + `
`, "utf-8");
    step("Created initial web/config.json with registration secret.");
  }
  const previousImages = await getContainerImages(shell, config);
  for (const [name, imageId] of previousImages) {
    const imageName = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`);
    if (imageName) {
      for (const tagRef of rollbackTagRefs(name, imageName, config)) {
        shell.runSafe(`docker tag ${imageId} ${tagRef} 2>/dev/null`);
      }
    }
  }
  const env = buildComposeEnv(config, paths);
  step("Removing legacy autoupdaters...");
  removeLegacyAutoupdaters(shell);
  step("Clearing port and name conflicts from prior installs...");
  freeConflictingPortBindings(shell, composeProjectName(paths));
  step("Pulling latest images...");
  try {
    await shell.exec(`${env} docker compose -f ${paths.composePath} pull --quiet`, IMAGE_PULL_TIMEOUT_MS);
  } catch (err) {
    log(`Image pull failed: ${err}`);
  }
  step("Recreating containers...");
  try {
    const composeCmd = `${env} docker compose -f ${paths.composePath} up -d --quiet-pull`;
    const result = await shell.exec(composeCmd);
    if (result.stderr) {
      log(`compose stderr: ${result.stderr}`);
    }
  } catch (err) {
    spinner?.stop("docker compose up failed");
    log(`docker compose up failed: ${err}`);
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell);
    }
    const bindMsg = describeBindFailure(String(err));
    if (bindMsg) {
      throw new Error(bindMsg);
    }
    const pullMsg = describePullFailure(String(err), config.release_channel);
    if (pullMsg) {
      throw new Error(pullMsg);
    }
    throw new Error(`Deployment failed: ${err}`);
  }
  if (previousCaddyfile !== null && previousCaddyfile !== caddyfile) {
    step("Reloading the proxy configuration...");
    try {
      await shell.exec("docker exec seed-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile");
    } catch (err) {
      log(`WARNING: caddy reload failed (${err}); restarting the proxy instead`);
      try {
        await shell.exec("docker restart seed-proxy");
      } catch (restartErr) {
        log(`WARNING: could not restart the proxy: ${restartErr}`);
      }
    }
  }
  let healthy = false;
  for (let attempt = 0;attempt < 10; attempt++) {
    step(`Health check ${attempt + 1}/10...`);
    await new Promise((r2) => setTimeout(r2, 3000));
    healthy = await checkContainersHealthy(shell, config);
    if (healthy)
      break;
  }
  if (!healthy) {
    spinner?.stop("Health checks failed");
    log("Health checks failed \u2014 containers not running after 30s");
    if (previousImages.size > 0) {
      await rollback(previousImages, config, paths, shell);
    }
    throw new Error("Deployment failed: containers did not become healthy within 30 seconds");
  }
  config.compose_sha = composeSha;
  config.compose_env_sha = envSha;
  config.last_script_run = new Date().toISOString();
  await writeConfig(config, paths);
  for (const { expectedImage } of expectedServiceImages(config)) {
    const base = imageBase(expectedImage);
    shell.runSafe(`docker rmi ${base}:rollback 2>/dev/null`);
  }
  step("Cleaning up unused images...");
  shell.runSafe('docker image prune -f --filter "until=1m" 2>/dev/null');
  let bootstrapLines = [];
  if (isEnterprise(config) && isFirstDeploy) {
    step("Creating the organization's space...");
    bootstrapLines = await bootstrapAfterDeploy(config, paths, bootstrap, step);
    for (const line of bootstrapLines)
      log(line);
  }
  let siteUrlLines = [];
  if (isEnterprise(config) && !isFirstDeploy && previousDomain && previousDomain !== config.domain) {
    step(`Updating the space's site URL to ${config.domain}...`);
    siteUrlLines = await syncSiteUrlAfterDeploy(config, step);
    for (const line of siteUrlLines)
      log(line);
  }
  spinner?.stop("Deployment complete!");
  log("Deployment complete.");
  if (isInteractive && siteUrlLines.length > 0) {
    ye(siteUrlLines.join(`
`), "Hostname changed");
  }
  if (isInteractive) {
    v2.message(MANAGE_HINT);
  }
  if (isInteractive && isFirstDeploy) {
    const registerUrl = `${config.domain}/hm/register?secret=${config.link_secret}`;
    if (isEnterprise(config)) {
      ye([
        `Your private Seed is live at ${config.domain}`,
        "",
        ...bootstrapLines,
        "",
        `Invite the organization's people with '${cmd("invite you@example.org")}'`,
        `and have them open the invitation link in a browser.`,
        `Updates are manual: run '${cmd("deploy")}' when you want them.`
      ].join(`
`), "Setup complete");
      return;
    }
    ye([
      `Your site is live at ${config.domain}`,
      "",
      `  Registration URL:`,
      `  ${registerUrl}`,
      "",
      "Copy this URL and paste it into the Seed desktop app",
      "to link your publisher account to this site."
    ].join(`
`), "Setup complete");
  }
}
function buildCrontab(existing, paths, bunPath = "/usr/local/bin/bun") {
  const invoke = `${bunPath} "${DEPLOY_SCRIPT_PATH}" --dir "${paths.seedDir}"`;
  const deployLine = `*/10 * * * * ${invoke} upgrade >> "${paths.deployLog}" 2>&1; ` + `${invoke} deploy >> "${paths.deployLog}" 2>&1 # seed-deploy`;
  const cleanupLine = `0 * * * * docker image prune -f --filter "until=1h" # seed-cleanup`;
  const filtered = removeSeedCronLines(existing).trim();
  return [filtered, deployLine, cleanupLine].filter(Boolean).join(`
`) + `
`;
}
function clearSeedCron(shell) {
  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  if (!existing.includes("# seed-deploy") && !existing.includes("# seed-cleanup"))
    return;
  shell.runSafe(`echo '${removeSeedCronLines(existing)}' | crontab -`);
}
function resolveBunPath(shell) {
  return shell.runSafe("command -v bun") || process.execPath;
}
async function setupCron(paths, shell) {
  const bunPath = resolveBunPath(shell);
  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const newCrontab = buildCrontab(existing, paths, bunPath);
  try {
    shell.run(`echo '${newCrontab}' | crontab -`);
    if (existing.includes("# seed-deploy") || existing.includes("# seed-cleanup")) {
      log("Updated existing seed cron jobs.");
    } else {
      log("Installed automatic deployment cron job (runs every 10 minutes) and hourly image cleanup.");
    }
  } catch (err) {
    log(`Warning: Failed to install cron job: ${err}`);
  }
}
async function migrateLegacyCron(paths, shell, scriptPath = process.argv[1] || "") {
  const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const deployLine = existing.split(`
`).find((line) => line.includes("# seed-deploy"));
  if (!deployLine)
    return;
  if (!deployLine.includes(`"${paths.seedDir}/deploy.js"`) && !deployLine.includes(` ${paths.seedDir}/deploy.js `) && !deployLine.includes(`--dir "${paths.seedDir}"`)) {
    return;
  }
  const bunPath = resolveBunPath(shell);
  const updated = buildCrontab(existing, paths, bunPath);
  if (JSON.stringify(extractSeedCronLines(existing)) === JSON.stringify(extractSeedCronLines(updated)))
    return;
  let copyNeeded = false;
  let copySucceeded = false;
  if (scriptPath !== DEPLOY_SCRIPT_PATH) {
    let source;
    if (scriptPath.endsWith("deploy.js")) {
      try {
        source = await readFile(scriptPath, "utf-8");
      } catch {}
    }
    if (source !== undefined) {
      let targetMatches = false;
      try {
        targetMatches = sha256(await readFile(DEPLOY_SCRIPT_PATH, "utf-8")) === sha256(source);
      } catch {}
      if (!targetMatches) {
        copyNeeded = true;
        const dir = dirname(DEPLOY_SCRIPT_PATH);
        copySucceeded = shell.runSafe(`mkdir -p "${dir}" && cp "${scriptPath}" "${DEPLOY_SCRIPT_PATH}" && echo ok`) === "ok";
        if (!copySucceeded) {
          copySucceeded = shell.runSafe(`sudo mkdir -p "${dir}" && sudo cp "${scriptPath}" "${DEPLOY_SCRIPT_PATH}" && sudo chown "$(id -u):$(id -g)" "${dir}" "${DEPLOY_SCRIPT_PATH}" && echo ok`) === "ok";
        }
      }
    }
  }
  const scriptExists = shell.runSafe(`test -f "${DEPLOY_SCRIPT_PATH}" && echo ok`) === "ok";
  if (copyNeeded && !copySucceeded || !scriptExists) {
    log(`WARNING: could not install deploy.js at ${DEPLOY_SCRIPT_PATH} \u2014 leaving the legacy cron untouched.`);
    return;
  }
  const oldSchedule = deployLine.trim().split(/\s+/).slice(0, 5).join(" ");
  await setupCron(paths, shell);
  installWrapper(paths, shell);
  log(`Migrated legacy cron (${oldSchedule} \u2192 */10) to ${DEPLOY_SCRIPT_PATH}.`);
}
var COMMANDS = [
  "deploy",
  "upgrade",
  "stop",
  "start",
  "restart",
  "doctor",
  "secret",
  "bootstrap-space",
  "config",
  "logs",
  "cron",
  "backup",
  "restore",
  "uninstall",
  "register",
  "invite",
  "set-hostname"
];
function parseProfile(value) {
  if (value && DEPLOY_PROFILES.includes(value))
    return value;
  console.error(`Unknown profile: ${value ?? "(none)"}. Expected one of: ${DEPLOY_PROFILES.join(", ")}
`);
  process.exit(1);
}
function parseArgs(argv = process.argv) {
  const rawAll = argv.slice(2);
  const advanced = rawAll.includes("--advanced");
  let dir;
  let profile;
  const headless = {};
  const valueFlags = {
    "--dir": (v3) => dir = v3,
    "--profile": (v3) => profile = parseProfile(v3),
    "--hostname": (v3) => headless.hostname = v3,
    "--tag": (v3) => headless.tag = v3,
    "--email": (v3) => headless.email = v3,
    "--log-level": (v3) => headless.logLevel = v3,
    "--site-name": (v3) => headless.siteName = v3,
    "--owner-password": (v3) => headless.ownerPassword = v3,
    "--email-relay-url": (v3) => headless.emailRelayUrl = v3,
    "--email-relay-token": (v3) => headless.emailRelayToken = v3
  };
  const boolFlags = {
    "--advanced": () => {},
    "--yes": () => headless.yes = true,
    "--agents": () => headless.agents = true,
    "--no-agents": () => headless.agents = false,
    "--notify": () => headless.notify = true,
    "--no-notify": () => headless.notify = false
  };
  const raw = [];
  for (let i = 0;i < rawAll.length; i++) {
    const a2 = rawAll[i];
    if (boolFlags[a2]) {
      boolFlags[a2]();
      continue;
    }
    if (valueFlags[a2]) {
      valueFlags[a2](rawAll[++i] ?? "");
      continue;
    }
    const eq = a2.indexOf("=");
    if (a2.startsWith("--") && eq > 0 && valueFlags[a2.slice(0, eq)]) {
      valueFlags[a2.slice(0, eq)](a2.slice(eq + 1));
      continue;
    }
    raw.push(a2);
  }
  const first = raw[0] ?? "deploy";
  if (first === "--help" || first === "-h")
    return { command: "help", args: [], advanced, dir, profile, headless };
  if (first === "--version" || first === "-v")
    return { command: "version", args: [], advanced, dir, profile, headless };
  if (first === "--reconfigure")
    return { command: "deploy", args: [], reconfigure: true, advanced, dir, profile, headless };
  if (COMMANDS.includes(first)) {
    const rest = raw.slice(1);
    const reconfigure = first === "deploy" && rest.includes("--reconfigure");
    const args = reconfigure ? rest.filter((a2) => a2 !== "--reconfigure") : rest;
    return { command: first, args, reconfigure, advanced, dir, profile, headless };
  }
  console.error(`Unknown command: ${first}
`);
  console.error(`Your deploy script may be outdated; run seed-deploy upgrade
`);
  printHelp();
  process.exit(1);
}
function printHelp() {
  const lines = [
    `Seed Node Deployment v${VERSION}`,
    ``,
    `Usage: seed-deploy [command] [options]`,
    ``,
    `Commands:`,
    `  deploy      Deploy or update the Seed node (default)`,
    `  upgrade     Update deploy script to latest version`,
    `  stop        Stop and remove all Seed containers`,
    `  start       Start containers without re-deploying`,
    `  restart     Restart all Seed containers`,
    `  doctor      Diagnose node health, versions, and connectivity`,
    `  secret      Print the site registration secret`,
    `  config      Print current configuration (secrets redacted)`,
    `  logs        Tail container logs [daemon|web|proxy|vault|notify|agents]`,
    `  cron        Install or remove automatic update cron jobs`,
    `  backup      Create a portable backup of all node data`,
    `  restore     Restore node data from a backup file`,
    `  uninstall   Remove all Seed containers, data, and configuration`,
    `  register    Register a space already on this daemon: register <accountUid>`,
    `  invite      Invite a person: invite <email> [--role reader|writer] [--no-email]  (enterprise)`,
    `  bootstrap-space  Create the organization's space if the first deploy could not  (enterprise)`,
    `  set-hostname  Move the node to a new hostname: set-hostname https://new.example.org  (enterprise)`,
    ``,
    `Options:`,
    `  --reconfigure  Re-run the setup wizard for the current node`,
    `  --advanced     Manage/create/switch nodes: pick the directory, custom tag, etc.`,
    `  --profile <p>  Deploy profile for a first run: site (default) or enterprise`,
    `  --hostname <url> --tag <tag> [--email <e>] [--log-level <l>] [--agents] [--notify] --yes`,
    `                 Unattended enterprise install (no wizard); SMTP from SEED_SMTP_HOST/USER/PASSWORD/SENDER`,
    `  --email-relay-url <url> --email-relay-token <token>`,
    `                 Send email through the Seed hosting relay instead of SMTP`,
    `                 (SEED_EMAIL_RELAY_URL / SEED_EMAIL_RELAY_TOKEN work too)`,
    `  --site-name <name> [--owner-password <pw>]`,
    `                 Name of the organization's space and a password for its exported owner key`,
    `                 (first enterprise deploy and bootstrap-space; SEED_OWNER_PASSWORD works too)`,
    `  -h, --help     Show this help message`,
    `  -v, --version  Show script version`,
    ``,
    `Examples:`,
    `  seed-deploy                            Deploy or update`,
    `  seed-deploy --profile enterprise       First-time setup of a private Enterprise node`,
    `  seed-deploy upgrade                    Update deploy script`,
    `  seed-deploy deploy --reconfigure       Change node configuration`,
    `  seed-deploy stop                       Teardown containers`,
    `  seed-deploy doctor                     Check node health`,
    `  seed-deploy secret                     Print registration secret`,
    `  seed-deploy logs daemon                Tail seed-daemon logs`,
    `  seed-deploy cron                       Install automatic update cron`,
    `  seed-deploy cron remove                Remove cron jobs`,
    `  seed-deploy backup                     Create backup`,
    `  seed-deploy backup /tmp/backup.tar.gz  Create backup at custom path`,
    `  seed-deploy restore backup.tar.gz      Restore from backup file`,
    ``
  ];
  if (CLI_INSTALLED) {
    lines.push(`The 'seed-deploy' command is installed at /usr/local/bin/seed-deploy.`, `The deployment script lives at ${DEPLOY_SCRIPT_PATH}; node data defaults to ${DEFAULT_DATA_DIR} (override with --dir).`);
  } else {
    lines.push(`The 'seed-deploy' CLI is not installed. You can run any command above with:`, `  ${CURL_INSTALL_CMD} -s -- <command>`, ``, `The deployment script lives at ${DEPLOY_SCRIPT_PATH}; node data defaults to ${DEFAULT_DATA_DIR} (override with --dir).`);
  }
  console.log(lines.join(`
`));
}
async function promptNodeDir(current, shell) {
  const running = getRunningInstallDir(shell);
  const chosen = await ue({
    message: "Node directory \u2014 existing dir reconfigures it; a new/empty dir creates a branch node",
    initialValue: running ?? current.seedDir,
    placeholder: running ?? current.seedDir,
    validate: (v3) => {
      if (!v3)
        return "Required";
      if (!v3.startsWith("/"))
        return "Use an absolute path";
    }
  });
  if (BD(chosen)) {
    ve("Cancelled.");
    process.exit(0);
  }
  return makePaths(chosen);
}
async function maybeStopOtherRunningNode(target, shell) {
  const foreign = detectForeignStack(shell, target);
  const running = getRunningInstallDir(shell);
  const otherDir = running && running !== target.seedDir ? running : null;
  if (!foreign && !otherDir)
    return false;
  const ok = await me({
    message: `Another node (${otherDir ?? `compose project '${foreign}'`}) owns the seed containers on this host. Stop it and switch to ${target.seedDir}? (its data is kept)`
  });
  if (BD(ok) || !ok) {
    ve("Cancelled \u2014 the running node was left in place.");
    process.exit(0);
  }
  takeOverHost(shell, foreign ?? composeProjectName(target));
  v2.success(`Stopped the node${otherDir ? ` at ${otherDir}` : ""}. This one takes over when the deploy completes.`);
  return true;
}
function installWrapper(paths, shell) {
  const bunPath = resolveBunPath(shell);
  const wrapper = "/usr/local/bin/seed-deploy";
  const content = `#!/bin/sh
exec "${bunPath}" "${DEPLOY_SCRIPT_PATH}" --dir "${paths.seedDir}" "$@"
`;
  const b64 = Buffer.from(content).toString("base64");
  if (shell.runSafe(`echo ${b64} | base64 -d > ${wrapper} && chmod +x ${wrapper} && echo ok`) !== "ok") {
    shell.runSafe(`echo ${b64} | base64 -d | sudo tee ${wrapper} >/dev/null && sudo chmod +x ${wrapper}`);
  }
}
function autoUpdates(config) {
  return !isEnterprise(config) || isPresetReleaseChannel(config.release_channel);
}
async function setActiveNode(paths, shell, config) {
  if (config && !autoUpdates(config)) {
    clearSeedCron(shell);
    log(`Enterprise profile on the '${config.release_channel}' channel: automatic update cron not installed (updates are manual).`);
  } else {
    await setupCron(paths, shell);
  }
  installWrapper(paths, shell);
}
function runWizardFor(profile, paths, existing, advanced, bootstrap) {
  const effective = profile ?? existing?.profile ?? "site";
  return effective === "enterprise" ? runEnterpriseWizard(paths, existing, advanced, bootstrap) : runFreshWizard(paths, existing, advanced);
}
async function cmdDeploy(paths, shell, reconfigure = false, advanced = false, profile, headless = {}) {
  checkDockerAccess(shell);
  const interactive = process.stdout.isTTY;
  const unattended = profile === "enterprise" && (headless.yes || !interactive) && !!headless.hostname;
  const bootstrap = bootstrapOptionsFrom(headless);
  let takeoverApproved = false;
  if (advanced && interactive) {
    paths = await promptNodeDir(paths, shell);
    takeoverApproved = await maybeStopOtherRunningNode(paths, shell);
  }
  await ensureSeedDir(paths, shell);
  if (await configExists(paths)) {
    const existing = await readConfig(paths);
    if (profile && (existing.profile ?? "site") !== profile) {
      throw new Error(`This node is configured with the '${existing.profile ?? "site"}' profile; ` + `a profile cannot be switched in place. Use a fresh directory (--dir) for a '${profile}' node.`);
    }
    if (unattended) {
      const config2 = headlessEnterpriseConfig(headless, existing);
      await writeConfig(config2, paths);
      log(`Config updated from flags at ${paths.configPath}.`);
      await deploy(config2, paths, shell, false, bootstrap, existing.domain);
      await setActiveNode(paths, shell, config2);
      return;
    }
    if ((reconfigure || advanced) && interactive) {
      const config2 = await runWizardFor(profile, paths, existing, advanced, bootstrap);
      await deploy(config2, paths, shell, takeoverApproved, bootstrap, existing.domain);
      await setActiveNode(paths, shell, config2);
      fe(`Reconfiguration complete! Your Seed node is running.
${MANAGE_HINT}`);
      return;
    }
    log(`Seed deploy v${VERSION} \u2014 config found at ${paths.configPath}, running headless.`);
    if (autoUpdates(existing)) {
      try {
        await migrateLegacyCron(paths, shell);
      } catch (err) {
        log(`WARNING: cron migration failed: ${err}`);
      }
    }
    await deploy(existing, paths, shell, false, bootstrap);
    return;
  }
  if (unattended) {
    const config2 = headlessEnterpriseConfig(headless);
    await writeConfig(config2, paths);
    log(`Seed deploy v${VERSION} \u2014 enterprise config written to ${paths.configPath} from flags.`);
    await deploy(config2, paths, shell, takeoverApproved, bootstrap);
    await setActiveNode(paths, shell, config2);
    log(`Setup complete. Next: '${cmd("invite you@example.org")}' for each person of the organization.`);
    return;
  }
  if (!interactive) {
    throw new Error(`No config at ${paths.configPath} and no TTY for the wizard. ` + `For an unattended enterprise install pass --profile enterprise --hostname https://\u2026 --tag <tag> --yes.`);
  }
  const oldInstall = profile === "enterprise" ? null : await detectOldInstall(shell);
  const config = oldInstall ? await runMigrationWizard(oldInstall, paths, shell, advanced) : await runWizardFor(profile, paths, undefined, advanced, bootstrap);
  await deploy(config, paths, shell, takeoverApproved, bootstrap);
  await setActiveNode(paths, shell, config);
  fe(`Setup complete! Your Seed node is running.
${MANAGE_HINT}`);
}
async function cmdUpgrade(paths) {
  let deployUrl;
  try {
    if (await configExists(paths)) {
      deployUrl = (await readConfig(paths)).deploy_url;
    }
  } catch {}
  await selfUpdate(undefined, deployUrl);
}
async function composeEnvPrefix(paths) {
  try {
    if (!await configExists(paths))
      return "";
    return buildComposeEnv(await readConfig(paths), paths);
  } catch {
    return "";
  }
}
async function cmdStop(paths, shell) {
  checkDockerAccess(shell);
  console.log("Stopping and removing Seed containers...");
  const env = await composeEnvPrefix(paths);
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" down`);
  console.log("All Seed containers stopped and removed.");
}
async function cmdStart(paths, shell) {
  checkDockerAccess(shell);
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first to set up.`);
    process.exit(1);
  }
  assertNoForeignStack(shell, paths);
  const config = await readConfig(paths);
  const envContent = buildComposeEnv(config, paths);
  console.log("Starting Seed containers...");
  shell.run(`${envContent} docker compose -f "${paths.composePath}" up -d --quiet-pull`);
  console.log("Seed containers started.");
}
async function cmdRestart(paths, shell) {
  await cmdStop(paths, shell);
  await cmdStart(paths, shell);
}
async function cmdDoctor(paths, shell) {
  checkDockerAccess(shell);
  console.log(`
Seed Node Doctor v${VERSION}`);
  console.log("\u2501".repeat(40));
  let config = null;
  if (await configExists(paths)) {
    config = await readConfig(paths);
    const enterprise = isEnterprise(config);
    console.log(`
Configuration:`);
    console.log(`  Profile:     ${enterprise ? "Enterprise (private, web-only)" : "Site"}`);
    console.log(`  Domain:      ${config.domain}`);
    console.log(`  Network:     ${enterprise ? "Isolated (no P2P)" : config.testnet ? "Testnet (devnet)" : "Mainnet"}`);
    console.log(`  Channel:     ${config.release_channel}`);
    if (config.deploy_url)
      console.log(`  Deploy URL:  ${config.deploy_url}`);
    if (config.web_image)
      console.log(`  Web image:   ${config.web_image}`);
    if (config.site_image)
      console.log(`  Site image:  ${config.site_image}`);
    if (enterprise) {
      console.log(`  Notify:      ${config.notify ? notifyHost(config) : "No"}`);
    } else {
      console.log(`  Gateway:     ${config.gateway ? "Yes" : "No"}`);
    }
    console.log(`  Agents:      ${config.agents ? `${agentsHost(config)}${config.agents_kvm ? " (kvm)" : ""}` : "No"}`);
    console.log(`  Config:      ${paths.configPath}`);
    for (const warning of configWarnings(config)) {
      console.log(`  \u26A0 ${warning}`);
    }
  } else {
    console.log(`
No config found at ${paths.configPath}. Node is not set up.`);
  }
  const runningDir = getRunningInstallDir(shell);
  if (runningDir && runningDir !== paths.seedDir) {
    console.log(`
  \u26A0 The RUNNING node is managed from a different install: ${runningDir}`);
    console.log(`      You are inspecting ${paths.seedDir}, but the live containers belong to ${runningDir}.`);
    console.log(`      Manage the live node with: seed-deploy --dir ${runningDir} <command>.`);
  }
  console.log(`
Containers:`);
  const containers = requiredContainers(config ?? undefined);
  let hasUnhealthy = false;
  for (const name of containers) {
    const status = shell.runSafe(`docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`);
    const image = shell.runSafe(`docker inspect ${name} --format '{{.Config.Image}}' 2>/dev/null`);
    const started = shell.runSafe(`docker inspect ${name} --format '{{.State.StartedAt}}' 2>/dev/null`);
    if (status) {
      const symbol = status === "running" ? "\u2714" : "\u26A0";
      console.log(`  ${symbol} ${name.padEnd(14)} ${(status ?? "").padEnd(10)} ${image ?? ""}${started ? `  (since ${started})` : ""}`);
      if (status !== "running") {
        hasUnhealthy = true;
        const lastLog = shell.runSafe(`docker logs --tail 1 ${name} 2>&1`);
        if (lastLog) {
          console.log(`      \u2514 ${lastLog.slice(0, 120)}`);
        }
      }
    } else {
      console.log(`  \u2718 ${name.padEnd(14)} not found`);
    }
  }
  if (hasUnhealthy) {
    console.log(`
  Tip: Check logs with '${cmd("logs daemon|web|proxy")}'`);
  }
  if (config) {
    const expectedLightning = config.testnet ? LIGHTNING_URL_TESTNET : LIGHTNING_URL_MAINNET;
    const expectedTestnetName = config.testnet ? "dev" : "";
    const checks = isEnterprise(config) ? [
      { container: "seed-daemon", envVar: "SEED_P2P_TESTNET_NAME", expected: enterpriseTestnetName(config.domain) },
      { container: "seed-daemon", envVar: "SEED_LOG_LEVEL", expected: config.compose_envs.LOG_LEVEL },
      { container: "seed-web", envVar: "SEED_BASE_URL", expected: config.domain },
      { container: "seed-web", envVar: "SEED_IS_GATEWAY", expected: "false" },
      { container: "seed-web", envVar: "SEED_ENABLE_STATISTICS", expected: "false" },
      { container: "seed-web", envVar: "SEED_REQUIRE_SIGN_IN", expected: "1" },
      {
        container: "seed-web",
        envVar: "NOTIFY_SERVICE_HOST",
        expected: notifyHost(config),
        label: notifyHost(config) || "(empty, notify off)"
      }
    ] : [
      {
        container: "seed-daemon",
        envVar: "SEED_P2P_TESTNET_NAME",
        expected: expectedTestnetName,
        label: expectedTestnetName || "(empty, mainnet)"
      },
      { container: "seed-daemon", envVar: "LIGHTNING_API_URL", expected: expectedLightning },
      { container: "seed-daemon", envVar: "SEED_LOG_LEVEL", expected: config.compose_envs.LOG_LEVEL },
      { container: "seed-web", envVar: "SEED_BASE_URL", expected: config.domain },
      { container: "seed-web", envVar: "SEED_IS_GATEWAY", expected: String(config.gateway) },
      { container: "seed-web", envVar: "SEED_ENABLE_STATISTICS", expected: String(config.analytics) }
    ];
    const daemonEnvs = getContainerEnvs(shell, "seed-daemon");
    const webEnvs = getContainerEnvs(shell, "seed-web");
    const envMaps = {
      "seed-daemon": daemonEnvs,
      "seed-web": webEnvs
    };
    const imageChecks = expectedServiceImages(config);
    let hasMismatch = false;
    const mismatches = [];
    for (const { container, envVar, expected, label } of checks) {
      const actual = envMaps[container]?.[envVar];
      if (actual !== undefined && actual !== expected) {
        hasMismatch = true;
        mismatches.push(`  \u26A0 ${container.padEnd(14)} ${envVar}: expected ${JSON.stringify(label ?? expected)}, got ${JSON.stringify(actual)}`);
      }
    }
    for (const { container, expectedImage } of imageChecks) {
      const actualImage = shell.runSafe(`docker inspect ${container} --format '{{.Config.Image}}' 2>/dev/null`);
      if (actualImage && actualImage !== expectedImage) {
        hasMismatch = true;
        mismatches.push(`  \u26A0 ${container.padEnd(14)} image: expected ${expectedImage}, got ${actualImage}`);
      }
    }
    if (hasMismatch) {
      console.log(`
Configuration Sync:`);
      for (const m3 of mismatches)
        console.log(m3);
      console.log(`
  Tip: Run '${cmd("deploy")}' to reconcile running containers with config.`);
    }
  }
  const gpu = checkGpuAcceleration(shell);
  if (gpu.available) {
    console.log(`  \u2714 GPU            available via Vulkan`);
  } else if (gpu.reason !== "not-running") {
    console.log(`  \u26A0 GPU            not available, embeddings will use CPU (slower)`);
    if (gpu.reason === "no-dev-dri") {
      console.log(`      \u2514 /dev/dri not found in container; host may lack a GPU`);
    } else {
      console.log(`      \u2514 /dev/dri present but no Vulkan ICD found; install GPU vendor drivers on host`);
    }
  }
  const prometheusRunning = shell.runSafe(`docker inspect prometheus --format '{{.State.Status}}' 2>/dev/null`);
  const grafanaRunning = shell.runSafe(`docker inspect grafana --format '{{.State.Status}}' 2>/dev/null`);
  if (prometheusRunning || grafanaRunning) {
    const prometheusConfig = join(paths.seedDir, "monitoring", "prometheus", "prometheus.yaml");
    const grafanaProvDir = join(paths.seedDir, "monitoring", "grafana", "provisioning");
    let monitoringOk = true;
    console.log(`
Monitoring:`);
    try {
      await access(prometheusConfig);
      console.log(`  \u2714 Prometheus config exported`);
    } catch {
      monitoringOk = false;
      console.log(`  \u26A0 Prometheus config not exported`);
    }
    try {
      await access(grafanaProvDir);
      console.log(`  \u2714 Grafana provisioning exported`);
    } catch {
      monitoringOk = false;
      console.log(`  \u26A0 Grafana provisioning not exported`);
    }
    if (!monitoringOk) {
      console.log(`
  Tip: This may indicate a permissions issue with the monitoring/ directory.`);
      console.log(`        Run '${cmd("deploy")}' to attempt an automatic fix.`);
    }
  }
  if (config) {
    console.log(`
Health Checks:`);
    const dns = extractDns(config.domain);
    const httpResult = shell.runSafe(`curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 30 "${config.domain}" 2>/dev/null`);
    if (httpResult) {
      const [code, timeStr] = httpResult.split(" ");
      const latency = parseFloat(timeStr);
      console.log(`  \u2714 HTTPS          OK (${code})`);
      if (!isNaN(latency)) {
        const latencyMs = Math.round(latency * 1000);
        const symbol = latency > 2 ? "\u26A0" : "\u2714";
        const suffix = latency > 2 ? " \u2014 high latency, check server resources" : "";
        console.log(`  ${symbol} Latency        ${latencyMs}ms${suffix}`);
      }
    } else {
      console.log(`  \u26A0 HTTPS          unreachable`);
    }
    const publicIp = shell.runSafe("curl -4 -s --max-time 5 ifconfig.me 2>/dev/null");
    const dnsResult = shell.runSafe(`dig +short ${dns} A 2>/dev/null | head -1`);
    if (publicIp && dnsResult) {
      if (dnsResult.trim() === publicIp.trim()) {
        console.log(`  \u2714 DNS            ${dns} -> ${dnsResult} (matches public IP)`);
      } else {
        console.log(`  \u26A0 DNS            ${dns} -> ${dnsResult} (public IP is ${publicIp})`);
      }
    } else if (!dnsResult) {
      console.log(`  \u26A0 DNS            ${dns} does not resolve`);
    } else {
      console.log(`  ? DNS            could not determine public IP`);
    }
    const certExpiry = shell.runSafe(`echo | openssl s_client -servername "${dns}" -connect "${dns}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`);
    if (certExpiry) {
      const expiryDate = certExpiry.replace("notAfter=", "");
      const expiry = new Date(expiryDate);
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
      const symbol = daysLeft > 14 ? "\u2714" : "\u26A0";
      console.log(`  ${symbol} Certificate    valid, expires ${expiry.toISOString().slice(0, 10)} (${daysLeft}d)`);
    } else {
      console.log(`  \u26A0 Certificate    could not check`);
    }
    const webEnvJson = shell.runSafe("docker inspect seed-web --format '{{json .Config.Env}}' 2>/dev/null");
    let webPort = "3000";
    if (webEnvJson) {
      try {
        const envs = JSON.parse(webEnvJson);
        const portEnv = envs.find((entry) => entry.startsWith("PORT="));
        const port = portEnv?.split("=")[1]?.trim();
        if (port && /^\d+$/.test(port)) {
          webPort = port;
        }
      } catch {}
    }
    const siteConfigUrl = isEnterprise(config) ? `${config.domain}/hm/api/config` : `http://127.0.0.1:${webPort}/hm/api/config`;
    const siteConfigRaw = shell.runSafe(`curl -sS --max-time 10 "${siteConfigUrl}" 2>/dev/null`);
    if (!siteConfigRaw) {
      console.log(`  \u26A0 Site           could not check`);
    } else {
      try {
        const siteConfig = JSON.parse(siteConfigRaw);
        const accountUid = siteConfig.registeredAccountUid?.trim();
        if (accountUid) {
          const shortUid = accountUid.length > 16 ? `${accountUid.slice(0, 8)}...${accountUid.slice(-6)}` : accountUid;
          console.log(`  \u2714 Site           registered (${shortUid})`);
        } else {
          console.log(`  \u26A0 Site           not registered`);
          if (isEnterprise(config)) {
            console.log(`      Tip: Run '${cmd("bootstrap-space")}' to create the organization's space.`);
          } else {
            console.log(`      Tip: Run '${cmd("secret")}' to get the registration URL,`);
            console.log("      then paste it into the Seed desktop app to register.");
          }
        }
      } catch {
        console.log(`  \u26A0 Site           could not check`);
      }
    }
    if (isEnterprise(config)) {
      console.log(`
Isolation:`);
      for (const line of enterpriseIsolationChecks(shell, config))
        console.log(line);
    }
  }
  const du = shell.runSafe(`du -sh "${paths.seedDir}" 2>/dev/null`);
  if (du) {
    console.log(`
Disk:`);
    console.log(`  ${paths.seedDir}  ${du.split("\t")[0]}`);
  }
  const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const deployCron = crontab.split(`
`).find((l2) => l2.includes("# seed-deploy"));
  const cleanupCron = crontab.split(`
`).find((l2) => l2.includes("# seed-cleanup"));
  console.log(`
Cron:`);
  console.log(`  Auto-update: ${deployCron ? deployCron.split(" ").slice(0, 5).join(" ") : "not installed"}`);
  console.log(`  Cleanup:     ${cleanupCron ? cleanupCron.split(" ").slice(0, 5).join(" ") : "not installed"}`);
  if (config && isEnterprise(config)) {
    if (deployCron) {
      console.log(`
  \u26A0 Enterprise nodes update manually; this cron will redeploy on every new image. '${cmd("cron remove")}' removes it.`);
    } else {
      console.log(`  (Enterprise profile: updates are manual \u2014 run '${cmd("deploy")}' to update.)`);
    }
  } else if (!deployCron || !cleanupCron) {
    console.log(`
  Tip: Run '${cmd("cron")}' to set up automatic updates.`);
  }
  console.log("");
}
function enterpriseIsolationChecks(shell, config) {
  const lines = [];
  const ports = shell.runSafe("docker port seed-daemon 2>/dev/null");
  if (ports === null) {
    lines.push(`  \u26A0 Daemon ports   could not check (is seed-daemon running?)`);
  } else if (ports.trim() === "") {
    lines.push(`  \u2714 Daemon ports   none published (P2P unreachable from outside)`);
  } else {
    lines.push(`  \u2718 Daemon ports   PUBLISHED: ${ports.replace(/\n/g, "; ")}`);
    lines.push(`      \u2514 the enterprise compose template has no ports on seed-daemon; redeploy with '${cmd("deploy")}'`);
  }
  const siteConfigRaw = shell.runSafe(`curl -sS --max-time 10 "${config.domain}/hm/api/config" 2>/dev/null`);
  if (!siteConfigRaw) {
    lines.push(`  \u26A0 Sign-in gate   could not fetch ${config.domain}/hm/api/config`);
  } else {
    try {
      const siteConfig = JSON.parse(siteConfigRaw);
      if (siteConfig.requireSignIn === true) {
        lines.push(`  \u2714 Sign-in gate   /hm/api/config reports requireSignIn: true`);
      } else {
        lines.push(`  \u2718 Sign-in gate   /hm/api/config reports requireSignIn: ${JSON.stringify(siteConfig.requireSignIn)}`);
        lines.push(`      \u2514 seed-web should run with SEED_REQUIRE_SIGN_IN=1; redeploy with '${cmd("deploy")}'`);
      }
    } catch {
      lines.push(`  \u26A0 Sign-in gate   /hm/api/config is not JSON`);
    }
  }
  const siteUrlRaw = shell.runSafe(`curl -sS --max-time 10 "${config.domain}/hm/api/site-url" 2>/dev/null`);
  if (siteUrlRaw) {
    try {
      lines.push(...siteUrlCheck(JSON.parse(siteUrlRaw)));
    } catch {
      lines.push(`  \u26A0 Site URL       /hm/api/site-url is not JSON`);
    }
  }
  const gate = shell.runSafe(`curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "${config.domain}/" 2>/dev/null`);
  if (!gate) {
    lines.push(`  \u26A0 Proxy gate     could not fetch ${config.domain}/`);
  } else {
    const [code, redirect = ""] = gate.trim().split(" ");
    if (code === "302" && redirect.includes("/hm/sign-in")) {
      lines.push(`  \u2714 Proxy gate     GET / without a session \u2192 302 ${redirect}`);
    } else if (code === "401") {
      lines.push(`  \u2714 Proxy gate     GET / without a session \u2192 401`);
    } else {
      lines.push(`  \u2718 Proxy gate     GET / without a session answered ${code}${redirect ? ` \u2192 ${redirect}` : ""}`);
      lines.push(`      \u2514 the Caddyfile's forward_auth gate is not in effect; redeploy with '${cmd("deploy")}'`);
    }
  }
  const session = shell.runSafe(`curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${config.domain}${SESSION_CHECK_URI}" 2>/dev/null`);
  if (!session) {
    lines.push(`  \u26A0 Session check  could not fetch ${config.domain}${SESSION_CHECK_URI}`);
  } else if (session.trim() === "401") {
    lines.push(`  \u2714 Session check  ${SESSION_CHECK_URI} without a session \u2192 401`);
  } else {
    lines.push(`  \u2718 Session check  ${SESSION_CHECK_URI} without a session answered ${session.trim()}`);
    lines.push(`      \u2514 seed-web should run with SEED_REQUIRE_SIGN_IN=1 and SEED_SESSION_SECRET set`);
  }
  const vaultStatus = shell.runSafe(`curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${config.domain}/vault/" 2>/dev/null`);
  if (vaultStatus && /^2\d\d$/.test(vaultStatus.trim())) {
    lines.push(`  \u2714 Vault          ${config.domain}/vault/ (${vaultStatus.trim()})`);
  } else {
    lines.push(`  \u2718 Vault          ${config.domain}/vault/ answered ${vaultStatus?.trim() || "nothing"}`);
    lines.push(`      \u2514 check '${cmd("logs vault")}'`);
  }
  return lines;
}
function siteUrlCheck(siteConfig) {
  if (typeof siteConfig.siteUrl !== "string" || !siteConfig.hostname)
    return [];
  if (siteConfig.siteUrl === siteConfig.hostname) {
    return [`  \u2714 Site URL       the space's home document points at ${siteConfig.hostname}`];
  }
  return [
    `  \u26A0 Site URL       the space's home document points at ${siteConfig.siteUrl}, the site is ${siteConfig.hostname}`,
    `      \u2514 republish it with '${cmd(`set-hostname ${siteConfig.hostname}`)}'`
  ];
}
async function cmdConfig(paths) {
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  console.log(JSON.stringify(redactConfig(config), null, 2));
}
function redactConfig(config) {
  const redacted = { ...config, link_secret: "****" };
  if (config.vault_admin_secret)
    redacted.vault_admin_secret = "****";
  if (config.session_secret)
    redacted.session_secret = "****";
  if (config.service_secret)
    redacted.service_secret = "****";
  if (config.smtp?.password)
    redacted.smtp = { ...config.smtp, password: "****" };
  if (config.email_relay_token)
    redacted.email_relay_token = "****";
  return redacted;
}
async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new Error(`${url} \u2192 HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return parsed;
}
var OWNER_KEY_DIR = "owner-key";
function ownerKeyPath(paths, accountUid) {
  return join(paths.seedDir, OWNER_KEY_DIR, `${accountUid}.hmkey.json`);
}
var BOOTSTRAP_ATTEMPTS = 6;
var BOOTSTRAP_RETRY_MS = 5000;
async function bootstrapSpace(config, paths, opts = {}, io = {}) {
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    throw new Error("Creating the organization's space needs an enterprise node (no vault_admin_secret in config).");
  }
  const name = opts.siteName?.trim() || config.site_name || extractDns(config.domain);
  const url = `${config.domain}/hm/api/enterprise-bootstrap`;
  const body = { name };
  if (opts.ownerPassword)
    body.ownerPassword = opts.ownerPassword;
  const answer = await postAdminRoute(url, config.vault_admin_secret, body, io, {
    waiting: "Space not created yet",
    failure: "Could not create the organization's space"
  });
  const result = answer.result;
  if (answer.ok) {
    const accountUid = typeof result.accountUid === "string" ? result.accountUid : "";
    if (!accountUid || !result.keyFile)
      throw new Error(`${url} answered without an account or key file`);
    const keyPath = ownerKeyPath(paths, accountUid);
    await mkdir(dirname(keyPath), { recursive: true, mode: 448 });
    await chmod(dirname(keyPath), 448);
    await writeFile(keyPath, `${JSON.stringify(result.keyFile, null, 2)}
`, { encoding: "utf-8", mode: 384 });
    await chmod(keyPath, 384);
    config.owner_account_uid = accountUid;
    config.site_name = typeof result.name === "string" && result.name ? result.name : name;
    await writeConfig(config, paths);
    return { status: "created", accountUid, name: config.site_name, keyPath };
  }
  if (answer.status === 409 && typeof result.accountUid === "string") {
    return { status: "exists", accountUid: result.accountUid };
  }
  if (answer.status === 404) {
    throw new Error(`${url} \u2192 HTTP 404: the web app has no bootstrap route. ` + `Its image predates it, or SEED_VAULT_ADMIN_SECRET is not set on seed-web; ` + `after '${cmd("deploy")}' with current images run '${cmd("bootstrap-space")}'.`);
  }
  throw new Error(`${url} \u2192 HTTP ${answer.status}${answer.detail ? `: ${answer.detail.slice(0, 500)}` : ""}`);
}
async function postAdminRoute(url, secret, body, io, messages) {
  const doFetch = io.fetch ?? fetch;
  const sleep = io.sleep ?? ((ms) => new Promise((r2) => setTimeout(r2, ms)));
  let lastError = "";
  for (let attempt = 1;attempt <= BOOTSTRAP_ATTEMPTS; attempt++) {
    let response = null;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(body)
      });
    } catch (err) {
      lastError = `${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (response) {
      const text = await response.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      if (response.status < 500) {
        const result = parsed && typeof parsed === "object" ? parsed : {};
        return { status: response.status, ok: response.ok, result, detail };
      }
      lastError = `${url} \u2192 HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
    }
    if (attempt < BOOTSTRAP_ATTEMPTS) {
      io.log?.(`${messages.waiting} (${lastError}); retrying in ${BOOTSTRAP_RETRY_MS / 1000}s...`);
      await sleep(BOOTSTRAP_RETRY_MS);
    }
  }
  throw new Error(`${messages.failure} after ${BOOTSTRAP_ATTEMPTS} attempts: ${lastError}`);
}
function describeBootstrap(config, result) {
  if (result.status === "exists") {
    return [`The site is already registered to the space ${result.accountUid}; nothing to create.`];
  }
  return [
    `Created the organization's space "${result.name}": ${result.accountUid}`,
    `Owner key file (the root of the space): ${result.keyPath}`,
    `To take root, import it in the vault at ${config.domain}/vault/settings (Import identity),`,
    `with the desktop app's key import, or 'seed-cli key import ${result.keyPath}'.`,
    "The mnemonic was never stored; this file is the only copy of the key outside the daemon."
  ];
}
async function bootstrapAfterDeploy(config, paths, opts, progress) {
  try {
    const result = await bootstrapSpace(config, paths, opts, { log: progress });
    return describeBootstrap(config, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      `The organization's space could not be created: ${message}`,
      `The node is up; retry with '${cmd("bootstrap-space")}'.`
    ];
  }
}
async function setSiteUrl(config, io = {}) {
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    throw new Error("Updating the space's site URL needs an enterprise node (no vault_admin_secret in config).");
  }
  const url = `${config.domain}/hm/api/enterprise-site-url`;
  const answer = await postAdminRoute(url, config.vault_admin_secret, {}, io, {
    waiting: "Site URL not updated yet",
    failure: "Could not update the space's site URL"
  });
  const result = answer.result;
  if (answer.ok) {
    const accountUid = typeof result.accountUid === "string" ? result.accountUid : "";
    const siteUrl = typeof result.siteUrl === "string" ? result.siteUrl : "";
    if (!accountUid || !siteUrl)
      throw new Error(`${url} answered without an account or site URL`);
    return {
      accountUid,
      siteUrl,
      changed: result.changed === true,
      previousSiteUrl: typeof result.previousSiteUrl === "string" ? result.previousSiteUrl : null
    };
  }
  if (answer.status === 404) {
    throw new Error(`${url} \u2192 HTTP 404: the web app has no site-url route. ` + `Its image predates it, or SEED_VAULT_ADMIN_SECRET is not set on seed-web; ` + `after '${cmd("deploy")}' with current images run '${cmd(`set-hostname ${config.domain}`)}'.`);
  }
  if (answer.status === 409) {
    throw new Error(`${url} \u2192 HTTP 409: the site has no registered space yet; run '${cmd("bootstrap-space")}' first.`);
  }
  throw new Error(`${url} \u2192 HTTP ${answer.status}${answer.detail ? `: ${answer.detail.slice(0, 500)}` : ""}`);
}
function describeSiteUrl(result) {
  if (!result.changed) {
    return [`The space ${result.accountUid} already points at ${result.siteUrl}; nothing to republish.`];
  }
  return [
    `Republished the home document of ${result.accountUid}: siteUrl is now ${result.siteUrl}` + (result.previousSiteUrl ? ` (was ${result.previousSiteUrl}).` : "."),
    "Passkeys are bound to the hostname: people who registered one on the old address",
    "sign in with their password and add a new passkey in the vault."
  ];
}
async function syncSiteUrlAfterDeploy(config, progress) {
  try {
    return describeSiteUrl(await setSiteUrl(config, { log: progress }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      `The space's site URL could not be updated: ${message}`,
      `The node is up on ${config.domain}; retry with '${cmd(`set-hostname ${config.domain}`)}'.`
    ];
  }
}
async function cmdSetHostname(paths, shell, args) {
  const hostname = (args[0] ?? "").trim().replace(/\/+$/, "");
  const urlError = hostname ? validateUrl(hostname) : "Required";
  if (urlError) {
    console.error(`Usage: ${cmd("set-hostname https://new.example.org")} (${urlError})`);
    process.exit(1);
  }
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(`'${cmd("set-hostname")}' needs an enterprise node; on a site run '${cmd("deploy --reconfigure")}' instead.`);
    process.exit(1);
  }
  const previous = config.domain;
  if (previous !== hostname) {
    config.domain = hostname;
    config.redirect_hostnames = redirectHostnames({
      domain: hostname,
      redirect_hostnames: [...config.redirect_hostnames ?? [], extractDns(previous)]
    });
    await writeConfig(config, paths);
    log(`Hostname changed from ${previous} to ${hostname}; ${extractDns(previous)} will redirect there. Redeploying.`);
    await deploy(config, paths, shell, false, {}, previous);
    return;
  }
  log(`The hostname is already ${hostname}; checking the space's site URL.`);
  for (const line of describeSiteUrl(await setSiteUrl(config, { log: (line2) => console.log(line2) })))
    console.log(line);
}
async function cmdBootstrapSpace(paths, headless) {
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(`'${cmd("bootstrap-space")}' needs an enterprise node (no vault_admin_secret in config).`);
    process.exit(1);
  }
  const result = await bootstrapSpace(config, paths, bootstrapOptionsFrom(headless), {
    log: (line) => console.log(line)
  });
  for (const line of describeBootstrap(config, result))
    console.log(line);
}
async function cmdRegister(paths, args) {
  const accountUid = args[0];
  if (!accountUid) {
    console.error(`Usage: ${cmd("register <accountUid>")}`);
    process.exit(1);
  }
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  if (!config.link_secret) {
    console.error("No registration secret found in config.");
    process.exit(1);
  }
  const configUrl = `${config.domain}/hm/api/config`;
  const siteResponse = await fetch(configUrl);
  if (!siteResponse.ok)
    throw new Error(`${configUrl} \u2192 HTTP ${siteResponse.status}`);
  const siteConfig = await siteResponse.json();
  if (siteConfig.registeredAccountUid) {
    console.error(`This site is already registered to ${siteConfig.registeredAccountUid}.`);
    console.error(`To re-register, reset web/config.json as described in the self-hosting guide and restart.`);
    process.exit(1);
  }
  if (!siteConfig.peerId)
    throw new Error(`${configUrl} did not report a peerId; is the daemon running?`);
  const result = await postJson(`${config.domain}/hm/api/register`, {
    registrationSecret: config.link_secret,
    accountUid,
    peerId: siteConfig.peerId,
    addrs: []
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(`
Registered ${accountUid} at ${config.domain}.`);
}
function extractInvitationLinks(result, vaultBase) {
  if (!result || typeof result !== "object")
    return [];
  const r2 = result;
  const toLink = (item) => {
    if (typeof item === "string")
      return item.startsWith("http") ? item : `${vaultBase}?invite=${item}`;
    if (item && typeof item === "object") {
      const o = item;
      if (typeof o.link === "string")
        return o.link;
      if (typeof o.url === "string")
        return o.url;
      if (typeof o.code === "string") {
        const email = typeof o.email === "string" && o.email ? `&email=${encodeURIComponent(o.email)}` : "";
        return `${vaultBase}?invite=${o.code}${email}`;
      }
    }
    return null;
  };
  const lists = [r2.invitations, r2.links, r2.codes].filter(Array.isArray);
  if (lists.length > 0)
    return lists[0].map(toLink).filter((l2) => !!l2);
  const single = toLink(r2);
  return single ? [single] : [];
}
function parseInviteArgs(args) {
  let email;
  let role = "reader";
  let send = true;
  let count;
  for (let i = 0;i < args.length; i++) {
    const a2 = args[i];
    if (a2 === "--role" || a2.startsWith("--role=")) {
      const value = a2.includes("=") ? a2.slice("--role=".length) : args[++i];
      if (value !== "reader" && value !== "writer")
        return { role, send, error: `--role must be reader or writer, not '${value ?? ""}'` };
      role = value;
    } else if (a2 === "--writer")
      role = "writer";
    else if (a2 === "--reader")
      role = "reader";
    else if (a2 === "--no-email")
      send = false;
    else if (/^\d+$/.test(a2))
      count = Number(a2);
    else if (a2.includes("@"))
      email = a2;
    else
      return { role, send, error: `unexpected argument '${a2}'` };
  }
  return { email, role, send, count };
}
async function cmdInvite(paths, args) {
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  if (!isEnterprise(config) || !config.vault_admin_secret) {
    console.error(`'${cmd("invite")}' needs an enterprise node (no vault_admin_secret in config).`);
    process.exit(1);
  }
  const parsed = parseInviteArgs(args);
  if (parsed.error) {
    console.error(`${parsed.error}. Usage: ${cmd("invite <email> [--role reader|writer] [--no-email]")}`);
    process.exit(1);
  }
  const { email, role, send, count } = parsed;
  if (!email) {
    console.error(`'${cmd("invite <email>")}' needs the invitee's email: invitations are scoped to one address and the link carries it.`);
    process.exit(1);
  }
  const body = { email, role, send };
  if (count)
    body.count = count;
  const vaultBase = `${config.domain}/vault`;
  const result = await postJson(`${vaultBase}/api/admin/invitations`, body, {
    authorization: `Bearer ${config.vault_admin_secret}`
  });
  const links = extractInvitationLinks(result, vaultBase);
  if (links.length === 0) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Invitation for ${email} (${role}):`);
  for (const link of links)
    console.log(`  ${link}`);
  const r2 = result ?? {};
  if (r2.emailed)
    console.log(`Emailed to ${email}.`);
  else if (send)
    console.log(`Not emailed: ${r2.emailError ?? "the vault did not send it"}. Share the link by hand.`);
  else
    console.log("Not emailed (--no-email). Share the link by hand.");
  if (role === "writer")
    console.log("They become a writer of the space as soon as their account exists.");
}
async function cmdSecret(paths) {
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Run '${cmd()}' first.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  if (!config.link_secret) {
    console.error("No registration secret found in config.");
    process.exit(1);
  }
  console.log(`${config.domain}/hm/register?secret=${config.link_secret}`);
  if (config.owner_account_uid) {
    console.log(`Owner key of the space ${config.owner_account_uid}: ${ownerKeyPath(paths, config.owner_account_uid)}`);
  }
}
async function cmdLogs(paths, args) {
  const service = args[0];
  const serviceName = service ? `seed-${service}` : "";
  try {
    execSync(`docker compose -f "${paths.composePath}" logs -f --tail 100 ${serviceName}`, { stdio: "inherit" });
  } catch {}
}
async function cmdCron(paths, shell, args) {
  const subcommand = args[0] ?? "install";
  if (subcommand === "remove") {
    const existing = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    if (!existing.includes("# seed-deploy") && !existing.includes("# seed-cleanup")) {
      console.log("No seed cron jobs found. Nothing to remove.");
      return;
    }
    const cleaned = removeSeedCronLines(existing);
    try {
      shell.run(`echo '${cleaned}' | crontab -`);
      console.log("Seed cron jobs removed.");
    } catch (err) {
      console.error(`Failed to remove cron jobs: ${err}`);
      process.exit(1);
    }
    return;
  }
  if (subcommand === "install") {
    await setupCron(paths, shell);
    const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    const deployCron = crontab.split(`
`).find((l2) => l2.includes("# seed-deploy"));
    const cleanupCron = crontab.split(`
`).find((l2) => l2.includes("# seed-cleanup"));
    console.log("Cron jobs installed:");
    console.log(`  Auto-update: ${deployCron ?? "(missing)"}`);
    console.log(`  Cleanup:     ${cleanupCron ?? "(missing)"}`);
    return;
  }
  console.error(`Unknown cron subcommand: ${subcommand}`);
  console.error(`Usage: ${cmd("cron [install|remove]")}`);
  process.exit(1);
}
function extractSeedCronLines(crontab) {
  return crontab.split(`
`).filter((line) => line.includes("# seed-deploy") || line.includes("# seed-cleanup"));
}
function removeSeedCronLines(existing) {
  const cleaned = existing.split(`
`).filter((line) => !line.includes("# seed-deploy") && !line.includes("# seed-cleanup")).join(`
`).trim();
  return cleaned ? cleaned + `
` : "";
}
async function backupMembers(paths, config) {
  const members = ["config.json", "backup-meta.json", "docker-compose.yml", "web", "daemon", "proxy"];
  const extra = isEnterprise(config) ? ENTERPRISE_DATA_DIRS : config.agents ? ["agents"] : [];
  for (const dir of extra) {
    try {
      await access(join(paths.seedDir, dir));
      members.push(dir);
    } catch {}
  }
  return members;
}
async function cmdBackup(paths, shell, args) {
  checkDockerAccess(shell);
  if (!await configExists(paths)) {
    console.error(`No config found at ${paths.configPath}. Nothing to back up.`);
    process.exit(1);
  }
  const config = await readConfig(paths);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultPath = join(paths.seedDir, "backups", `seed-backup-${timestamp}.tar.gz`);
  const backupFile = args[0] || defaultPath;
  const backupDir = dirname(backupFile);
  await mkdir(backupDir, { recursive: true });
  const crontab = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  const meta = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    hostname: config.domain,
    seedDir: paths.seedDir,
    cron: extractSeedCronLines(crontab)
  };
  await writeFile(join(paths.seedDir, "backup-meta.json"), JSON.stringify(meta, null, 2) + `
`, "utf-8");
  console.log("Stopping containers for consistent backup...");
  const env = buildComposeEnv(config, paths);
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" stop`);
  const seedBase = basename(paths.seedDir);
  const seedParent = dirname(paths.seedDir);
  const members = await backupMembers(paths, config);
  try {
    shell.run(`tar -czf "${backupFile}" -C "${seedParent}" --exclude="${seedBase}/backups" --exclude="${seedBase}/.env" --exclude="${seedBase}/deploy.js" --exclude="${seedBase}/deploy.log" ${members.map((m3) => `"${seedBase}/${m3}"`).join(" ")}`);
  } catch (err) {
    console.error(`Backup failed: ${err}`);
    shell.runSafe(`${env} docker compose -f "${paths.composePath}" start`);
    process.exit(1);
  }
  shell.runSafe(`rm -f "${join(paths.seedDir, "backup-meta.json")}"`);
  console.log("Restarting containers...");
  shell.runSafe(`${env} docker compose -f "${paths.composePath}" start`);
  const size = shell.runSafe(`du -h "${backupFile}"`)?.split("\t")[0] ?? "unknown";
  console.log(`
Backup created: ${backupFile} (${size})`);
}
async function cmdRestore(paths, shell, args) {
  checkDockerAccess(shell);
  const backupFile = args[0];
  if (!backupFile) {
    console.error(`Usage: ${cmd("restore <backup-file.tar.gz>")}`);
    process.exit(1);
  }
  try {
    await access(backupFile);
  } catch {
    console.error(`File not found: ${backupFile}`);
    process.exit(1);
  }
  let meta = null;
  const seedBase = basename(paths.seedDir);
  const metaJson = shell.runSafe(`tar -xzf "${backupFile}" -O "${seedBase}/backup-meta.json" 2>/dev/null`);
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson);
    } catch {}
  }
  we(`Seed Node Restore v${VERSION}`);
  if (meta) {
    ye([`Created:  ${meta.timestamp}`, `Source:   ${meta.hostname}`, `Version:  ${meta.version}`].join(`
`), "Restoring from backup");
  }
  const confirmed = await me({
    message: `This will overwrite all data in ${paths.seedDir}. Continue?`
  });
  if (BD(confirmed) || !confirmed) {
    ve("Restore cancelled.");
    console.log(`
Run '${cmd("restore <file>")}' to try again.
`);
    process.exit(0);
  }
  console.log("Stopping existing containers...");
  shell.runSafe(`${await composeEnvPrefix(paths)} docker compose -f "${paths.composePath}" down`);
  console.log("Extracting backup...");
  await ensureSeedDir(paths, shell);
  const seedParent = dirname(paths.seedDir);
  shell.run(`tar -xzf "${backupFile}" -C "${seedParent}"`);
  shell.runSafe(`rm -f "${join(paths.seedDir, "backup-meta.json")}"`);
  if (meta?.cron && meta.cron.length > 0) {
    const existingCron = shell.runSafe("crontab -l 2>/dev/null") ?? "";
    const newCrontab = buildCrontab(existingCron, paths);
    try {
      shell.run(`echo '${newCrontab}' | crontab -`);
      console.log("Cron jobs restored.");
    } catch {
      console.log("Warning: Could not restore cron jobs.");
    }
  }
  const wantsReview = await me({
    message: "Would you like to review the configuration before deploying?",
    initialValue: false
  });
  let config;
  if (!BD(wantsReview) && wantsReview) {
    const restored = await readConfig(paths);
    if (isEnterprise(restored)) {
      config = await runEnterpriseWizard(paths, restored);
      await deploy(config, paths, shell);
      fe(`Restore complete! Your Seed node is running.
${MANAGE_HINT}`);
      return;
    }
    const asOldInstall = {
      workspace: paths.seedDir,
      secret: restored.link_secret,
      secretConsumed: false,
      hostname: restored.domain,
      logLevel: restored.compose_envs.LOG_LEVEL,
      imageTag: restored.release_channel,
      testnet: restored.testnet,
      gateway: restored.gateway,
      trafficStats: restored.analytics
    };
    config = await runMigrationWizard(asOldInstall, paths, shell);
  } else {
    config = await readConfig(paths);
  }
  await deploy(config, paths, shell);
  fe(`Restore complete! Your Seed node is running.
${MANAGE_HINT}`);
}
async function cmdUninstall(paths, shell) {
  checkDockerAccess(shell);
  we(`Seed Node Uninstall v${VERSION}`);
  ye([
    "This will permanently delete:",
    `  - All Seed containers`,
    `  - All node data at ${paths.seedDir}/ (daemon identity, web data, config)`,
    `  - Cron jobs for seed-deploy and seed-cleanup`,
    "",
    "This action is IRREVERSIBLE."
  ].join(`
`), "Warning");
  const wantsBackup = await me({
    message: "Would you like to create a backup before uninstalling?",
    initialValue: true
  });
  if (!BD(wantsBackup) && wantsBackup) {
    await cmdBackup(paths, shell, []);
  }
  const confirmation = await ue({
    message: 'Type "yes" to confirm uninstallation:',
    validate: (v3) => {
      if (v3 !== "yes")
        return 'Please type "yes" to confirm, or press Ctrl+C to cancel.';
    }
  });
  if (BD(confirmation)) {
    ve("Uninstall cancelled.");
    process.exit(0);
  }
  console.log("Stopping and removing containers...");
  shell.runSafe(`${await composeEnvPrefix(paths)} docker compose -f "${paths.composePath}" down`);
  const existingCron = shell.runSafe("crontab -l 2>/dev/null") ?? "";
  if (existingCron.includes("# seed-deploy") || existingCron.includes("# seed-cleanup")) {
    const cleaned = removeSeedCronLines(existingCron);
    try {
      shell.run(`echo '${cleaned}' | crontab -`);
      console.log("Cron jobs removed.");
    } catch {
      console.log("Warning: Could not remove cron jobs.");
    }
  }
  console.log(`Removing ${paths.seedDir}...`);
  try {
    shell.run(`rm -rf "${paths.seedDir}"`);
  } catch {
    console.log(`Could not remove ${paths.seedDir}. Trying with sudo...`);
    shell.run(`sudo rm -rf "${paths.seedDir}"`);
  }
  fe("Seed node uninstalled.");
}
async function main() {
  const { command, args, reconfigure, advanced, dir, profile, headless } = parseArgs();
  const paths = makePaths(dir ?? DEFAULT_SEED_DIR);
  const shell = makeShellRunner();
  switch (command) {
    case "help":
      printHelp();
      return;
    case "version":
      console.log(VERSION);
      return;
    case "deploy":
      return cmdDeploy(paths, shell, reconfigure, advanced, profile, headless);
    case "upgrade":
      return cmdUpgrade(paths);
    case "stop":
      return cmdStop(paths, shell);
    case "start":
      return cmdStart(paths, shell);
    case "restart":
      return cmdRestart(paths, shell);
    case "doctor":
      return cmdDoctor(paths, shell);
    case "secret":
      return cmdSecret(paths);
    case "config":
      return cmdConfig(paths);
    case "logs":
      return cmdLogs(paths, args);
    case "cron":
      return cmdCron(paths, shell, args);
    case "backup":
      return cmdBackup(paths, shell, args);
    case "restore":
      return cmdRestore(paths, shell, args);
    case "uninstall":
      return cmdUninstall(paths, shell);
    case "register":
      return cmdRegister(paths, args);
    case "invite":
      return cmdInvite(paths, args);
    case "bootstrap-space":
      return cmdBootstrapSpace(paths, headless);
    case "set-hostname":
      return cmdSetHostname(paths, shell, args);
  }
}
if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
export {
  writeConfig,
  validateDockerImageTag,
  validateDockerImageRef,
  takeOverHost,
  stopStackByProject,
  smtpFromEnv,
  siteUrlCheck,
  shellQuote,
  sha256,
  setupCron,
  setSiteUrl,
  selfUpdate,
  rollbackTagRefs,
  rollbackImageTargets,
  resolveBunPath,
  requiredContainers,
  removeSeedCronLines,
  removeLegacyHostCronLines,
  removeLegacyHostCron,
  removeLegacyAutoupdaters,
  redirectHostnames,
  redactConfig,
  readConfig,
  printHelp,
  parseWebEnv,
  parseInviteArgs,
  parseImageTag,
  parseDaemonEnv,
  parseArgs,
  ownerKeyPath,
  notifyHost,
  migrateLegacyCron,
  makeShellRunner,
  makePaths,
  log,
  isEnterprise,
  installWrapper,
  injectServiceDirectives,
  inferEnvironment,
  headlessEnterpriseConfig,
  handleForeignStack,
  getWorkspaceDirs,
  getRunningInstallDir,
  getOpsBaseUrl,
  getDeployScriptUrl,
  getContainerImages,
  getContainerEnvs,
  generateSecret,
  generateCaddyfile,
  freeConflictingPortBindings,
  extractSeedCronLines,
  extractInvitationLinks,
  extractDns,
  expectedServiceImages,
  environmentPresets,
  enterpriseTestnetName,
  enterpriseIsolationChecks,
  ensureSeedDir,
  emailRelayOf,
  emailRelayFromEnv,
  deviceDirectives,
  detectOldInstall,
  detectForeignStack,
  describeSiteUrl,
  describePullFailure,
  describeNotify,
  describeBootstrap,
  describeBindFailure,
  deploy,
  containersMatchReleaseChannel,
  configWarnings,
  configExists,
  composeProjectName,
  composeProfiles,
  composeFileName,
  cmd,
  clearSeedCron,
  checkGpuAcceleration,
  checkForNewImages,
  checkContainersHealthy,
  buildEnterpriseConfig,
  buildCrontab,
  buildComposeEnv,
  bootstrapSpace,
  bootstrapOptionsFrom,
  backupMembers,
  autoUpdates,
  assertNoForeignStack,
  agentsHost,
  VERSION,
  VAULT_ADMIN_SECRET_LENGTH,
  SESSION_SECRET_LENGTH,
  SESSION_CHECK_URI,
  SEED_PUBLISHED_PORTS,
  OWNER_KEY_DIR,
  OPS_BASE_URL,
  NOTIFY_SERVICE_HOST,
  NOTIFY_PROXY_PATHS,
  NOTIFY_API_PATH,
  LIGHTNING_URL_TESTNET,
  LIGHTNING_URL_MAINNET,
  LEGACY_CONTAINER_NAMES,
  LEGACY_AUTOUPDATER_IMAGES,
  IMAGE_PULL_TIMEOUT_MS,
  GITHUB_RELEASES_API,
  ENTERPRISE_OPEN_PATHS,
  ENTERPRISE_MAX_BODY,
  ENTERPRISE_DATA_DIRS,
  DEV_DEPLOY_SCRIPT_URL,
  DEPLOY_SCRIPT_PATH,
  DEPLOY_PROFILES,
  DEFAULT_UPSTREAM_API_URL,
  DEFAULT_SEED_DIR,
  DEFAULT_REPO_URL,
  DEFAULT_RELEASE_CHANNEL,
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_DATA_DIR,
  DEFAULT_COMPOSE_URL,
  CURL_INSTALL_CMD,
  CLI_INSTALLED,
  BOOTSTRAP_RETRY_MS,
  BOOTSTRAP_ATTEMPTS,
  AGENTS_API_PATH
};
