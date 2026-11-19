import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const emptyProfile = () => ({
  fullName: '',
  birthDate: '',
  age: '',
  nationalId: '',
  bloodType: 'O+',
  organDonor: false,
  photoUrl: '',
  primaryContact: { name: '', relationship: '', phone: '' },
  secondaryContact: { name: '', relationship: '', phone: '' },
  allergies: [],
  conditions: [],
  medications: [],
  insurance: { company: '', policyNumber: '', emergencyLine: '' },
  preferredHospital: '',
  medicalNotes: '',
});

function toFormProfile(profile = {}) {
  const birthDate = profile.birthDate || '';
  return {
    ...emptyProfile(),
    ...profile,
    age: birthDate ? calculateAge(birthDate) : profile.age ?? '',
    primaryContact: { ...emptyProfile().primaryContact, ...profile.primaryContact },
    secondaryContact: { ...emptyProfile().secondaryContact, ...profile.secondaryContact },
    insurance: { ...emptyProfile().insurance, ...profile.insurance },
  };
}

function listText(value) {
  return Array.isArray(value) ? value.join('\n') : value || '';
}

function calculateAge(birthDate) {
  const match = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const today = new Date().toISOString().slice(0, 10);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== birthDate || birthDate > today) return '';
  const [currentYear, currentMonth, currentDay] = today.split('-').map(Number);
  return String(currentYear - year - (
    currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0
  ));
}

function Dashboard() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyProfile);
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => Auth.getUser());
  const [showPlanModal, setShowPlanModal] = useState(false);

  async function loadProfiles() {
    setLoading(true);
    setLoadError('');
    try {
      const response = await Auth.fetch('/api/profiles');
      if (!response.ok) throw new Error('No se pudieron cargar las fichas médicas.');
      setProfiles(await response.json());
    } catch (error) {
      setLoadError(error.message || 'Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const logoutButton = document.getElementById('btnLogout');
    const createButton = document.getElementById('btnNewProfile');
    const logout = () => {
      if (window.confirm('¿Cerrar sesión? Volverás a la pantalla de acceso.')) Auth.logout();
    };
    const create = () => openCreate();

    async function initialize() {
      const authenticated = await Auth.requireAuth();
      if (!authenticated || !active) return;

      const user = Auth.getUser();
      if (user) {
        setCurrentUser(user);
        const adminLink = document.getElementById('adminLink');
        const userInfo = document.getElementById('userInfo');
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const name = user.fullName || user.email || 'Usuario';
        if (adminLink && user.role === 'admin') adminLink.style.display = 'inline-flex';
        if (userInfo) userInfo.style.display = 'flex';
        if (userAvatar) userAvatar.textContent = name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
        if (userName) {
          userName.textContent = name;
          userName.style.display = 'block';
        }
      }

      logoutButton?.addEventListener('click', logout);
      createButton?.addEventListener('click', create);
      loadProfiles();
    }

    initialize();
    return () => {
      active = false;
      logoutButton?.removeEventListener('click', logout);
      createButton?.removeEventListener('click', create);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return profiles;
    return profiles.filter(profile => [
      profile.fullName,
      profile.nationalId,
      profile.bloodType,
      profile.primaryContact?.name,
    ].some(value => (value || '').toLocaleLowerCase().includes(term)));
  }, [profiles, search]);

  const stats = useMemo(() => ({
    total: profiles.length,
    donors: profiles.filter(profile => profile.organDonor).length,
    allergies: profiles.reduce((sum, profile) => sum + (profile.allergiesCount || profile.allergies?.length || 0), 0),
  }), [profiles]);

  const planInfo = useMemo(() => {
    // El plan lo asigna el administrador; aquí solo se muestra.
    if (!currentUser) return { name: 'Cargando...', limitText: '—', expires: '—' };
    const expires = currentUser.accountExpiresAt
      ? new Date(currentUser.accountExpiresAt).toLocaleDateString()
      : 'Sin vencimiento';
    const names = { 1: 'Plan Individual', 5: 'Plan Familiar', 100: 'Plan Institución' };
    if (currentUser.maxProfiles) {
      return {
        name: names[currentUser.maxProfiles] || `Plan (${currentUser.maxProfiles} fichas)`,
        limitText: `${currentUser.maxProfiles} ${currentUser.maxProfiles === 1 ? 'ficha' : 'fichas'} máx`,
        expires,
      };
    }
    return { name: 'Plan Ilimitado', limitText: 'Sin límite', expires };
  }, [currentUser]);

  function notify(message, type = 'success') {
    setToast({ message, type });
  }

  function openCreate() {
    setForm(emptyProfile());
    setPhotoFile(null);
    setEditing({ id: null, title: 'Nueva ficha médica' });
  }

  async function openEdit(id) {
    try {
      const response = await Auth.fetch(`/api/profiles/${encodeURIComponent(id)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo cargar el perfil.');
      }
      const profile = await response.json();
      setForm(toFormProfile(profile));
      setPhotoFile(null);
      setEditing({ id: profile.id, title: 'Editar ficha médica' });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function updateField(event) {
    const { name, value, type, checked } = event.target;
    if (name === 'birthDate') {
      setForm(current => ({
        ...current,
        birthDate: value,
        age: value ? calculateAge(value) : '',
      }));
      return;
    }
    const [section, field] = name.split('.');
    const nextValue = type === 'checkbox' ? checked : value;
    setForm(current => field
      ? { ...current, [section]: { ...current[section], [field]: nextValue } }
      : { ...current, [name]: nextValue });
  }

  function selectPhoto(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      notify('Selecciona una imagen JPG, PNG o WebP.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('La foto no puede superar 5 MB.', 'error');
      return;
    }
    setPhotoFile(file);
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      age: form.age === '' ? null : Number(form.age),
      allergies: listText(form.allergies).split('\n').map(item => item.trim()).filter(Boolean),
      conditions: listText(form.conditions).split('\n').map(item => item.trim()).filter(Boolean),
      medications: listText(form.medications).split('\n').map(item => item.trim()).filter(Boolean),
    };
    const isEditing = Boolean(editing.id);
    let savedProfile = null;
    try {
      const response = await Auth.fetch(
        isEditing ? `/api/profiles/${encodeURIComponent(editing.id)}` : '/api/profiles',
        { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo guardar el perfil.');
      }
      savedProfile = await response.json();

      if (photoFile) {
        const photoResponse = await Auth.fetch(`/api/profiles/${encodeURIComponent(savedProfile.id)}/photo`, {
          method: 'POST',
          headers: { 'Content-Type': photoFile.type },
          body: photoFile,
        });
        if (!photoResponse.ok) {
          const body = await photoResponse.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo guardar la foto.');
        }
      }

      setEditing(null);
      setPhotoFile(null);
      notify(isEditing ? 'Perfil actualizado.' : 'Perfil creado.');
      await loadProfiles();
    } catch (error) {
      if (savedProfile) {
        setEditing(current => current ? { ...current, id: savedProfile.id } : current);
        setForm(toFormProfile(savedProfile));
        await loadProfiles();
        notify(`La ficha se guardó, pero no la foto. Puedes volver a intentarlo: ${error.message}`, 'error');
      } else {
        notify(error.message, 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(profile) {
    try {
      const response = await Auth.fetch(`/api/profiles/${encodeURIComponent(profile.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error('No se pudo cambiar el estado del QR.');
      const result = await response.json();
      notify(result.message, result.is_active ? 'success' : 'info');
      await loadProfiles();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function deleteProfile(profile) {
    if (!window.confirm(`¿Eliminar permanentemente la ficha de "${profile.fullName}"? Esta acción invalidará su código QR.`)) return;
    try {
      const response = await Auth.fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo eliminar la ficha médica.');
      notify('Ficha eliminada.');
      await loadProfiles();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <>
      <section className="stats-grid" aria-label="Resumen de perfiles médicos">
        <Stat
          icon="📋"
          value={`${profiles.length} / ${currentUser?.maxProfiles ?? '∞'}`}
          label={`Fichas (${planInfo.limitText})`}
        />
        <article className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setShowPlanModal(true)} title="Ver los planes disponibles">
          <div className="stat-icon red">⭐</div>
          <div className="stat-info">
            <div className="stat-value" style={{ fontSize: '1.15rem' }}>{planInfo.name}</div>
            <div className="stat-label">{`Vigencia: ${planInfo.expires}`}</div>
          </div>
        </article>
        <Stat icon="🫀" value={stats.donors} label="Donantes de órganos" />
        <Stat icon="⚠️" value={stats.allergies} label="Alertas de alergias" />
      </section>

      <section className="controls-bar profile-controls" aria-label="Herramientas de perfiles">
        <label className="search-box">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por nombre, documento, grupo sanguíneo..."
            aria-label="Buscar perfiles médicos"
          />
        </label>
        <span className="profile-count">{filteredProfiles.length} {filteredProfiles.length === 1 ? 'perfil' : 'perfiles'}</span>
      </section>

      {loading ? (
        <div className="empty-state" role="status"><div className="empty-state-icon">⏳</div><h2>Cargando perfiles...</h2><p>Conectando con la base médica segura.</p></div>
      ) : loadError ? (
        <div className="empty-state" role="alert"><div className="empty-state-icon">⚠️</div><h2>Error al cargar los perfiles</h2><p>{loadError}</p><button className="btn btn-secondary" onClick={loadProfiles}>Reintentar</button></div>
      ) : filteredProfiles.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📭</div><h2>{search ? 'No hay resultados' : 'Aún no tienes perfiles médicos'}</h2><p>{search ? 'Prueba con otro nombre, documento o grupo sanguíneo.' : 'Crea el primer perfil para tener a mano su información de emergencia.'}</p>{!search && <button className="btn btn-primary" onClick={openCreate}>＋ Crear perfil</button>}</div>
      ) : (
        <section className="profiles-grid" aria-label="Perfiles médicos">
          {filteredProfiles.map(profile => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onEdit={() => openEdit(profile.id)}
              onDelete={() => deleteProfile(profile)}
              onToggle={() => toggleStatus(profile)}
            />
          ))}
        </section>
      )}

      {editing && (
        <ProfileForm
          title={editing.title}
          form={form}
          photoFile={photoFile}
          saving={saving}
          onChange={updateField}
          onPhotoChange={selectPhoto}
          onSubmit={saveProfile}
          onClose={() => { setEditing(null); setPhotoFile(null); }}
        />
      )}
      {showPlanModal && (
        <PlanModal
          currentPlanName={planInfo.name}
          onClose={() => setShowPlanModal(false)}
        />
      )}
      {toast && <div className={`profile-toast ${toast.type}`} role="status">{toast.message}</div>}
    </>
  );
}

function Stat({ icon, value, label }) {
  return <article className="stat-card"><div className="stat-icon red">{icon}</div><div className="stat-info"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div></article>;
}

function ProfileCard({ profile, onEdit, onDelete, onToggle }) {
  const [photoError, setPhotoError] = useState(false);
  const initials = (profile.fullName || 'EM').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const emergencyUrl = `/emergency.html?token=${encodeURIComponent(profile.public_token || profile.id)}`;
  const active = profile.is_active !== false;
  return (
    <article className="profile-card">
      <header className="card-header">
        {profile.photoUrl && !photoError ? <img src={profile.photoUrl} alt="" className="avatar" onError={() => setPhotoError(true)} /> : <div className="avatar" aria-hidden="true">{initials}</div>}
        <div className="profile-meta">
          <h2 className="profile-name">{profile.fullName}</h2>
          <p className="profile-sub">{profile.nationalId || 'Sin documento'}{profile.age ? ` · ${profile.age} años` : ''}</p>
          <div className="profile-badges">
            <span className={`vital-pill ${active ? 'active' : 'paused'}`}>{active ? '● QR activo' : 'Ⅱ QR pausado'}</span>
            {profile.organDonor && <span className="vital-pill donor">🫀 Donante</span>}
          </div>
        </div>
        <div className="blood-tag" aria-label={`Grupo sanguíneo ${profile.bloodType || 'no registrado'}`}>{profile.bloodType || 'N/E'}</div>
      </header>
      <div className="card-body">
        <div className="card-item"><span className="label">Contacto principal</span><span className="val">{profile.primaryContact?.name || 'No registrado'}</span></div>
        <div className="card-item"><span className="label">Teléfono</span><span className="val">{profile.primaryContact?.phone || 'No asignado'}</span></div>
        <div className="card-item"><span className="label">Alertas médicas</span><span className="val">{profile.allergiesCount || 0} alergias · {profile.conditionsCount || 0} afecciones</span></div>
      </div>
      <div className="profile-actions">
        <a className="btn btn-secondary btn-sm" href={emergencyUrl} target="_blank" rel="noreferrer">Ver ficha</a>
        <button className="btn btn-secondary btn-sm" onClick={onToggle} title={active ? 'Pausar QR' : 'Activar QR'} aria-label={active ? 'Pausar código QR' : 'Activar código QR'}>{active ? 'Ⅱ' : '▶'}</button>
        <button className="btn btn-secondary btn-sm" onClick={onEdit} aria-label={`Editar ${profile.fullName}`}>✎</button>
        <button className="btn btn-outline-danger btn-sm" onClick={onDelete} aria-label={`Eliminar ${profile.fullName}`}>⌫</button>
      </div>
    </article>
  );
}

function ProfileForm({ title, form, photoFile, saving, onChange, onPhotoChange, onSubmit, onClose }) {
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);
  const [photoPreview, setPhotoPreview] = useState(form.photoUrl || '');
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(form.photoUrl || '');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile, form.photoUrl]);

  const input = (label, name, options = {}) => (
    <Field label={label} name={name} value={name.includes('.') ? form[name.split('.')[0]][name.split('.')[1]] : form[name]} onChange={onChange} {...options} />
  );
  const textarea = (label, name, placeholder) => (
    <Field label={label} name={name} value={listText(form[name])} onChange={onChange} textarea placeholder={placeholder} />
  );
  return (
    <div className="modal-overlay profile-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-content profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-form-title">
        <header className="modal-header"><h2 className="modal-title" id="profile-form-title">{title}</h2><button className="btn-close" type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            <FormSection title="1. Datos personales">
              <div className="form-grid">
                {input('Nombre completo *', 'fullName', { required: true, placeholder: 'Nombre y apellidos', full: true })}
                {input('Documento', 'nationalId', { placeholder: 'RUT / DNI / Pasaporte' })}
                <Field label="Grupo sanguíneo *" name="bloodType" value={form.bloodType} onChange={onChange} required select options={['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']} />
                {input('Fecha de nacimiento', 'birthDate', { type: 'date', max: new Date().toISOString().slice(0, 10) })}
                {input('Edad (automática)', 'age', { type: 'number', min: 0, max: 130, readOnly: true })}
                <div className="form-group form-full">
                  <label>Fotografía del paciente</label>
                  {photoPreview && <img src={photoPreview} alt="Vista previa de la fotografía del paciente" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', marginBottom: '0.75rem' }} />}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => cameraInput.current?.click()} disabled={saving}>Tomar fotografía</button>
                    <button type="button" className="btn btn-secondary" onClick={() => galleryInput.current?.click()} disabled={saving}>Elegir de galería</button>
                  </div>
                  <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={event => { onPhotoChange(event.target.files?.[0]); event.target.value = ''; }} />
                  <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => { onPhotoChange(event.target.files?.[0]); event.target.value = ''; }} />
                  <small>JPG, PNG o WebP; máximo 5 MB. La imagen será visible para quien consulte la ficha pública del QR.</small>
                </div>
                <label className="checkbox-label form-full"><input type="checkbox" name="organDonor" checked={Boolean(form.organDonor)} onChange={onChange} /><span>El paciente es donante de órganos</span></label>
              </div>
            </FormSection>
            <FormSection title="2. Contactos de emergencia">
              <div className="form-grid">
                {input('Contacto principal', 'primaryContact.name', { placeholder: 'Nombre' })}
                {input('Parentesco', 'primaryContact.relationship', { placeholder: 'Ej. Madre, cónyuge' })}
                {input('Teléfono principal', 'primaryContact.phone', { type: 'tel', placeholder: '+56 9 1234 5678', full: true })}
                {input('Contacto secundario', 'secondaryContact.name', { placeholder: 'Nombre' })}
                {input('Parentesco', 'secondaryContact.relationship', { placeholder: 'Ej. Médico tratante' })}
                {input('Teléfono secundario', 'secondaryContact.phone', { type: 'tel', placeholder: '+56 9 8765 4321', full: true })}
              </div>
            </FormSection>
            <FormSection title="3. Información médica">
              <div className="form-grid">
                {textarea('Alergias y contraindicaciones (una por línea)', 'allergies', 'Ej. Penicilina (anafilaxia)')}
                {textarea('Enfermedades y condiciones (una por línea)', 'conditions', 'Ej. Diabetes tipo 1')}
                {textarea('Medicamentos y dosis (uno por línea)', 'medications', 'Ej. Insulina 20 UI / noche')}
              </div>
            </FormSection>
            <FormSection title="4. Seguro y notas clínicas">
              <div className="form-grid">
                {input('Aseguradora / sistema', 'insurance.company', { placeholder: 'Fonasa, Isapre...' })}
                {input('Póliza o afiliación', 'insurance.policyNumber')}
                {input('Teléfono de emergencia del seguro', 'insurance.emergencyLine', { type: 'tel', full: true })}
                {input('Centro médico preferido', 'preferredHospital', { full: true })}
                {textarea('Dispositivos, cirugías y notas clínicas', 'medicalNotes', 'Información relevante para una emergencia')}
              </div>
            </FormSection>
          </div>
          <footer className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar ficha'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function FormSection({ title, children }) {
  return <section className="form-section"><h3>{title}</h3>{children}</section>;
}

function Field({ label, name, value, onChange, type = 'text', placeholder, required, min, max, readOnly, full, textarea, select, options }) {
  return (
    <div className={`form-group${full || textarea ? ' form-full' : ''}`}>
      <label htmlFor={`field-${name}`}>{label}</label>
      {textarea ? <textarea id={`field-${name}`} name={name} className="form-control" value={value} onChange={onChange} placeholder={placeholder} rows={3} /> : select ? (
        <select id={`field-${name}`} name={name} className="form-control" value={value} onChange={onChange} required={required}>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
      ) : <input id={`field-${name}`} name={name} type={type} className="form-control" value={value ?? ''} onChange={onChange} placeholder={placeholder} required={required} min={min} max={max} readOnly={readOnly} />}
    </div>
  );
}

// Catálogo informativo: los planes son pagados y los asigna el administrador.
function PlanModal({ currentPlanName, onClose }) {
  const plans = [
    {
      id: 'individual',
      tag: 'POR UN AÑO',
      name: 'Individual',
      features: '1 ficha · 1 QR · 1 contacto · Soporte',
      price: '$5.000',
      cycle: 'por año',
    },
    {
      id: 'familiar',
      tag: 'PLAN',
      name: 'Familiar',
      features: '5 fichas · 5 QR personalizados · 5 contactos',
      price: '$19.990',
      cycle: 'por año',
      badge: 'Recomendado',
    },
    {
      id: 'institucion',
      tag: 'PLAN',
      name: 'Institución',
      features: '100 fichas · 100 QR personalizados · 100 contactos',
      price: '$180.990',
      cycle: 'por 6 meses',
      badge: 'Precio conversable',
    },
  ];

  return (
    <div className="modal-overlay profile-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-content profile-modal" role="dialog" aria-modal="true" style={{ maxWidth: '640px' }}>
        <header className="modal-header">
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#ef233c', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              DASHLAB · QR EMERGENCIAS
            </div>
            <h2 className="modal-title" style={{ fontSize: '1.4rem', fontWeight: 900 }}>
              Tu plan: {currentPlanName}
            </h2>
          </div>
          <button className="btn-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="modal-body" style={{ padding: '1.25rem' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
            Para contratar, renovar o cambiar de plan, contacta al administrador. Estos son los planes disponibles:
          </p>
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {plans.map(p => {
              const isSelected = currentPlanName === `Plan ${p.name}`;
              return (
                <div
                  key={p.id}
                  style={{
                    padding: '1.1rem 1.25rem',
                    borderRadius: '14px',
                    border: isSelected ? '2px solid #ef233c' : '1px solid #1e2c47',
                    background: isSelected ? 'linear-gradient(135deg, rgba(239, 35, 60, 0.15) 0%, rgba(13, 23, 41, 0.95) 100%)' : '#0d1729',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s ease',
                    boxShadow: isSelected ? '0 0 20px rgba(239, 35, 60, 0.25)' : 'none',
                  }}
                >
                  <div style={{ flex: 1, paddingRight: '1rem' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {p.tag}
                      {p.badge && (
                        <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem', background: 'rgba(239,35,60,0.2)', border: '1px solid rgba(239,35,60,0.5)', color: '#ff4d6d', borderRadius: '999px' }}>
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', margin: '0.2rem 0' }}>{p.name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{p.features}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '120px' }}>
                    <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#fff' }}>{p.price}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{p.cycle}</div>
                  </div>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: isSelected ? '2px solid #ef233c' : '2px solid #334155',
                    background: isSelected ? '#ef233c' : 'transparent',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: '0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}>
                    {isSelected ? '✓' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>Entendido</button>
        </footer>
      </section>
    </div>
  );
}

createRoot(document.getElementById('dashboard-root')).render(<Dashboard />);
