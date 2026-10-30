const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ content: { 'application/json': { schema } } });
const response = (description, schema) => ({
  description,
  ...(schema ? json(schema) : {}),
});
const responses = entries => Object.fromEntries(
  entries.map(([status, description, schema = ref('Error')]) => [
    status,
    response(description, schema),
  ])
);
const bearer = [{ bearerAuth: [] }];
const pathId = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const profileInput = ref('ProfileInput');
const profileProperties = {
  fullName: { type: 'string', example: 'Alex Ejemplo' },
  birthDate: { type: 'string', format: 'date', nullable: true },
  age: { type: 'integer', minimum: 0, maximum: 130, nullable: true },
  nationalId: { type: 'string' },
  bloodType: { type: 'string', enum: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] },
  organDonor: { type: 'boolean' },
  photoUrl: { type: 'string', format: 'uri', nullable: true },
  primaryContact: ref('Contact'),
  secondaryContact: ref('Contact'),
  allergies: { type: 'array', items: { type: 'string' } },
  conditions: { type: 'array', items: { type: 'string' } },
  medications: { type: 'array', items: { type: 'string' } },
  insurance: ref('Insurance'),
  preferredHospital: { type: 'string' },
  medicalNotes: { type: 'string' },
};

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'QR Emergencias API',
    version: '1.0.0',
    description: 'API de autenticación y gestión de fichas médicas de emergencia.',
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [
    { name: 'Health', description: 'Estado del servicio' },
    { name: 'Authentication', description: 'Registro e inicio de sesión' },
    { name: 'Administration', description: 'Gestión de cuentas, roles y acceso (solo administradores)' },
    { name: 'Emergency', description: 'Consulta pública desde el QR' },
    { name: 'Profiles', description: 'Gestión de fichas del usuario autenticado' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Usa el token entregado por POST /api/auth/login.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'usuario@ejemplo.com' },
          password: { type: 'string', format: 'password', minLength: 8, example: 'UnaClaveSegura123' },
        },
      },
      RegisterRequest: {
        allOf: [
          ref('Credentials'),
          {
            type: 'object',
            required: ['fullName'],
            properties: { fullName: { type: 'string', example: 'Camila Ejemplo' } },
          },
        ],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          user: ref('User'),
        },
      },
      Contact: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          relationship: { type: 'string' },
          phone: { type: 'string' },
          whatsapp: { type: 'string' },
        },
      },
      Insurance: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          policyNumber: { type: 'string' },
          emergencyLine: { type: 'string' },
        },
      },
      ProfileInput: {
        type: 'object',
        required: ['fullName', 'bloodType'],
        properties: profileProperties,
      },
      Profile: {
        allOf: [
          ref('ProfileInput'),
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              user_id: { type: 'string' },
              public_token: { type: 'string' },
              is_active: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      ProfileSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          public_token: { type: 'string' },
          is_active: { type: 'boolean' },
          fullName: { type: 'string' },
          age: { type: 'integer', nullable: true },
          bloodType: { type: 'string' },
          organDonor: { type: 'boolean' },
          nationalId: { type: 'string' },
          primaryContact: ref('Contact'),
          conditionsCount: { type: 'integer' },
          allergiesCount: { type: 'integer' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      EmergencyProfile: {
        allOf: [
          ref('Profile'),
          {
            type: 'object',
            properties: {
              profile_name: { type: 'string' },
              emergency_contacts: { type: 'array', items: ref('Contact') },
              critical_conditions: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      },
      QrResponse: {
        type: 'object',
        properties: {
          profileId: { type: 'string' },
          fullName: { type: 'string' },
          targetUrl: { type: 'string', format: 'uri' },
          qrDataUrl: { type: 'string', description: 'Código QR en formato Data URL' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Comprobar el estado del servicio',
        responses: {
          200: response('Servicio disponible', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'OK' },
              service: { type: 'string' },
              database: { type: 'string', enum: ['supabase_cloud', 'local_memory'] },
              timestamp: { type: 'string', format: 'date-time' },
              uptimeSeconds: { type: 'integer' },
            },
          }),
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Registrar un usuario',
        requestBody: {
          required: true,
          ...json(ref('RegisterRequest')),
        },
        responses: {
          ...responses([[201, 'Usuario registrado', {
            type: 'object',
            properties: { message: { type: 'string' }, user: ref('User') },
          }], [400, 'Datos inválidos'], [409, 'El correo ya está registrado']]),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Iniciar sesión y obtener JWT',
        requestBody: { required: true, ...json(ref('Credentials')) },
        responses: {
          ...responses([[200, 'Sesión iniciada', ref('AuthResponse')], [400, 'Faltan credenciales'], [401, 'Credenciales inválidas'], [403, 'Cuenta suspendida']]),
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Obtener el usuario autenticado',
        security: bearer,
        responses: {
          ...responses([[200, 'Usuario autenticado', ref('User')], [401, 'Token ausente o expirado'], [404, 'Usuario no encontrado']]),
        },
      },
    },
    '/api/auth/verify': {
      post: {
        tags: ['Authentication'],
        summary: 'Verificar sesión y estado de la cuenta autenticada',
        security: bearer,
        responses: {
          ...responses([[200, 'Resultado de validación', {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              user: ref('User'),
              expiresAt: { type: 'string', format: 'date-time' },
            },
          }], [401, 'Token ausente, expirado o cuenta suspendida']]),
        },
      },
    },
    '/api/auth/admin/users': {
      get: {
        tags: ['Administration'],
        summary: 'Listar usuarios sin exponer contraseñas',
        security: bearer,
        responses: {
          ...responses([[200, 'Usuarios registrados', { type: 'array', items: ref('User') }], [401, 'Sesión inválida'], [403, 'Se requieren privilegios de administrador']]),
        },
      },
    },
    '/api/auth/admin/users/{id}/status': {
      patch: {
        tags: ['Administration'],
        summary: 'Suspender o reactivar una cuenta',
        security: bearer,
        parameters: pathId,
        requestBody: { required: true, ...json({ type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } }) },
        responses: {
          ...responses([[200, 'Estado actualizado', ref('User')], [400, 'No se permite cambiar el estado propio'], [403, 'Se requieren privilegios de administrador'], [409, 'No se puede suspender al último administrador activo']]),
        },
      },
    },
    '/api/auth/admin/users/{id}/role': {
      patch: {
        tags: ['Administration'],
        summary: 'Asignar o retirar el rol de administrador',
        security: bearer,
        parameters: pathId,
        requestBody: { required: true, ...json({ type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['user', 'admin'] } } }) },
        responses: {
          ...responses([[200, 'Rol actualizado', ref('User')], [400, 'Rol inválido o cambio de rol propio'], [403, 'Se requieren privilegios de administrador'], [409, 'No se puede retirar el último administrador activo']]),
        },
      },
    },
    '/api/auth/admin/users/{id}': {
      delete: {
        tags: ['Administration'],
        summary: 'Eliminar una cuenta y sus perfiles médicos',
        security: bearer,
        parameters: pathId,
        responses: {
          ...responses([[200, 'Cuenta y perfiles eliminados'], [400, 'No se permite eliminar la cuenta propia'], [403, 'Se requieren privilegios de administrador'], [409, 'No se puede eliminar al último administrador activo']]),
        },
      },
    },
    '/api/v1/emergency/{publicToken}': {
      get: {
        tags: ['Emergency'],
        summary: 'Consultar una ficha activa con el token del QR',
        parameters: [{
          name: 'publicToken',
          in: 'path',
          required: true,
          description: 'Token público o ID de ficha',
          schema: { type: 'string' },
        }],
        responses: {
          ...responses([[200, 'Información de emergencia', ref('EmergencyProfile')], [403, 'Ficha pausada'], [404, 'Ficha no encontrada']]),
        },
      },
    },
    '/api/profiles': {
      get: {
        tags: ['Profiles'],
        summary: 'Listar las fichas del usuario autenticado',
        security: bearer,
        responses: {
          ...responses([[200, 'Lista de perfiles', { type: 'array', items: ref('ProfileSummary') }], [401, 'Token ausente o inválido']]),
        },
      },
      post: {
        tags: ['Profiles'],
        summary: 'Crear una ficha y generar su código QR',
        security: bearer,
        requestBody: { required: true, ...json(profileInput) },
        responses: {
          ...responses([[201, 'Ficha creada', ref('Profile')], [400, 'Nombre o grupo sanguíneo inválido'], [401, 'Token ausente o inválido']]),
        },
      },
    },
    '/api/v1/profiles': {
      post: {
        tags: ['Profiles'],
        summary: 'Crear una ficha (ruta compatible v1)',
        security: bearer,
        requestBody: { required: true, ...json(profileInput) },
        responses: {
          ...responses([[201, 'Ficha creada', ref('Profile')], [400, 'Datos inválidos'], [401, 'Token ausente o inválido']]),
        },
      },
    },
    '/api/profiles/{id}': {
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        description: 'ID interno del perfil',
        schema: { type: 'string' },
      }],
      get: {
        tags: ['Profiles'],
        summary: 'Obtener una ficha propia',
        security: bearer,
        responses: {
          ...responses([[200, 'Datos completos de la ficha', ref('Profile')], [401, 'Token ausente o inválido'], [404, 'Ficha no encontrada']]),
        },
      },
      put: {
        tags: ['Profiles'],
        summary: 'Actualizar una ficha propia',
        description: 'Envía los campos que deseas actualizar. fullName y bloodType son obligatorios; los campos anidados omitidos se conservan.',
        security: bearer,
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['fullName', 'bloodType'],
            properties: profileProperties,
            description: 'Campos actualizados; se requieren fullName y bloodType.',
          }),
        },
        responses: {
          ...responses([[200, 'Ficha actualizada', ref('Profile')], [400, 'Campos o valores inválidos'], [401, 'Token ausente o inválido'], [404, 'Ficha no encontrada o de otro usuario']]),
        },
      },
      delete: {
        tags: ['Profiles'],
        summary: 'Eliminar una ficha propia',
        security: bearer,
        responses: {
          ...responses([[200, 'Ficha eliminada', {
            type: 'object',
            properties: { message: { type: 'string' }, id: { type: 'string' } },
          }], [401, 'Token ausente o inválido'], [404, 'Ficha no encontrada']]),
        },
      },
    },
    '/api/profiles/{id}/status': {
      patch: {
        tags: ['Profiles'],
        summary: 'Activar o pausar el QR de una ficha propia',
        security: bearer,
        parameters: pathId,
        requestBody: {
          required: false,
          ...json({
            type: 'object',
            properties: { is_active: { type: 'boolean', description: 'Omitir para alternar el estado' } },
          }),
        },
        responses: {
          ...responses([[200, 'Estado actualizado', {
            type: 'object',
            properties: {
              message: { type: 'string' },
              id: { type: 'string' },
              is_active: { type: 'boolean' },
            },
          }], [401, 'Token ausente o inválido'], [404, 'Ficha no encontrada']]),
        },
      },
    },
    '/api/profiles/{id}/qr': {
      get: {
        tags: ['Profiles'],
        summary: 'Obtener el QR de una ficha propia',
        security: bearer,
        parameters: [
          ...pathId,
          {
            name: 'format',
            in: 'query',
            required: false,
            description: 'Usa png para descargar la imagen',
            schema: { type: 'string', enum: ['dataurl', 'png'], default: 'dataurl' },
          },
        ],
        responses: {
          200: {
            description: 'QR como Data URL JSON o archivo PNG',
            content: {
              'application/json': { schema: ref('QrResponse') },
              'image/png': { schema: { type: 'string', format: 'binary' } },
            },
          },
          ...responses([[401, 'Token ausente o inválido'], [404, 'Ficha no encontrada']]),
        },
      },
    },
  },
};

module.exports = openApiSpec;
