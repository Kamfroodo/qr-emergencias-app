// emergency.js - Lógica de emergency.html (en archivo aparte para que la CSP no permita scripts inline).

(async function initEmergencyApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || urlParams.get('id');

  // Copia local para seguir viendo la ficha sin señal (ver js/emergency-cache.js).
  let storage = null;
  try { storage = window.localStorage; } catch (e) {}
  EmergencyCache.purgeExpired(storage);

  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const patientContent = document.getElementById('patientContent');
  const errorTitle = document.getElementById('errorTitle');
  const errorMessage = document.getElementById('errorMessage');

  if (!token) {
    loadingState.style.display = 'none';
    errorTitle.textContent = 'Token no especificado';
    errorMessage.textContent = 'No se proporcionó un token o código de emergencia válido (?token=...).';
    errorState.style.display = 'flex';
    return;
  }

  try {
    const response = await fetch('/api/v1/emergency/' + encodeURIComponent(token));

    if (response.status === 403) {
      // Ficha pausada o cuenta vencida/suspendida: no debe quedar copia en este teléfono.
      EmergencyCache.remove(storage, token);
      const errData = await response.json();
      loadingState.style.display = 'none';
      errorTitle.textContent = errData.code === 'ACCOUNT_EXPIRED'
        ? 'Suscripción o Plan Vencido'
        : (errData.code === 'ACCOUNT_SUSPENDED' ? 'Cuenta Suspendida' : 'Ficha Médica Desactivada');
      errorMessage.textContent = errData.message || 'El titular ha pausado temporalmente este código QR por seguridad.';
      errorState.style.display = 'flex';
      return;
    }

    if (response.status === 404) {
      // Ficha eliminada o QR regenerado: borrar la copia y NO mostrarla.
      EmergencyCache.remove(storage, token);
      loadingState.style.display = 'none';
      errorTitle.textContent = 'Código QR no válido';
      errorMessage.textContent = 'Esta ficha médica no existe o su código QR fue reemplazado por el titular.';
      errorState.style.display = 'flex';
      return;
    }

    if (!response.ok) {
      // Error del servidor o demasiadas consultas: se puede usar la copia local.
      throw new Error('No se pudo consultar la ficha médica en este momento. Inténtalo nuevamente.');
    }

    const data = await response.json();
    renderProfile(data);

    // Guardar copia local temporal para rescates sin cobertura
    EmergencyCache.save(storage, token, data);

  } catch (err) {
    // Sin señal o servidor caído: usar la copia local solo si sigue vigente.
    const cached = EmergencyCache.load(storage, token);
    if (cached) {
      try {
        renderProfile(cached.data);
        showOfflineNotice(cached.savedAt);
        return;
      } catch(e) {}
    }

    loadingState.style.display = 'none';
    errorTitle.textContent = 'Error de Carga';
    errorMessage.textContent = err instanceof TypeError
      ? 'Sin conexión a internet. Revisa la señal e inténtalo nuevamente.'
      : err.message;
    errorState.style.display = 'flex';
  }

  function showOfflineNotice(savedAt) {
    const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60000));
    const ago = minutes < 1 ? 'hace menos de un minuto'
      : minutes < 60 ? `hace ${minutes} min`
        : `hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:0.75rem;padding:0.75rem 1rem;font-size:0.82rem;font-weight:600;';
    notice.textContent = `Sin conexión: mostrando datos guardados en este teléfono ${ago}. Pueden no estar actualizados.`;
    patientContent.prepend(notice);
  }

  function renderProfile(p) {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    patientContent.style.display = 'flex';

    const name = p.fullName || p.profile_name || 'Paciente';
    const blood = p.bloodType || p.blood_type || 'N/E';

    document.title = `🚨 URGENCIA: ${name} (${blood})`;

    // Foto y Nombres (sin foto o si falla la carga: iniciales del paciente)
    const photo = document.getElementById('patientPhoto');
    const initialsBox = document.getElementById('patientInitials');
    initialsBox.textContent = name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || '?';
    const showInitials = () => {
      photo.hidden = true;
      photo.removeAttribute('src');
      initialsBox.hidden = false;
    };
    const photoUrl = p.photoUrl || p.photo_url;
    if (photoUrl) {
      photo.onerror = showInitials;
      photo.onload = () => { initialsBox.hidden = true; };
      photo.src = photoUrl;
      photo.hidden = false;
      initialsBox.hidden = true;
    } else {
      showInitials();
    }
    document.getElementById('patientName').textContent = name;
    
    const birthDate = p.birthDate || p.birth_date || '';
    const age = p.age ? `${p.age} años` : '';
    const doc = p.nationalId || p.national_id ? `ID: ${p.nationalId || p.national_id}` : '';
    document.getElementById('patientSub').textContent = [doc, age, birthDate ? `Nac: ${birthDate}` : ''].filter(Boolean).join(' • ') || 'Sin información secundaria';

    document.getElementById('bloodTypeBadge').textContent = blood;

    if (p.organDonor || p.organ_donor) {
      document.getElementById('donorPill').style.display = 'inline-block';
    }

    // Contactos y Botón de llamada directa
    const contacts = (Array.isArray(p.emergency_contacts) && p.emergency_contacts.length
      ? p.emergency_contacts
      : [p.primaryContact, p.secondaryContact]).filter(Boolean);
    const contact = contacts[0] || {};
    const contactName = contact.name || 'Contacto de Emergencia';
    const contactPhone = contact.phone || '';
    const rawWa = (contact.whatsapp || contactPhone).replace(/[^0-9]/g, '');

    if (contactPhone) {
      document.getElementById('btnCallContact').href = 'tel:' + contactPhone;
      document.getElementById('callButtonText').textContent = `Llamar a ${contactName}`;
    } else {
      document.getElementById('btnCallContact').style.opacity = '0.5';
      document.getElementById('btnCallContact').style.pointerEvents = 'none';
      document.getElementById('callButtonText').textContent = 'Sin teléfono de contacto registrado';
    }

    if (rawWa) {
      document.getElementById('btnWhatsApp').href = `https://wa.me/${encodeURIComponent(rawWa)}?text=${encodeURIComponent('EMERGENCIA: Asistiendo a ' + name + ' tras escanear ficha QR médica.')}`;
    } else {
      document.getElementById('btnWhatsApp').style.display = 'none';
    }

    const locationButton = document.getElementById('btnShareGps');
    const locationStatus = document.getElementById('locationStatus');
    const locationContactActions = document.getElementById('locationContactActions');
    const whatsappContacts = contacts.map((entry, index) => ({
      name: entry.name || `Contacto ${index + 1}`,
      phone: (entry.whatsapp || entry.phone || '').replace(/[^0-9]/g, ''),
    })).filter(entry => entry.phone)
      .filter((entry, index, list) => list.findIndex(other => other.phone === entry.phone) === index);
    if (!whatsappContacts.length) {
      locationButton.disabled = true;
      locationButton.style.opacity = '0.55';
      locationButton.style.cursor = 'not-allowed';
      locationStatus.textContent = 'No hay teléfonos registrados para WhatsApp en los contactos de emergencia.';
    }
    locationButton.addEventListener('click', () => {
      if (!whatsappContacts.length) return;
      if (!navigator.geolocation) {
        locationStatus.textContent = 'Este navegador no permite obtener la ubicación. Revisa los permisos o intenta desde un navegador compatible.';
        return;
      }

      locationButton.disabled = true;
      locationStatus.textContent = 'Solicitando permiso para obtener la ubicación…';
      locationContactActions.style.display = 'none';
      locationContactActions.replaceChildren();

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const mapsUrl = `https://maps.google.com/?q=${position.coords.latitude},${position.coords.longitude}`;
          const message = `🚨 EMERGENCIA: Se solicita ayuda para ${name}. Ubicación actual: ${mapsUrl}`;
          for (const entry of whatsappContacts) {
            const link = document.createElement('a');
            link.href = `https://wa.me/${encodeURIComponent(entry.phone)}?text=${encodeURIComponent(message)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = `Abrir WhatsApp para ${entry.name}`;
            link.style.cssText = 'display:block;width:100%;padding:0.75rem;border-radius:0.65rem;background:#16a34a;color:#fff;text-align:center;text-decoration:none;font-size:0.85rem;font-weight:700;';
            locationContactActions.append(link);
          }
          locationContactActions.style.display = 'flex';
          locationButton.disabled = false;
          locationStatus.textContent = `Ubicación lista. Elige cada contacto; WhatsApp abrirá el mensaje para que confirmes el envío.`;
        },
        (error) => {
          locationButton.disabled = false;
          locationStatus.textContent = error.code === 1
            ? 'Se necesita permitir el acceso a la ubicación para incluir el mapa.'
            : error.code === 3
              ? 'La solicitud de ubicación tardó demasiado. Activa el GPS e inténtalo nuevamente.'
              : 'No se pudo obtener la ubicación. Revisa el GPS y los permisos del navegador.';
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
      );
    });

    // Condiciones Críticas y Alergias (Caja Roja)
    const conditions = p.critical_conditions || p.conditions || [];
    const allergies = p.allergies || [];
    const mergedAlerts = [];

    allergies.forEach(a => mergedAlerts.push(`⛔ ALERGIA SEVERA: ${a}`));
    conditions.forEach(c => mergedAlerts.push(`⚡ CONDICIÓN: ${c}`));

    const alertContainer = document.getElementById('criticalConditionsContent');
    if (mergedAlerts.length > 0) {
      alertContainer.innerHTML = mergedAlerts.map(alert => `
        <div style="padding: 0.2rem 0; border-bottom: 1px solid rgba(220, 38, 38, 0.15);">${escapeHtml(alert)}</div>
      `).join('');
    } else {
      alertContainer.innerHTML = '<span style="color: #15803d; font-weight: 500; font-size: 0.85rem;">✓ Sin condiciones o alergias críticas registradas.</span>';
    }

    // Medicamentos
    const meds = p.medications || [];
    const medsContainer = document.getElementById('medicationsContent');
    if (Array.isArray(meds) && meds.length > 0) {
      medsContainer.innerHTML = meds.map(m => `
        <div style="padding: 0.2rem 0; border-bottom: 1px solid #f1f5f9;">• ${escapeHtml(m)}</div>
      `).join('');
    } else if (typeof meds === 'string' && meds.trim()) {
      medsContainer.textContent = meds;
    } else {
      medsContainer.innerHTML = '<span style="color: #94a3b8; font-size: 0.85rem;">Ninguno registrado.</span>';
    }

    // Seguro y Hospital
    const ins = p.insurance || {};
    if (ins.company) document.getElementById('insuranceName').textContent = ins.company;
    if (ins.policyNumber) document.getElementById('policyNumber').textContent = ins.policyNumber;
    const hospital = p.preferredHospital || p.preferred_hospital;
    if (hospital) document.getElementById('preferredHospital').textContent = hospital;

    // Notas Adicionales
    const notes = p.medicalNotes || p.medical_notes;
    if (notes && notes.trim()) {
      document.getElementById('medicalNotesText').textContent = notes;
      document.getElementById('notesSection').style.display = 'block';
    }

    // Audio lector Web Speech API
    setupAudioReader(name, blood, p.organDonor || p.organ_donor, allergies, conditions);

  }

  function setupAudioReader(name, blood, isDonor, allergies, conditions) {
    const btnVoice = document.getElementById('btnVoiceSummary');
    const voiceText = document.getElementById('voiceBtnText');

    if (!('speechSynthesis' in window)) {
      btnVoice.style.display = 'none';
      return;
    }

    let isSpeaking = false;

    btnVoice.addEventListener('click', () => {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        voiceText.textContent = 'Escuchar Audio';
        return;
      }

      const speechContent = `Ficha médica de emergencia. Paciente: ${name}. Grupo sanguíneo: ${blood}. ${isDonor ? 'Donante de órganos.' : ''} ${allergies.length ? 'Alergias graves: ' + allergies.join('. ') : 'Sin alergias.'} ${conditions.length ? 'Condiciones: ' + conditions.join('. ') : ''}`;

      const utterance = new SpeechSynthesisUtterance(speechContent);
      utterance.lang = 'es-ES';
      utterance.rate = 1.05;

      utterance.onstart = () => {
        isSpeaking = true;
        voiceText.textContent = 'Detener Audio';
      };
      utterance.onend = utterance.onerror = () => {
        isSpeaking = false;
        voiceText.textContent = 'Escuchar Audio';
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
