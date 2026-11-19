// accept-invitation.js - Lógica de accept-invitation.html (en archivo aparte para que la CSP no permita scripts inline).

const token = new URLSearchParams(location.search).get('token');
history.replaceState(null, '', location.pathname);

const statusBox = document.getElementById('statusBox');
const statusMessage = document.getElementById('statusMessage');
const invitationContent = document.getElementById('invitationContent');
const userEmailSpan = document.getElementById('userEmail');
const form = document.getElementById('activationForm');
const btnSubmit = document.getElementById('btnSubmit');
const alertBox = document.getElementById('alertBox');
const planCards = document.querySelectorAll('.plan-card');

// El plan lo fija el administrador en la invitación; aquí solo se muestra.
let assignedPlan = null;

const planLabels = {
  individual: 'Plan Individual',
  familiar: 'Plan Familiar',
  institucion: 'Plan Institución',
  ilimitado: 'Plan Ilimitado'
};

function updateSubmitButton() {
  btnSubmit.textContent = `🚀 Activar Cuenta${planLabels[assignedPlan] ? ` con ${planLabels[assignedPlan]}` : ''}`;
}

function showAssignedPlan(plan) {
  assignedPlan = plan;
  planCards.forEach(card => {
    const isAssigned = card.dataset.plan === plan;
    card.hidden = !isAssigned;
    card.classList.toggle('selected', isAssigned);
  });
}

function showAlert(text, type = 'error') {
  alertBox.textContent = text;
  alertBox.className = `message-box ${type}`;
}

async function checkInvitation() {
  if (!token) {
    statusBox.className = 'status-box error';
    statusMessage.textContent = 'Enlace inválido o incompleto. Solicita una nueva invitación al administrador.';
    return;
  }
  try {
    const response = await fetch(`/api/auth/invitation/${encodeURIComponent(token)}`);
    const result = await response.json();
    if (!response.ok) {
      statusBox.className = 'status-box error';
      statusMessage.textContent = result.error || 'La invitación ha expirado o ya no está disponible.';
      return;
    }
    statusBox.style.display = 'none';
    userEmailSpan.textContent = result.email;
    showAssignedPlan(result.plan);
    invitationContent.style.display = 'block';
    updateSubmitButton();
  } catch (err) {
    statusBox.className = 'status-box error';
    statusMessage.textContent = 'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo nuevamente.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  alertBox.style.display = 'none';

  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!password || password.length < 12) {
    return showAlert('La contraseña debe tener al menos 12 caracteres por seguridad.');
  }
  if (password !== confirmPassword) {
    return showAlert('Las contraseñas no coinciden. Por favor verifícalas.');
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Activando cuenta…';

  try {
    const response = await fetch('/api/auth/invitation/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });

    const result = await response.json();
    if (!response.ok) {
      btnSubmit.disabled = false;
      updateSubmitButton();
      return showAlert(result.error || 'No se pudo activar la cuenta.');
    }

    showAlert(`¡Cuenta activada con éxito${planLabels[assignedPlan] ? ` con el ${planLabels[assignedPlan]}` : ''}! Redirigiendo al inicio de sesión…`, 'success');
    form.reset();

    setTimeout(() => {
      location.replace(`/login.html?email=${encodeURIComponent(result.user.email)}`);
    }, 1800);
  } catch {
    btnSubmit.disabled = false;
    updateSubmitButton();
    showAlert('Error de conexión con el servidor. Inténtalo nuevamente.');
  }
});

checkInvitation();
