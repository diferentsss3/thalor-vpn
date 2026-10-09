'use client';

import { useEffect, useRef, useState, createContext, useContext } from 'react';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';

type Tab = 'home' | 'tariffs' | 'profile' | 'admin';
type AdminTab = 'stats' | 'tariffs' | 'promos' | 'referral';
type ToastType = 'success' | 'error' | 'info';

const BACKEND = process.env.NODE_ENV === 'production'
  ? 'https://ВАШ-BACKEND.onrender.com'
  : '/api-proxy';

const C = {
  bg: '#17191d',
  card: '#1e2126',
  inner: '#26292f',
  border: '#2e3238',
  text: '#e5e7eb',
  textMuted: '#9ca3af',
  textDim: '#6b7280',
  accent: '#94a3b8',
  accentSoft: 'rgba(148,163,184,0.15)',
  success: '#6ee7b7',
  successSoft: 'rgba(110,231,183,0.12)',
  danger: '#fca5a5',
  dangerSoft: 'rgba(252,165,165,0.12)',
};

// Безопасный доступ к Telegram SDK
let _webApp: any = null;
async function loadWebApp() {
  if (_webApp) return _webApp;
  if (typeof window === 'undefined') return null;
  try {
    const mod = await import('@twa-dev/sdk');
    _webApp = mod.default;
    return _webApp;
  } catch (e) {
    console.log('Telegram SDK не загрузился');
    return null;
  }
}

const WebApp: any = new Proxy({}, {
  get(_t, prop) {
    if (_webApp && prop in _webApp) {
      const val = _webApp[prop];
      return typeof val === 'function' ? val.bind(_webApp) : val;
    }
    if (prop === 'initData') return '';
    if (prop === 'ready' || prop === 'expand') return () => {};
    if (prop === 'openLink' || prop === 'openTelegramLink') {
      return (url: string) => { if (typeof window !== 'undefined') window.open(url, '_blank'); };
    }
    if (prop === 'showAlert') return (msg: string) => { if (typeof window !== 'undefined') alert(msg); };
    return undefined;
  },
});

const ToastCtx = createContext<any>(null);
const useToast = () => useContext(ToastCtx);

function ToastProvider({ children }: any) {
  const [toasts, setToasts] = useState<any[]>([]);

  const show = (message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };

  const icons: Record<ToastType, string> = { success: '✓', error: '✕', info: 'ℹ' };
  const styles: Record<ToastType, { bg: string; border: string; color: string }> = {
    success: { bg: C.successSoft, border: 'rgba(110,231,183,0.35)', color: C.success },
    error:   { bg: C.dangerSoft,  border: 'rgba(252,165,165,0.35)', color: C.danger },
    info:    { bg: C.accentSoft,  border: 'rgba(148,163,184,0.35)', color: C.accent },
  };

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t: { id: number; message: string; type: ToastType }) => {
          const s = styles[t.type];
          return (
            <div key={t.id}
              className="pointer-events-auto max-w-md w-full rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl animate-slide-down"
              style={{ background: s.bg, border: `1px solid ${s.border}`, backdropFilter: 'blur(12px)' }}>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ background: s.color, color: C.bg }}>{icons[t.type]}</span>
              <p className="text-sm flex-1" style={{ color: s.color }}>{t.message}</p>
            </div>
          );
        })}
      </div>
      <style jsx global>{`
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down { animation: slide-down 0.3s ease-out; }
        html, body { background: ${C.bg}; color: ${C.text}; }
      `}</style>
    </ToastCtx.Provider>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}

function App() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [tariffs, setTariffs] = useState<any[]>([]);

  const refreshUser = () => {
    const initData = WebApp.initData || '';
    return axios.post(`${BACKEND}/api/user`, { initData })
      .then((res) => { if (res.data.ok) setData(res.data); else setError(res.data.error); })
      .catch(() => setError('Не удалось подключиться к backend'))
      .finally(() => setLoading(false));
  };

  const refreshTariffs = () => axios.get(`${BACKEND}/api/tariffs`).then((res) => { if (res.data.ok) setTariffs(res.data.tariffs); });

  useEffect(() => {
    loadWebApp().then((sdk) => {
      if (sdk) {
        try { sdk.ready(); sdk.expand(); } catch (e) {}
      }
      refreshUser();
    });
    refreshTariffs();

    const checkPendingPayment = () => {
      const paymentId = localStorage.getItem('pending_payment_id');
      if (!paymentId) return;
      const initData = WebApp.initData || '';
      axios.post(`${BACKEND}/api/payment/check`, { initData, payment_id: paymentId })
        .then((res) => {
          if (res.data.ok && (res.data.status === 'credited' || res.data.status === 'already_credited')) {
            toast?.show(`Баланс пополнен: ${res.data.balance} ₽`, 'success');
            localStorage.removeItem('pending_payment_id');
            refreshUser();
          }
        })
        .catch(() => {});
    };
    checkPendingPayment();
    const onVis = () => { if (document.visibilityState === 'visible') checkPendingPayment(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (loading) return <Skeleton />;
  if (error || !data) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.bg, color: C.text }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: C.dangerSoft, border: `1px solid rgba(252,165,165,0.3)` }}>
        <span className="text-3xl">⚠️</span>
      </div>
      <p className="font-medium mb-2" style={{ color: C.danger }}>Ошибка</p>
      <p className="text-sm" style={{ color: C.textDim }}>{error || 'Нет данных'}</p>
    </div>
  );

  const isAdmin = !!data.isAdmin;

  return (
    <div className="min-h-screen font-sans pb-24" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-md mx-auto">
        <header className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}>T</div>
            <span className="font-semibold text-[15px]" style={{ color: '#f3f4f6' }}>Thalor VPN</span>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full"
            style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}` }}>Mini App</span>
        </header>

        <main className="px-4 pt-1">
          {tab === 'home' && <HomeTab data={data} />}
          {tab === 'tariffs' && <TariffsTab data={data} tariffs={tariffs} onRefresh={refreshUser} />}
          {tab === 'profile' && <ProfileTab data={data} onRefresh={refreshUser} />}
          {tab === 'admin' && <AdminTab onTariffsChanged={refreshTariffs} />}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40"
        style={{ background: 'rgba(30,33,38,0.95)', borderTop: `1px solid ${C.border}`, backdropFilter: 'blur(16px)' }}>
        <div className="max-w-md mx-auto flex justify-around py-2">
          <NavBtn active={tab === 'home'} onClick={() => setTab('home')} icon="🏠" label="Главная" />
          <NavBtn active={tab === 'tariffs'} onClick={() => setTab('tariffs')} icon="💎" label="Тарифы" />
          <NavBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon="👤" label="Профиль" />
          {isAdmin && <NavBtn active={tab === 'admin'} onClick={() => setTab('admin')} icon="⚙️" label="Админ" />}
        </div>
      </nav>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl animate-pulse" style={{ background: C.card }} />
        <div className="w-24 h-3 rounded-full animate-pulse" style={{ background: C.card }} />
      </div>
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center px-3 py-1.5 rounded-xl transition-all duration-200 ${active ? 'scale-105' : ''}`}
      style={{ color: active ? '#e5e7eb' : C.textDim }}>
      <span className="text-lg" style={{ filter: active ? 'none' : 'grayscale(0.6)', opacity: active ? 1 : 0.75 }}>{icon}</span>
      <span className="text-[10px] mt-0.5 font-medium">{label}</span>
    </button>
  );
}

function Card({ children, className = '', style = {} }: any) {
  return (
    <div className={`rounded-2xl p-4 ${className}`}
      style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset', ...style }}>
      {children}
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><p className="text-[11px] mb-1.5 font-medium" style={{ color: C.textMuted }}>{label}</p>{children}</div>;
}

function HomeTab({ data }: any) {
  const { subscription, referralLink } = data;
  const [showQR, setShowQR] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const trafficPercent = subscription.trafficTotal ? Math.min(100, (subscription.trafficUsed / subscription.trafficTotal) * 100) : 0;
  const daysPercent = Math.min(100, (subscription.daysLeft / 30) * 100);
  const radius = 34;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - daysPercent / 100);
  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString('ru-RU') : '—';

  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'thalor-vpn-subscription.png';
    a.click();
  };

  const inviteFriend = () => {
    if (!referralLink) return;
    WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Подключись к Thalor VPN 🔒')}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: '84px', height: '84px' }}>
            <svg width="84" height="84" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r={radius} stroke={C.border} strokeWidth="7" fill="none" />
              <circle cx="40" cy="40" r={radius} stroke="url(#g1)" strokeWidth="7" fill="none"
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
              <defs>
                <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#9ca3af" />
                  <stop offset="100%" stopColor="#4b5563" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none" style={{ color: '#f3f4f6' }}>{subscription.daysLeft}</span>
              <span className="text-[10px] mt-1" style={{ color: C.textMuted }}>дней</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex justify-end">
              {subscription.isActive
                ? <span className="text-[10px] font-medium px-2.5 py-1 rounded-full" style={{ background: C.successSoft, color: C.success, border: `1px solid rgba(110,231,183,0.25)` }}>● АКТИВНА</span>
                : <span className="text-[10px] font-medium px-2.5 py-1 rounded-full" style={{ background: C.dangerSoft, color: C.danger, border: `1px solid rgba(252,165,165,0.25)` }}>● НЕАКТИВНА</span>}
            </div>
            <p className="text-sm mt-2 text-right" style={{ color: C.textMuted }}>до {expiresAt}</p>
            <div className="w-full rounded-full h-1.5 mt-3 overflow-hidden" style={{ background: C.inner }}>
              <div className="h-1.5 rounded-full transition-all"
                style={{ width: `${trafficPercent}%`, background: 'linear-gradient(90deg, #6b7280, #9ca3af)' }} />
            </div>
            <p className="text-[11px] mt-1.5 text-right" style={{ color: C.textDim }}>
              {subscription.trafficUsed} / {subscription.trafficTotal} ГБ
            </p>
          </div>
        </div>
      </Card>

      <div>
        <p className="text-[11px] uppercase tracking-wider mb-2 px-1 font-medium" style={{ color: C.textDim }}>Моя подписка</p>
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.success }} />
            <span className="font-medium text-sm" style={{ color: C.text }}>Единая подписка</span>
          </div>
          <p className="text-[11px] truncate mb-4 px-3 py-2 rounded-lg font-mono"
            style={{ background: C.inner, color: C.accent, border: `1px solid ${C.border}` }}>{subscription.subscriptionUrl || '—'}</p>
          <button onClick={() => { navigator.clipboard.writeText(subscription.subscriptionUrl); }}
            className="w-full font-medium py-3 rounded-xl transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            Копировать ссылку
          </button>
          <button onClick={() => setShowQR(true)}
            className="w-full mt-2 py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
            style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>
            📱 Показать QR-код
          </button>
        </Card>
      </div>

      <button onClick={inviteFriend}
        className="w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-all active:scale-[0.98]"
        style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <span className="text-2xl">🎁</span>
        <div className="flex-1">
          <p className="font-medium text-sm" style={{ color: C.accent }}>Пригласи друга</p>
          <p className="text-xs mt-0.5" style={{ color: C.textDim }}>Поделись ссылкой и получи бонус</p>
        </div>
        <span className="text-lg" style={{ color: C.textDim }}>›</span>
      </button>

      {showQR && (
        <div onClick={() => setShowQR(false)}
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
          <div onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-6 w-full max-w-sm animate-slide-down"
            style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p className="text-center font-semibold mb-4" style={{ color: C.text }}>QR-код подписки</p>
            <div className="flex justify-center" ref={qrRef}>
              <div className="bg-white p-3 rounded-xl">
                <QRCodeCanvas value={subscription.subscriptionUrl || 'no-url'} size={220} level="M" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowQR(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium" style={{ background: C.inner, color: C.text }}>Закрыть</button>
              <button onClick={downloadQR}
                className="flex-1 py-3 rounded-xl text-sm font-medium"
                style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb' }}>Скачать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TariffsTab({ data, tariffs, onRefresh }: any) {
  const toast = useToast();
  const { subscription, balance } = data;
  const [loadingTariff, setLoadingTariff] = useState<string | null>(null);
  const [activePromo, setActivePromo] = useState<any>(null);

  useEffect(() => {
    if (data.activePromo) setActivePromo(data.activePromo);
  }, [data]);

  const calcFinalPrice = (price: number) => {
    if (!activePromo) return price;
    if (activePromo.type === 'discount_percent') return Math.max(0, Math.round((price - price * activePromo.value / 100) * 100) / 100);
    if (activePromo.type === 'discount_fixed') return Math.max(0, price - activePromo.value);
    return price;
  };

  const handleBuy = async (tariffId: string) => {
    setLoadingTariff(tariffId);
    try {
      const initData = WebApp.initData || '';
      const res = await axios.post(`${BACKEND}/api/subscription/extend`, { initData, tariff_id: tariffId });
      if (res.data.ok) { toast?.show(res.data.message || 'Подписка продлена', 'success'); onRefresh(); }
      else if (res.data.error === 'insufficient_balance') toast?.show(`Нужно ${res.data.required} ₽, у вас ${res.data.balance} ₽`, 'error');
      else toast?.show('Ошибка: ' + (res.data.error || 'неизвестная'), 'error');
    } catch (e) { toast?.show('Не удалось продлить подписку', 'error'); }
    finally { setLoadingTariff(null); }
  };

  return (
    <div className="space-y-3 pt-2">
      <Card>
        <div className="flex justify-between">
          <div>
            <p className="text-[11px] font-medium" style={{ color: C.textMuted }}>Дней осталось</p>
            <p className="text-2xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{subscription.daysLeft}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium" style={{ color: C.textMuted }}>Баланс</p>
            <p className="text-2xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{balance} ₽</p>
          </div>
        </div>
      </Card>

      {tariffs.filter((t: any) => t.is_active).map((t: any) => {
        const finalPrice = calcFinalPrice(t.price);
        const hasDiscount = finalPrice < t.price;
        return (
          <Card key={t.id} style={t.badge ? { border: `1px solid ${C.accent}` } : {}}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-base" style={{ color: C.text }}>{t.label}</p>
                <div className="flex items-center gap-2 mt-1">
                  {hasDiscount ? (
                    <>
                      <p className="font-bold" style={{ color: C.success }}>{finalPrice} ₽</p>
                      <p className="text-xs line-through" style={{ color: C.textDim }}>{t.price} ₽</p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: C.textMuted }}>{t.price} ₽</p>
                  )}
                  {t.old_price && !hasDiscount && <p className="text-xs line-through" style={{ color: C.textDim }}>{t.old_price} ₽</p>}
                </div>
                {hasDiscount && <p className="text-[10px] mt-1" style={{ color: C.success }}>🎟 применён промокод</p>}
              </div>
              <div className="flex items-center gap-2">
                {t.badge && (
                  <span className="text-[10px] px-2 py-1 rounded-full"
                    style={{ background: C.accentSoft, color: C.accent, border: `1px solid rgba(148,163,184,0.25)` }}>{t.badge}</span>
                )}
                <button onClick={() => handleBuy(t.id)} disabled={loadingTariff === t.id}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                  {loadingTariff === t.id ? '...' : 'Купить'}
                </button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ProfileTab({ data, onRefresh }: any) {
  const toast = useToast();
  const { user, subscription, balance } = data;
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [amount, setAmount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [activePromo, setActivePromo] = useState<any>(null);
  const [referral, setReferral] = useState<any>(null);
  const [loadingRef, setLoadingRef] = useState(true);

  useEffect(() => {
    const initData = WebApp.initData || '';
    axios.post(`${BACKEND}/api/referral/info`, { initData })
      .then((res) => { if (res.data.ok) setReferral(res.data); })
      .finally(() => setLoadingRef(false));
  }, []);

  const parsedAmount = Number(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 100000;

  const handleTopUp = async () => {
    if (!isValidAmount) return toast?.show('Введите сумму от 1 до 100 000 ₽', 'error');
    setLoadingPayment(true);
    try {
      const initData = WebApp.initData || '';
      const res = await axios.post(`${BACKEND}/api/payment/create`, { initData, amount: parsedAmount });
      if (res.data.ok) { localStorage.setItem('pending_payment_id', res.data.payment_id); WebApp.openLink(res.data.confirmation_url); }
      else toast?.show('Ошибка: ' + res.data.error, 'error');
    } catch (e) { toast?.show('Не удалось создать платёж', 'error'); }
    finally { setLoadingPayment(false); }
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return toast?.show('Введите промокод', 'error');
    setPromoLoading(true);
    try {
      const initData = WebApp.initData || '';
      const res = await axios.post(`${BACKEND}/api/promo/apply`, { initData, code: promoCode.trim().toUpperCase() });
      if (res.data.ok) {
        setActivePromo(res.data.promo);
        toast?.show(`Промокод активирован: ${res.data.promo.label}`, 'success');
        setPromoCode('');
      } else {
        const errors: Record<string, string> = {
          not_found: 'Промокод не найден', inactive: 'Промокод неактивен',
          expired: 'Срок действия истёк', limit_reached: 'Лимит исчерпан',
          already_used: 'Вы уже использовали этот промокод',
        };
        toast?.show(errors[res.data.error] || 'Ошибка', 'error');
      }
    } catch (e) { toast?.show('Не удалось применить промокод', 'error'); }
    finally { setPromoLoading(false); }
  };

  const handleCancelPromo = async () => {
    const initData = WebApp.initData || '';
    const res = await axios.post(`${BACKEND}/api/promo/cancel`, { initData });
    if (res.data.ok) { setActivePromo(null); toast?.show('Промокод отменён', 'info'); }
  };

  const shareReferral = () => {
    if (!referral?.link) return;
    WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referral.link)}&text=${encodeURIComponent('Подключись к Thalor VPN 🔒')}`);
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold"
          style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}>
          {user.name[0]}
        </div>
        <div>
          <p className="font-bold" style={{ color: C.text }}>{user.name}</p>
          <p className="text-xs mt-0.5" style={{ color: C.textDim }}>id{user.telegramId}</p>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium" style={{ color: C.textMuted }}>Баланс</p>
          <button onClick={onRefresh} className="text-xs" style={{ color: C.accent }}>↻ Обновить</button>
        </div>
        <p className="text-2xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{balance} ₽</p>
        <p className="text-[11px] font-medium mt-4 mb-2" style={{ color: C.textMuted }}>Сумма пополнения</p>
        <div className="flex gap-2">
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" min={1} max={100000}
            className="flex-1 rounded-xl px-4 py-3 outline-none transition-all"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          <button onClick={handleTopUp} disabled={loadingPayment || !isValidAmount}
            className="font-medium px-5 rounded-xl disabled:opacity-50 transition-all active:scale-[0.97]"
            style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            {loadingPayment ? '...' : 'Пополнить'}
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          {[100, 300, 500, 1000].map((s) => (
            <button key={s} onClick={() => setAmount(String(s))}
              className="flex-1 py-2 rounded-xl text-xs transition-all active:scale-[0.95]"
              style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>{s} ₽</button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="text-[11px] font-medium mb-2" style={{ color: C.textMuted }}>🎟 Промокод</p>
        {activePromo ? (
          <div className="rounded-xl p-3" style={{ background: C.successSoft, border: `1px solid rgba(110,231,183,0.3)` }}>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-sm" style={{ color: C.success }}>✅ {activePromo.label}</p>
                <p className="text-xs mt-1" style={{ color: C.textDim }}>Применится при следующей покупке</p>
              </div>
              <button onClick={handleCancelPromo} className="text-xs shrink-0 ml-2" style={{ color: C.danger }}>Отменить</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Введите код"
              className="flex-1 rounded-xl px-4 py-3 outline-none font-mono tracking-wider transition-all"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
            <button onClick={handleApplyPromo} disabled={promoLoading || !promoCode.trim()}
              className="font-medium px-5 rounded-xl disabled:opacity-50 transition-all active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
              {promoLoading ? '...' : 'Применить'}
            </button>
          </div>
        )}
      </Card>

      <Card>
        <p className="text-[11px] font-medium mb-3" style={{ color: C.textMuted }}>🎁 Реферальная программа</p>
        {loadingRef ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 rounded" style={{ background: C.inner }} />
            <div className="h-4 w-2/3 rounded" style={{ background: C.inner }} />
          </div>
        ) : referral ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="text-[11px]" style={{ color: C.textMuted }}>Приглашено</p>
                <p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{referral.invitedCount}</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: C.textMuted }}>Бонус за друга</p>
                <p className="text-xl font-bold mt-1" style={{ color: C.success }}>
                  +{referral.currentBonus.days}д{referral.currentBonus.balance > 0 ? ` / +${referral.currentBonus.balance}₽` : ''}
                </p>
              </div>
            </div>
            <button onClick={shareReferral}
              className="w-full font-medium py-3 rounded-xl mb-2 transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
              Поделиться ссылкой
            </button>
            <button onClick={() => { navigator.clipboard.writeText(referral.link); }}
              className="w-full py-2.5 rounded-xl text-xs"
              style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>
              📋 Копировать ссылку
            </button>
            <p className="text-[10px] mt-2 break-all px-2 py-1.5 rounded-lg"
              style={{ background: C.inner, color: C.accent, border: `1px solid ${C.border}` }}>{referral.link}</p>
            {referral.invited?.length > 0 && (
              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                <p className="text-[11px] mb-2" style={{ color: C.textMuted }}>Мои приглашения</p>
                <div className="space-y-2">
                  {referral.invited.slice(0, 5).map((r: any) => (
                    <div key={r.telegramId} className="flex justify-between text-xs">
                      <span className="font-mono" style={{ color: C.textMuted }}>id{r.telegramId}</span>
                      <span style={{ color: C.success }}>+{r.bonusDays}д{r.bonusBalance > 0 ? ` / +${r.bonusBalance}₽` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[11px]" style={{ color: C.textMuted }}>Устройств</p>
          <p className="text-2xl font-bold mt-1" style={{ color: '#f3f4f6' }}>
            {subscription.devicesCount} <span className="text-base" style={{ color: C.textDim }}>/ {subscription.deviceLimit}</span>
          </p>
        </Card>
        <Card>
          <p className="text-[11px]" style={{ color: C.textMuted }}>Дней осталось</p>
          <p className="text-2xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{subscription.daysLeft}</p>
        </Card>
      </div>

      {subscription.devices?.length > 0 && (
        <Card>
          <p className="text-[11px] font-medium mb-3" style={{ color: C.textMuted }}>Подключённые устройства</p>
          <div className="space-y-3">
            {subscription.devices.map((d: any, i: number) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <div>
                  <p className="font-medium text-sm" style={{ color: C.text }}>{d.model || 'Устройство'}</p>
                  <p className="text-xs" style={{ color: C.textDim }}>{d.os} {d.osVersion}</p>
                </div>
                <span className="text-xs font-mono" style={{ color: C.textMuted }}>{d.ip || '—'}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AdminTab({ onTariffsChanged }: any) {
  const [subTab, setSubTab] = useState<AdminTab>('stats');
  return (
    <div className="space-y-4 pt-2">
      <div className="flex rounded-xl p-1 gap-1" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        {[
          { id: 'stats', label: '📊' },
          { id: 'tariffs', label: '💎' },
          { id: 'promos', label: '🎟' },
          { id: 'referral', label: '🎁' },
        ].map((t) => (
          <button key={t.id} onClick={() => setSubTab(t.id as AdminTab)}
            className={`flex-1 py-2 rounded-lg text-xs transition-all ${subTab === t.id ? 'shadow-lg' : ''}`}
            style={{
              background: subTab === t.id ? 'linear-gradient(135deg, #4b5563, #374151)' : 'transparent',
              color: subTab === t.id ? '#f9fafb' : C.textMuted,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'stats' && <AdminStats />}
      {subTab === 'tariffs' && <AdminTariffs onChanged={onTariffsChanged} />}
      {subTab === 'promos' && <AdminPromos />}
      {subTab === 'referral' && <AdminReferral />}
    </div>
  );
}

function AdminStats() {
  const [stats, setStats] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClients, setShowClients] = useState(false);

  const loadAll = () => {
    setLoading(true);
    const initData = WebApp.initData || '';
    Promise.all([
      axios.post(`${BACKEND}/api/admin/stats`, { initData }),
      axios.post(`${BACKEND}/api/admin/clients`, { initData }),
    ])
      .then(([s, c]) => { if (s.data.ok) setStats(s.data); if (c.data.ok) setClients(c.data.clients || []); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  if (loading) return <div className="text-center pt-10" style={{ color: C.textDim }}>Загрузка...</div>;
  if (!stats) return null;
  const { panel, miniApp } = stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider font-medium" style={{ color: C.textDim }}>Панель H1Cloud</p>
        <button onClick={loadAll} className="text-xs" style={{ color: C.accent }}>↻</button>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Всего клиентов</p><p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{panel.totalClients}</p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Активных</p><p className="text-xl font-bold mt-1" style={{ color: C.success }}>{panel.activeClients}</p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Забанено</p><p className="text-xl font-bold mt-1" style={{ color: C.danger }}>{panel.bannedClients}</p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Онлайн</p><p className="text-xl font-bold mt-1" style={{ color: C.accent }}>{panel.onlineClients}</p></div>
          <div className="col-span-2"><p className="text-[11px]" style={{ color: C.textMuted }}>Трафик всего</p><p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{panel.totalTrafficUsedGB} ГБ</p></div>
        </div>
      </Card>
      <Card>
        <p className="text-[11px] font-medium mb-3" style={{ color: C.textMuted }}>Mini App</p>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Пользователей</p><p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{miniApp.usersCount}</p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Балансы</p><p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{miniApp.totalBalance} ₽</p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Платежей</p><p className="text-xl font-bold mt-1" style={{ color: '#f3f4f6' }}>{miniApp.totalPaymentsCount} <span className="text-sm" style={{ color: C.textDim }}>· {miniApp.totalPaymentsSum}₽</span></p></div>
          <div><p className="text-[11px]" style={{ color: C.textMuted }}>Рефералов</p><p className="text-xl font-bold mt-1" style={{ color: C.accent }}>{miniApp.totalReferrals}</p></div>
          <div className="col-span-2"><p className="text-[11px]" style={{ color: C.textMuted }}>Промокодов использовано</p><p className="text-xl font-bold mt-1" style={{ color: C.success }}>{miniApp.promoUsed}</p></div>
        </div>
      </Card>
      <button onClick={() => setShowClients((v) => !v)} className="w-full py-3 rounded-xl text-sm"
        style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>
        {showClients ? 'Скрыть' : `Показать клиентов (${clients.length})`}
      </button>
      {showClients && (
        <Card>
          <div className="space-y-2">
            {clients.map((c: any) => (
              <div key={c.uuid || c.name} className="flex justify-between items-center text-sm pb-2"
                style={{ borderBottom: `1px solid ${C.border}` }}>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs truncate" style={{ color: C.text }}>{c.name}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{c.daysLeft}д · {c.trafficUsed.toFixed(1)}/{c.trafficLimit} ГБ</p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full ml-2 shrink-0"
                  style={{
                    background: C.inner,
                    color: c.banned ? C.danger : c.online ? C.accent : C.success,
                    border: `1px solid ${C.border}`,
                  }}>
                  {c.banned ? 'BAN' : c.online ? 'ON' : 'OK'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AdminReferral() {
  const toast = useToast();
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initData = WebApp.initData || '';
    axios.post(`${BACKEND}/api/admin/settings`, { initData }).then((res) => { if (res.data.ok) setSettings(res.data.settings); });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const initData = WebApp.initData || '';
      const res = await axios.post(`${BACKEND}/api/admin/settings/update`, { initData, settings });
      if (res.data.ok) { setSettings(res.data.settings); toast?.show('Настройки сохранены', 'success'); }
    } finally { setSaving(false); }
  };

  if (!settings) return <div className="text-center pt-10" style={{ color: C.textDim }}>Загрузка...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[11px] font-medium mb-3" style={{ color: C.textMuted }}>Реферальный бонус</p>
        <p className="text-[11px] mb-4" style={{ color: C.textDim }}>Оба получают одинаковый бонус при первом заходе приглашённого.</p>
        <div className="space-y-3">
          <Field label="Бонус дней">
            <input type="number" min={0} value={settings.referral_bonus_days}
              onChange={(e) => setSettings({ ...settings, referral_bonus_days: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
          <Field label="Бонус ₽ на баланс">
            <input type="number" min={0} value={settings.referral_bonus_balance}
              onChange={(e) => setSettings({ ...settings, referral_bonus_balance: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
        </div>
      </Card>
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-xl text-sm font-medium disabled:opacity-50 transition-all active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  );
}

function AdminTariffs({ onChanged }: any) {
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    const initData = WebApp.initData || '';
    axios.post(`${BACKEND}/api/admin/tariffs`, { initData })
      .then((res) => { if (res.data.ok) setTariffs(res.data.tariffs); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async (tariff: any, isNew: boolean) => {
    const initData = WebApp.initData || '';
    const url = isNew ? '/api/admin/tariffs/create' : '/api/admin/tariffs/update';
    const res = await axios.post(`${BACKEND}${url}`, { initData, tariff });
    if (res.data.ok) { setTariffs(res.data.tariffs); setEditing(null); setCreating(false); onChanged?.(); }
  };

  const remove = async (id: string) => {
    if (!confirm(`Удалить тариф ${id}?`)) return;
    const initData = WebApp.initData || '';
    const res = await axios.post(`${BACKEND}/api/admin/tariffs/delete`, { initData, id });
    if (res.data.ok) { setTariffs(res.data.tariffs); onChanged?.(); }
  };

  if (loading) return <div className="text-center pt-10" style={{ color: C.textDim }}>Загрузка...</div>;

  return (
    <div className="space-y-3">
      <button onClick={() => setCreating(true)}
        className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        + Создать тариф
      </button>
      {tariffs.map((t) => (
        <Card key={t.id}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium" style={{ color: C.text }}>{t.label}</p>
                {!t.is_active && <span className="text-[10px]" style={{ color: C.danger }}>OFF</span>}
              </div>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>ID: {t.id} · {t.days}д · {t.price} ₽{t.old_price ? ` (было ${t.old_price})` : ''}</p>
              {t.badge && <p className="text-xs mt-0.5" style={{ color: C.textDim }}>Плашка: {t.badge}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setEditing(t)} className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>✎</button>
              <button onClick={() => remove(t.id)} className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: C.inner, color: C.danger, border: `1px solid ${C.border}` }}>🗑</button>
            </div>
          </div>
        </Card>
      ))}
      {(editing || creating) && (
        <TariffEditor
          initial={editing || { id: '', label: '', days: 30, price: 100, old_price: null, badge: '', is_active: 1, sort_order: 99 }}
          isNew={creating}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSave={(t: any) => save(t, creating)} />
      )}
    </div>
  );
}

function TariffEditor({ initial, isNew, onCancel, onSave }: any) {
  const [t, setT] = useState<any>({ ...initial });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="rounded-2xl p-5 w-full max-w-sm my-8 animate-slide-down"
        style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p className="font-semibold mb-4" style={{ color: C.text }}>{isNew ? 'Новый тариф' : 'Редактирование'}</p>
        <div className="space-y-3">
          <Field label="ID"><input value={t.id} disabled={!isNew}
            onChange={(e) => setT({ ...t, id: e.target.value.replace(/[^a-z0-9_]/gi, '') })}
            className="w-full rounded-xl px-3 py-2.5 outline-none disabled:opacity-50"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Название"><input value={t.label}
            onChange={(e) => setT({ ...t, label: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Дней"><input type="number" value={t.days}
            onChange={(e) => setT({ ...t, days: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Цена ₽"><input type="number" value={t.price}
            onChange={(e) => setT({ ...t, price: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Старая цена"><input type="number" value={t.old_price || ''}
            onChange={(e) => setT({ ...t, old_price: e.target.value || null })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Плашка"><input value={t.badge || ''}
            onChange={(e) => setT({ ...t, badge: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <Field label="Сортировка"><input type="number" value={t.sort_order}
            onChange={(e) => setT({ ...t, sort_order: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} /></Field>
          <label className="flex items-center gap-2 text-sm" style={{ color: C.text }}>
            <input type="checkbox" checked={!!t.is_active}
              onChange={(e) => setT({ ...t, is_active: e.target.checked ? 1 : 0 })} />
            Активен
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>Отмена</button>
          <button onClick={() => onSave(t)} className="flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb' }}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function AdminPromos() {
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    const initData = WebApp.initData || '';
    axios.post(`${BACKEND}/api/admin/promos`, { initData })
      .then((res) => { if (res.data.ok) setPromos(res.data.promos); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const create = async (promo: any) => {
    const initData = WebApp.initData || '';
    const res = await axios.post(`${BACKEND}/api/admin/promos/create`, { initData, promo });
    if (res.data.ok) { setPromos(res.data.promos); setCreating(false); }
  };

  const toggle = async (code: string) => {
    const initData = WebApp.initData || '';
    const res = await axios.post(`${BACKEND}/api/admin/promos/toggle`, { initData, code });
    if (res.data.ok) setPromos(res.data.promos);
  };

  const remove = async (code: string) => {
    if (!confirm(`Удалить промокод ${code}?`)) return;
    const initData = WebApp.initData || '';
    const res = await axios.post(`${BACKEND}/api/admin/promos/delete`, { initData, code });
    if (res.data.ok) setPromos(res.data.promos);
  };

  if (loading) return <div className="text-center pt-10" style={{ color: C.textDim }}>Загрузка...</div>;

  return (
    <div className="space-y-3">
      <button onClick={() => setCreating(true)}
        className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        + Создать промокод
      </button>
      {promos.length === 0 && <Card><p className="text-center text-sm" style={{ color: C.textDim }}>Промокодов нет</p></Card>}
      {promos.map((p) => (
        <Card key={p.code}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-mono font-bold" style={{ color: C.accent }}>{p.code}</p>
                {!p.is_active && <span className="text-[10px]" style={{ color: C.danger }}>OFF</span>}
              </div>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>{promoLabel(p.type, p.value)}</p>
              <p className="text-xs mt-0.5" style={{ color: C.textDim }}>
                {p.max_uses > 0 ? `${p.used_count}/${p.max_uses}` : `${p.used_count} (∞)`}
                {p.expires_at ? ` · до ${new Date(p.expires_at * 1000).toLocaleDateString('ru-RU')}` : ''}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => toggle(p.code)} className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>{p.is_active ? '⏸' : '▶'}</button>
              <button onClick={() => remove(p.code)} className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: C.inner, color: C.danger, border: `1px solid ${C.border}` }}>🗑</button>
            </div>
          </div>
        </Card>
      ))}
      {creating && <PromoEditor onCancel={() => setCreating(false)} onSave={create} />}
    </div>
  );
}

function promoLabel(type: string, value: number) {
  switch (type) {
    case 'discount_percent': return `Скидка ${value}%`;
    case 'discount_fixed':   return `Скидка ${value} ₽`;
    case 'bonus_days':       return `+${value} дней`;
    case 'bonus_balance':    return `+${value} ₽`;
    default:                 return 'Промокод';
  }
}

function PromoEditor({ onCancel, onSave }: any) {
  const [p, setP] = useState<any>({ code: '', type: 'discount_percent', value: 10, max_uses: 0, expires_at: null });
  const types = [
    { id: 'discount_percent', label: 'Скидка %' },
    { id: 'discount_fixed',   label: 'Скидка ₽' },
    { id: 'bonus_days',       label: 'Бонус дней' },
    { id: 'bonus_balance',    label: 'Бонус ₽' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="rounded-2xl p-5 w-full max-w-sm my-8 animate-slide-down"
        style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p className="font-semibold mb-4" style={{ color: C.text }}>Новый промокод</p>
        <div className="space-y-3">
          <Field label="Код">
            <input value={p.code}
              onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              placeholder="SALE2026"
              className="w-full rounded-xl px-3 py-2.5 outline-none font-mono tracking-wider"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
          <Field label="Тип">
            <select value={p.type} onChange={(e) => setP({ ...p, type: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }}>
              {types.map((t) => <option key={t.id} value={t.id} style={{ background: C.card }}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Значение">
            <input type="number" value={p.value}
              onChange={(e) => setP({ ...p, value: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
          <Field label="Лимит (0 = ∞)">
            <input type="number" value={p.max_uses}
              onChange={(e) => setP({ ...p, max_uses: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
          <Field label="Действует до">
            <input type="date"
              onChange={(e) => { const v = e.target.value; setP({ ...p, expires_at: v ? Math.floor(new Date(v).getTime() / 1000) : null }); }}
              className="w-full rounded-xl px-3 py-2.5 outline-none"
              style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.text }} />
          </Field>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }}>Отмена</button>
          <button onClick={() => onSave(p)} className="flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ background: 'linear-gradient(135deg, #4b5563, #374151)', color: '#f9fafb' }}>Создать</button>
        </div>
      </div>
    </div>
  );
}