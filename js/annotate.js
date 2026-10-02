/* 手写标注引擎
   - 编辑模式：open(host,key) 画布可交互
   - 阅读模式：renderScope() 把已保存的笔画以「只读」画布叠在原文上，随时可见
   笔画以 0~1 归一化坐标存储，跨设备等比缩放；绘制用中点二次贝塞尔平滑 */
window.ANNO = (function () {
  const COLORS = ['#d0342c', '#1f6feb', '#1f8a5b', '#111111', '#d89055', '#8e44ad'];
  const HL = '#ffd640';
  const WIDTHS = [0.18, 0.25, 0.34, 0.45, 0.6, 0.8, 1.05, 1.4];   // 8 档：第 4 档 = 原来的 1 档粗细（0.45，默认）

  const st = {
    on: false, color: COLORS[0], wi: 3, mode: 'pen', scroll: false,
    host: null, key: null, strokes: [], cv: null, drawing: false, cur: null, dirty: false
  };
  const seen = new WeakSet();
  let obsList = [];
  let visible = localStorage.getItem('zz720.annoOn') !== '0';

  const width = () => WIDTHS[st.wi];

  function ensure(host) {
    host.classList.add('annohost');
    let cv = null;
    for (const c of host.children) if (c.classList && c.classList.contains('anno-cv')) cv = c;
    if (!cv) { cv = document.createElement('canvas'); cv.className = 'anno-cv'; host.appendChild(cv); }
    cv.style.pointerEvents = 'none';
    cv.classList.remove('editing');
    return cv;
  }

  function fit(host, cv) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* 一条笔画 → 路径（中点二次贝塞尔平滑） */
  function path(ctx, pts, w, h) {
    if (!pts || !pts.length) return;
    if (pts.length === 1) {
      const r = ctx.lineWidth / 2;
      ctx.beginPath();
      ctx.arc(pts[0][0] * w, pts[0][1] * h, Math.max(r, 0.4), 0, 6.283);
      ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    if (pts.length === 2) { ctx.lineTo(pts[1][0] * w, pts[1][1] * h); ctx.stroke(); return; }
    let i = 1;
    for (; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2 * w;
      const yc = (pts[i][1] + pts[i + 1][1]) / 2 * h;
      ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h, xc, yc);
    }
    ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h,
      (pts[i][0] + pts[i][0]) / 2 * w, (pts[i][1] + pts[i][1]) / 2 * h);
    ctx.stroke();
  }

  function paint(cv, strokes, w, h) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.c;
      ctx.globalAlpha = s.a == null ? 1 : s.a;
      ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
      ctx.lineWidth = Math.max(0.8, (s.w / 100) * w);
      path(ctx, s.p, w, h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  function applyMode() {
    if (!st.cv) return;
    st.cv.style.pointerEvents = st.scroll ? 'none' : 'auto';
    st.cv.classList.toggle('editing', !st.scroll && st.on);
  }

  function redraw() {
    if (!st.host || !st.cv) return;
    if (!fit(st.host, st.cv)) return;
    paint(st.cv, st.strokes, st.host.clientWidth, st.host.clientHeight);
  }

  /* ---------- 只读层 ---------- */
  function renderOne(host, tries) {
    const key = host.getAttribute('data-anno');
    if (!key) return;
    if (!host.offsetParent && host.offsetWidth === 0) return;
    const rec = ZS.data.annos[key];
    const has = rec && rec.strokes && rec.strokes.length;
    if (!has || !visible) {
      const c = host.querySelector(':scope > canvas.anno-cv');
      if (c) c.remove();
      return;
    }
    if (st.on && st.host === host) return;
    const cv = ensure(host);
    if (!fit(host, cv)) {
      tries = tries || 0;
      if (tries < 24) setTimeout(() => renderOne(host, tries + 1), 350);
      return;
    }
    paint(cv, rec.strokes, host.clientWidth, host.clientHeight);
    if (!seen.has(host)) {
      seen.add(host);
      const ob = new ResizeObserver(() => {
        const c = host.querySelector(':scope > canvas.anno-cv');
        if (!c || (st.on && st.host === host)) return;
        if (!fit(host, c)) return;
        paint(c, (ZS.data.annos[key] || {}).strokes || [], host.clientWidth, host.clientHeight);
      });
      ob.observe(host);
      obsList.push(ob);
    }
  }

  function renderScope(scope) {
    obsList.forEach(o => { try { o.disconnect(); } catch (e) { } });
    obsList = [];
    const root = scope || document.getElementById('view') || document;
    root.querySelectorAll('[data-anno]').forEach(el => renderOne(el));
  }

  function setVisible(v) {
    visible = !!v;
    localStorage.setItem('zz720.annoOn', visible ? '1' : '0');
    if (!visible) document.querySelectorAll('canvas.anno-cv').forEach(c => { if (!(st.on && c.parentElement === st.host)) c.remove(); });
    renderScope();
    document.dispatchEvent(new CustomEvent('anno-visibility'));
  }

  /* ---------- 编辑 ---------- */
  function pos(e, cv) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }
  function bind(cv) {
    const host = st.host;
    cv.onpointerdown = e => {
      if (!st.on) return;
      e.preventDefault(); e.stopPropagation();
      st.drawing = true;
      try { cv.setPointerCapture(e.pointerId); } catch (_) { }
      st.cur = mkStroke();
      st.cur.p.push(pos(e, cv));
      paint(cv, st.strokes.concat([st.cur]), host.clientWidth, host.clientHeight);
    };
    cv.onpointermove = e => {
      if (!st.on || !st.drawing || !st.cur) return;
      e.preventDefault();
      let evs = [];
      try { evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; } catch (_) { evs = []; }
      if (!evs || !evs.length) evs = [e];
      const p = st.cur.p;
      for (const ev of evs) {
        const q = pos(ev, cv);
        const l = p[p.length - 1];
        if (l && Math.abs(q[0] - l[0]) < 0.0012 && Math.abs(q[1] - l[1]) < 0.0012) continue;  // 去抖
        p.push(q);
      }
      paint(cv, st.strokes.concat([st.cur]), host.clientWidth, host.clientHeight);
    };
    const up = () => {
      if (!st.drawing) return;
      st.drawing = false;
      if (st.cur && st.cur.p.length) { st.strokes.push(st.cur); markDirty(); }
      st.cur = null;
      redraw();
    };
    cv.onpointerup = up; cv.onpointercancel = up; cv.onpointerleave = up;
  }

  function mkStroke() {
    if (st.mode === 'eraser') return { c: '#000', w: Math.max(width() * 8, 2.4), e: 1, p: [] };
    if (st.mode === 'hl') return { c: HL, w: width() * 7, a: .32, p: [] };
    return { c: st.color, w: width(), p: [] };
  }

  let saveT = null;
  function markDirty() {
    st.dirty = true;
    clearTimeout(saveT);
    saveT = setTimeout(flush, 1200);
    document.dispatchEvent(new CustomEvent('anno-change'));
  }
  function flush() {
    if (!st.dirty || !st.key) return;
    ZS.data.annos[st.key] = { ts: Date.now(), strokes: JSON.parse(JSON.stringify(st.strokes)) };
    ZS.save(); st.dirty = false;
  }

  function open(host, key) {
    if (!host) return false;
    if (st.on) close();
    let p = host;
    while (p && p !== document.body) {
      if (p.classList && p.classList.contains('acc')) p.classList.add('open');
      p = p.parentElement;
    }
    if (!host.clientHeight) host.style.minHeight = '160px';
    st.host = host; st.key = key;
    st.cv = ensure(host);
    st.scroll = localStorage.getItem('zz720.annoScroll') === '1';
    if (!fit(host, st.cv)) setTimeout(redraw, 300);
    bind(st.cv);
    const rec = ZS.data.annos[key];
    st.strokes = rec && rec.strokes ? JSON.parse(JSON.stringify(rec.strokes)) : [];
    st.on = true;
    redraw();
    applyMode();
    document.body.classList.add('annomode');
    if (!window._annoWin) { window._annoWin = redraw; window.addEventListener('resize', redraw); }
    showBar();
    return true;
  }

  function close() {
    flush();
    if (st.host) {
      const cv = st.host.querySelector(':scope > canvas.anno-cv');
      if (cv) { cv.style.pointerEvents = 'none'; cv.classList.remove('editing'); }
      st.host.style.minHeight = '';
      const h = st.host;
      setTimeout(() => { if (!st.on) renderOne(h); }, 60);
    }
    st.on = false; st.host = null; st.cv = null;
    document.body.classList.remove('annomode');
    hideBar();
  }

  function showBar() {
    const bar = document.getElementById('annobar');
    if (!bar) return;
    bar.classList.add('show');
    bar.innerHTML =
      '<div class="r1"><span class="colors" id="annoColors"></span>' +
      '<span id="annoW" class="tiny muted" style="margin-left:4px"></span></div>' +
      '<div class="r1">' +
      '<button class="iconbtn" data-a="mode" id="annoMode"></button>' +
      '<span style="width:1px;height:18px;background:var(--line)"></span>' +
      '<button class="iconbtn" data-a="pen">✏️ 笔</button>' +
      '<button class="iconbtn" data-a="hl">🖍 荧光</button>' +
      '<button class="iconbtn" data-a="eraser">🧽 橡皮</button>' +
      '<span style="width:1px;height:18px;background:var(--line)"></span>' +
      '<button class="iconbtn" data-a="thin">－ 细</button>' +
      '<button class="iconbtn" data-a="bold">＋ 粗</button>' +
      '<span style="flex:1"></span>' +
      '<button class="iconbtn" data-a="undo">↶ 撤销</button>' +
      '<button class="iconbtn" data-a="clear">🗑 清空</button>' +
      '<button class="iconbtn" data-a="close" style="background:var(--teal);color:#fff;border-color:var(--teal)">✓ 完成</button>' +
      '</div>';
    const cs = bar.querySelector('#annoColors');
    COLORS.forEach(c => {
      const b = document.createElement('span');
      b.className = 'sw' + (c === st.color ? ' on' : '');
      b.style.background = c;
      b.onclick = () => {
        st.color = c;
        if (st.mode !== 'pen') st.mode = 'pen';
        bar.querySelectorAll('.sw').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); syncBar();
      };
      cs.appendChild(b);
    });
    const hb = document.createElement('span');
    hb.className = 'sw hl'; hb.title = '荧光笔';
    hb.onclick = () => { st.mode = 'hl'; syncBar(); };
    cs.appendChild(hb);
    bar.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a));
    syncBar();
  }
  function hideBar() { const b = document.getElementById('annobar'); if (b) b.classList.remove('show'); }
  function syncBar() {
    const bar = document.getElementById('annobar'); if (!bar) return;
    ['pen', 'hl', 'eraser'].forEach(m => {
      const b = bar.querySelector('[data-a="' + m + '"]');
      if (b) b.classList.toggle('on', st.mode === m);
    });
    const w = bar.querySelector('#annoW');
    if (w) w.textContent = '笔宽 ' + (st.wi + 1) + '/' + WIDTHS.length;
    const mb = bar.querySelector('#annoMode');
    if (mb) {
      mb.textContent = st.scroll ? '🖐 滚动中（点此书写）' : '✍️ 书写中（点此滚动）';
      mb.classList.toggle('on', st.scroll);
    }
  }
  function act(a) {
    if (a === 'mode') {
      st.scroll = !st.scroll;
      localStorage.setItem('zz720.annoScroll', st.scroll ? '1' : '0');
      applyMode();
      ZS.toast(st.scroll ? '已切到滚动：手指可自由滑页面' : '已切到书写：可以直接写', 1600);
    }
    else if (a === 'pen') st.mode = 'pen';
    else if (a === 'hl') st.mode = 'hl';
    else if (a === 'eraser') st.mode = 'eraser';
    else if (a === 'thin') { st.wi = Math.max(0, st.wi - 1); ZS.toast('笔宽 ' + (st.wi + 1) + '/' + WIDTHS.length, 900); }
    else if (a === 'bold') { st.wi = Math.min(WIDTHS.length - 1, st.wi + 1); ZS.toast('笔宽 ' + (st.wi + 1) + '/' + WIDTHS.length, 900); }
    else if (a === 'undo') { if (st.strokes.length) { st.strokes.pop(); markDirty(); redraw(); ZS.toast('撤销一笔', 900); } else ZS.toast('没有可撤销的笔画'); }
    else if (a === 'clear') {
      if (!st.strokes.length) return ZS.toast('本区域还没有笔记');
      ZS.confirm('清空本区域的全部手写笔记？', () => {
        st.strokes = []; markDirty(); redraw(); ZS.toast('已清空');
      });
    }
    else if (a === 'close') close();
    syncBar();
  }

  document.addEventListener('click', e => {
    const hd = e.target.closest && e.target.closest('.acc > .hd');
    if (hd) setTimeout(() => renderScope(hd.closest('.acc') || document), 120);
  }, true);

  function paintOn(cv, strokes, w, h) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(cv, strokes, w, h);
  }

  return {
    open, close, renderScope, renderOne, setVisible, paintOn, WIDTHS,
    get on() { return st.on; },
    get widthIndex() { return st.wi; },
    get visible() { return visible; },
    COLORS,
  };
})();
