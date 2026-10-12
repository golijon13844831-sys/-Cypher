/* ============================================================
   سایفر — سرور Node خالص (بدون هیچ وابستگی)
   اجرا:  node server.js   →   http://localhost:3000
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data.json');
const START = Date.now();

/* ---------- دیتابیس در حافظه + ذخیره روی دیسک ---------- */
let db = { users: {}, chats: {}, messages: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
let dirty = false;
const save = () => { dirty = true; };
setInterval(() => {
  if (!dirty) return; dirty = false;
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error(e); }
}, 2000);

const uid = (p) => p + crypto.randomBytes(5).toString('hex');
if (!db.users.ava) {
  db.users.ava = { id: 'ava', name: 'آوا', color: '#2bc4ae', bot: true, bio: 'دستیار سایفر — /help', lastSeen: 0 };
  save();
}

/* ---------- پیدا کردن index.html ---------- */
const INDEX_CANDIDATES = [
  path.join(PUB, 'index.html'),
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'www', 'index.html'),
];
const INDEX = INDEX_CANDIDATES.find(p => fs.existsSync(p)) || null;

const GUIDE_HTML = '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>سایفر — راهنمای اجرا</title></head>'
+ '<body style="font-family:Vazirmatn,Tahoma,sans-serif;background:#0a0b0e;color:#eceef4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">'
+ '<div style="max-width:560px;padding:28px;background:#101319;border:1px solid #262b3a;border-radius:20px;line-height:2.2">'
+ '<h1 style="margin:0 0 10px">سایفر<span style="color:#f5b02e">.</span> — فایل کلاینت پیدا نشد</h1>'
+ '<p style="color:#98a0b4;font-size:14px">این دو فایل را با همین ساختار در یک پوشه بگذار و بعد <code style="background:#1e2330;padding:2px 8px;border-radius:6px">node server.js</code> را اجرا کن:</p>'
+ '<pre style="background:#0b0d12;border:1px solid #262b3a;border-radius:12px;padding:14px;direction:ltr;text-align:left;font-size:13px">'
+ 'cypher/\n├── server.js\n└── public/\n    └── index.html</pre>'
+ '<p style="color:#98a0b4;font-size:14px">سپس در مرورگر باز کن: <b style="color:#f5b02e">http://localhost:' + PORT + '</b></p>'
+ '</div></body></html>';

/* ---------- SSE ---------- */
const clients = new Set();
function sendTo(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  catch (e) { clients.delete(c); }
}
function broadcast(event, data) { for (const c of [...clients]) sendTo(c, event, data); }
const isOnline = (id) => [...clients].some(c => c.userId === id);
function presence() {
  const online = [...new Set([...clients].map(c => c.userId).filter(Boolean))];
  const lastSeen = {};
  for (const id in db.users) lastSeen[id] = db.users[id].lastSeen || 0;
  return { online, lastSeen };
}
function broadcastPresence() { broadcast('presence', presence()); }
setInterval(() => { for (const c of [...clients]) { try { c.res.write(': hb\n\n'); } catch (e) { clients.delete(c); } } }, 20000);

/* ---------- ابزارک ---------- */
function jalali(ts) {
  const d = new Date(ts);
  const g = [0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = d.getFullYear() <= 1600 ? 0 : 979;
  let gy = d.getFullYear() - (d.getFullYear() <= 1600 ? 621 : 1600);
  const gm = d.getMonth() + 1, gd = d.getDate();
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365*gy + ~~((gy2+3)/4) - ~~((gy2+99)/100) + ~~((gy2+399)/400) - 80 + gd + g[gm-1];
  jy += 33 * ~~(days/12053); days %= 12053;
  jy += 4 * ~~(days/1461);  days %= 1461;
  if (days > 365) { jy += ~~((days-1)/365); days = (days-1)%365; }
  return [jy, days < 186 ? 1+~~(days/31) : 7+~~((days-186)/30), days < 186 ? 1+days%31 : 1+(days-186)%30];
}
const JMON = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

function newMsg(chatId, from, payload) {
  const m = Object.assign(
    { id: uid('m'), chatId, from, ts: Date.now(), reactions: {}, delivered: {}, seen: {} },
    payload
  );
  db.messages[m.id] = m; save();
  return m;
}
function getOrCreateDM(a, b) {
  const id = 'dm_' + [a, b].sort().join('-');
  if (!db.chats[id]) {
    db.chats[id] = { id, type: 'dm', members: [a, b], created: Date.now(), pin: null };
    save(); broadcast('chats', db.chats);
  }
  return db.chats[id];
}
function usersPublic() {
  const out = {};
  for (const id in db.users) {
    const u = db.users[id];
    out[id] = { id, name: u.name, color: u.color, img: u.img || null, bio: u.bio || '', bot: !!u.bot, lastSeen: u.lastSeen || 0 };
  }
  return out;
}

/* ---------- بات آوا ---------- */
const JOKES = [
  'به کامپیوتر گفتند یک شوخی بگو؛ گفت: ۴۰۴ — شوخی پیدا نشد!',
  'به هارد گفتند چرا غر می‌زنی؟ گفت: فضای خالی ندارم!',
  'موش پشت مانیتور گربه را دید و آرام شد؛ گفت: این یکی مجازی است!',
  'دو آنتی‌ویروس همدیگر را اسکن کردند؛ هر دو قرنطینه شدند!',
  'برنامه‌نویس به شیرینی‌فروش گفت: یکی بی‌باگ بده. فروشنده گفت: باگ مال خودتان است!'
];
const FALLBACK = ['خب خب، بعدش چی شد؟','جالب است! بیشتر بگو.','می‌فهمم… ادامه بده.','واقعاً؟','گوش می‌دهم… البته متنی!'];

function botReply(chat, msg) {
  const t = (msg.text || '').trim();
  if (t[0] === '/') {
    const parts = t.slice(1).split(/\s+/), cmd = parts[0], arg = parts.slice(1).join(' ');
    switch (cmd) {
      case 'help': return 'دستورهای من:\n/joke جوک · /time ساعت · /date تاریخ شمسی\n/roll 20 تاس · /flip شیر یا خط · /calc 2+2*8 ماشین‌حساب · /echo متن';
      case 'joke': return JOKES[~~(Math.random()*JOKES.length)];
      case 'time': { const d = new Date(); return `سرور می‌گوید ساعت ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} است.`; }
      case 'date': { const j = jalali(Date.now()); return `امروز ${j[2]} ${JMON[j[1]-1]} ${j[0]} است.`; }
      case 'roll': { const n = Math.max(2, parseInt(arg)||6); return `تاسِ ${n}‌رو: ${1+~~(Math.random()*n)}`; }
      case 'flip': return Math.random() < .5 ? 'شیر!' : 'خط!';
      case 'calc': {
        const e = arg.replace(/[^0-9+\-*/().% ]/g, '');
        if (!e) return 'مثلاً: /calc 2+2*8';
        try { return `${e} = ${Function('return ('+e+')')()}`; } catch (_) { return 'این عبارت را نمی‌توانم حساب کنم!'; }
      }
      case 'echo': return arg ? 'بازتاب: «'+arg+'»' : 'چه چیزی را بازتاب کنم؟';
      default: return `دستور «${cmd}» را نمی‌شناسم؛ /help را ببین.`;
    }
  }
  const rules = [
    [/سلام|درود/, 'سلام! خوبی؟ من آوا هستم؛ دستیار خودِ سایفر.'],
    [/چطوری|خوبی|حالت|چه خبر/, 'عالی‌ام! تو چطوری؟'],
    [/اسمت|کی هستی/, 'آوا هستم؛ یعنی «صدا». با /help کارهایم را ببین.'],
    [/ممنون|مرسی|تشکر/, 'خواهش می‌کنم! کاری داشتی همین‌جام.'],
    [/خداحافظ|بای/, 'به سلامت! هر وقت خواستی همین‌جایم.'],
    [/جوک/, JOKES[~~(Math.random()*JOKES.length)]],
  ];
  for (const [rx, v] of rules) if (rx.test(t)) return v;
  return FALLBACK[~~(Math.random()*FALLBACK.length)];
}
function maybeBot(chat, msg) {
  if (!chat || !chat.members.includes('ava')) return;
  if (msg.from === 'ava' || msg.type !== 'text') return;
  if (chat.type === 'group' && !/آوا|^\//.test(msg.text || '')) return;
  broadcast('typing', { chatId: chat.id, userId: 'ava', on: true });
  setTimeout(() => {
    if (!db.messages[msg.id]) return;
    msg.seen.ava = Date.now();
    broadcast('update', msg);
    broadcast('typing', { chatId: chat.id, userId: 'ava', on: false });
    broadcast('msg', newMsg(chat.id, 'ava', { type: 'text', text: botReply(chat, msg) }));
  }, 800 + Math.min(2600, (msg.text || '').length * 22) + Math.random() * 600);
}

/* ---------- مسیرها ---------- */
function route(p, j) {
  switch (p) {
    case '/api/health':
      return { ok: true, app: 'سایفر', version: '4.0', uptime: ~~((Date.now()-START)/1000),
               users: Object.keys(db.users).length, chats: Object.keys(db.chats).length,
               messages: Object.keys(db.messages).length };
    case '/api/login': {
      const name = String(j.name || '').trim();
      if (!name) throw Error('نام لازم است');
      let user = Object.values(db.users).find(u => u.name.trim() === name);
      if (!user) {
        user = { id: uid('u'), name, color: j.color || '#f5b02e', bio: '', lastSeen: 0 };
        db.users[user.id] = user;
      } else if (j.color) user.color = j.color;
      save();
      const dm = getOrCreateDM(user.id, 'ava');
      if (!dm.welcomed) {
        dm.welcomed = true;
        newMsg(dm.id, 'ava', { type: 'text', text: 'سلام ' + name + '! من آوا هستم؛ دستیار خودِ سایفر.' });
        newMsg(dm.id, 'ava', { type: 'text', text: 'با /help همه دستورها را ببین. مثلاً: /joke یا /calc 2+2*8' });
        save();
      }
      broadcast('users', usersPublic());
      return { user };
    }
    case '/api/avatar': {           /* ← ارتقا ۱: عکس پروفایل */
      const u = db.users[j.userId];
      if (!u) throw Error('کاربر نیست');
      if (j.img === null) { delete u.img; }
      else {
        const s = String(j.img || '');
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(s) || s.length > 7e5) throw Error('عکس نامعتبر است');
        u.img = s;
      }
      save(); broadcast('users', usersPublic());
      return { ok: true };
    }
    case '/api/export':             /* ← ارتقا ۳: بکاپ کامل */
      return { users: db.users, chats: db.chats, messages: db.messages };
    case '/api/import': {           /* ← ارتقا ۳: بازیابی بکاپ */
      if (!j || !j.users || !j.chats || !j.messages) throw Error('فایل بکاپ معتبر نیست');
      db.users = j.users; db.chats = j.chats; db.messages = j.messages;
      save();
      broadcast('reload', {});
      return { ok: true };
    }
    case '/api/dm': return { chatId: getOrCreateDM(j.a, j.b).id };
    case '/api/chats': {
      if (!Array.isArray(j.members) || !j.members.length) throw Error('عضو لازم است');
      const title = String(j.title || 'گروه').slice(0, 40);
      const c = { id: uid('g'), type: 'group', title, members: [...new Set([j.by, ...j.members])], created: Date.now(), pin: null };
      db.chats[c.id] = c; save();
      /* ← ارتقا ۵: پیام سیستمی ساخت گروه */
      broadcast('msg', newMsg(c.id, j.by, { type: 'system', text: 'گروه «' + title + '» ساخته شد' }));
      broadcast('chats', db.chats);
      return { chatId: c.id };
    }
    case '/api/send': {
      const c = db.chats[j.chatId];
      if (!c || !c.members.includes(j.from)) throw Error('گفت‌وگو نامعتبر است');
      const m = newMsg(j.chatId, j.from, {
        type: j.type || 'text',
        text: String(j.text || '').slice(0, 4000),
        meta: j.meta || null,
        replyTo: j.replyTo || null,
      });
      if (!m.text && !m.meta) throw Error('پیام خالی است');
      for (const mem of c.members) {
        if (mem === m.from) continue;
        if (mem === 'ava' || isOnline(mem)) m.delivered[mem] = Date.now();
      }
      save();
      broadcast('msg', m);
      maybeBot(c, m);
      return { ok: true, id: m.id };
    }
    case '/api/edit': {
      const m = db.messages[j.id];
      if (!m || m.from !== j.userId) throw Error('اجازه نداری');
      m.text = String(j.text || '').slice(0, 4000); m.edited = Date.now(); save();
      broadcast('update', m);
      return { ok: true };
    }
    case '/api/delete': {
      const m = db.messages[j.id];
      if (!m || m.from !== j.userId) throw Error('اجازه نداری');
      m.deleted = true; save();
      broadcast('update', m);
      return { ok: true };
    }
    case '/api/react': {
      const m = db.messages[j.id];
      if (!m) throw Error('پیام نیست');
      m.reactions = m.reactions || {};
      const arr = m.reactions[j.emoji] = m.reactions[j.emoji] || [];
      const i = arr.indexOf(j.userId);
      i >= 0 ? arr.splice(i, 1) : arr.push(j.userId);
      if (!arr.length) delete m.reactions[j.emoji];
      save(); broadcast('update', m);
      return { ok: true };
    }
    case '/api/typing': broadcast('typing', { chatId: j.chatId, userId: j.userId, on: !!j.on }); return { ok: true };
    case '/api/read': {
      const done = [];
      for (const id of (Array.isArray(j.ids) ? j.ids : [])) {
        const m = db.messages[id];
        if (m && m.chatId === j.chatId) { m.seen = m.seen || {}; m.seen[j.userId] = Date.now(); done.push(m); }
      }
      if (done.length) { save(); done.forEach(m => broadcast('update', m)); }
      return { ok: true, n: done.length };
    }
    case '/api/pin': {
      const c = db.chats[j.chatId];
      if (!c) throw Error('گفت‌وگو نیست');
      c.pin = j.messageId || null; save();
      broadcast('chats', db.chats);
      return { ok: true };
    }
    case '/api/clear': {
      const c = db.chats[j.chatId];
      if (!c) throw Error('گفت‌وگو نیست');
      for (const id in db.messages) if (db.messages[id].chatId === j.chatId) delete db.messages[id];
      c.pin = null; save();
      broadcast('clear', { chatId: j.chatId });
      broadcast('chats', db.chats);
      return { ok: true };
    }
    case '/api/profile': {
      const u = db.users[j.userId];
      if (!u) throw Error('کاربر نیست');
      if (j.name) u.name = String(j.name).slice(0, 24);
      u.bio = String(j.bio || '').slice(0, 80);
      save(); broadcast('users', usersPublic());
      return { ok: true };
    }
  }
  throw Error('مسیر ناشناخته: ' + p);
}

/* ---------- HTTP ---------- */
function sse(req, res) {
  const userId = new URL(req.url, 'http://x').searchParams.get('user');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 1500\n\n');
  const c = { res, userId };
  clients.add(c);
  sendTo(c, 'init', { me: userId, users: usersPublic(), chats: db.chats, messages: db.messages, presence: presence() });
  broadcastPresence();
  req.on('close', () => {
    clients.delete(c);
    if (userId && !isOnline(userId) && db.users[userId]) { db.users[userId].lastSeen = Date.now(); save(); }
    broadcastPresence();
  });
}

const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css',
               svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', ico: 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET') {
    if (url === '/api/stream') return sse(req, res);
    if (url === '/api/health' || url === '/api/export') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(route(url, {})));
    }
    if (url === '/api/users') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(Object.values(usersPublic())));
    }
    /* فقط صفحهٔ اصلی و فایل‌های داخل public/ سرو می‌شوند (نه سورس، نه دیتابیس) */
    if (url === '/' || url === '/index.html') {
      if (!INDEX) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(GUIDE_HTML); }
      return fs.readFile(INDEX, (e, buf) => {
        if (e) { res.writeHead(500); return res.end('error'); }
        res.writeHead(200, { 'Content-Type': MIME.html });
        res.end(buf);
      });
    }
    const fp = path.normalize(path.join(PUB, url));
    if (fp.startsWith(PUB) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return fs.readFile(fp, (e, buf) => {
        if (e) { res.writeHead(500); return res.end('error'); }
        res.writeHead(200, { 'Content-Type': MIME[fp.split('.').pop()] || 'application/octet-stream' });
        res.end(buf);
      });
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(GUIDE_HTML);
  }

  /* POST */
  let body = '';
  req.on('data', ch => { body += ch; if (body.length > 15e6) req.destroy(); });
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body || '{}'); } catch (e) {}
    try {
      const out = route(url, j);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ─────────────────────────────────────────');
  console.log('   سایفر بالاست  →  http://localhost:' + PORT);
  console.log('  ─────────────────────────────────────────');
  if (INDEX) console.log('   کلاینت: ' + path.relative(ROOT, INDEX));
  else console.log('   ⚠ index.html پیدا نشد! ساختار درست: cypher/server.js + cypher/public/index.html');
  console.log('   دو پنجره با دو نام = دو کاربر واقعی');
  console.log('   پیام‌ها در data.json ذخیره می‌شوند');
  console.log('');
});