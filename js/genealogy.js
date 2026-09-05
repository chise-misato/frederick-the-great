(function () {
  'use strict';

  var DEFAULT_ROOT = 'friedrich-ii';
  var PW = 210, PH = 112, UW = 14, UH = 14;

  var state = {
    data: null,
    peopleById: new Map(),
    unionsById: new Map(),
    housesById: new Map(),
    adj: new Map(),
    layout: null,
    rootId: DEFAULT_ROOT,
    collapsedHouses: new Set(),
    pathMode: false,
    currentPath: null,
    zoomBehavior: null
  };

  // ---------- data / graph ----------

  function buildGraph(data) {
    var peopleById = new Map(data.people.map(function (p) { return [p.id, p]; }));
    var unionsById = new Map(data.unions.map(function (u) { return [u.id, u]; }));
    var housesById = new Map(data.houses.map(function (h) { return [h.id, h]; }));
    var adj = new Map();
    peopleById.forEach(function (_, id) { adj.set(id, []); });

    function addEdge(a, b, edge) {
      adj.get(a).push(Object.assign({ to: b }, edge));
    }

    data.unions.forEach(function (u) {
      u.partners.forEach(function (par) {
        u.childIds.forEach(function (c) {
          addEdge(c, par.personId, { type: 'parent', role: par.role, unionId: u.id });
          addEdge(par.personId, c, { type: 'child', role: par.role, unionId: u.id });
        });
      });
      for (var i = 0; i < u.partners.length; i++) {
        for (var j = i + 1; j < u.partners.length; j++) {
          addEdge(u.partners[i].personId, u.partners[j].personId, { type: 'spouse', unionId: u.id });
          addEdge(u.partners[j].personId, u.partners[i].personId, { type: 'spouse', unionId: u.id });
        }
      }
    });

    return { peopleById: peopleById, unionsById: unionsById, housesById: housesById, adj: adj };
  }

  function getParents(p) {
    var out = {};
    if (!p.birthUnionId) return out;
    var u = state.unionsById.get(p.birthUnionId);
    if (!u) return out;
    u.partners.forEach(function (par) {
      var person = state.peopleById.get(par.personId);
      if (!person) return;
      if (par.role === 'father') out.father = person;
      if (par.role === 'mother') out.mother = person;
    });
    return out;
  }

  function getSpouses(p, unionType) {
    var out = [];
    (p.unionIds || []).forEach(function (uid) {
      var u = state.unionsById.get(uid);
      if (!u) return;
      if (unionType && u.type !== unionType) return;
      if (!unionType && u.type === 'betrothal') return;
      u.partners.forEach(function (par) {
        if (par.personId !== p.id) {
          var person = state.peopleById.get(par.personId);
          if (person) out.push(person);
        }
      });
    });
    return out;
  }

  function getChildren(p) {
    var out = [];
    (p.unionIds || []).forEach(function (uid) {
      var u = state.unionsById.get(uid);
      if (!u) return;
      u.childIds.forEach(function (cid) {
        var person = state.peopleById.get(cid);
        if (person) out.push(person);
      });
    });
    return out;
  }

  // ---------- BFS / relation algorithms ----------

  function shortestPath(fromId, toId) {
    if (fromId === toId) return [{ id: fromId, edge: null }];
    var visited = new Set([fromId]);
    var queue = [fromId];
    var cameFrom = new Map();
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      var neighbors = state.adj.get(cur) || [];
      for (var i = 0; i < neighbors.length; i++) {
        var e = neighbors[i];
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        cameFrom.set(e.to, { prevId: cur, edge: e });
        if (e.to === toId) return reconstruct(cameFrom, fromId, toId);
        queue.push(e.to);
      }
    }
    return null;
  }

  function reconstruct(cameFrom, fromId, toId) {
    var path = [];
    var cur = toId;
    while (cur !== fromId) {
      var info = cameFrom.get(cur);
      path.unshift({ id: cur, edge: info.edge });
      cur = info.prevId;
    }
    path.unshift({ id: fromId, edge: null });
    return path;
  }

  function bfsDistances(startId) {
    var dist = new Map([[startId, 0]]);
    var queue = [startId];
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      var d = dist.get(cur);
      (state.adj.get(cur) || []).forEach(function (e) {
        if (!dist.has(e.to)) { dist.set(e.to, d + 1); queue.push(e.to); }
      });
    }
    return dist;
  }

  function allShortestPaths(fromId, toId) {
    if (fromId === toId) return [[{ id: fromId, edge: null }]];
    var distFromB = bfsDistances(toId);
    if (!distFromB.has(fromId)) return [];
    var target = distFromB.get(fromId);
    var results = [];
    var MAX_PATHS = 25;

    function dfs(cur, remaining, acc) {
      if (results.length >= MAX_PATHS) return;
      if (cur === toId) { results.push(acc.slice()); return; }
      if (remaining <= 0) return;
      (state.adj.get(cur) || []).forEach(function (e) {
        if (distFromB.get(e.to) === remaining - 1) {
          acc.push({ id: e.to, edge: e });
          dfs(e.to, remaining - 1, acc);
          acc.pop();
        }
      });
    }

    dfs(fromId, target, [{ id: fromId, edge: null }]);
    return results;
  }

  function edgeLabel(edge, targetPerson) {
    if (edge.type === 'parent') return targetPerson.sex === 'm' ? '父' : '母';
    if (edge.type === 'child') return targetPerson.sex === 'm' ? '息子' : '娘';
    if (edge.type === 'spouse') {
      var u = state.unionsById.get(edge.unionId);
      if (u && u.type === 'betrothal') return u.status === 'broken' ? '婚約者（破談）' : '婚約者';
      return targetPerson.sex === 'm' ? '夫' : '妻';
    }
    return '?';
  }

  function ageCompare(a, b) {
    if (!a.birth || !a.birth.year || !b.birth || !b.birth.year) return 'unknown';
    if (a.birth.year < b.birth.year) return 'elder';
    if (a.birth.year > b.birth.year) return 'younger';
    return 'unknown';
  }

  function siblingLabel(root, target) {
    var cmp = ageCompare(target, root);
    if (cmp === 'unknown') return target.sex === 'm' ? '兄弟' : '姉妹';
    if (target.sex === 'm') return cmp === 'elder' ? '兄' : '弟';
    return cmp === 'elder' ? '姉' : '妹';
  }

  // Returns { label } for a known short-form relation, or null to signal
  // "fall back to the literal step-by-step path" (per spec: exotic Japanese
  // kinship terms beyond ~2親等+common named relations are not worth hardcoding).
  function classifyRelation(path) {
    var n = path.length - 1;
    if (n === 0) return { label: '本人' };

    function personAt(i) { return state.peopleById.get(path[i].id); }
    function edgeAt(i) { return path[i].edge; }

    var root = personAt(0);
    var target = personAt(n);
    var types = [];
    for (var i = 1; i <= n; i++) types.push(edgeAt(i).type);
    var shape = types.join(',');

    if (n === 1) return { label: edgeLabel(edgeAt(1), target) };

    if (n === 2) {
      if (shape === 'parent,child') return { label: siblingLabel(root, target) };
      if (shape === 'parent,parent') {
        var side1 = edgeAt(1).role === 'father' ? '父方' : '母方';
        return { label: side1 + 'の' + (target.sex === 'm' ? '祖父' : '祖母') };
      }
      if (shape === 'child,child') return { label: target.sex === 'm' ? '孫息子' : '孫娘' };
      if (shape === 'spouse,parent') return { label: target.sex === 'm' ? '舅' : '姑' };
      if (shape === 'parent,spouse') return { label: target.sex === 'm' ? '継父' : '継母' };
      if (shape === 'spouse,child') return { label: target.sex === 'm' ? '継息子' : '継娘' };
      if (shape === 'child,spouse') {
        var mid2 = personAt(1);
        return { label: mid2.sex === 'm' ? '息子の妻' : '娘の夫' };
      }
    }

    if (n === 3) {
      if (shape === 'parent,parent,child') {
        var side2 = edgeAt(1).role === 'father' ? '父方' : '母方';
        var sharedParent = personAt(1);
        var cmp2 = ageCompare(target, sharedParent);
        var gen = cmp2 === 'elder' ? '伯' : (cmp2 === 'younger' ? '叔' : '');
        if (!gen) return { label: side2 + 'の' + (target.sex === 'm' ? 'おじ' : 'おば') };
        return { label: side2 + 'の' + gen + (target.sex === 'm' ? '父' : '母') };
      }
      if (shape === 'parent,child,child') return { label: target.sex === 'm' ? '甥' : '姪' };
      if (shape === 'spouse,parent,child') {
        var rootSpouse = personAt(1);
        var cmp3 = ageCompare(target, rootSpouse);
        if (cmp3 === 'unknown') return null;
        var elder3 = cmp3 === 'elder';
        return { label: target.sex === 'm' ? (elder3 ? '義兄' : '義弟') : (elder3 ? '義姉' : '義妹') };
      }
      if (shape === 'parent,child,spouse') {
        // root's sibling's spouse: an in-law if the union is a real marriage,
        // otherwise (e.g. a broken betrothal) compose "{sibling}の{edge label}"
        // rather than claiming an in-law relationship that never happened.
        var sibling = personAt(2);
        var spouseEdge = edgeAt(3);
        var relUnion = state.unionsById.get(spouseEdge.unionId);
        if (relUnion && relUnion.type === 'marriage') {
          var cmp5 = ageCompare(sibling, root);
          if (cmp5 !== 'unknown') {
            var elder5 = cmp5 === 'elder';
            return { label: target.sex === 'm' ? (elder5 ? '義兄' : '義弟') : (elder5 ? '義姉' : '義妹') };
          }
        }
        return { label: siblingLabel(root, sibling) + 'の' + edgeLabel(spouseEdge, target) };
      }
    }

    if (n === 4 && shape === 'parent,parent,child,child') {
      var cmp4 = ageCompare(target, root);
      if (cmp4 === 'unknown') return { label: 'いとこ' };
      var elder4 = cmp4 === 'elder';
      return { label: target.sex === 'm' ? (elder4 ? '従兄' : '従弟') : (elder4 ? '従姉' : '従妹') };
    }

    return null;
  }

  function literalChain(path) {
    var parts = [personDisplay(state.peopleById.get(path[0].id))];
    for (var i = 1; i < path.length; i++) {
      parts.push(edgeLabel(path[i].edge, state.peopleById.get(path[i].id)));
      parts.push(personDisplay(state.peopleById.get(path[i].id)));
    }
    return parts;
  }

  function relationText(rootId, targetId) {
    if (rootId === targetId) return null;
    var path = shortestPath(rootId, targetId);
    if (!path) return { label: null, chain: null };
    var rel = classifyRelation(path);
    if (rel) return { label: rel.label, chain: null };
    return { label: null, chain: literalChain(path) };
  }

  function personDisplay(p) { return p.displayNameJa || p.displayName; }

  // ---------- layout ----------

  function computeLayout(data) {
    var g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 96, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(function () { return {}; });

    data.people.forEach(function (p) { g.setNode('p:' + p.id, { width: PW, height: PH }); });
    data.unions.forEach(function (u) { g.setNode('u:' + u.id, { width: UW, height: UH }); });

    data.unions.forEach(function (u) {
      u.partners.forEach(function (par) { g.setEdge('p:' + par.personId, 'u:' + u.id, { minlen: 1 }); });
      u.childIds.forEach(function (c) { g.setEdge('u:' + u.id, 'p:' + c, { minlen: 1 }); });
    });

    dagre.layout(g);

    // Moving a person's x must drag their own descendant branch along with
    // them, or the branch visually detaches from its own root. This only
    // follows unions where personId is the SOLE partner (a "birth line" -
    // the usual pattern for an unlisted/unspecified spouse in this dataset):
    // cascading through a real 2-partner marriage would drag that spouse's
    // own, independently-anchored ancestry sideways too, which is wrong -
    // shared children of a marriage are instead centered by the pass below.
    // `shifted` is shared across every pass so no node is ever moved twice.
    var shifted = new Set();
    function shiftDescendants(personId, dx) {
      var person = state.peopleById.get(personId);
      (person.unionIds || []).forEach(function (uid) {
        var u = state.unionsById.get(uid);
        if (!u || u.partners.length !== 1 || u.partners[0].personId !== personId) return;
        u.childIds.forEach(function (cid) {
          if (shifted.has(cid)) return;
          // A child with their own layoutHint is independently positioned
          // by applyPinBeside below - dragging them along here would fight
          // that explicit placement (e.g. one sibling manually relocated to
          // sit beside their in-laws' house while another sibling who
          // stayed with the birth family must NOT be dragged along too).
          if (state.peopleById.get(cid).layoutHint) return;
          g.node('p:' + cid).x += dx;
          shifted.add(cid);
          shiftDescendants(cid, dx);
        });
      });
    }

    // dagre's crossing-minimization can reorder same-rank siblings arbitrarily;
    // re-assign their existing x-slots (computed by dagre, so spacing/overlap
    // is already correct) so left-to-right always matches birth order, and
    // carry each sibling's own descendants along with them.
    data.unions.forEach(function (u) {
      if (u.childIds.length < 2) return;
      var ordered = u.childIds.slice().sort(function (a, b) {
        var pa = state.peopleById.get(a), pb = state.peopleById.get(b);
        var ya = (pa.birth && pa.birth.year) || 0, yb = (pb.birth && pb.birth.year) || 0;
        return ya - yb;
      });
      var xs = u.childIds.map(function (cid) { return g.node('p:' + cid).x; }).sort(function (a, b) { return a - b; });
      ordered.forEach(function (cid, i) {
        var node = g.node('p:' + cid);
        var dx = xs[i] - node.x;
        node.x = xs[i];
        shifted.add(cid);
        if (dx) shiftDescendants(cid, dx);
      });
    });

    // A person with no parents in the dataset and exactly one marriage has no
    // family context of their own to anchor them - pull them next to their
    // spouse instead of leaving them wherever dagre's global crossing
    // minimization happened to drop them.
    data.people.forEach(function (person) {
      if (person.layoutHint || person.birthUnionId || shifted.has(person.id)) return;
      var uids = person.unionIds || [];
      if (uids.length !== 1) return;
      var u = state.unionsById.get(uids[0]);
      if (!u || u.partners.length !== 2) return;
      var spousePar = u.partners.find(function (par) { return par.personId !== person.id; });
      if (!spousePar) return;
      var spouse = state.peopleById.get(spousePar.personId);
      if (!spouse.birthUnionId && (spouse.unionIds || []).length === 1) return; // both pendant, no clear anchor
      var pn = g.node('p:' + person.id), sn = g.node('p:' + spouse.id);
      if (Math.abs(pn.y - sn.y) > 1) return; // different rank, adjacency isn't meaningful here
      var gap = PW + 40;
      var dx = (sn.x - gap) - pn.x;
      if (Math.abs(dx) < 1) return;
      pn.x += dx;
      shifted.add(person.id);
      shiftDescendants(person.id, dx);
    });

    // Optional manual override: pin a person immediately beside a named
    // anchor person (left/right of them, same rank), overriding wherever
    // dagre/the passes above put their own birth-family branch. Opt-in via
    // data (layoutHint) rather than automatic, since it's only needed when a
    // person's default placement crosses far from where they read best -
    // e.g. their birth family sits far from their marital family and the
    // parent-child edge crosses large unrelated parts of the graph, or a
    // whole side-branch (an in-law's own ancestry) drifted behind an
    // unrelated house purely because of how dagre minimized crossings.
    // Called twice: once before the single-child centering pass below (so a
    // hinted person's OWN single-child union centers on their corrected
    // position) and once after it (so a hint that targets someone else's
    // now-final centered position reads it correctly). Idempotent, so the
    // second call is a no-op for anyone already settled by the first.
    // `gap` optionally overrides the default card-width spacing: when the
    // anchor's neighbor on that side is already exactly one gap away (no
    // free slot), a smaller gap deliberately lands short of that neighbor so
    // the final overlap safety net below pushes the *neighbor* further out
    // instead of ping-ponging back onto the anchor itself.
    function applyPinBeside() {
      data.people.forEach(function (person) {
        if (!person.layoutHint || !person.layoutHint.pinBeside) return;
        var anchor = state.peopleById.get(person.layoutHint.pinBeside);
        if (!anchor) return;
        var pn = g.node('p:' + person.id), an = g.node('p:' + anchor.id);
        var gap = person.layoutHint.gap != null ? person.layoutHint.gap : PW + 40;
        var targetX = person.layoutHint.side === 'right' ? an.x + gap : an.x - gap;
        var dx = targetX - pn.x;
        pn.x = targetX;
        pn.y = an.y;
        shifted.add(person.id);
        if (Math.abs(dx) >= 1) shiftDescendants(person.id, dx);
      });
    }
    applyPinBeside();

    // A union with exactly one child (regardless of partner count) should
    // hang that child directly beneath its parent(s)' now-final midpoint,
    // rather than wherever dagre's whole-graph crossing minimization put it -
    // this is what actually keeps e.g. a couple's only child centered between
    // them. Processed top-to-bottom (by the union's own rank) so a chain of
    // such unions settles one generation at a time.
    var singleChildUnions = data.unions.filter(function (u) { return u.childIds.length === 1; });
    singleChildUnions.sort(function (a, b) { return g.node('u:' + a.id).y - g.node('u:' + b.id).y; });
    singleChildUnions.forEach(function (u) {
      var cid = u.childIds[0];
      if (shifted.has(cid)) return;
      var xs = u.partners.map(function (par) { return g.node('p:' + par.personId).x; });
      var midX = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
      var node = g.node('p:' + cid);
      var dx = midX - node.x;
      node.x = midX;
      shifted.add(cid);
      if (dx) shiftDescendants(cid, dx);
    });

    applyPinBeside();

    // Optional manual override: exchange final x with another person at the
    // same rank - for two people who aren't a couple (so pinBeside's rank
    // sync would be wrong) but who'd simply read more naturally in the
    // opposite left-right order once dagre/the passes above settle them
    // side by side. Declared on only one side of the pair.
    data.people.forEach(function (person) {
      if (!person.layoutHint || !person.layoutHint.swapWith) return;
      var other = state.peopleById.get(person.layoutHint.swapWith);
      if (!other) return;
      var pn = g.node('p:' + person.id), on = g.node('p:' + other.id);
      if (Math.abs(pn.y - on.y) > 1) return;
      var px = pn.x;
      pn.x = on.x;
      on.x = px;
    });

    // Final safety net: the passes above reposition branches without global
    // knowledge of each other, so an unrelated branch can end up overlapping
    // another. Walk each rank left-to-right and push anything overlapping
    // further right, cascading so a pushed branch doesn't detach from itself.
    var byRank = new Map();
    data.people.forEach(function (p) {
      var key = Math.round(g.node('p:' + p.id).y);
      if (!byRank.has(key)) byRank.set(key, []);
      byRank.get(key).push(p.id);
    });
    var minGap = PW + 30;
    Array.from(byRank.keys()).sort(function (a, b) { return a - b; }).forEach(function (rankY) {
      var ids = byRank.get(rankY).sort(function (a, b) { return g.node('p:' + a).x - g.node('p:' + b).x; });
      for (var i = 1; i < ids.length; i++) {
        var prevNode = g.node('p:' + ids[i - 1]);
        var node = g.node('p:' + ids[i]);
        var minX = prevNode.x + minGap;
        if (node.x < minX) {
          var dx = minX - node.x;
          node.x = minX;
          shiftDescendants(ids[i], dx);
        }
      }
    });

    // Union markers are purely a visual junction between partners - recompute
    // fresh from final partner positions rather than tracking every shift.
    // An optional dotOffset then nudges just the marker (and the partner
    // lines drawn to it, which read this same node each render) clear of an
    // unrelated union whose marker happens to land on the same spot - e.g.
    // two same-generation couples whose partner x's average out identically.
    data.unions.forEach(function (u) {
      var un = g.node('u:' + u.id);
      var xs = u.partners.map(function (par) { return g.node('p:' + par.personId).x; });
      un.x = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
      if (u.dotOffset) {
        un.x += u.dotOffset.dx || 0;
        un.y += u.dotOffset.dy || 0;
      }
    });

    return g;
  }

  // ---------- rendering ----------

  var els = {};

  function cacheEls() {
    els.viewport = document.getElementById('graphViewport');
    els.inner = document.getElementById('graphInner');
    els.edges = document.getElementById('graphEdges');
    els.nodes = document.getElementById('graphNodes');
    els.houses = document.getElementById('houseLayer');
    els.detailPanel = document.getElementById('detailPanel');
    els.detailBody = document.getElementById('detailBody');
    els.detailClose = document.getElementById('detailClose');
    els.pathText = document.getElementById('pathText');
    els.rootInput = document.getElementById('rootSearch');
    els.rootResults = document.getElementById('rootResults');
    els.personInput = document.getElementById('personSearch');
    els.personResults = document.getElementById('searchResults');
    els.pathModeToggle = document.getElementById('pathModeToggle');
    els.pathInputs = document.getElementById('pathInputs');
    els.pathA = document.getElementById('pathA');
    els.pathAResults = document.getElementById('pathAResults');
    els.pathB = document.getElementById('pathB');
    els.pathBResults = document.getElementById('pathBResults');
    els.pathSearchBtn = document.getElementById('pathSearchBtn');
    els.pathClearBtn = document.getElementById('pathClearBtn');
    els.zoomReset = document.getElementById('zoomReset');
  }

  function renderAll() {
    var g = state.layout;
    var graphBox = g.graph();
    // dagre's own graph.width/height reflect its layout BEFORE the manual
    // layoutHint passes ran; a hint can cascade a branch further out than
    // that, so re-measure the actual final extent of every person node and
    // grow the box to fit - otherwise the SVG (which clips to its own
    // width/height/viewBox regardless of any parent's overflow) silently
    // cuts off edges beyond the stale bound while the plain HTML cards,
    // unaffected by that clipping, still render fine.
    var maxX = graphBox.width, maxY = graphBox.height;
    state.data.people.forEach(function (p) {
      var n = g.node('p:' + p.id);
      maxX = Math.max(maxX, n.x + PW / 2 + 60);
      maxY = Math.max(maxY, n.y + PH / 2 + 60);
    });
    graphBox = { width: maxX, height: maxY };
    els.inner.style.width = graphBox.width + 'px';
    els.inner.style.height = graphBox.height + 'px';
    els.edges.setAttribute('width', graphBox.width);
    els.edges.setAttribute('height', graphBox.height);
    els.edges.setAttribute('viewBox', '0 0 ' + graphBox.width + ' ' + graphBox.height);

    renderHouses(graphBox);
    renderEdges();
    renderNodes();
    applyCollapse();
    renderBadges();
  }

  function renderHouses(graphBox) {
    els.houses.innerHTML = '';
    var pad = 26;
    // A card counts as "in" the house's horizontal range once at least 2/3
    // of its width overlaps the box, not only when it's fully inside. This
    // lets the box sit narrower than the strict min/max of every member's
    // left edge - which matters for a house whose column drifts sideways
    // across generations (e.g. squeezed between two other houses that
    // themselves shift per rank): the strict box would be wide enough to
    // cover the whole drift and uselessly overlap a neighbor's equally
    // drifting column, while still letting an outlier card poke out by its
    // outer third rather than being fully enclosed.
    var minOverlap = PW * 2 / 3;
    state.housesById.forEach(function (house) {
      var members = state.data.people.filter(function (p) { return p.houseId === house.id; });
      if (!members.length) return;
      var minLeft = Infinity, maxLeft = -Infinity, minY = Infinity, maxY = -Infinity;
      members.forEach(function (p) {
        var n = state.layout.node('p:' + p.id);
        minLeft = Math.min(minLeft, n.x - PW / 2);
        maxLeft = Math.max(maxLeft, n.x - PW / 2);
        minY = Math.min(minY, n.y - PH / 2);
        maxY = Math.max(maxY, n.y + PH / 2);
      });
      var minX = minLeft + PW - minOverlap;
      var maxX = maxLeft + minOverlap;
      if (maxX - minX < minOverlap) {
        var midX = (minX + maxX) / 2;
        minX = midX - minOverlap / 2;
        maxX = midX + minOverlap / 2;
      }

      var panel = document.createElement('div');
      panel.className = 'house-panel';
      panel.style.left = (minX - pad) + 'px';
      panel.style.top = (minY - pad - 30) + 'px';
      panel.style.width = (maxX - minX + pad * 2) + 'px';
      panel.style.height = (maxY - minY + pad * 2 + 30) + 'px';
      panel.style.borderColor = house.color;
      panel.style.background = 'color-mix(in srgb, ' + house.color + ' 7%, transparent)';
      els.houses.appendChild(panel);

      var offset = house.labelOffset || {};
      var label = document.createElement('button');
      label.type = 'button';
      label.className = 'house-label';
      label.style.left = (minX - pad + (offset.dx || 0)) + 'px';
      label.style.top = (minY - pad - 30 + (offset.dy || 0)) + 'px';
      label.style.color = house.color;
      label.style.borderColor = house.color;
      label.textContent = (state.collapsedHouses.has(house.id) ? '▸ ' : '▾ ') + house.name.ja;
      label.addEventListener('click', function () { toggleHouse(house.id); });
      els.houses.appendChild(label);
    });
  }

  function toggleHouse(houseId) {
    if (state.collapsedHouses.has(houseId)) state.collapsedHouses.delete(houseId);
    else state.collapsedHouses.add(houseId);
    renderHouses(state.layout.graph());
    applyCollapse();
  }

  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  function renderEdges() {
    els.edges.innerHTML = '';
    var svgNS = 'http://www.w3.org/2000/svg';
    state.data.unions.forEach(function (u) {
      var un = state.layout.node('u:' + u.id);
      var betrothed = u.type === 'betrothal';
      u.partners.forEach(function (par) {
        var pn = state.layout.node('p:' + par.personId);
        var line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', pn.x); line.setAttribute('y1', pn.y + PH / 2);
        line.setAttribute('x2', un.x); line.setAttribute('y2', un.y);
        line.setAttribute('class', 'rel-edge rel-edge-spouse' + (betrothed ? ' rel-edge-betrothal' : ''));
        line.dataset.a = par.personId; line.dataset.b = '__u_' + u.id;
        els.edges.appendChild(line);
      });
      u.childIds.forEach(function (cid) {
        var cn = state.layout.node('p:' + cid);
        var line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', un.x); line.setAttribute('y1', un.y);
        line.setAttribute('x2', cn.x); line.setAttribute('y2', cn.y - PH / 2);
        line.setAttribute('class', 'rel-edge rel-edge-child');
        line.dataset.a = '__u_' + u.id; line.dataset.b = cid;
        els.edges.appendChild(line);
      });
      var marker = document.createElementNS(svgNS, 'circle');
      marker.setAttribute('cx', un.x); marker.setAttribute('cy', un.y);
      marker.setAttribute('r', 4);
      marker.setAttribute('class', 'rel-union-dot');
      marker.dataset.union = u.id;
      els.edges.appendChild(marker);
    });
  }

  function renderNodes() {
    els.nodes.innerHTML = '';
    state.data.people.forEach(function (p) {
      var n = state.layout.node('p:' + p.id);
      var card = document.createElement('div');
      card.className = 'person-node';
      card.dataset.person = p.id;
      card.dataset.house = p.houseId;
      card.style.left = (n.x - PW / 2) + 'px';
      card.style.top = (n.y - PH / 2) + 'px';
      card.style.width = PW + 'px';
      card.style.height = PH + 'px';

      var years = formatYears(p);
      card.innerHTML =
        '<h3>' + escapeHtml(personDisplay(p)) + '</h3>' +
        (years ? '<span class="years">' + years + '</span>' : '') +
        '<span class="rel-badge" data-badge="' + p.id + '"></span>';

      card.addEventListener('click', function () { openDetail(p.id); });
      els.nodes.appendChild(card);
    });
  }

  function renderBadges() {
    var root = state.peopleById.get(state.rootId);
    state.data.people.forEach(function (p) {
      var badgeEl = els.nodes.querySelector('[data-badge="' + p.id + '"]');
      if (!badgeEl) return;
      if (p.id === state.rootId) { badgeEl.textContent = '基準人物'; badgeEl.classList.add('is-root'); return; }
      badgeEl.classList.remove('is-root');
      var rel = relationText(state.rootId, p.id);
      if (!rel) { badgeEl.textContent = ''; return; }
      if (rel.label) badgeEl.textContent = root.displayNameJa + 'の' + rel.label;
      else if (rel.chain) badgeEl.textContent = rel.chain.join(' → ');
      else badgeEl.textContent = '';
    });
  }

  // A person stays visible when their house is collapsed if any of their
  // relations (parent/child/spouse) reaches into a different house - i.e.
  // they are the visible "bridge" connecting that house to the rest of the
  // graph. A house with no bridge members left simply hides everyone.
  function isBoundaryPerson(p) {
    var edges = state.adj.get(p.id) || [];
    return edges.some(function (e) {
      var other = state.peopleById.get(e.to);
      return other && other.houseId !== p.houseId;
    });
  }

  function isHiddenByCollapse(personId) {
    var p = state.peopleById.get(personId);
    var house = p && state.housesById.get(p.houseId);
    return !!(house && state.collapsedHouses.has(house.id) && !isBoundaryPerson(p));
  }

  function applyCollapse() {
    state.data.people.forEach(function (p) {
      var hidden = isHiddenByCollapse(p.id);
      var card = els.nodes.querySelector('[data-person="' + p.id + '"]');
      if (card) card.classList.toggle('is-hidden', hidden);
    });
    var lines = els.edges.querySelectorAll('.rel-edge, .rel-union-dot');
    lines.forEach(function (el) {
      var a = el.dataset.a, b = el.dataset.b, uid = el.dataset.union;
      var hiddenEndpoint = [a, b].some(function (id) {
        return id && id.indexOf('__u_') !== 0 && isHiddenByCollapse(id);
      });
      if (uid) {
        var u = state.unionsById.get(uid);
        var anyHidden = u.partners.map(function (par) { return par.personId; }).concat(u.childIds)
          .some(isHiddenByCollapse);
        el.classList.toggle('is-hidden', anyHidden);
      } else {
        el.classList.toggle('is-hidden', hiddenEndpoint);
      }
    });
  }

  function formatYears(p) {
    var b = p.birth && p.birth.year, d = p.death && p.death.year;
    if (!b && !d) return '';
    return (b || '?') + ' – ' + (d || '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- detail panel ----------

  function fieldRow(label, valueHtml) {
    return '<div class="rel-field-row"><span class="k">' + escapeHtml(label) + '</span><span class="v">' + valueHtml + '</span></div>';
  }

  function personLinkHtml(p) {
    return '<button type="button" class="rel-person-link" data-goto="' + p.id + '">' + escapeHtml(personDisplay(p)) + '</button>';
  }

  function openDetail(personId) {
    var p = state.peopleById.get(personId);
    if (!p) return;
    state.lastDetailId = personId;
    var html = [];
    html.push('<h2>' + escapeHtml(personDisplay(p)) + '</h2>');
    if (p.displayName && p.displayNameJa && p.displayName !== p.displayNameJa) {
      html.push('<div class="rel-detail-orig">' + escapeHtml(p.displayName) + '</div>');
    }
    var years = formatYears(p);
    if (years) html.push('<div class="rel-detail-years">' + years + '</div>');
    var house = state.housesById.get(p.houseId);
    if (house) html.push('<div class="rel-detail-house">' + escapeHtml(house.name.ja) + '</div>');
    if (p.titles && p.titles.length) {
      html.push('<ul class="rel-detail-titles">' + p.titles.map(function (t) {
        var span = t.from ? ' (' + t.from + (t.to ? '–' + t.to : '') + ')' : '';
        return '<li>' + escapeHtml(t.ja || t.de) + span + '</li>';
      }).join('') + '</ul>');
    }

    if (p.memoir && p.memoir.appears) {
      html.push('<div class="rel-detail-memoir">📖 ヴィルヘルミーネ回想録に登場' + (p.memoir.notes ? '：' + escapeHtml(p.memoir.notes) : '') + '</div>');
    }

    var parents = getParents(p);
    if (parents.father) html.push(fieldRow('父', personLinkHtml(parents.father)));
    if (parents.mother) html.push(fieldRow('母', personLinkHtml(parents.mother)));
    var spouses = getSpouses(p);
    if (spouses.length) html.push(fieldRow('配偶者', spouses.map(personLinkHtml).join('、')));
    var betrothed = getSpouses(p, 'betrothal');
    if (betrothed.length) html.push(fieldRow('婚約者', betrothed.map(personLinkHtml).join('、')));
    var children = getChildren(p);
    if (children.length) html.push(fieldRow('子', children.map(personLinkHtml).join('、')));

    if (state.rootId && state.rootId !== p.id) {
      var root = state.peopleById.get(state.rootId);
      var rel = relationText(state.rootId, p.id);
      if (rel && rel.label) {
        html.push(fieldRow(root.displayNameJa + 'との関係', escapeHtml(root.displayNameJa + 'の「' + rel.label + '」')));
      } else if (rel && rel.chain) {
        html.push(fieldRow(root.displayNameJa + 'との関係', escapeHtml(rel.chain.join(' → '))));
      }
    }

    if (p.id !== state.rootId) {
      html.push('<button type="button" class="rel-btn rel-setroot" data-setroot="' + p.id + '">この人物を基準人物にする</button>');
    }

    els.detailBody.innerHTML = html.join('');
    els.detailPanel.hidden = false;

    els.detailBody.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { openDetail(btn.dataset.goto); focusOnPerson(btn.dataset.goto); });
    });
    var setRootBtn = els.detailBody.querySelector('[data-setroot]');
    if (setRootBtn) setRootBtn.addEventListener('click', function () { setRoot(setRootBtn.dataset.setroot); });

    highlightSingle(personId);
  }

  function highlightSingle(personId) {
    if (state.pathMode) return;
    els.nodes.querySelectorAll('.person-node').forEach(function (c) {
      c.classList.toggle('is-selected', c.dataset.person === personId);
    });
  }

  // ---------- root / search ----------

  function setRoot(personId) {
    state.rootId = personId;
    els.rootInput.value = personDisplay(state.peopleById.get(personId));
    renderBadges();
    if (!els.detailPanel.hidden && state.lastDetailId) openDetail(state.lastDetailId);
  }

  function allPeopleFlat() { return state.data.people; }

  function matchesQuery(p, q) {
    var names = [].concat(p.names.ja || [], p.names.de || [], p.names.en || [], [p.displayName, p.displayNameJa]).filter(Boolean);
    return names.some(function (n) { return n.toLowerCase().indexOf(q) !== -1; });
  }

  function createPicker(inputEl, resultsEl, onSelect) {
    var selected = null;
    function render(matches) {
      resultsEl.innerHTML = '';
      if (!matches.length) { resultsEl.hidden = true; return; }
      matches.slice(0, 8).forEach(function (p) {
        var div = document.createElement('div');
        div.className = 'rel-search-item';
        div.textContent = personDisplay(p);
        div.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selected = p.id;
          inputEl.value = personDisplay(p);
          resultsEl.hidden = true;
          onSelect(p.id);
        });
        resultsEl.appendChild(div);
      });
      resultsEl.hidden = false;
    }
    inputEl.addEventListener('input', function () {
      var q = inputEl.value.trim().toLowerCase();
      selected = null;
      if (!q) { resultsEl.hidden = true; return; }
      render(allPeopleFlat().filter(function (p) { return matchesQuery(p, q); }));
    });
    inputEl.addEventListener('blur', function () { setTimeout(function () { resultsEl.hidden = true; }, 150); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var resolved = resolve();
      if (resolved) { resultsEl.hidden = true; onSelect(resolved); }
    });
    // Resolves a selection even if the user typed a name and pressed Enter /
    // clicked elsewhere without explicitly clicking a dropdown suggestion.
    function resolve() {
      if (selected) return selected;
      var q = inputEl.value.trim().toLowerCase();
      if (!q) return null;
      var matches = allPeopleFlat().filter(function (p) { return matchesQuery(p, q); });
      if (matches.length === 1) { selected = matches[0].id; return selected; }
      var exact = matches.find(function (p) {
        return personDisplay(p).toLowerCase() === q || (p.displayName || '').toLowerCase() === q;
      });
      if (exact) { selected = exact.id; return selected; }
      return null;
    }
    return { getSelected: function () { return selected; }, resolve: resolve };
  }

  // ---------- pan / zoom ----------

  function initZoom() {
    state.zoomBehavior = d3.zoom().scaleExtent([0.25, 2.5]).on('zoom', function (event) {
      els.inner.style.transform = 'translate(' + event.transform.x + 'px,' + event.transform.y + 'px) scale(' + event.transform.k + ')';
    });
    d3.select(els.viewport).call(state.zoomBehavior);
  }

  function centerOn(x, y, scale) {
    var rect = els.viewport.getBoundingClientRect();
    var k = scale || 1;
    var tx = rect.width / 2 - x * k;
    var ty = rect.height / 2 - y * k;
    d3.select(els.viewport).transition().duration(400)
      .call(state.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function focusOnPerson(personId) {
    var n = state.layout.node('p:' + personId);
    if (!n) return;
    centerOn(n.x, n.y, 1);
    els.nodes.querySelectorAll('.person-node').forEach(function (c) {
      c.classList.toggle('is-flash', c.dataset.person === personId);
    });
  }

  function resetView() {
    var n = state.layout.node('p:' + state.rootId);
    if (n) centerOn(n.x, n.y, 1);
  }

  // ---------- path mode ----------

  function togglePathMode() {
    state.pathMode = !state.pathMode;
    els.pathInputs.hidden = !state.pathMode;
    if (!state.pathMode) clearPathHighlight();
  }

  function clearPathHighlight() {
    state.currentPath = null;
    els.inner.classList.remove('rel-pathmode');
    els.nodes.querySelectorAll('.person-node').forEach(function (c) { c.classList.remove('on-path'); });
    els.edges.querySelectorAll('.rel-edge, .rel-union-dot').forEach(function (e) { e.classList.remove('on-path'); });
    els.pathText.hidden = true;
    els.pathText.innerHTML = '';
  }

  function runPathSearch(aId, bId) {
    if (!aId || !bId || aId === bId) return;
    var paths = allShortestPaths(aId, bId);
    if (!paths.length) {
      els.pathText.hidden = false;
      els.pathText.innerHTML = '<p>経路が見つかりませんでした。</p>';
      return;
    }
    var path = paths[0];
    state.currentPath = path;
    els.inner.classList.add('rel-pathmode');

    var nodeIds = new Set(path.map(function (s) { return s.id; }));
    els.nodes.querySelectorAll('.person-node').forEach(function (c) {
      c.classList.toggle('on-path', nodeIds.has(c.dataset.person));
    });

    var edgeSet = new Set();
    for (var i = 1; i < path.length; i++) {
      var e = path[i].edge;
      edgeSet.add(edgeKey(path[i - 1].id, '__u_' + e.unionId));
      edgeSet.add(edgeKey('__u_' + e.unionId, path[i].id));
    }
    els.edges.querySelectorAll('.rel-edge').forEach(function (el) {
      el.classList.toggle('on-path', edgeSet.has(edgeKey(el.dataset.a, el.dataset.b)));
    });
    els.edges.querySelectorAll('.rel-union-dot').forEach(function (el) {
      el.classList.toggle('on-path', path.some(function (s, i) { return i > 0 && path[i].edge.unionId === el.dataset.union; }));
    });

    var lines = [personDisplay(state.peopleById.get(path[0].id))];
    for (var j = 1; j < path.length; j++) {
      var label = edgeLabel(path[j].edge, state.peopleById.get(path[j].id));
      lines.push('↓ ' + label);
      lines.push(personDisplay(state.peopleById.get(path[j].id)));
    }
    var extra = paths.length > 1 ? '<p class="rel-path-extra">他に ' + (paths.length - 1) + ' 経路あり</p>' : '';
    els.pathText.hidden = false;
    els.pathText.innerHTML = '<div class="rel-path-chain">' + lines.map(escapeHtml).join('<br>') + '</div>' + extra;
  }

  // ---------- init ----------

  function wireUi() {
    createPicker(els.rootInput, els.rootResults, function (id) { setRoot(id); focusOnPerson(id); });
    createPicker(els.personInput, els.personResults, function (id) { openDetail(id); focusOnPerson(id); });
    var pickA = createPicker(els.pathA, els.pathAResults, function () {});
    var pickB = createPicker(els.pathB, els.pathBResults, function () {});

    els.detailClose.addEventListener('click', function () {
      els.detailPanel.hidden = true;
      els.nodes.querySelectorAll('.person-node').forEach(function (c) { c.classList.remove('is-selected'); });
    });
    els.pathModeToggle.addEventListener('click', togglePathMode);
    els.pathSearchBtn.addEventListener('click', function () {
      var aId = pickA.resolve(), bId = pickB.resolve();
      if (!aId || !bId) {
        els.pathText.hidden = false;
        els.pathText.innerHTML = '<p>人物Aと人物Bを候補一覧から選択してください。</p>';
        return;
      }
      runPathSearch(aId, bId);
    });
    els.pathClearBtn.addEventListener('click', clearPathHighlight);
    els.zoomReset.addEventListener('click', resetView);
  }

  function init() {
    cacheEls();
    fetch('data/genealogy.json').then(function (r) { return r.json(); }).then(function (data) {
      state.data = data;
      var built = buildGraph(data);
      state.peopleById = built.peopleById;
      state.unionsById = built.unionsById;
      state.housesById = built.housesById;
      state.adj = built.adj;
      state.layout = computeLayout(data);

      els.rootInput.value = personDisplay(state.peopleById.get(state.rootId));

      wireUi();
      renderAll();
      initZoom();
      resetView();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
