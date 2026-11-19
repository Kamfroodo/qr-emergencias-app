const usersTable = document.getElementById('usersTable');
const userCount = document.getElementById('userCount');
const userSearch = document.getElementById('userSearch');
const statusMessage = document.getElementById('statusMessage');
const invitationForm = document.getElementById('invitationForm');
const invitationsTable = document.getElementById('invitationsTable');
const invitationCount = document.getElementById('invitationCount');
const invitationLink = document.getElementById('invitationLink');
const medicalProfilesTable = document.getElementById('medicalProfilesTable');
const medicalProfileCount = document.getElementById('medicalProfileCount');
const medicalProfileDetails = document.getElementById('medicalProfileDetails');
const profileQrDialog = document.getElementById('profileQrDialog');
let users = [];
let invitations = [];
let medicalProfiles = [];
let currentUser = null;
let currentQrProfileId = null;

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

function showTableError(table, columnCount, message) {
  table.replaceChildren();
  const row = element('tr');
  const cell = element('td', 'empty-state', message);
  cell.colSpan = columnCount;
  row.append(cell);
  table.append(row);
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
    cell.colSpan = 7;
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

    const profileCount = medicalProfiles.filter(profile => profile.ownerUserId === user.id).length;
    const limitsCell = element('td');
    const limitControls = element('div', 'limit-controls');

    const planSelect = document.createElement('select');
    planSelect.setAttribute('aria-label', `Elegir plan para ${user.email}`);
    const planOptions = [
      ['', '⚡ Asignar plan rápido...'],
      ['individual', 'Individual (1 ficha · 1 año)'],
      ['familiar', 'Familiar (5 fichas · 1 año)'],
      ['institucion', 'Institución (100 fichas · 6 meses)'],
      ['unlimited', 'Ilimitado (Sin vencimiento)'],
    ];
    for (const [val, label] of planOptions) {
      const opt = element('option', '', label);
      opt.value = val;
      planSelect.append(opt);
    }

    const maxProfilesInput = document.createElement('input');
    maxProfilesInput.type = 'number';
    maxProfilesInput.min = '1';
    maxProfilesInput.max = '10000';
    maxProfilesInput.placeholder = 'Fichas (ej: 1, 5, 100)';
    maxProfilesInput.value = user.maxProfiles ?? '';
    maxProfilesInput.setAttribute('aria-label', `Máximo de fichas para ${user.email}`);

    const expiresInput = document.createElement('input');
    expiresInput.type = 'date';
    expiresInput.value = user.accountExpiresAt ? user.accountExpiresAt.slice(0, 10) : '';
    expiresInput.setAttribute('aria-label', `Vencimiento de cuenta para ${user.email}`);

    planSelect.addEventListener('change', () => {
      const targetDate = new Date();
      if (planSelect.value === 'individual') {
        maxProfilesInput.value = 1;
        targetDate.setFullYear(targetDate.getFullYear() + 1);
        expiresInput.value = targetDate.toISOString().slice(0, 10);
      } else if (planSelect.value === 'familiar') {
        maxProfilesInput.value = 5;
        targetDate.setFullYear(targetDate.getFullYear() + 1);
        expiresInput.value = targetDate.toISOString().slice(0, 10);
      } else if (planSelect.value === 'institucion') {
        maxProfilesInput.value = 100;
        targetDate.setMonth(targetDate.getMonth() + 6);
        expiresInput.value = targetDate.toISOString().slice(0, 10);
      } else if (planSelect.value === 'unlimited') {
        maxProfilesInput.value = '';
        expiresInput.value = '';
      }
    });

    const isExpired = user.accountExpiresAt && new Date(user.accountExpiresAt).getTime() <= Date.now();
    const expiresLabel = user.accountExpiresAt
      ? `${isExpired ? '⚠️ Vencida' : 'Vence'} ${new Date(user.accountExpiresAt).toLocaleDateString()}`
      : 'Sin vencimiento';
    const usage = element('span', isExpired ? 'badge badge-suspended' : 'muted', `${profileCount} de ${user.maxProfiles ?? '∞'} fichas · ${expiresLabel}`);

    const saveLimits = element('button', 'button button-primary', 'Guardar límites');
    saveLimits.type = 'button';
    saveLimits.addEventListener('click', () => saveUserLimits(user, maxProfilesInput.value, expiresInput.value));

    limitControls.append(planSelect, maxProfilesInput, expiresInput, usage, saveLimits);
    limitsCell.append(limitControls);

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

    row.append(nameCell, emailCell, createdCell, statusCell, roleCell, limitsCell, actionCell);
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

const INVITATION_PLAN_LABELS = {
  individual: 'Individual',
  familiar: 'Familiar',
  institucion: 'Institución',
  ilimitado: 'Ilimitado',
};

function renderInvitations() {
  invitationCount.textContent = `${invitations.length} invitaciones recientes`;
  invitationsTable.replaceChildren();

  if (!invitations.length) {
    const row = element('tr');
    const cell = element('td', 'empty-state', 'Todavía no hay invitaciones.');
    cell.colSpan = 6;
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
    const planCell = element('td', '', INVITATION_PLAN_LABELS[invitation.plan] || 'Sin plan');
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
        plan: invitation.plan || 'individual',
      }));
      actions.append(renew);
    }
    if (invitation.status === 'pending') {
      const revoke = element('button', 'button button-danger', 'Revocar');
      revoke.type = 'button';
      revoke.addEventListener('click', () => revokeInvitation(invitation));
      actions.append(revoke);
    }
    const remove = element('button', 'button button-danger', '🗑️ Eliminar');
    remove.type = 'button';
    remove.title = 'Eliminar este registro del historial de invitaciones';
    remove.addEventListener('click', () => deleteInvitation(invitation));
    actions.append(remove);
    actionsCell.append(actions);
    row.append(nameCell, emailCell, planCell, expiresCell, statusCell, actionsCell);
    invitationsTable.append(row);
  }
}

function renderMedicalProfiles() {
  medicalProfileCount.textContent = `${medicalProfiles.length} fichas · consulta y QR de solo lectura`;
  medicalProfilesTable.replaceChildren();
  if (!medicalProfiles.length) {
    const row = element('tr');
    const cell = element('td', 'empty-state', 'Todavía no hay fichas médicas.');
    cell.colSpan = 4;
    row.append(cell);
    medicalProfilesTable.append(row);
    return;
  }

  const usersById = new Map(users.map(user => [user.id, user]));
  for (const profile of medicalProfiles) {
    const row = document.createElement('tr');
    row.append(
      element('td', 'user-name', profile.fullName || 'Sin nombre'),
      element('td', '', usersById.get(profile.ownerUserId)?.email ||
        (profile.ownerUserId ? `Cuenta ${profile.ownerUserId}` : 'Cuenta no disponible')),
    );
    const status = element('td');
    status.append(element(
      'span',
      `badge ${profile.isActive ? 'badge-active' : 'badge-suspended'}`,
      profile.isActive ? 'QR activo' : 'QR pausado',
    ));
    row.append(status);

    const actions = element('td');
    const actionGroup = element('div', 'row-actions');
    const viewButton = element('button', 'button button-secondary', 'Ver ficha');
    viewButton.type = 'button';
    viewButton.addEventListener('click', () => loadMedicalProfile(profile.id));
    const qrButton = element('button', 'button button-primary', 'Código QR');
    qrButton.type = 'button';
    qrButton.addEventListener('click', () => showProfileQr(profile));
    const rotateButton = element('button', 'button button-secondary', 'Regenerar QR');
    rotateButton.type = 'button';
    rotateButton.title = 'Invalida el QR actual y crea uno nuevo';
    rotateButton.addEventListener('click', () => rotateMedicalProfileQr(profile));
    const deleteButton = element('button', 'button button-danger', 'Eliminar');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', () => deleteMedicalProfile(profile));
    actionGroup.append(viewButton, qrButton, rotateButton, deleteButton);
    actions.append(actionGroup);
    row.append(actions);
    medicalProfilesTable.append(row);
  }
}

function appendProfileDetails(title, fields) {
  medicalProfileDetails.append(element('h3', '', title));
  const list = document.createElement('dl');
  for (const [label, value] of fields) {
    const item = document.createElement('div');
    item.append(element('dt', '', label), element('dd', '', value || '—'));
    list.append(item);
  }
  medicalProfileDetails.append(list);
}

async function loadMedicalProfile(profileId) {
  try {
    const profile = await requestJson(`/api/admin/profiles/${encodeURIComponent(profileId)}`);
    medicalProfileDetails.replaceChildren();
    medicalProfileDetails.dataset.profileId = profileId;
    medicalProfileDetails.hidden = false;
    const heading = element('h2', '', `Ficha médica · ${profile.fullName || 'Paciente'}`);
    const close = element('button', 'button button-secondary', 'Cerrar ficha');
    close.type = 'button';
    close.addEventListener('click', () => {
      medicalProfileDetails.hidden = true;
      medicalProfileDetails.replaceChildren();
      delete medicalProfileDetails.dataset.profileId;
    });
    const header = element('div', 'panel-toolbar');
    header.append(heading, close);
    medicalProfileDetails.append(header);
    appendProfileDetails('Identificación', [
      ['Nombre completo', profile.fullName],
      ['Fecha de nacimiento', profile.birthDate],
      ['Edad', profile.age == null ? '' : `${profile.age} años`],
      ['Identificación', profile.nationalId],
      ['Grupo sanguíneo', profile.bloodType],
      ['Donante de órganos', profile.organDonor ? 'Sí' : 'No'],
      ['Estado del QR', profile.is_active === false ? 'Pausado' : 'Activo'],
      ['Foto', profile.photoUrl ? 'Registrada' : 'Sin foto'],
    ]);
    const formatContact = contact => contact
      ? [['Nombre', contact.name], ['Parentesco', contact.relationship], ['Teléfono', contact.phone], ['WhatsApp', contact.whatsapp]]
      : [];
    appendProfileDetails('Contacto principal', formatContact(profile.primaryContact));
    appendProfileDetails('Contacto secundario', formatContact(profile.secondaryContact));
    appendProfileDetails('Información médica', [
      ['Alergias', Array.isArray(profile.allergies) ? profile.allergies.join(', ') : ''],
      ['Condiciones', Array.isArray(profile.conditions) ? profile.conditions.join(', ') : ''],
      ['Medicamentos', Array.isArray(profile.medications) ? profile.medications.join(', ') : ''],
      ['Notas médicas', profile.medicalNotes],
      ['Aseguradora', profile.insurance?.company],
      ['Póliza', profile.insurance?.policyNumber],
      ['Hospital preferido', profile.preferredHospital],
    ]);
    medicalProfileDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showMessage('Ficha cargada en modo de solo lectura.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function showProfileQr(profile) {
  try {
    const qr = await requestJson(`/api/admin/profiles/${encodeURIComponent(profile.id)}/qr`);
    currentQrProfileId = profile.id;
    document.getElementById('profileQrName').textContent = qr.fullName;
    document.getElementById('profileQrImage').src = qr.qrDataUrl;
    document.getElementById('profileQrImage').alt = `Código QR de emergencia de ${qr.fullName}`;
    const target = document.getElementById('profileQrTarget');
    target.href = qr.targetUrl;
    target.textContent = qr.targetUrl;
    profileQrDialog.showModal();
  } catch (error) {
    showMessage(error.message);
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
    const results = await Promise.allSettled([
      requestJson('/api/auth/admin/users'),
      requestJson('/api/auth/admin/invitations'),
      requestJson('/api/admin/profiles'),
    ]);
    const failures = [];

    if (results[0].status === 'fulfilled') {
      users = results[0].value;
      renderUsers();
    } else {
      showTableError(usersTable, 7, 'No se pudieron cargar las cuentas.');
      failures.push(results[0].reason.message);
    }

    if (results[1].status === 'fulfilled') {
      invitations = results[1].value;
      renderInvitations();
    } else {
      showTableError(invitationsTable, 5, 'No se pudieron cargar las invitaciones.');
      failures.push(results[1].reason.message);
    }

    if (results[2].status === 'fulfilled') {
      medicalProfiles = results[2].value;
      renderMedicalProfiles();
      if (results[0].status === 'fulfilled') renderUsers();
    } else {
      showTableError(medicalProfilesTable, 4, 'No se pudieron cargar las fichas médicas. Revisa la conexión con la base de datos.');
      failures.push(results[2].reason.message);
    }
    if (failures.length) showMessage(failures.join(' '));
  } catch (error) {
    showMessage(error.message);
    showTableError(usersTable, 7, error.message);
    showTableError(invitationsTable, 5, error.message);
    showTableError(medicalProfilesTable, 4, error.message);
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

async function deleteInvitation(invitation) {
  if (!window.confirm(`¿Eliminar el registro de invitación de ${invitation.email}? Esta acción no elimina una cuenta de usuario.`)) return;
  try {
    await requestJson(`/api/auth/admin/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' });
    invitations = invitations.filter(entry => entry.id !== invitation.id);
    renderInvitations();
    showMessage('Registro de invitación eliminado.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function cleanExpiredInvitations() {
  const expired = invitations.filter(inv => inv.status === 'expired');
  if (!expired.length) {
    showMessage('No hay invitaciones vencidas para limpiar.', 'success');
    return;
  }
  if (!window.confirm(`¿Seguro que deseas eliminar las ${expired.length} invitaciones vencidas del registro?`)) return;
  try {
    let deletedCount = 0;
    for (const inv of expired) {
      try {
        await requestJson(`/api/auth/admin/invitations/${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
        deletedCount++;
      } catch {
        // Ignorar fallo individual y continuar con el resto
      }
    }
    invitations = invitations.filter(inv => inv.status !== 'expired');
    renderInvitations();
    showMessage(`Se eliminaron ${deletedCount} invitaciones vencidas correctamente.`, 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function cleanAcceptedInvitations() {
  const accepted = invitations.filter(inv => inv.status === 'accepted');
  if (!accepted.length) {
    showMessage('No hay invitaciones aceptadas para limpiar.', 'info');
    return;
  }
  if (!window.confirm(`¿Seguro que deseas eliminar los ${accepted.length} registros de invitaciones aceptadas del historial? Las cuentas de usuario NO serán modificadas ni eliminadas.`)) return;
  try {
    let deletedCount = 0;
    for (const inv of accepted) {
      try {
        await requestJson(`/api/auth/admin/invitations/${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
        deletedCount++;
      } catch {
        // Ignorar fallo individual y continuar
      }
    }
    invitations = invitations.filter(inv => inv.status !== 'accepted');
    renderInvitations();
    showMessage(`Se eliminaron ${deletedCount} registros de invitaciones aceptadas correctamente.`, 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

async function saveUserLimits(user, maxProfilesValue, accountExpiresAtValue) {
  const maxProfiles = maxProfilesValue === '' ? null : Number(maxProfilesValue);
  if (maxProfiles !== null && (!Number.isInteger(maxProfiles) || maxProfiles < 1 || maxProfiles > 10000)) {
    showMessage('El límite debe ser un entero entre 1 y 10000, o dejarse vacío para ilimitado.');
    return;
  }
  try {
    const updated = await requestJson(`/api/auth/admin/users/${encodeURIComponent(user.id)}/limits`, {
      method: 'PATCH',
      body: JSON.stringify({
        maxProfiles,
        accountExpiresAt: accountExpiresAtValue || null,
      }),
    });
    users = users.map(entry => entry.id === updated.id ? updated : entry);
    renderUsers();
    showMessage('Límite y vencimiento actualizados correctamente.', 'success');
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

async function rotateMedicalProfileQr(profile) {
  if (!window.confirm(`¿Regenerar el código QR de ${profile.fullName || 'este paciente'}? El QR impreso actual dejará de funcionar de inmediato y habrá que entregar el nuevo.`)) return;
  try {
    const result = await requestJson(`/api/admin/profiles/${encodeURIComponent(profile.id)}/rotate-token`, { method: 'POST' });
    showMessage(result.message, 'success');
    await showProfileQr(profile);
  } catch (error) {
    showMessage(error.message);
  }
}

async function deleteMedicalProfile(profile) {
  if (!window.confirm(`¿Eliminar permanentemente la ficha de ${profile.fullName || 'este paciente'}? El QR dejará de funcionar.`)) return;
  try {
    await requestJson(`/api/admin/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
    medicalProfiles = medicalProfiles.filter(entry => entry.id !== profile.id);
    if (medicalProfileDetails.dataset.profileId === profile.id) {
      medicalProfileDetails.replaceChildren();
      medicalProfileDetails.hidden = true;
      delete medicalProfileDetails.dataset.profileId;
    }
    renderMedicalProfiles();
    renderUsers();
    showMessage('Ficha médica eliminada correctamente.', 'success');
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
    medicalProfiles = medicalProfiles.filter(profile => profile.ownerUserId !== user.id);
    renderUsers();
    renderMedicalProfiles();
    showMessage('Cuenta y perfiles asociados eliminados.', 'success');
  } catch (error) {
    showMessage(error.message);
  }
}

userSearch.addEventListener('input', renderUsers);
const cleanExpiredBtn = document.getElementById('cleanExpiredInvitationsBtn');
if (cleanExpiredBtn) {
  cleanExpiredBtn.addEventListener('click', cleanExpiredInvitations);
}
const cleanAcceptedBtn = document.getElementById('cleanAcceptedInvitationsBtn');
if (cleanAcceptedBtn) {
  cleanAcceptedBtn.addEventListener('click', cleanAcceptedInvitations);
}
invitationForm.addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(invitationForm);
  createInvitation({
    fullName: String(formData.get('fullName') || '').trim(),
    email: String(formData.get('email') || '').trim(),
    plan: String(formData.get('plan') || ''),
  });
});
document.getElementById('logoutButton').addEventListener('click', () => {
  if (window.confirm('¿Cerrar sesión?')) Auth.logout();
});
document.getElementById('downloadProfileQr').addEventListener('click', async () => {
  if (!currentQrProfileId) return;
  try {
    const response = await Auth.fetch(`/api/admin/profiles/${encodeURIComponent(currentQrProfileId)}/qr?format=png`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo descargar el código QR.');
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const download = document.createElement('a');
    download.href = objectUrl;
    download.download = `qr-emergencia-${currentQrProfileId}.png`;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    showMessage(error.message);
  }
});
document.getElementById('copyProfileQrLink').addEventListener('click', async () => {
  const target = document.getElementById('profileQrTarget');
  try {
    await navigator.clipboard.writeText(target.href);
    showMessage('Enlace público del QR copiado.', 'success');
  } catch {
    showMessage('No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.');
  }
});

(async function initialize() {
  const authenticated = await Auth.requireAuth();
  if (!authenticated) return;
  await loadUsers();
})();
