import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  MonitorPlay,
  LayoutDashboard,
  Images,
  ListVideo,
  CalendarDays,
  Monitor,
  Users,
  Package,
  ShieldCheck,
  Radio,
  LogOut,
  ChevronDown,
  Bell,
  Menu,
  X,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api, setCsrf } from './api.js';
import { Button, FormError, bytes } from './ui.jsx';
import {
  Overview,
  Library,
  Playlists,
  Screens,
  Schedules,
  Tenants,
  Packages,
  Sessions,
  BaseSignal,
  Account,
} from './Panels.jsx';

const tenantNav = [
  ['overview', 'Vista general', LayoutDashboard],
  ['library', 'Biblioteca', Images],
  ['playlists', 'Playlists', ListVideo],
  ['schedules', 'Programación', CalendarDays],
  ['screens', 'Pantallas', Monitor],
];
const adminNav = [
  ['overview', 'Vista general', LayoutDashboard],
  ['tenants', 'Clientes', Users],
  ['packages', 'Paquetes', Package],
  ['sessions', 'Sesiones activas', ShieldCheck],
  ['base', 'Transmisión base', Radio],
  ['library', 'Biblioteca general', Images],
  ['playlists', 'Playlists generales', ListVideo],
];

function Login({ onLogin }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      onLogin(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <aside className="login-art">
        <div className="brand">
          <MonitorPlay size={25} /> FULLSCREEN<span>®</span>
        </div>
        <div className="login-message">
          <span className="eyebrow">CADA PANTALLA, UNA POSIBILIDAD.</span>
          <h1>
            Tu mensaje.
            <br />
            En el lugar
            <br />
            <em>correcto.</em>
          </h1>
          <p>
            Conecta tus espacios. Programa tu contenido.
            <br />
            Haz que cada pantalla cuente.
          </p>
        </div>
        <div className="login-display">
          <img src="/demo/clinic.svg" alt="Ejemplo de cartelería para Clínica Horizonte" />
          <span>
            <i /> Transmisión continua
          </span>
        </div>
        <footer>Una plataforma. Todas tus pantallas.</footer>
      </aside>
      <main className="login-main">
        <span className="login-label">TU CENTRO DE CONTROL</span>
        <h2>Bienvenido de nuevo.</h2>
        <p>Ingresa a tu espacio de trabajo para seguir conectado.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Correo electrónico</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="nombre@empresa.com"
              required
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <div className="password-field">
              <input
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Tu contraseña"
                required
              />
              <button
                type="button"
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <FormError error={error} />
          <Button type="submit" busy={busy}>
            Entrar a mi espacio <ArrowRight size={18} />
          </Button>
        </form>
        <div className="login-secure">
          <ShieldCheck size={16} /> Acceso seguro · Tu contenido, en tu espacio.
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState(null);
  const [page, setPage] = useState('overview');
  const [toast, setToast] = useState(null);
  const [connected, setConnected] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const user = session?.user;
  const signIn = useCallback((result) => {
    setCsrf(result.csrf_token);
    setSession(result);
    setPage('overview');
  }, []);
  const signOut = useCallback(() => {
    setSession(null);
    setData(null);
    setCsrf('');
  }, []);
  useEffect(() => {
    api('/auth/me')
      .then(signIn)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [signIn]);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [overview, media, playlists, schedules, tenants] = await Promise.all([
        api('/overview'),
        api('/media'),
        api('/playlists'),
        user.role === 'tenant' ? api('/schedules') : [],
        user.role === 'superadmin' ? api('/admin/tenants') : [],
      ]);
      setData({
        ...overview,
        media,
        playlists,
        schedules,
        tenants: user.role === 'superadmin' ? tenants : undefined,
      });
    } catch (err) {
      if ([401, 403].includes(err.status)) signOut();
      setToast({ error: true, message: err.message });
    }
  }, [user, signOut]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const socket = io({ withCredentials: true, auth: { csrfToken: session.csrf_token } });
    socket.on('connect', () => {
      setConnected(true);
      refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('data:changed', refresh);
    socket.on('admin:sessions', (sessions) => setData((d) => (d ? { ...d, sessions } : d)));
    socket.on('session:revoked', (msg) => {
      signOut();
      setToast({ error: true, message: msg.message });
    });
    const timer = setInterval(() => socket.emit('heartbeat'), 20_000);
    const poll = setInterval(refresh, 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
      socket.disconnect();
    };
  }, [session, refresh, signOut]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function mutate(path, options, message = 'Cambios guardados.') {
    const result = await api(path, options);
    await refresh();
    setToast({ message });
    return result;
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      signOut();
    }
  }
  if (checking)
    return (
      <div className="loading-screen">
        <MonitorPlay size={35} />
        <p>Conectando tu espacio…</p>
      </div>
    );
  if (!user)
    return (
      <>
        <Login onLogin={signIn} />
        {toast && (
          <div className={'toast ' + (toast.error ? 'toast-error' : '')} role="status">
            {toast.message}
          </div>
        )}
      </>
    );
  const admin = user.role === 'superadmin';
  const nav = admin ? adminNav : tenantNav;
  const Component = {
    overview: Overview,
    library: Library,
    playlists: Playlists,
    screens: Screens,
    schedules: Schedules,
    tenants: Tenants,
    packages: Packages,
    sessions: Sessions,
    base: BaseSignal,
    account: Account,
  }[page];
  const title = nav.find((n) => n[0] === page)?.[1] || 'Mi cuenta';
  const tenant = data?.tenant;
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (navOpen ? 'sidebar-open' : '')}>
        <a className="brand" href="/" aria-label="Fullscreen inicio">
          <MonitorPlay size={24} />
          FULLSCREEN<span>®</span>
        </a>
        <button className="workspace-switch" onClick={() => setPage('account')}>
          <div className="workspace-avatar">
            {admin ? 'F' : (tenant?.name || user.name).slice(0, 1)}
          </div>
          <span>
            <strong>{admin ? 'Administración' : tenant?.name || user.name}</strong>
            <small>{admin ? 'Super administrador' : 'Espacio de trabajo'}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">{admin ? 'PLATAFORMA' : 'TU ESPACIO'}</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? 'nav-active' : ''}
              onClick={() => {
                setPage(id);
                setNavOpen(false);
              }}
            >
              <Icon size={19} />
              {label}
              {id === 'screens' && <span>{data?.screens?.length || 0}</span>}
              {page === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {tenant && (
            <div className="quota-card">
              <span>
                Plan {tenant.package_name}
                <span>
                  {Math.round((tenant.used_bytes / tenant.max_storage_mb / 1024 / 1024) * 100)}%
                </span>
              </span>
              <div className="progress-track">
                <i
                  style={{
                    width:
                      Math.min(
                        100,
                        (tenant.used_bytes / tenant.max_storage_mb / 1024 / 1024) * 100,
                      ) + '%',
                  }}
                />
              </div>
              <small>
                {bytes(tenant.used_bytes)} de {bytes(tenant.max_storage_mb * 1024 * 1024)}{' '}
                utilizados
              </small>
            </div>
          )}
          <button className="profile" onClick={() => setPage('account')}>
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <span>
              <strong>{user.name}</strong>
              <small>{admin ? 'Propietario' : 'Administrador del espacio'}</small>
            </span>
          </button>
          <button className="logout" onClick={logout}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>
      {navOpen && <div className="nav-shade" onClick={() => setNavOpen(false)} />}
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Abrir menú"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </button>
          <div>
            Espacio de trabajo <span>/</span> <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className={'live-status ' + (!connected ? 'offline-status' : '')}>
              <i />
              {connected ? 'Conectado en tiempo real' : 'Reconectando'}
            </span>
            <button
              className="icon-button"
              aria-label="Ver actividad"
              onClick={() => setPage('overview')}
            >
              <Bell size={19} />
            </button>
            <button
              className="avatar avatar-small"
              aria-label="Mi cuenta"
              onClick={() => setPage('account')}
            >
              {user.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <div className="page-content">
          {data ? (
            <Component data={data} user={user} mutate={mutate} go={setPage} refresh={refresh} />
          ) : (
            <div className="empty">Cargando tu espacio…</div>
          )}
        </div>
        <footer className="app-footer">
          <span>
            FULLSCREEN <i>·</i> Cada pantalla cuenta.
          </span>
          <span>Tu contenido, siempre conectado.</span>
        </footer>
      </main>
      {toast && (
        <div className={'toast ' + (toast.error ? 'toast-error' : '')} role="status">
          {toast.message}
          <button aria-label="Cerrar notificación" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
