import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp, increment, writeBatch, limit } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ============ تهيئة ============ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = n => Math.round(Number(n) || 0).toLocaleString("en-US");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ym = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const daysLeft = s => Math.ceil((new Date(s + "T00:00:00") - new Date(new Date().toDateString())) / 86400000);
const toDate = t => (t?.toDate ? t.toDate() : t instanceof Date ? t : new Date());
const fmtTime = d => `${ymd(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const userEmail = u => `${u.trim().toLowerCase()}@pharmacy.app`;

let tt;
function toast(m) { const t = $("#toast"); t.textContent = m; t.style.display = "block"; clearTimeout(tt); tt = setTimeout(() => t.style.display = "none", 3200); }
function beep() { try { const a = new AudioContext(), o = a.createOscillator(); o.frequency.value = 1100; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 110); } catch { } }
function modal(html) {
  const bg = document.createElement("div"); bg.className = "modalbg";
  bg.innerHTML = `<div class="modal">${html}</div>`; document.body.append(bg);
  bg.addEventListener("mousedown", e => { if (e.target === bg) bg.remove(); });
  bg.close = () => bg.remove(); return bg;
}

const S = {
  user: null, profile: null, settingUp: false, tab: "pos", refresh: null, unsubs: [],
  settings: { rate: 0, round: 50, warnDays: 60, chequeDays: 7, defaultMarkup: 25, markupMed: 25, markupCos: 25, markupDel: 25, pharmacy: "الصيدلية", adminPhone: "" },
  products: [], cart: (() => { try { return JSON.parse(localStorage.cart || "[]"); } catch { return []; } })(), debts: [], cheques: [], users: [], todaySales: [], monthSales: [], mineToday: [], mineMonth: [], myClosings: [], closings: [], selPh: null, month: ym(new Date()), askedRate: false
};
const isAdmin = () => S.profile?.role === "admin";
const roundTo = v => { const r = Number(S.settings.round) || 1; return Math.round(v / r) * r; };
/* الأقسام الثلاثة */
const CATS = { med: { label: "أدوية", icon: "💊", key: "markupMed" }, cos: { label: "كوزمتك", icon: "💄", key: "markupCos" }, del: { label: "دليفري", icon: "🛵", key: "markupDel" } };
const catOf = p => (p && CATS[p.cat] ? p.cat : "med");
const catMarkup = c => { const v = S.settings[CATS[c].key]; return v === undefined || v === null || v === "" ? Number(S.settings.defaultMarkup ?? 25) : Number(v); };
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
/* الإدخال بالجنيه ويُحفظ مقابله بالدولار بسعر يوم الإدخال؛ سعر البيع = الدولار × سعر اليوم فيتحرك مع تغيّر الدولار */
const p6 = v => Math.round((Number(v) || 0) * 1e6) / 1e6;
const priceSDG = p => (Number(p.priceUSD) > 0 && Number(S.settings.rate) > 0) ? roundTo(Number(p.priceUSD) * Number(S.settings.rate)) : (Number(p.priceSDG) || 0);
const costOf = p => (Number(p.costUSD) > 0 && Number(S.settings.rate) > 0) ? Number(p.costUSD) * Number(S.settings.rate) : (Number(p.costSDG) || 0);
const toUSD = v => (Number(S.settings.rate) > 0 ? (Number(v) || 0) / Number(S.settings.rate) : 0);
const payTxt = s => s.pay === "credit" ? "آجل — " + (s.customer || "") : s.pay === "transfer" ? "تحويل" + (s.ref ? " (" + s.ref + ")" : "") : "نقدي";
const dueTxt = x => x < 0 ? "متأخر " + -x + " يوم" : x === 0 ? "اليوم" : "بعد " + x + " يوم";
function updBadge() { const b = $("#albadge"); if (!b) return; const n = alerts().length; b.textContent = n; b.style.display = n ? "" : "none"; }
function ping() { S.refresh?.(); updBadge(); }

/* ============ دخول ============ */
onAuthStateChanged(auth, async u => {
  if (S.settingUp) return;
  cleanup();
  if (!u) return showLogin();
  await enter(u);
});
function cleanup() { S.unsubs.forEach(f => f()); S.unsubs = []; S.askedRate = false; S.tab = "pos"; S.refresh = null; }
async function enter(u) {
  const ps = await getDoc(doc(db, "users", u.uid)).catch(() => null);
  if (!ps || !ps.exists() || ps.data().disabled) { toast("الحساب غير مفعّل أو غير موجود"); await signOut(auth); return; }
  S.user = u; S.profile = { ...ps.data(), uid: u.uid };
  startListeners(); showApp();
}

function showLogin() {
  $("#root").innerHTML = `<div class="login"><img src="logo.png" alt="Ronza Medical Company" style="display:block;width:230px;max-width:80%;margin:0 auto 10px"><h2>كاشير الصيدلية</h2>
  <div class="card"><label>اسم المستخدم</label><input id="lu" autocomplete="username" autocapitalize="none">
  <label>كلمة المرور</label><input id="lp" type="password" autocomplete="current-password">
  <div style="height:12px"></div><button class="btn big" id="lgo">دخول</button>
  <p style="text-align:center"><a href="#" id="first" style="color:var(--mut);font-size:13px">أول تشغيل؟ إنشاء حساب المدير</a></p></div></div>`;
  const go = async () => {
    try { await signInWithEmailAndPassword(auth, userEmail($("#lu").value), $("#lp").value); }
    catch { toast("اسم المستخدم أو كلمة المرور غير صحيحة"); }
  };
  $("#lgo").onclick = go; $("#lp").onkeydown = e => { if (e.key === "Enter") go(); };
  $("#first").onclick = e => { e.preventDefault(); showSetup(); };
}
function showSetup() {
  $("#root").innerHTML = `<div class="login"><img src="logo.png" alt="Ronza Medical Company" style="display:block;width:200px;max-width:70%;margin:0 auto 10px"><h2>إعداد أول مرة</h2><div class="card">
  <p style="font-size:14px;color:var(--mut)">أنشئ حساب المدير (أنت). يعمل هذا مرة واحدة فقط.</p>
  <label>اسم الصيدلية</label><input id="sn">
  <label>اسمك</label><input id="sa">
  <label>اسم المستخدم (إنجليزي بدون مسافات)</label><input id="su" autocapitalize="none">
  <label>كلمة المرور (6 أحرف فأكثر)</label><input id="sp" type="password">
  <label>رقم واتساب المدير (مع كود الدولة، مثال 249912345678)</label><input id="sw" inputmode="tel">
  <div style="height:12px"></div><button class="btn big" id="sgo">إنشاء</button>
  <p style="text-align:center"><a href="#" id="back" style="font-size:13px">رجوع</a></p></div></div>`;
  $("#back").onclick = e => { e.preventDefault(); showLogin(); };
  $("#sgo").onclick = async () => {
    const un = $("#su").value.trim(), pw = $("#sp").value;
    if (!un || pw.length < 6) return toast("أكمل البيانات (كلمة المرور 6 أحرف على الأقل)");
    S.settingUp = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, userEmail(un), pw);
      await setDoc(doc(db, "users", cred.user.uid), { name: $("#sa").value.trim() || un, username: un, role: "admin", createdAt: serverTimestamp() });
      await setDoc(doc(db, "settings", "main"), { pharmacy: $("#sn").value.trim() || "الصيدلية", adminPhone: $("#sw").value.replace(/\D/g, ""), rate: 0, round: 50, warnDays: 60 });
      S.settingUp = false; await enter(cred.user);
    } catch (e) {
      S.settingUp = false; console.error(e);
      toast("تعذر الإنشاء: " + (e.code === "auth/email-already-in-use" ? "اسم المستخدم مستخدم" : e.code === "permission-denied" || e.code === "permission-denied" ? "تم الإعداد مسبقاً" : e.message));
    }
  };
}

/* ============ مستمعات لحظية ============ */
function startListeners() {
  const on = (q, fn) => S.unsubs.push(onSnapshot(q, fn, e => console.error(e)));
  on(doc(db, "settings", "main"), s => {
    S.settings = { ...S.settings, ...(s.data() || {}) };
    $("#rateBadge") && ($("#rateBadge").textContent = S.settings.rate ? `1$ = ${nf(S.settings.rate)} ج` : "⚠ أدخل سعر الدولار");
    $("#phName") && ($("#phName").textContent = S.settings.pharmacy);
    ping(); maybeAskRate(); flushMail();
  });
  on(query(collection(db, "products"), orderBy("name")), s => { S.products = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); });
  if (!isAdmin()) {
    const uid = S.user.uid, now = new Date();
    const pick = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
    on(query(collection(db, "sales"), where("cashierUid", "==", uid), where("day", "==", ymd(now))), s => { S.mineToday = pick(s); ping(); });
    on(query(collection(db, "sales"), where("cashierUid", "==", uid), where("month", "==", ym(now))), s => { S.mineMonth = pick(s); ping(); });
    on(query(collection(db, "closings"), where("uid", "==", uid), where("day", "==", ymd(now))), s => { S.myClosings = pick(s); ping(); });
  }
  if (isAdmin()) {
    on(collection(db, "debts"), s => { S.debts = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); });
    on(collection(db, "cheques"), s => { S.cheques = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); });
    on(collection(db, "users"), s => { S.users = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); });
    on(query(collection(db, "closings"), orderBy("closedAt", "desc"), limit(60)), s => { S.closings = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); });
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    let seenFirst = false;
    on(query(collection(db, "sales"), where("createdAt", ">=", t0), orderBy("createdAt", "desc")), s => {
      if (seenFirst && !s.metadata.fromCache) s.docChanges().forEach(ch => { const d = ch.doc; if (ch.type === "added" && !d.metadata.hasPendingWrites && Date.now() - toDate(d.data().createdAt).getTime() < 180000) notifySale({ id: d.id, ...d.data() }); });
      if (!s.metadata.fromCache) seenFirst = true;
      S.todaySales = s.docs.map(d => ({ id: d.id, ...d.data() })); ping();
    });
    listenMonth();
    setTimeout(() => autoBackup(), 20000);
    const iv = setInterval(() => autoBackup(), 30 * 60 * 1000); S.unsubs.push(() => clearInterval(iv));
  }
}
let monthUnsub = null;
function listenMonth() {
  monthUnsub?.(); const [y, m] = S.month.split("-").map(Number);
  monthUnsub = onSnapshot(query(collection(db, "sales"), where("createdAt", ">=", new Date(y, m - 1, 1)), where("createdAt", "<", new Date(y, m, 1)), orderBy("createdAt", "desc")),
    s => { S.monthSales = s.docs.map(d => ({ id: d.id, ...d.data() })); ping(); }, e => console.error(e));
  S.unsubs.push(() => monthUnsub?.());
}
function maybeAskRate() {
  if (S.askedRate || !isAdmin() || !S.user) return;
  const today = ymd(new Date());
  if (S.settings.rateDay === today && S.settings.rate) { S.askedRate = true; return; }
  S.askedRate = true; rateModal(true);
}

/* ============ إشعار مبيعات لحظي ============ */
function notifySale(s) {
  if (localStorage.notif !== "1") return;
  const txt = `${s.cashier}: ${nf(s.total)} ج • ${s.items.length} صنف${s.pay === "credit" ? " (آجل)" : s.pay === "transfer" ? " (تحويل)" : ""}`;
  toast("🔔 فاتورة جديدة — " + txt); beep(); try { navigator.vibrate?.(200); } catch { }
  if ("Notification" in window && Notification.permission === "granted") {
    const opt = { body: `فاتورة ${s.no}\n${txt}`, icon: "icon-192.png", tag: s.no, dir: "rtl", lang: "ar" };
    navigator.serviceWorker?.getRegistration().then(r => r ? r.showNotification("🧾 " + S.settings.pharmacy, opt) : new Notification("🧾 " + S.settings.pharmacy, opt)).catch(() => { });
  }
}

/* ============ إيميل تلقائي لكل فاتورة (Google Apps Script) ============ */
const mailQ = () => { try { return JSON.parse(localStorage.mailq || "[]"); } catch { return []; } };
const mailPost = (hook, key, subject, html, attach) => fetch(hook, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key, subject, html, attach }) });
let mailBusy = false;
async function flushMail() {
  if (mailBusy || !S.settings.emailHook) return; mailBusy = true;
  try {
    const q = mailQ();
    while (q.length) { await mailPost(S.settings.emailHook, S.settings.emailKey || "", q[0].subject, q[0].html, q[0].attach); q.shift(); localStorage.mailq = JSON.stringify(q); }
  } catch { } finally { mailBusy = false; }
}
function emailSale(s) {
  if (!S.settings.emailHook) return;
  const d = toDate(s.at || s.createdAt);
  const rows = s.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${nf(i.price)}</td><td>${nf(i.price * i.qty)}</td></tr>`).join("");
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial;max-width:520px"><h3>🧾 فاتورة ${esc(s.no)} — ${esc(S.settings.pharmacy)}</h3><p>${fmtTime(d)} • الصيدلي: ${esc(s.cashier)}</p><table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr>${rows}</table><p>${s.discount ? "الخصم: " + nf(s.discount) + " ج<br>" : ""}<b>الإجمالي: ${nf(s.total)} ج</b> (${(s.total / s.rate).toFixed(2)}$)<br>سعر الدولار: ${nf(s.rate)}<br>الدفع: ${esc(payTxt(s))}<br>📈 الربح: ${nf(s.profit)} ج</p></div>`;
  localStorage.mailq = JSON.stringify([...mailQ(), { subject: `🧾 فاتورة ${s.no} — ${nf(s.total)} ج`, html }]);
  flushMail();
}
window.addEventListener("online", flushMail);
function queueMail(subject, html) {
  if (!S.settings.emailHook) return false;
  localStorage.mailq = JSON.stringify([...mailQ(), { subject, html }]);
  flushMail(); return true;
}

/* ============ نسخ احتياطي ============ */
const backupData = () => ({
  app: "pharmacy-backup", at: new Date().toISOString(), pharmacy: S.settings.pharmacy, rate: S.settings.rate,
  products: S.products, debts: S.debts, cheques: S.cheques,
  users: S.users.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role, disabled: !!u.disabled })),
  month: S.month, salesMonth: S.monthSales, closings: S.closings
});
function downloadBackup() {
  const blob = new Blob([JSON.stringify(backupData())], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup-${ymd(new Date())}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function autoBackup(force) {
  if (!isAdmin() || !S.settings.emailHook) return false;
  if (!force) { if (Date.now() - Number(localStorage.lastBackup || 0) < 22 * 3600e3) return false; if (!S.products.length && !S.monthSales.length) return false; }
  try {
    await mailPost(S.settings.emailHook, S.settings.emailKey || "", `💾 نسخة احتياطية — ${S.settings.pharmacy} — ${ymd(new Date())}`,
      `<div dir="rtl" style="font-family:Tahoma,Arial"><h3>💾 نسخة احتياطية تلقائية</h3><p>المرفق ملف JSON فيه الأصناف والديون والشيكات وفواتير الشهر. احتفظ به.<br>${fmtTime(new Date())}</p></div>`,
      { name: `pharmacy-backup-${ymd(new Date())}.json`, data: JSON.stringify(backupData()) });
    localStorage.lastBackup = String(Date.now()); return true;
  } catch { return false; }
}

/* ============ الهيكل ============ */
function showApp() {
  const tabs = [["pos", "🛒 الكاشير"], ["med", "💊 أدوية"], ["cos", "💄 كوزمتك"], ["del", "🛵 دليفري"]];
  if (isAdmin()) tabs.push(["dash", "📊 اللوحة"], ["ph", "👥 الصيادلة"], ["debts", "💳 ديون وشيكات"], ["alerts", "🔔 تنبيهات"], ["settings", "⚙ الإعدادات"]); else tabs.push(["mine", "💼 مبيعاتي"], ["alerts", "🔔 تنبيهات"]);
  if (!tabs.some(t => t[0] === S.tab)) S.tab = "pos"; // الصيدلي لا يرى تبويب لا يملكه
  $("#root").innerHTML = `<header><img src="logo-mark.png" alt="" style="height:30px;width:30px;background:#fff;border-radius:8px;padding:2px;object-fit:contain"><h1 id="phName">${esc(S.settings.pharmacy)}</h1>
  <span class="badge" id="rateBadge">${S.settings.rate ? `1$ = ${nf(S.settings.rate)} ج` : "⚠ أدخل سعر الدولار"}</span>
  ${isAdmin() ? `<button class="btn sec sm" id="bell"></button>` : ""}<button class="btn sec sm" id="prBtn">🖨 ${esc(localStorage.printerName || "طابعة")}</button>
  <span class="badge">${esc(S.profile.name)}</span><span class="badge hide" id="net" style="background:#c62828">🔴 بدون إنترنت — الفواتير تُحفظ وتُرسل لاحقاً</span><button class="btn sec sm" id="out">خروج</button></header>
  <nav>${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === S.tab ? "on" : ""}">${l}${k === "alerts" ? `<span id="albadge" style="background:#c62828;color:#fff;border-radius:10px;padding:0 6px;font-size:11px;margin-right:4px;display:none"></span>` : ""}</button>`).join("")}</nav><main id="main"></main>`;
  $("#out").onclick = () => { S.cart = []; try { localStorage.cart = "[]"; } catch { } signOut(auth); };
  const net = () => $("#net")?.classList.toggle("hide", navigator.onLine); window.ononline = net; window.onoffline = net; net();
  if (isAdmin()) {
    const bl = $("#bell"), paint = () => bl.textContent = localStorage.notif === "1" ? "🔔" : "🔕";
    paint();
    bl.onclick = async () => {
      if (localStorage.notif === "1") { localStorage.notif = "0"; toast("تم إيقاف إشعارات المبيعات"); }
      else {
        localStorage.notif = "1"; beep();
        if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { } }
        toast("Notification" in window && Notification.permission === "granted" ? "تم تفعيل إشعارات المبيعات" : "تم التفعيل داخل التطبيق فقط (إشعارات الجهاز غير مسموحة)");
      }
      paint();
    };
  }
  $("#prBtn").onclick = async () => { try { await connectPrinter(); toast("تم الاتصال بالطابعة"); } catch (e) { toast(e.message || "فشل الاتصال"); } };
  if (isAdmin()) $("#rateBadge").onclick = () => rateModal(false);
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => { S.tab = b.dataset.t; showApp(); });
  updBadge();
  (({ pos: viewPOS, med: () => viewProducts("med"), cos: () => viewProducts("cos"), del: () => viewProducts("del"), dash: viewDash, ph: viewPharm, mine: viewMine, debts: viewDebts, alerts: viewAlerts, settings: viewSettings })[S.tab] || viewPOS)();
}

/* ============ سعر الدولار ============ */
function rateModal(auto) {
  const m = modal(`<h3>💵 سعر الدولار اليوم</h3>${auto ? `<p style="color:var(--mut);font-size:14px">حدّث سعر اليوم ليُعاد حساب كل الأسعار فوراً.</p>` : ""}
  <label>الجنيه مقابل 1 دولار</label><input id="rv" type="number" inputmode="decimal" value="${S.settings.rate || ""}">
  <div class="row" style="margin-top:12px"><button class="btn" id="rs">حفظ</button><button class="btn sec" id="rc">لاحقاً</button></div>`);
  $("#rc", m).onclick = m.close;
  $("#rs", m).onclick = async () => {
    const v = Number($("#rv", m).value); if (!(v > 0)) return toast("أدخل رقماً صحيحاً");
    await setDoc(doc(db, "settings", "main"), { rate: v, rateDay: ymd(new Date()), rateBy: S.profile.name, rateAt: serverTimestamp() }, { merge: true });
    addDoc(collection(db, "rateHistory"), { rate: v, by: S.profile.name, at: serverTimestamp() });
    m.close(); toast("تم تحديث الأسعار");
  };
}

/* ============ الكاشير ============ */
function viewPOS() {
  $("#main").innerHTML = `<div class="pos"><section class="card"><div class="row"><input id="q" placeholder="ابحث في الأدوية والكوزمتك والدليفري أو امسح الباركود" autocomplete="off"><button class="btn" id="cam">📷</button></div><div id="res" class="list" style="margin-top:6px"></div></section>
  <section class="card"><h3>الفاتورة</h3><div id="cart"></div>
  <div class="row"><div><label>خصم (ج)</label><input id="disc" type="number" inputmode="decimal" value="0"></div>
  <div><label>الدفع</label><select id="pay"><option value="transfer">تحويل</option><option value="cash">نقدي</option><option value="credit">آجل (دين)</option></select></div></div>
  <div id="refBox"><label>رقم / مرجع التحويل (اختياري)</label><input id="rf"></div>
  <div id="creditBox" class="hide"><label>اسم العميل</label><input id="cn"><label>هاتف العميل</label><input id="cph" inputmode="tel"><label>تاريخ السداد</label><input id="cd" type="date"></div>
  <div class="total" id="tot">0 ج</div><button class="btn big" id="co">✔ إتمام البيع وطباعة</button></section></div>`;
  const q = $("#q");
  const results = () => {
    const t = q.value.trim().toLowerCase();
    const list = S.products.filter(p => !t || (p.name || "").toLowerCase().includes(t) || (p.barcode || "").includes(t)).slice(0, 40);
    $("#res").innerHTML = list.map(p => {
      const dl = p.expiry ? daysLeft(p.expiry) : 999;
      return `<div data-id="${p.id}"><span>${CATS[catOf(p)].icon} ${esc(p.name)}<small>${p.barcode ? esc(p.barcode) + " • " : ""}مخزون: ${p.qty ?? 0}${dl <= (S.settings.warnDays || 60) ? ` <span class="tag ${dl < 0 ? "red" : "org"}">${dl < 0 ? "منتهي" : "ينتهي بعد " + dl + " يوم"}</span>` : ""}</small></span><b>${nf(priceSDG(p))} ج</b></div>`;
    }).join("") || `<div style="justify-content:center;color:var(--mut)">لا نتائج</div>`;
    $("#res").querySelectorAll("[data-id]").forEach(d => d.onclick = () => { addToCart(d.dataset.id); });
  };
  const addToCart = id => {
    const p = S.products.find(x => x.id === id); if (!p) return;
    if (p.expiry && daysLeft(p.expiry) < 0 && !confirm("هذا الصنف منتهي الصلاحية! متابعة؟")) return;
    const c = S.cart.find(x => x.id === id); c ? c.qty++ : S.cart.push({ id, qty: 1 });
    beep(); cart();
  };
  const cartTotals = () => {
    const sub = S.cart.reduce((a, c) => { const p = S.products.find(x => x.id === c.id); return a + (p ? priceSDG(p) * c.qty : 0); }, 0);
    const d = Math.max(0, Number($("#disc")?.value) || 0); return { sub, d, total: Math.max(0, sub - d) };
  };
  const cart = () => {
    $("#cart").innerHTML = S.cart.map(c => {
      const p = S.products.find(x => x.id === c.id); if (!p) return "";
      return `<div class="cartline"><div class="nm">${esc(p.name)}<small style="color:var(--mut);display:block">${nf(priceSDG(p))} × ${c.qty}</small></div><button data-m="${c.id}">−</button><b>${c.qty}</b><button data-p="${c.id}">+</button><b style="min-width:70px;text-align:left">${nf(priceSDG(p) * c.qty)}</b></div>`;
    }).join("") || `<p style="color:var(--mut);text-align:center">السلة فارغة</p>`;
    $("#cart").querySelectorAll("[data-m]").forEach(b => b.onclick = () => { const c = S.cart.find(x => x.id === b.dataset.m); if (--c.qty <= 0) S.cart = S.cart.filter(x => x !== c); cart(); });
    $("#cart").querySelectorAll("[data-p]").forEach(b => b.onclick = () => { S.cart.find(x => x.id === b.dataset.p).qty++; cart(); });
    $("#tot").textContent = nf(cartTotals().total) + " ج";
    try { localStorage.cart = JSON.stringify(S.cart); } catch { }
  };
  q.oninput = results;
  q.onkeydown = e => {
    if (e.key !== "Enter") return; const v = q.value.trim(); if (!v) return;
    const exact = S.products.find(p => p.barcode === v);
    const hit = exact || (S.products.filter(p => p.name.toLowerCase().includes(v.toLowerCase())).length === 1 ? S.products.find(p => p.name.toLowerCase().includes(v.toLowerCase())) : null);
    if (hit) { addToCart(hit.id); q.value = ""; results(); } else toast("الصنف غير موجود");
  };
  $("#cam").onclick = () => scan(code => { const p = S.products.find(x => x.barcode === code); p ? addToCart(p.id) : toast("باركود غير مسجل: " + code); });
  $("#disc").oninput = cart;
  $("#pay").onchange = e => { $("#creditBox").classList.toggle("hide", e.target.value !== "credit"); $("#refBox").classList.toggle("hide", e.target.value !== "transfer"); };
  $("#co").onclick = checkout;
  S.refresh = () => { results(); cart(); };
  S.refresh(); q.focus();
}

function checkout() {
  if (!S.cart.length) return toast("السلة فارغة");
  const rate = Number(S.settings.rate); if (!rate) return toast("أدخل سعر الدولار أولاً");
  const items = S.cart.map(c => { const p = S.products.find(x => x.id === c.id); return { id: p.id, name: p.name, cat: catOf(p), qty: c.qty, price: priceSDG(p), cost: costOf(p) }; });
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const discount = Math.max(0, Number($("#disc").value) || 0), total = Math.max(0, subtotal - discount);
  const cost = items.reduce((a, i) => a + (i.cost || 0) * i.qty, 0);
  const pay = $("#pay").value;
  if (pay === "credit" && !$("#cn").value.trim()) return toast("اكتب اسم العميل للبيع الآجل");
  const now = new Date();
  const no = `${ymd(now).replace(/-/g, "").slice(2)}-${pad2(now.getHours())}${pad2(now.getMinutes())}${Math.floor(Math.random() * 90 + 10)}`;
  const sale = { no, items, subtotal, discount, total, cost, profit: total - cost, rate, pay, customer: pay === "credit" ? $("#cn").value.trim() : "", ref: pay === "transfer" ? $("#rf").value.trim() : "", phone: pay === "credit" ? $("#cph").value.replace(/\D/g, "") : "", cashier: S.profile.name, cashierUid: S.user.uid, day: ymd(now), month: ym(now) };
  const ref = doc(collection(db, "sales")), b = writeBatch(db);
  b.set(ref, { ...sale, createdAt: serverTimestamp() });
  items.forEach(i => b.update(doc(db, "products", i.id), { qty: increment(-i.qty) }));
  if (pay === "credit") b.set(doc(collection(db, "debts")), { name: sale.customer, phone: sale.phone, amount: total, dueDate: $("#cd").value || "", paid: false, saleNo: no, createdAt: serverTimestamp() });
  b.commit().catch(e => toast("تعذر الحفظ: " + e.message));
  S.cart = [];
  showReceipt({ ...sale, at: now }, true); viewPOS();
}

/* ============ الفاتورة / واتساب / طباعة ============ */
function waText(s) {
  const d = toDate(s.at || s.createdAt);
  return `🧾 *فاتورة ${s.no}* — ${S.settings.pharmacy}\n📅 ${fmtTime(d)}\n👤 الصيدلي: ${s.cashier}\n────────────\n` +
    s.items.map(i => `• ${i.name} × ${i.qty} = ${nf(i.price * i.qty)}`).join("\n") +
    `\n────────────\n${s.discount ? `خصم: ${nf(s.discount)} ج\n` : ""}💰 *الإجمالي: ${nf(s.total)} ج* (${(s.total / s.rate).toFixed(2)}$)\nسعر الدولار: ${nf(s.rate)}\nالدفع: ${payTxt(s)}${isAdmin() ? `\n📈 الربح: ${nf(s.profit)} ج` : ""}`;
}
const waLink = (phone, text) => `https://wa.me/${String(phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
function showReceipt(sale, autoPrint) {
  const c = receiptCanvas(sale);
  const m = modal(`<h3>🧾 فاتورة ${esc(sale.no)}</h3><img class="rcpt" src="${c.toDataURL()}" style="width:260px">
  <div class="row" style="flex-wrap:wrap"><button class="btn" id="rp">🖨 طباعة بلوتوث</button><button class="btn wa" id="rw">واتساب للمدير</button><button class="btn sec" id="rn">طباعة عادية</button>${isAdmin() && sale.id ? `<button class="btn danger" id="rd">🗑 حذف الفاتورة</button>` : ""}<button class="btn sec" id="rx">إغلاق</button></div>`);
  $("#rx", m).onclick = m.close;
  $("#rd", m) && ($("#rd", m).onclick = async () => {
    if (!confirm("حذف الفاتورة نهائياً وإرجاع كمياتها للمخزون؟")) return;
    try {
      const b = writeBatch(db);
      b.delete(doc(db, "sales", sale.id));
      sale.items.filter(i => S.products.some(p => p.id === i.id)).forEach(i => b.update(doc(db, "products", i.id), { qty: increment(i.qty) }));
      S.debts.filter(d => d.saleNo === sale.no && !d.paid).forEach(d => b.delete(doc(db, "debts", d.id)));
      await b.commit(); m.close(); toast("تم حذف الفاتورة");
    } catch (e) { toast("تعذر الحذف: " + e.message); }
  });
  $("#rp", m).onclick = () => printReceipt(sale);
  $("#rw", m).onclick = () => window.open(waLink(S.settings.adminPhone, waText(sale)), "_blank");
  $("#rn", m).onclick = () => printNormal(c, sale);
  if (autoPrint && PR.ch) printReceipt(sale);
}

/* ---- طباعة عادية ثم فتح واتساب المدير تلقائياً بنص الفاتورة ---- */
function printNormal(c, sale) {
  const w = window.open(""); if (!w) return toast("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة");
  const wa = S.settings.adminPhone ? waLink(S.settings.adminPhone, waText(sale)) : "";
  w.document.write(`<body style="margin:0;text-align:center;font-family:Tahoma,Arial"><style>@media print{.noprint{display:none}}</style><img src="${c.toDataURL()}" style="width:300px" onload="print()">${wa ? `<p class="noprint"><a href="${wa}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-size:16px">📲 إرسال الفاتورة للمدير (واتساب)</a></p>` : ""}</body>`);
  w.document.close();
  if (wa) w.addEventListener("afterprint", () => { w.location.href = wa; }); // بعد الطباعة تُفتح رسالة واتساب جاهزة للمدير
  else toast("أدخل رقم واتساب المدير في الإعدادات ليُرسل بعد الطباعة");
}

/* ---- طباعة بلوتوث (ESC/POS صورة، تدعم العربية) ---- */
let PR = { dev: null, ch: null };
const LOGO_PR = new Image(); LOGO_PR.src = "logo-print.png"; // شعار الإيصال (أبيض وأسود للطابعة الحرارية)
const SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb", "0000ae30-0000-1000-8000-00805f9b34fb"];
async function connectPrinter() {
  if (!navigator.bluetooth) throw new Error("المتصفح لا يدعم البلوتوث — استخدم Chrome على الأندرويد");
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  await openGatt(dev);
}
async function openGatt(dev) {
  const server = await dev.gatt.connect();
  for (const s of await server.getPrimaryServices()) {
    const c = (await s.getCharacteristics()).find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (c) {
      PR = { dev, ch: c }; localStorage.printerName = dev.name || "طابعة";
      dev.addEventListener("gattserverdisconnected", () => { PR.ch = null; });
      $("#prBtn") && ($("#prBtn").textContent = "🖨 " + localStorage.printerName); return;
    }
  }
  throw new Error("هذه الطابعة لا تدعم BLE (قد تكون بلوتوث كلاسيكي)");
}
async function ensurePrinter() {
  if (PR.ch && PR.dev?.gatt.connected) return;
  if (PR.dev) { try { await openGatt(PR.dev); return; } catch { } }
  await connectPrinter();
}
async function printReceipt(sale) {
  try {
    await ensurePrinter();
    const bytes = rasterBytes(receiptCanvas(sale)), c = PR.ch;
    for (let i = 0; i < bytes.length; i += 100) {
      const chunk = bytes.slice(i, i + 100);
      c.properties.writeWithoutResponse ? await c.writeValueWithoutResponse(chunk) : await c.writeValue(chunk);
      await sleep(25);
    }
    toast("تمت الطباعة");
  } catch (e) { console.error(e); toast("فشلت الطباعة: " + (e.message || e)); }
}
function receiptCanvas(sale) {
  const W = Number(localStorage.paper || 384), P = 8, fs = W > 400 ? 26 : 22;
  const font = (s, b) => `${b ? "bold " : ""}${s}px Tahoma, "Noto Naskh Arabic", Arial, sans-serif`;
  const mc = document.createElement("canvas").getContext("2d"); mc.direction = "rtl";
  const rows = [], center = (t, s = fs, b = false) => rows.push({ k: "c", t, s, b, h: s + 8 });
  const lr = (l, r, s = fs, b = false) => rows.push({ k: "lr", l, r, s, b, h: s + 8 });
  const line = () => rows.push({ k: "d", h: 12 });
  const wrap = (t, s, b) => { mc.font = font(s, b); const out = []; let cur = ""; for (const w of String(t).split(" ")) { const tr = cur ? cur + " " + w : w; if (mc.measureText(tr).width > W - 2 * P && cur) { out.push(cur); cur = w; } else cur = tr; } out.push(cur); return out; };
  const d = toDate(sale.at || sale.createdAt);
  if (LOGO_PR.complete && LOGO_PR.naturalWidth) { const lw = Math.min(W * 0.7, 280), lh = Math.round(lw * LOGO_PR.naturalHeight / LOGO_PR.naturalWidth); rows.push({ k: "img", lw, lh, h: lh + 8 }); }
  center(S.settings.pharmacy, fs + 6, true); center(`فاتورة ${sale.no}`); center(fmtTime(d), fs - 4); center(`الصيدلي: ${sale.cashier}`, fs - 4); line();
  sale.items.forEach(i => { wrap(i.name, fs, true).forEach(t => rows.push({ k: "r", t, s: fs, b: true, h: fs + 6 })); lr(`${i.qty} × ${nf(i.price)}`, nf(i.price * i.qty), fs - 2); });
  line();
  if (sale.discount) lr("الخصم", nf(sale.discount));
  lr("الإجمالي", nf(sale.total) + " ج", fs + 4, true);
  lr("بالدولار", (sale.total / sale.rate).toFixed(2) + " $", fs - 2);
  center(`سعر الدولار: ${nf(sale.rate)}`, fs - 4);
  center(`الدفع: ${payTxt(sale)}`, fs - 2, sale.pay === "credit");
  line(); center("شكراً لزيارتكم — الله يشفيكم", fs - 2); rows.push({ k: "d", h: 20 });
  const c = document.createElement("canvas"); c.width = W; c.height = rows.reduce((a, r) => a + r.h, 10);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, c.height); x.fillStyle = "#000"; x.textBaseline = "top"; x.direction = "rtl";
  let y = 5;
  for (const r of rows) {
    if (r.k === "img") { x.drawImage(LOGO_PR, (W - r.lw) / 2, y, r.lw, r.lh); }
    else if (r.k === "d") { x.fillRect(P, y + r.h / 2, W - 2 * P, 2); }
    else { x.font = font(r.s, r.b); if (r.k === "c") { x.textAlign = "center"; x.fillText(r.t, W / 2, y); } else if (r.k === "r") { x.textAlign = "right"; x.fillText(r.t, W - P, y); } else { x.textAlign = "right"; x.fillText(r.l, W - P, y); x.textAlign = "left"; x.fillText(r.r, P, y); } }
    y += r.h;
  }
  return c;
}
function rasterBytes(c) {
  const { width: w, height: h } = c, img = c.getContext("2d").getImageData(0, 0, w, h).data, bpr = w / 8, out = [0x1b, 0x40];
  for (let y0 = 0; y0 < h; y0 += 96) {
    const bh = Math.min(96, h - y0); out.push(0x1d, 0x76, 0x30, 0, bpr & 255, bpr >> 8, bh & 255, bh >> 8);
    for (let y = y0; y < y0 + bh; y++) for (let xb = 0; xb < bpr; xb++) { let b = 0; for (let k = 0; k < 8; k++) { const i = (y * w + xb * 8 + k) * 4; if (img[i] * .3 + img[i + 1] * .59 + img[i + 2] * .11 < 140) b |= 0x80 >> k; } out.push(b); }
  }
  out.push(0x1b, 0x64, 4); return new Uint8Array(out);
}

/* ============ ماسح الباركود بالكاميرا ============ */
async function scan(cb) {
  const ov = document.createElement("div"); ov.className = "scanov";
  ov.innerHTML = `<video playsinline muted></video><div class="frame"></div><button class="btn danger">إغلاق</button>`; document.body.append(ov);
  let stop = false, stream, reader; const video = $("video", ov);
  const close = () => { stop = true; stream?.getTracks().forEach(t => t.stop()); try { reader?.reset(); } catch { } ov.remove(); };
  const done = code => { if (stop) return; close(); beep(); cb(code); };
  $("button", ov).onclick = close;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); video.srcObject = stream; await video.play(); }
  catch { close(); return toast("تعذر فتح الكاميرا — اسمح بالصلاحية"); }
  if ("BarcodeDetector" in window) {
    const det = new BarcodeDetector();
    const loop = async () => { if (stop) return; try { const r = await det.detect(video); if (r.length) return done(r[0].rawValue); } catch { } setTimeout(loop, 150); }; loop();
  } else {
    await new Promise(r => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"; s.onload = r; s.onerror = r; document.head.append(s); });
    if (!window.ZXing) { close(); return toast("المتصفح لا يدعم المسح — استخدم Chrome"); }
    reader = new ZXing.BrowserMultiFormatReader(); reader.decodeFromStream(stream, video, r => { if (r) done(r.getText()); });
  }
}

/* ============ الأصناف ============ */
function viewProducts(cat = "med") {
  const C = CATS[cat];
  $("#main").innerHTML = `<div class="card"><h3 style="margin:0 0 8px">${C.icon} ${C.label}</h3><div class="row"><input id="pq" placeholder="بحث في ${C.label} بالاسم أو الباركود"><button class="btn" id="pc">📷</button><button class="btn" id="pa">+ صنف</button></div><div id="pl" class="list" style="margin-top:6px"></div></div>`;
  const draw = () => {
    const t = $("#pq").value.trim().toLowerCase();
    const l = S.products.filter(p => catOf(p) === cat && (!t || p.name.toLowerCase().includes(t) || (p.barcode || "").includes(t)));
    $("#pl").innerHTML = l.map(p => { const dl = p.expiry ? daysLeft(p.expiry) : 999; return `<div data-id="${p.id}"><span>${esc(p.name)}<small>${esc(p.barcode || "بدون باركود")} • مخزون ${p.qty ?? 0}${p.expiry ? " • صلاحية " + p.expiry : ""} ${dl <= (S.settings.warnDays || 60) ? `<span class="tag ${dl < 0 ? "red" : "org"}">${dl < 0 ? "منتهي" : dl + " يوم"}</span>` : ""}</small></span><span style="text-align:left"><b>${nf(priceSDG(p))} ج</b><small>${r2(toUSD(priceSDG(p)))}$</small></span></div>`; }).join("") || `<p style="text-align:center;color:var(--mut)">لا أصناف في ${C.label}</p>`;
    $("#pl").querySelectorAll("[data-id]").forEach(d => d.onclick = () => productModal(S.products.find(p => p.id === d.dataset.id)));
  };
  $("#pq").oninput = draw; $("#pa").onclick = () => productModal(null, "", cat);
  $("#pc").onclick = () => scan(code => { const p = S.products.find(x => x.barcode === code); p ? productModal(p) : productModal(null, code, cat); });
  S.refresh = draw; draw();
}
function productModal(p, bc = "", cat0 = "med") {
  const adm = isAdmin(), lock = p && !adm, cat = p ? catOf(p) : cat0;
  const c0 = p ? r2(costOf(p)) : "", pr0 = p ? r2(priceSDG(p)) : "";
  const initM = p ? (p.markup ?? (c0 > 0 && pr0 > 0 ? Math.round((pr0 / c0 - 1) * 1000) / 10 : "")) : catMarkup(cat);
  let dirty = !p; // لا نعيد حساب الدولار إن لم تتغير التكلفة/السعر
  const m = modal(`<h3>${p ? "تعديل صنف" : "صنف جديد"}</h3>${lock ? `<p style="font-size:13px;color:var(--mut)">الصيدلي يستطيع تعديل الكمية فقط.</p>` : ""}
  <label>القسم</label><select id="fcat" ${lock ? "disabled" : ""}>${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}</select>
  <label>الاسم</label><input id="fn" value="${esc(p?.name)}" ${lock ? "disabled" : ""}>
  <label>الباركود</label><div class="row"><input id="fb" value="${esc(p?.barcode || bc)}" ${lock ? "disabled" : ""}>${lock ? "" : `<button class="btn sec" id="fs">📷</button>`}</div>
  <div class="row"><div><label>التكلفة (ج)</label><input id="fc" type="number" step="0.01" inputmode="decimal" value="${c0}" ${lock ? "disabled" : ""}></div>
  <div><label>نسبة الربح %</label><input id="fm" type="number" step="0.1" inputmode="decimal" value="${initM}" ${lock ? "disabled" : ""}></div>
  <div><label>سعر البيع (ج)</label><input id="fp" type="number" step="0.01" inputmode="decimal" value="${pr0}" ${lock ? "disabled" : ""}></div></div>
  <p id="fsd" style="color:var(--p);font-weight:bold;margin:6px 0;font-size:14px"></p>
  <div class="row"><div><label>الكمية</label><input id="fq" type="number" inputmode="numeric" value="${p?.qty ?? ""}"></div>
  <div><label>تاريخ الانتهاء</label><input id="fe" type="date" value="${p?.expiry || ""}" ${lock ? "disabled" : ""}></div></div>
  <div class="row" style="margin-top:12px"><button class="btn" id="fok">حفظ</button>${p && adm ? `<button class="btn danger" id="fdel">حذف</button>` : ""}<button class="btn sec" id="fx">إلغاء</button></div>`);
  const upd = () => {
    const c = Number($("#fc", m).value) || 0, pr = Number($("#fp", m).value) || 0, rt = Number(S.settings.rate) || 0;
    $("#fsd", m).innerHTML = rt
      ? `بالدولار (1$ = ${nf(rt)} ج): التكلفة <b>$${r2(c / rt)}</b> • البيع <b>$${r2(pr / rt)}</b>` + (c > 0 && pr > 0 ? `<br>ربح الوحدة: ${nf(pr - c)} ج (${((pr / c - 1) * 100).toFixed(1)}%)` : "") + `<br><small style="font-weight:normal;color:var(--mut)">سعر البيع يتحرك تلقائياً مع سعر الدولار اليومي</small>`
      : "⚠ أدخل سعر الدولار ليظهر المقابل بالدولار";
  };
  const fromMarkup = () => { const c = Number($("#fc", m).value); if (c > 0 && $("#fm", m).value !== "") { const x = c * (1 + Number($("#fm", m).value) / 100); $("#fp", m).value = roundTo(x) || r2(x); } upd(); };
  const fromPrice = () => { const c = Number($("#fc", m).value), pr = Number($("#fp", m).value); if (c > 0 && pr > 0) $("#fm", m).value = Math.round((pr / c - 1) * 1000) / 10; upd(); };
  $("#fc", m).oninput = () => { dirty = true; fromMarkup(); }; $("#fm", m).oninput = () => { dirty = true; fromMarkup(); }; $("#fp", m).oninput = () => { dirty = true; fromPrice(); }; upd();
  $("#fcat", m).onchange = () => { if (!p) { $("#fm", m).value = catMarkup($("#fcat", m).value); fromMarkup(); } }; // نسبة الربح حسب القسم
  $("#fs", m) && ($("#fs", m).onclick = () => scan(c => $("#fb", m).value = c));
  $("#fx", m).onclick = m.close;
  $("#fdel", m) && ($("#fdel", m).onclick = async () => { if (confirm("حذف الصنف؟")) { await deleteDoc(doc(db, "products", p.id)); m.close(); } });
  $("#fok", m).onclick = async () => {
    const name = $("#fn", m).value.trim(), barcode = $("#fb", m).value.trim(), qty = Number($("#fq", m).value) || 0;
    if (lock) { updateDoc(doc(db, "products", p.id), { qty }).catch(e => toast(e.message)); m.close(); return; }
    if (!name) return toast("اكتب الاسم");
    if (barcode && S.products.some(x => x.barcode === barcode && x.id !== p?.id)) return toast("هذا الباركود مسجل لصنف آخر");
    const costS = Number($("#fc", m).value) || 0, priceS = Number($("#fp", m).value) || 0, rt = Number(S.settings.rate) || 0;
    if (dirty && !rt) return toast("أدخل سعر الدولار أولاً (من الشارة أعلى الشاشة)");
    const data = { name, barcode, cat: $("#fcat", m).value, ...(dirty ? { costUSD: p6(costS / rt), priceUSD: p6(priceS / rt) } : {}), markup: Number($("#fm", m).value) || 0, qty, expiry: $("#fe", m).value || "" };
    (p ? updateDoc(doc(db, "products", p.id), data) : addDoc(collection(db, "products"), { ...data, createdAt: serverTimestamp() })).catch(e => toast(e.message));
    m.close(); toast("تم الحفظ");
  };
}

/* ============ لوحة المدير ============ */
function sumSales(l) { return { n: l.length, total: l.reduce((a, s) => a + (s.total || 0), 0), profit: l.reduce((a, s) => a + (s.profit || 0), 0) }; }
function viewDash() {
  $("#main").innerHTML = `<div class="card"><h3>🔴 مباشر — اليوم</h3><div class="grid" id="td"></div></div>
  <div class="card"><div class="row"><h3 style="flex:1;margin:0">📅 الأرباح الشهرية</h3><input type="month" id="mp" value="${S.month}" style="max-width:170px"></div><div class="grid" id="mn" style="margin-top:8px"></div></div>
  <div class="card" id="alc" style="cursor:pointer"></div>
  <div class="card"><div class="row"><h3 style="flex:1;margin:0">آخر مبيعات اليوم</h3><button class="btn wa sm" id="dwa">تقرير اليوم واتساب</button></div><div id="ls" class="list"></div></div>`;
  $("#mp").onchange = e => { S.month = e.target.value || ym(new Date()); listenMonth(); };
  $("#dwa").onclick = () => { const t = sumSales(S.todaySales); window.open(waLink(S.settings.adminPhone, `📊 تقرير ${ymd(new Date())} — ${S.settings.pharmacy}\nعدد الفواتير: ${t.n}\nالمبيعات: ${nf(t.total)} ج\nالربح: ${nf(t.profit)} ج\nسعر الدولار: ${nf(S.settings.rate)}`), "_blank"); };
  const stat = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
  S.refresh = () => {
    const t = sumSales(S.todaySales), m = sumSales(S.monthSales);
    $("#td").innerHTML = stat("المبيعات", nf(t.total) + " ج") + stat("الأرباح", nf(t.profit) + " ج") + stat("عدد الفواتير", t.n) + stat("بالدولار", "$" + (S.settings.rate ? (t.total / S.settings.rate).toFixed(0) : 0));
    $("#mn").innerHTML = stat("مبيعات الشهر", nf(m.total) + " ج") + stat("أرباح الشهر", nf(m.profit) + " ج") + stat("الفواتير", m.n) + stat("متوسط الفاتورة", nf(m.n ? m.total / m.n : 0) + " ج") + stat("نسبة الربح", (m.total ? (m.profit / m.total * 100).toFixed(1) : 0) + "%");
    $("#ls").innerHTML = S.todaySales.slice(0, 30).map(s => `<div data-id="${s.id}"><span>${esc(s.no)} <small>${fmtTime(toDate(s.createdAt)).slice(11)} • ${esc(s.cashier)} • ${s.items.length} صنف${s.pay === "credit" ? " • آجل" : s.pay === "transfer" ? " • تحويل" : ""}</small></span><b>${nf(s.total)} ج</b></div>`).join("") || `<p style="text-align:center;color:var(--mut)">لا مبيعات بعد</p>`;
    $("#ls").querySelectorAll("[data-id]").forEach(d => d.onclick = () => showReceipt(S.todaySales.find(s => s.id === d.dataset.id)));
    const nal = alerts().length; $("#alc").innerHTML = nal ? `<h3 style="margin:0">⚠ ${nal} تنبيه (شيكات / ديون / انتهاء صلاحية) — اضغط للعرض</h3>` : `<p style="color:var(--grn);margin:0">لا تنبيهات ✔</p>`;
    $("#alc").onclick = () => { S.tab = "alerts"; showApp(); };
  };
  S.refresh();
}
function alerts() {
  const out = [], w = S.settings.warnDays || 60, cd = S.settings.chequeDays ?? 7;
  S.products.filter(p => p.expiry && daysLeft(p.expiry) <= w).forEach(p => { const d = daysLeft(p.expiry); out.push({ g: "exp", d, red: d < 0, t: `${CATS[catOf(p)].icon} ${esc(p.name)} — ${d < 0 ? "منتهي منذ " + -d + " يوم" : d === 0 ? "ينتهي اليوم" : "ينتهي بعد " + d + " يوم"} (كمية ${p.qty ?? 0})` }); });
  S.debts.filter(d => !d.paid && d.dueDate && daysLeft(d.dueDate) <= cd).forEach(d => { const x = daysLeft(d.dueDate); out.push({ g: "debt", d: x, red: x < 0, t: `💳 دين ${esc(d.name)}: ${nf(d.amount)} ج — ${dueTxt(x)}` }); });
  S.cheques.filter(c => !c.done && c.dueDate && daysLeft(c.dueDate) <= cd).forEach(c => { const x = daysLeft(c.dueDate); out.push({ g: "chq", d: x, red: x < 0, t: `🧾 شيك ${esc(c.party)}${c.no ? " (رقم " + esc(c.no) + ")" : ""} — ${c.type === "in" ? "وارد" : "صادر"}: ${nf(c.amount)} ج — استحقاق ${c.dueDate} (${dueTxt(x)})` }); });
  return out;
}
function viewAlerts() {
  $("#main").innerHTML = `<div class="card"><h3>🔔 التنبيهات</h3><div id="alx"></div></div>`;
  S.refresh = () => {
    const l = alerts(), G = [["chq", "🧾 شيكات قريبة الاستحقاق"], ["debt", "💳 ديون مستحقة"], ["exp", "💊 أصناف قاربت على الانتهاء"]];
    $("#alx").innerHTML = G.map(([g, t]) => {
      const a = l.filter(x => x.g === g).sort((x, y) => x.d - y.d); if (!a.length) return "";
      return `<h4 style="margin:12px 0 6px">${t} (${a.length})</h4>` + a.map(x => `<div class="alert ${x.red ? "red" : ""}">${x.t}</div>`).join("");
    }).join("") || `<p style="color:var(--grn);text-align:center">لا تنبيهات ✔</p>`;
  };
  S.refresh();
}

/* ============ إقفال حساب الصيدلي ============ */
async function closeShift() {
  const last = Math.max(0, ...S.myClosings.map(c => toDate(c.closedAt).getTime()));
  const list = S.mineToday.filter(s => toDate(s.createdAt).getTime() > last).sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt));
  if (!list.length) return toast("لا فواتير جديدة منذ آخر إقفال");
  const t = sumSales(list), credit = list.filter(s => s.pay === "credit").reduce((a, s) => a + s.total, 0), transfer = list.filter(s => s.pay === "transfer").reduce((a, s) => a + s.total, 0), cash = t.total - credit - transfer, now = new Date();
  if (!confirm(`إقفال الحساب: ${t.n} فاتورة بإجمالي ${nf(t.total)} ج (نقدي ${nf(cash)} • تحويل ${nf(transfer)} • آجل ${nf(credit)}). سيُرسل التقرير للمدير. متابعة؟`)) return;
  addDoc(collection(db, "closings"), { uid: S.user.uid, name: S.profile.name, day: ymd(now), count: t.n, total: t.total, profit: t.profit, cash, transfer, credit, closedAt: serverTimestamp() }).catch(e => toast("تعذر الحفظ: " + e.message));
  const tb = `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">`;
  const rows = list.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.no)}</td><td>${fmtTime(toDate(s.createdAt)).slice(11)}</td><td>${s.items.map(x => `${esc(x.name)} ×${x.qty}`).join("، ")}</td><td>${esc(payTxt(s))}</td><td>${nf(s.total)}</td></tr>`).join("");
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial;max-width:680px"><h2>🔒 إقفال حساب — ${esc(S.profile.name)}</h2><p>${esc(S.settings.pharmacy)} • ${fmtTime(now)}<br>الفواتير من ${fmtTime(toDate(list[0].createdAt)).slice(11)} إلى ${fmtTime(toDate(list[list.length - 1].createdAt)).slice(11)}</p>
<p>عدد الفواتير: <b>${t.n}</b><br>إجمالي الإيراد: <b>${nf(t.total)} ج</b><br>نقدي: ${nf(cash)} ج • تحويل: ${nf(transfer)} ج • آجل: ${nf(credit)} ج<br>سعر الدولار: ${nf(S.settings.rate)}<br>📈 الربح: ${nf(t.profit)} ج</p>
${tb}<tr><th>#</th><th>الفاتورة</th><th>الوقت</th><th>الأصناف</th><th>الدفع</th><th>المبلغ</th></tr>${rows}</table><h3>الأصناف المباعة</h3>${aggItems(list).replace("<table>", tb)}</div>`;
  toast(queueMail(`🔒 إقفال ${S.profile.name} — ${nf(t.total)} ج (${t.n} فاتورة)`, html) ? "تم الإقفال وإرسال التقرير للمدير" : "تم الإقفال (الإيميل غير مفعّل في الإعدادات)");
}

/* ============ صفحات مبيعات الصيادلة ============ */
const statHtml = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
function aggItems(list) {
  const m = new Map();
  list.forEach(s => s.items.forEach(i => { const k = i.id || i.name, r = m.get(k) || { name: i.name, qty: 0, sum: 0 }; r.qty += i.qty; r.sum += i.price * i.qty; m.set(k, r); }));
  const rows = [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 60);
  return rows.length ? `<table><tr><th>الصنف</th><th>الكمية</th><th>المبلغ (ج)</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.qty}</td><td>${nf(r.sum)}</td></tr>`).join("")}</table>` : `<p style="text-align:center;color:var(--mut)">لا مبيعات</p>`;
}
function invRow(s) {
  return `<div data-id="${s.id}"><span>${esc(s.no)} <small>${fmtTime(toDate(s.createdAt))} • ${s.items.length} صنف${s.pay === "credit" ? " • آجل" : s.pay === "transfer" ? " • تحويل" : ""}</small><small style="color:var(--tx);white-space:normal">${s.items.map(i => `${esc(i.name)} ×${i.qty}`).join(" ، ")}</small></span><b>${nf(s.total)} ج</b></div>`;
}
function viewMine() {
  $("#main").innerHTML = `<div class="card"><button class="btn big" id="cls">🔒 إقفال حسابي وإرسال التقرير للمدير</button><p id="clsi" style="font-size:13px;color:var(--mut);text-align:center;margin:6px 0 0"></p></div>
  <div class="card"><h3>💼 مبيعاتي اليوم — ${esc(S.profile.name)}</h3><div class="grid" id="mt"></div></div>
  <div class="card"><h3>📅 هذا الشهر</h3><div class="grid" id="mm"></div></div>
  <div class="card"><h3>فواتيري اليوم</h3><div id="ml" class="list"></div></div>
  <div class="card"><h3>الأصناف التي بعتها اليوم</h3><div id="ma"></div></div>`;
  $("#cls").onclick = closeShift;
  S.refresh = () => {
    const t = sumSales(S.mineToday), m = sumSales(S.mineMonth);
    const lc = S.myClosings.map(c => toDate(c.closedAt).getTime()).sort((a, b) => b - a)[0];
    $("#clsi").textContent = lc ? "آخر إقفال اليوم: " + fmtTime(new Date(lc)).slice(11) : "لم تُقفل حسابك اليوم بعد";
    $("#mt").innerHTML = statHtml("إيراد اليوم", nf(t.total) + " ج") + statHtml("فواتير اليوم", t.n);
    $("#mm").innerHTML = statHtml("إيراد الشهر", nf(m.total) + " ج") + statHtml("فواتير الشهر", m.n);
    const l = [...S.mineToday].sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
    $("#ml").innerHTML = l.map(invRow).join("") || `<p style="text-align:center;color:var(--mut)">لا فواتير بعد</p>`;
    $("#ml").querySelectorAll("[data-id]").forEach(d => d.onclick = () => showReceipt(l.find(s => s.id === d.dataset.id)));
    $("#ma").innerHTML = aggItems(S.mineToday);
  };
  S.refresh();
}
function viewPharm() {
  $("#main").innerHTML = `<div class="row" style="margin-bottom:8px"><h3 style="flex:1;margin:0">👥 مبيعات الصيادلة</h3><input type="month" id="pm" value="${S.month}" style="max-width:170px"></div><div id="pc"></div>
  <div class="card"><h3>🔒 آخر الإقفالات</h3><div id="pcl" class="list"></div></div>
  <div class="card"><h3 id="pa">الأصناف المباعة</h3><div id="pal"></div></div>
  <div class="card"><h3 id="pt">الفواتير</h3><div id="pl2" class="list"></div></div>`;
  $("#pm").onchange = e => { S.month = e.target.value || ym(new Date()); listenMonth(); };
  S.refresh = () => {
    if (!S.selPh || !S.users.some(u => u.id === S.selPh)) S.selPh = (S.users.find(u => u.role !== "admin") || S.users[0])?.id || null;
    $("#pc").innerHTML = S.users.map(u => {
      const t = sumSales(S.todaySales.filter(s => s.cashierUid === u.id)), m = sumSales(S.monthSales.filter(s => s.cashierUid === u.id));
      return `<div class="card" data-u="${u.id}" style="cursor:pointer;${u.id === S.selPh ? "border:2px solid var(--p)" : ""}"><h3>${esc(u.name)} <span class="tag ${u.disabled ? "red" : ""}">${u.disabled ? "موقوف" : u.role === "admin" ? "مدير" : "صيدلي"}</span></h3>
      <table><tr><th></th><th>فواتير</th><th>الإيراد (ج)</th><th>الربح (ج)</th></tr><tr><td>اليوم</td><td>${t.n}</td><td>${nf(t.total)}</td><td>${nf(t.profit)}</td></tr><tr><td>الشهر</td><td>${m.n}</td><td>${nf(m.total)}</td><td>${nf(m.profit)}</td></tr></table></div>`;
    }).join("") || `<p style="text-align:center;color:var(--mut)">لا حسابات</p>`;
    $("#pc").querySelectorAll("[data-u]").forEach(d => d.onclick = () => { S.selPh = d.dataset.u; S.refresh(); });
    $("#pcl").innerHTML = S.closings.slice(0, 20).map(c => `<div style="cursor:default"><span>${esc(c.name)} <small>${fmtTime(toDate(c.closedAt))} • ${c.count} فاتورة • نقدي ${nf(c.cash)} • تحويل ${nf(c.transfer || 0)} • آجل ${nf(c.credit)}</small></span><b>${nf(c.total)} ج</b></div>`).join("") || `<p style="text-align:center;color:var(--mut)">لا إقفالات بعد</p>`;
    const u = S.users.find(x => x.id === S.selPh), l = S.monthSales.filter(s => s.cashierUid === S.selPh).slice(0, 150);
    $("#pt").textContent = `فواتير ${u ? u.name : ""} — ${S.month}`;
    $("#pa").textContent = `الأصناف التي باعها ${u ? u.name : ""} — ${S.month}`;
    $("#pal").innerHTML = aggItems(S.monthSales.filter(s => s.cashierUid === S.selPh));
    $("#pl2").innerHTML = l.map(invRow).join("") || `<p style="text-align:center;color:var(--mut)">لا فواتير</p>`;
    $("#pl2").querySelectorAll("[data-id]").forEach(d => d.onclick = () => showReceipt(l.find(s => s.id === d.dataset.id)));
  };
  S.refresh();
}

/* ============ ديون وشيكات ============ */
function viewDebts() {
  $("#main").innerHTML = `<div class="card"><div class="row"><h3 style="flex:1;margin:0">💳 المديونيات</h3><button class="btn sm" id="da">+ دين</button></div><div id="dl" class="list"></div></div>
  <div class="card"><div class="row"><h3 style="flex:1;margin:0">🧾 الشيكات</h3><button class="btn sm" id="ca">+ شيك</button></div><div id="cl" class="list"></div></div>`;
  $("#da").onclick = () => debtModal(); $("#ca").onclick = () => chequeModal();
  S.refresh = () => {
    const ds = [...S.debts].sort((a, b) => (a.paid - b.paid) || (a.dueDate || "9").localeCompare(b.dueDate || "9"));
    $("#dl").innerHTML = ds.map(d => `<div data-d="${d.id}"><span>${esc(d.name)} ${d.paid ? `<span class="tag">مسدد</span>` : ""}<small>${d.dueDate ? "السداد: " + d.dueDate + (daysLeft(d.dueDate) < 0 && !d.paid ? " (متأخر)" : "") : "بدون تاريخ"}${d.saleNo ? " • فاتورة " + esc(d.saleNo) : ""}</small></span><b>${nf(d.amount)} ج</b></div>`).join("") || `<p style="text-align:center;color:var(--mut)">لا ديون</p>`;
    $("#dl").querySelectorAll("[data-d]").forEach(e => e.onclick = () => debtModal(S.debts.find(d => d.id === e.dataset.d)));
    const cs = [...S.cheques].sort((a, b) => (a.done - b.done) || (a.dueDate || "9").localeCompare(b.dueDate || "9"));
    $("#cl").innerHTML = cs.map(c => `<div data-c="${c.id}"><span>${esc(c.party)} ${c.done ? `<span class="tag">منتهي</span>` : ""}<small>${c.type === "in" ? "وارد" : "صادر"} • ${esc(c.no || "")} • استحقاق ${c.dueDate || "-"}</small></span><b>${nf(c.amount)}</b></div>`).join("") || `<p style="text-align:center;color:var(--mut)">لا شيكات</p>`;
    $("#cl").querySelectorAll("[data-c]").forEach(e => e.onclick = () => chequeModal(S.cheques.find(c => c.id === e.dataset.c)));
  };
  S.refresh();
}
function debtModal(d) {
  const m = modal(`<h3>${d ? "دين" : "دين جديد"}</h3><label>الاسم</label><input id="a1" value="${esc(d?.name)}"><label>الهاتف (مع كود الدولة)</label><input id="a2" inputmode="tel" value="${esc(d?.phone)}">
  <label>المبلغ (ج)</label><input id="a3" type="number" value="${d?.amount ?? ""}"><label>تاريخ السداد</label><input id="a4" type="date" value="${d?.dueDate || ""}">
  <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn" id="ok">حفظ</button>${d && !d.paid ? `<button class="btn sec" id="pd">✔ تم السداد</button>` : ""}${d?.phone ? `<button class="btn wa" id="rm">تذكير العميل</button>` : ""}${d ? `<button class="btn danger" id="dx">حذف</button>` : ""}</div>`);
  $("#ok", m).onclick = () => { const data = { name: $("#a1", m).value.trim(), phone: $("#a2", m).value.replace(/\D/g, ""), amount: Number($("#a3", m).value) || 0, dueDate: $("#a4", m).value }; if (!data.name) return toast("الاسم مطلوب"); (d ? updateDoc(doc(db, "debts", d.id), data) : addDoc(collection(db, "debts"), { ...data, paid: false, createdAt: serverTimestamp() })); m.close(); };
  $("#pd", m) && ($("#pd", m).onclick = () => { updateDoc(doc(db, "debts", d.id), { paid: true, paidAt: serverTimestamp() }); m.close(); });
  $("#rm", m) && ($("#rm", m).onclick = () => window.open(waLink(d.phone, `السلام عليكم ${d.name}، تذكير من ${S.settings.pharmacy} بمبلغ ${nf(d.amount)} ج${d.dueDate ? " المستحق بتاريخ " + d.dueDate : ""}. شكراً لكم.`), "_blank"));
  $("#dx", m) && ($("#dx", m).onclick = () => { if (confirm("حذف؟")) { deleteDoc(doc(db, "debts", d.id)); m.close(); } });
}
function chequeModal(c) {
  const m = modal(`<h3>${c ? "شيك" : "شيك جديد"}</h3><label>النوع</label><select id="b0"><option value="in" ${c?.type === "in" ? "selected" : ""}>وارد (لنا)</option><option value="out" ${c?.type === "out" ? "selected" : ""}>صادر (علينا)</option></select>
  <label>الجهة</label><input id="b1" value="${esc(c?.party)}"><label>رقم الشيك</label><input id="b2" value="${esc(c?.no)}"><label>المبلغ</label><input id="b3" type="number" value="${c?.amount ?? ""}"><label>تاريخ الاستحقاق</label><input id="b4" type="date" value="${c?.dueDate || ""}">
  <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn" id="ok">حفظ</button>${c && !c.done ? `<button class="btn sec" id="pd">✔ تم الصرف</button>` : ""}${c ? `<button class="btn danger" id="dx">حذف</button>` : ""}</div>`);
  $("#ok", m).onclick = () => { const data = { type: $("#b0", m).value, party: $("#b1", m).value.trim(), no: $("#b2", m).value.trim(), amount: Number($("#b3", m).value) || 0, dueDate: $("#b4", m).value }; if (!data.party) return toast("الجهة مطلوبة"); (c ? updateDoc(doc(db, "cheques", c.id), data) : addDoc(collection(db, "cheques"), { ...data, done: false, createdAt: serverTimestamp() })); m.close(); };
  $("#pd", m) && ($("#pd", m).onclick = () => { updateDoc(doc(db, "cheques", c.id), { done: true }); m.close(); });
  $("#dx", m) && ($("#dx", m).onclick = () => { if (confirm("حذف؟")) { deleteDoc(doc(db, "cheques", c.id)); m.close(); } });
}

/* ============ الإعدادات والمستخدمون ============ */
function viewSettings() {
  if (!isAdmin()) return viewPOS();
  $("#main").innerHTML = `<div class="card"><h3>⚙ إعدادات الصيدلية</h3>
  <label>اسم الصيدلية</label><input id="s1" value="${esc(S.settings.pharmacy)}">
  <label>واتساب المدير (مع كود الدولة)</label><input id="s2" inputmode="tel" value="${esc(S.settings.adminPhone)}">
  <div class="row"><div><label>تنبيه الانتهاء قبل (يوم)</label><input id="s3" type="number" value="${S.settings.warnDays}"></div><div><label>تقريب السعر إلى أقرب</label><input id="s4" type="number" value="${S.settings.round}"></div></div>
  <div class="row"><div><label>تنبيه الشيكات والديون قبل (يوم)</label><input id="s9" type="number" value="${S.settings.chequeDays ?? 7}"></div></div>
  <label>نسبة الربح % حسب القسم</label>
  <div class="row"><div><label>💊 أدوية</label><input id="m1" type="number" step="0.1" inputmode="decimal" value="${catMarkup("med")}"></div><div><label>💄 كوزمتك</label><input id="m2" type="number" step="0.1" inputmode="decimal" value="${catMarkup("cos")}"></div><div><label>🛵 دليفري</label><input id="m3" type="number" step="0.1" inputmode="decimal" value="${catMarkup("del")}"></div></div>
  <button class="btn sec sm" id="sap" style="margin-top:8px">تطبيق النسب على أصناف كل قسم</button>
  <label>رابط سكربت الإيميل (Google Apps Script) — اتركه فارغاً لإيقاف الإيميل</label><input id="s7" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(S.settings.emailHook)}">
  <label>كلمة سر الإيميل (نفس الموجودة في السكربت)</label><input id="s8" value="${esc(S.settings.emailKey)}">
  <button class="btn sec sm" id="smt" style="margin-top:8px">📧 إرسال إيميل تجريبي</button>
  <div class="row" style="margin-top:8px"><button class="btn sec sm" id="bkd">💾 تنزيل نسخة احتياطية</button><button class="btn sec sm" id="bke">📧 إرسال نسخة بالإيميل الآن</button></div>
  <p style="font-size:12px;color:var(--mut);margin:6px 0 0">تُرسل نسخة تلقائية كل يوم إلى بريدك عند فتح التطبيق بحساب المدير.</p>
  <label>عرض ورق الطابعة (على هذا الجهاز)</label><select id="s5"><option value="384" ${localStorage.paper !== "576" ? "selected" : ""}>58 مم</option><option value="576" ${localStorage.paper === "576" ? "selected" : ""}>80 مم</option></select>
  <div style="height:10px"></div><button class="btn" id="ss">حفظ</button></div>
  <div class="card"><div class="row"><h3 style="flex:1;margin:0">👥 الحسابات</h3><button class="btn sm" id="ua">+ صيدلي</button></div><div id="ul" class="list"></div></div>`;
  $("#ss").onclick = async () => { localStorage.paper = $("#s5").value; await setDoc(doc(db, "settings", "main"), { pharmacy: $("#s1").value.trim(), adminPhone: $("#s2").value.replace(/\D/g, ""), warnDays: Number($("#s3").value) || 60, round: Number($("#s4").value) || 1, markupMed: Number($("#m1").value) || 0, markupCos: Number($("#m2").value) || 0, markupDel: Number($("#m3").value) || 0, defaultMarkup: Number($("#m1").value) || 0, chequeDays: $("#s9").value === "" ? 7 : Number($("#s9").value) || 0, emailHook: $("#s7").value.trim(), emailKey: $("#s8").value.trim() }, { merge: true }); toast("تم الحفظ"); };
  $("#ua").onclick = userModal;
  $("#bkd").onclick = downloadBackup;
  $("#bke").onclick = async () => toast((await autoBackup(true)) ? "أُرسلت النسخة — افحص بريدك" : "تعذر الإرسال — تحقق من رابط السكربت والإنترنت");
  $("#smt").onclick = async () => {
    const h = $("#s7").value.trim(); if (!h) return toast("الصق رابط السكربت أولاً");
    try { await mailPost(h, $("#s8").value.trim(), "📧 إيميل تجريبي — " + S.settings.pharmacy, `<div dir="rtl"><h3>الإيميل يعمل ✔</h3><p>${fmtTime(new Date())}</p></div>`); toast("أُرسل الطلب — افحص بريدك خلال دقيقة (وصندوق الرسائل غير المرغوبة)"); }
    catch { toast("تعذر الوصول للرابط — تأكد من الإنترنت ومن الرابط"); }
  };
  $("#sap").onclick = async () => {
    const mk = { med: Number($("#m1").value), cos: Number($("#m2").value), del: Number($("#m3").value) };
    if (!Object.values(mk).every(v => v >= 0)) return toast("اكتب نسباً صحيحة");
    const l = S.products.filter(p => costOf(p) > 0);
    if (!l.length) return toast("لا توجد أصناف لها تكلفة مسجلة");
    const cnt = c => l.filter(p => catOf(p) === c).length;
    if (!confirm(`سيُعاد حساب سعر البيع (التكلفة + النسبة) لـ ${l.length} صنف:\nأدوية ${cnt("med")} (${mk.med}%) • كوزمتك ${cnt("cos")} (${mk.cos}%) • دليفري ${cnt("del")} (${mk.del}%)\nوسيُلغى أي سعر يدوي. متابعة؟`)) return;
    const rt = Number(S.settings.rate) || 0; if (!rt) return toast("أدخل سعر الدولار أولاً");
    for (let i = 0; i < l.length; i += 400) {
      const b = writeBatch(db);
      l.slice(i, i + 400).forEach(p => {
        const c = catOf(p), cu = Number(p.costUSD) > 0 ? Number(p.costUSD) : costOf(p) / rt;
        b.update(doc(db, "products", p.id), { cat: c, markup: mk[c], costUSD: p6(cu), priceUSD: p6(cu * (1 + mk[c] / 100)) });
      });
      await b.commit();
    }
    await setDoc(doc(db, "settings", "main"), { markupMed: mk.med, markupCos: mk.cos, markupDel: mk.del, defaultMarkup: mk.med }, { merge: true });
    toast("تم تحديث أسعار " + l.length + " صنف");
  };
  S.refresh = () => {
    $("#ul").innerHTML = S.users.map(u => `<div data-u="${u.id}"><span>${esc(u.name)}<small>${esc(u.username)} • ${u.role === "admin" ? "مدير" : "صيدلي"}</small></span>${u.id === S.user.uid ? "" : `<span class="tag ${u.disabled ? "red" : ""}">${u.disabled ? "موقوف — اضغط للتفعيل" : "نشط — اضغط للإيقاف"}</span>`}</div>`).join("");
    $("#ul").querySelectorAll("[data-u]").forEach(e => e.onclick = () => { const u = S.users.find(x => x.id === e.dataset.u); if (u.id !== S.user.uid) updateDoc(doc(db, "users", u.id), { disabled: !u.disabled }); });
  };
  S.refresh();
}
function userModal() {
  const m = modal(`<h3>حساب صيدلي جديد</h3><label>الاسم</label><input id="u1"><label>اسم المستخدم (إنجليزي)</label><input id="u2" autocapitalize="none"><label>كلمة المرور</label><input id="u3" type="password"><div class="row" style="margin-top:12px"><button class="btn" id="ok">إنشاء</button><button class="btn sec" id="x">إلغاء</button></div>`);
  $("#x", m).onclick = m.close;
  $("#ok", m).onclick = async () => {
    const name = $("#u1", m).value.trim(), un = $("#u2", m).value.trim(), pw = $("#u3", m).value;
    if (!name || !un || pw.length < 6) return toast("أكمل البيانات (كلمة المرور 6+)");
    try {
      const sec = initializeApp(firebaseConfig, "sec" + Date.now()), sa = getAuth(sec);
      const cred = await createUserWithEmailAndPassword(sa, userEmail(un), pw); await signOut(sa);
      await setDoc(doc(db, "users", cred.user.uid), { name, username: un, role: "cashier", createdAt: serverTimestamp() });
      toast("تم إنشاء الحساب"); m.close();
    } catch (e) { toast(e.code === "auth/email-already-in-use" ? "اسم المستخدم مستخدم" : e.message); }
  };
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
