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
- Panel de administración para invitar usuarios, revocar o renovar invitaciones, suspender/reactivar cuentas, gestionar roles y eliminar cuentas con sus perfiles.
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
│   ├── admin.html               # Panel protegido de administración de usuarios
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
| `PORT` | Puerto local, normalmente `3000` | Render lo proporciona automáticamente (por defecto `10000`) |
| `NODE_ENV` | `development` | `production` |
| `BASE_URL` | URL local, por ejemplo `http://localhost:3000` | Dominio público con HTTPS, por ejemplo `https://emergencias.tudominio.cl` |
| `SUPABASE_URL` | URL del proyecto Supabase o vacío para modo local | URL real del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Puede quedar vacía si no usas Supabase | Clave de servidor secreta de Supabase |
| `SUPABASE_PHOTO_BUCKET` | `medical-photos` | Nombre del bucket público de fotos en Supabase Storage |
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

En producción, el servidor rechaza el arranque si falta `JWT_SECRET`, la configuración de Supabase o una `BASE_URL` HTTPS válida. `SUPABASE_SERVICE_ROLE_KEY` tiene privilegios elevados: mantenla solo en el entorno del servidor. Nunca publiques `.env`, incluyas sus valores en una imagen Docker ni los guardes en el repositorio.

El modo de memoria local es únicamente para desarrollo: los datos no persisten al reiniciar y no se comparten entre instancias.

## Uso

1. Registra una cuenta desde la página de acceso.
2. Inicia sesión para abrir el panel.
3. Crea un perfil médico y completa los campos necesarios.
4. Ingresa la fecha de nacimiento para calcular automáticamente la edad. Puedes tomar una foto con la cámara del teléfono o elegir una JPG, PNG o WebP de hasta 5 MB.
5. Usa la opción del perfil para mostrar, descargar o imprimir su QR.
6. La persona que escanee el QR podrá consultar la ficha mientras esté activa. Puede obtener la ubicación del teléfono y abrir WhatsApp con una alerta preescrita al contacto principal; quien asiste debe confirmar el envío dentro de WhatsApp. La aplicación web no envía mensajes automáticamente.
7. Puedes pausar o eliminar el perfil desde el panel.

El panel y la ficha pública se adaptan a pantallas móviles. En el teléfono, abre el dominio público en Safari o Chrome; puedes añadirlo a la pantalla de inicio desde el menú del navegador. La captura de fotografía y la geolocalización requieren permisos del navegador y conexión HTTPS.

Las fichas están asociadas a la cuenta que las creó. Las rutas privadas requieren el JWT de esa sesión.

## Supabase

1. Crea un proyecto de Supabase.
2. Ejecuta el contenido de `supabase_schema.sql` en el SQL Editor del proyecto.
3. En **Storage**, crea un bucket público llamado `medical-photos` (o configura `SUPABASE_PHOTO_BUCKET` con el nombre elegido). El bucket debe aceptar JPG, PNG y WebP de hasta 5 MB. Las fotos podrán verse públicamente desde la ficha QR, igual que los otros datos de emergencia; no subas imágenes que no deban ser públicas.
4. Si ya tienes una cuenta, consérvala: las cuentas existentes siguen funcionando. Si necesitas convertir una cuenta existente en administradora, verifica cuidadosamente el correo y ejecuta una sola vez:

   ```sql
   UPDATE public.users
   SET role = 'admin', updated_at = NOW()
   WHERE email = lower('TU_CORREO_EXISTENTE')
   RETURNING id, email, role;
   ```

   Comprueba que se modificó exactamente tu cuenta prevista.
5. Si es una instalación nueva sin usuarios, crea la primera cuenta administradora desde el SQL Editor. Genera primero un hash bcrypt en tu equipo (no uses una contraseña en texto plano en SQL):

   ```powershell
   node -e "const r=require('node:readline').createInterface({input:process.stdin,output:process.stdout});r.question('Contraseña: ',async p=>{console.log(await require('bcryptjs').hash(p,12));r.close()})"
   ```

   Inserta el hash resultante y tu correo en Supabase:

   ```sql
   INSERT INTO public.users (email, password_hash, full_name, role, is_active)
   VALUES (lower('TU_CORREO'), 'PEGA_AQUI_EL_HASH_BCRYPT', 'Tu nombre', 'admin', TRUE)
   RETURNING id, email, role;
   ```

   Guarda la contraseña de forma segura y elimina el hash de cualquier nota temporal.
6. Ejecuta `supabase_access_control.sql` en el SQL Editor **después** de `supabase_schema.sql`. Crea la tabla protegida de invitaciones y las funciones atómicas para crear y aceptar enlaces de un solo uso.
7. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y, si corresponde, `SUPABASE_PHOTO_BUCKET` en el entorno local o en el gestor de secretos del servidor.
8. Reinicia la aplicación, inicia sesión con la cuenta administradora y comprueba `GET /health`; el campo `database` debe mostrar `supabase_cloud`.

El panel de administración permite generar un enlace de invitación, copiarlo y enviarlo manualmente. El enlace vence a los 7 días, solo puede aceptarse una vez y el administrador puede revocarlo o generar otro. La persona invitada establece una contraseña de al menos 12 caracteres. No se envían correos automáticamente. El panel también permite suspender/reactivar cuentas, cambiar roles y eliminar cuentas. La suspensión invalida las sesiones existentes en la siguiente petición. La eliminación borra los perfiles médicos asociados y es irreversible. No expone a los administradores las fichas médicas de otras cuentas.

Si no ejecutas `supabase_access_control.sql`, los endpoints de invitaciones no estarán disponibles en Supabase. El backend usa exclusivamente `SUPABASE_SERVICE_ROLE_KEY`; no incluyas esa clave ni los tokens de invitación en el frontend, capturas o registros.

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
| `POST` | `/api/auth/register` | Público | Registro cerrado; responde `403` y requiere invitación |
| `GET` | `/api/auth/invitation/:token` | Público | Validar una invitación |
| `POST` | `/api/auth/invitation/accept` | Público | Aceptar una invitación y crear la cuenta |
| `POST` | `/api/auth/login` | Público | Iniciar sesión y obtener JWT |
| `GET` | `/api/auth/me` | JWT | Consultar usuario autenticado |
| `POST` | `/api/auth/verify` | JWT | Validar sesión y estado de la cuenta |
| `GET` | `/api/auth/admin/invitations` | Admin | Listar invitaciones sin tokens |
| `POST` | `/api/auth/admin/invitations` | Admin | Crear o renovar un enlace de invitación |
| `POST` | `/api/auth/admin/invitations/:id/revoke` | Admin | Revocar una invitación |
| `GET` | `/api/auth/admin/users` | Admin | Listar cuentas sin datos de contraseña |
| `PATCH` | `/api/auth/admin/users/:id/status` | Admin | Suspender o reactivar una cuenta |
| `PATCH` | `/api/auth/admin/users/:id/role` | Admin | Asignar o retirar el rol de administrador |
| `DELETE` | `/api/auth/admin/users/:id` | Admin | Eliminar una cuenta y sus perfiles médicos |
| `GET` | `/api/v1/emergency/:publicToken` | Público | Consultar la información de emergencia de una ficha activa |
| `GET` | `/api/profiles` | JWT | Listar los perfiles del usuario |
| `GET` | `/api/profiles/:id` | JWT | Consultar un perfil propio |
| `POST` | `/api/profiles` | JWT | Crear un perfil y generar su QR |
| `POST` | `/api/v1/profiles` | JWT | Ruta compatible para crear perfiles |
| `PUT` | `/api/profiles/:id` | JWT | Actualizar un perfil propio |
| `POST` | `/api/profiles/:id/photo` | JWT | Subir una foto JPG, PNG o WebP (máximo 5 MB) al bucket de Storage configurado |
| `PATCH` | `/api/profiles/:id/status` | JWT | Activar o pausar el QR |
| `DELETE` | `/api/profiles/:id` | JWT | Eliminar un perfil propio |
| `GET` | `/api/profiles/:id/qr` | JWT | Obtener la Data URL del QR o descargar PNG con `?format=png` |

## Pruebas y CI

Ejecuta build y pruebas localmente:

```bash
npm run build:dashboard
npm test
```

Las pruebas usan el runner integrado `node:test` y solicitudes HTTP de Node.js; no hace falta instalar Jest ni Supertest para la cobertura actual. Comprueban registro cerrado, creación/aceptación/revocación de invitaciones, perfiles y aislamiento entre usuarios, endpoints de administración, suspensión y eliminación de cuentas, y disponibilidad de Swagger.

GitHub Actions ejecuta `npm ci`, compila el panel React y corre `npm test` con Node.js 22 y 24 en los eventos configurados en `.github/workflows/test.yml`.

## Despliegue en Render

El repositorio incluye `render.yaml` para crear un servicio web desde Docker. El plan `starter` evita que la aplicación entre en suspensión por inactividad. Render despliega automáticamente los cambios que se integren en la rama conectada.

1. En Supabase, aplica `supabase_schema.sql` al proyecto que utilizará producción y confirma que contiene los datos correctos. No uses la base de datos de desarrollo si no quieres compartir sus cuentas y perfiles.
2. En [Render](https://render.com), crea un **Blueprint** y conecta este repositorio. Render leerá `render.yaml` en la raíz y propondrá crear el servicio web.
3. Al configurar el Blueprint, completa los valores solicitados:
   - `SUPABASE_URL`: URL del proyecto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: clave secreta de servidor de ese proyecto.
   - `SUPABASE_PHOTO_BUCKET`: nombre del bucket público de fotos, por defecto `medical-photos`.
   - `BASE_URL`: URL HTTPS que Render asigna al servicio, por ejemplo `https://qr-emergencias-app.onrender.com`.
   - `JWT_SECRET`: Render lo genera automáticamente desde `render.yaml`.

   Si el dominio todavía no aparece al completar la configuración, crea el servicio y establece `BASE_URL` en **Environment** con la URL asignada; luego vuelve a desplegar. No configures `PORT`: Render lo proporciona (por defecto `10000`).
4. Antes del primer deploy de esta versión, ejecuta `supabase_access_control.sql` en el SQL Editor de Supabase y confirma que existe una cuenta con rol `admin`.
5. Espera que el build Docker y el health check `/health` terminen correctamente. Abre el dominio HTTPS de Render e inicia sesión como administrador. Desde el panel genera una invitación y comprueba su aceptación, creación/edición de un perfil y su QR. `/health` debe informar `"database":"supabase_cloud"`.
6. Si es el primer despliegue y aún no hay una cuenta administradora, sigue los pasos de la sección [Supabase](#supabase) para crear una cuenta inicial segura. Las cuentas nuevas posteriores se crean mediante invitaciones.
7. Si más adelante agregas un dominio propio, actualiza `BASE_URL` en Render y vuelve a desplegar. Verifica los enlaces de QR existentes y regenera o reimprime los que todavía apunten al dominio anterior.

La aplicación maneja datos médicos sensibles. Antes de cargar datos reales, revisa las obligaciones legales y de privacidad aplicables, la región de alojamiento, el acceso a respaldos y las condiciones de Supabase y Render. El QR de un perfil activo permite consultar públicamente los campos de emergencia previstos por la aplicación.

## Docker y producción propia

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
- El endpoint público de salud informa el modo de almacenamiento configurado; no comprueba por sí solo una consulta a la base de datos ni sustituye la monitorización o los respaldos.
- Valida las obligaciones de privacidad y protección de datos aplicables antes de guardar información médica real.

## Licencia

El manifiesto `package.json` declara la licencia MIT para el proyecto.
