import React from 'react';

/**
 * EmergencyView.jsx
 * Componente móvil ultrarrápido para React / Next.js con Tailwind CSS
 * Compatible con la API de perfiles de emergencia (snake_case y camelCase)
 */
export default function EmergencyView({ profile }) {
    if (!profile) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                <div className="text-center bg-white p-6 rounded-2xl shadow-md max-w-sm w-full border border-red-100">
                    <div className="text-4xl mb-2">⚠️</div>
                    <h1 className="text-xl font-bold text-red-600">Perfil no disponible</h1>
                    <p className="text-gray-600 text-sm mt-2">
                        El código QR no es válido o la ficha médica ha sido pausada temporalmente por el titular.
                    </p>
                </div>
            </div>
        );
    }

    const name = profile.fullName || profile.profile_name || 'Paciente';
    const blood = profile.bloodType || profile.blood_type || 'N/E';
    const photo = profile.photoUrl || profile.photo_url || 'https://via.placeholder.com/100?text=PACIENTE';
    const birthDate = profile.birthDate || profile.birth_date || 'No especificada';
    const isDonor = Boolean(profile.organDonor || profile.organ_donor);

    // Contacto principal
    const contact = (profile.emergency_contacts && profile.emergency_contacts[0]) || profile.primaryContact || {};
    const contactName = contact.name || profile.emergencyContact || 'Contacto de Emergencia';
    const contactPhone = contact.phone || profile.contactPhone || '';

    // Condiciones y Alergias
    const conditions = profile.critical_conditions || profile.conditions || profile.criticalConditions || [];
    const allergies = profile.allergies || [];

    // Medicamentos y Notas
    const medications = profile.medications || [];
    const notes = profile.medicalNotes || profile.medical_notes;

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 pb-12 antialiased">
            {/* Cabecera de Alerta */}
            <header className="bg-red-600 text-white py-3 px-4 text-center font-bold tracking-wider uppercase text-sm shadow-md sticky top-0 z-50 flex items-center justify-center gap-2">
                <span className="inline-block w-2.5 h-2.5 bg-white rounded-full animate-ping"></span>
                <span>⚠️ Ficha Médica de Emergencia ⚠️</span>
            </header>

            <main className="max-w-md mx-auto p-4 space-y-4">
                
                {/* Identificación Principal */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 flex items-center space-x-4">
                    <img 
                        src={photo} 
                        alt="Foto de perfil" 
                        className="w-20 h-20 rounded-full object-cover border-2 border-red-500 shadow-inner shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                        <h1 className="text-xl font-black text-gray-900 truncate">{name}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">Fecha de nacimiento: {birthDate}</p>
                        
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="inline-block bg-red-100 text-red-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-red-200">
                                Tipo de Sangre: {blood}
                            </span>
                            {isDonor && (
                                <span className="inline-block bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                                    🫀 Donante
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Botón de Llamada de Emergencia Directa (Prioridad Absoluta) */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Contacto de Emergencia</h2>
                    {contactPhone ? (
                        <a 
                            href={`tel:${contactPhone}`} 
                            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-base font-bold py-3.5 px-4 rounded-xl shadow-md flex items-center justify-center space-x-2 transition-transform transform active:scale-95 text-center"
                        >
                            <span>📞 Llamar a {contactName}</span>
                        </a>
                    ) : (
                        <p className="text-sm text-gray-400">Sin teléfono directo asignado</p>
                    )}
                </div>

                {/* Condiciones Críticas y Alergias (Alerta Visual) */}
                <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded-r-2xl shadow-sm space-y-1">
                    <h2 className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">Condiciones y Alergias Críticas</h2>
                    {allergies.length > 0 && (
                        <div className="text-red-950 font-semibold text-sm">
                            {allergies.map((a, i) => (
                                <div key={i} className="py-0.5">⛔ {a}</div>
                            ))}
                        </div>
                    )}
                    {Array.isArray(conditions) && conditions.length > 0 ? (
                        <div className="text-red-900 font-medium text-sm">
                            {conditions.map((c, i) => (
                                <div key={i} className="py-0.5">⚡ {c}</div>
                            ))}
                        </div>
                    ) : typeof conditions === 'string' && conditions.trim() ? (
                        <p className="text-red-900 font-medium text-sm">{conditions}</p>
                    ) : null}

                    {allergies.length === 0 && (!conditions || conditions.length === 0) && (
                        <p className="text-green-700 font-normal text-xs">Sin condiciones o alergias críticas registradas.</p>
                    )}
                </div>

                {/* Medicamentos Actuales */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Medicamentos Actuales</h2>
                    {Array.isArray(medications) && medications.length > 0 ? (
                        <ul className="text-gray-800 text-sm space-y-1">
                            {medications.map((m, i) => (
                                <li key={i}>• {m}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-gray-700 text-sm">{typeof medications === 'string' && medications.trim() ? medications : "Ninguno registrado."}</p>
                    )}
                </div>

                {/* Notas Especiales para Rescatistas */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Notas Médicas / Observaciones</h2>
                    <p className="text-gray-700 text-sm whitespace-pre-line leading-relaxed">
                        {notes || "Sin instrucciones adicionales."}
                    </p>
                </div>

            </main>

            {/* Pie de página institucional */}
            <footer className="text-center text-xs text-gray-400 mt-8 space-y-1">
                <p>Sistema de Emergencia QR • Plataforma Segura</p>
                <p className="text-[10px] text-gray-400">Datos médicos de consulta inmediata para socorristas</p>
            </footer>
        </div>
    );
}
