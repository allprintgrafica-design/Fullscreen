import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Expand, MonitorPlay, WifiOff } from 'lucide-react';
import { api } from './api.js';
import { Button, Field, FormError } from './ui.jsx';

// A sequence is keyed by the playlist revision/run, never by overlay visibility.
export function MediaSequence({ playlist, loop = true, runId, onComplete, onReady }) {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [finished, setFinished] = useState(false);
  const timer = useRef();
  const mediaRef = useRef();
  const nextLock = useRef(false);
  const callbacks = useRef({ onReady, onComplete });
  callbacks.current = { onReady, onComplete };
  const items = playlist?.items || [];
  const item = items[index];
  const identity = (playlist?.id || '') + ':' + (playlist?.revision || '') + ':' + (runId || '');
  useEffect(() => {
    clearTimeout(timer.current);
    setIndex(0);
    setReady(false);
    setFinished(false);
  }, [identity]);
  const advance = useCallback(() => {
    if (nextLock.current) return;
    nextLock.current = true;
    clearTimeout(timer.current);
    if (index + 1 >= items.length && !loop) {
      setFinished(true);
      callbacks.current.onReady?.(false);
      callbacks.current.onComplete?.();
      return;
    }
    setReady(false);
    setIndex((i) => (i + 1) % Math.max(items.length, 1));
    // Single-item loop stays mounted and keeps its video running.
    if (items.length === 1 && loop) {
      nextLock.current = false;
      setReady(true);
    }
  }, [index, items.length, loop]);
  useEffect(() => {
    nextLock.current = false;
    const node = mediaRef.current;
    const loaded = Boolean(
      node &&
      (node.tagName === 'IMG' ? node.complete && node.naturalWidth > 0 : node.readyState >= 3),
    );
    setReady(loaded);
    callbacks.current.onReady?.(loaded);
  }, [index, identity]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!ready || !item || finished) return;
    callbacks.current.onReady?.(true);
    if (items.length > 1 || !loop) timer.current = setTimeout(advance, item.play_seconds * 1000);
    return () => clearTimeout(timer.current);
  }, [ready, index, identity, finished, advance, item?.play_seconds, items.length, loop]);
  useEffect(() => {
    if (!item || finished) return;
    const loadTimeout = setTimeout(() => {
      if (!ready && (items.length > 1 || !loop)) advance();
    }, 10_000);
    return () => clearTimeout(loadTimeout);
  }, [index, identity, ready, item, finished, advance]);
  if (!item || finished) return null;
  const loaded = () => setReady(true);
  const failed = () => {
    setReady(false);
    callbacks.current.onReady?.(false);
    if (items.length > 1 || !loop) advance();
  };
  return (
    <div
      className={'media-sequence ' + (ready ? 'media-ready' : '')}
      data-playlist-id={playlist.id}
    >
      {item.mime_type.startsWith('video/') ? (
        <video
          ref={mediaRef}
          key={item.id + ':' + index}
          src={item.url}
          autoPlay
          muted
          playsInline
          preload="auto"
          loop={loop && items.length === 1}
          onCanPlay={loaded}
          onEnded={advance}
          onError={failed}
        />
      ) : (
        <img
          ref={mediaRef}
          key={item.id + ':' + index}
          src={item.url}
          alt=""
          onLoad={loaded}
          onError={failed}
        />
      )}
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
