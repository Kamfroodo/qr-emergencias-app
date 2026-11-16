# Manual de Planes, Vigencias e Invitaciones — QR Emergencias (DashLab)

Este documento detalla el funcionamiento técnico y administrativo del sistema de planes, vigencias de suscripción y gestión de invitaciones para futuras consultas o mantenimiento.

---

## 1. Tabla de Planes y Especificaciones

De acuerdo al esquema tarifario oficial de **DashLab QR Emergencias**:

| Plan | Tarifa | Vigencia | Fichas / QR | Contactos por Ficha | Soporte |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Individual** | \$5.000 / año | **1 año** (12 meses) | **1** ficha | 1 contacto | Soporte incluido |
| **Familiar** | \$19.990 / año | **1 año** (12 meses) | **5** fichas personalizadas | 5 contactos | Soporte incluido |
| **Institución** | \$180.990 / 6 meses | **6 meses** (conversable) | **100** fichas personalizadas | 100 contactos | Soporte institucional |
| **Ilimitado / Especial** | A convenir | Indefinido (`NULL`) | Ilimitado (`NULL`) | Ilimitado | Personalizado |

---

## 2. Gestión del Ciclo de Vida de las Invitaciones

### ¿Por qué quedan almacenadas las invitaciones vencidas?
1. **Persistencia en Base de Datos:** Las invitaciones se insertan en la tabla `public.user_invitations` con una fecha `expires_at` fijada a **7 días**. Como PostgreSQL no borra registros automáticamente al vencer una fecha, las filas se mantienen en la base de datos hasta que se eliminen explícitamente.
2. **Propósito de Auditoría y Reenvío:** El sistema guarda el historial para que el administrador pueda ver qué usuarios no completaron su registro a tiempo. Desde la tabla de invitaciones se puede:
   * **Generar nuevo enlace:** Renueva el enlace de 7 días para el mismo correo sin tener que reescribir sus datos.
   * **Eliminar registro:** Elimina una fila puntual de la base de datos.
   * **Limpiar vencidas:** Elimina masivamente todas las invitaciones expiradas no utilizadas.

### Cómo depurar invitaciones vencidas:
* **Desde el Panel Web:** En la sección **Invitaciones**, haz clic en el botón **"Limpiar vencidas"**. El sistema confirmará y purgará todas las invitaciones caducadas en un solo paso.
* **Desde SQL en Supabase:**
  ```sql
  -- Eliminar invitaciones vencidas que nunca fueron usadas ni revocadas
  DELETE FROM public.user_invitations
  WHERE expires_at <= NOW()
    AND used_at IS NULL;
  ```

---

## 3. Selección y Visualización de Planes al Ingresar a la Plataforma

### A. Al ingresar por primera vez desde el enlace de invitación (`/accept-invitation.html`):
Cuando un usuario hace clic en su enlace de invitación personal, la pantalla le presenta de forma interactiva y visual los 3 planes disponibles exactamente como en el flyer de **DASHLAB**:
1. **Plan Individual:** \$5.000 / año (1 ficha médica · 1 QR · 1 contacto · Soporte).
2. **Plan Familiar:** \$19.990 / año (5 fichas médicas · 5 QR personalizados · 5 contactos).
3. **Plan Institución:** \$180.990 / 6 meses (100 fichas médicas · 100 QR personalizados · 100 contactos · Precio conversable).

El usuario:
* Selecciona la tarjeta del plan deseado (con indicador visual y borde iluminado).
* Ingresa su contraseña segura.
* Presiona **"Activar Cuenta con [Plan Seleccionado]"**.
* El sistema guarda el plan elegido de inmediato, calculando sus fichas y fecha de vencimiento (+1 año o +6 meses) sin requerir intervención manual del admin.

### B. En el Dashboard de usuario (`/dashboard.html`):
* En la barra de métricas superiores (**stats**), el usuario siempre visualiza su plan activo, el límite de fichas y la fecha de vigencia:
  * `📋 Fichas médicas: X de 5 (Plan Familiar)`
  * `⭐ Plan actual: Plan Familiar · Vigencia: dd/mm/aaaa`
* **Primer ingreso sin plan:** Si un usuario entra por primera vez y su cuenta aún no tiene plan, se despliega automáticamente un banner y modal de bienvenida con las 3 tarjetas de planes para que elija su plan en un solo clic mediante el endpoint `POST /api/auth/select-plan`.

### C. Asignación y Cambio desde el Panel de Administración (`/admin.html`):
El administrador siempre tiene el control total para cambiar, renovar o asignar planes:
1. En `/admin.html`, ubica al usuario en la columna **Límite y vencimiento**.
2. Usa el selector **⚡ Asignar plan rápido...**:
   * `Individual (1 ficha · 1 año)` $\rightarrow$ Fichas: `1`, Vence: **Hoy + 1 año**.
   * `Familiar (5 fichas · 1 año)` $\rightarrow$ Fichas: `5`, Vence: **Hoy + 1 año**.
   * `Institución (100 fichas · 6 meses)` $\rightarrow$ Fichas: `100`, Vence: **Hoy + 6 meses**.
   * `Ilimitado (Sin vencimiento)` $\rightarrow$ Deja campos en blanco.
3. Presiona **"Guardar límites"**.

---

## 4. Comportamiento del Sistema ante el Vencimiento

### A. Para el Titular de la Cuenta (Dashboard / Login):
* **Al intentar iniciar sesión (`/api/auth/login`):**
  * Si la fecha actual supera `account_expires_at`, el sistema responde con error `403 Forbidden` (`code: 'ACCOUNT_EXPIRED'`) indicando que la cuenta está vencida y debe contactar al administrador.
* **Si tenía una sesión activa:**
  * El middleware de validación `verifyToken` detecta la expiración de la cuenta y rechaza peticiones para crear o editar fichas médicas.

### B. Para Paramédicos y Escaneo del Código QR (`/api/v1/emergency/:token`):
* Cuando se escanea un QR público, el backend verifica:
  1. Si la ficha médica fue pausada directamente por el usuario (`is_active === false`).
  2. Si la cuenta titular del plan ha vencido (`account_expires_at <= NOW()`).
  3. Si la cuenta fue suspendida por el administrador (`is_active === false`).
* En caso de cuenta vencida, la página de emergencia muestra la advertencia **"Suscripción o Plan Vencido"**, impidiendo que se utilice un servicio no renovado.
* **Seguridad en Fallo:** En caso de corte momentáneo de red con la base de datos, los datos de emergencia crítica prevalecen para no comprometer la vida de un paciente.

---

## 5. Renovación de un Plan Vencido

Cuando un cliente renueva su suscripción:
1. Dirígete a `/admin.html`.
2. Ubica al usuario (aparecerá marcado con la etiqueta roja `⚠️ Vencida`).
3. Selecciona nuevamente el plan en el menú desplegable (por ejemplo, `Individual (1 ficha · 1 año)`).
4. El sistema calculará automáticamente la nueva fecha desde el día de hoy.
5. Haz clic en **"Guardar límites"**.
6. La cuenta y sus códigos QR quedarán operativos inmediatamente sin necesidad de reimprimir los QR.

---

## 6. Consultas SQL de Mantenimiento (Supabase)

### Consultar cuentas vencidas:
```sql
SELECT email, full_name, max_profiles, account_expires_at
FROM public.users
WHERE account_expires_at IS NOT NULL
  AND account_expires_at <= NOW()
ORDER BY account_expires_at ASC;
```

### Consultar cuentas próximas a vencer en los siguientes 15 días:
```sql
SELECT email, full_name, account_expires_at
FROM public.users
WHERE account_expires_at IS NOT NULL
  AND account_expires_at BETWEEN NOW() AND (NOW() + INTERVAL '15 days')
ORDER BY account_expires_at ASC;
```

### Renovar manualmente un usuario por 1 año desde SQL:
```sql
UPDATE public.users
SET account_expires_at = NOW() + INTERVAL '1 year'
WHERE email = 'correo_del_usuario@ejemplo.com';
```
