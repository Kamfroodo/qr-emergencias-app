import React, { useEffect, useMemo, useState } from 'react';
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
  return {
    ...emptyProfile(),
    ...profile,
    primaryContact: { ...emptyProfile().primaryContact, ...profile.primaryContact },
    secondaryContact: { ...emptyProfile().secondaryContact, ...profile.secondaryContact },
    insurance: { ...emptyProfile().insurance, ...profile.insurance },
  };
}

function listText(value) {
  return Array.isArray(value) ? value.join('\n') : value || '';
}

function Dashboard() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [qr, setQr] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

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
    if (!editing && !qr) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setEditing(null);
        setQr(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, qr]);

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

  function notify(message, type = 'success') {
    setToast({ message, type });
  }

  function openCreate() {
    setForm(emptyProfile());
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
      setEditing({ id: profile.id, title: 'Editar ficha médica' });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function updateField(event) {
    const { name, value, type, checked } = event.target;
    const [section, field] = name.split('.');
    const nextValue = type === 'checkbox' ? checked : value;
    setForm(current => field
      ? { ...current, [section]: { ...current[section], [field]: nextValue } }
      : { ...current, [name]: nextValue });
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
    try {
      const response = await Auth.fetch(
        isEditing ? `/api/profiles/${encodeURIComponent(editing.id)}` : '/api/profiles',
        { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo guardar el perfil.');
      }
      setEditing(null);
      notify(isEditing ? 'Perfil actualizado.' : 'Perfil creado.');
      await loadProfiles();
    } catch (error) {
      notify(error.message, 'error');
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

  async function openQr(profile) {
    setQrLoading(true);
    setQr({ profile, targetUrl: '', qrDataUrl: '' });
    try {
      const response = await Auth.fetch(`/api/profiles/${encodeURIComponent(profile.id)}/qr`);
      if (!response.ok) throw new Error('No se pudo generar el código QR.');
      const data = await response.json();
      setQr({ profile, targetUrl: data.targetUrl, qrDataUrl: data.qrDataUrl });
    } catch (error) {
      setQr(null);
      notify(error.message, 'error');
    } finally {
      setQrLoading(false);
    }
  }

  async function downloadQr() {
    if (!qr) return;
    try {
      const response = await Auth.fetch(`/api/profiles/${encodeURIComponent(qr.profile.id)}/qr?format=png`);
      if (!response.ok) throw new Error('No se pudo descargar el código QR.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `QR-Emergencia-${qr.profile.fullName.replace(/\s+/g, '_')}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <>
      <section className="stats-grid" aria-label="Resumen de perfiles médicos">
        <Stat icon="📋" value={stats.total} label="Perfiles médicos" />
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
              onQr={() => openQr(profile)}
            />
          ))}
        </section>
      )}

      {editing && (
        <ProfileForm
          title={editing.title}
          form={form}
          saving={saving}
          onChange={updateField}
          onSubmit={saveProfile}
          onClose={() => setEditing(null)}
        />
      )}
      {qr && (
        <QrDialog
          qr={qr}
          loading={qrLoading}
          onClose={() => setQr(null)}
          onDownload={downloadQr}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(qr.targetUrl);
              notify('Enlace copiado.');
            } catch {
              notify('No se pudo copiar el enlace.', 'error');
            }
          }}
        />
      )}
      {toast && <div className={`profile-toast ${toast.type}`} role="status">{toast.message}</div>}
    </>
  );
}

function Stat({ icon, value, label }) {
  return <article className="stat-card"><div className="stat-icon red">{icon}</div><div className="stat-info"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div></article>;
}

function ProfileCard({ profile, onEdit, onDelete, onToggle, onQr }) {
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
        <button className="btn btn-primary btn-sm" onClick={onQr}>▦ Código QR</button>
        <a className="btn btn-secondary btn-sm" href={emergencyUrl} target="_blank" rel="noreferrer">Ver ficha</a>
        <button className="btn btn-secondary btn-sm" onClick={onToggle} title={active ? 'Pausar QR' : 'Activar QR'} aria-label={active ? 'Pausar código QR' : 'Activar código QR'}>{active ? 'Ⅱ' : '▶'}</button>
        <button className="btn btn-secondary btn-sm" onClick={onEdit} aria-label={`Editar ${profile.fullName}`}>✎</button>
        <button className="btn btn-outline-danger btn-sm" onClick={onDelete} aria-label={`Eliminar ${profile.fullName}`}>⌫</button>
      </div>
    </article>
  );
}

function ProfileForm({ title, form, saving, onChange, onSubmit, onClose }) {
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
                {input('Fecha de nacimiento', 'birthDate', { type: 'date' })}
                {input('Edad', 'age', { type: 'number', min: 0, max: 130 })}
                {input('URL de foto (opcional)', 'photoUrl', { type: 'url', placeholder: 'https://...', full: true })}
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

function Field({ label, name, value, onChange, type = 'text', placeholder, required, min, max, full, textarea, select, options }) {
  return (
    <div className={`form-group${full || textarea ? ' form-full' : ''}`}>
      <label htmlFor={`field-${name}`}>{label}</label>
      {textarea ? <textarea id={`field-${name}`} name={name} className="form-control" value={value} onChange={onChange} placeholder={placeholder} rows={3} /> : select ? (
        <select id={`field-${name}`} name={name} className="form-control" value={value} onChange={onChange} required={required}>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
      ) : <input id={`field-${name}`} name={name} type={type} className="form-control" value={value ?? ''} onChange={onChange} placeholder={placeholder} required={required} min={min} max={max} />}
    </div>
  );
}

function QrDialog({ qr, loading, onClose, onDownload, onCopy }) {
  return (
    <div className="modal-overlay profile-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-content qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <header className="modal-header"><h2 className="modal-title" id="qr-title">Código QR · {qr.profile.fullName}</h2><button className="btn-close" type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
        <div className="qr-dialog-body">
          <p>Al escanear el código se abrirá la ficha de emergencia de este perfil.</p>
          <div className="qr-preview">{loading ? <span role="status">Generando código QR…</span> : <img src={qr.qrDataUrl} alt={`Código QR de emergencia de ${qr.profile.fullName}`} />}</div>
          <p className="qr-link">{qr.targetUrl || 'Preparando enlace…'}</p>
          <div className="qr-dialog-actions">
            <button className="btn btn-primary" onClick={onDownload} disabled={loading}>Descargar PNG</button>
            <button className="btn btn-secondary" onClick={onCopy} disabled={loading}>Copiar enlace</button>
            <button className="btn btn-secondary" onClick={() => window.print()}>Imprimir</button>
            <a className="btn btn-success" href={qr.targetUrl || '#'} target="_blank" rel="noreferrer">Ver ficha</a>
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('dashboard-root')).render(<Dashboard />);
