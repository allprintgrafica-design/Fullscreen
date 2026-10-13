# Probar Fullscreen en tu equipo

El ZIP contiene el código y contenido de demostración. La instalación crea una base SQLite y un secreto de sesión nuevos **en tu equipo**. No contiene credenciales, sesiones ni la base de datos del entorno en la nube.

## 1. Preparar el equipo

Instala **Node.js 24 o superior** (con npm) y **FFmpeg**, que incluye FFprobe para analizar videos.

En Windows, puedes instalarlos desde PowerShell con:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
```

Cierra y vuelve a abrir la terminal después de instalar. Si no tienes `winget`, instala Node.js desde su sitio oficial y FFmpeg mediante un instalador que agregue sus ejecutables al PATH.

En macOS, si ya tienes Homebrew:

```bash
brew install node ffmpeg
```

En Ubuntu/Debian, instala Node.js 24+ y agrega FFmpeg con:

```bash
sudo apt update
sudo apt install ffmpeg
```

Comprueba los requisitos:

```bash
node --version
npm --version
ffprobe -version
```

La versión de Node debe comenzar con `v24` o un número superior.

## 2. Extraer e iniciar

1. Extrae `Fullscreen-local.zip`. Obtendrás una carpeta llamada `Fullscreen`.
2. Abre una terminal **dentro de esa carpeta**, donde están `package.json` y `README.md`.
3. Ejecuta los comandos, uno por uno:

```bash
npm ci
npm run seed
npm run dev
```

`npm ci` requiere Internet para descargar las dependencias. `seed` crea las cuentas de demostración, imágenes, playlist, pantallas y un archivo `.env` con un secreto aleatorio. No sobrescribe usuarios ni `.env` existentes.

Mantén abierta la terminal. En el navegador **de ese mismo equipo**, abre:

```text
http://localhost:5173
```

La API usa el puerto 3001 y el frontend el 5173. Ambos deben estar disponibles.

## 3. Accesos de demostración

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Cliente | `cliente@fullscreen.local` | `ClienteDemo2026!` |
| Super administrador | `admin@fullscreen.local` | `AdminDemo2026!` |

Para mantener abiertos ambos paneles a la vez, usa una ventana normal y otra de incógnito, o dos perfiles de navegador. Cada perfil mantiene una sesión de usuario.

## 4. Primera prueba: cliente y pantalla

1. Entra con la cuenta **Cliente**.
2. Abre **Pantallas**. Ya hay dos dispositivos de demostración.
3. En **Recepción principal**, pulsa **Generar PIN** y confirma la nueva vinculación.
4. En el diálogo que muestra el PIN, pulsa **Abrir player**. Se abrirá otra pestaña.
5. Ingresa el PIN de seis dígitos en el player. Tiene un único uso y vence después de 15 minutos.
6. Comprueba que se vea la señal general y que la pantalla aparezca **En línea** en el panel.
7. Selecciona **Bienvenida y bienestar** y pulsa **Transmitir de inmediato**.
8. Comprueba que el player muestre el contenido de la clínica. Pulsa **Volver a transmisión base** para interrumpirlo.
9. Transmite otra vez y deja terminar la playlist: volverá automáticamente a la base.

El botón de la esquina inferior derecha del player solicita pantalla completa. La pestaña del player representa una pantalla física para esta prueba.

## 5. Probar las demás funciones

- **Biblioteca:** sube una imagen PNG/JPG/WebP/GIF o un video MP4/WebM. Los límites del paquete se validan en el servidor.
- **Playlists:** crea una secuencia con tus archivos y sus tiempos.
- **Programación:** agrega un bloque para el día y la hora actuales, eligiendo la zona horaria de tu ubicación. Mantén abierto el player para observar el cambio automático.
- **Super administrador:** desde otra ventana, revisa **Clientes**, **Paquetes** y **Sesiones activas**. Revoca la sesión de la pantalla de prueba: el player solicitará una nueva vinculación.
- **Video base:** desde la biblioteca del administrador sube un MP4, crea una playlist general y asígnala en **Transmisión base**. Transmite una imagen del cliente y vuelve a la base para observar que el video continuó por detrás.

## 6. Cerrar y volver a abrir

Para detenerla, pulsa `Ctrl+C` en la terminal. Para volver a usarla, abre la misma carpeta y ejecuta:

```bash
npm run dev
```

Los datos se conservan en `data/`. No necesitas repetir `npm ci` ni `seed` en cada inicio.

## Si algo no funciona

| Mensaje o problema | Qué comprobar |
| --- | --- |
| `node` o `npm` no se reconoce | Instala Node.js y abre una terminal nueva. |
| Error con `node:sqlite` | Comprueba que Node.js sea 24 o superior. |
| No encuentra `package.json` | Abre la terminal dentro de la carpeta `Fullscreen`. |
| No encuentra `ffprobe` al subir videos | Instala FFmpeg con sus ejecutables en el PATH y reinicia la terminal. |
| Puerto 5173 o 3001 ocupado | Cierra una ejecución anterior de esta aplicación o el programa que usa ese puerto. |
| PIN incorrecto, vencido o utilizado | Genera un PIN nuevo desde Pantallas y úsalo en su player. |
| El navegador no abre la aplicación | Comprueba que `npm run dev` siga activo y abre `http://localhost:5173` en el mismo equipo. |

Las cuentas incluidas son para esta prueba local. La instalación de producción, los modelos y la API están documentados en `README.md`.
