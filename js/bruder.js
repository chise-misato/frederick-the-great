(function () {
  'use strict';

  // ホーエンツォレルン兄弟の関係年表
  // データは data/bruder/*.json に分けて置き、このファイルは表示だけを担う。

  var DATA_DIR = 'data/bruder/';
  var ZOOM_MIN = 4, ZOOM_MAX = 320;
  var LABEL_MIN_PPY = 18;   // これ未満のズームでは出来事ラベルを出さない
  var LABEL_MAX_ROWS = 4;
  var LABEL_MAX_CHARS = 18;
  var EVENT_MIN_GAP = 14;   // 同じ線上で出来事記号が重ならない最小間隔(px)
  var CAT_STRIPE = 3.4;     // 複数分類の平行線の間隔

  var G = { axisH: 28, ctxRow: 22, labelRow: 20, laneH: 64, padL: 28, padR: 56 };

  var S = {
    people: [], peopleById: new Map(),
    catList: [], cats: new Map(), srcTypes: new Map(), layers: new Map(),
    sources: new Map(), events: [], eventsById: new Map(),
    context: [], contextById: new Map(),
    ppy: 26, yearMin: 1700, yearMax: 1820,
    visPeople: new Set(), visCats: new Set(), showCtx: true, showBands: true,
    selected: null,
    warnings: [],
    L: null
  };

  var els = {};

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hasYear(d) { return !!d && typeof d.year === 'number'; }

  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }

  // 日付を小数年に変換する。edge: 'start' | 'mid' | 'end'
  // 精度が年のみなら年の幅、年月なら月の幅を持つ。不明な部分は推測しない。
  function dateFrac(d, edge) {
    if (!hasYear(d)) return null;
    var y = d.year;
    if (d.month == null) return edge === 'start' ? y : edge === 'end' ? y + 1 : y + 0.5;
    var m0 = (d.month - 1) / 12;
    if (d.day == null) return edge === 'start' ? y + m0 : edge === 'end' ? y + m0 + 1 / 12 : y + m0 + 1 / 24;
    var dim = daysIn(y, d.month), unit = 1 / dim / 12;
    var base = y + m0 + (d.day - 1) * unit;
    return edge === 'start' ? base : edge === 'end' ? base + unit : base + unit / 2;
  }

  function precision(d) {
    if (!hasYear(d)) return 'none';
    return d.month == null ? 'year' : d.day == null ? 'month' : 'day';
  }
  var PREC_LABEL = { year: '年のみ判明', month: '年月まで判明', day: '年月日まで判明', none: '日付不明' };

  function fmtDate(d) {
    if (!hasYear(d)) return '年代不明';
    var s = d.year + '年';
    if (d.month != null) { s += d.month + '月'; if (d.day != null) s += d.day + '日'; }
    if (d.circa) s += '頃';
    return s;
  }
  function fmtRange(a, b) { return hasYear(b) ? fmtDate(a) + '～' + fmtDate(b) : fmtDate(a); }
  function lifeYears(p) {
    return (hasYear(p.birth) ? p.birth.year : '?') + '–' + (hasYear(p.death) ? p.death.year : '');
  }

  // ---------- age ----------
  // 日付を「最も早い日～最も遅い日」の幅として扱い、満年齢の最小・最大を求める。
  // 生年月日・出来事の日付とも、年のみ／年月のみ／年月日のいずれでもよい。

  function dayBounds(d) {
    if (!hasYear(d)) return null;
    if (d.month == null) return [[d.year, 1, 1], [d.year, 12, 31]];
    if (d.day == null) return [[d.year, d.month, 1], [d.year, d.month, daysIn(d.year, d.month)]];
    return [[d.year, d.month, d.day], [d.year, d.month, d.day]];
  }
  function cmpDay(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
  function ageOn(b, e) { return e[0] - b[0] - ((e[1] < b[1] || (e[1] === b[1] && e[2] < b[2])) ? 1 : 0); }

  // person: people.json の人物、from/to: 出来事の日付（to は期間の終わり、省略可）
  // 戻り値 { status: 'ok'|'unknown'|'before-birth'|'after-death', min, max, circa }
  function ageAt(person, from, to) {
    var b = dayBounds(person.birth), e1 = dayBounds(from), e2 = dayBounds(hasYear(to) ? to : from);
    if (!b || !e1) return { status: 'unknown' };
    var eFirst = e1[0], eLast = e2[1];
    var circa = !!(person.birth.circa || from.circa || (to && to.circa));
    if (cmpDay(eLast, b[0]) < 0) return { status: 'before-birth' };
    var dth = dayBounds(person.death);
    if (dth && cmpDay(eFirst, dth[1]) > 0) return { status: 'after-death' };
    if (dth && cmpDay(eLast, dth[1]) > 0) eLast = dth[1];   // 没年を超える幅は没時までに切り詰める
    return { status: 'ok', min: Math.max(0, ageOn(b[1], eFirst)), max: ageOn(b[0], eLast), circa: circa };
  }

  function fmtAge(a) {
    if (a.status === 'unknown') return '年齢不明';
    if (a.status === 'before-birth') return '誕生前';
    if (a.status === 'after-death') return '没後';
    var s = a.min === a.max ? a.min + '歳' : a.min + '〜' + a.max + '歳';
    return a.circa ? '約' + s : s;
  }

  function ageNote(a, person) {
    if (a.status !== 'ok' || (a.min === a.max && !a.circa)) return '';
    return a.circa ? '日付に「頃」を含むため概算です' :
      (precision(person.birth) !== 'day' ? '生年月日が年月日まで判明していないため幅があります'
        : '出来事の日付が年月日まで確定していないため幅があります');
  }

  function X(y) { return G.padL + (y - S.yearMin) * S.ppy; }
  function yearAt(px) { return S.yearMin + (px - G.padL) / S.ppy; }

  var measureCtx = null;
  function textW(s, size) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = (size || 12) + 'px "EB Garamond", "Noto Serif JP", serif';
    return measureCtx.measureText(s).width;
  }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function evStart(ev) { return dateFrac(ev.date, 'start'); }
  function evEnd(ev) { return dateFrac(hasYear(ev.dateEnd) ? ev.dateEnd : ev.date, 'end'); }
  function evMid(ev) { return hasYear(ev.dateEnd) ? (evStart(ev) + evEnd(ev)) / 2 : dateFrac(ev.date, 'mid'); }
  function evCats(ev) { return (ev.categories && ev.categories.length) ? ev.categories : ['other']; }
  function personName(id) { var p = S.peopleById.get(id); return p ? p.nameJa : id; }
  function catLabel(id) { var c = S.cats.get(id); return c ? c.label : id; }

  // ---------- data ----------

  function loadJSON(name) {
    return fetch(DATA_DIR + name + '.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + '.json を読み込めません (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  function warn(msg) { S.warnings.push(msg); }

  function ingest(people, tax, sources, events, context) {
    // lane: false の人物は年表の線を持たない関連人物（relatedPeople から参照する）
    var allPeople = people.people || [];
    allPeople.forEach(function (p) { S.peopleById.set(p.id, p); });
    S.people = allPeople.filter(function (p) { return p.lane !== false; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    S.catList = tax.eventCategories || [];
    S.catList.forEach(function (c) { S.cats.set(c.id, c); });
    if (!S.cats.has('other')) { var o = { id: 'other', label: 'その他', color: '#7d8790' }; S.catList.push(o); S.cats.set('other', o); }
    (tax.sourceTypes || []).forEach(function (t) { S.srcTypes.set(t.id, t); });
    (tax.contextLayers || []).forEach(function (l) { S.layers.set(l.id, l); });

    (sources.sources || []).forEach(function (s) {
      if (S.sources.has(s.id)) warn('史料IDが重複しています: ' + s.id);
      S.sources.set(s.id, s);
    });
    S.events = events.events || [];
    S.events.forEach(function (e) {
      if (S.eventsById.has(e.id)) warn('出来事IDが重複しています: ' + e.id);
      S.eventsById.set(e.id, e);
    });
    S.context = context.context || [];
    S.context.forEach(function (c) { S.contextById.set(c.id, c); });

    validate();

    var view = tax.view || {};
    if (view.pxPerYear) S.ppy = clamp(view.pxPerYear, ZOOM_MIN, ZOOM_MAX);
    S.initialCenter = view.centerYear;

    var ys = [];
    S.people.forEach(function (p) { if (hasYear(p.birth)) ys.push(p.birth.year); if (hasYear(p.death)) ys.push(p.death.year); });
    S.events.forEach(function (e) { if (hasYear(e.date)) ys.push(e.date.year); });
    S.context.forEach(function (c) { if (hasYear(c.start)) ys.push(c.start.year); if (hasYear(c.end)) ys.push(c.end.year); });
    if (ys.length) {
      S.yearMin = Math.floor((Math.min.apply(null, ys) - 3) / 5) * 5;
      S.yearMax = Math.ceil((Math.max.apply(null, ys) + 4) / 5) * 5;
    }

    S.people.forEach(function (p) { if (p.defaultVisible !== false) S.visPeople.add(p.id); });
    S.catList.forEach(function (c) { S.visCats.add(c.id); });
  }

  function validDate(d, where) {
    if (d == null || !Object.keys(d).length) return;
    if (!hasYear(d)) { warn(where + ': year が数値ではありません'); return; }
    if (d.month != null && (d.month < 1 || d.month > 12)) warn(where + ': month が範囲外です');
    if (d.day != null && (d.month == null || d.day < 1 || d.day > daysIn(d.year, d.month))) warn(where + ': day が不正です');
  }

  function validate() {
    var idRe = /^[a-z0-9-]+$/;
    S.catList.forEach(function (c) { if (!idRe.test(c.id)) warn('分類IDは半角英小文字・数字・ハイフンのみ: ' + c.id); });
    S.layers.forEach(function (l) { if (!idRe.test(l.id)) warn('レイヤーIDは半角英小文字・数字・ハイフンのみ: ' + l.id); });
    S.peopleById.forEach(function (p) { validDate(p.birth, '人物 ' + p.id + ' の生年'); validDate(p.death, '人物 ' + p.id + ' の没年'); });
    S.sources.forEach(function (s) {
      if (s.type && !S.srcTypes.has(s.type)) warn('史料 ' + s.id + ': 未定義の史料種別 ' + s.type);
      validDate(s.date, '史料 ' + s.id);
    });
    S.context.forEach(function (c) {
      if (!S.layers.has(c.layer)) warn('情勢 ' + c.id + ': 未定義のレイヤー ' + c.layer);
      validDate(c.start, '情勢 ' + c.id + ' の開始'); validDate(c.end, '情勢 ' + c.id + ' の終了');
    });
    S.events.forEach(function (e) {
      var w = '出来事 ' + e.id;
      if (!e.title) warn(w + ': title がありません');
      validDate(e.date, w); validDate(e.dateEnd, w + ' の終了');
      (e.people || []).forEach(function (id) {
        var p = S.peopleById.get(id);
        if (!p) warn(w + ': 未登録の人物 ' + id);
        else if (p.lane === false) warn(w + ': people には年表の線を持つ人物のみ指定できます（関連人物は relatedPeople へ）: ' + id);
      });
      if (!(e.people || []).length) warn(w + ': 関係人物がありません');
      (e.relatedPeople || []).forEach(function (r) {
        var id = typeof r === 'string' ? r : r.id;
        if (id && !S.peopleById.has(id)) warn(w + ': 未登録の関連人物 ' + id);
        if (!id && !(r && r.name)) warn(w + ': 関連人物に id または name がありません');
      });
      (e.discrepancies || []).forEach(function (f) {
        (f.sources || []).forEach(function (id) { if (!S.sources.has(id)) warn(w + ': 未登録の史料 ' + id); });
      });
      validDate(e.recordedDate, w + ' の記述日');
      (e.sources || []).forEach(function (l) { validDate(l.date, w + ' の史料 ' + l.id + ' の記述日'); });
      (e.categories || []).forEach(function (id) { if (!S.cats.has(id)) warn(w + ': 未定義の分類 ' + id); });
      (e.sources || []).forEach(function (l) { if (!S.sources.has(l.id)) warn(w + ': 未登録の史料 ' + l.id); });
      (e.facts || []).concat(e.interpretations || []).forEach(function (f) {
        (f.sources || []).forEach(function (id) { if (!S.sources.has(id)) warn(w + ': 未登録の史料 ' + id); });
      });
      (e.contextIds || []).forEach(function (id) { if (!S.contextById.has(id)) warn(w + ': 未登録の情勢 ' + id); });
    });
  }

  // 分類・レイヤーの色は JSON 側で管理し、CSS変数として注入する（ダークモード対応）
  function injectColors() {
    var light = [], dark = [];
    S.catList.forEach(function (c) {
      light.push('--cat-' + c.id + ':' + c.color + ';');
      dark.push('--cat-' + c.id + ':' + (c.colorDark || c.color) + ';');
    });
    S.layers.forEach(function (l) {
      light.push('--layer-' + l.id + ':' + l.color + ';');
      dark.push('--layer-' + l.id + ':' + (l.colorDark || l.color) + ';');
    });
    var css = ':root{' + light.join('') + '}\n' +
      '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + dark.join('') + '}}\n' +
      ':root[data-theme="dark"]{' + dark.join('') + '}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- filtering ----------

  // 2人以上を選択中：選択した人物のうち2人以上が関わる出来事（＝選択した人物どうしの出来事）
  // 1人だけ選択中：その人物が関わる出来事すべて
  function eventVisible(ev) {
    var involved = ev.people || [];
    var n = involved.filter(function (id) { return S.visPeople.has(id); }).length;
    var need = (S.visPeople.size >= 2 && involved.length >= 2) ? 2 : 1;
    if (n < need) return false;
    return evCats(ev).some(function (c) { return S.visCats.has(c); });
  }

  function visibleEvents() {
    return S.events.filter(function (e) { return hasYear(e.date) && eventVisible(e); })
      .sort(function (a, b) { return evMid(a) - evMid(b); });
  }

  // ---------- layout ----------

  function isNarrow() { return window.matchMedia('(max-width: 640px)').matches; }

  function computeLayout() {
    G.laneH = isNarrow() ? 54 : 64;
    var L = { lanes: new Map() };
    var y = G.axisH + 8;

    // 情勢レイヤー：重ならないように行を割り当てる
    L.ctxTop = y; L.ctxRows = 0; L.ctxItems = [];
    if (S.showCtx) {
      var rowEnd = [];
      S.context.filter(function (c) { return hasYear(c.start); })
        .map(function (c) {
          var xs = X(dateFrac(c.start, 'start'));
          var xe = hasYear(c.end) ? X(dateFrac(c.end, 'end')) : null;
          return { c: c, xs: xs, xe: xe, tw: textW(c.title, 11) + 10 };
        })
        .sort(function (a, b) { return a.xs - b.xs; })
        .forEach(function (it) {
          var left = it.xe == null ? it.xs - 6 : it.xs;
          var barW = it.xe == null ? 0 : it.xe - it.xs;
          it.inside = barW >= it.tw;
          var right = it.xe == null ? it.xs + 8 + it.tw : (it.inside ? it.xe : it.xe + it.tw);
          var r = 0;
          while (r < rowEnd.length && rowEnd[r] + 4 > left) r++;
          rowEnd[r] = right;
          it.row = r;
          L.ctxItems.push(it);
        });
      L.ctxRows = Math.max(1, rowEnd.length);
      y += L.ctxRows * G.ctxRow + 8;
    }

    // 人物の線
    var vis = S.people.filter(function (p) { return S.visPeople.has(p.id); });
    var labelsTop = y;

    // 出来事ラベル行（ズームが十分なときだけ）
    var evs = visibleEvents();
    L.showLabels = S.ppy >= LABEL_MIN_PPY;
    var placed = [];
    var lastX = new Map();
    var laneIdx = new Map(vis.map(function (p, i) { return [p.id, i]; }));
    evs.forEach(function (ev) {
      var idx = (ev.people || []).filter(function (id) { return laneIdx.has(id); })
        .map(function (id) { return laneIdx.get(id); }).sort(function (a, b) { return a - b; });
      var lo = idx[0], hi = idx[idx.length - 1];
      var x = X(evMid(ev));
      for (var i = lo; i <= hi; i++) { if (lastX.has(i)) x = Math.max(x, lastX.get(i) + EVENT_MIN_GAP); }
      for (var j = lo; j <= hi; j++) lastX.set(j, x);
      placed.push({ ev: ev, x: x, lanes: idx, xs: X(evStart(ev)), xe: X(evEnd(ev)) });
    });
    L.labelRows = 0;
    if (L.showLabels) {
      var rows = [];
      placed.forEach(function (p) {
        var text = trunc(p.ev.shortTitle || p.ev.title, LABEL_MAX_CHARS);
        var w = textW(text, 12) + 6;
        var r = 0;
        while (r < rows.length && rows[r] + 10 > p.x - 3) r++;
        if (r >= LABEL_MAX_ROWS) { p.labelRow = -1; return; }
        rows[r] = p.x - 3 + w;
        p.labelRow = r; p.labelText = text;
      });
      L.labelRows = Math.max(1, rows.length);
      L.labelTop = y;
      y += L.labelRows * G.labelRow + 6;
    }

    L.lanesTop = y;
    vis.forEach(function (p, i) { L.lanes.set(p.id, { idx: i, cy: y + G.laneH * (i + 0.5), p: p }); });
    y += vis.length * G.laneH;
    L.lanesBottom = y;
    placed.forEach(function (p) {
      p.ys = p.lanes.map(function (i) { return L.lanesTop + G.laneH * (i + 0.5); });
      p.yTop = p.ys[0]; p.yBot = p.ys[p.ys.length - 1];
    });
    L.placed = placed;
    L.vis = vis;
    L.height = y + G.axisH + 4;
    L.width = X(S.yearMax) + G.padR;
    return L;
  }

  // ---------- render ----------

  function tickStep() {
    var steps = [1, 2, 5, 10, 20, 50];
    for (var i = 0; i < steps.length; i++) if (steps[i] * S.ppy >= 46) return steps[i];
    return 50;
  }

  function axisSvg(L, yLine, labelBelow) {
    var out = [], step = tickStep();
    out.push('<line class="t-axisline" x1="' + X(S.yearMin) + '" x2="' + X(S.yearMax) + '" y1="' + yLine + '" y2="' + yLine + '"/>');
    for (var y = S.yearMin; y <= S.yearMax; y++) {
      var x = X(y);
      if (y % step === 0) {
        out.push('<line class="t-tick major" x1="' + x + '" x2="' + x + '" y1="' + (yLine - 5) + '" y2="' + (yLine + 5) + '"/>');
        out.push('<text class="t-ticklabel" x="' + x + '" y="' + (labelBelow ? yLine + 18 : yLine - 9) + '">' + y + '</text>');
      } else if (S.ppy >= 5) {
        out.push('<line class="t-tick" x1="' + x + '" x2="' + x + '" y1="' + (yLine - 3) + '" y2="' + (yLine + 3) + '"/>');
      }
      if (S.ppy >= 120 && y < S.yearMax) {
        for (var m = 0; m < 12; m++) {
          var xm = X(y + m / 12);
          if (m > 0) out.push('<line class="t-tick month" x1="' + xm + '" x2="' + xm + '" y1="' + (yLine - 2) + '" y2="' + (yLine + 2) + '"/>');
          if (S.ppy >= 260 && m > 0) out.push('<text class="t-monthlabel" x="' + X(y + (m + 0.5) / 12) + '" y="' + (labelBelow ? yLine + 16 : yLine - 4) + '">' + (m + 1) + '</text>');
        }
      }
    }
    return out.join('');
  }

  function render() {
    var L = computeLayout();
    S.L = L;
    var o = [];
    var step = tickStep();
    var gridTop = S.showCtx ? L.ctxTop - 4 : L.lanesTop - 8;

    // 年代のグリッド
    for (var y = Math.ceil(S.yearMin / step) * step; y <= S.yearMax; y += step) {
      o.push('<line class="t-grid' + (y % 10 === 0 ? ' decade' : '') + '" x1="' + X(y) + '" x2="' + X(y) + '" y1="' + gridTop + '" y2="' + L.lanesBottom + '"/>');
    }

    // 戦争期間の背景帯
    if (S.showCtx && S.showBands) {
      L.ctxItems.forEach(function (it) {
        if (!it.c.band || it.xe == null) return;
        o.push('<rect class="ctx-band" x="' + it.xs + '" y="' + (L.lanesTop - 6) + '" width="' + (it.xe - it.xs) + '" height="' + (L.lanesBottom - L.lanesTop + 6) + '" style="fill:var(--layer-' + it.c.layer + ')"/>');
      });
    }

    o.push(axisSvg(L, G.axisH - 2, false));

    // 情勢レイヤー
    if (S.showCtx) {
      L.ctxItems.forEach(function (it) {
        var c = it.c, cy = L.ctxTop + it.row * G.ctxRow + G.ctxRow / 2;
        var sel = S.selected && S.selected.kind === 'context' && S.selected.id === c.id;
        var col = 'var(--layer-' + c.layer + ')';
        var label = esc(fmtRange(c.start, c.end) + ' ' + c.title);
        o.push('<g class="ctx' + (sel ? ' is-selected' : '') + '" data-ctx="' + esc(c.id) + '" tabindex="0" role="button" aria-label="' + label + '">');
        if (it.xe == null) {
          o.push('<rect class="ctx-hit" x="' + (it.xs - 8) + '" y="' + (cy - 9) + '" width="' + (it.tw + 18) + '" height="18"/>');
          o.push('<path class="ctx-point" d="M' + it.xs + ' ' + (cy - 5.5) + 'l5.5 5.5l-5.5 5.5l-5.5-5.5z" style="fill:' + col + '"/>');
          o.push('<text class="ctx-text" x="' + (it.xs + 9) + '" y="' + (cy + 4) + '">' + esc(c.title) + '</text>');
        } else {
          var w = Math.max(2, it.xe - it.xs);
          o.push('<rect class="ctx-hit" x="' + it.xs + '" y="' + (cy - 9) + '" width="' + (it.inside ? w : w + it.tw) + '" height="18"/>');
          o.push('<rect class="ctx-bar" x="' + it.xs + '" y="' + (cy - 7) + '" width="' + w + '" height="14" rx="2" style="stroke:' + col + ';fill:' + col + '"/>');
          o.push('<text class="ctx-text' + (it.inside ? ' inside' : '') + '" x="' + (it.inside ? it.xs + 5 : it.xe + 5) + '" y="' + (cy + 4) + '">' + esc(c.title) + '</text>');
        }
        o.push('</g>');
      });
    }

    // 人物の線（生没年のみを表す）
    L.vis.forEach(function (p) {
      var lane = L.lanes.get(p.id);
      if (!hasYear(p.birth)) return;
      var x1 = X(dateFrac(p.birth, 'mid'));
      var x2 = hasYear(p.death) ? X(dateFrac(p.death, 'mid')) : X(S.yearMax);
      var cy = lane.cy;
      o.push('<line class="t-life" x1="' + x1 + '" x2="' + x2 + '" y1="' + cy + '" y2="' + cy + '"/>');
      o.push('<line class="t-term" x1="' + x1 + '" x2="' + x1 + '" y1="' + (cy - 8) + '" y2="' + (cy + 8) + '"/>');
      if (hasYear(p.death)) o.push('<line class="t-term" x1="' + x2 + '" x2="' + x2 + '" y1="' + (cy - 8) + '" y2="' + (cy + 8) + '"/>');
      o.push('<text class="t-lifeyear" x="' + x1 + '" y="' + (cy + 22) + '">' + p.birth.year + '</text>');
      if (hasYear(p.death)) o.push('<text class="t-lifeyear" x="' + x2 + '" y="' + (cy + 22) + '">' + p.death.year + '</text>');
      // 路線名のように線上に名前を繰り返す
      var gap = 560;
      for (var lx = x1 + 12; lx < x2 - textW(p.nameJa, 11) - 12; lx += gap) {
        o.push('<text class="t-linename" x="' + lx + '" y="' + (cy - 10) + '">' + esc(p.nameJa) + '</text>');
      }
    });

    // 出来事
    L.placed.forEach(function (pl) {
      var ev = pl.ev, cats = evCats(ev).filter(function (c) { return S.visCats.has(c); });
      if (!cats.length) cats = evCats(ev);
      var x = pl.x, n = cats.length;
      var sel = S.selected && S.selected.kind === 'event' && S.selected.id === ev.id;
      var names = (ev.people || []).map(personName).join('・');
      o.push('<g class="ev' + (sel ? ' is-selected' : '') + '" data-ev="' + esc(ev.id) + '" tabindex="0" role="button" aria-label="' + esc(fmtDate(ev.date) + ' ' + ev.title + '（' + names + '）') + '">');
      var top = pl.yTop - 12, bot = pl.yBot + 12;
      o.push('<rect class="ev-halo" x="' + (x - 13) + '" y="' + (top - 4) + '" width="26" height="' + (bot - top + 8) + '" rx="13"/>');

      // 日付の幅（精度）を淡い帯で示す
      var showWhisker = pl.xe - pl.xs >= 3;
      if (showWhisker) {
        pl.ys.forEach(function (cy) {
          o.push('<line class="ev-whisker" x1="' + pl.xs + '" x2="' + pl.xe + '" y1="' + cy + '" y2="' + cy + '" style="stroke:var(--cat-' + cats[0] + ')"/>');
        });
      }

      // 接続線（分類ごとの平行線）。間を通過する人物の線は縁取りで切る
      var y1 = pl.ys.length > 1 ? pl.yTop : pl.yTop - 13;
      var y2 = pl.ys.length > 1 ? pl.yBot : pl.yBot + 13;
      o.push('<line class="ev-casing" x1="' + x + '" x2="' + x + '" y1="' + y1 + '" y2="' + y2 + '" style="stroke-width:' + (n * CAT_STRIPE + 5) + '"/>');
      cats.forEach(function (c, i) {
        var dx = (i - (n - 1) / 2) * CAT_STRIPE;
        o.push('<line class="ev-line" x1="' + (x + dx) + '" x2="' + (x + dx) + '" y1="' + y1 + '" y2="' + y2 + '" style="stroke:var(--cat-' + c + ');stroke-width:' + (n > 1 ? 2.6 : 3.2) + '"/>');
      });
      pl.ys.forEach(function (cy) {
        o.push('<circle class="ev-station" cx="' + x + '" cy="' + cy + '" r="' + (n > 1 ? 6.5 : 5.5) + '"/>');
      });

      // ラベルと引出線
      if (L.showLabels && pl.labelRow >= 0) {
        var ly = L.labelTop + pl.labelRow * G.labelRow + 14;
        o.push('<line class="ev-leader" x1="' + x + '" x2="' + x + '" y1="' + (ly + 4) + '" y2="' + (y1 - 2) + '"/>');
        o.push('<text class="ev-label" x="' + (x - 3) + '" y="' + ly + '">' + esc(pl.labelText) + '</text>');
      }
      o.push('<rect class="ev-hit" x="' + (x - 11) + '" y="' + (top - 2) + '" width="22" height="' + (bot - top + 4) + '"/>');
      o.push('</g>');
    });

    o.push(axisSvg(L, L.lanesBottom + 6, true));

    els.svg.setAttribute('width', L.width);
    els.svg.setAttribute('height', L.height);
    els.svg.setAttribute('viewBox', '0 0 ' + L.width + ' ' + L.height);
    els.svg.innerHTML = o.join('');

    renderNames(L);
    renderList();
    updateZoomLabel();
    updateRange();
  }

  function renderNames(L) {
    var h = [];
    els.names.style.height = L.height + 'px';
    if (S.showCtx) h.push('<div class="bt-strip-label" style="top:' + L.ctxTop + 'px;height:' + (L.ctxRows * G.ctxRow) + 'px">情勢</div>');
    if (L.showLabels) h.push('<div class="bt-strip-label" style="top:' + L.labelTop + 'px;height:' + (L.labelRows * G.labelRow) + 'px">出来事</div>');
    L.vis.forEach(function (p) {
      var lane = L.lanes.get(p.id);
      h.push('<div class="bt-name" style="top:' + (lane.cy - G.laneH / 2) + 'px;height:' + G.laneH + 'px">' +
        '<span class="bt-name-ja">' + esc(isNarrow() ? (p.nameShort || p.nameJa) : p.nameJa) + '</span>' +
        '<span class="bt-name-years">' + esc(lifeYears(p)) + '</span></div>');
    });
    if (!L.vis.length) h.push('<div class="bt-name-empty" style="top:' + L.lanesTop + 'px">人物が選択されていません</div>');
    els.names.innerHTML = h.join('');
  }

  // ---------- list ----------

  function renderList() {
    var shown = S.events.filter(eventVisible);
    var dated = shown.filter(function (e) { return hasYear(e.date); }).sort(function (a, b) { return evMid(a) - evMid(b); });
    var undated = shown.filter(function (e) { return !hasYear(e.date); });
    function item(e) {
      var sw = evCats(e).map(function (c) {
        return '<span class="bt-chip-cat"><i style="background:var(--cat-' + esc(c) + ')"></i>' + esc(catLabel(c)) + '</span>';
      }).join('');
      var sel = S.selected && S.selected.kind === 'event' && S.selected.id === e.id;
      return '<li><button type="button" class="bt-list-item' + (sel ? ' is-selected' : '') + '" data-ev="' + esc(e.id) + '">' +
        '<span class="bt-list-date">' + esc(fmtRange(e.date, e.dateEnd)) + '</span>' +
        '<span class="bt-list-main"><span class="bt-list-title">' + esc(e.title) + '</span>' +
        '<span class="bt-list-people">' + esc((e.people || []).map(personName).join('・')) + '</span>' +
        '<span class="bt-list-cats">' + sw + '</span></span></button></li>';
    }
    var h = dated.map(item).join('');
    if (undated.length) h += '<li class="bt-list-sep">年代不明（年表には配置していません）</li>' + undated.map(item).join('');
    if (!shown.length) h = '<li class="bt-list-empty">表示条件に合う出来事はありません。</li>';
    els.list.innerHTML = h;
    els.count.textContent = '表示中 ' + shown.length + '件 ／ 登録 ' + S.events.length + '件';
  }

  // ---------- detail panel ----------

  function chipPeople(ev) {
    return (ev.people || []).map(function (id) {
      var p = S.peopleById.get(id);
      var age = '';
      if (p && hasYear(ev.date)) {
        var a = ageAt(p, ev.date, ev.dateEnd), note = ageNote(a, p);
        age = '<span class="bt-age' + (a.status === 'ok' ? '' : ' is-muted') + '"' + (note ? ' title="' + esc(note) + '"' : '') + '>' + esc(fmtAge(a)) + '</span>';
      }
      return '<span class="bt-chip-person">' + esc(personName(id)) + age + '</span>';
    }).join('');
  }

  // 関連人物：people.json の id（文字列）または { id?, name?, role? }
  function chipRelated(ev) {
    return (ev.relatedPeople || []).map(function (r) {
      if (typeof r === 'string') r = { id: r };
      var p = r.id ? S.peopleById.get(r.id) : null;
      var name = p ? p.nameJa : (r.name || r.id);
      var age = '';
      if (p && hasYear(ev.date) && hasYear(p.birth)) {
        var a = ageAt(p, ev.date, ev.dateEnd), note = ageNote(a, p);
        age = '<span class="bt-age' + (a.status === 'ok' ? '' : ' is-muted') + '"' + (note ? ' title="' + esc(note) + '"' : '') + '>' + esc(fmtAge(a)) + '</span>';
      }
      return '<span class="bt-chip-person is-related">' + esc(name) + (r.role ? '<span class="bt-role">' + esc(r.role) + '</span>' : '') + age + '</span>';
    }).join('');
  }

  var CHECK_TAG = '<span class="bt-check-tag">要確認</span>';

  function sourceCard(s, link, num, currentEventId) {
    if (!s) return '<article class="bt-src"><p class="bt-muted">未登録の史料: ' + esc(link.id) + '</p></article>';
    var type = S.srcTypes.get(s.type);
    var rows = [];
    function row(k, v) { if (v) rows.push('<div class="bt-kv"><dt>' + k + '</dt><dd>' + v + '</dd></div>'); }
    row('著者', esc(s.author));
    row('宛先', esc(s.recipient));
    row('差出地', esc(s.place));
    if (hasYear(s.date)) row('日付', esc(fmtDate(s.date)) + ' <span class="bt-prec">' + PREC_LABEL[precision(s.date)] + '</span>');
    row('収録', esc(s.publication));
    row('巻', esc(s.volume));
    row('ページ', esc(s.pages));
    row('該当箇所', esc(link && link.locator));
    if (link && hasYear(link.date)) row('記述日', esc(fmtDate(link.date)) + ' <span class="bt-prec">' + PREC_LABEL[precision(link.date)] + '</span>');
    if (s.url && /^https?:\/\//.test(s.url)) row('URL', '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a>');
    var others = S.events.filter(function (e) {
      return e.id !== currentEventId && (e.sources || []).some(function (l) { return l.id === s.id; });
    });
    return '<article class="bt-src" id="bt-src-' + esc(s.id) + '">' +
      '<div class="bt-src-head"><span class="bt-src-num">史料' + num + '</span><span class="bt-src-type">' + esc(type ? type.label : (s.type || '種別未設定')) + '</span>' + (s.demo ? '<span class="bt-demo-tag">デモ</span>' : '') + ((s.needsCheck || (link && link.needsCheck)) ? CHECK_TAG : '') + '</div>' +
      '<h4>' + esc(s.title) + '</h4>' +
      (rows.length ? '<dl>' + rows.join('') + '</dl>' : '') +
      (s.quote ? '<blockquote class="bt-quote"><span class="bt-mini">引用</span>' + esc(s.quote) + '</blockquote>' : '') +
      (s.summary ? '<p class="bt-summary"><span class="bt-mini">要約</span>' + esc(s.summary) + '</p>' : '') +
      (link && link.note ? '<p class="bt-note">' + esc(link.note) + '</p>' : '') +
      (s.note ? '<p class="bt-note"><span class="bt-mini">備考</span>' + esc(s.note) + '</p>' : '') +
      (others.length ? '<p class="bt-src-others">この史料を参照する他の出来事：' + others.map(function (e) {
        return '<button type="button" class="bt-link" data-ev="' + esc(e.id) + '">' + esc(e.shortTitle || e.title) + '</button>';
      }).join('、') + '</p>' : '') +
      '</article>';
  }

  function eventDetail(ev) {
    var links = (ev.sources || []).slice();
    var num = {};
    links.forEach(function (l, i) { num[l.id] = i + 1; });
    (ev.facts || []).concat(ev.interpretations || [], ev.discrepancies || []).forEach(function (f) {
      (f.sources || []).forEach(function (id) { if (!num[id]) { links.push({ id: id }); num[id] = links.length; } });
    });
    function refs(ids) {
      return (ids || []).map(function (id) {
        return '<button type="button" class="bt-ref" data-src="' + esc(id) + '">史料' + num[id] + '</button>';
      }).join('');
    }
    var h = [];
    if (ev.demo) h.push('<p class="bt-demo-banner">デモ用の架空データです。実在の史実ではありません。</p>');
    h.push('<p class="bt-d-date">' + esc(fmtRange(ev.date, ev.dateEnd)) + ' <span class="bt-prec">' + PREC_LABEL[precision(ev.date)] + '</span></p>');
    if (hasYear(ev.recordedDate)) h.push('<p class="bt-d-date">記述日：' + esc(fmtDate(ev.recordedDate)) + ' <span class="bt-prec">' + PREC_LABEL[precision(ev.recordedDate)] + '</span></p>');
    if (ev.dateNote) h.push('<p class="bt-d-date bt-small">' + esc(ev.dateNote) + '</p>');
    h.push('<h2>' + esc(ev.title) + '</h2>');
    if (ev.needsCheck) h.push('<p class="bt-d-place">' + CHECK_TAG + (typeof ev.needsCheck === 'string' ? ' ' + esc(ev.needsCheck) : '') + '</p>');
    h.push('<div class="bt-d-chips">' + evCats(ev).map(function (c) {
      return '<span class="bt-chip-cat"><i style="background:var(--cat-' + esc(c) + ')"></i>' + esc(catLabel(c)) + '</span>';
    }).join('') + '</div>');
    h.push('<div class="bt-d-chips">' + chipPeople(ev) + '</div>');
    if ((ev.relatedPeople || []).length) h.push('<div class="bt-d-chips"><span class="bt-mini">関連人物</span>' + chipRelated(ev) + '</div>');
    if (hasYear(ev.date)) h.push('<p class="bt-age-note">年齢は生年月日と出来事の日付から自動計算した満年齢です（日付が確定しない場合は幅で表示）。</p>');
    if (ev.place) h.push('<p class="bt-d-place">場所：' + esc(ev.place) + '</p>');
    if (ev.summary) h.push('<p class="bt-d-summary">' + esc(ev.summary) + '</p>');

    h.push('<section class="bt-d-sec"><h3>史料から確認できる事実</h3>');
    if ((ev.facts || []).length) {
      h.push('<ul class="bt-facts">' + ev.facts.map(function (f) {
        return '<li>' + (f.text ? esc(f.text) + ' ' : '') + refs(f.sources) +
          (f.quote ? '<blockquote class="bt-quote"><span class="bt-mini">直接引用</span>' + esc(f.quote) + '</blockquote>' : '') + '</li>';
      }).join('') + '</ul>');
    } else h.push('<p class="bt-muted">未登録</p>');
    h.push('</section>');

    if ((ev.interpretations || []).length) {
      h.push('<section class="bt-d-sec bt-interp"><h3>史料からの解釈</h3><p class="bt-muted bt-small">以下は事実ではなく、記載の人物・文献による解釈です。</p><ul>' +
        ev.interpretations.map(function (it) {
          return '<li><p>' + esc(it.text) + '</p><p class="bt-by">' + (it.by ? '解釈：' + esc(it.by) + ' ' : '') + refs(it.sources) + '</p></li>';
        }).join('') + '</ul></section>');
    }
    if ((ev.discrepancies || []).length) {
      h.push('<section class="bt-d-sec"><h3>史料間の相違</h3><ul class="bt-facts">' + ev.discrepancies.map(function (f) {
        return '<li>' + esc(f.text) + ' ' + refs(f.sources) + '</li>';
      }).join('') + '</ul></section>');
    }
    if (ev.notes) h.push('<section class="bt-d-sec"><h3>補足</h3><p>' + esc(ev.notes) + '</p></section>');

    var ctx = (ev.contextIds || []).map(function (id) { return S.contextById.get(id); }).filter(Boolean);
    if (ctx.length) {
      h.push('<section class="bt-d-sec"><h3>関連する政治・軍事情勢</h3><ul class="bt-ctxlinks">' + ctx.map(function (c) {
        return '<li><button type="button" class="bt-link" data-ctx="' + esc(c.id) + '">' + esc(c.title) + '</button> <span class="bt-muted">' + esc(fmtRange(c.start, c.end)) + '</span></li>';
      }).join('') + '</ul></section>');
    }

    h.push('<section class="bt-d-sec"><h3>関連史料</h3>');
    if (links.length) h.push(links.map(function (l, i) { return sourceCard(S.sources.get(l.id), l, i + 1, ev.id); }).join(''));
    else h.push('<p class="bt-muted">関連史料なし（未登録）</p>');
    h.push('</section>');
    return h.join('');
  }

  function contextDetail(c) {
    var layer = S.layers.get(c.layer);
    var h = [];
    if (c.demo) h.push('<p class="bt-demo-banner">試作用の登録例です。本登録時に史料で確認してください。</p>');
    h.push('<p class="bt-d-date">' + esc(fmtRange(c.start, c.end)) + ' <span class="bt-prec">' + PREC_LABEL[precision(c.start)] + '</span></p>');
    h.push('<h2>' + esc(c.title) + '</h2>');
    if (layer) h.push('<div class="bt-d-chips"><span class="bt-chip-cat"><i style="background:var(--layer-' + esc(layer.id) + ')"></i>' + esc(layer.label) + '</span></div>');
    if (c.description) h.push('<p class="bt-d-summary">' + esc(c.description) + '</p>');
    h.push('<p class="bt-muted bt-small">政治・軍事情勢は兄弟間の関係を直接示すものではありません。</p>');

    var linked = S.events.filter(function (e) { return (e.contextIds || []).indexOf(c.id) >= 0; });
    h.push('<section class="bt-d-sec"><h3>関連付けられた出来事</h3>');
    h.push(linked.length ? '<ul class="bt-ctxlinks">' + linked.map(function (e) {
      return '<li><button type="button" class="bt-link" data-ev="' + esc(e.id) + '">' + esc(e.title) + '</button> <span class="bt-muted">' + esc(fmtDate(e.date)) + '</span></li>';
    }).join('') + '</ul>' : '<p class="bt-muted">なし</p>');
    h.push('</section>');

    var a = dateFrac(c.start, 'start'), b = dateFrac(hasYear(c.end) ? c.end : c.start, 'end');
    var same = S.events.filter(function (e) {
      return hasYear(e.date) && linked.indexOf(e) < 0 && evStart(e) < b && evEnd(e) > a;
    });
    if (same.length) {
      h.push('<section class="bt-d-sec"><h3>同時期の出来事</h3><p class="bt-muted bt-small">期間が重なる出来事を自動で抽出したもので、関連性を示すものではありません。</p><ul class="bt-ctxlinks">' +
        same.map(function (e) {
          return '<li><button type="button" class="bt-link" data-ev="' + esc(e.id) + '">' + esc(e.title) + '</button> <span class="bt-muted">' + esc(fmtDate(e.date)) + '</span></li>';
        }).join('') + '</ul></section>');
    }
    return h.join('');
  }

  function openDetail(kind, id, opts) {
    var obj = kind === 'event' ? S.eventsById.get(id) : S.contextById.get(id);
    if (!obj) return;
    S.selected = { kind: kind, id: id };
    els.detailBody.innerHTML = kind === 'event' ? eventDetail(obj) : contextDetail(obj);
    els.detail.hidden = false;
    els.detail.scrollTop = 0;
    try { history.replaceState(null, '', '#' + kind + '=' + encodeURIComponent(id)); } catch (e) { /* noop */ }
    render();
    var t = kind === 'event' ? (hasYear(obj.date) ? evMid(obj) : null) : dateFrac(obj.start, 'mid');
    if (t != null) {
      // 詳細パネルに隠れる位置なら、見える範囲の中央へ移動する
      var panelW = window.matchMedia('(max-width: 820px)').matches ? 0 : els.detail.offsetWidth;
      var r = els.scroll.getBoundingClientRect();
      var visW = Math.max(120, Math.min(r.right, window.innerWidth - panelW) - r.left);
      var px = X(t) - els.scroll.scrollLeft;
      if ((opts && opts.scroll) || px < 30 || px > visW - 30) {
        els.scroll.scrollTo({ left: X(t) - visW / 2, behavior: 'smooth' });
      }
    }
    els.detailClose.focus({ preventScroll: true });
  }

  function closeDetail() {
    if (els.detail.hidden) return;
    var prev = S.selected;
    els.detail.hidden = true;
    S.selected = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ }
    render();
    if (prev) {
      var sel = els.svg.querySelector('[data-' + (prev.kind === 'event' ? 'ev' : 'ctx') + '="' + CSS.escape(prev.id) + '"]');
      if (sel) sel.focus({ preventScroll: true });
    }
  }

  // ---------- navigation ----------

  function scrollToYear(y, smooth) {
    var left = X(y) - els.scroll.clientWidth / 2;
    els.scroll.scrollTo({ left: left, behavior: smooth ? 'smooth' : 'auto' });
  }

  function setZoom(p, anchor) {
    p = clamp(p, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(p - S.ppy) < 0.01) return;
    var sc = els.scroll;
    var ax = anchor == null ? sc.clientWidth / 2 : anchor;
    var yr = yearAt(sc.scrollLeft + ax);
    S.ppy = p;
    render();
    sc.scrollLeft = X(yr) - ax;
    updateRange();
  }

  function fitAll() {
    var w = els.scroll.clientWidth - G.padL - G.padR;
    setZoom(w / (S.yearMax - S.yearMin));
    els.scroll.scrollLeft = 0;
  }

  function updateZoomLabel() {
    var span = els.scroll.clientWidth / S.ppy;
    els.zoomLabel.textContent = '約' + (span >= 10 ? Math.round(span) : span.toFixed(1)) + '年幅';
    els.zoomIn.disabled = S.ppy >= ZOOM_MAX;
    els.zoomOut.disabled = S.ppy <= ZOOM_MIN;
  }

  function updateRange() {
    var a = yearAt(els.scroll.scrollLeft), b = yearAt(els.scroll.scrollLeft + els.scroll.clientWidth);
    els.range.textContent = '表示中：' + Math.max(S.yearMin, Math.floor(a)) + '–' + Math.min(S.yearMax, Math.floor(b)) + '年';
  }

  // ---------- controls ----------

  function buildControls() {
    els.peopleChips.innerHTML = S.people.map(function (p) {
      return '<button type="button" class="bt-toggle" data-person="' + esc(p.id) + '" aria-pressed="' + S.visPeople.has(p.id) + '">' + esc(p.nameJa) + '</button>';
    }).join('');
    els.catChips.innerHTML = S.catList.map(function (c) {
      return '<button type="button" class="bt-toggle" data-cat="' + esc(c.id) + '" aria-pressed="' + S.visCats.has(c.id) + '"><i style="background:var(--cat-' + esc(c.id) + ')"></i>' + esc(c.label) + '</button>';
    }).join('');
    els.legendCats.innerHTML = S.catList.map(function (c) {
      return '<span class="bt-chip-cat"><i style="background:var(--cat-' + esc(c.id) + ')"></i>' + esc(c.label) + '</span>';
    }).join('');
    els.jumpCtx.innerHTML = '<option value="">情勢から移動…</option>' + S.context.filter(function (c) { return hasYear(c.start); })
      .sort(function (a, b) { return dateFrac(a.start, 'start') - dateFrac(b.start, 'start'); })
      .map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.start.year + ' ' + c.title) + '</option>'; }).join('');
    els.jumpYear.min = S.yearMin; els.jumpYear.max = S.yearMax;

    els.peopleChips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-person]'); if (!b) return;
      var id = b.getAttribute('data-person');
      if (S.visPeople.has(id)) S.visPeople.delete(id); else S.visPeople.add(id);
      b.setAttribute('aria-pressed', S.visPeople.has(id));
      render();
    });
    els.catChips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b) return;
      var id = b.getAttribute('data-cat');
      if (S.visCats.has(id)) S.visCats.delete(id); else S.visCats.add(id);
      b.setAttribute('aria-pressed', S.visCats.has(id));
      render();
    });
    els.toggleCtx.addEventListener('change', function () { S.showCtx = els.toggleCtx.checked; els.toggleBands.disabled = !S.showCtx; render(); });
    els.toggleBands.addEventListener('change', function () { S.showBands = els.toggleBands.checked; render(); });
    els.zoomIn.addEventListener('click', function () { setZoom(S.ppy * 1.5); });
    els.zoomOut.addEventListener('click', function () { setZoom(S.ppy / 1.5); });
    els.zoomFit.addEventListener('click', fitAll);
    els.jumpForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var y = parseInt(els.jumpYear.value, 10);
      if (!isNaN(y)) scrollToYear(clamp(y, S.yearMin, S.yearMax) + 0.5, true);
    });
    els.jumpCtx.addEventListener('change', function () {
      var c = S.contextById.get(els.jumpCtx.value);
      if (c) scrollToYear(dateFrac(c.start, 'start'), true);
      els.jumpCtx.value = '';
    });

    // 出来事・情勢のクリック（年表、一覧、詳細パネル共通）
    function onActivate(e) {
      var t = e.target.closest('[data-ev],[data-ctx],[data-src]');
      if (!t) return;
      if (t.hasAttribute('data-src')) {
        var card = $('bt-src-' + t.getAttribute('data-src'));
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.classList.add('is-flash'); setTimeout(function () { card.classList.remove('is-flash'); }, 1200); }
        return;
      }
      var fromList = !els.svg.contains(t);
      if (t.hasAttribute('data-ev')) openDetail('event', t.getAttribute('data-ev'), { scroll: fromList });
      else openDetail('context', t.getAttribute('data-ctx'), { scroll: fromList });
    }
    [els.svg, els.list, els.detailBody].forEach(function (el) { el.addEventListener('click', onActivate); });
    els.svg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e); }
    });
    els.detailClose.addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

    els.scroll.addEventListener('scroll', updateRange, { passive: true });
    els.scroll.addEventListener('keydown', function (e) {
      if (e.target !== els.scroll) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(S.ppy * 1.5); }
      else if (e.key === '-') { e.preventDefault(); setZoom(S.ppy / 1.5); }
    });

    // Ctrl/⌘ + ホイールでズーム（マウス位置を基準）
    els.scroll.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var r = els.scroll.getBoundingClientRect();
      setZoom(S.ppy * Math.pow(1.0018, -e.deltaY), e.clientX - r.left);
    }, { passive: false });

    // マウスでのドラッグ移動
    var drag = null;
    els.scroll.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.ev,.ctx')) return;
      drag = { x: e.clientX, left: els.scroll.scrollLeft };
      els.scroll.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      els.scroll.scrollLeft = drag.left - (e.clientX - drag.x);
    });
    window.addEventListener('pointerup', function () { drag = null; els.scroll.classList.remove('is-dragging'); });

    // 2本指ピンチでズーム（スマートフォン）
    var pinch = null, raf = 0;
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    els.scroll.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        var r = els.scroll.getBoundingClientRect();
        pinch = { d: dist(e.touches), ppy: S.ppy, ax: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left };
      }
    }, { passive: true });
    els.scroll.addEventListener('touchmove', function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var target = pinch.ppy * dist(e.touches) / pinch.d;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { setZoom(target, pinch && pinch.ax); });
    }, { passive: false });
    els.scroll.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; });

    var rt = 0, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(function () {
        var c = yearAt(els.scroll.scrollLeft + els.scroll.clientWidth / 2);
        render(); scrollToYear(c, false);
        syncFilters();
      }, 150);
    });
  }

  function syncFilters() {
    // 狭い画面では絞り込み欄を初期状態で閉じる
    if (!els.filters.dataset.touched) els.filters.open = !isNarrow();
  }

  function renderWarnings() {
    if (!S.warnings.length) return;
    els.warnings.hidden = false;
    els.warnings.querySelector('summary').textContent = 'データ検証：' + S.warnings.length + '件の警告';
    els.warnings.querySelector('ul').innerHTML = S.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    S.warnings.forEach(function (w) { console.warn('[bruder] ' + w); });
  }

  function openFromHash() {
    var m = /^#(event|context)=(.+)$/.exec(location.hash);
    if (m) openDetail(m[1], decodeURIComponent(m[2]), { scroll: true });
  }

  // ---------- boot ----------

  function boot() {
    ['timeline', 'svg', 'names', 'scroll', 'list', 'count', 'detail', 'detailBody', 'detailClose',
      'zoomIn', 'zoomOut', 'zoomFit', 'zoomLabel', 'range', 'jumpForm', 'jumpYear', 'jumpCtx',
      'peopleChips', 'catChips', 'toggleCtx', 'toggleBands', 'filters', 'legendCats', 'warnings', 'loadError'
    ].forEach(function (k) { els[k] = $('bt-' + k); });
    els.filters.addEventListener('toggle', function () { els.filters.dataset.touched = '1'; });
    syncFilters();

    Promise.all(['people', 'taxonomy', 'sources', 'events', 'context'].map(loadJSON))
      .then(function (d) {
        ingest(d[0], d[1], d[2], d[3], d[4]);
        injectColors();
        buildControls();
        render();
        scrollToYear(S.initialCenter || (S.yearMin + S.yearMax) / 2, false);
        updateRange();
        renderWarnings();
        els.timeline.classList.add('is-ready');
        openFromHash();
      })
      .catch(function (err) {
        console.error(err);
        els.loadError.hidden = false;
        els.loadError.textContent = 'データを読み込めませんでした（' + err.message + '）。ローカルで確認する場合は、ファイルを直接開かずHTTPサーバー経由で表示してください。';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
