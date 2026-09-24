/* ==========================================================================
   uniform.js — CSV を元に素体へ軍服パーツ（SVG）を重ねて表示する

   [表示サイズを一定に保つための方針]
   すべてのパーツSVGは viewBox="0 0 3000 4000"（またはそれと数値が同じもの）で
   統一されている前提（読み込み時に一致しない/欠けている場合も 0 0 3000 4000 を
   補うため見た目は揃う）。その上で、
   - 表示エリア（#stage）は CSS の aspect-ratio で固定サイズにする
   - 各レイヤー（SVG/画像）は width:100%; height:100% を明示し、SVG自身が
     持つ width/height 属性には依存しない
   - 部隊を切り替えても「今、画面に何枚のノードがあるか」でサイズが変わらない
     よう、パーツのノードは兵科を読み込んだ時に全パーツぶん先に作って
     #stage に並べてしまい、以後は display の切替と色の塗り替えだけで
     見た目を変える（DOMの追加・削除は行わない）
   - 素体（basebody）も同じ #stage の中に同じ規格のレイヤーとして常駐させ、
     選択有無で表示を切り替えるだけにする

   [データの並べ方]
   - CSV 1行 = ボタン1つ（A列が部隊名）
   - CSV 1列 = パーツ1つ（ヘッダ行がSVGの「名前」）。ただしヘッダが "text_" で
     始まる列はパーツではなく付随テキスト情報として扱う（INFO_FIELDS 参照）。
   - 描画順は列順（左が下）／パーツごとに fill → line
   - セルが #RRGGBB
       ・「名前_fill.svg」と「名前_line.svg」のペアがあれば fill のみ着色、line は原色のまま
       ・ペアが無く「名前_stroke.svg」（単色の線画1枚、stroke属性で線を描画）があれば、
         その stroke 属性を着色する（fill は変更しない）
   - セルがそれ以外（「ー」「―」など） … そのパーツは非表示
   - セルが *.png など画像ファイル名 … その画像をそのまま1枚のレイヤーとして描画
   - ファイルが存在しない場合はエラーにせず読み込みログに記録してスキップ

   [兵科を増やす場合]
   CATEGORIES 配列に1エントリ追加するだけでよい（歩兵・騎兵などをタブで切替）。
   専用のCSVとSVG/画像一式を、指定した dir に用意すること。

   [部隊情報（テキスト）を増やす場合]
   INFO_FIELDS 配列に1エントリ追加するだけで、選択中の部隊のセル内容が
   自動的に表示欄へ並ぶ（値の中に「、」があればタグ表示、無ければ文章表示）。
   フリードリヒ本人が話しているように見せたい列は FRITZ_FIELD で指定する。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 兵科（今後、騎兵などを追加する場合はここに1件足すだけ） ---------- */
  var CATEGORIES = [
    {
      id: 'infantry',
      tabLabel: '歩兵',
      title: 'プロイセン軍の連隊別軍服',
      lede: 'フリードリヒ大王時代のプロイセン軍では、連隊ごとに襟やカフス、ボタン、レースなどの軍服の意匠が異なっていました。連隊を選択すると、軍服の配色、ボタン、レースなどの違いを着せ替えて比較できます。もう一度押すと素体に戻ります。',
      chooserLabel: '連隊を選ぶ',
      dir: 'uniform_infantry/',
      csv: 'uniform_infantry/uniform_infantry.csv',
      basebody: 'basebody.png'
    }
    // 例）騎兵を追加する場合:
    // {
    //   id: 'cavalry',
    //   tabLabel: '騎兵',
    //   title: '騎兵連隊の軍服',
    //   lede: '…',
    //   chooserLabel: '連隊を選ぶ',
    //   dir: 'uniform_cavalry/',
    //   csv: 'uniform_cavalry/uniform_cavalry.csv',
    //   basebody: 'basebody.png'
    // }
  ];

  /* ---------- 部隊テキスト情報（今後 text_* 列を増やしたらここに1件足すだけ） ---------- */
  var FRITZ_FIELD = 'text_with_Fritz';   // この列に記載がある部隊は、フリードリヒが話す形で表示
  var FRITZ_IMG   = 'img/frederickmini_stand_upscaled_wo_background.png';

  var INFO_FIELDS = [
    { key: 'text_sansen', label: '主な参戦' }
    // 新しい text_◯◯ 列は、ここにラベルを足せばその表記で表示される。
    // 足さなくても「text_」を除いた列名がそのままラベルとして表示されるため、
    // 表示だけならCSVに列を増やすだけで動く。
  ];

  var HEX_RE  = /^#[0-9a-fA-F]{6}$/;
  var IMG_RE  = /\.(png|jpe?g|gif|webp)$/i;
  var TEXT_RE = /^text_/;

  var elTabs      = document.getElementById('categoryTabs');
  var elPageTitle = document.getElementById('pageTitle');
  var elPageLede  = document.getElementById('pageLede');
  var elChooser   = document.getElementById('chooserLabel');
  var elStage     = document.getElementById('stage');
  var elButtons   = document.getElementById('buttons');
  var elTitle     = document.getElementById('currentName');
  var elLog       = document.getElementById('log');
  var elLogHead   = document.getElementById('logSummary');
  var elInfo      = document.getElementById('infoPanels');
  var elFritz     = document.getElementById('fritzPanel');
  var elFritzText = document.getElementById('fritzText');

  var activeCat   = null;   // 現在の CATEGORIES エントリ
  var headers     = [];     // 列インデックス -> パーツ名／テキスト列名
  var rows        = [];     // データ行
  var slots       = [];     // 列インデックス順の常駐レイヤー情報（buildSlots で構築）
  var baseNode    = null;   // 素体（basebody）の常駐レイヤー
  var current     = -1;     // 選択中の行インデックス（-1 = 未選択）
  var loadToken   = 0;      // 兵科切替の競合防止
  var renderToken = 0;      // 行切替（非同期の画像差し替え）の競合防止

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');   // BOM 除去
    var out = [], row = [], field = '', quoted = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = ''; out.push(row); row = [];
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); out.push(row); }
    return out;
  }

  /* ---------- ファイル名の解決 ----------
     ヘッダ内の空白は詰める（"folded collar" -> "foldedcollar"）。
     先頭の大文字／小文字の揺れ（shirt と Shirt_fill.svg）にも順に当たる。 */
  function nameCandidates(base, suffix) {
    var list = [], seen = {};
    function push(v) { if (v && !seen[v]) { seen[v] = 1; list.push(v); } }
    push(base + suffix);
    push(base.charAt(0).toUpperCase() + base.slice(1) + suffix);
    push(base.toLowerCase() + suffix);
    push(base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() + suffix);
    return list;
  }

  var svgCache = {};   // url -> SVGテキスト | null（読み込み中は Promise）
  function fetchSvg(url) {
    if (Object.prototype.hasOwnProperty.call(svgCache, url)) {
      return Promise.resolve(svgCache[url]);
    }
    var p = fetch(url).then(function (res) {
      if (!res.ok) return null;
      return res.text().then(function (t) { return /<svg[\s>]/i.test(t) ? t : null; });
    }).catch(function () {
      return null;
    }).then(function (t) {
      svgCache[url] = t;
      return t;
    });
    svgCache[url] = p;   // 同じファイルの同時要求をまとめる
    return p;
  }

  function resolveSvg(dir, base, suffix) {
    var cands = nameCandidates(base, suffix), idx = 0;
    function next() {
      if (idx >= cands.length) return Promise.resolve(null);
      var file = cands[idx++];
      return fetchSvg(dir + file).then(function (t) {
        return t ? { file: file, text: t } : next();
      });
    }
    return next();
  }

  var imgCache = {};   // url -> Promise<boolean>
  function imageExists(url) {
    if (!imgCache[url]) {
      imgCache[url] = new Promise(function (resolve) {
        var im = new Image();
        im.onload  = function () { resolve(true); };
        im.onerror = function () { resolve(false); };
        im.src = url;
      });
    }
    return imgCache[url];
  }

  /* ---------- レイヤー生成 ----------
     すべてのSVGは viewBox="0 0 3000 4000" 相当で統一されている前提で、
     width/height 属性は取り除いて CSS 側の width:100%; height:100% に
     完全に委ねる（表示サイズがパーツごとにぶれないようにするため）。 */
  function makeSvgLayer(text) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    var src = doc.documentElement;
    if (!src || String(src.nodeName).toLowerCase() !== 'svg') return null;

    var node = document.importNode(src, true);
    node.removeAttribute('width');
    node.removeAttribute('height');
    if (!node.getAttribute('viewBox')) node.setAttribute('viewBox', '0 0 3000 4000');
    node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    node.classList.add('layer');
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.display = 'none';   // 初期状態は非表示（display切替のみで出し入れする）
    return node;
  }

  function makeImgLayer(url) {
    var im = document.createElement('img');
    im.className = 'layer';
    im.style.width = '100%';
    im.style.height = '100%';
    im.style.display = 'none';
    im.alt = '';
    if (url) im.src = url;
    return im;
  }

  function recolorFill(node, color) {
    node.style.fill = color;
    var all = node.querySelectorAll('*'), i, el, f;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      f = el.getAttribute('fill');
      if (f && f !== 'none') el.setAttribute('fill', color);
      if (el.style && el.style.fill && el.style.fill !== 'none') el.style.fill = color;
    }
  }

  function recolorStroke(node, color) {
    node.style.stroke = color;
    var all = node.querySelectorAll('*'), i, el, s;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      s = el.getAttribute('stroke');
      if (s && s !== 'none') el.setAttribute('stroke', color);
      if (el.style && el.style.stroke && el.style.stroke !== 'none') el.style.stroke = color;
    }
  }

  /* ---------- 常駐レイヤーの構築（兵科を読み込んだ時に1回だけ行う） ----------
     全パーツぶんのノードを先に作って #stage に列順で並べておく。
     以後、部隊を切り替えても display の切替と色の塗り替えのみで、
     ノードの追加・削除は一切行わない。 */
  function buildSlot(dir, header, col) {
    if (!header) {
      // 画像スロット（face.png / hands.png など）。実際のファイル名は行ごとの
      // セルの値で決まるため、ノードだけ先に用意し src は選択時に差し替える。
      return Promise.resolve({ col: col, type: 'image', imgNode: makeImgLayer(null) });
    }

    return resolveSvg(dir, header, '_stroke.svg').then(function (strokeRes) {
      return strokeRes || resolveSvg(dir, header, '_stripe.svg');
    }).then(function (strokeRes) {
      if (strokeRes) {
        var node = makeSvgLayer(strokeRes.text);
        if (node) return { col: col, type: 'stroke', strokeNode: node };
        return { col: col, type: 'fill-line', fillNode: null, lineNode: null,
          missingFill: header + '_fill.svg', missingLine: header + '_line.svg' };
      }

      return Promise.all([resolveSvg(dir, header, '_fill.svg'), resolveSvg(dir, header, '_line.svg')])
        .then(function (r) {
          var slot = { col: col, type: 'fill-line', fillNode: null, lineNode: null,
            missingFill: null, missingLine: null };
          if (r[0]) {
            slot.fillNode = makeSvgLayer(r[0].text);
            if (!slot.fillNode) slot.missingFill = r[0].file + '（解釈できません）';
          } else {
            slot.missingFill = header + '_fill.svg';
          }
          if (r[1]) {
            slot.lineNode = makeSvgLayer(r[1].text);
            if (!slot.lineNode) slot.missingLine = r[1].file + '（解釈できません）';
          } else {
            slot.missingLine = header + '_line.svg';
          }
          return slot;
        });
    });
  }

  function buildSlots(dir) {
    elStage.innerHTML = '';

    baseNode = makeImgLayer(dir + activeCat.basebody);
    elStage.appendChild(baseNode);

    var jobs = [], col;
    for (col = 1; col < headers.length; col++) {
      if (TEXT_RE.test(headers[col])) continue;   // テキスト情報列はパーツではない
      jobs.push(buildSlot(dir, headers[col], col));
    }

    return Promise.all(jobs).then(function (built) {
      slots = built;   // Promise.all は配列順を保つので、列順のまま並んでいる
      slots.forEach(function (slot) {
        if (slot.fillNode)   elStage.appendChild(slot.fillNode);
        if (slot.lineNode)   elStage.appendChild(slot.lineNode);
        if (slot.strokeNode) elStage.appendChild(slot.strokeNode);
        if (slot.imgNode)    elStage.appendChild(slot.imgNode);
      });
    });
  }

  function hideSlot(slot) {
    if (slot.fillNode)   slot.fillNode.style.display = 'none';
    if (slot.lineNode)   slot.lineNode.style.display = 'none';
    if (slot.strokeNode) slot.strokeNode.style.display = 'none';
    if (slot.imgNode)    slot.imgNode.style.display = 'none';
  }

  /* ---------- 1パーツぶんの表示更新（display切替と色の塗り替えのみ） ---------- */
  function applySlot(slot, rawValue, skipped, token) {
    var value = String(rawValue).trim();

    if (slot.type === 'image') {
      if (IMG_RE.test(value)) {
        var url = activeCat.dir + value;
        return imageExists(url).then(function (ok) {
          if (token !== renderToken) return 0;   // その間に別の部隊が選ばれていたら反映しない
          if (ok) {
            slot.imgNode.src = url;
            slot.imgNode.style.display = '';
            return 1;
          }
          slot.imgNode.style.display = 'none';
          skipped.push({ file: value, why: 'ファイルが見つかりません' });
          return 0;
        });
      }
      slot.imgNode.style.display = 'none';
      return Promise.resolve(0);
    }

    if (!HEX_RE.test(value)) { hideSlot(slot); return Promise.resolve(0); }

    if (slot.type === 'stroke') {
      recolorStroke(slot.strokeNode, value);
      slot.strokeNode.style.display = '';
      return Promise.resolve(1);
    }

    // type === 'fill-line'
    var n = 0;
    if (slot.fillNode) {
      recolorFill(slot.fillNode, value);
      slot.fillNode.style.display = '';
      n++;
    } else {
      skipped.push({ file: slot.missingFill, why: 'ファイルが見つかりません' });
    }
    if (slot.lineNode) {
      slot.lineNode.style.display = '';
      n++;
    } else {
      skipped.push({ file: slot.missingLine, why: 'ファイルが見つかりません' });
    }
    return Promise.resolve(n);
  }

  /* ---------- 描画（表示の切替のみ。DOMの追加削除は行わない） ---------- */
  function render(rowIndex) {
    var token = ++renderToken;

    if (rowIndex < 0) {
      slots.forEach(hideSlot);
      baseNode.style.display = '';
      elTitle.textContent = '未選択（素体）';
      writeLog([], 1);
      renderInfo(null);
      return;
    }

    baseNode.style.display = 'none';

    var row = rows[rowIndex];
    elTitle.textContent = row[0];
    renderInfo(row);

    var skipped = [];
    var jobs = slots.map(function (slot) {
      return applySlot(slot, row[slot.col] === undefined ? '' : row[slot.col], skipped, token);
    });

    Promise.all(jobs).then(function (counts) {
      if (token !== renderToken) return;   // 連打時は古い結果を捨てる
      var drawn = counts.reduce(function (a, b) { return a + b; }, 0);
      if (!drawn) baseNode.style.display = '';   // 何も描画できなければ素体を表示
      writeLog(skipped, drawn);
    });
  }

  /* ---------- 部隊テキスト情報 ---------- */
  function fieldLabel(header) {
    var key = header.replace(TEXT_RE, '');
    for (var i = 0; i < INFO_FIELDS.length; i++) {
      if (INFO_FIELDS[i].key === header) return INFO_FIELDS[i].label;
    }
    return key;
  }

  function renderFieldValue(val) {
    if (val.indexOf('、') >= 0) {
      var items = val.split('、').map(function (s) { return s.trim(); }).filter(Boolean);
      var html = '<ul class="tag-list">', i;
      for (i = 0; i < items.length; i++) html += '<li>' + esc(items[i]) + '</li>';
      return html + '</ul>';
    }
    return '<p>' + esc(val) + '</p>';
  }

  function renderInfo(row) {
    var html = '', fritzVal = '', col;

    if (row) {
      for (col = 1; col < headers.length; col++) {
        if (!TEXT_RE.test(headers[col])) continue;
        var val = String(row[col] === undefined ? '' : row[col]).trim();
        if (headers[col] === FRITZ_FIELD) { fritzVal = val; continue; }
        if (!val) continue;
        html += '<section class="info-block"><h3>' + esc(fieldLabel(headers[col])) + '</h3>' +
          renderFieldValue(val) + '</section>';
      }
    }

    elInfo.innerHTML = html;
    elInfo.hidden = !html;

    if (fritzVal) {
      elFritzText.textContent = fritzVal;
      elFritz.hidden = false;
    } else {
      elFritzText.textContent = '';
      elFritz.hidden = true;
    }
  }

  /* ---------- 読み込みログ ---------- */
  function writeLog(skipped, drawn) {
    elLogHead.textContent = '読み込みログ（描画 ' + drawn + ' 枚 ／ スキップ ' + skipped.length + ' 件）';
    if (!skipped.length) {
      elLog.innerHTML = '<p class="log-ok">すべてのパーツを読み込めました。</p>';
      return;
    }
    var html = '<ul class="log-list">', i;
    for (i = 0; i < skipped.length; i++) {
      html += '<li><code>' + esc(skipped[i].file) + '</code><span>' + esc(skipped[i].why) + '</span></li>';
    }
    elLog.innerHTML = html + '</ul>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 部隊選択 ---------- */
  function select(i) {
    current = (current === i) ? -1 : i;
    var bs = elButtons.querySelectorAll('button'), k;
    for (k = 0; k < bs.length; k++) {
      bs[k].setAttribute('aria-pressed', String(k === current));
    }
    render(current);
  }

  /* ---------- 兵科の切替・読み込み ---------- */
  function loadCategory(cat) {
    var token = ++loadToken;
    activeCat = cat;
    current = -1;
    headers = [];
    rows = [];
    slots = [];
    baseNode = null;

    elPageTitle.textContent = cat.title;
    elPageLede.textContent = cat.lede;
    elChooser.textContent = cat.chooserLabel;
    elTitle.textContent = '読み込み中…';
    elButtons.innerHTML = '';
    elStage.innerHTML = '';
    elInfo.innerHTML = ''; elInfo.hidden = true;
    elFritz.hidden = true;
    elLogHead.textContent = '読み込みログ';
    elLog.innerHTML = '';

    var tabButtons = elTabs.querySelectorAll('button');
    for (var t = 0; t < tabButtons.length; t++) {
      tabButtons[t].setAttribute('aria-pressed', String(tabButtons[t].dataset.catId === cat.id));
    }

    fetch(cat.csv).then(function (res) {
      if (!res.ok) throw new Error('CSV を読み込めません（HTTP ' + res.status + '）');
      return res.text();
    }).then(function (text) {
      if (token !== loadToken) return;   // その間に別の兵科タブが選ばれていたら中断

      var table = parseCSV(text).filter(function (r) {
        return r.some(function (c) { return String(c).trim() !== ''; });
      });
      headers = table[0].map(function (h) { return String(h).trim().replace(/\s+/g, ''); });
      headers[0] = '';                       // A列はボタン名なのでパーツではない
      rows = table.slice(1);

      rows.forEach(function (r, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = r[0];
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { select(i); });
        elButtons.appendChild(b);
      });

      return buildSlots(cat.dir).then(function () {
        if (token !== loadToken) return;
        render(-1);
      });
    }).catch(function (err) {
      if (token !== loadToken) return;
      elStage.innerHTML = '';
      elTitle.textContent = 'エラー';
      elLogHead.textContent = '読み込みログ';
      elLog.innerHTML = '<p class="log-err">' + esc(err.message) +
        '<br>ローカルで確認する場合は <code>file://</code> で直接開かず、ローカルサーバー経由で開いてください。</p>';
    });
  }

  /* ---------- 起動 ---------- */
  CATEGORIES.forEach(function (cat) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = cat.tabLabel;
    b.dataset.catId = cat.id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { loadCategory(cat); });
    elTabs.appendChild(b);
  });
  // 兵科が1つだけの現状でもタブ自体は表示し、今後の追加を示しておく

  loadCategory(CATEGORIES[0]);
})();
