// login.js - Lógica de login.html (en archivo aparte para que la CSP no permita scripts inline).
// ==========================================
// Sesión: cookie httpOnly puesta por el servidor (JavaScript no puede leerla).
// Aquí solo se guardan los datos visibles del usuario para la interfaz.
// ==========================================
const USER_KEY = 'qr_em_user';
const LEGACY_TOKEN_KEY = 'qr_em_token';
const CSRF_HEADERS = { 'X-Requested-With': 'fetch' };

function saveUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) {}
}

function clearSession() {
  try {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch (e) {}
}

// Borra el token que pudo quedar guardado por versiones anteriores.
try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch (e) {}

// Si ya hay sesión válida (cookie), redirigir al dashboard
async function checkExistingSession() {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      credentials: 'same-origin',
      body: '{}'
    });
    if (!res.ok) {
      clearSession();
      return;
    }
    const data = await res.json();
    saveUser(data.user);
    window.location.replace('/dashboard.html');
  } catch (e) {
    // Sin conexión: se queda en el login.
  }
}

checkExistingSession();

// ==========================================
// UI: Mostrar/ocultar contraseña
// ==========================================
function togglePwd(fieldId, btn) {
  const field = document.getElementById(fieldId);
  const isHidden = field.type === 'password';
  field.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁️';
}

document.querySelectorAll('[data-password-toggle]').forEach(button => {
  button.addEventListener('click', () => togglePwd(button.dataset.passwordToggle, button));
});

// ==========================================
// UI: Alertas
// ==========================================
function showAlert(msg, type = 'error') {
  const el = document.getElementById('authAlert');
  const icon = type === 'success' ? '✅' : '⚠️';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  el.className = `auth-alert show ${type}`;
}

function hideAlert() {
  document.getElementById('authAlert').className = 'auth-alert';
}

// ==========================================
// UI: Toasts
// ==========================================
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icon = type === 'success' ? '✅' : '❌';
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ==========================================
// Estado de botón cargando
// ==========================================
function setLoading(btnId, isLoading) {
  const btn = document.getElementById(btnId);
  btn.disabled = isLoading;
  btn.classList.toggle('loading', isLoading);
}

// ==========================================
// FORMULARIO: Login
// ==========================================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    return showAlert('Completa todos los campos para iniciar sesión.');
  }

  setLoading('btnLogin', true);

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Credenciales inválidas. Verifica e intenta de nuevo.');
      return;
    }

    // La sesión ya quedó en la cookie httpOnly; solo se guardan los datos visibles.
    saveUser(data.user);
    showAlert(`¡Bienvenido, ${data.user.fullName}! Redirigiendo...`, 'success');

    setTimeout(() => window.location.replace('/dashboard.html'), 1000);

  } catch (err) {
    showAlert('Error de conexión con el servidor. Intenta de nuevo.');
  } finally {
    setLoading('btnLogin', false);
  }
});

const invitedEmail = new URLSearchParams(location.search).get('email');
if (invitedEmail) {
  document.getElementById('loginEmail').value = invitedEmail;
  history.replaceState(null, '', location.pathname);
}
