require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Database = require('better-sqlite3');
const { validate } = require('@tma.js/init-data-node');
const { YooKassaSdk, CurrencyEnum } = require('@exode-team/yokassa.api');

const app = express();
app.use(cors());
app.use('/api/payment/webhook', express.json({ type: '*/*' }));
app.use('/api/telegram/webhook', express.json({ type: '*/*' }));
app.use(express.json());

const db = new Database('./data.db');
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY, balance REAL NOT NULL DEFAULT 0,
  referrer_id INTEGER, referral_bonus_paid INTEGER NOT NULL DEFAULT 0,
  active_promo TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);`);
db.exec(`CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL,
  amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);`);
db.exec(`CREATE TABLE IF NOT EXISTS tariffs (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, days INTEGER NOT NULL,
  price REAL NOT NULL, old_price REAL, badge TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);`);
db.exec(`CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY, type TEXT NOT NULL, value REAL NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0, used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);`);
db.exec(`CREATE TABLE IF NOT EXISTS promo_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL,
  telegram_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(code, telegram_id)
);`);
db.exec(`CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL UNIQUE, bonus_days INTEGER NOT NULL DEFAULT 0,
  bonus_balance REAL NOT NULL DEFAULT 0,
  paid_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

function getSetting(key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('referral_bonus_days')) setSetting('referral_bonus_days', '7');
if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('referral_bonus_balance')) setSetting('referral_bonus_balance', '0');

if (db.prepare('SELECT COUNT(*) as c FROM tariffs').get().c === 0) {
  const ins = db.prepare(`INSERT INTO tariffs (id, label, days, price, old_price, badge, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);
  ins.run('30d', '30 дней', 30, 149, null, null, 1);
  ins.run('90d', '90 дней', 90, 399, null, 'выгодно', 2);
  ins.run('1y',  '1 год',  365, 1290, 1790, '-40%', 3);
  console.log('📦 Тарифы инициализированы');
}

const {
  PORT = 3001, BOT_TOKEN, H1CLOUD_PANEL_URL, H1CLOUD_PANEL_TOKEN,
  H1CLOUD_CLIENT_PREFIX = 'tg', YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY,
  ADMIN_TG_ID, BOT_USERNAME = 'ThalorVPN_bot',
} = process.env;

function validateTelegramData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    validate(initData, BOT_TOKEN, { expiresIn: 3600 });
    const params = new URLSearchParams(initData);
    const user = params.get('user');
    return user ? JSON.parse(user) : null;
  } catch (e) {
    console.error('initData error:', e.message);
    return null;
  }
}

const panel = axios.create({ baseURL: H1CLOUD_PANEL_URL, headers: { Authorization: `Bearer ${H1CLOUD_PANEL_TOKEN}` }, timeout: 15000 });
const yookassa = new YooKassaSdk({ secret_key: YOOKASSA_SECRET_KEY, shop_id: YOOKASSA_SHOP_ID });

function isAdmin(tgUser) { return ADMIN_TG_ID && String(tgUser.id) === String(ADMIN_TG_ID); }
function getTariffs() { return db.prepare(`SELECT * FROM tariffs WHERE is_active = 1 ORDER BY sort_order, price`).all(); }
function getTariffById(id) { return db.prepare('SELECT * FROM tariffs WHERE id = ? AND is_active = 1').get(id); }

async function findClient(clientName) {
  const { data } = await panel.get('/api/clients');
  if (!data.ok) throw new Error(data.error || 'panel_error');
  return (data.clients || []).find((c) => c.name === clientName) || null;
}
async function createClient(clientName, days = 3, gb = 5) {
  const { data } = await panel.post('/api/create', { name: clientName, days, traffic_limit_gb: gb });
  if (!data.ok) throw new Error(data.error || 'create_failed');
  return data.client || data;
}
async function extendClient(clientName, days) {
  const { data } = await panel.patch(`/api/clients/${encodeURIComponent(clientName)}`, { days });
  if (!data.ok) throw new Error(data.error || 'extend_failed');
  return data.client || data;
}
async function getAllClients() {
  const { data } = await panel.get('/api/clients');
  return data.clients || [];
}

function normalizeClient(client) {
  const link = client.inbound_links?.[0]?.link || client.link || '';
  return {
    name: client.name, uuid: client.uuid,
    isActive: client.status === 'active' && !client.banned,
    isBanned: !!client.banned,
    daysLeft: client.left_days || 0,
    expiresAt: client.expires_at ? new Date(client.expires_at * 1000).toISOString() : null,
    trafficUsed: client.traffic_used_gb || 0,
    trafficTotal: client.traffic_limit_gb || 0,
    subscriptionUrl: client.sub_url || '',
    vlessLink: link,
    deviceLimit: client.device_limit || 0,
    devicesCount: client.devices_count || 0,
    devices: (client.devices || []).map((d) => ({
      model: d.model || 'Unknown', os: d.os || '', osVersion: d.os_ver || '',
      lastSeen: d.last_seen ? new Date(d.last_seen * 1000).toISOString() : null, ip: d.ip || '',
    })),
    online: !!client.online,
  };
}

function ensureUser(tgId) {
  let row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId);
  if (!row) {
    db.prepare('INSERT INTO users (telegram_id, balance) VALUES (?, 0)').run(tgId);
    row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId);
  }
  return row;
}

async function tryPayReferralBonus(tgId) {
  const user = ensureUser(tgId);
  if (!user.referrer_id || user.referral_bonus_paid || user.referrer_id === tgId) return;
  const bonusDays = Number(getSetting('referral_bonus_days', '7')) || 0;
  const bonusBalance = Number(getSetting('referral_bonus_balance', '0')) || 0;
  try {
    if (bonusDays > 0) {
      await extendClient(`${H1CLOUD_CLIENT_PREFIX}${user.referrer_id}`, bonusDays);
      await extendClient(`${H1CLOUD_CLIENT_PREFIX}${tgId}`, bonusDays);
    }
    if (bonusBalance > 0) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(bonusBalance, user.referrer_id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(bonusBalance, tgId);
    }
    db.prepare(`INSERT OR IGNORE INTO referrals (referrer_id, referred_id, bonus_days, bonus_balance) VALUES (?, ?, ?, ?)`)
      .run(user.referrer_id, tgId, bonusDays, bonusBalance);
    db.prepare('UPDATE users SET referral_bonus_paid = 1 WHERE telegram_id = ?').run(tgId);
    console.log(`🎁 Реферал: ${user.referrer_id} → ${tgId}, +${bonusDays}д, +${bonusBalance}₽`);
  } catch (e) { console.error('referral bonus error:', e.message); }
}

function calcPromo(promo, price) {
  let discount = 0, bonusDays = 0, bonusBalance = 0;
  switch (promo.type) {
    case 'discount_percent': discount = Math.round(price * promo.value / 100 * 100) / 100; break;
    case 'discount_fixed':   discount = Math.min(price, promo.value); break;
    case 'bonus_days':       bonusDays = promo.value; break;
    case 'bonus_balance':    bonusBalance = promo.value; break;
  }
  const finalPrice = Math.max(0, Math.round((price - discount) * 100) / 100);
  return { discount, finalPrice, bonusDays, bonusBalance };
}

function promoTypeLabel(type, value) {
  switch (type) {
    case 'discount_percent': return `Скидка ${value}%`;
    case 'discount_fixed':   return `Скидка ${value} ₽`;
    case 'bonus_days':       return `+${value} дней подписки`;
    case 'bonus_balance':    return `+${value} ₽ на баланс`;
    default:                 return 'Промокод';
  }
}

app.get('/api/tariffs', (req, res) => res.json({ ok: true, tariffs: getTariffs() }));

app.post('/api/telegram/webhook', (req, res) => {
  res.status(200).json({ ok: true });
  try {
    const update = req.body;
    const msg = update.message || update.edited_message;
    if (!msg?.text || !msg.from?.id) return;
    const match = msg.text.match(/^\/start(?:\s+ref(\d+))?/i);
    if (!match) return;
    const newUserId = msg.from.id;
    const referrerId = match[1] ? Number(match[1]) : null;
    const exists = db.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(newUserId);
    if (!exists) {
      db.prepare('INSERT INTO users (telegram_id, balance, referrer_id) VALUES (?, 0, ?)')
        .run(newUserId, referrerId && referrerId !== newUserId ? referrerId : null);
      console.log(`👤 Новый: ${newUserId}, ref: ${referrerId || '—'}`);
    }
  } catch (e) { console.error('webhook error:', e.message); }
});

app.post('/api/user', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const clientName = `${H1CLOUD_CLIENT_PREFIX}${tgUser.id}`;
  ensureUser(tgUser.id);

  try {
    let client = await findClient(clientName);
    let created = false;
    if (!client) {
      await createClient(clientName, 3, 5);
      client = await findClient(clientName);
      created = true;
    }
    if (!client) return res.status(500).json({ ok: false, error: 'client_not_found' });

    await tryPayReferralBonus(tgUser.id);
    const freshUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    const freshClient = await findClient(clientName);

    res.json({
      ok: true, created,
      user: { name: tgUser.first_name || 'Пользователь', username: tgUser.username || '', telegramId: tgUser.id },
      isAdmin: isAdmin(tgUser),
      balance: freshUser.balance,
      subscription: normalizeClient(freshClient),
      referralLink: `https://t.me/${BOT_USERNAME}?start=ref${tgUser.id}`,
    });
  } catch (e) {
    console.error('/api/user error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/referral/info', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  const invited = db.prepare('SELECT * FROM referrals WHERE referrer_id = ? ORDER BY paid_at DESC').all(tgUser.id);
  res.json({
    ok: true,
    link: `https://t.me/${BOT_USERNAME}?start=ref${tgUser.id}`,
    invitedCount: invited.length,
    invited: invited.map((r) => ({ telegramId: r.referred_id, bonusDays: r.bonus_days, bonusBalance: r.bonus_balance, paidAt: r.paid_at })),
    currentBonus: { days: Number(getSetting('referral_bonus_days', '7')), balance: Number(getSetting('referral_bonus_balance', '0')) },
  });
});

app.post('/api/promo/apply', (req, res) => {
  const { initData, code } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  if (!code) return res.status(400).json({ ok: false, error: 'no_code' });

  const promo = db.prepare('SELECT * FROM promos WHERE code = ?').get(code.toUpperCase());
  if (!promo) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!promo.is_active) return res.status(400).json({ ok: false, error: 'inactive' });
  if (promo.expires_at && promo.expires_at < Math.floor(Date.now() / 1000)) return res.status(400).json({ ok: false, error: 'expired' });
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) return res.status(400).json({ ok: false, error: 'limit_reached' });

  const used = db.prepare('SELECT status FROM promo_uses WHERE code = ? AND telegram_id = ?').get(promo.code, tgUser.id);
  if (used && used.status === 'used') return res.status(400).json({ ok: false, error: 'already_used' });

  db.prepare('UPDATE users SET active_promo = ? WHERE telegram_id = ?').run(promo.code, tgUser.id);
  db.prepare(`INSERT OR REPLACE INTO promo_uses (code, telegram_id, status) VALUES (?, ?, 'pending')`).run(promo.code, tgUser.id);

  res.json({ ok: true, promo: { code: promo.code, type: promo.type, value: promo.value, label: promoTypeLabel(promo.type, promo.value) } });
});

app.post('/api/promo/cancel', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  const user = ensureUser(tgUser.id);
  if (user.active_promo) {
    db.prepare(`UPDATE promo_uses SET status = 'cancelled' WHERE code = ? AND telegram_id = ?`).run(user.active_promo, tgUser.id);
  }
  db.prepare('UPDATE users SET active_promo = NULL WHERE telegram_id = ?').run(tgUser.id);
  res.json({ ok: true });
});

app.post('/api/subscription/extend', async (req, res) => {
  const { initData, tariff_id } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const tariff = getTariffById(tariff_id);
  if (!tariff) return res.status(400).json({ ok: false, error: 'invalid_tariff' });

  const user = ensureUser(tgUser.id);
  const clientName = `${H1CLOUD_CLIENT_PREFIX}${tgUser.id}`;

  let promo = null;
  let calc = { discount: 0, finalPrice: tariff.price, bonusDays: 0, bonusBalance: 0 };
  if (user.active_promo) {
    promo = db.prepare('SELECT * FROM promos WHERE code = ?').get(user.active_promo);
    if (promo && promo.is_active) calc = calcPromo(promo, tariff.price);
    else promo = null;
  }

  if (user.balance < calc.finalPrice) {
    return res.status(400).json({ ok: false, error: 'insufficient_balance', balance: user.balance, required: calc.finalPrice });
  }

  try {
    const totalDays = tariff.days + calc.bonusDays;
    await extendClient(clientName, totalDays);
    db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?').run(calc.finalPrice, tgUser.id);

    if (calc.bonusBalance > 0) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(calc.bonusBalance, tgUser.id);
    }

    if (promo) {
      db.prepare('UPDATE promos SET used_count = used_count + 1 WHERE code = ?').run(promo.code);
      db.prepare(`UPDATE promo_uses SET status = 'used' WHERE code = ? AND telegram_id = ?`).run(promo.code, tgUser.id);
      db.prepare('UPDATE users SET active_promo = NULL WHERE telegram_id = ?').run(tgUser.id);
    }

    const updated = await findClient(clientName);
    const newBalance = ensureUser(tgUser.id).balance;

    const parts = [`Подписка продлена на ${totalDays} дней`];
    if (calc.discount > 0) parts.push(`скидка ${calc.discount} ₽`);
    if (calc.bonusBalance > 0) parts.push(`бонус +${calc.bonusBalance} ₽`);

    console.log(`✅ ${tgUser.id}: продлено ${totalDays}д, списано ${calc.finalPrice}₽${promo ? ` (промо ${promo.code})` : ''}`);
    res.json({ ok: true, message: parts.join(', '), balance: newBalance, subscription: normalizeClient(updated) });
  } catch (e) {
    console.error('extend error:', e.message);
    res.status(500).json({ ok: false, error: 'extend_failed', details: e.message });
  }
});

app.post('/api/payment/create', async (req, res) => {
  const { initData, amount } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 1 || numAmount > 100000) return res.status(400).json({ ok: false, error: 'invalid_amount' });

  try {
    const payment = await yookassa.payments.create({
      amount: { currency: CurrencyEnum.RUB, value: numAmount.toFixed(2) }, capture: true,
      confirmation: { type: 'redirect', return_url: 'https://scaling-winner-7vqwvg6gjvg2rqx-3000.app.github.dev/' },
      description: `Пополнение Thalor VPN (tg: ${tgUser.id})`,
      metadata: { telegram_id: tgUser.id },
    });
    db.prepare(`INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status) VALUES (?, ?, ?, 'pending')`).run(payment.id, tgUser.id, numAmount);
    res.json({ ok: true, payment_id: payment.id, confirmation_url: payment.confirmation.confirmation_url });
  } catch (e) { res.status(500).json({ ok: false, error: 'payment_creation_failed' }); }
});

app.post('/api/payment/webhook', (req, res) => {
  const event = req.body;
  if (event?.event !== 'payment.succeeded') return res.status(200).json({ ok: true });
  const p = event.object;
  const tgId = Number(p.metadata?.telegram_id);
  const amount = Number(p.amount?.value);
  if (!p.id || !tgId || isNaN(amount)) return res.status(200).json({ ok: true });
  const existing = db.prepare('SELECT status FROM payments WHERE payment_id = ?').get(p.id);
  if (existing?.status === 'succeeded') return res.status(200).json({ ok: true });
  try {
    db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status) VALUES (?, ?, ?, 'succeeded')`).run(p.id, tgId, amount);
      ensureUser(tgId);
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, tgId);
    })();
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post('/api/payment/check', async (req, res) => {
  const { initData, payment_id } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  if (!payment_id) return res.status(400).json({ ok: false, error: 'no_payment_id' });
  try {
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
    const { data: payment } = await axios.get(`https://api.yookassa.ru/v3/payments/${payment_id}`, { headers: { Authorization: `Basic ${auth}` } });
    if (payment.status !== 'succeeded') return res.json({ ok: true, status: payment.status, balance: ensureUser(tgUser.id).balance });
    if (Number(payment.metadata?.telegram_id) !== tgUser.id) return res.status(403).json({ ok: false, error: 'wrong_user' });
    const existing = db.prepare('SELECT status FROM payments WHERE payment_id = ?').get(payment_id);
    if (existing?.status === 'succeeded') return res.json({ ok: true, status: 'already_credited', balance: ensureUser(tgUser.id).balance });
    const amount = Number(payment.amount?.value);
    db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status) VALUES (?, ?, ?, 'succeeded')`).run(payment_id, tgUser.id, amount);
      ensureUser(tgUser.id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, tgUser.id);
    })();
    res.json({ ok: true, status: 'credited', balance: ensureUser(tgUser.id).balance });
  } catch (e) { res.status(500).json({ ok: false, error: 'check_failed' }); }
});

app.post('/api/admin/stats', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  try {
    const clients = await getAllClients();
    const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalBalance = db.prepare('SELECT COALESCE(SUM(balance), 0) as s FROM users').get().s;
    const totalPayments = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s, COUNT(*) as c FROM payments WHERE status = 'succeeded'`).get();
    const totalReferrals = db.prepare('SELECT COUNT(*) as c FROM referrals').get().c;
    const promoUsed = db.prepare(`SELECT COUNT(*) as c FROM promo_uses WHERE status = 'used'`).get().c;
    res.json({
      ok: true,
      panel: {
        totalClients: clients.length,
        activeClients: clients.filter((c) => c.status === 'active' && !c.banned).length,
        bannedClients: clients.filter((c) => c.banned).length,
        onlineClients: clients.filter((c) => c.online).length,
        totalTrafficUsedGB: Math.round(clients.reduce((s, c) => s + (c.traffic_used_gb || 0), 0) * 10) / 10,
      },
      miniApp: {
        usersCount, totalBalance: Math.round(totalBalance * 100) / 100,
        totalPaymentsSum: Math.round(totalPayments.s * 100) / 100,
        totalPaymentsCount: totalPayments.c, totalReferrals, promoUsed,
      },
      server: { panelUrl: H1CLOUD_PANEL_URL, adminTgId: ADMIN_TG_ID, botUsername: BOT_USERNAME },
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/clients', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  try {
    const clients = await getAllClients();
    res.json({ ok: true, clients: clients.map((c) => ({ name: c.name, uuid: c.uuid, status: c.status, banned: !!c.banned, daysLeft: c.left_days || 0, trafficUsed: c.traffic_used_gb || 0, trafficLimit: c.traffic_limit_gb || 0, online: !!c.online, expiresAt: c.expires_at || 0 })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/settings', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  res.json({ ok: true, settings: { referral_bonus_days: Number(getSetting('referral_bonus_days', '7')), referral_bonus_balance: Number(getSetting('referral_bonus_balance', '0')) } });
});

app.post('/api/admin/settings/update', (req, res) => {
  const { initData, settings } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  if (settings?.referral_bonus_days !== undefined) setSetting('referral_bonus_days', Math.max(0, Number(settings.referral_bonus_days)));
  if (settings?.referral_bonus_balance !== undefined) setSetting('referral_bonus_balance', Math.max(0, Number(settings.referral_bonus_balance)));
  res.json({ ok: true, settings: { referral_bonus_days: Number(getSetting('referral_bonus_days', '7')), referral_bonus_balance: Number(getSetting('referral_bonus_balance', '0')) } });
});

app.post('/api/admin/tariffs', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  res.json({ ok: true, tariffs: db.prepare('SELECT * FROM tariffs ORDER BY sort_order, price').all() });
});

app.post('/api/admin/tariffs/update', (req, res) => {
  const { initData, tariff } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  if (!tariff?.id) return res.status(400).json({ ok: false, error: 'no_id' });
  try {
    db.prepare(`UPDATE tariffs SET label = ?, days = ?, price = ?, old_price = ?, badge = ?, is_active = ?, sort_order = ? WHERE id = ?`)
      .run(tariff.label, Number(tariff.days), Number(tariff.price), tariff.old_price ? Number(tariff.old_price) : null, tariff.badge || null, tariff.is_active ? 1 : 0, Number(tariff.sort_order) || 0, tariff.id);
    res.json({ ok: true, tariffs: db.prepare('SELECT * FROM tariffs ORDER BY sort_order, price').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/tariffs/create', (req, res) => {
  const { initData, tariff } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  if (!tariff?.id || !tariff?.label) return res.status(400).json({ ok: false, error: 'no_id_or_label' });
  try {
    db.prepare(`INSERT INTO tariffs (id, label, days, price, old_price, badge, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(tariff.id, tariff.label, Number(tariff.days), Number(tariff.price), tariff.old_price ? Number(tariff.old_price) : null, tariff.badge || null, Number(tariff.sort_order) || 99);
    res.json({ ok: true, tariffs: db.prepare('SELECT * FROM tariffs ORDER BY sort_order, price').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/tariffs/delete', (req, res) => {
  const { initData, id } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  try {
    db.prepare('DELETE FROM tariffs WHERE id = ?').run(id);
    res.json({ ok: true, tariffs: db.prepare('SELECT * FROM tariffs ORDER BY sort_order, price').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/promos', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  res.json({ ok: true, promos: db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all() });
});

app.post('/api/admin/promos/create', (req, res) => {
  const { initData, promo } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  if (!promo?.code || !promo?.type) return res.status(400).json({ ok: false, error: 'no_code_or_type' });
  const valid = ['discount_percent', 'discount_fixed', 'bonus_days', 'bonus_balance'];
  if (!valid.includes(promo.type)) return res.status(400).json({ ok: false, error: 'invalid_type' });
  try {
    db.prepare(`INSERT INTO promos (code, type, value, max_uses, expires_at, is_active) VALUES (?, ?, ?, ?, ?, 1)`)
      .run(promo.code.toUpperCase(), promo.type, Number(promo.value), Number(promo.max_uses) || 0, promo.expires_at ? Number(promo.expires_at) : null);
    res.json({ ok: true, promos: db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/promos/toggle', (req, res) => {
  const { initData, code } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  try {
    db.prepare('UPDATE promos SET is_active = 1 - is_active WHERE code = ?').run(code);
    res.json({ ok: true, promos: db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/promos/delete', (req, res) => {
  const { initData, code } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser || !isAdmin(tgUser)) return res.status(403).json({ ok: false, error: 'access_denied' });
  try {
    db.prepare('DELETE FROM promos WHERE code = ?').run(code);
    db.prepare('DELETE FROM promo_uses WHERE code = ?').run(code);
    res.json({ ok: true, promos: db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'thalor-vpn-backend' }));

app.listen(PORT, () => {
  console.log(`✅ Backend запущен: http://localhost:${PORT}`);
  console.log(`   Админ TG ID: ${ADMIN_TG_ID || '(не задан)'}`);
  console.log(`   Бот: @${BOT_USERNAME}`);
});