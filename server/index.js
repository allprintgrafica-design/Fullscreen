import { createApp } from './app.js';

try {
  const instance = await createApp();
  const port = Number(process.env.PORT || 3001);
  instance.server.listen(port, '0.0.0.0', () =>
    console.log('Fullscreen API escuchando en el puerto ' + port),
  );
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
