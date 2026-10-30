const usersTable = document.getElementById('usersTable');
const userCount = document.getElementById('userCount');
const userSearch = document.getElementById('userSearch');
const statusMessage = document.getElementById('statusMessage');
let users = [];
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

async function loadUsers() {
  statusMessage.textContent = '';
  try {
    currentUser = await requestJson('/api/auth/me');
    if (currentUser.role !== 'admin') {
      showMessage('Tu cuenta no tiene permisos de administrador.');
      usersTable.replaceChildren();
      return;
    }
    users = await requestJson('/api/auth/admin/users');
    renderUsers();
  } catch (error) {
    showMessage(error.message);
    usersTable.replaceChildren();
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
document.getElementById('logoutButton').addEventListener('click', () => {
  if (window.confirm('¿Cerrar sesión?')) Auth.logout();
});

(async function initialize() {
  const authenticated = await Auth.requireAuth();
  if (!authenticated) return;
  await loadUsers();
})();
