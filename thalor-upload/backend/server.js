require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = 3001,
  BOT_TOKEN,
  H1CLOUD_PANEL_URL,
  H1CLOUD_PANEL_TOKEN,
  H1CLOUD_CLIENT_PREFIX = 'tg',
} = process.env;

// Проверка подписи Telegram (initData)
function validateTelegramData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return null;
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) return null;
    const userJson = urlParams.get('user');
    return userJson ? JSON.parse(userJson) : null;
  } catch (e) {
    console.error('validateTelegramData error:', e.message);
    return null;
  }
}

// Axios-клиент для панели H1
const panel = axios.create({
  baseURL: H1CLOUD_PANEL_URL,
  headers: { Authorization: `Bearer ${H1CLOUD_PANEL_TOKEN}` },
  timeout: 15000,
});

// Получить всех клиентов и найти нужного по имени
async function findClient(clientName) {
  const { data } = await panel.get('/api/clients');
  if (!data.ok) throw new Error(data.error || 'panel_error');
  const list = data.clients || [];
  return list.find((c) => c.name === clientName) || null;
}

// Создать нового клиента
async function createClient(clientName, days = 3, gb = 5) {
  const { data } = await panel.post('/api/create', {
    name: clientName,
    days,
    traffic_limit_gb: gb,
  });
  if (!data.ok) throw new Error(data.error || 'create_failed');
  return data.client || data;
}

// Нормализуем данные клиента под наш фронтенд
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

// Эндпоинт: получить данные пользователя
app.post('/api/user', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const clientName = `${H1CLOUD_CLIENT_PREFIX}${tgUser.id}`;

  try {
    let client = await findClient(clientName);
    let created = false;

    if (!client) {
      // Автосоздание пробного клиента: 3 дня, 5 ГБ
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
      subscription: normalizeClient(client),
    });
  } catch (e) {
    console.error('/api/user error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Эндпоинт: список устройств
app.post('/api/devices', async (req, res) => {
  const { initData } = req.body;
  const tgUser = validateTelegramData(initData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid_telegram_data' });

  const clientName = `${H1CLOUD_CLIENT_PREFIX}${tgUser.id}`;
  try {
    const client = await findClient(clientName);
    if (!client) return res.json({ ok: true, devices: [] });
    const norm = normalizeClient(client);
    res.json({ ok: true, devices: norm.devices, devicesCount: norm.devicesCount, deviceLimit: norm.deviceLimit });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'thalor-vpn-backend' }));

// Отладочный эндпоинт — открыть в браузере, чтобы проверить H1Cloud
app.get('/api/debug', async (req, res) => {
  try {
    const { data } = await panel.get('/api/clients');
    res.json({
      ok: data.ok,
      panel_url: H1CLOUD_PANEL_URL,
      token_prefix: (H1CLOUD_PANEL_TOKEN || '').slice(0, 8) + '...',
      client_prefix: H1CLOUD_CLIENT_PREFIX,
      clients_count: data.clients?.length || 0,
      first_client: data.clients?.[0]
        ? {
            name: data.clients[0].name,
            left_days: data.clients[0].left_days,
            traffic_used_gb: data.clients[0].traffic_used_gb,
            traffic_limit_gb: data.clients[0].traffic_limit_gb,
            sub_url: data.clients[0].sub_url,
          }
        : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, status: e.response?.status });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend запущен: http://localhost:${PORT}`);
  console.log(`   Панель H1: ${H1CLOUD_PANEL_URL}`);
});