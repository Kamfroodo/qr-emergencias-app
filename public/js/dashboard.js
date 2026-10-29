/**
 * public/js/dashboard.js
 * Lógica del panel de administración:
 * - Carga y renderizado de fichas de emergencia
 * - Búsqueda en tiempo real y estadísticas
 * - Creación y edición de perfiles médicos
 * - Visualización, descarga e impresión de códigos QR
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ==========================================
  // 🔒 Verificación de sesión JWT
  // ==========================================
  await Auth.requireAuth();

  // Mostrar info del usuario autenticado en el navbar
  const user = Auth.getUser();
  if (user) {
    const userInfo = document.getElementById('userInfo');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    if (userInfo) {
      userInfo.style.display = 'flex';
      const initials = user.fullName
        ? user.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
        : user.email[0].toUpperCase();
      if (userAvatar) userAvatar.textContent = initials;
      if (userName) {
        userName.textContent = user.fullName || user.email;
        userName.style.display = 'block';
      }
    }
  }

  // Botón logout
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión? Volverás a la pantalla de acceso.')) {
        Auth.logout();
      }
    });
  }

  // Estado local
  let profiles = [];
  let currentEditingId = null;
  let activeQrProfile = null;

  // Elementos DOM
  const profilesGrid = document.getElementById('profilesGrid');
  const searchInput = document.getElementById('searchInput');
  const totalProfilesEl = document.getElementById('totalProfiles');
  const totalDonorsEl = document.getElementById('totalDonors');
  const totalAllergiesEl = document.getElementById('totalAllergies');
  
  // Modales
  const profileModal = document.getElementById('profileModal');
  const profileForm = document.getElementById('profileForm');
  const modalTitle = document.getElementById('modalTitle');
  const btnNewProfile = document.getElementById('btnNewProfile');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCancelModal = document.getElementById('btnCancelModal');

  // Modal QR
  const qrModal = document.getElementById('qrModal');
  const btnCloseQrModal = document.getElementById('btnCloseQrModal');
  const qrImage = document.getElementById('qrImage');
  const qrTargetUrl = document.getElementById('qrTargetUrl');
  const qrPatientName = document.getElementById('qrPatientName');
  const btnDownloadQr = document.getElementById('btnDownloadQr');
  const btnCopyQrUrl = document.getElementById('btnCopyQrUrl');
  const btnOpenEmergency = document.getElementById('btnOpenEmergency');
  const btnPrintCard = document.getElementById('btnPrintCard');

  // ==========================================
  // Inicialización y Carga de Datos
  // ==========================================
  loadProfiles();

  // Event Listeners
  if (btnNewProfile) btnNewProfile.addEventListener('click', openCreateModal);
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeProfileModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeProfileModal);
  if (profileForm) profileForm.addEventListener('submit', handleProfileSubmit);

  if (btnCloseQrModal) btnCloseQrModal.addEventListener('click', closeQrModal);
  if (searchInput) searchInput.addEventListener('input', handleSearch);

  if (btnCopyQrUrl) {
    btnCopyQrUrl.addEventListener('click', () => {
      const url = qrTargetUrl.textContent;
      navigator.clipboard.writeText(url).then(() => {
        showToast('¡Enlace de emergencia copiado al portapapeles!', 'success');
      }).catch(() => {
        showToast('No se pudo copiar el enlace automáticamente', 'error');
      });
    });
  }

  if (btnDownloadQr) {
    btnDownloadQr.addEventListener('click', () => {
      if (!activeQrProfile) return;
      const downloadUrl = `/api/profiles/${encodeURIComponent(activeQrProfile.id)}/qr?format=png`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `QR-Emergencia-${activeQrProfile.fullName.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Descargando imagen QR en alta resolución...', 'success');
    });
  }

  if (btnOpenEmergency) {
    btnOpenEmergency.addEventListener('click', () => {
      if (!activeQrProfile) return;
      const target = activeQrProfile.targetUrl || `/emergency.html?token=${encodeURIComponent(activeQrProfile.public_token || activeQrProfile.id)}`;
      window.open(target, '_blank');
    });
  }

  if (btnPrintCard) {
    btnPrintCard.addEventListener('click', () => {
      window.print();
    });
  }

  // Cerrar modales con clic fuera
  window.addEventListener('click', (e) => {
    if (e.target === profileModal) closeProfileModal();
    if (e.target === qrModal) closeQrModal();
  });

  // Cerrar con Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProfileModal();
      closeQrModal();
    }
  });

  // ==========================================
  // Funciones Principales de API
  // ==========================================
  async function loadProfiles() {
    try {
      profilesGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏳</div>
          <h3>Cargando fichas de emergencia...</h3>
          <p>Conectando con la base médica segura</p>
        </div>
      `;

      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('Error al cargar la lista de perfiles');

      profiles = await res.json();
      updateStats(profiles);
      renderProfiles(profiles);
    } catch (error) {
      console.error(error);
      profilesGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <h3>Error al cargar los perfiles</h3>
          <p>${error.message}</p>
          <button class="btn btn-secondary btn-sm" onclick="location.reload()" style="margin-top: 1rem;">Reintentar</button>
        </div>
      `;
      showToast('Error de conexión con el servidor', 'error');
    }
  }

  function updateStats(items) {
    if (totalProfilesEl) totalProfilesEl.textContent = items.length;
    
    const donors = items.filter(p => p.organDonor).length;
    if (totalDonorsEl) totalDonorsEl.textContent = donors;

    const allergiesTotal = items.reduce((acc, p) => acc + (p.allergiesCount || 0), 0);
    if (totalAllergiesEl) totalAllergiesEl.textContent = allergiesTotal;
  }

  // ==========================================
  // Renderizado de Perfiles
  // ==========================================
  function renderProfiles(list) {
    if (!profilesGrid) return;

    if (list.length === 0) {
      profilesGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <h3>No se encontraron fichas médicas</h3>
          <p>Crea tu primera ficha de emergencia haciendo clic en "+ Nueva Ficha".</p>
        </div>
      `;
      return;
    }

    profilesGrid.innerHTML = list.map(profile => {
      const initials = profile.fullName
        ? profile.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
        : 'EM';

      const donorBadge = profile.organDonor 
        ? '<span class="vital-pill donor">🫀 Donante</span>' 
        : '';

      const statusBadge = profile.is_active !== false
        ? '<span class="vital-pill" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">🟢 QR Activo</span>'
        : '<span class="vital-pill" style="background: rgba(239,35,60,0.15); color: #ef233c; border: 1px solid rgba(239,35,60,0.3);">⏸️ QR Pausado</span>';

      const contactName = profile.primaryContact?.name || 'No registrado';
      const contactPhone = profile.primaryContact?.phone || '';
      const whatsapp = profile.primaryContact?.whatsapp || contactPhone.replace(/[^0-9]/g, '');
      const emergencyUrl = `/emergency.html?token=${encodeURIComponent(profile.public_token || profile.id)}`;

      return `
        <div class="profile-card" data-id="${profile.id}">
          <div class="card-header">
            ${profile.photoUrl 
              ? `<img src="${profile.photoUrl}" alt="${profile.fullName}" class="avatar" onerror="this.outerHTML='<div class=\\'avatar\\'>${initials}</div>'">`
              : `<div class="avatar">${initials}</div>`
            }
            <div class="profile-meta">
              <h3 class="profile-name" title="${profile.fullName}">${profile.fullName}</h3>
              <p class="profile-sub">${profile.nationalId ? `ID: ${profile.nationalId}` : 'Sin ID'} ${profile.age ? `• ${profile.age} años` : ''}</p>
              <div style="margin-top: 0.35rem; display: flex; gap: 0.35rem; flex-wrap: wrap;">
                ${statusBadge}
                ${donorBadge}
              </div>
            </div>
            <div class="blood-tag">${profile.bloodType || 'O+'}</div>
          </div>

          <div class="card-body">
            <div class="card-item">
              <span class="label">Contacto Principal:</span>
              <span class="val">${contactName}</span>
            </div>
            <div class="card-item">
              <span class="label">Teléfono:</span>
              <span class="val">${contactPhone || 'No asignado'}</span>
            </div>
            <div class="card-item">
              <span class="label">Alertas registradas:</span>
              <span class="val">${profile.allergiesCount || 0} alergias • ${profile.conditionsCount || 0} afecciones</span>
            </div>
          </div>

          <div class="card-actions">
            <button class="btn btn-primary btn-sm btn-block btn-show-qr" data-id="${profile.id}">
              📱 Código QR
            </button>
            <a href="${emergencyUrl}" target="_blank" class="btn btn-secondary btn-sm" title="Ver ficha móvil rápida">
              👁️ Ver
            </a>
            <button class="btn btn-secondary btn-sm btn-toggle-status" data-id="${profile.id}" title="${profile.is_active !== false ? 'Pausar código QR (Revocar acceso)' : 'Activar código QR'}">
              ${profile.is_active !== false ? '⏸️' : '▶️'}
            </button>
            <button class="btn btn-secondary btn-sm btn-edit-profile" data-id="${profile.id}" title="Editar información">
              ✏️
            </button>
            <button class="btn btn-outline-danger btn-sm btn-delete-profile" data-id="${profile.id}" title="Eliminar ficha">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Asignar eventos a los botones de cada tarjeta
    document.querySelectorAll('.btn-show-qr').forEach(btn => {
      btn.addEventListener('click', () => openQrModal(btn.dataset.id));
    });

    document.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', () => toggleProfileStatus(btn.dataset.id));
    });

    document.querySelectorAll('.btn-edit-profile').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });

    document.querySelectorAll('.btn-delete-profile').forEach(btn => {
      btn.addEventListener('click', () => deleteProfile(btn.dataset.id));
    });
  }

  // ==========================================
  // Búsqueda en Vivo
  // ==========================================
  function handleSearch(e) {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
      renderProfiles(profiles);
      return;
    }

    const filtered = profiles.filter(p => {
      const matchName = p.fullName.toLowerCase().includes(term);
      const matchBlood = (p.bloodType || '').toLowerCase().includes(term);
      const matchId = (p.nationalId || '').toLowerCase().includes(term);
      const matchContact = (p.primaryContact?.name || '').toLowerCase().includes(term);
      return matchName || matchBlood || matchId || matchContact;
    });

    renderProfiles(filtered);
  }

  // ==========================================
  // Modal de Creación / Edición
  // ==========================================
  function openCreateModal() {
    currentEditingId = null;
    modalTitle.textContent = 'Nueva Ficha Médica de Emergencia';
    profileForm.reset();
    document.getElementById('profileId').value = '';
    document.getElementById('organDonor').checked = false;
    profileModal.classList.add('active');
  }

  async function openEditModal(id) {
    currentEditingId = id;
    modalTitle.textContent = 'Editar Ficha Médica';
    
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('No se pudo cargar la información del perfil');

      const data = await res.json();
      
      document.getElementById('profileId').value = data.id;
      document.getElementById('fullName').value = data.fullName || '';
      document.getElementById('birthDate').value = data.birthDate || '';
      document.getElementById('age').value = data.age || '';
      document.getElementById('nationalId').value = data.nationalId || '';
      document.getElementById('bloodType').value = data.bloodType || 'O+';
      document.getElementById('organDonor').checked = Boolean(data.organDonor);
      document.getElementById('photoUrl').value = data.photoUrl || '';

      // Contactos
      document.getElementById('primaryName').value = data.primaryContact?.name || '';
      document.getElementById('primaryRelation').value = data.primaryContact?.relationship || '';
      document.getElementById('primaryPhone').value = data.primaryContact?.phone || '';

      document.getElementById('secondaryName').value = data.secondaryContact?.name || '';
      document.getElementById('secondaryRelation').value = data.secondaryContact?.relationship || '';
      document.getElementById('secondaryPhone').value = data.secondaryContact?.phone || '';

      // Información médica
      document.getElementById('allergies').value = Array.isArray(data.allergies) ? data.allergies.join('\n') : (data.allergies || '');
      document.getElementById('conditions').value = Array.isArray(data.conditions) ? data.conditions.join('\n') : (data.conditions || '');
      document.getElementById('medications').value = Array.isArray(data.medications) ? data.medications.join('\n') : (data.medications || '');
      
      document.getElementById('insuranceCompany').value = data.insurance?.company || '';
      document.getElementById('policyNumber').value = data.insurance?.policyNumber || '';
      document.getElementById('emergencyLine').value = data.insurance?.emergencyLine || '';
      document.getElementById('preferredHospital').value = data.preferredHospital || '';
      document.getElementById('medicalNotes').value = data.medicalNotes || '';

      profileModal.classList.add('active');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function closeProfileModal() {
    profileModal.classList.remove('active');
    profileForm.reset();
    currentEditingId = null;
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();

    const payload = {
      fullName: document.getElementById('fullName').value.trim(),
      birthDate: document.getElementById('birthDate').value,
      age: parseInt(document.getElementById('age').value) || null,
      nationalId: document.getElementById('nationalId').value.trim(),
      bloodType: document.getElementById('bloodType').value,
      organDonor: document.getElementById('organDonor').checked,
      photoUrl: document.getElementById('photoUrl').value.trim(),
      primaryContact: {
        name: document.getElementById('primaryName').value.trim(),
        relationship: document.getElementById('primaryRelation').value.trim(),
        phone: document.getElementById('primaryPhone').value.trim()
      },
      secondaryContact: {
        name: document.getElementById('secondaryName').value.trim(),
        relationship: document.getElementById('secondaryRelation').value.trim(),
        phone: document.getElementById('secondaryPhone').value.trim()
      },
      allergies: document.getElementById('allergies').value.split('\n').map(s => s.trim()).filter(Boolean),
      conditions: document.getElementById('conditions').value.split('\n').map(s => s.trim()).filter(Boolean),
      medications: document.getElementById('medications').value.split('\n').map(s => s.trim()).filter(Boolean),
      insurance: {
        company: document.getElementById('insuranceCompany').value.trim(),
        policyNumber: document.getElementById('policyNumber').value.trim(),
        emergencyLine: document.getElementById('emergencyLine').value.trim()
      },
      preferredHospital: document.getElementById('preferredHospital').value.trim(),
      medicalNotes: document.getElementById('medicalNotes').value.trim()
    };

    try {
      const isEdit = Boolean(currentEditingId);
      const url = isEdit ? `/api/profiles/${encodeURIComponent(currentEditingId)}` : '/api/profiles';
      const method = isEdit ? 'PUT' : 'POST';

      // 🔒 Auth.fetch() agrega automáticamente el header Authorization: Bearer <token>
      const res = await Auth.fetch(url, {
        method,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al guardar el perfil');
      }

      showToast(isEdit ? 'Ficha actualizada exitosamente' : 'Ficha creada exitosamente', 'success');
      closeProfileModal();
      await loadProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // Eliminación de Perfil
  // ==========================================
  async function deleteProfile(id) {
    const profile = profiles.find(p => p.id === id);
    const name = profile ? profile.fullName : 'este perfil';

    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente la ficha médica de "${name}"? Esta acción invalidará su código QR.`)) {
      return;
    }

    try {
      // 🔒 Requiere autenticación JWT
      const res = await Auth.fetch(`/api/profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('No se pudo eliminar el perfil');

      showToast('Ficha de emergencia eliminada', 'success');
      await loadProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // Alternar Estado Activo / Pausado (Seguridad QR)
  // ==========================================
  async function toggleProfileStatus(id) {
    try {
      // 🔒 Requiere autenticación JWT
      const res = await Auth.fetch(`/api/profiles/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({})
      });

      if (!res.ok) throw new Error('No se pudo alternar el estado de la ficha');

      const data = await res.json();
      showToast(data.message, data.is_active ? 'success' : 'info');
      await loadProfiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // Modal de Código QR
  // ==========================================
  async function openQrModal(id) {
    try {
      qrImage.src = '';
      qrPatientName.textContent = 'Generando código QR...';
      qrTargetUrl.textContent = '...';
      qrModal.classList.add('active');

      // 🔒 Requiere autenticación JWT
      const res = await Auth.fetch(`/api/profiles/${encodeURIComponent(id)}/qr`);
      if (!res.ok) throw new Error('No se pudo generar el código QR');

      const data = await res.json();
      activeQrProfile = { id, fullName: data.fullName, targetUrl: data.targetUrl };

      qrImage.src = data.qrDataUrl;
      qrPatientName.textContent = `Ficha de Emergencia: ${data.fullName}`;
      qrTargetUrl.textContent = data.targetUrl;
    } catch (err) {
      showToast(err.message, 'error');
      closeQrModal();
    }
  }

  function closeQrModal() {
    qrModal.classList.remove('active');
    activeQrProfile = null;
  }

  // ==========================================
  // Helper de Notificaciones Toast
  // ==========================================
  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});
