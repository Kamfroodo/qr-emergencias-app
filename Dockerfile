# Imagen base ligera con Node.js en Alpine Linux
FROM node:20-alpine

# Metadatos del contenedor
LABEL maintainer="Dashboard Emergencias"
LABEL description="Contenedor para la aplicación de fichas médicas y códigos QR de emergencia"

# Establecer directorio de trabajo en el contenedor
WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev

# Copiar el resto del código fuente del proyecto
COPY . .

# Usar el usuario sin privilegios 'node' por seguridad
USER node

# Exponer el puerto de la aplicación
EXPOSE 3000

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Comando de inicio del servidor
CMD ["node", "server.js"]
