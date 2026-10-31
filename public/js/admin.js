const usersTable = document.getElementById('usersTable');
const userCount = document.getElementById('userCount');
const userSearch = document.getElementById('userSearch');
const statusMessage = document.getElementById('statusMessage');
const invitationForm = document.getElementById('invitationForm');
const invitationsTable = document.getElementById('invitationsTable');
const invitationCount = document.getElementById('invitationCount');
const invitationLink = document.getElementById('invitationLink');
let users = [];
let invitations = [];
let currentUser = null;

function showMessage(message, type = 'error') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function requestJson(path, options) {
  const response = await Auth.fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}

function renderUsers() {
  const search = userSearch.value.trim().toLocaleLowerCase();
  const filtered = users.filter(user =>
    `${user.fullName} ${user.email}`.toLocaleLowerCase().includes(search));

  userCount.textContent = `${filtered.length} de ${users.length} cuentas`;
  usersTable.replaceChildren();

  if (filtered.length === 0) {
    const row = element('tr');
    const cell = element('td', 'empty-state', users.length ? 'No hay coincidencias.' : 'No hay usuarios registrados.');
    cell.colSpan = 6;
    row.append(cell);
    usersTable.append(row);
    return;
  }

  for (const user of filtered) {
    const row = document.createElement('tr');
    const nameCell = element('td');
    nameCell.append(element('span', 'user-name', user.fullName || 'Sin nombre'));
    if (user.id === currentUser.id) nameCell.append(element('span', 'muted', 'Tu cuenta'));
    const emailCell = element('td', '', user.email);
    const createdCell = element('td', '', user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—');
    const statusCell = element('td');
    statusCell.append(element('span', `badge ${user.isActive ? 'badge-active' : 'badge-suspended'}`, user.isActive ? 'Activa' : 'Suspendida'));

    const roleCell = element('td');
    const roleControl = element('div', 'role-control');
    const roleSelect = document.createElement('select');
    for (const [value, label] of [['user', 'Usuario'], ['admin', 'Admin']]) {
      const option = element('option', '', label);
      option.value = value;
      roleSelect.append(option);
    }
    roleSelect.value = user.role;
    roleSelect.disabled = user.id === currentUser.id;
    const saveRole = element('button', 'button button-primary', 'Guardar');
    saveRole.type = 'button';
    saveRole.disabled = roleSelect.disabled || roleSelect.value === user.role;
    roleSelect.addEventListener('change', () => { saveRole.disabled = roleSelect.value === user.role; });
    saveRole.addEventListener('click', () => changeRole(user, roleSelect.value));
    roleControl.append(roleSelect, saveRole);
    roleCell.append(roleControl);

    const actionCell = element('td');
    const actions = element('div', 'row-actions');
    const statusButton = element('button', `button ${user.isActive ? 'button-secondary' : 'button-primary'}`, user.isActive ? 'Suspender' : 'Reactivar');
    statusButton.type = 'button';
    statusButton.disabled = user.id === currentUser.id;
    statusButton.addEventListener('click', () => changeStatus(user));
    const deleteButton = element('button', 'button button-danger', 'Eliminar');
    deleteButton.type = 'button';
    deleteButton.disabled = user.id === currentUser.id;
    deleteButton.addEventListener('click', () => deleteUser(user));
    actions.append(statusButton, deleteButton);
    actionCell.append(actions);

    row.append(nameCell, emailCell, createdCell, statusCell, roleCell, actionCell);
    usersTable.append(row);
  }
}

function showInvitationLink(url) {
  invitationLink.replaceChildren();
  invitationLink.hidden = false;
  const label = element('label', '', 'Enlace de invitación (solo se muestra ahora)');
  label.htmlFor = 'generatedInvitationUrl';
  const input = element('input');
  input.id = 'generatedInvitationUrl';
  input.type = 'url';
  input.readOnly = true;
  input.value = url;
  const copy = element('button', 'button button-primary', 'Copiar enlace');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      showMessage('Enlace copiado. Envíalo directamente a la persona invitada.', 'success');
    } catch {
      input.focus();
      input.select();
      showMessage('No se pudo copiar automáticamente. Selecciona y copia el enlace.', 'error');
    }
  });
  invitationLink.append(label, input, copy);
  input.focus();
  input.select();
}

function renderInvitations() {
  invitationCount.textContent = `${invitations.length} invitaciones recientes`;
  invitationsTable.replaceChildren();

  if (!invitations.length) {
    const row = element('tr');
    const cell = element('td', 'empty-state', 'Todavía no hay invitaciones.');
    cell.colSpan = 5;
    row.append(cell);
    invitationsTable.append(row);
    return;
  }

  const labels = {
    pending: ['Pendiente', 'badge-pending'],
    accepted: ['Aceptada', 'badge-active'],
    revoked: ['Revocada', 'badge-suspended'],
    expired: ['Vencida', 'badge-suspended'],
  };
  for (const invitation of invitations) {
    const row = document.createElement('tr');
    const nameCell = element('td', 'user-name', invitation.fullName);
    const emailCell = element('td', '', invitation.email);
    const expiresCell = element('td', '', new Date(invitation.expiresAt).toLocaleString());
    const statusCell = element('td');
    const [label, badge] = labels[invitation.status] || ['Desconocido', 'badge-suspended'];
    statusCell.append(element('span', `badge ${badge}`, label));
    const actionsCell = element('td');
    const actions = element('div', 'row-actions');

    if (invitation.status !== 'accepted') {
      const renew = element('button', 'button button-secondary', 'Generar nuevo enlace');
      renew.type = 'button';
      renew.addEventListener('click', () => createInvitation({
        email: invitation.email,
        fullName: invitation.fullName,
      }));
      actions.append(renew);
    }
    if (invitation.status === 'pending') {
      const revoke = element('button', 'button button-danger', 'Revocar');
      revoke.type = 'button';
      revoke.addEventListener('click', () => revokeInvitation(invitation));
      actions.append(revoke);
    }
    actionsCell.append(actions);
    row.append(nameCell, emailCell, expiresCell, statusCell, actionsCell);
    invitationsTable.append(row);
  }
}

async function loadUsers() {
  statusMessage.textContent = '';
  try {
    currentUser = await requestJson('/api/auth/me');
    if (currentUser.role !== 'admin') {
      showMessage('Tu cuenta no tiene permisos de administrador.');
      usersTable.replaceChildren();
      return;
    }
    [users, invitations] = await Promise.all([
      requestJson('/api/auth/admin/users'),
      requestJson('/api/auth/admin/invitations'),
    ]);
    renderUsers();
    renderInvitations();
  } catch (error) {
    showMessage(error.message);
    usersTable.replaceChildren();
    invitationsTable.replaceChildren();
  }
}

async function createInvitation(values) {
  try {
    const result = await requestJson('/api/auth/admin/invitations', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    showInvitationLink(result.invitationUrl);
    showMessage(result.message, 'success');
    invitations = await requestJson('/api/auth/admin/invitations');
    renderInvitations();
  } catch (error) {
    showMessage(error.message);
  }
}

async function revokeInvitation(invitation) {
  if (!window.confirm(`¿Revocar la invitación de ${invitation.email}? El enlace dejará de funcionar.`)) return;
  try {
    await requestJson(`/api/auth/admin/invitations/${encodeURIComponent(invitation.id)}/revoke`, {
      method: 'POST',
    });
    invitations = await requestJson('/api/auth/admin/invitations');
    renderInvitations();
    showMessage('Invitación revocada.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function changeStatus(user) {
  const isActive = !user.isActive;
  const verb = isActive ? 'reactivar' : 'suspender';
  if (!window.confirm(`¿Seguro que deseas ${verb} la cuenta de ${user.email}?`)) return;
  try {
    const updated = await requestJson(`/api/auth/admin/users/${encodeURIComponent(user.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    users = users.map(entry => entry.id === updated.id ? updated : entry);
    renderUsers();
    showMessage(`Cuenta ${isActive ? 'reactivada' : 'suspendida'} correctamente.`, 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function changeRole(user, role) {
  if (!window.confirm(`¿Cambiar el rol de ${user.email} a ${role === 'admin' ? 'administrador' : 'usuario'}?`)) return;
  try {
    const updated = await requestJson(`/api/auth/admin/users/${encodeURIComponent(user.id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    users = users.map(entry => entry.id === updated.id ? updated : entry);
    renderUsers();
    showMessage('Rol actualizado correctamente.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function deleteUser(user) {
  if (!window.confirm(`Eliminar ${user.email} y todas sus fichas médicas es irreversible. ¿Continuar?`)) return;
  try {
    await requestJson(`/api/auth/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    users = users.filter(entry => entry.id !== user.id);
    renderUsers();
    showMessage('Cuenta y perfiles asociados eliminados.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

userSearch.addEventListener('input', renderUsers);
invitationForm.addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(invitationForm);
  createInvitation({
    fullName: String(formData.get('fullName') || '').trim(),
    email: String(formData.get('email') || '').trim(),
  });
});
document.getElementById('logoutButton').addEventListener('click', () => {
  if (window.confirm('¿Cerrar sesión?')) Auth.logout();
});

(async function initialize() {
  const authenticated = await Auth.requireAuth();
  if (!authenticated) return;
  await loadUsers();
})();
