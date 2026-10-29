/**
 * server.js - Servidor principal de Node.js
 * Inicia el servicio Express y gestiona el ciclo de vida y apagado controlado.
 */

require('dotenv').config();
const INITIAL_PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('Configura JWT_SECRET con al menos 32 bytes aleatorios en producción.');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para persistencia en producción.');
  }
  if (!process.env.BASE_URL || new URL(process.env.BASE_URL).protocol !== 'https:') {
    throw new Error('Configura BASE_URL con el dominio HTTPS público en producción.');
  }
}

const app = require('./app');
let currentServer = null;

function startServer(port) {
  const server = app.listen(port);
  currentServer = server;

  server.on('listening', () => {
    if (!process.env.BASE_URL) {
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
      if (NODE_ENV === 'production') {
        console.error(`[ERROR] El puerto ${port} ya está ocupado en producción.`);
        process.exitCode = 1;
        return;
      }
      const nextPort = port + 1;
      console.warn(`[AVISO] El puerto ${port} está ocupado por otra aplicación en tu sistema.`);
      console.log(`[INFO] Intentando iniciar automáticamente en el puerto ${nextPort}...`);
      startServer(nextPort);
    } else {
      console.error('[ERROR] Error inesperado en el servidor:', err);
      process.exitCode = 1;
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
