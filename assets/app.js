/* 产业园 REITs 数据站 —— 公共脚本 */
(function () {
  const DB = window.REITS_DB || { meta: {}, assets: [], provinces: [] };
  const GEO = window.CHINA_GEO || { provinces: [] };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 格式化 ---------- */
  const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(+v);
  const fmt = {
    n(v, d = 0) {
      if (!isNum(v)) return "—";
      return (+v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    pct(v, d = 1) { return isNum(v) ? (+v).toFixed(d) + "%" : "—"; },
    money(v) {
      if (!isNum(v)) return "—";
      const x = +v;
      if (Math.abs(x) >= 1e8) return (x / 1e8).toFixed(2) + " 亿";
      if (Math.abs(x) >= 1e4) return (x / 1e4).toFixed(0) + " 万";
      return fmt.n(x);
    },
    area(v) {
      if (!isNum(v)) return "—";
      return (+v / 1e4).toFixed(1) + " 万㎡";
    },
    q(q) {
      if (!q) return "—";
      const m = /^(\d{4})(Q[1-4]|H1|A)$/.exec(q);
      if (!m) return q;
      const t = { Q1: "一季报", Q2: "二季报", Q3: "三季报", Q4: "四季报", H1: "中期报告", A: "年度报告" };
      return m[1] + " " + (t[m[2]] || m[2]);
    },
    qs(q) { return q ? q.replace(/^(\d{4})/, "$1 ") : "—"; },
  };

  /* ---------- 明暗主题 ---------- */
  const THEME = (function () {
    const KEY = "reits-theme-mode";
    const root = document.documentElement;
    const NIGHT_START = 19; // 19:00 起进入深夜模式
    const NIGHT_END = 7;    // 07:00 起恢复白天模式
    let mode = readMode();
    let timer = null;

    function readMode() {
      try {
        const v = sessionStorage.getItem(KEY);
        return v === "light" || v === "dark" ? v : "auto";
      } catch (e) {
        return "auto";
      }
    }
    function isNight(d) {
      const h = (d || new Date()).getHours();
      return h >= NIGHT_START || h < NIGHT_END;
    }
    function current() {
      return mode === "auto" ? (isNight() ? "dark" : "light") : mode;
    }
    function tip() {
      const name = current() === "dark" ? "深夜模式" : "白天模式";
      return mode === "auto"
        ? `当前：${name}（19:00–07:00 自动切换深夜模式）· 点击手动切换`
        : `当前：${name}（手动）· 关闭标签页后恢复自动`;
    }
    function syncBtn() {
      Array.from(document.querySelectorAll(".theme-btn")).forEach((b) => {
        b.dataset.mode = mode;
        b.setAttribute("title", tip());
        b.setAttribute("aria-label", tip());
      });
    }
    function paint() {
      const t = current();
      root.setAttribute("data-theme", t);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", t === "dark" ? "#0a0d15" : "#4375ff");
      syncBtn();
      document.dispatchEvent(new CustomEvent("themechange", { detail: { mode, theme: t } }));
    }
    function set(next) {
      mode = next;
      try {
        if (next === "auto") sessionStorage.removeItem(KEY);
        else sessionStorage.setItem(KEY, next);
      } catch (e) {}
      paint();
    }
    function toggle() {
      set(current() === "dark" ? "light" : "dark");
    }
    function tick() {
      if (mode !== "auto") return;
      if (root.getAttribute("data-theme") !== (isNight() ? "dark" : "light")) paint();
    }
    function mount(btn) {
      if (btn) btn.addEventListener("click", toggle);
      if (timer) return;
      timer = setInterval(tick, 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
      // 首帧后再启用颜色过渡，避免加载瞬间补间
      requestAnimationFrame(() => {
        requestAnimationFrame(() => document.documentElement.classList.add("theme-anim"));
      });
    }
    document.addEventListener("DOMContentLoaded", paint);
    return { mount, paint, toggle, set, current, isNight, get mode() { return mode; } };
  })();

  /* ---------- 导航 ---------- */
  function mountNav(active) {
    const html = `<div class="nav"><div class="nav-inner">
      <a class="brand" href="index.html"><span class="brand-mark"></span><span>产业园区 REITs</span></a>
      <a class="link ${active === "home" ? "active" : ""}" href="index.html">首页</a>
      <a class="link ${active === "assets" ? "active" : ""}" href="assets.html">底层资产</a>
      <a class="link ${active === "prov" ? "active" : ""}" href="provinces.html">省份表现</a>
      <button class="theme-btn" type="button" data-mode="auto" aria-label="切换明暗模式">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle class="ring" cx="12" cy="12" r="8.6"/>
          <path class="half" d="M12 3.4a8.6 8.6 0 0 0 0 17.2z"/>
        </svg>
      </button>
    </div></div>`;
    document.body.insertAdjacentHTML("afterbegin", html);
    THEME.mount($(".theme-btn"));
    THEME.paint();
  }

  /* ---------- 地图 ---------- */
  // 颜色按主题走 CSS 变量（#map .prov.lv0 ~ .lv5），明暗模式自动跟随
  function levelFor(n, maxN) {
    if (!n) return 0;
    const r = n / (maxN || 1);
    return r > 0.75 ? 5 : r > 0.5 ? 4 : r > 0.32 ? 3 : r > 0.18 ? 2 : 1;
  }

  function mountMap(svg, sideEl) {
    const W = GEO.w, H = GEO.h;
    const pmap = {};
    DB.provinces.forEach((p) => (pmap[p.name] = p));
    const maxN = Math.max(1, ...DB.provinces.map((p) => p.n));

    svg.setAttribute("viewBox", GEO.viewBox);
    svg.setAttribute("width", "100%");

    let g = "";
    // 南海诸岛插图底框
    const b = GEO.nanhai.box;
    g += `<rect class="nh-frame" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="6"/>`;
    g += `<path class="nh-area" d="${GEO.nanhai.d}"/>`;
    g += `<text class="nh-text" x="${b[0] + 6}" y="${b[1] + b[3] - 6}">南海诸岛</text>`;

    GEO.provinces.forEach((p) => {
      const info = pmap[p.name];
      const lv = info ? levelFor(info.n, maxN) : 0;
      g += `<path class="prov lv${lv} ${info ? "has" : ""}" data-p="${p.name}" data-n="${info ? info.n : 0}"
              d="${p.d}"><title>${p.name}${info ? "　" + info.n + " 个资产" : "　暂无资产"}</title></path>`;
    });

    // 气泡（做简单避让，避免长三角等密集区重叠）
    const nodes = GEO.provinces
      .filter((p) => pmap[p.name])
      .map((p) => ({ name: p.name, x: p.cx, y: p.cy, r: 4 + Math.sqrt(pmap[p.name].n) * 2.2 }));
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.01;
          const min = a.r + b.r + 3;
          if (d < min) {
            const push = (min - d) / 2 + 0.2;
            dx /= d; dy /= d;
            a.x -= dx * push; a.y -= dy * push;
            b.x += dx * push; b.y += dy * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    nodes.forEach((n) => {
      g += `<circle class="bubble" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}"/>`;
      g += `<text class="bubble-label" x="${n.x.toFixed(1)}" y="${(n.y + 3.6).toFixed(1)}"
              text-anchor="middle">${pmap[n.name].n}</text>`;
    });

    svg.innerHTML = g;

    const tip = document.createElement("div");
    tip.className = "tooltip";
    document.body.appendChild(tip);

    const show = (e, name) => {
      const info = pmap[name];
      tip.innerHTML = info
        ? `<b>${name}</b>　${info.n} 个资产<br>出租率 ${fmt.pct(info.occ)}　坪效 ${fmt.n(info.psm)} 元/㎡/年`
        : `<b>${name}</b>　暂无底层资产`;
      tip.classList.add("show");
      tip.style.left = Math.min(window.innerWidth - 210, e.clientX + 14) + "px";
      tip.style.top = e.clientY + 16 + "px";
    };
    const hide = () => tip.classList.remove("show");

    $$(".prov.has", svg).forEach((el) => {
      el.addEventListener("mouseenter", (e) => {
        show(e, el.dataset.p);
        highlight(el.dataset.p, true);
      });
      el.addEventListener("mousemove", (e) => show(e, el.dataset.p));
      el.addEventListener("mouseleave", () => { hide(); highlight(null); });
      el.addEventListener("click", () => {
        location.href = "province.html?p=" + encodeURIComponent(el.dataset.p);
      });
    });

    function highlight(name, on) {
      $$(".prov", svg).forEach((el) => {
        if (!name) el.classList.remove("dim");
        else el.classList.toggle("dim", el.dataset.p !== name);
      });
      $$(".prov-row", sideEl).forEach((el) => {
        el.style.background = name && el.dataset.p === name ? "var(--theme-bg)" : "";
      });
    }

    // 右侧列表
    const list = $(".prov-list", sideEl);
    list.innerHTML = DB.provinces
      .slice()
      .sort((a, b) => b.n - a.n)
      .map(
        (p) => `<div class="prov-row" data-p="${p.name}">
          <span class="nm">${p.name}</span>
          <span class="bar"><i style="width:${(p.n / maxN) * 100}%"></i></span>
          <span class="ct">${p.n}</span>
        </div>`
      )
      .join("");

    $$(".prov-row", list).forEach((row) => {
      row.addEventListener("mouseenter", () => highlight(row.dataset.p, true));
      row.addEventListener("mouseleave", () => highlight(null));
      row.addEventListener("click", () => {
        location.href = "province.html?p=" + encodeURIComponent(row.dataset.p);
      });
    });
  }

  /* ---------- 折线图 ---------- */
  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const start = Math.floor(lo / step) * step;
    const out = [];
    for (let v = start; v <= hi + step * 0.5; v += step) out.push(+v.toFixed(6));
    if (out.length < 2) out.push(start + step);
    return out;
  }

  function drawChart(el, opt) {
    const pts = (opt.points || []).filter((d) => isNum(d.v));
    if (pts.length < 1) {
      el.innerHTML = `<div class="empty" style="padding:34px">暂无数据</div>`;
      return;
    }
    const W = 420, H = 190, PL = 46, PR = 12, PT = 16, PB = 26;
    const vals = pts.map((d) => +d.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.16;
    const ticks = niceTicks(lo - pad, hi + pad, 3);
    lo = ticks[0];
    hi = ticks[ticks.length - 1];

    const x = (i) => PL + (pts.length === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (pts.length - 1));
    const y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

    const color = opt.color || "#4375ff";
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
    s += `<defs><linearGradient id="g${opt.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;

    // 网格 + y 轴
    ticks.forEach((v) => {
      const yy = y(v);
      s += `<line class="axis-line" x1="${PL}" y1="${yy.toFixed(1)}" x2="${W - PR}" y2="${yy.toFixed(1)}"/>`;
      s += `<text class="axis-text" x="${PL - 8}" y="${(yy + 3.4).toFixed(1)}" text-anchor="end">${opt.yfmt ? opt.yfmt(v) : Math.round(v)}</text>`;
    });

    const line = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
    s += `<path class="series-area" d="${line} L${x(pts.length - 1).toFixed(1)},${(H - PB)} L${x(0).toFixed(1)},${H - PB} Z" fill="url(#g${opt.id})"/>`;
    s += `<path class="series" d="${line}" stroke="${color}"/>`;

    pts.forEach((d, i) => {
      s += `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(d.v).toFixed(1)}" r="3" fill="${color}"/>`;
    });

    // x 轴标签（避免相互重叠）
    const step = Math.max(1, Math.ceil(pts.length / 6));
    const idx = [];
    for (let i = 0; i < pts.length; i++) if (i % step === 0 || i === pts.length - 1) idx.push(i);
    const kept = [];
    idx.forEach((i) => {
      if (kept.length && Math.abs(x(i) - x(kept[kept.length - 1])) < 52) {
        if (i === pts.length - 1) kept[kept.length - 1] = i;
        return;
      }
      kept.push(i);
    });
    kept.forEach((i) => {
      s += `<text class="axis-text" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmt.qs(pts[i].q)}</text>`;
    });
    s += `</svg>`;
    el.innerHTML = s;
  }

  /* ---------- 迷你趋势 ---------- */
  function sparkline(series, key, color) {
    const pts = (series || []).filter((d) => isNum(d[key])).map((d) => +d[key]);
    if (pts.length < 2) return `<span class="muted" style="font-size:11px">—</span>`;
    const W = 78, H = 24;
    const lo = Math.min(...pts), hi = Math.max(...pts);
    const r = hi - lo || 1;
    const d = pts
      .map((v, i) => {
        const x = (i * W) / (pts.length - 1);
        const y = H - 3 - ((v - lo) / r) * (H - 6);
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <path d="${d}" fill="none" stroke="${color || "#4375ff"}" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>`;
  }

  /* ---------- 变化 ---------- */
  function delta(series, key) {
    const pts = (series || []).filter((d) => isNum(d[key]));
    if (pts.length < 2) return null;
    const a = +pts[pts.length - 2][key], b = +pts[pts.length - 1][key];
    if (!a) return null;
    return ((b - a) / Math.abs(a)) * 100;
  }
  function deltaPctPoint(series, key) {
    const pts = (series || []).filter((d) => isNum(d[key]));
    if (pts.length < 2) return null;
    return +pts[pts.length - 1][key] - +pts[pts.length - 2][key];
  }

  const NAV = { mountNav, mountMap, drawChart, sparkline, delta, deltaPctPoint, fmt, DB, GEO, $, $$, isNum };
  window.APP = NAV;
})();
