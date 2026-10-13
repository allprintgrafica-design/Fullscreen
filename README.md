# Fullscreen · Digital Signage SaaS

Aplicación multi-tenant de cartelería digital con **React 19 + Tailwind CSS 4**, **Node.js + Express 5**, **Socket.io** y **SQLite**. Incluye panel del propietario, panel privado por cliente y player de dos capas en `/player/:id_pantalla`.

Para probar el proyecto desde un ZIP en tu equipo, sigue [PRUEBA_LOCAL.md](PRUEBA_LOCAL.md).

En Windows puedes iniciar la demostración haciendo doble clic en **`INICIAR_FULLSCREEN.cmd`** dentro de la carpeta extraída. Instala las dependencias en esa carpeta, conserva los datos entre inicios y abre el navegador cuando el servidor está disponible.

## Ejecutar

Requisitos: **Node.js 24+**, npm y **FFprobe** (incluido en FFmpeg). No requiere un servicio de base de datos externo.

```bash
npm ci
npm run seed     # Demo local: crea datos, usuarios y .env con secreto aleatorio
npm run dev
```

Frontend: puerto **5173**. API: puerto **3001**. Vite reenvía `/api` y `/socket.io` al backend. Usa el origen configurado en `APP_ORIGIN`.

Credenciales **exclusivas de demostración**:

| Rol         | Correo                     | Contraseña         |
| ----------- | -------------------------- | ------------------ |
| Propietario | `admin@fullscreen.local`   | `AdminDemo2026!`   |
| Cliente     | `cliente@fullscreen.local` | `ClienteDemo2026!` |

`seed` no sobrescribe bases con usuarios ni reemplaza `.env`; se niega a ejecutarse en producción. Los SVG de la demo son recursos confiables del proyecto: **se prohíbe cargar SVG de usuarios**.

```bash
npm test        # Integración HTTP/WebSocket y programación, con bases temporales
npm run test:e2e # Chromium: paneles, móvil, base continua, overlay y revocación
npm run build  # Compilar frontend
APP_ORIGIN=http://localhost:3001 npm start # Demo compilada: API y frontend en 3001
```

La prueba E2E levanta servicios aislados en 3002/5174 y una base temporal; requiere FFmpeg y Chromium. Usa `/usr/bin/chromium` si existe. También puedes definir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` o instalar el navegador con `npx playwright install chromium`.

## Flujo funcional

1. El propietario crea **Paquetes** y **Clientes**, y configura **Transmisión base** usando su biblioteca y playlists generales.
2. El cliente sube medios a **Biblioteca**, crea una **Playlist** y agrega una **Pantalla**.
3. Abre el player en el dispositivo físico e ingresa su PIN: seis dígitos, 15 minutos de validez, un solo uso. Generar un nuevo PIN desvincula el dispositivo anterior.
4. **Programación** define bloques semanales por pantalla con zona horaria IANA. Los bloques nocturnos terminan al día siguiente. Ante superposición gana el último creado; al finalizar se recalcula el bloque que corresponda.
5. **Transmitir de inmediato** ejecuta una playlist una vez, con prioridad sobre la programación. El player informa su finalización; también hay un plazo de respaldo del servidor.
6. **Volver a transmisión base** oculta inmediatamente el contenido local. El bloque programado activo queda interrumpido hasta su final; el siguiente bloque vuelve a funcionar.
7. **Sesiones activas** permite revocar cualquier acceso. Suspender un cliente revoca las sesiones del usuario y sus players.

Los videos se reproducen silenciados para permitir autoplay. El botón del player solicita pantalla completa; el navegador exige una interacción. Para operación sin intervención, configura el modo kiosco del navegador/SO.

## Estructura

```text
server/
  schema.sql      Tablas, relaciones, restricciones e índices
  db.js           SQLite WAL, transacciones y auditoría
  auth.js         JWT, cookies HttpOnly, sesiones y CSRF
  app.js          Endpoints, autorización, cuotas y cargas
  realtime.js     Socket.io, salas, revocación y sincronización
  scheduler.js    Programación semanal y prioridad manual
  index.js        Inicio y cierre ordenado
  seed.js         Demostración local
src/
  App.jsx         Login, navegación y conexión del panel
  Panels.jsx      Paneles del propietario y del cliente
  Player.jsx      Base persistente, overlay y secuencia multimedia
  api.js          Cliente HTTP con cookies y CSRF
  ui.jsx          Componentes comunes
  styles.css      Tailwind y diseño adaptativo
public/demo/     Contenido visual de demostración
tests/           Pruebas HTTP/WebSocket y horarios
data/            SQLite y multimedia; ignorado por Git
```

## Modelo relacional

| Tabla               | Contenido y relaciones                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `packages`          | MB, archivos y pantallas máximos                                                        |
| `tenants`           | Cliente, estado y FK al paquete                                                         |
| `users`             | Correo único, hash bcrypt, rol y FK a tenant; propietario sin tenant                    |
| `sessions`          | JTI, usuario **o** pantalla, expiración, actividad y revocación persistente             |
| `screens`           | FK a tenant, PIN hasheado/expiración, conexión y prioridad manual                       |
| `media`             | FK a tenant, nombre UUID, MIME real, bytes y duración; medios generales con tenant NULL |
| `playlists`         | FK a tenant y revisión; playlists generales con tenant NULL                             |
| `playlist_items`    | FK a playlist/media, posición y duración                                                |
| `schedules`         | FK a tenant/pantalla/playlist, día, horas, zona IANA y estado                           |
| `platform_settings` | Playlist de la transmisión general                                                      |
| `audit_events`      | Actor, tenant, acción y fecha                                                           |

Las FK están habilitadas. El servidor obtiene el tenant de la sesión y nunca acepta un `tenant_id` enviado por el usuario. Cada referencia a medios, playlists, pantallas u horarios se valida contra ese tenant. Las reducciones de paquete no pueden quedar por debajo del consumo existente.

## API

Prefijo: `/api`. Login y vinculación establecen cookies **HttpOnly, SameSite=Strict**; en producción también **Secure**. Los JWT de usuario duran 8 horas, los de player 30 días. Cada petición valida su JTI persistente, la expiración y el estado del tenant. El player renueva la sesión cada 12 horas, revocando el JWT anterior.

Todas las mutaciones autenticadas requieren `X-CSRF-Token`, obtenido del login o de `/auth/me`; los players lo recuperan con `/player/:screenId/state`. No se guardan JWT en localStorage/sessionStorage ni en enlaces multimedia. Para integraciones se admite Bearer, sujeto a las mismas validaciones de sesión y CSRF.

| Método      | Ruta                        | Rol / propósito                                                |
| ----------- | --------------------------- | -------------------------------------------------------------- |
| GET         | `/health`                   | Público: estado y consulta real a SQLite                       |
| POST        | `/auth/login`               | Público: `{email,password}`                                    |
| GET         | `/auth/me`                  | Usuario: sesión y CSRF                                         |
| POST        | `/auth/logout`              | Usuario: revocar y cerrar                                      |
| POST        | `/auth/password`            | Usuario: cambiar contraseña y revocar todas sus sesiones       |
| GET         | `/overview`                 | Usuario: métricas y actividad según rol                        |
| GET, POST   | `/admin/packages`           | Propietario: listar/crear paquetes                             |
| PUT         | `/admin/packages/:id`       | Propietario: editar límites                                    |
| GET, POST   | `/admin/tenants`            | Propietario: listar/crear clientes                             |
| PUT         | `/admin/tenants/:id`        | Propietario: editar nombre, paquete y estado                   |
| GET         | `/admin/sessions`           | Propietario: sesiones válidas y conexión actual                |
| DELETE      | `/admin/sessions/:id`       | Propietario: revocación instantánea                            |
| PUT         | `/admin/base`               | Propietario: `{playlist_id: UUID o null}`                      |
| GET, POST   | `/media`                    | Usuario: biblioteca propia/carga multipart `file`              |
| GET         | `/media/:id/content`        | Cookie autenticada; player agrega `?screen=UUID`; admite Range |
| DELETE      | `/media/:id`                | Usuario: eliminar medios sin referencias de playlists          |
| GET, POST   | `/playlists`                | Usuario: listar/crear playlists propias                        |
| PUT, DELETE | `/playlists/:id`            | Usuario: editar/eliminar playlist propia                       |
| GET, POST   | `/screens`                  | Cliente: listar/crear `{name}`                                 |
| PUT, DELETE | `/screens/:id`              | Cliente: renombrar/eliminar pantalla                           |
| POST        | `/screens/:id/pin`          | Cliente: nuevo PIN y revocación del anterior dispositivo       |
| POST        | `/screens/:id/playback`     | Cliente: `{mode:'client',playlist_id}` o `{mode:'base'}`       |
| GET, POST   | `/schedules`                | Cliente: listar/crear horarios                                 |
| PUT, DELETE | `/schedules/:id`            | Cliente: editar/eliminar horarios                              |
| POST        | `/player/:screenId/pair`    | Público limitado: `{pin}`                                      |
| GET         | `/player/:screenId/state`   | Player: estado y CSRF                                          |
| POST        | `/player/:screenId/refresh` | Player: renovar cookie/sesión                                  |

Ejemplo de playlist:

```json
{ "name": "Bienvenida", "items": [{ "media_id": "UUID_DEL_ARCHIVO", "duration_seconds": 12 }] }
```

Ejemplo de horario, donde `0=domingo`, `1=lunes`:

```json
{
  "screen_id": "UUID_DE_LA_PANTALLA",
  "playlist_id": "UUID_DE_LA_PLAYLIST",
  "day_of_week": 1,
  "start_time": "09:00",
  "end_time": "18:00",
  "timezone": "America/Argentina/Buenos_Aires",
  "enabled": true
}
```

## WebSockets y capas

Handshake del panel: `io({withCredentials:true,auth:{csrfToken}})`; el player añade `screenId`. El servidor valida cookie, CSRF y origen. Las salas son `admins`, `tenant:UUID`, `screen:UUID` y `session:JTI`; solo el servidor decide la pertenencia.

| Evento            | Dirección              | Función                                                  |
| ----------------- | ---------------------- | -------------------------------------------------------- |
| `playback:state`  | Servidor → player      | Base, playlist local, modo, runId, motivo y fin          |
| `playback:ended`  | Player → servidor      | `{runId}`: fin manual, rechazando ejecuciones obsoletas  |
| `heartbeat`       | Cliente → servidor     | Actividad autenticada                                    |
| `data:changed`    | Servidor → panel       | Refrescar recursos propios                               |
| `admin:sessions`  | Servidor → propietario | Conexiones y revocaciones en vivo                        |
| `session:revoked` | Servidor → sesión      | Cerrar acceso y desconectar; el player oculta el overlay |

Las órdenes manuales se emiten al completar la petición; el scheduler evalúa la programación cada segundo. La latencia real depende de la red y de la carga del archivo.

`BaseLayer` permanece montado con `z-index:0`. Cambiar la visibilidad del contenido cliente **no modifica ni pausa** su secuencia. Las URLs multimedia son estables y autenticadas con cookies, preservando el video base durante las órdenes. `layer-cliente` tiene `z-index:10`, arranca con `opacity:0`, aparece suavemente una vez que carga su archivo y se oculta sin transición al volver a la base. Siempre hay un fondo de continuidad debajo de los medios para evitar negro durante fallos de carga.

Si se corta la red, los medios ya cargados pueden continuar y el overlay se oculta al vencer el bloque. No se promete obtener archivos nuevos sin conexión. Una revocación mantiene el fondo base local y exige una nueva vinculación; posteriores solicitudes de archivos protegidos se rechazan.

## Instalación real y despliegue

No ejecutes `seed` para producción. Copia `.env.example` a `.env`, configura `ADMIN_EMAIL`, una `ADMIN_PASSWORD` de al menos 12 caracteres y un `JWT_SECRET` aleatorio. La primera ejecución crea el propietario en una base vacía.

```bash
cp .env.example .env
# Generar secreto y editar .env de forma segura:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm ci
npm run build
npm start
```

Configura `NODE_ENV=production`, `APP_ORIGIN=https://tu-dominio` y HTTPS mediante un proxy que soporte WebSockets y Range. `TRUST_PROXY` debe coincidir con el número real de proxies de confianza. Usa almacenamiento persistente para `DATA_DIR` y backups consistentes de SQLite y archivos. No publiques `.env` ni `data/` en Git.

Seguridad: bcrypt, JWT HS256, revocación persistente, Helmet, CSRF, Zod y límites de peticiones. Las cargas verifican firmas, admiten PNG/JPG/WebP/GIF/MP4/WebM, tienen nombres UUID, analizan videos con FFprobe y limpian temporales al fallar. El máximo global es configurable (250 MB por archivo por defecto). Cuotas y registro se realizan dentro de `BEGIN IMMEDIATE`, evitando superar límites con cargas simultáneas.

La implementación funciona con **una instancia de Express** y almacenamiento local. Para múltiples instancias: PostgreSQL, object storage, adaptador Redis de Socket.io y coordinación del scheduler/revocación. No incluye facturación ni un agente nativo de kiosco.
