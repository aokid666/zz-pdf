/* 本地 + 云端存储层
   云端：GitHub Contents API 读写 userdata.json（放在独立的 userdata 分支，避免每次同步触发 Pages 重建）
   token 只存在本机 localStorage */
window.ZS = (function () {
  const P = 'zz720.v1.';
  const OWNER = 'aokid666', REPO = 'zhengzhi-720', BRANCH = 'userdata', FILE = 'userdata.json';
  const K = { data: P + 'data', cfg: P + 'cfg' };

  const blank = () => ({ v: 1, updated: 0, progress: {}, notes: {}, annos: {}, flags: {}, edit: {} });

  let data = blank();
  let dirty = false, pushTimer = null, syncing = false, lastSync = 0;

  function load() {
    try { data = Object.assign(blank(), JSON.parse(localStorage.getItem(K.data) || '{}')); }
    catch (e) { data = blank(); }
    if (!data.progress) data.progress = {};
    if (!data.notes) data.notes = {};
    if (!data.annos) data.annos = {};
    if (!data.flags) data.flags = {};
    if (!data.edit) data.edit = {};
    return data;
  }
  function save(now) {
    data.updated = Date.now();
    localStorage.setItem(K.data, JSON.stringify(data));
    dirty = true;
    if (now) return push();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(true), 12000);
  }
  function cfg() {
    const def = { owner: OWNER, repo: REPO, branch: BRANCH, file: FILE, auto: true };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(K.cfg) || '{}')); }
    catch (e) { return def; }
  }
  function setCfg(c) { localStorage.setItem(K.cfg, JSON.stringify(Object.assign(cfg(), c))); }

  function hdr(c) { return { 'Authorization': 'token ' + c.token, 'Accept': 'application/vnd.github+json' }; }
  function api(c, path, opt) {
    const url = 'https://api.github.com/repos/' + c.owner + '/' + c.repo + '/' + path;
    opt = opt || {};
    opt.headers = Object.assign(hdr(c), opt.headers || {});
    return fetch(url, opt);
  }

  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* userdata 分支不存在时，从 main 建一个 */
  async function ensureBranch(c) {
    if (!c.branch || c.branch === 'main') return true;
    const g = await api(c, 'git/ref/heads/' + c.branch, { headers: hdr(c) });
    if (g.ok || g.status === 200) return true;
    const m = await api(c, 'git/ref/heads/main', { headers: hdr(c) });
    if (!m.ok) return false;
    const sha = (await m.json()).object.sha;
    const p = await api(c, 'git/refs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'refs/heads/' + c.branch, sha: sha }),
    });
    return p.ok || p.status === 422;
  }

  async function pull(silent) {
    const c = cfg();
    if (!c.token) { if (!silent) toast('还没填 GitHub 令牌'); return null; }
    try {
      const r = await api(c, 'contents/' + c.file + '?ref=' + c.branch, { headers: hdr(c) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const remote = JSON.parse(b64dec(j.content));
      merge(remote);
      localStorage.setItem(K.data, JSON.stringify(data));
      return remote;
    } catch (e) { if (!silent) toast('拉取失败：' + e.message); return null; }
  }

  async function push(silent) {
    const c = cfg();
    if (!c.token) { if (!silent) toast('还没填 GitHub 令牌'); return false; }
    if (syncing) return false;
    syncing = true;
    try {
      let sha = null;
      const g = await api(c, 'contents/' + c.file + '?ref=' + c.branch, { headers: hdr(c) });
      if (g.ok) sha = (await g.json()).sha;
      else if (!(await ensureBranch(c))) throw new Error('无法创建分支 ' + c.branch);
      const body = {
        message: 'sync ' + new Date().toISOString().slice(0, 19),
        branch: c.branch, content: b64enc(JSON.stringify(data)),
      };
      if (sha) body.sha = sha;
      const p = await api(c, 'contents/' + c.file, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!p.ok) { const e = await p.json().catch(() => ({})); throw new Error(e.message || ('HTTP ' + p.status)); }
      dirty = false; lastSync = Date.now();
      if (!silent) toast('已同步到云端 ✓');
      document.dispatchEvent(new CustomEvent('zs-synced'));
      return true;
    } catch (e) { if (!silent) toast('同步失败：' + e.message, 3600); return false; }
    finally { syncing = false; }
  }

  function merge(remote) {
    if (!remote) return;
    for (const g of ['progress', 'notes', 'annos', 'flags', 'edit']) {
      const r = remote[g] || {}, l = data[g] || {};
      for (const k in r) if (!l[k] || (r[k].ts || 0) > (l[k].ts || 0)) l[k] = r[k];
      data[g] = l;
    }
    data.updated = Math.max(data.updated || 0, remote.updated || 0);
  }

  let toastT = null;
  function toast(msg, ms) {
    if (!msg) return;
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms || 2200);
  }
  function fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const p = x => String(x).padStart(2, '0');
    return (d.toDateString() === n.toDateString() ? '今天 ' : '') +
      p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  return {
    load, save, cfg, setCfg, pull, push, toast, fmt, ensureBranch,
    get data() { return data; },
    get dirty() { return dirty; },
    get lastSync() { return lastSync; },
    reset() { data = blank(); localStorage.removeItem(K.data); },
  };
})();
