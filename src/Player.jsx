import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Expand, MonitorPlay, WifiOff } from 'lucide-react';
import { api } from './api.js';
import { Button, Field, FormError } from './ui.jsx';

// A sequence is keyed by the playlist revision/run, never by overlay visibility.
export function MediaSequence({ playlist, loop = true, runId, onComplete, onReady }) {
  const identity = (playlist?.id || '') + ':' + (playlist?.revision || '') + ':' + (runId || '');
  return (
    <BufferedSequence
      key={identity}
      playlist={playlist}
      loop={loop}
      onComplete={onComplete}
      onReady={onReady}
    />
  );
}

function SequenceMedia({ entry, active, playing, loop, dispatch }) {
  const { item, key } = entry;
  const mediaRef = useRef();
  const mounted = useRef(false);
  const video = item.mime_type.startsWith('video/');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ready = () => dispatch({ type: 'ready', key });
  const failed = () => dispatch({ type: 'failed', key });
  const imageLoaded = () => {
    const node = mediaRef.current;
    if (!node?.naturalWidth) return;
    // Decode before promotion, including images already in the browser cache.
    Promise.resolve(node.decode?.())
      .then(() => {
        if (mounted.current) ready();
      })
      .catch(() => {
        if (mounted.current) failed();
      });
  };
  useEffect(() => {
    const node = mediaRef.current;
    if (video && node?.readyState >= 3) ready();
    else if (!video && node?.complete && node.naturalWidth > 0) imageLoaded();
  }, [key]);
  useEffect(() => {
    if (!video) return;
    const node = mediaRef.current;
    let disposed = false;
    if (playing)
      node.play().catch(() => {
        if (!disposed) failed();
      });
    else node.pause();
    return () => {
      disposed = true;
      node.pause();
    };
  }, [playing, key]);
  return (
    <div
      className="media-frame"
      data-media-id={item.id}
      data-active={active ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0, visibility: active ? 'visible' : 'hidden' }}
    >
      {video ? (
        <video
          ref={mediaRef}
          src={item.url}
          muted
          playsInline
          preload="auto"
          loop={active && loop}
          onCanPlay={ready}
          onEnded={() => active && dispatch({ type: 'advance', key })}
          onError={failed}
        />
      ) : (
        <img ref={mediaRef} src={item.url} alt="" onLoad={imageLoaded} onError={failed} />
      )}
    </div>
  );
}

function BufferedSequence({ playlist, loop, onComplete, onReady }) {
  const items = playlist?.items || [];
  const callbacks = useRef({ onReady, onComplete });
  callbacks.current = { onReady, onComplete };
  const entry = (index, key) => {
    if (!items.length || (!loop && index >= items.length)) return null;
    index %= items.length;
    return { index, key, item: items[index] };
  };
  const finish = (s) => ({ ...s, current: null, pending: null, finished: true });
  const promote = (s) => ({
    current: s.pending,
    pending: loop && items.length === 1 ? null : entry(s.pending.index + 1, s.serial + 1),
    serial: s.serial + 1,
    pendingReady: false,
    requested: false,
    failures: 0,
    finished: false,
  });
  const [sequence, dispatch] = useReducer(
    (s, action) => {
      if (s.finished) return s;
      if (action.type === 'ready') {
        if (action.key !== s.pending?.key || s.pendingReady) return s;
        return s.requested ? promote(s) : { ...s, pendingReady: true };
      }
      if (action.type === 'advance') {
        // Ignore duplicate timer/ended events from the outgoing media.
        if (action.key !== s.current?.key || (loop && items.length === 1)) return s;
        if (!s.pending) return finish(s);
        return s.pendingReady ? promote(s) : { ...s, requested: true };
      }
      if (action.type === 'failed') {
        if (action.key === s.current?.key) {
          if (!s.pending) return finish(s);
          return s.pendingReady ? promote(s) : { ...s, current: null, requested: true };
        }
        if (action.key !== s.pending?.key) return s;
        const failures = s.failures + 1;
        const pending = failures >= items.length ? null : entry(s.pending.index + 1, s.serial + 1);
        // Skip failed candidates, but let the current file finish its display time.
        if (!pending && s.requested) return finish(s);
        return { ...s, pending, pendingReady: false, failures, serial: s.serial + 1 };
      }
      return s;
    },
    null,
    () => ({
      current: null,
      pending: entry(0, 0),
      serial: 0,
      pendingReady: false,
      requested: true,
      failures: 0,
      finished: !items.length,
    }),
  );
  const { current, pending, pendingReady, requested, finished } = sequence;
  const visible = Boolean(current) && !finished;
  useEffect(() => {
    callbacks.current.onReady?.(visible);
  }, [visible]);
  useEffect(() => {
    if (finished) callbacks.current.onComplete?.();
  }, [finished]);
  useEffect(() => {
    if (!current || finished || (loop && items.length === 1)) return;
    const timer = setTimeout(
      () => dispatch({ type: 'advance', key: current.key }),
      current.item.play_seconds * 1000,
    );
    return () => clearTimeout(timer);
  }, [current?.key, finished, loop, items.length]);
  useEffect(() => {
    if (!pending || pendingReady || finished) return;
    const timeout = setTimeout(() => dispatch({ type: 'failed', key: pending.key }), 10_000);
    return () => clearTimeout(timeout);
  }, [pending?.key, pendingReady, finished]);
  if (finished) return null;
  return (
    <div
      className={'media-sequence ' + (visible ? 'media-ready' : '')}
      data-playlist-id={playlist?.id}
    >
      {[current, pending].filter(Boolean).map((media) => (
        <SequenceMedia
          key={media.key}
          entry={media}
          active={media.key === current?.key}
          playing={media.key === current?.key && !requested}
          loop={loop && items.length === 1}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

function BaseLayer({ playlist }) {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="layer-base" data-testid="layer-base">
      <div className="base-fallback">
        <div className="base-orbit" />
        <span className="eyebrow">FULLSCREEN · SIEMPRE CONECTADOS</span>
        <h1>
          Un espacio para
          <br />
          <em>estar mejor.</em>
        </h1>
        <p>Información, novedades y buenas ideas. Todos los días.</p>
        <footer>
          <span>TRANSMISIÓN CONTINUA 24/7</span>
          <strong>
            {clock.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </strong>
        </footer>
      </div>
      <MediaSequence playlist={playlist} loop />
    </div>
  );
}

export default function Player({ screenId }) {
  const [state, setState] = useState(null);
  const [paired, setPaired] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  const [needsPairing, setNeedsPairing] = useState(false);
  const socketRef = useRef();
  const csrf = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const stopOverlay = useCallback(() => {
    setOverlayReady(false);
    setState((s) => (s ? { ...s, mode: 'base', playlist: null } : s));
  }, []);
  const applyState = useCallback((data) => {
    const previous = stateRef.current;
    if (previous?.runId !== data.runId || previous?.playlist?.revision !== data.playlist?.revision)
      setOverlayReady(false);
    setState(data);
  }, []);
  const load = useCallback(async () => {
    const data = await api('/player/' + screenId + '/state');
    csrf.current = data.csrf_token;
    applyState(data);
    setPaired(true);
    setNeedsPairing(false);
    return data;
  }, [screenId, applyState]);
  useEffect(() => {
    load().catch(() => setNeedsPairing(true));
  }, [load]);
  useEffect(() => {
    if (!paired || needsPairing) return;
    const socket = io({ withCredentials: true, auth: { screenId, csrfToken: csrf.current } });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      load().catch(() => {
        stopOverlay();
        setNeedsPairing(true);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('playback:state', applyState);
    socket.on('session:revoked', (data) => {
      stopOverlay();
      setNeedsPairing(true);
      setError(data.message);
    });
    socket.on('connect_error', () => {
      setConnected(false);
      load().catch((err) => {
        if ([401, 403].includes(err.status)) {
          stopOverlay();
          setNeedsPairing(true);
        }
      });
    });
    const heartbeat = setInterval(() => socket.emit('heartbeat'), 20_000);
    // Renew before the 30-day expiration; live processes are never assumed permanent.
    const refresh = setInterval(async () => {
      try {
        const data = await api('/player/' + screenId + '/refresh', {
          method: 'POST',
          csrf: csrf.current,
        });
        csrf.current = data.csrf_token;
        socket.auth.csrfToken = csrf.current;
        setNeedsPairing(false);
        socket.connect();
      } catch {
        /* The next authenticated state request resolves access loss. */
      }
    }, 12 * 3600_000);
    return () => {
      clearInterval(heartbeat);
      clearInterval(refresh);
      socket.disconnect();
    };
  }, [paired, needsPairing, screenId, load, applyState, stopOverlay]);
  // A network outage must not leave scheduled/local content visible beyond its window.
  useEffect(() => {
    if (state?.mode !== 'client' || !state.activeUntil) return;
    const offset = Date.parse(state.serverTime) - Date.now();
    const remaining = Date.parse(state.activeUntil) - (Date.now() + offset);
    const timer = setTimeout(stopOverlay, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state?.activeUntil, state?.serverTime, state?.mode, stopOverlay]);
  async function pair(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/player/' + screenId + '/pair', { method: 'POST', body: { pin } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function completed() {
    stopOverlay();
    socketRef.current?.emit('playback:ended', { runId: state?.runId });
  }
  return (
    <main className="player" data-testid="player">
      <BaseLayer playlist={state?.basePlaylist} />
      <div
        className={
          'layer-cliente ' + (state?.mode === 'client' && overlayReady ? 'overlay-visible' : '')
        }
        data-testid="layer-cliente"
      >
        {state?.mode === 'client' && (
          <MediaSequence
            playlist={state.playlist}
            loop={state.reason === 'schedule'}
            runId={state.runId}
            onReady={setOverlayReady}
            onComplete={completed}
          />
        )}
      </div>
      {needsPairing && (
        <div className="pairing-overlay">
          <form className="pairing-card" onSubmit={pair}>
            <div className="brand">
              <MonitorPlay /> FULLSCREEN
            </div>
            <h2>Conecta esta pantalla</h2>
            <p>
              Ingresa el PIN de 6 dígitos generado desde el panel del cliente. Es válido durante 15
              minutos.
            </p>
            <Field label="Código de vinculación">
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="pin-input"
              />
            </Field>
            <FormError error={error} />
            <Button busy={busy} type="submit">
              Vincular pantalla
            </Button>
            <small>ID: {screenId}</small>
          </form>
        </div>
      )}
      {!connected && paired && !needsPairing && (
        <span className="connection-notice">
          <WifiOff size={14} /> Reconectando · señal base disponible
        </span>
      )}
      <button
        className="fullscreen-button"
        title="Pantalla completa"
        aria-label="Pantalla completa"
        onClick={() => document.documentElement.requestFullscreen?.()}
      >
        <Expand size={20} />
      </button>
    </main>
  );
}
