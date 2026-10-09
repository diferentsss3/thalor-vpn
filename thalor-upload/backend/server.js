require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Database = require('better-sqlite3');
const { validate } = require('@tma.js/init-data-node');
const { YooKassaSdk, CurrencyEnum } = require('@exode-team/yokassa.api');

const app = express();
app.use(cors());

// ВАЖНО: вебхук должен идти ДО express.json(), чтобы получить raw body
app.use('/api/payment/webhook', express.json({ type: '*/*' }));
app.use(express.json());

// --- База данных SQLite ---
const db = new Database('./data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`);

const {
  PORT = 3001,
  BOT_TOKEN,
  H1CLOUD_PANEL_URL,
  H1CLOUD_PANEL_TOKEN,
  H1CLOUD_CLIENT_PREFIX = 'tg',
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,
} = process.env;

function validateTelegramData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    validate(initData, BOT_TOKEN, { expiresIn: 3600 });
    const urlParams = new URLSearchParams(initData);
    const userJson = urlParams.get('user');
    return userJson ? JSON.parse(userJson) : null;
  } catch (e) {
    console.error('Ошибка проверки initData:', e.message);
    return null;
  }
}

const panel = axios.create({
  baseURL: H1CLOUD_PANEL_URL,
  headers: { Authorization: `Bearer ${H1CLOUD_PANEL_TOKEN}` },
  timeout: 15000,
});

const yookassa = new YooKassaSdk({
  secret_key: YOOKASSA_SECRET_KEY,
  shop_id: YOOKASSA_SHOP_ID,
});

// --- Утилиты H1 ---
async function findClient(clientName) {
  const { data } = await panel.get('/api/clients');
  if (!data.ok) throw new Error(data.error || 'panel_error');
  const list = data.clients || [];
  return list.find((c) => c.name === clientName) || null;
}

async function createClient(clientName, days = 3, gb = 5) {
  const { data } = await panel.post('/api/create', {
    name: clientName,
    days,
    traffic_limit_gb: gb,
  });
  if (!data.ok) throw new Error(data.error || 'create_failed');
  return data.client || data;
}

function normalizeClient(client) {
  const link = client.inbound_links?.[0]?.link || client.link || '';
  return {
    name: client.name,
    uuid: client.uuid,
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
      model: d.model || 'Unknown',
      os: d.os || '',
      osVersion: d.os_ver || '',
      lastSeen: d.last_seen ? new Date(d.last_seen * 1000).toISOString() : null,
      ip: d.ip || '',
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

// --- Данные пользователя ---
app.post('/api/user', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const clientName = `${H1CLOUD_CLIENT_PREFIX}${tgUser.id}`;
  const userRow = ensureUser(tgUser.id);

  try {
    let client = await findClient(clientName);
    let created = false;

    if (!client) {
      await createClient(clientName, 3, 5);
      client = await findClient(clientName);
      created = true;
    }

    if (!client) return res.status(500).json({ ok: false, error: 'client_not_found_after_create' });

    res.json({
      ok: true,
      created,
      user: {
        name: tgUser.first_name || 'Пользователь',
        username: tgUser.username || '',
        telegramId: tgUser.id,
      },
      balance: userRow.balance,
      subscription: normalizeClient(client),
    });
  } catch (e) {
    console.error('/api/user error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Создать платёж (минимум 1 ₽) ---
app.post('/api/payment/create', async (req, res) => {
  const { initData, amount } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 1 || numAmount > 100000) {
    return res.status(400).json({ ok: false, error: 'invalid_amount' });
  }

  try {
    const payment = await yookassa.payments.create({
      amount: {
        currency: CurrencyEnum.RUB,
        value: numAmount.toFixed(2),
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: 'https://scaling-winner-7vqwvg6gjvg2rqx-3000.app.github.dev/',
      },
      description: `Пополнение баланса Thalor VPN (tg: ${tgUser.id})`,
      metadata: { telegram_id: tgUser.id },
    });

    db.prepare(`
      INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status)
      VALUES (?, ?, ?, 'pending')
    `).run(payment.id, tgUser.id, numAmount);

    res.json({
      ok: true,
      payment_id: payment.id,
      confirmation_url: payment.confirmation.confirmation_url,
    });
  } catch (e) {
    console.error('YooKassa error:', e?.message || e);
    res.status(500).json({ ok: false, error: 'payment_creation_failed' });
  }
});

// --- Вебхук от ЮKassa ---
app.post('/api/payment/webhook', (req, res) => {
  const event = req.body;
  console.log('📩 ЮKassa webhook:', event?.event, event?.object?.id);

  if (event?.event !== 'payment.succeeded') {
    return res.status(200).json({ ok: true });
  }

  const payment = event.object;
  const paymentId = payment.id;
  const tgId = Number(payment.metadata?.telegram_id);
  const amount = Number(payment.amount?.value);

  if (!paymentId || !tgId || isNaN(amount)) {
    console.error('Некорректный вебхук');
    return res.status(200).json({ ok: true });
  }

  const existing = db.prepare('SELECT status FROM payments WHERE payment_id = ?').get(paymentId);
  if (existing && existing.status === 'succeeded') {
    console.log('Платёж уже обработан:', paymentId);
    return res.status(200).json({ ok: true });
  }

  try {
    const trx = db.transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status)
        VALUES (?, ?, ?, 'succeeded')
      `).run(paymentId, tgId, amount);

      ensureUser(tgId);
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?')
        .run(amount, tgId);
    });
    trx();

    console.log(`✅ Зачислено ${amount} ₽ пользователю ${tgId}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Ошибка зачисления:', e.message);
    res.status(500).json({ ok: false });
  }
});

// --- Ручная проверка статуса платежа (на случай, если вебхук не сработал) ---
app.post('/api/payment/check', async (req, res) => {
  const { initData, payment_id } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });
  if (!payment_id) return res.status(400).json({ ok: false, error: 'no_payment_id' });

  try {
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
    const { data: payment } = await axios.get(
      `https://api.yookassa.ru/v3/payments/${payment_id}`,
      { headers: { Authorization: `Basic ${auth}` } }
    );

    if (payment.status !== 'succeeded') {
      return res.json({ ok: true, status: payment.status, balance: ensureUser(tgUser.id).balance });
    }

    const tgIdFromPayment = Number(payment.metadata?.telegram_id);
    if (tgIdFromPayment !== tgUser.id) {
      return res.status(403).json({ ok: false, error: 'payment_belongs_to_another_user' });
    }

    const existing = db.prepare('SELECT status FROM payments WHERE payment_id = ?').get(payment_id);
    if (existing && existing.status === 'succeeded') {
      return res.json({ ok: true, status: 'already_credited', balance: ensureUser(tgUser.id).balance });
    }

    const amount = Number(payment.amount?.value);
    const trx = db.transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO payments (payment_id, telegram_id, amount, status)
        VALUES (?, ?, ?, 'succeeded')
      `).run(payment_id, tgUser.id, amount);

      ensureUser(tgUser.id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?')
        .run(amount, tgUser.id);
    });
    trx();

    console.log(`✅ (check) Зачислено ${amount} ₽ пользователю ${tgUser.id}`);
    res.json({ ok: true, status: 'credited', balance: ensureUser(tgUser.id).balance });
  } catch (e) {
    console.error('/api/payment/check error:', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: 'check_failed' });
  }
});

// --- Баланс ---
app.post('/api/balance', (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const userRow = ensureUser(tgUser.id);
  res.json({ ok: true, balance: userRow.balance });
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'thalor-vpn-backend' }));

app.listen(PORT, () => {
  console.log(`✅ Backend запущен: http://localhost:${PORT}`);
  console.log(`   Панель H1: ${H1CLOUD_PANEL_URL}`);
  console.log(`   ЮKassa Shop ID: ${YOOKASSA_SHOP_ID}`);
});