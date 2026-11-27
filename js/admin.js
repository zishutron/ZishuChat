// ZishuChat admin panel. Talks straight to Firebase (Auth + Firestore); the Firestore rules decide who may read or write,
// so even though this page is public, only accounts listed in admins/{uid} can see anything.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, query, where,
  setDoc, deleteDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Same Firebase project as the Android app (values from AppConfig.java).
const CONFIG = {
  apiKey: "AIzaSyBbvNQh58euLimEMa8oj0PHzFs2Ofh2WFA",
  authDomain: "zishu-chat.firebaseapp.com",
  projectId: "zishu-chat",
  appId: "1:201443012538:android:176892c5f8d6716d397783"
};

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const PAGE = 50;
const DAY = 86400000;

// ------------------------------------------------------------------ small helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const toDate = (v) => (v && typeof v.toDate === "function") ? v.toDate() : (v instanceof Date ? v : null);
const fmt = (d) => d ? d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
function ago(d) {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return fmt(d);
}
function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "ad-toast" + (bad ? " err" : "");
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}
function show(view) {
  for (const id of ["viewLogin", "viewDenied", "viewApp"]) $(id).hidden = id !== view;
  if (view !== "viewApp") $("detail").hidden = true;
}
function friendlyError(e) {
  const c = (e && e.code) || "";
  if (c === "auth/unauthorized-domain") return "This website address is not authorised for sign-in. Firebase console > Authentication > Settings > Authorized domains > add this domain.";
  if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-login-credentials") return "Wrong email or password.";
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "";
  if (c === "auth/too-many-requests") return "Too many tries. Wait a little and try again.";
  if (c === "auth/network-request-failed") return "No internet connection.";
  if (c === "permission-denied") return "Firestore refused this request. Publish the latest Firestore rules and make sure this account is listed in admins.";
  return (e && e.message) || "Something went wrong.";
}

// ------------------------------------------------------------------ state
let me = null;
const users = new Map();   // uid -> { uid, ...profile, account }
const bans = new Map();    // uid -> ban data
let needle = "";
let shown = PAGE;
let loadingAccounts = 0;
let accountFails = 0;
let allContacts = null;    // [{ owner, id }] once loaded (collection group)

function banInfo(uid) {
  const b = bans.get(uid);
  if (!b) return null;
  const until = toDate(b.until);
  const active = !until || until.getTime() > Date.now();
  return { status: until ? "suspended" : "banned", active, until, reason: b.reason || "", by: b.byEmail || b.by || "", at: toDate(b.at) };
}
function statusOf(uid) {
  const b = banInfo(uid);
  return b && b.active ? b.status : "ok";
}
const nameOf = (u) => (u && ((u.name || "").trim() || u.username)) || "Unnamed user";

// ------------------------------------------------------------------ sign in
$("btnGoogle").addEventListener("click", async () => {
  $("loginErr").hidden = true;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      try { await signInWithRedirect(auth, provider); return; } catch (e2) { e = e2; }
    }
    const m = friendlyError(e);
    if (m) { $("loginErr").textContent = m; $("loginErr").hidden = false; }
  }
});
$("formLogin").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("loginErr").hidden = true;
  $("btnLogin").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("inEmail").value.trim(), $("inPass").value);
  } catch (e) {
    $("loginErr").textContent = friendlyError(e);
    $("loginErr").hidden = false;
  }
  $("btnLogin").disabled = false;
});
$("btnSignOut").addEventListener("click", () => signOut(auth));
$("btnDeniedOut").addEventListener("click", () => signOut(auth));
$("btnCopyUid").addEventListener("click", () => copy($("deniedUid").textContent));
$("btnRefresh").addEventListener("click", () => loadAll());

function copy(text) {
  const done = () => toast("Copied");
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
}

onAuthStateChanged(auth, async (u) => {
  me = u;
  if (!u) { users.clear(); bans.clear(); show("viewLogin"); return; }
  let isAdmin = false;
  try {
    isAdmin = (await getDoc(doc(db, "admins", u.uid))).exists();
  } catch (e) { isAdmin = false; }
  if (!isAdmin) {
    $("deniedEmail").textContent = u.email || u.phoneNumber || u.uid;
    $("deniedUid").textContent = u.uid;
    show("viewDenied");
    return;
  }
  $("adminEmail").textContent = u.email || "";
  show("viewApp");
  await loadAll();
  route();
});

// ------------------------------------------------------------------ data
async function loadAll() {
  $("dashSub").textContent = "Loading users…"; $("listSub").textContent = "Loading users…";
  try {
    const [us, bs] = await Promise.all([getDocs(collection(db, "users")), getDocs(collection(db, "bans"))]);
    const keep = new Map(users);
    users.clear();
    us.forEach((d) => {
      const old = keep.get(d.id);
      users.set(d.id, { uid: d.id, ...d.data(), account: old ? old.account : null });
    });
    bans.clear();
    bs.forEach((d) => bans.set(d.id, d.data()));
    allContacts = null;
  } catch (e) {
    $("dashSub").textContent = friendlyError(e); $("listSub").textContent = friendlyError(e);
    toast(friendlyError(e), true);
    return;
  }
  render();
  loadAccounts();
}

// e-mail / phone / device live in users/{uid}/private/account; fetched in the background a few at a time
async function loadAccounts() {
  const todo = [...users.values()].filter((u) => !u.account);
  accountFails = 0;
  loadingAccounts = todo.length;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const u = todo[i++];
      try {
        const s = await getDoc(doc(db, "users", u.uid, "private", "account"));
        u.account = s.exists() ? s.data() : {};
      } catch (e) { accountFails++; u.account = {}; }
      loadingAccounts--;
      if (loadingAccounts % 10 === 0 || loadingAccounts === 0) { updateInfo(); if (needle) renderList(); }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  loadingAccounts = 0;
  render();
}

// ------------------------------------------------------------------ screens & routing
const ICONS = {
  dashboard: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  users: "M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z",
  online: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  suspended: "M9 5H6v14h3zm9 0h-3v14h3z",
  banned: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20z",
  download: "M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z",
  refresh: "M17.65 6.35A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z",
  search: "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z",
  logout: "M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  arrow: "M9 6l6 6-6 6",
};
function icon(name, size) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size || 22); s.setAttribute("height", size || 22); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", ICONS[name]);
  if (name === "arrow") { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2.2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
  else p.setAttribute("fill", "currentColor");
  s.append(p);
  return s;
}

const isNew = (u, ms) => { const c = toDate(u.createdAt); return !!c && Date.now() - c.getTime() < ms; };
const SCREENS = {
  dashboard: { title: "Dashboard", icon: "dashboard", menu: true },
  users: { title: "Users", icon: "users", menu: true, pred: () => true, empty: "No users found." },
  online: { title: "Online users", icon: "online", menu: true, pred: (u) => !!u.online, empty: "Nobody is online right now." },
  suspended: { title: "Suspended users", icon: "suspended", menu: true, pred: (u) => statusOf(u.uid) === "suspended", empty: "Nobody is suspended." },
  banned: { title: "Banned users", icon: "banned", menu: true, pred: (u) => statusOf(u.uid) === "banned", empty: "Nobody is banned." },
  new1: { title: "New users · last 24 hours", pred: (u) => isNew(u, DAY), empty: "Nobody joined in the last 24 hours." },
  new7: { title: "New users · last 7 days", pred: (u) => isNew(u, 7 * DAY), empty: "Nobody joined in the last 7 days." },
};
let current = "dashboard";
let cameFromApp = false;
let rangeDays = 14;

function parseHash() {
  const m = /^#\/([a-z0-9]+)(?:\/(.+))?$/.exec(location.hash);
  const screen = m && SCREENS[m[1]] ? m[1] : "dashboard";
  return { screen, uid: m && m[2] ? decodeURIComponent(m[2]) : null };
}
const go = (screen) => { location.hash = "#/" + screen; };
function openUser(uid) { cameFromApp = true; location.hash = "#/" + current + "/" + encodeURIComponent(uid); }
window.addEventListener("hashchange", route);
$("btnBack").addEventListener("click", () => { if (cameFromApp) history.back(); else go(current); });
function closeDetail() { $("detail").hidden = true; document.body.style.overflow = ""; }

function route() {
  if ($("viewApp").hidden) { closeDetail(); return; }
  const { screen, uid } = parseHash();
  if (screen !== current || $("navItems").childElementCount === 0) {
    current = screen;
    needle = ""; $("search").value = ""; shown = PAGE;
    window.scrollTo(0, 0);
  }
  closeMenu();
  $("scrDash").hidden = screen !== "dashboard";
  $("scrList").hidden = screen === "dashboard";
  render();
  if (uid) openDetail(uid); else closeDetail();
}

// ------------------------------------------------------------------ menu (hamburger drawer)
function openMenu() { $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); $("scrim").hidden = false; $("btnMenu").setAttribute("aria-expanded", "true"); }
function closeMenu() { $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); $("scrim").hidden = true; $("btnMenu").setAttribute("aria-expanded", "false"); }
$("btnMenu").addEventListener("click", () => ($("drawer").classList.contains("open") ? closeMenu() : openMenu()));
$("scrim").addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

function counts() {
  const c = { users: users.size, online: 0, suspended: 0, banned: 0 };
  for (const u of users.values()) {
    if (u.online) c.online++;
    const st = statusOf(u.uid);
    if (st === "suspended") c.suspended++;
    if (st === "banned") c.banned++;
  }
  return c;
}
function menu() {
  const c = counts();
  const items = Object.entries(SCREENS).filter(([, d]) => d.menu).map(([k, d]) => {
    const a = h("a", { class: "ad-nav" + (k === current || (!SCREENS[current].menu && k === "users") ? " on" : ""), href: "#/" + k }, icon(d.icon), h("span", null, d.title), c[k] != null ? h("span", { class: "n" }, c[k]) : null);
    return a;
  });
  $("navItems").replaceChildren(...items);
  $("btnCsv").replaceChildren(icon("download"), h("span", null, "Export all users (CSV)"));
  $("btnSignOut").replaceChildren(icon("logout"), h("span", null, "Sign out"));
}

// ------------------------------------------------------------------ dashboard
function stats() {
  const c = counts();
  const mk = (n, label, to, ic, cls) => h("button", { class: "ad-stat " + (cls || ""), type: "button", onclick: () => go(to), "aria-label": label + ": " + n },
    icon(ic, 20), h("b", null, n), h("span", null, label));
  let d1 = 0, d7 = 0;
  for (const u of users.values()) { if (isNew(u, DAY)) d1++; if (isNew(u, 7 * DAY)) d7++; }
  $("stats").replaceChildren(
    mk(c.users, "Total users", "users", "users"),
    mk(c.online, "Online now", "online", "online", "good"),
    mk(d1, "New in 24 hours", "new1", "plus"),
    mk(d7, "New in 7 days", "new7", "plus"),
    mk(c.suspended, "Suspended", "suspended", "suspended", c.suspended ? "hot" : ""),
    mk(c.banned, "Banned", "banned", "banned", c.banned ? "hot" : ""));
  $("dashSub").textContent = users.size ? "Tap any card to open that list." : "";
}
const RANGES = [7, 14, 30, 90];
function rangeChips() {
  $("range").replaceChildren(...RANGES.map((d) => h("button", { class: "ad-chip", role: "tab", "aria-selected": String(rangeDays === d), onclick: () => { rangeDays = d; rangeChips(); charts(); } }, d + " days")));
}
function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function series(days) {
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); out.push({ d, key: dayKey(d), n: 0, total: 0 }); }
  const first = out[0].key;
  let before = 0;
  const idx = new Map(out.map((o, i) => [o.key, i]));
  for (const u of users.values()) {
    const c = toDate(u.createdAt);
    if (!c) { before++; continue; }
    const k = dayKey(c);
    if (k < first) before++; else if (idx.has(k)) out[idx.get(k)].n++;
  }
  let run = before;
  for (const o of out) { run += o.n; o.total = run; }
  return out;
}
const dayLabel = (d) => d.toLocaleDateString([], { day: "numeric", month: "short" });
const NS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const tip = $("tip");
function showTip(ev, valueText, label) {
  tip.replaceChildren(h("b", null, valueText), h("span", null, label));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y < 8) y = ev.clientY + 16;
  tip.style.left = Math.max(8, x) + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.hidden = true; };

function frame(el, data, valueKey, kind) {
  const W = Math.max(280, Math.round(el.clientWidth || 340));
  const H = 200, L = 36, R = 10, T = 14, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(1, ...data.map((p) => p[valueKey])));
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": kind });
  const y = (v) => T + ih - (v / max) * ih;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg.append(sv("line", { class: "grid", x1: L, x2: W - R, y1: yy, y2: yy }));
    const t = sv("text", { class: "axis", x: L - 6, y: yy + 4, "text-anchor": "end" }); t.textContent = Number.isInteger(v) ? v : v.toFixed(1);
    svg.append(t);
  }
  const n = data.length;
  const ticks = n <= 8 ? data.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1];
  for (const i of [...new Set(ticks)]) {
    const x = L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const t = sv("text", { class: "axis", x: Math.min(W - R - 14, Math.max(L + 14, x)), y: H - 6, "text-anchor": "middle" }); t.textContent = dayLabel(data[i].d);
    svg.append(t);
  }
  return { svg, W, H, L, R, T, B, iw, ih, y, n };
}

function barChart(el, data) {
  const f = frame(el, data, "n", "New users per day");
  const band = f.iw / f.n;
  const gap = band > 6 ? 2 : 0;
  const bw = Math.max(1.5, Math.min(24, band - gap));
  data.forEach((p, i) => {
    const cx = f.L + band * i + band / 2;
    const top = f.y(p.n), base = f.T + f.ih;
    if (p.n > 0) {
      const r = Math.min(4, bw / 2, base - top);
      const d = `M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z`;
      f.svg.append(sv("path", { class: "bar", d }));
    }
    const hit = sv("rect", { class: "hit", x: f.L + band * i, y: f.T, width: band, height: f.ih + f.B - 6, tabindex: "0", "aria-label": dayLabel(p.d) + ": " + p.n + " new users" });
    hit.addEventListener("pointermove", (ev) => showTip(ev, p.n + (p.n === 1 ? " new user" : " new users"), dayLabel(p.d)));
    hit.addEventListener("pointerleave", hideTip);
    hit.addEventListener("focus", () => { const r = hit.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.top + 30 }, p.n + " new", dayLabel(p.d)); });
    hit.addEventListener("blur", hideTip);
    f.svg.append(hit);
  });
  el.replaceChildren(f.svg);
}

function lineChart(el, data) {
  const f = frame(el, data, "total", "Total users");
  const x = (i) => f.L + (f.n === 1 ? f.iw / 2 : (i / (f.n - 1)) * f.iw);
  const pts = data.map((p, i) => [x(i), f.y(p.total)]);
  const line = pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join("");
  f.svg.append(sv("path", { class: "ar", d: line + `L${pts[pts.length - 1][0]},${f.T + f.ih}L${pts[0][0]},${f.T + f.ih}Z` }));
  f.svg.append(sv("path", { class: "ln", d: line }));
  const last = pts[pts.length - 1];
  f.svg.append(sv("circle", { class: "dot", cx: last[0], cy: last[1], r: 5 }));
  const lab = sv("text", { class: "endlab", x: Math.min(f.W - f.R, last[0]), y: Math.max(12, last[1] - 11), "text-anchor": "end" }); lab.textContent = data[data.length - 1].total;
  f.svg.append(lab);
  const cross = sv("line", { class: "cross", x1: 0, x2: 0, y1: f.T, y2: f.T + f.ih, visibility: "hidden" });
  const hot = sv("circle", { class: "dot", r: 5, visibility: "hidden" });
  const hit = sv("rect", { class: "hit", x: f.L, y: f.T, width: f.iw, height: f.ih + f.B - 6 });
  const at = (ev) => {
    const r = hit.getBoundingClientRect();
    const rel = (ev.clientX - r.left) / r.width;
    const i = Math.max(0, Math.min(f.n - 1, Math.round(rel * (f.n - 1))));
    cross.setAttribute("x1", pts[i][0]); cross.setAttribute("x2", pts[i][0]); cross.setAttribute("visibility", "visible");
    hot.setAttribute("cx", pts[i][0]); hot.setAttribute("cy", pts[i][1]); hot.setAttribute("visibility", "visible");
    showTip(ev, data[i].total + (data[i].total === 1 ? " user" : " users"), dayLabel(data[i].d));
  };
  hit.addEventListener("pointermove", at);
  hit.addEventListener("pointerdown", at);
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hot.setAttribute("visibility", "hidden"); hideTip(); });
  f.svg.append(cross, hot, hit);
  el.replaceChildren(f.svg);
}

function tableView(host, data, col, valueKey) {
  const rows = data.slice().reverse().map((p) => h("tr", null, h("td", null, dayLabel(p.d)), h("td", null, p[valueKey])));
  host.replaceChildren(h("details", { class: "ad-det" }, h("summary", null, "View as table"),
    h("div", { class: "scroll" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Day"), h("th", null, col))), h("tbody", null, rows)))));
}

function statusChart() {
  const c = counts();
  const active = Math.max(0, c.users - c.suspended - c.banned);
  const parts = [["Active", active, "var(--st-good)", "✓"], ["Suspended", c.suspended, "var(--st-warn)", "⏸"], ["Banned", c.banned, "var(--st-crit)", "⊘"]];
  const total = Math.max(1, c.users);
  const bar = h("div", { class: "ad-seg", role: "img", "aria-label": parts.map((p) => p[0] + " " + p[1]).join(", ") },
    parts.filter((p) => p[1] > 0).map((p) => h("span", { style: "flex:" + p[1] + ";background:" + p[2], title: p[0] + ": " + p[1] })));
  const legend = h("div", { class: "ad-legend" }, parts.map((p) => h("div", null,
    h("i", { style: "background:" + p[2] }), h("span", null, p[3] + " " + p[0]), h("em", null, Math.round((p[1] / total) * 100) + "%"), h("b", null, p[1]))));
  $("chartStatus").replaceChildren(bar, legend);
}

function charts() {
  const data = series(rangeDays);
  const sum = data.reduce((a, p) => a + p.n, 0);
  $("subNew").textContent = sum + " joined in the last " + rangeDays + " days";
  const growth = data[data.length - 1].total - data[0].total + data[0].n;
  $("subTotal").textContent = (growth >= 0 ? "+" : "") + growth + " in the last " + rangeDays + " days";
  if (!$("scrDash").hidden) {
    barChart($("chartNew"), data);
    lineChart($("chartTotal"), data);
    tableView($("tblNew"), data, "New users", "n");
    tableView($("tblTotal"), data, "Total users", "total");
  }
  statusChart();
}
let rz;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!$("scrDash").hidden && users.size) charts(); }, 150); });
new MutationObserver(() => { if (!$("scrDash").hidden && users.size) charts(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function newest() {
  const rows = [...users.values()].filter((u) => toDate(u.createdAt)).sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt)).slice(0, 5);
  $("newest").replaceChildren(...rows.map((u) => userRow(u, "Joined " + ago(toDate(u.createdAt)))));
  if (!rows.length) $("newest").replaceChildren(h("p", { class: "ad-muted" }, "No users yet."));
}
$("btnAllNew").addEventListener("click", () => go("new7"));

// ------------------------------------------------------------------ user lists
function matches(u) {
  const d = SCREENS[current];
  if (!d.pred || !d.pred(u)) return false;
  if (!needle) return true;
  const a = u.account || {};
  const hay = [u.name, u.username, u.uid, a.email, a.phone, u.bio].filter(Boolean).join(" ").toLowerCase();
  return needle.split(/\s+/).every((p) => hay.includes(p));
}
function sorted() {
  const arr = [...users.values()].filter(matches);
  if (current === "online") return arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (current === "suspended") return arr.sort((a, b) => (banInfo(a.uid).until - banInfo(b.uid).until));
  return arr.sort((a, b) => { const x = toDate(a.createdAt), y = toDate(b.createdAt); return (y ? y.getTime() : 0) - (x ? x.getTime() : 0); });
}

function avatar(u, big) {
  const box = h("div", { class: "ad-av" + (big ? " lg" : "") });
  if (u && u.photoUrl) {
    const img = h("img", { src: u.photoUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => { img.remove(); box.textContent = initial(u); });
    box.append(img);
  } else box.textContent = initial(u);
  return box;
}
const initial = (u) => (nameOf(u).trim()[0] || "?").toUpperCase();
function badge(uid) {
  const st = statusOf(uid);
  return st === "ok" ? null : h("span", { class: "ad-badge " + st }, st === "banned" ? "Banned" : "Suspended");
}
function userRow(u, extra) {
  const a = u.account || {};
  const b = banInfo(u.uid);
  let small;
  if (extra) small = extra;
  else if (b && b.active) small = b.status === "suspended" ? "Until " + fmt(b.until) : "Since " + ago(b.at);
  else small = u.online ? null : "Seen " + ago(toDate(u.lastSeen));
  return h("button", { class: "ad-row", type: "button", onclick: () => openUser(u.uid) },
    avatar(u),
    h("div", { class: "ad-who" },
      h("b", null, nameOf(u)),
      h("span", null, (u.username ? "@" + u.username : "") + (a.email ? " · " + a.email : a.phone ? " · " + a.phone : ""))),
    h("div", { class: "ad-side" },
      badge(u.uid),
      u.online && !extra ? h("small", null, h("i", { class: "ad-dot" }), "Online") : (small ? h("small", null, small) : null)));
}

function renderList() {
  if ($("scrList").hidden) return;
  const d = SCREENS[current];
  $("listTitle").textContent = d.title;
  const rows = sorted();
  $("list").replaceChildren(...rows.slice(0, shown).map((u) => userRow(u)));
  $("empty").textContent = needle ? "No user matches your search." : d.empty;
  $("empty").hidden = rows.length > 0 || users.size === 0;
  $("btnMore").hidden = rows.length <= shown;
  $("btnMore").textContent = "Show more (" + (rows.length - shown) + " left)";
  updateInfo(rows.length);
}
function updateInfo(n) {
  const parts = [];
  if (!$("scrList").hidden) parts.push((n == null ? sorted().length : n) + (needle ? " found" : " users"));
  if (loadingAccounts > 0) parts.push("loading e-mail / phone details… " + loadingAccounts + " left");
  else if (accountFails > 0) parts.push("e-mail / phone could not be read for " + accountFails + " users (publish the latest rules; the user's app writes them on its next start)");
  $("listSub").textContent = parts.join(" · ");
}
function render() {
  menu();
  if (current === "dashboard") { stats(); rangeChips(); newest(); charts(); }
  else renderList();
}

$("search").addEventListener("input", (e) => { needle = e.target.value.trim().toLowerCase(); shown = PAGE; renderList(); });
$("btnMore").addEventListener("click", () => { shown += PAGE; renderList(); });
$("btnCsv").addEventListener("click", () => { closeMenu(); exportCsv([...users.values()]); });

function exportCsv(list) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ["name", "username", "uid", "email", "phone", "provider", "joined", "last seen", "online", "status", "device", "app version"];
  const lines = [head.map(cell).join(",")];
  for (const u of list) {
    const a = u.account || {};
    const b = banInfo(u.uid);
    lines.push([nameOf(u), u.username, u.uid, a.email, a.phone, a.provider, toDate(u.createdAt)?.toISOString(), toDate(u.lastSeen)?.toISOString(),
      u.online ? "yes" : "no", b && b.active ? b.status : "ok", a.device, a.appVersion].map(cell).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = h("a", { href: URL.createObjectURL(blob), download: "zishuchat-users.csv" });
  document.body.append(link); link.click(); link.remove();
}

// ------------------------------------------------------------------ detail view
let tab = "overview";
async function openDetail(uid) {
  tab = "overview";
  $("detail").hidden = false;
  document.body.style.overflow = "hidden";
  $("detail").scrollTop = 0;
  let u = users.get(uid);
  if (!u) { // a deleted account that is still somebody's contact: show what is known
    u = { uid, name: "Deleted account", deleted: true };
  }
  if (!u.account && !u.deleted) {
    try { const s = await getDoc(doc(db, "users", uid, "private", "account")); u.account = s.exists() ? s.data() : {}; } catch (e) { u.account = {}; }
  }
  drawDetail(u);
}

function kv(label, value, extra) {
  const dd = h("dd", null, value == null || value === "" ? "—" : value);
  if (extra) dd.append(" ", extra);
  return h("div", { class: "ad-kv" }, h("dt", null, label), dd);
}
function copyBtn(text) {
  return h("button", { class: "ad-btn ad-btn-line ad-sm", type: "button", onclick: () => copy(text) }, "Copy");
}

function drawDetail(u) {
  $("detailTitle").textContent = nameOf(u);
  const body = $("detailBody");
  const b = banInfo(u.uid);
  const hero = h("div", { class: "ad-card ad-hero" },
    avatar(u, true),
    h("div", { class: "ad-who" },
      h("h2", null, nameOf(u)),
      h("p", null, (u.username ? "@" + u.username : "") + (u.online ? " · Online now" : u.lastSeen ? " · Seen " + ago(toDate(u.lastSeen)) : "")),
      h("p", null, badge(u.uid))));
  const tabs = h("div", { class: "ad-tabs", role: "tablist" });
  const panel = h("div", { class: "ad-card ad-panel" });
  const defs = [["overview", "Overview"], ["contacts", "Contacts"], ["groups", "Chats & groups"], ["moderation", "Suspend / ban"]];
  if (u.deleted) defs.length = 1;
  function select(k) {
    tab = k;
    [...tabs.children].forEach((t, i) => t.setAttribute("aria-selected", String(defs[i][0] === k)));
    panel.replaceChildren(h("p", { class: "ad-muted", style: "padding:14px 0" }, "Loading…"));
    ({ overview: tabOverview, contacts: tabContacts, groups: tabGroups, moderation: tabModeration })[k](u, panel);
  }
  defs.forEach(([k, label]) => tabs.append(h("button", { class: "ad-tab", role: "tab", "aria-selected": String(k === tab), onclick: () => select(k) }, label)));
  body.replaceChildren(...[hero, b && b.active ? banBox(b) : null, tabs, panel].filter(Boolean));
  select(tab);
}

function banBox(b) {
  return h("div", { class: "ad-banbox " + b.status },
    h("b", null, b.status === "banned" ? "This account is banned" : "This account is suspended until " + fmt(b.until)),
    b.reason ? h("div", null, "Reason: " + b.reason) : null,
    h("div", { class: "ad-muted ad-small" }, "Set " + (b.at ? fmt(b.at) : "") + (b.by ? " by " + b.by : "")));
}

function tabOverview(u, panel) {
  const a = u.account || {};
  const dl = h("dl", { style: "margin:0" },
    kv("User ID", h("code", null, u.uid), copyBtn(u.uid)),
    kv("Name", u.name), kv("Username", u.username ? "@" + u.username : ""),
    kv("Bio", u.bio),
    kv("E-mail", a.email, a.email ? h("small", { class: "ad-muted" }, a.emailVerified ? "(verified)" : "(not verified)") : null),
    kv("Phone", a.phone),
    kv("Sign-in method", a.provider),
    kv("Joined", fmt(toDate(u.createdAt))),
    kv("Last seen", u.hideLastSeen ? "Hidden by the user" : (u.online ? "Online now" : fmt(toDate(u.lastSeen)))),
    kv("Last app start", fmt(toDate(a.lastLogin))),
    kv("Phone model", a.device), kv("Android", a.android), kv("App version", a.appVersion), kv("App language", a.language),
    kv("Photo", u.photoUrl ? h("a", { href: u.photoUrl, target: "_blank", rel: "noopener noreferrer" }, "Open photo") : ""));
  panel.replaceChildren(dl);
  if (!a.email && !a.phone && !u.deleted) {
    panel.append(h("p", { class: "ad-note", style: "margin:12px 0" }, "E-mail and phone appear here after this user opens the updated app once (and the latest Firestore rules are published)."));
  }
}

async function nameFor(id) {
  let u = users.get(id);
  if (!u) {
    try { const s = await getDoc(doc(db, "users", id)); if (s.exists()) { u = { uid: id, ...s.data() }; } } catch (e) { /* ignore */ }
  }
  return u || { uid: id, name: "Deleted account", deleted: true };
}
function personRow(u, sub) {
  return h("button", { class: "ad-row", type: "button", onclick: () => openUser(u.uid) },
    avatar(u),
    h("div", { class: "ad-who" }, h("b", null, nameOf(u)), h("span", null, (u.username ? "@" + u.username : "") + (sub ? (u.username ? " · " : "") + sub : ""))),
    h("div", { class: "ad-side" }, badge(u.uid)));
}

async function tabContacts(u, panel) {
  try {
    const [cs, bl] = await Promise.all([getDocs(collection(db, "users", u.uid, "contacts")), getDocs(collection(db, "users", u.uid, "blocked"))]);
    const contacts = await Promise.all(cs.docs.map(async (d) => ({ p: await nameFor(d.id), at: toDate(d.data().addedAt) })));
    const blocked = await Promise.all(bl.docs.map(async (d) => ({ p: await nameFor(d.id), at: toDate(d.data().at || d.data().addedAt) })));
    contacts.sort((x, y) => nameOf(x.p).localeCompare(nameOf(y.p)));
    const savedBox = h("div", null);
    const savedBtn = h("button", { class: "ad-btn ad-btn-line ad-sm", type: "button", onclick: async () => {
      savedBtn.disabled = true; savedBtn.textContent = "Loading…";
      try {
        if (!allContacts) {
          const snap = await getDocs(collectionGroup(db, "contacts"));
          allContacts = snap.docs.map((d) => ({ owner: d.ref.parent.parent.id, id: d.id }));
        }
        const owners = allContacts.filter((c) => c.id === u.uid).map((c) => c.owner);
        const rows = await Promise.all(owners.map((o) => nameFor(o)));
        rows.sort((x, y) => nameOf(x).localeCompare(nameOf(y)));
        savedBox.replaceChildren(rows.length ? h("div", { class: "ad-list" }, rows.map((p) => personRow(p))) : h("p", { class: "ad-muted" }, "Nobody has saved this user yet."));
        savedBtn.remove();
      } catch (e) { savedBtn.disabled = false; savedBtn.textContent = "Try again"; toast(friendlyError(e), true); }
    } }, "Show who saved this user");
    panel.replaceChildren(
      h("div", { class: "ad-h3" }, "Saved contacts (" + contacts.length + ")"),
      contacts.length ? h("div", { class: "ad-list" }, contacts.map((c) => personRow(c.p, c.at ? "added " + ago(c.at) : ""))) : h("p", { class: "ad-muted" }, "No saved contacts."),
      h("div", { class: "ad-h3" }, "Saved by (people who have this user in their contacts)"),
      savedBox, savedBtn,
      h("div", { class: "ad-h3" }, "Blocked by this user (" + blocked.length + ")"),
      blocked.length ? h("div", { class: "ad-list" }, blocked.map((c) => personRow(c.p))) : h("p", { class: "ad-muted" }, "Nobody blocked."));
  } catch (e) {
    panel.replaceChildren(h("p", { class: "ad-err" }, friendlyError(e)));
  }
}

async function tabGroups(u, panel) {
  try {
    const snap = await getDocs(query(collection(db, "chats"), where("members", "array-contains", u.uid)));
    const groups = [], directs = [];
    snap.forEach((d) => { const c = d.data(); (c.type === "group" ? groups : directs).push({ id: d.id, ...c }); });
    groups.sort((x, y) => (toDate(y.lastTs)?.getTime() || 0) - (toDate(x.lastTs)?.getTime() || 0));
    const people = await Promise.all(directs.map(async (c) => ({ p: await nameFor((c.members || []).find((m) => m !== u.uid) || ""), at: toDate(c.lastTs) })));
    people.sort((x, y) => (y.at?.getTime() || 0) - (x.at?.getTime() || 0));
    panel.replaceChildren(
      h("p", { class: "ad-note", style: "margin:12px 0" }, "Only names and counts are shown here. Message contents are not displayed in this panel."),
      h("div", { class: "ad-h3" }, "Groups (" + groups.length + ")"),
      groups.length ? h("div", { class: "ad-list" }, groups.map((g) => h("div", { class: "ad-row", style: "cursor:default" },
        h("div", { class: "ad-av" }, ((g.name || "G")[0] || "G").toUpperCase()),
        h("div", { class: "ad-who" }, h("b", null, g.name || "Group"), h("span", null, (g.members || []).length + " members" + ((g.admins || []).includes(u.uid) ? " · group admin" : ""))),
        h("div", { class: "ad-side" }, h("small", null, g.lastTs ? "Active " + ago(toDate(g.lastTs)) : ""))))) : h("p", { class: "ad-muted" }, "Not in any group."),
      h("div", { class: "ad-h3" }, "One-to-one chats (" + people.length + ")"),
      people.length ? h("div", { class: "ad-list" }, people.map((c) => personRow(c.p, c.at ? "active " + ago(c.at) : ""))) : h("p", { class: "ad-muted" }, "No chats."));
  } catch (e) {
    panel.replaceChildren(h("p", { class: "ad-err" }, friendlyError(e)));
  }
}

const DURATIONS = [["1h", "1 hour", 3600e3], ["1d", "24 hours", DAY], ["3d", "3 days", 3 * DAY], ["7d", "7 days", 7 * DAY], ["30d", "30 days", 30 * DAY], ["custom", "Until a date I choose…", 0]];
function tabModeration(u, panel) {
  const b = banInfo(u.uid);
  const self = me && u.uid === me.uid;
  panel.replaceChildren();
  if (self) { panel.append(h("p", { class: "ad-note", style: "margin:12px 0" }, "This is your own account. It cannot be suspended or banned from the panel.")); return; }
  if (b) {
    panel.append(h("div", { class: "ad-banbox " + (b.active ? b.status : "") },
      h("b", null, b.active ? (b.status === "banned" ? "Currently banned" : "Currently suspended until " + fmt(b.until)) : "Earlier suspension (ended " + fmt(b.until) + ")"),
      b.reason ? h("div", null, "Reason: " + b.reason) : null,
      h("div", { class: "ad-muted ad-small" }, "Set " + (b.at ? fmt(b.at) : "") + (b.by ? " by " + b.by : ""))));
  } else panel.append(h("p", { class: "ad-note", style: "margin:12px 0" }, "This account is in good standing."));

  const reason = h("textarea", { placeholder: "Reason (the user sees it on the suspended screen)", maxlength: "300" });
  const sel = h("select", null, DURATIONS.map(([k, label]) => h("option", { value: k }, label)));
  sel.value = "1d";
  const when = h("input", { type: "datetime-local" });
  when.hidden = true;
  sel.addEventListener("change", () => { when.hidden = sel.value !== "custom"; });
  const busy = (btns, on) => btns.forEach((x) => { x.disabled = on; });

  const bSus = h("button", { class: "ad-btn ad-btn-warn", type: "button" }, "Suspend");
  const bBan = h("button", { class: "ad-btn ad-btn-danger", type: "button" }, "Ban permanently");
  const bRes = h("button", { class: "ad-btn ad-btn-brand", type: "button" }, "Restore access");
  const all = [bSus, bBan, bRes];

  async function write(status, until) {
    if (!confirm((status === "banned" ? "Ban " : "Suspend ") + nameOf(u) + (until ? " until " + fmt(until) : " permanently") + "?")) return;
    busy(all, true);
    try {
      const data = { status, reason: reason.value.trim(), by: me.uid, byEmail: me.email || "", at: serverTimestamp() };
      if (until) data.until = Timestamp.fromDate(until);
      await setDoc(doc(db, "bans", u.uid), data);
      bans.set(u.uid, { ...data, at: new Date() });
      toast(status === "banned" ? "Account banned" : "Account suspended");
      render(); drawDetail(u);
    } catch (e) { toast(friendlyError(e), true); busy(all, false); }
  }
  bSus.addEventListener("click", () => {
    let until;
    if (sel.value === "custom") {
      until = when.value ? new Date(when.value) : null;
      if (!until || until.getTime() < Date.now() + 60e3) { toast("Pick a date and time in the future", true); return; }
    } else until = new Date(Date.now() + DURATIONS.find((d) => d[0] === sel.value)[2]);
    write("suspended", until);
  });
  bBan.addEventListener("click", () => write("banned", null));
  bRes.addEventListener("click", async () => {
    if (!confirm("Restore access for " + nameOf(u) + "?")) return;
    busy(all, true);
    try {
      await deleteDoc(doc(db, "bans", u.uid));
      bans.delete(u.uid);
      toast("Access restored");
      render(); drawDetail(u);
    } catch (e) { toast(friendlyError(e), true); busy(all, false); }
  });

  bRes.hidden = !b;
  panel.append(h("div", { class: "ad-h3" }, b ? "Change status" : "Suspend or ban"),
    h("div", { class: "ad-form" },
      reason,
      h("div", null, h("label", { class: "ad-label" }, "Suspend for"), sel, when),
      h("div", { class: "ad-actions" }, bSus, bBan, bRes),
      h("p", { class: "ad-note" }, "A suspended or banned user sees an “Account suspended” screen instead of the app, and the server stops accepting their messages and calls. " +
        "Their chats and profile stay as they are. Restore access removes the restriction at once.")));
}
