/**
 * public/js/auth.js
 * Sesión del frontend.
 *
 * La sesión vive en una cookie httpOnly que pone el servidor al iniciar sesión:
 * JavaScript no puede leerla, así un script inyectado no puede robarla. Aquí solo
 * se guardan los datos visibles del usuario (nombre, correo, rol) para pintar la
 * interfaz; no sirven para autenticarse y el servidor vuelve a comprobarlo todo.
 *
 * Toda petición lleva la cabecera X-Requested-With, que el servidor exige en las
 * acciones que modifican datos (protección contra CSRF).
 */

const USER_KEY = 'qr_em_user';
const LEGACY_TOKEN_KEY = 'qr_em_token'; // versiones anteriores guardaban aquí el JWT
const CSRF_HEADERS = { 'X-Requested-With': 'fetch' };

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function removeStorage(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Borra el token que pudo quedar de versiones anteriores.
removeStorage(LEGACY_TOKEN_KEY);

const Auth = {
  /** Datos visibles del usuario (no son una credencial). */
  getUser() {
    try {
      return JSON.parse(readStorage(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },

  saveUser(user) {
    writeStorage(USER_KEY, JSON.stringify(user));
  },

  clearUser() {
    removeStorage(USER_KEY);
  },

  /** Cierra la sesión en el servidor (borra la cookie) y vuelve al login. */
  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: CSRF_HEADERS, credentials: 'same-origin' });
    } catch {}
    this.clearUser();
    window.location.replace('/login.html');
  },

  /**
   * fetch autenticado: envía la cookie de sesión y la cabecera anti-CSRF.
   * Si el servidor responde 401, la sesión terminó: vuelve al login.
   */
  async fetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...CSRF_HEADERS,
      ...(options.headers || {}),
    };

    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });

    let sessionEnded = response.status === 401;
    if (response.status === 403) {
      const data = await response.clone().json().catch(() => ({}));
      sessionEnded = data.code === 'TOKEN_INVALID' || data.code === 'TOKEN_EXPIRED';
    }
    if (sessionEnded) {
      await this.logout();
      throw new Error('Sesión expirada. Por favor inicia sesión nuevamente.');
    }

    return response;
  },

  /** Comprueba con el servidor que la sesión sigue activa; si no, va al login. */
  async requireAuth() {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
        credentials: 'same-origin',
        body: '{}',
      });

      if (!res.ok) {
        this.clearUser();
        window.location.replace('/login.html');
        return false;
      }

      const data = await res.json();
      this.saveUser({ ...(this.getUser() || {}), ...data.user });
      return true;
    } catch {
      // Sin red: se continúa solo si ya había una sesión iniciada en este navegador.
      if (this.getUser()) return true;
      window.location.replace('/login.html');
      return false;
    }
  },
};

window.Auth = Auth;
