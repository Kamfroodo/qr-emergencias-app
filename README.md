# QR Emergencias

Aplicación web para crear y administrar perfiles médicos de emergencia y compartir su información esencial mediante códigos QR. El titular gestiona sus perfiles desde un panel privado; una persona que escanee un QR puede consultar la ficha activa para ayudar durante una emergencia.

> **Privacidad:** una ficha activa se puede consultar sin iniciar sesión mediante su enlace o código QR. Comparte el QR solo con conocimiento y consentimiento de la persona titular. No uses datos médicos reales hasta configurar y revisar la seguridad de producción, la base de datos y el cumplimiento normativo aplicable.

## Contenido

- [Funciones](#funciones)
- [Tecnologías](#tecnologías)
- [Estructura](#estructura)
- [Requisitos](#requisitos)
- [Instalación local](#instalación-local)
- [Configuración](#configuración)
- [Uso](#uso)
- [Supabase](#supabase)
- [API y Swagger](#api-y-swagger)
- [Pruebas y CI](#pruebas-y-ci)
- [Docker y producción](#docker-y-producción)
- [Seguridad y operación](#seguridad-y-operación)
- [Licencia](#licencia)

## Funciones

- Registro, inicio de sesión y autenticación con JWT.
- Panel React para listar, buscar, crear y editar perfiles médicos.
- Gestión de datos personales, grupo sanguíneo, contactos de emergencia, alergias, condiciones, medicamentos, seguro y notas clínicas.
- Activación y pausa de fichas; pausar una ficha revoca el acceso público asociado a su QR.
- Generación, vista, descarga e impresión de códigos QR.
- Vista pública para emergencias con información clínica seleccionada.
- Persistencia en Supabase PostgreSQL; en desarrollo puede usarse almacenamiento en memoria.
- Documentación interactiva de la API con Swagger UI.
- Build de React y pruebas automatizadas en GitHub Actions.

## Tecnologías

| Área | Tecnologías |
| --- | --- |
| Backend | Node.js, Express |
| Frontend | React, JavaScript, HTML y CSS |
| Base de datos | Supabase PostgreSQL |
| Autenticación | JSON Web Tokens y bcrypt |
| QR | `qrcode` |
| API | OpenAPI 3 y Swagger UI Express |
| Build | esbuild |
| Calidad | `node:test`, GitHub Actions |
| Contenedores | Docker, Node.js Alpine |

## Estructura

```text
.
├── .github/workflows/test.yml   # Build y pruebas en GitHub Actions
├── public/
│   ├── css/                     # Estilos del panel y la vista de emergencia
│   ├── js/                      # Autenticación y bundle generado de React
│   ├── dashboard.html           # Entrada del panel
│   ├── emergency.html           # Vista pública abierta desde el QR
│   └── login.html               # Registro e inicio de sesión
├── src/dashboard.jsx            # Componentes del panel React
├── test/                        # Pruebas de integración HTTP
├── .dockerignore
├── .env.example                 # Plantilla de configuración, sin secretos
├── Dockerfile                   # Build multi-stage de la aplicación
├── app.js                       # Aplicación Express y rutas; no abre un puerto
├── auth.js                      # API de autenticación y middleware JWT
├── db.js                        # Acceso a Supabase y fallback local de desarrollo
├── openapi.js                   # Especificación OpenAPI
├── package.json
├── package-lock.json            # Versiones reproducibles para npm ci
├── server.js                    # Inicio del servidor HTTP
└── supabase_schema.sql          # Esquema inicial de la base de datos
```

`public/js/dashboard.bundle.js` se genera a partir de `src/dashboard.jsx`. El Dockerfile y GitHub Actions lo compilan durante sus respectivos builds.

## Requisitos

- Node.js 22 o superior y npm.
- Supabase para guardar usuarios y perfiles de forma persistente.
- Docker Engine, opcional, para ejecutar la imagen.

## Instalación local

1. Clona el repositorio y entra en su directorio:

   ```bash
   git clone https://github.com/Kamfroodo/qr-emergencias-app.git
   cd qr-emergencias-app
   ```

2. Crea tu archivo local de variables de entorno:

   **PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

   **Linux/macOS**
   ```bash
   cp .env.example .env
   ```

3. Instala las dependencias respetando el lockfile y compila el panel:

   ```bash
   npm ci
   npm run build:dashboard
   ```

4. Inicia el servidor:

   ```bash
   npm run dev
   ```

   `npm run dev` usa nodemon para reiniciar el servidor cuando cambian los archivos del backend. Si editas el JSX del panel, vuelve a ejecutar `npm run build:dashboard`.

5. Abre [http://localhost:3000/login.html](http://localhost:3000/login.html). Si el puerto está ocupado en desarrollo, el servidor intenta el siguiente puerto libre e informa la dirección en la terminal.

Para iniciar sin nodemon, ejecuta `npm start`.

## Configuración

Completa `.env` con la configuración apropiada para tu entorno:

| Variable | Desarrollo | Producción |
| --- | --- | --- |
| `PORT` | Puerto local, normalmente `3000` | Puerto del contenedor: `3000` |
| `NODE_ENV` | `development` | `production` |
| `BASE_URL` | URL local, por ejemplo `http://localhost:3000` | Dominio público con HTTPS, por ejemplo `https://emergencias.tudominio.cl` |
| `SUPABASE_URL` | URL del proyecto Supabase o vacío para modo local | URL real del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Puede quedar vacía si no usas Supabase | Clave de servidor secreta de Supabase |
| `JWT_SECRET` | Secreto local; no lo compartas | Secreto aleatorio de al menos 32 bytes |
| `JWT_EXPIRES_IN` | `24h` | Duración de sesión deseada, por ejemplo `24h` |

Genera un secreto JWT en vez de usar un valor de ejemplo:

**PowerShell**
```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**Linux/macOS**
```bash
openssl rand -hex 32
```

En producción, el servidor rechaza la configuración si falta `JWT_SECRET`, la conexión a Supabase o una `BASE_URL` HTTPS. `SUPABASE_SERVICE_ROLE_KEY` tiene privilegios elevados: mantenla solo en el entorno del servidor. Nunca publiques `.env`, incluyas sus valores en una imagen Docker ni los guardes en el repositorio.

El modo de memoria local es únicamente para desarrollo: los datos no persisten al reiniciar y no se comparten entre instancias.

## Uso

1. Registra una cuenta desde la página de acceso.
2. Inicia sesión para abrir el panel.
3. Crea un perfil médico y completa los campos necesarios.
4. Usa la opción del perfil para mostrar, descargar o imprimir su QR.
5. La persona que escanee el QR podrá consultar la ficha mientras esté activa. Puedes pausar o eliminar el perfil desde el panel.

Las fichas están asociadas a la cuenta que las creó. Las rutas privadas requieren el JWT de esa sesión.

## Supabase

1. Crea un proyecto de Supabase.
2. Ejecuta el contenido de `supabase_schema.sql` en el SQL Editor del proyecto.
3. Configura `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno local o en el gestor de secretos del servidor.
4. Reinicia la aplicación y comprueba `GET /health`; el campo `database` debe mostrar `supabase_cloud`.

El backend usa exclusivamente `SUPABASE_SERVICE_ROLE_KEY` para comunicarse con Supabase. No uses la clave `anon`/`publishable` ni incluyas la clave de servidor en el frontend. El esquema mantiene RLS habilitado, revoca el acceso directo de `anon` y `authenticated`, y concede operaciones de datos solo a `service_role`; las consultas públicas de emergencia pasan por el endpoint de la aplicación, que devuelve los campos previstos para emergencias. Revisa las copias de seguridad y las reglas de retención con los requisitos de privacidad aplicables.

## API y Swagger

Con el servidor iniciado:

- Swagger UI: `http://localhost:3000/api-docs`
- Especificación OpenAPI JSON: `http://localhost:3000/api-docs.json`
- Health check: `http://localhost:3000/health`

Para probar rutas protegidas desde Swagger:

1. Ejecuta `POST /api/auth/login` con una cuenta.
2. Copia el campo `token` de la respuesta.
3. Pulsa **Authorize** y pega el JWT. Swagger añade el esquema `Bearer`.
4. Prueba las rutas privadas de autenticación o perfiles.

La tabla resume las rutas principales:

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/health` | Público | Estado del servicio y conexión a base de datos |
| `POST` | `/api/auth/register` | Público | Registrar usuario |
| `POST` | `/api/auth/login` | Público | Iniciar sesión y obtener JWT |
| `GET` | `/api/auth/me` | JWT | Consultar usuario autenticado |
| `POST` | `/api/auth/verify` | Público | Validar un JWT |
| `GET` | `/api/v1/emergency/:publicToken` | Público | Consultar la información de emergencia de una ficha activa |
| `GET` | `/api/profiles` | JWT | Listar los perfiles del usuario |
| `GET` | `/api/profiles/:id` | JWT | Consultar un perfil propio |
| `POST` | `/api/profiles` | JWT | Crear un perfil y generar su QR |
| `POST` | `/api/v1/profiles` | JWT | Ruta compatible para crear perfiles |
| `PUT` | `/api/profiles/:id` | JWT | Actualizar un perfil propio |
| `PATCH` | `/api/profiles/:id/status` | JWT | Activar o pausar el QR |
| `DELETE` | `/api/profiles/:id` | JWT | Eliminar un perfil propio |
| `GET` | `/api/profiles/:id/qr` | JWT | Obtener la Data URL del QR o descargar PNG con `?format=png` |

## Pruebas y CI

Ejecuta build y pruebas localmente:

```bash
npm run build:dashboard
npm test
```

Las pruebas usan el runner integrado `node:test` y solicitudes HTTP de Node.js; no hace falta instalar Jest ni Supertest para la cobertura actual. Comprueban el token QR inexistente, la actualización autenticada de perfiles, el aislamiento entre usuarios y la disponibilidad de Swagger.

GitHub Actions ejecuta `npm ci`, compila el panel React y corre `npm test` con Node.js 22 y 24 en los eventos configurados en `.github/workflows/test.yml`.

## Docker y producción

La imagen compila React en una etapa de build, instala dependencias de producción desde `package-lock.json`, ejecuta Node con un usuario sin privilegios e incluye un health check. `.dockerignore` excluye `.env` y los archivos locales del contexto.

1. Configura `.env` con `NODE_ENV=production`, `PORT=3000`, el dominio HTTPS en `BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y un `JWT_SECRET` seguro.
2. Construye la imagen desde la raíz del proyecto:

   ```bash
   docker build -t qr-emergencias-app .
   ```

3. Inicia el contenedor ligado a localhost para colocarlo detrás de un proxy HTTPS como Nginx o Caddy:

   ```bash
   docker run -d --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env --name qr-app qr-emergencias-app
   ```

4. Comprueba el estado:

   ```bash
   docker ps
   docker logs qr-app
   curl http://localhost:3000/health
   ```

Para una prueba local directa, publica el puerto con `-p 3000:3000`. En un servidor público, configura HTTPS, expón solo los puertos necesarios del proxy y no publiques directamente el puerto interno de Node.

## Seguridad y operación

- Las fichas activas se publican mediante un QR; el enlace permite consultar datos médicos sin autenticación para facilitar la respuesta de emergencia.
- Usa HTTPS y secretos únicos en producción. No compartas ni registres JWT o claves de Supabase.
- Confirma que la base de datos, sus políticas de acceso, copias de seguridad y retención son adecuadas para datos sensibles.
- El endpoint público de salud informa el estado de conexión; no sustituye la monitorización ni los respaldos.
- Valida las obligaciones de privacidad y protección de datos aplicables antes de guardar información médica real.

## Licencia

El manifiesto `package.json` declara la licencia MIT para el proyecto.
