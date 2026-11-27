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
let filter = "all";
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
  openFromHash();
});

// ------------------------------------------------------------------ data
async function loadAll() {
  $("loadInfo").textContent = "Loading users…";
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
    $("loadInfo").textContent = friendlyError(e);
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

// ------------------------------------------------------------------ list view
function stats() {
  const all = [...users.values()];
  const now = Date.now();
  const mk = (n, label, cls) => h("div", { class: "ad-stat " + (cls || "") }, h("b", null, n), h("span", null, label));
  let online = 0, d1 = 0, d7 = 0, sus = 0, ban = 0;
  for (const u of all) {
    if (u.online) online++;
    const c = toDate(u.createdAt);
    if (c && now - c.getTime() < DAY) d1++;
    if (c && now - c.getTime() < 7 * DAY) d7++;
    const st = statusOf(u.uid);
    if (st === "suspended") sus++;
    if (st === "banned") ban++;
  }
  $("stats").replaceChildren(
    mk(all.length, "Total users"), mk(online, "Online now", "good"), mk(d1, "New in 24 h"), mk(d7, "New in 7 days"),
    mk(sus, "Suspended", sus ? "hot" : ""), mk(ban, "Banned", ban ? "hot" : ""));
}

const CHIPS = [["all", "All"], ["online", "Online"], ["new", "New (7 days)"], ["suspended", "Suspended"], ["banned", "Banned"]];
function chips() {
  $("chips").replaceChildren(...CHIPS.map(([k, label]) =>
    h("button", { class: "ad-chip", role: "tab", "aria-selected": String(filter === k), onclick: () => { filter = k; shown = PAGE; chips(); renderList(); } }, label)));
}

function matches(u) {
  const now = Date.now();
  const st = statusOf(u.uid);
  if (filter === "online" && !u.online) return false;
  if (filter === "new") { const c = toDate(u.createdAt); if (!c || now - c.getTime() > 7 * DAY) return false; }
  if (filter === "suspended" && st !== "suspended") return false;
  if (filter === "banned" && st !== "banned") return false;
  if (!needle) return true;
  const a = u.account || {};
  const hay = [u.name, u.username, u.uid, a.email, a.phone, u.bio].filter(Boolean).join(" ").toLowerCase();
  return needle.split(/\s+/).every((p) => hay.includes(p));
}
function sorted() {
  return [...users.values()].filter(matches).sort((a, b) => {
    const x = toDate(a.createdAt), y = toDate(b.createdAt);
    return (y ? y.getTime() : 0) - (x ? x.getTime() : 0);
  });
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

function renderList() {
  const rows = sorted();
  const part = rows.slice(0, shown);
  $("list").replaceChildren(...part.map((u) => {
    const a = u.account || {};
    return h("button", { class: "ad-row", type: "button", onclick: () => { location.hash = "u=" + u.uid; } },
      avatar(u),
      h("div", { class: "ad-who" },
        h("b", null, nameOf(u)),
        h("span", null, (u.username ? "@" + u.username : "") + (a.email ? " · " + a.email : a.phone ? " · " + a.phone : ""))),
      h("div", { class: "ad-side" },
        badge(u.uid),
        h("small", null, u.online ? h("span", null, h("i", { class: "ad-dot" }), "Online") : "Seen " + ago(toDate(u.lastSeen)))));
  }));
  $("empty").hidden = rows.length > 0 || users.size === 0;
  $("btnMore").hidden = rows.length <= shown;
  $("btnMore").textContent = "Show more (" + (rows.length - shown) + " left)";
  updateInfo(rows.length);
}
function updateInfo(n) {
  const parts = [];
  parts.push((n == null ? sorted().length : n) + " of " + users.size + " users");
  if (loadingAccounts > 0) parts.push("loading e-mail / phone details… " + loadingAccounts + " left");
  else if (accountFails > 0) parts.push("e-mail / phone could not be read for " + accountFails + " users (publish the latest rules; the user's app writes them on its next start)");
  $("loadInfo").textContent = parts.join(" · ");
}
function render() { stats(); chips(); renderList(); }

$("search").addEventListener("input", (e) => { needle = e.target.value.trim().toLowerCase(); shown = PAGE; renderList(); });
$("btnMore").addEventListener("click", () => { shown += PAGE; renderList(); });

$("btnCsv").addEventListener("click", () => {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ["name", "username", "uid", "email", "phone", "provider", "joined", "last seen", "online", "status", "device", "app version"];
  const lines = [head.map(cell).join(",")];
  for (const u of sorted()) {
    const a = u.account || {};
    const b = banInfo(u.uid);
    lines.push([nameOf(u), u.username, u.uid, a.email, a.phone, a.provider, toDate(u.createdAt)?.toISOString(), toDate(u.lastSeen)?.toISOString(),
      u.online ? "yes" : "no", b && b.active ? b.status : "ok", a.device, a.appVersion].map(cell).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = h("a", { href: URL.createObjectURL(blob), download: "zishuchat-users.csv" });
  document.body.append(link); link.click(); link.remove();
});

// ------------------------------------------------------------------ detail view
window.addEventListener("hashchange", openFromHash);
$("btnBack").addEventListener("click", () => { if (location.hash) history.back(); else closeDetail(); });
function closeDetail() { $("detail").hidden = true; document.body.style.overflow = ""; }
function openFromHash() {
  const m = /^#u=(.+)$/.exec(location.hash);
  if (!m || $("viewApp").hidden) { closeDetail(); return; }
  openDetail(decodeURIComponent(m[1]));
}

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
  return h("button", { class: "ad-row", type: "button", onclick: () => { location.hash = "u=" + u.uid; } },
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
