/**
 * public/js/auth.js
 * Módulo de autenticación JWT para el frontend.
 * Maneja: token en localStorage, headers automáticos, redirección y cierre de sesión.
 * Incluir este script ANTES de dashboard.js en cualquier página protegida.
 */

const AUTH_KEY = 'qr_em_token';
const USER_KEY = 'qr_em_user';

// ==========================================
// API pública del módulo Auth
// ==========================================
const Auth = {
  /** Obtiene el token JWT almacenado */
  getToken() {
    return localStorage.getItem(AUTH_KEY);
  },

  /** Obtiene el objeto de usuario almacenado */
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },

  /** Verifica si hay sesión activa */
  isLoggedIn() {
    return Boolean(this.getToken());
  },

  /** Guarda sesión tras login exitoso */
  saveSession(token, user) {
    localStorage.setItem(AUTH_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  /** Limpia sesión y redirige al login */
  logout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.replace('/login.html');
  },

  /**
   * Realiza un fetch autenticado: agrega automáticamente
   * el header Authorization: Bearer <token> a cada request.
   * Si el servidor responde 401/403, cierra sesión.
   */
  async fetch(url, options = {}) {
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });

    // Sesión expirada o token inválido → cerrar sesión automáticamente
    if (response.status === 401 || response.status === 403) {
      const data = await response.json().catch(() => ({}));

      // Solo cerrar sesión si el error es de token, no de otro recurso
      if (data.code === 'TOKEN_EXPIRED' || data.code === 'TOKEN_INVALID' ||
          response.status === 401) {
        this.logout();
        throw new Error('Sesión expirada. Por favor inicia sesión nuevamente.');
      }
    }

    return response;
  },

  /**
   * Verifica que el token en localStorage sigue siendo válido.
   * Redirige a login si no lo es.
   */
  async requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.replace('/login.html');
      return false;
    }

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.getToken() })
      });

      const data = await res.json();

      if (!data.valid) {
        this.logout();
        return false;
      }

      return true;
    } catch {
      // En caso de error de red, permitir continuar con el token existente
      return true;
    }
  }
};

// Exportar globalmente para uso en scripts no-módulo
window.Auth = Auth;
