'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';

type Tab = 'home' | 'tariffs' | 'profile';

const BACKEND = '/api-proxy';

export default function Home() {
  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  const refreshUser = () => {
    const initData = WebApp.initData || '';
    return axios
      .post(`${BACKEND}/api/user`, { initData })
      .then((res) => {
        if (res.data.ok) setData(res.data);
        else setError(res.data.error || 'Неизвестная ошибка');
      })
      .catch(() => setError('Не удалось подключиться к backend'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
    } catch (e) {
      console.log('Telegram SDK не инициализирован');
    }

    refreshUser();

    const checkPendingPayment = () => {
      const paymentId = localStorage.getItem('pending_payment_id');
      if (!paymentId) return;
      const initData = WebApp.initData || '';
      axios
        .post(`${BACKEND}/api/payment/check`, { initData, payment_id: paymentId })
        .then((res) => {
          if (res.data.ok) {
            if (res.data.status === 'credited' || res.data.status === 'already_credited') {
              WebApp.showAlert(`Баланс пополнен. Текущий баланс: ${res.data.balance} ₽`);
            }
            localStorage.removeItem('pending_payment_id');
            refreshUser();
          }
        })
        .catch((e) => {
          console.error('check error:', e);
        });
    };

    // Проверяем сразу при заходе (если пользователь вернулся)
    checkPendingPayment();

    // Проверяем при возврате в окно
    const onVis = () => {
      if (document.visibilityState === 'visible') checkPendingPayment();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white"
           style={{ background: '#0f1115' }}>
        Загрузка...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white px-6 text-center"
           style={{ background: '#0f1115' }}>
        <p className="text-red-400 mb-2">Ошибка</p>
        <p className="text-sm text-gray-400">{error || 'Нет данных'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white font-sans pb-24"
         style={{ background: '#0f1115' }}>
      <div className="max-w-md mx-auto">
        <header className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-sm">
              T
            </div>
            <span className="font-semibold">Thalor VPN</span>
          </div>
          <span className="text-gray-500 text-xs">Mini App</span>
        </header>

        <main className="px-4 pt-2">
          {tab === 'home' && <HomeTab data={data} />}
          {tab === 'tariffs' && <TariffsTab data={data} />}
          {tab === 'profile' && <ProfileTab data={data} onRefresh={refreshUser} />}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 border-t flex justify-around py-2"
           style={{ background: '#151821', borderColor: '#232733' }}>
        <div className="max-w-md mx-auto flex justify-around w-full">
          <NavBtn active={tab === 'home'} onClick={() => setTab('home')} icon="🏠" label="Главная" />
          <NavBtn active={tab === 'tariffs'} onClick={() => setTab('tariffs')} icon="💎" label="Тарифы" />
          <NavBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon="👤" label="Профиль" />
        </div>
      </nav>
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center px-4 py-1 rounded-xl transition ${active ? 'text-blue-400' : 'text-gray-500'}`}>
      <span className="text-lg">{icon}</span>
      <span className="text-[11px] mt-0.5">{label}</span>
    </button>
  );
}

function HomeTab({ data }: any) {
  const { subscription } = data;
  const trafficPercent = subscription.trafficTotal
    ? Math.min(100, (subscription.trafficUsed / subscription.trafficTotal) * 100)
    : 0;
  const daysPercent = Math.min(100, (subscription.daysLeft / 30) * 100);
  const radius = 34;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - daysPercent / 100);
  const expiresAt = subscription.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString('ru-RU')
    : '—';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: '80px', height: '80px' }}>
            <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r={radius} stroke="#232733" strokeWidth="7" fill="none" />
              <circle cx="40" cy="40" r={radius} stroke="#3b82f6" strokeWidth="7" fill="none"
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold leading-none">{subscription.daysLeft}</span>
              <span className="text-[10px] text-gray-400 mt-0.5">дней</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex justify-end">
              {subscription.isActive ? (
                <span className="text-[10px] font-medium px-2 py-1 rounded-full tracking-wide"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>АКТИВНА</span>
              ) : (
                <span className="text-[10px] font-medium px-2 py-1 rounded-full tracking-wide"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>НЕАКТИВНА</span>
              )}
            </div>
            <p className="text-sm text-gray-300 mt-2 text-right">до {expiresAt}</p>
            <div className="w-full rounded-full h-1.5 mt-3" style={{ background: '#232733' }}>
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${trafficPercent}%` }} />
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 text-right">
              {subscription.trafficUsed} ГБ из {subscription.trafficTotal} ГБ
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-2 px-1">Моя подписка</p>
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="font-medium text-sm">Единая подписка</span>
          </div>
          <p className="text-blue-400 text-xs truncate mb-4">{subscription.subscriptionUrl || '—'}</p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(subscription.subscriptionUrl);
              WebApp.showAlert('Ссылка скопирована');
            }}
            className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition text-white font-medium py-3 rounded-xl">
            Копировать ссылку подписки
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: '#151821' }}>
        <span className="text-2xl">🎁</span>
        <div>
          <p className="text-blue-400 font-medium text-sm">Пригласи друга</p>
          <p className="text-gray-500 text-xs mt-0.5">+7 дней тебе и другу</p>
        </div>
      </div>
    </div>
  );
}

function TariffsTab({ data }: any) {
  const { subscription } = data;
  const tariffs = [
    { id: '30d', label: '30 дней', price: 149, badge: null as string | null },
    { id: '90d', label: '90 дней', price: 399, badge: 'выгодно' },
    { id: '1y',  label: '1 год',   price: 1290, badge: '-40%' },
  ];

  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-2xl p-4 mb-2" style={{ background: '#151821' }}>
        <p className="text-gray-500 text-xs">Осталось дней</p>
        <p className="text-2xl font-bold mt-1">{subscription.daysLeft}</p>
      </div>
      {tariffs.map((t) => (
        <div key={t.id} className="rounded-2xl p-4 flex items-center justify-between"
          style={{ background: '#151821', border: t.badge ? '1px solid #3b82f6' : '1px solid transparent' }}>
          <div>
            <p className="font-bold text-base">{t.label}</p>
            <p className="text-gray-400 text-sm mt-0.5">{t.price} ₽</p>
          </div>
          <div className="flex items-center gap-2">
            {t.badge && (
              <span className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>{t.badge}</span>
            )}
            <button
              onClick={() => WebApp.showAlert('Оплата тарифа пока в разработке. Пополните баланс в профиле.')}
              className="bg-blue-500 hover:bg-blue-600 transition px-5 py-2 rounded-xl text-sm font-medium">
              Купить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileTab({ data, onRefresh }: any) {
  const { user, subscription, balance } = data;
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [amount, setAmount] = useState('');

  const parsedAmount = Number(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 100000;

  const handleTopUp = async () => {
    if (!isValidAmount) {
      WebApp.showAlert('Введите сумму от 1 до 100 000 ₽');
      return;
    }
    setLoadingPayment(true);
    try {
      const initData = WebApp.initData || '';
      const res = await axios.post(`${BACKEND}/api/payment/create`, {
        initData,
        amount: parsedAmount,
      });
      if (res.data.ok) {
        localStorage.setItem('pending_payment_id', res.data.payment_id);
        WebApp.openLink(res.data.confirmation_url);
      } else {
        WebApp.showAlert('Ошибка: ' + res.data.error);
      }
    } catch (e: any) {
      WebApp.showAlert('Не удалось создать платёж');
    } finally {
      setLoadingPayment(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center text-xl font-bold">
          {user.name[0]}
        </div>
        <div>
          <p className="font-bold">{user.name}</p>
          <p className="text-gray-500 text-xs mt-0.5">id{user.telegramId}</p>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
        <div className="flex items-center justify-between">
          <p className="text-gray-500 text-xs">Баланс</p>
          <button onClick={onRefresh} className="text-blue-400 text-xs">Обновить</button>
        </div>
        <p className="text-2xl font-bold mt-1">{balance} ₽</p>

        <p className="text-gray-500 text-xs mt-4 mb-2">Сумма пополнения</p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Введите сумму"
            min={1}
            max={100000}
            className="flex-1 rounded-xl px-4 py-3 text-white outline-none"
            style={{ background: '#232733', border: '1px solid #2c303d' }}
          />
          <button
            onClick={handleTopUp}
            disabled={loadingPayment || !isValidAmount}
            className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition text-white font-medium px-5 rounded-xl disabled:opacity-50"
          >
            {loadingPayment ? '...' : 'Пополнить'}
          </button>
        </div>

        <div className="flex gap-2 mt-3">
          {[1, 10, 100, 500].map((s) => (
            <button
              key={s}
              onClick={() => setAmount(String(s))}
              className="flex-1 py-2 rounded-xl text-xs transition"
              style={{ background: '#232733' }}
            >
              {s} ₽
            </button>
          ))}
        </div>

        <p className="text-[10px] text-gray-500 mt-2">
          Минимум 1 ₽, максимум 100 000 ₽
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <p className="text-gray-500 text-xs">Устройств</p>
          <p className="text-2xl font-bold mt-1">{subscription.devicesCount} / {subscription.deviceLimit}</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <p className="text-gray-500 text-xs">Осталось дней</p>
          <p className="text-2xl font-bold mt-1">{subscription.daysLeft}</p>
        </div>
      </div>

      {subscription.devices?.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <p className="text-gray-500 text-xs mb-3">Подключённые устройства</p>
          <div className="space-y-3">
            {subscription.devices.map((d: any, i: number) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <div>
                  <p className="font-medium">{d.model || 'Устройство'}</p>
                  <p className="text-gray-500 text-xs">{d.os} {d.osVersion}</p>
                </div>
                <span className="text-gray-500 text-xs">{d.ip || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}