import { useState } from 'react';
import {
  Monitor,
  MonitorPlay,
  Radio,
  Plus,
  ArrowUpRight,
  Upload,
  Image as ImageIcon,
  Film,
  Trash2,
  Pencil,
  Play,
  RotateCcw,
  CalendarDays,
  Clock,
  Users,
  HardDrive,
  ListVideo,
  ShieldCheck,
  KeyRound,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Check,
  Package,
  Copy,
} from 'lucide-react';
import { Button, Modal, Field, Badge, Empty, Stat, FormError, bytes, date, days } from './ui.jsx';

function Heading({ eyebrow, title, detail, children }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
function ActionForm({ children, onSave, onClose, label = 'Guardar cambios' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(new FormData(e.currentTarget));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {children}
      <FormError error={error} />
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" busy={busy}>
          {label}
        </Button>
      </div>
    </form>
  );
}
function Confirm({ title, detail, onClose, onConfirm }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-detail">{detail}</p>
      <ActionForm
        onClose={onClose}
        label="Confirmar"
        onSave={async () => {
          await onConfirm();
          onClose();
        }}
      />
    </Modal>
  );
}

export function Overview({ data, user, go, mutate }) {
  const admin = user.role === 'superadmin';
  const screens = data.screens || [];
  const online = screens.filter((s) => s.online).length;
  return (
    <>
      <Heading
        eyebrow={admin ? 'CONTROL DE PLATAFORMA' : 'TU ESPACIO, EN VIVO'}
        title={admin ? 'Todo bajo control.' : 'Hola, ' + user.name.split(' ')[0] + '.'}
        detail={
          admin
            ? 'Una visión completa de tus clientes, conexiones y transmisión.'
            : 'Este es el pulso de tus pantallas. Hagamos que cada una cuente.'
        }
      >
        <Button onClick={() => go(admin ? 'tenants' : 'screens')}>
          <Plus size={17} />
          {admin ? 'Gestionar clientes' : 'Gestionar pantallas'}
        </Button>
      </Heading>
      <section className="hero-banner">
        <div>
          <span className="hero-tag">
            <i />
            {admin ? 'CONTROL CENTRAL' : 'TU CARTELERÍA, SIN PAUSAS'}
          </span>
          <h2>
            Tus pantallas.
            <br />
            <em>Siempre conectadas.</em>
          </h2>
          <p>
            El contenido correcto, en el momento preciso.
            <br />
            Tu transmisión base sigue acompañando cada espacio.
          </p>
          <button onClick={() => go(admin ? 'base' : 'schedules')}>
            {admin ? 'Configurar señal general' : 'Organizar mi programación'}
            <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="hero-screen">
          <div className="screen-camera" />
          <img src="/demo/clinic.svg" alt="Vista de una pantalla de cartelería" />
          <span>
            <i />
            {online
              ? online + ' pantalla' + (online > 1 ? 's' : '') + ' en línea'
              : 'Listo para conectar tus pantallas'}
          </span>
        </div>
        <div className="hero-orbit" />
      </section>
      <section className="stats-grid">
        {admin ? (
          <>
            <Stat
              icon={Users}
              label="Clientes"
              value={data.tenants.length}
              detail={data.tenants.filter((t) => t.status === 'active').length + ' cuentas activas'}
            />
            <Stat
              icon={Monitor}
              label="Pantallas en línea"
              value={online + ' / ' + screens.length}
              detail="Conexiones de dispositivos"
              accent
            />
            <Stat
              icon={ShieldCheck}
              label="Sesiones activas"
              value={data.sessions.length}
              detail="Accesos autenticados"
            />
            <Stat
              icon={Package}
              label="Paquetes"
              value={data.packages.length}
              detail="Planes de la plataforma"
            />
          </>
        ) : (
          <>
            <Stat
              icon={Monitor}
              label="Pantallas en línea"
              value={online + ' / ' + screens.length}
              detail="Tus espacios conectados"
              accent
            />
            <Stat
              icon={ImageIcon}
              label="Archivos multimedia"
              value={data.media.length}
              detail={'De ' + data.tenant.max_files + ' disponibles'}
            />
            <Stat
              icon={ListVideo}
              label="Playlists"
              value={data.playlists.length}
              detail="Historias listas para compartir"
            />
            <Stat
              icon={CalendarDays}
              label="Bloques programados"
              value={data.schedules.filter((s) => s.enabled).length}
              detail="Tu contenido, a tiempo"
            />
          </>
        )}
      </section>
      <div className="dashboard-columns">
        <section>
          <div className="section-heading">
            <h2>{admin ? 'Clientes de la plataforma' : 'Tus pantallas'}</h2>
            <button onClick={() => go(admin ? 'tenants' : 'screens')}>
              Ver todas <ArrowUpRight size={16} />
            </button>
          </div>
          {admin ? (
            <div className="panel compact-list">
              {data.tenants.map((t) => (
                <div className="list-row" key={t.id}>
                  <div className="tile-icon">
                    <Users size={20} />
                  </div>
                  <div>
                    <strong>{t.name}</strong>
                    <small>Plan {t.package_name}</small>
                  </div>
                  <Badge tone={t.status === 'active' ? 'green' : 'red'}>
                    {t.status === 'active' ? 'Activo' : 'Suspendido'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : screens.length ? (
            <div className="screen-grid overview-screens">
              {screens.slice(0, 2).map((s) => (
                <ScreenCard
                  key={s.id}
                  screen={s}
                  playlists={data.playlists}
                  mutate={mutate}
                  compact
                />
              ))}
            </div>
          ) : (
            <Empty
              title="Tu primera pantalla te espera"
              detail="Agrega un dispositivo para empezar a transmitir."
            >
              <Button onClick={() => go('screens')}>Agregar pantalla</Button>
            </Empty>
          )}
        </section>
        <section>
          <div className="section-heading">
            <h2>Actividad reciente</h2>
            <span className="muted">En tu espacio</span>
          </div>
          <div className="panel activity-panel">
            {data.events.length ? (
              data.events.slice(0, 6).map((e) => (
                <div className="activity" key={e.id}>
                  <div className="activity-dot">
                    <Check size={13} />
                  </div>
                  <div>
                    <strong>{e.detail}</strong>
                    <small>{date(e.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Todo listo" detail="Tus próximas acciones aparecerán aquí." />
            )}
          </div>
        </section>
      </div>
      <div className="base-info">
        <Radio size={20} />
        <div>
          <strong>Una señal que nunca se detiene.</strong>
          <p>Al finalizar tu contenido, cada pantalla vuelve a la transmisión general.</p>
        </div>
        <Badge>Base 24/7</Badge>
      </div>
    </>
  );
}

function ScreenCard({ screen, playlists, mutate, compact, onPin, onDelete, onEdit }) {
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedId = playlists.some((p) => p.id === playlistId)
    ? playlistId
    : playlists[0]?.id || '';
  const active = screen.playback?.mode === 'client';
  const p = playlists.find((p) => p.id === screen.playback?.playlistId);
  async function control(mode) {
    setBusy(true);
    setError('');
    try {
      await mutate(
        '/screens/' + screen.id + '/playback',
        { method: 'POST', body: mode === 'base' ? { mode } : { mode, playlist_id: selectedId } },
        mode === 'base'
          ? 'Pantalla de vuelta en la transmisión base.'
          : 'Orden de transmisión enviada.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="screen-card">
      <div className="screen-preview">
        <img
          src={active && p?.items[0] ? p.items[0].url : '/demo/base.svg'}
          alt={'Contenido de ' + screen.name}
        />
        <div className="preview-badge">
          <i className={screen.online ? 'dot-online' : 'dot-offline'} />
          {screen.online ? 'En línea' : 'Sin conexión'}
        </div>
        <span className="preview-label">
          <Monitor size={12} />
          {active ? 'Contenido del cliente' : 'Señal base'}
        </span>
      </div>
      <div className="screen-card-body">
        <div className="screen-title">
          <h3>{screen.name}</h3>
          {!compact && (
            <div className="row-actions">
              <button
                className="icon-button"
                aria-label={'Editar ' + screen.name}
                onClick={() => onEdit(screen)}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label={'Eliminar ' + screen.name}
                onClick={() => onDelete(screen)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
        <p>
          <Radio size={13} />
          {active ? p?.name || 'Playlist en reproducción' : 'Transmisión general 24/7'}
        </p>
        <label className="sr-only" htmlFor={'playlist-' + screen.id}>
          Playlist para {screen.name}
        </label>
        <select
          id={'playlist-' + screen.id}
          value={selectedId}
          onChange={(e) => setPlaylistId(e.target.value)}
        >
          <option value="" disabled>
            Selecciona una playlist
          </option>
          {playlists.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          className="full-width"
          busy={busy}
          disabled={!selectedId}
          onClick={() => control('client')}
        >
          <Play size={15} />
          Transmitir de inmediato
        </Button>
        <Button
          className="full-width"
          variant="secondary"
          disabled={busy}
          onClick={() => control('base')}
        >
          <RotateCcw size={14} />
          Volver a transmisión base
        </Button>
        <FormError error={error} />
        {!compact && (
          <div className="screen-links">
            <a target="_blank" rel="noreferrer" href={'/player/' + screen.id}>
              Abrir player <ExternalLink size={13} />
            </a>
            <button onClick={() => onPin(screen)}>
              <KeyRound size={13} />
              Generar PIN
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function Screens({ data, mutate }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pair, setPair] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [pinScreen, setPinScreen] = useState(null);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Heading
        eyebrow="TUS PUNTOS DE CONEXIÓN"
        title="Pantallas"
        detail={
          data.screens.length +
          ' de ' +
          data.tenant.max_screens +
          ' dispositivos disponibles en tu plan.'
        }
      >
        <Button
          onClick={() => setAdding(true)}
          disabled={data.screens.length >= data.tenant.max_screens}
        >
          <Plus size={17} />
          Agregar pantalla
        </Button>
      </Heading>
      <div className="info-note">
        <ShieldCheck size={18} />
        Cada pantalla se vincula con un PIN único. Abre su player en el dispositivo que quieras
        conectar.
      </div>
      {data.screens.length ? (
        <div className="screen-grid">
          {data.screens.map((s) => (
            <ScreenCard
              key={s.id}
              screen={s}
              playlists={data.playlists}
              mutate={mutate}
              onPin={setPinScreen}
              onDelete={setDeleting}
              onEdit={setEditing}
            />
          ))}
        </div>
      ) : (
        <Empty
          title="Conecta tu primer espacio"
          detail="Una pantalla en recepción, una sala de espera o todo un local."
        >
          <Button onClick={() => setAdding(true)}>Agregar pantalla</Button>
        </Empty>
      )}
      {(adding || editing) && (
        <Modal
          title={editing ? 'Editar pantalla' : 'Nueva pantalla'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ActionForm
            onClose={() => {
              setAdding(false);
              setEditing(null);
            }}
            label={editing ? 'Guardar cambios' : 'Crear pantalla'}
            onSave={async (f) => {
              const result = await mutate('/screens' + (editing ? '/' + editing.id : ''), {
                method: editing ? 'PUT' : 'POST',
                body: { name: f.get('name') },
              });
              setAdding(false);
              setEditing(null);
              if (result.pin) setPair(result);
            }}
          >
            <Field label="Nombre del espacio">
              <input
                name="name"
                placeholder="Ej. Recepción principal"
                defaultValue={editing?.name || ''}
                required
                maxLength={120}
              />
            </Field>
          </ActionForm>
        </Modal>
      )}
      {pinScreen && (
        <Confirm
          title="Volver a vincular pantalla"
          detail="Se cerrará la sesión del dispositivo actual. El nuevo PIN será válido durante 15 minutos y podrá usarse una sola vez."
          onClose={() => setPinScreen(null)}
          onConfirm={async () => {
            const result = await mutate('/screens/' + pinScreen.id + '/pin', { method: 'POST' });
            setPair(result);
          }}
        />
      )}
      {pair && (
        <Modal title="Vincula tu dispositivo" onClose={() => setPair(null)}>
          <p className="modal-detail">
            Abre el player en la pantalla e ingresa este PIN. Válido durante 15 minutos, para un
            único uso.
          </p>
          <div className="pair-code">{pair.pin}</div>
          <a
            className="btn btn-primary full-width"
            target="_blank"
            rel="noreferrer"
            href={'/player/' + pair.id}
          >
            Abrir player <ExternalLink size={16} />
          </a>
          <Button
            className="full-width"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.origin + '/player/' + pair.id);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={15} />
            {copied ? 'Enlace copiado' : 'Copiar enlace al player'}
          </Button>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title="Eliminar pantalla"
          detail={'Se desvinculará ' + deleting.name + ' y se eliminarán sus horarios.'}
          onClose={() => setDeleting(null)}
          onConfirm={() => mutate('/screens/' + deleting.id, { method: 'DELETE' })}
        />
      )}
    </>
  );
}

export function Library({ data, user, mutate }) {
  const [upload, setUpload] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [filter, setFilter] = useState('all');
  const media = data.media.filter((m) => filter === 'all' || m.mime_type.startsWith(filter));
  return (
    <>
      <Heading
        eyebrow={
          user.role === 'superadmin' ? 'CONTENIDO DE LA PLATAFORMA' : 'EL MATERIAL DE TUS HISTORIAS'
        }
        title="Biblioteca multimedia"
        detail="Imágenes y videos que dan vida a tus espacios."
      >
        <Button onClick={() => setUpload(true)}>
          <Upload size={17} />
          Subir contenido
        </Button>
      </Heading>
      {data.tenant && (
        <div className="library-quota panel">
          <HardDrive size={20} />
          <strong>
            {bytes(data.tenant.used_bytes)}{' '}
            <span>de {bytes(data.tenant.max_storage_mb * 1024 * 1024)}</span>
          </strong>
          <div className="progress-track">
            <i
              style={{
                width:
                  Math.min(
                    100,
                    (data.tenant.used_bytes / data.tenant.max_storage_mb / 1024 / 1024) * 100,
                  ) + '%',
              }}
            />
          </div>
          <span>
            {data.media.length} / {data.tenant.max_files} archivos
          </span>
        </div>
      )}
      <div className="tabs">
        {[
          ['all', 'Todos'],
          ['image/', 'Imágenes'],
          ['video/', 'Videos'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={filter === id ? 'tab-active' : ''}
          >
            {label}
          </button>
        ))}
        <span>{media.length} archivos</span>
      </div>
      {media.length ? (
        <div className="media-grid">
          {media.map((m) => (
            <article className="media-card" key={m.id}>
              <div className="media-thumb">
                {m.mime_type.startsWith('video/') ? (
                  <video src={m.url} muted preload="metadata" />
                ) : (
                  <img src={m.url} alt={m.name} />
                )}
                <span>
                  {m.mime_type.startsWith('video/') ? <Film size={15} /> : <ImageIcon size={15} />}
                </span>
              </div>
              <div className="media-meta">
                <h3 title={m.name}>{m.name}</h3>
                <p>
                  {bytes(m.size_bytes)} ·{' '}
                  {m.duration_seconds ? Math.round(m.duration_seconds) + ' s' : 'Imagen'}
                </p>
                <button
                  className="icon-button danger"
                  aria-label={'Eliminar ' + m.name}
                  onClick={() => setDeleting(m)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Un lienzo para tus ideas"
          detail="Sube una imagen o video para crear tu primera playlist."
        >
          <Button onClick={() => setUpload(true)}>Subir contenido</Button>
        </Empty>
      )}
      {upload && (
        <Modal title="Subir contenido" onClose={() => setUpload(false)}>
          <ActionForm
            onClose={() => setUpload(false)}
            label="Subir archivo"
            onSave={async (f) => {
              const body = new FormData();
              body.append('file', f.get('file'));
              await mutate(
                '/media',
                { method: 'POST', body },
                'Contenido agregado a tu biblioteca.',
              );
              setUpload(false);
            }}
          >
            <div className="upload-zone">
              <Upload size={32} />
              <strong>Dale vida a tu próxima pantalla</strong>
              <span>PNG, JPG, WebP, GIF, MP4 o WebM · Máximo {data.max_upload_mb} MB</span>
              <input
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                required
              />
            </div>
            {data.tenant && (
              <p className="muted">
                Disponible:{' '}
                {bytes(data.tenant.max_storage_mb * 1024 * 1024 - data.tenant.used_bytes)} ·{' '}
                {data.tenant.max_files - data.media.length} archivos
              </p>
            )}
          </ActionForm>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title="Eliminar contenido"
          detail={'Eliminar “' + deleting.name + '”. Debe estar fuera de todas las playlists.'}
          onClose={() => setDeleting(null)}
          onConfirm={() => mutate('/media/' + deleting.id, { method: 'DELETE' })}
        />
      )}
    </>
  );
}

function PlaylistEditor({ existing, media, mutate, onClose }) {
  const [items, setItems] = useState(
    existing?.items.map((m) => ({ media_id: m.id, duration_seconds: m.play_seconds })) || [],
  );
  const [chosen, setChosen] = useState(media[0]?.id || '');
  function move(index, delta) {
    const copy = [...items];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    setItems(copy);
  }
  return (
    <Modal title={existing ? 'Editar playlist' : 'Nueva playlist'} onClose={onClose} wide>
      <ActionForm
        onClose={onClose}
        onSave={async (f) => {
          if (!items.length) throw new Error('Agrega al menos un archivo a la playlist.');
          await mutate('/playlists' + (existing ? '/' + existing.id : ''), {
            method: existing ? 'PUT' : 'POST',
            body: { name: f.get('name'), items },
          });
          onClose();
        }}
      >
        <Field label="Nombre de la playlist">
          <input
            name="name"
            defaultValue={existing?.name || ''}
            placeholder="Ej. Bienvenida y novedades"
            required
            maxLength={120}
          />
        </Field>
        <div className="add-item">
          <select
            aria-label="Contenido para agregar"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="" disabled>
              Selecciona un archivo
            </option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            disabled={!chosen}
            onClick={() => {
              const m = media.find((m) => m.id === chosen);
              setItems([
                ...items,
                {
                  media_id: chosen,
                  duration_seconds: Math.min(
                    3600,
                    Math.max(1, Math.ceil(m.duration_seconds || 10)),
                  ),
                },
              ]);
            }}
          >
            <Plus size={16} />
            Agregar
          </Button>
        </div>
        <div className="playlist-editor-list">
          {items.map((item, index) => (
            <div className="playlist-item" key={index}>
              <span className="item-position">{index + 1}</span>
              <strong>{media.find((m) => m.id === item.media_id)?.name}</strong>
              <label>
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={item.duration_seconds}
                  onChange={(e) =>
                    setItems(
                      items.map((m, i) =>
                        i === index ? { ...m, duration_seconds: Number(e.target.value) } : m,
                      ),
                    )
                  }
                  required
                />{' '}
                s
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label="Subir contenido"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Bajar contenido"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label="Quitar contenido"
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <p className="muted">
          Cada archivo se muestra durante el tiempo indicado. Los videos también avanzan cuando
          terminan.
        </p>
      </ActionForm>
    </Modal>
  );
}
export function Playlists({ data, mutate, go }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  return (
    <>
      <Heading
        eyebrow="CONTENIDO CON UN HILO CONDUCTOR"
        title="Tus playlists"
        detail="Combina, ordena y prepara el contenido que quieres compartir."
      >
        <Button disabled={!data.media.length} onClick={() => setAdding(true)}>
          <Plus size={17} />
          Crear playlist
        </Button>
      </Heading>
      {data.playlists.length ? (
        <div className="playlist-grid">
          {data.playlists.map((p) => (
            <article className="playlist-card panel" key={p.id}>
              <div className="playlist-collage">
                {p.items
                  .slice(0, 3)
                  .map((m, i) =>
                    m.mime_type.startsWith('video/') ? (
                      <video key={i} src={m.url} muted preload="metadata" />
                    ) : (
                      <img key={i} src={m.url} alt="" />
                    ),
                  )}
                <span>
                  <ListVideo size={18} />
                  {p.items.length} contenidos
                </span>
              </div>
              <div className="playlist-card-body">
                <h3>{p.name}</h3>
                <p>
                  <Clock size={14} />
                  {Math.round(p.items.reduce((a, m) => a + m.play_seconds, 0))} segundos por ciclo
                </p>
                <div className="row-actions">
                  <Button variant="secondary" onClick={() => setEditing(p)}>
                    <Pencil size={14} />
                    Editar playlist
                  </Button>
                  <button
                    className="icon-button danger"
                    aria-label={'Eliminar ' + p.name}
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Tu próxima historia comienza aquí"
          detail="Agrega contenido a tu biblioteca y crea una secuencia para tus pantallas."
        >
          <Button onClick={() => go('library')}>Ir a la biblioteca</Button>
        </Empty>
      )}
      {(adding || editing) && (
        <PlaylistEditor
          existing={editing}
          media={data.media}
          mutate={mutate}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Eliminar playlist"
          detail="Se eliminarán sus horarios y las pantallas que la transmiten volverán a la base. Los archivos seguirán en la biblioteca."
          onClose={() => setDeleting(null)}
          onConfirm={() => mutate('/playlists/' + deleting.id, { method: 'DELETE' })}
        />
      )}
    </>
  );
}

export function Schedules({ data, mutate, go }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  return (
    <>
      <Heading
        eyebrow="EL MOMENTO TAMBIÉN IMPORTA"
        title="Tu programación"
        detail="Una semana organizada. El contenido correcto en cada espacio."
      >
        <Button
          disabled={!data.screens.length || !data.playlists.length}
          onClick={() => setAdding(true)}
        >
          <Plus size={17} />
          Programar contenido
        </Button>
      </Heading>
      <div className="info-note">
        <Clock size={18} />
        Los bloques se repiten cada semana en su zona horaria. Si se superponen, tiene prioridad el
        último creado.
      </div>
      {!data.screens.length || !data.playlists.length ? (
        <Empty
          title="Prepara tu programación"
          detail="Necesitas al menos una pantalla y una playlist para agregar un horario."
        >
          <Button onClick={() => go(!data.screens.length ? 'screens' : 'playlists')}>
            Preparar contenido
          </Button>
        </Empty>
      ) : (
        <div className="week-grid">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <section className="week-day" key={day}>
              <header>
                {days[day]}
                <span>{data.schedules.filter((s) => s.day_of_week === day).length} bloques</span>
              </header>
              {data.schedules
                .filter((s) => s.day_of_week === day)
                .map((s) => (
                  <article
                    className={'schedule-block ' + (!s.enabled ? 'schedule-disabled' : '')}
                    key={s.id}
                  >
                    <span>
                      <Clock size={13} />
                      {s.start_time} – {s.end_time}
                      {s.end_time < s.start_time ? ' +1 día' : ''}
                    </span>
                    <h3>{s.playlist_name}</h3>
                    <p>
                      <Monitor size={12} />
                      {s.screen_name}
                    </p>
                    <small>{s.timezone}</small>
                    <div className="schedule-actions">
                      <button aria-label="Editar horario" onClick={() => setEditing(s)}>
                        <Pencil size={14} />
                      </button>
                      <button aria-label="Eliminar horario" onClick={() => setDeleting(s)}>
                        <Trash2 size={14} />
                      </button>
                      <Badge tone={s.enabled ? 'green' : 'gray'}>
                        {s.enabled ? 'Activo' : 'Pausado'}
                      </Badge>
                    </div>
                  </article>
                ))}
              <button
                className="add-schedule"
                aria-label={'Agregar horario para ' + days[day]}
                onClick={() => {
                  setEditing({ day_of_week: day });
                }}
              >
                <Plus size={17} />
              </button>
            </section>
          ))}
        </div>
      )}
      {(adding || editing) && (
        <Modal
          title={editing?.id ? 'Editar horario' : 'Programar contenido'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ActionForm
            onClose={() => {
              setAdding(false);
              setEditing(null);
            }}
            onSave={async (f) => {
              await mutate('/schedules' + (editing?.id ? '/' + editing.id : ''), {
                method: editing?.id ? 'PUT' : 'POST',
                body: {
                  screen_id: f.get('screen_id'),
                  playlist_id: f.get('playlist_id'),
                  day_of_week: Number(f.get('day_of_week')),
                  start_time: f.get('start_time'),
                  end_time: f.get('end_time'),
                  timezone: f.get('timezone'),
                  enabled: f.get('enabled') === 'on',
                },
              });
              setAdding(false);
              setEditing(null);
            }}
          >
            <Field label="Pantalla">
              <select name="screen_id" defaultValue={editing?.screen_id} required>
                {data.screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Playlist">
              <select name="playlist_id" defaultValue={editing?.playlist_id} required>
                {data.playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Día de la semana">
              <select name="day_of_week" defaultValue={editing?.day_of_week ?? 1}>
                {days.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Desde">
                <input
                  type="time"
                  name="start_time"
                  defaultValue={editing?.start_time || '09:00'}
                  required
                />
              </Field>
              <Field label="Hasta">
                <input
                  type="time"
                  name="end_time"
                  defaultValue={editing?.end_time || '18:00'}
                  required
                />
              </Field>
            </div>
            <Field label="Zona horaria IANA">
              <input
                name="timezone"
                defaultValue={
                  editing?.timezone ||
                  Intl.DateTimeFormat().resolvedOptions().timeZone ||
                  'America/Argentina/Buenos_Aires'
                }
                required
                placeholder="America/Argentina/Buenos_Aires"
              />
            </Field>
            <label className="check-field">
              <input type="checkbox" name="enabled" defaultChecked={editing?.enabled !== 0} />
              Horario activo
            </label>
          </ActionForm>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title="Eliminar horario"
          detail="Este bloque dejará de ejecutarse. El contenido permanecerá en tu biblioteca."
          onClose={() => setDeleting(null)}
          onConfirm={() => mutate('/schedules/' + deleting.id, { method: 'DELETE' })}
        />
      )}
    </>
  );
}

export function Tenants({ data, mutate }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <Heading
        eyebrow="CADA CLIENTE, SU PROPIO ESPACIO"
        title="Clientes"
        detail="Gestiona cuentas, paquetes y el acceso a la plataforma."
      >
        <Button onClick={() => setAdding(true)} disabled={!data.packages.length}>
          <Plus size={17} />
          Crear cliente
        </Button>
      </Heading>
      {data.tenants.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Paquete</th>
                <th>Almacenamiento</th>
                <th>Pantallas</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <small>{t.email}</small>
                  </td>
                  <td>{t.package_name}</td>
                  <td>
                    {bytes(t.used_bytes)} / {bytes(t.max_storage_mb * 1024 * 1024)}
                    <small>
                      {t.file_count} / {t.max_files} archivos
                    </small>
                  </td>
                  <td>
                    {t.screen_count} / {t.max_screens}
                  </td>
                  <td>
                    <Badge tone={t.status === 'active' ? 'green' : 'red'}>
                      {t.status === 'active' ? 'Activo' : 'Suspendido'}
                    </Badge>
                  </td>
                  <td>
                    <Button variant="secondary" onClick={() => setEditing(t)}>
                      <Pencil size={14} />
                      Gestionar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Tu plataforma está lista"
          detail="Crea un paquete y da de alta a tu primer cliente."
        />
      )}
      {(adding || editing) && (
        <Modal
          title={editing ? 'Gestionar cliente' : 'Nuevo cliente'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ActionForm
            onClose={() => {
              setAdding(false);
              setEditing(null);
            }}
            onSave={async (f) => {
              const body = {
                name: f.get('name'),
                package_id: f.get('package_id'),
                ...(editing
                  ? { status: f.get('status') }
                  : { email: f.get('email'), password: f.get('password') }),
              };
              await mutate('/admin/tenants' + (editing ? '/' + editing.id : ''), {
                method: editing ? 'PUT' : 'POST',
                body,
              });
              setAdding(false);
              setEditing(null);
            }}
          >
            <Field label="Nombre del cliente">
              <input name="name" defaultValue={editing?.name || ''} required maxLength={120} />
            </Field>
            {!editing && (
              <>
                <Field label="Correo de acceso">
                  <input type="email" name="email" required autoComplete="off" />
                </Field>
                <Field label="Contraseña inicial (mínimo 12 caracteres)">
                  <input
                    type="password"
                    name="password"
                    minLength={12}
                    maxLength={72}
                    required
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}
            <Field label="Paquete">
              <select name="package_id" defaultValue={editing?.package_id}>
                {data.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.max_files} archivos · {p.max_screens} pantallas
                  </option>
                ))}
              </select>
            </Field>
            {editing && (
              <>
                <Field label="Estado">
                  <select name="status" defaultValue={editing.status}>
                    <option value="active">Activo</option>
                    <option value="suspended">Suspendido</option>
                  </select>
                </Field>
                <p className="muted">
                  Suspender revoca inmediatamente las sesiones de este cliente y sus players.
                </p>
              </>
            )}
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function Packages({ data, mutate }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <Heading
        eyebrow="LÍMITES CLAROS, CRECIMIENTO SIMPLE"
        title="Paquetes"
        detail="Define la capacidad de cada plan. Los límites se aplican en el servidor."
      >
        <Button onClick={() => setAdding(true)}>
          <Plus size={17} />
          Crear paquete
        </Button>
      </Heading>
      <div className="package-grid">
        {data.packages.map((p) => (
          <article className="package-card panel" key={p.id}>
            <Package size={26} />
            <span className="eyebrow">PLAN</span>
            <h2>{p.name}</h2>
            <strong>{bytes(p.max_storage_mb * 1024 * 1024)}</strong>
            <p>de almacenamiento</p>
            <ul>
              <li>
                <Check size={16} />
                {p.max_files} archivos multimedia
              </li>
              <li>
                <Check size={16} />
                {p.max_screens} pantallas conectadas
              </li>
              <li>
                <Check size={16} />
                Playlists y horarios
              </li>
            </ul>
            <Button variant="secondary" onClick={() => setEditing(p)}>
              <Pencil size={15} />
              Editar límites
            </Button>
          </article>
        ))}
      </div>
      {(adding || editing) && (
        <Modal
          title={editing ? 'Editar paquete' : 'Nuevo paquete'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <ActionForm
            onClose={() => {
              setAdding(false);
              setEditing(null);
            }}
            onSave={async (f) => {
              await mutate('/admin/packages' + (editing ? '/' + editing.id : ''), {
                method: editing ? 'PUT' : 'POST',
                body: {
                  name: f.get('name'),
                  max_storage_mb: Number(f.get('max_storage_mb')),
                  max_files: Number(f.get('max_files')),
                  max_screens: Number(f.get('max_screens')),
                },
              });
              setAdding(false);
              setEditing(null);
            }}
          >
            <Field label="Nombre">
              <input name="name" required maxLength={120} defaultValue={editing?.name || ''} />
            </Field>
            <Field label="Almacenamiento máximo (MB)">
              <input
                type="number"
                name="max_storage_mb"
                min={1}
                max={1000000}
                defaultValue={editing?.max_storage_mb || 1024}
                required
              />
            </Field>
            <Field label="Cantidad máxima de archivos">
              <input
                type="number"
                name="max_files"
                min={1}
                max={100000}
                defaultValue={editing?.max_files || 50}
                required
              />
            </Field>
            <Field label="Cantidad máxima de pantallas">
              <input
                type="number"
                name="max_screens"
                min={1}
                max={10000}
                defaultValue={editing?.max_screens || 5}
                required
              />
            </Field>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function Sessions({ data, user, mutate }) {
  const [revoking, setRevoking] = useState(null);
  return (
    <>
      <Heading
        eyebrow="SEGURIDAD EN TIEMPO REAL"
        title="Sesiones activas"
        detail="Cada acceso es revocable. Los cambios se reflejan en todos los dispositivos conectados."
      >
        <Badge>{data.sessions.length} sesiones válidas</Badge>
      </Heading>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario / dispositivo</th>
              <th>Rol</th>
              <th>Conexión</th>
              <th>Última actividad</th>
              <th>Vencimiento</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>
                    {s.name}
                    {s.id === user.session_id ? ' · Tú' : ''}
                  </strong>
                  <small>
                    {s.tenant_name || 'Plataforma'}
                    {s.email ? ' · ' + s.email : ''}
                  </small>
                  <small>{s.ip}</small>
                </td>
                <td>
                  {s.role === 'superadmin'
                    ? 'Super admin'
                    : s.role === 'tenant'
                      ? 'Cliente'
                      : 'Pantalla'}
                </td>
                <td>
                  <Badge tone={s.connected ? 'green' : 'gray'}>
                    {s.connected ? 'Conectado' : 'Sin socket'}
                  </Badge>
                </td>
                <td>{date(s.last_seen_at)}</td>
                <td>{date(s.expires_at)}</td>
                <td>
                  <Button variant="danger" onClick={() => setRevoking(s)}>
                    Revocar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {revoking && (
        <Confirm
          title="Revocar sesión"
          detail={
            'Se cerrará inmediatamente el acceso de ' +
            revoking.name +
            '. Si es un player, volverá a mostrar la base y solicitará una nueva vinculación.'
          }
          onClose={() => setRevoking(null)}
          onConfirm={() => mutate('/admin/sessions/' + revoking.id, { method: 'DELETE' })}
        />
      )}
    </>
  );
}
export function BaseSignal({ data, mutate, go }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [id, setId] = useState(data.base_playlist_id || '');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await mutate(
        '/admin/base',
        { method: 'PUT', body: { playlist_id: id || null } },
        'Señal base actualizada en todas las pantallas.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="LA SEÑAL QUE ACOMPAÑA A TODOS"
        title="Transmisión base"
        detail="Una playlist general para todos tus clientes, en reproducción continua 24/7."
      />
      <div className="base-settings">
        <div className="base-preview">
          <img
            src={
              data.playlists.find((p) => p.id === data.base_playlist_id)?.items[0]?.url ||
              '/demo/base.svg'
            }
            alt="Transmisión base actual"
          />
          <Badge>Señal general</Badge>
        </div>
        <section className="panel">
          <Radio size={28} />
          <h2>Siempre presente.</h2>
          <p>
            La capa base sigue reproduciéndose detrás del contenido del cliente. Al volver, aparece
            en el punto en el que está.
          </p>
          <Field label="Playlist general">
            <select value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Fondo de continuidad Fullscreen</option>
              {data.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <FormError error={error} />
          <Button busy={busy} onClick={save}>
            Actualizar transmisión base
          </Button>
          <Button variant="secondary" onClick={() => go('playlists')}>
            Gestionar playlists generales
          </Button>
        </section>
      </div>
    </>
  );
}
export function Account({ user, mutate, go }) {
  return (
    <>
      <Heading eyebrow="TU ACCESO A FULLSCREEN" title="Mi cuenta" detail={user.email} />
      <div className="panel account-panel">
        <h2>Cambiar contraseña</h2>
        <p>Al guardar, se revocarán todas tus sesiones y deberás volver a ingresar.</p>
        <ActionForm
          onClose={() => go('overview')}
          label="Actualizar contraseña"
          onSave={async (f) => {
            if (f.get('new_password') !== f.get('confirm'))
              throw new Error('Las contraseñas no coinciden.');
            await mutate('/auth/password', {
              method: 'POST',
              body: {
                current_password: f.get('current_password'),
                new_password: f.get('new_password'),
              },
            });
          }}
        >
          <Field label="Contraseña actual">
            <input
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Nueva contraseña">
            <input
              type="password"
              name="new_password"
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Repetir nueva contraseña">
            <input
              type="password"
              name="confirm"
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
              required
            />
          </Field>
        </ActionForm>
      </div>
    </>
  );
}
