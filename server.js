/**
 * server.js - Servidor principal de Node.js
 * Inicia el servicio Express y gestiona el ciclo de vida y apagado controlado.
 */

require('dotenv').config();
const app = require('./app');

const INITIAL_PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

let currentServer = null;

function startServer(port) {
  const server = app.listen(port);
  currentServer = server;

  server.on('listening', () => {
    if (!process.env.BASE_URL || process.env.BASE_URL.includes(':3000')) {
      process.env.BASE_URL = `http://localhost:${port}`;
    }

    console.log('\n=============================================================');
    console.log('   🚑 QR EMERGENCIAS APP - SERVICIO MÉDICO INICIADO');
    console.log('=============================================================');
    console.log(` > Entorno actual      : ${NODE_ENV}`);
    console.log(` > Puerto en escucha   : ${port}`);
    console.log(` > Panel de Control    : http://localhost:${port}/dashboard.html`);
    console.log(` > Ficha Demo 1 (O+)   : http://localhost:${port}/emergency.html?id=demo-123`);
    console.log(` > Ficha Demo 2 (A-)   : http://localhost:${port}/emergency.html?id=demo-456`);
    console.log(` > Health Check        : http://localhost:${port}/health`);
    console.log('=============================================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`[AVISO] El puerto ${port} está ocupado por otra aplicación en tu sistema.`);
      console.log(`[INFO] Intentando iniciar automáticamente en el puerto ${nextPort}...`);
      startServer(nextPort);
    } else {
      console.error('[ERROR] Error inesperado en el servidor:', err);
    }
  });
}

startServer(INITIAL_PORT);

// Manejo de apagado elegante (Graceful Shutdown)
function handleShutdown(signal) {
  console.log(`\n[${signal}] Recibido. Cerrando conexiones y apagando servidor con seguridad...`);
  if (currentServer) {
    currentServer.close(() => {
      console.log('[OK] Servidor HTTP cerrado correctamente.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Forzar cierre si no responde en 5 segundos
  setTimeout(() => {
    console.error('[WARN] Cierre forzado por tiempo de espera excedido.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

