# 🚑 QR Emergencias App - Sistema Médico de Respuesta Rápida

Sistema integral para la gestión y generación de fichas médicas de emergencia accesibles mediante códigos QR. Diseñado específicamente para que paramédicos, socorristas y personal de ambulancia accedan en cuestión de segundos a información clínica vital (grupo sanguíneo, alergias severas, patologías preexistentes y contactos de emergencia directos).

---

## 📁 Estructura del Proyecto

```text
qr-emergencias-app/
├── .github/
│   └── workflows/
│       └── test.yml             # Automatización CI/CD con GitHub Actions
├── public/                      # Archivos estáticos para el Frontend
│   ├── css/
│   │   └── styles.css           # Estilos generales y modo alto contraste paramédico
│   ├── js/
│   │   └── dashboard.js         # Lógica del panel de administración (crear, editar perfiles)
│   ├── emergency.html           # Vista móvil ultra rápida que escanean los paramédicos
│   └── dashboard.html           # Panel privado para que el usuario gestione sus fichas
├── .env.example                 # Plantilla de variables de entorno (oculta tus secretos)
├── .dockerignore                # Archivos a ignorar por Docker
├── .gitignore                   # Archivos a ignorar por Git (node_modules, .env, etc.)
├── Dockerfile                   # Configuración para empaquetar el backend en contenedor
├── app.js                       # Configuración de Express y rutas (ideal para Jest)
├── server.js                    # Archivo principal que enciende el servidor Node.js
├── package.json                 # Dependencias y scripts de Node.js
└── README.md                    # Documentación profesional del proyecto
```

---

## ⚡ Características Principales

1. **Vista Móvil Paramédica de Carga Instantánea (`emergency.html`)**:
   - Grupo sanguíneo y factor Rh en tamaño extra grande y alto contraste.
   - Botón de llamada directa al contacto de emergencia principal en 1 toque.
   - Enlace directo a WhatsApp con mensaje de rescate predefinido.
   - Alertas críticas destacadas en rojo (alergias a medicamentos como penicilina, AINEs, etc.).
   - Síntesis de voz integrada (Web Speech API) para que el paramédico pueda escuchar el resumen clínico mientras atiende al paciente.
   - Localización GPS en un clic para compartir la ubicación exacta del incidente.
   - Soporte de almacenamiento en caché para visualización offline en zonas sin cobertura.

2. **Panel de Gestión Integral (`dashboard.html` / `dashboard.js`)**:
   - Creación, edición y eliminación de múltiples fichas médicas familiares o institucionales.
   - Generación dinámica de códigos QR en alta resolución.
   - Descarga de códigos QR en formato PNG optimizado.
   - Opción para imprimir la tarjeta de emergencia física en tamaño credencial/billetera.
   - Búsqueda en vivo por nombre, RUT/DNI o grupo sanguíneo.

3. **Arquitectura Backend Profesional (`app.js` + `server.js`)**:
   - Desacople de Express y HTTP Server para pruebas unitarias sencillas (`Supertest`/`Jest`).
   - Generación de códigos QR mediante librería nativa `qrcode`.
   - Cabeceras de seguridad HTTP con `helmet` y soporte para `cors`.
   - Apagado controlado del servidor (`Graceful Shutdown` ante señales `SIGINT` y `SIGTERM`).

4. **CI/CD y Contenerización**:
   - `Dockerfile` ligero basado en Alpine Linux ejecutado con usuario no-root por seguridad.
   - Pipeline de GitHub Actions en `.github/workflows/test.yml` con matriz para Node.js 18.x y 20.x.

---

## 🚀 Requisitos Previos

- **Node.js** v18.0.0 o superior
- **npm** v9.0.0 o superior
- *(Opcional)* **Docker** y **Docker Compose** para ejecución en contenedores.

---

## 💻 Instalación y Uso Local

### 1. Clonar o ingresar a la carpeta
```bash
cd qr-emergencias-app
```

### 2. Configurar variables de entorno
Copia la plantilla `.env.example` a un nuevo archivo `.env`:
```bash
cp .env.example .env
```

### 3. Instalar dependencias
```bash
npm install
```

### 4. Iniciar en modo desarrollo o producción

**Modo Desarrollo (con reinicio automático al guardar cambios):**
```bash
npm run dev
```

**Modo Producción:**
```bash
npm start
```

### 5. Abrir en el navegador
> **Nota de puerto**: Si el puerto `3000` está ocupado por otro servicio en tu sistema, la app selecciona automáticamente el puerto libre siguiente (`3001`).

- **Panel de Administración**: [http://localhost:3001/dashboard.html](http://localhost:3001/dashboard.html) (o [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html))
- **Ficha Demo 1 (O+)**: [http://localhost:3001/emergency.html?id=demo-123](http://localhost:3001/emergency.html?id=demo-123)
- **Ficha Demo 2 (A-)**: [http://localhost:3001/emergency.html?id=demo-456](http://localhost:3001/emergency.html?id=demo-456)
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)

---

## 🐳 Ejecución con Docker

### Construir la imagen
```bash
docker build -t qr-emergencias-app .
```

### Ejecutar el contenedor
```bash
docker run -d -p 3000:3000 --name qr-app qr-emergencias-app
```

Accede a la aplicación en `http://localhost:3000`.

---

## 📡 Referencia de API REST

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health` | Chequeo de estado y tiempo activo del servicio |
| `GET` | `/api/v1/emergency/:publicToken` | **Público**: Acceso instantáneo a datos vitales por token seguro del QR |
| `POST` | `/api/v1/profiles` (o `/api/profiles`) | Crear nueva ficha médica y generar automáticamente su código QR |
| `GET` | `/api/profiles` | Listado resumido de todas las fichas (para el Dashboard) |
| `GET` | `/api/profiles/:id` | Obtener la información clínica completa de un paciente |
| `PUT` | `/api/profiles/:id` | Actualizar los datos de una ficha médica existente |
| `PATCH` | `/api/profiles/:id/status` | **Seguridad**: Activar / Pausar el código QR de un paciente |
| `DELETE` | `/api/profiles/:id` | Eliminar permanentemente una ficha médica |
| `GET` | `/api/profiles/:id/qr` | Retorna JSON con `dataUrl` o descarga directa con `?format=png` |

---

## 🧪 Pruebas Automatizadas

Para ejecutar las pruebas del proyecto:
```bash
npm test
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta libre para uso personal o comercial.
