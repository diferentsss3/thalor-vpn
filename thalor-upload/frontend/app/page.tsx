'use client';

import { useEffect, useState } from 'react';

type Tab = 'home' | 'tariffs' | 'profile';

const MOCK_DATA = {
  user: { name: 'Иван', telegramId: 5179077308 },
  subscription: {
    isActive: true,
    daysLeft: 22,
    expiresAt: '2026-09-21',
    trafficUsed: 38,
    trafficTotal: 100,
    subscriptionUrl: 'https://p10g.h1cloud.net/sub/8a38...',
  },
  balance: 0,
  referrals: 3,
  referralLink: 'https://t.me/ThalorVPN_bot?start=ref5179',
};

export default function Home() {
  const [tab, setTab] = useState<Tab>('home');
  const [data] = useState(MOCK_DATA);

  useEffect(() => {
    // Позже здесь будет запрос к нашему бэкенду за реальными данными
  }, []);

  return (
    <div
      className="min-h-screen text-white font-sans pb-24"
      style={{ background: '#0f1115' }}
    >
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
        {tab === 'tariffs' && <TariffsTab />}
        {tab === 'profile' && <ProfileTab data={data} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 border-t flex justify-around py-2"
        style={{ background: '#151821', borderColor: '#232733' }}>
        <NavBtn active={tab === 'home'} onClick={() => setTab('home')} icon="🏠" label="Главная" />
        <NavBtn active={tab === 'tariffs'} onClick={() => setTab('tariffs')} icon="💎" label="Тарифы" />
        <NavBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon="👤" label="Профиль" />
      </nav>
    </div>
  );
}

/* ---------- КОМПОНЕНТЫ ---------- */

function NavBtn({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center px-4 py-1 rounded-xl transition ${
        active ? 'text-blue-400' : 'text-gray-500'
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-[11px] mt-0.5">{label}</span>
    </button>
  );
}

function HomeTab({ data }: any) {
  const { subscription } = data;
  const trafficPercent = Math.min(100, (subscription.trafficUsed / subscription.trafficTotal) * 100);
  const daysPercent = Math.min(100, (subscription.daysLeft / 30) * 100);

  const radius = 34;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - daysPercent / 100);

  return (
    <div className="space-y-4">
      {/* КАРТОЧКА ПОДПИСКИ */}
      <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: '80px', height: '80px' }}>
            <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r={radius} stroke="#232733" strokeWidth="7" fill="none" />
              <circle
                cx="40" cy="40" r={radius}
                stroke="#3b82f6" strokeWidth="7" fill="none"
                strokeDasharray={circ}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold leading-none">{subscription.daysLeft}</span>
              <span className="text-[10px] text-gray-400 mt-0.5">дней</span>
            </div>
          </div>

          <div className="flex-1">
            <div className="flex justify-end">
              <span className="text-[10px] font-medium px-2 py-1 rounded-full tracking-wide"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
                АКТИВНА
              </span>
            </div>
            <p className="text-sm text-gray-300 mt-2 text-right">
              до {new Date(subscription.expiresAt).toLocaleDateString('ru-RU')}
            </p>
            <div className="w-full rounded-full h-1.5 mt-3" style={{ background: '#232733' }}>
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${trafficPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 text-right">
              {subscription.trafficUsed} ГБ из {subscription.trafficTotal} ГБ
            </p>
          </div>
        </div>
      </div>

      {/* МОЯ ПОДПИСКА */}
      <div>
        <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-2 px-1">
          Моя подписка
        </p>
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="font-medium text-sm">Единая подписка</span>
          </div>
          <p className="text-blue-400 text-xs truncate mb-4">{subscription.subscriptionUrl}</p>

          <button className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition text-white font-medium py-3 rounded-xl">
            Добавить в приложение
          </button>

          <div className="flex gap-2 mt-2">
            <button className="flex-1 py-2.5 rounded-xl text-sm transition"
              style={{ background: '#232733' }}>
              Копировать
            </button>
            <button className="flex-1 py-2.5 rounded-xl text-sm transition"
              style={{ background: '#232733' }}>
              QR-код
            </button>
          </div>
        </div>
      </div>

      {/* ПРИГЛАСИ ДРУГА */}
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

function TariffsTab() {
  const tariffs = [
    { id: '30d', label: '30 дней', price: '149 ₽', badge: null as string | null },
    { id: '90d', label: '90 дней', price: '399 ₽', badge: 'выгодно' },
    { id: '1y',  label: '1 год',   price: '1290 ₽', badge: '-40%' },
  ];

  return (
    <div className="space-y-3 pt-2">
      {tariffs.map((t) => (
        <div
          key={t.id}
          className="rounded-2xl p-4 flex items-center justify-between"
          style={{
            background: '#151821',
            border: t.badge ? '1px solid #3b82f6' : '1px solid transparent',
          }}
        >
          <div>
            <p className="font-bold text-base">{t.label}</p>
            <p className="text-gray-400 text-sm mt-0.5">{t.price}</p>
          </div>
          <div className="flex items-center gap-2">
            {t.badge && (
              <span className="text-[10px] px-2 py-1 rounded-full"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
                {t.badge}
              </span>
            )}
            <button className="bg-blue-500 hover:bg-blue-600 transition px-5 py-2 rounded-xl text-sm font-medium">
              Купить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileTab({ data }: any) {
  const { user, balance, referrals, referralLink } = data;

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

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <p className="text-gray-500 text-xs">Баланс</p>
          <p className="text-2xl font-bold mt-1">{balance} ₽</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
          <p className="text-gray-500 text-xs">Приглашено</p>
          <p className="text-2xl font-bold mt-1">{referrals}</p>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: '#151821' }}>
        <p className="text-gray-500 text-xs mb-2">Реферальная ссылка</p>
        <p className="text-blue-400 font-mono text-xs break-all">{referralLink}</p>
      </div>
    </div>
  );
}