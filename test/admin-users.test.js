const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-users-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json() };
}

async function login(email) {
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'secure-test-password' },
  });
  assert.equal(response.status, 200);
  return body.token;
}

test('only admins can administer accounts, and account actions immediately affect sessions and profiles', async () => {
  const adminPage = await fetch(`${baseUrl}/admin.html`);
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /Fichas médicas y códigos QR/);
  const adminStyle = await fetch(`${baseUrl}/css/admin.css`);
  assert.equal(adminStyle.status, 200);
  const adminScript = await fetch(`${baseUrl}/js/admin.js`);
  assert.equal(adminScript.status, 200);
  const acceptPage = await fetch(`${baseUrl}/accept-invitation.html`);
  assert.equal(acceptPage.status, 200);
  assert.match(await acceptPage.text(), /mínimo 12 caracteres/);

  const docsResponse = await fetch(`${baseUrl}/api-docs.json`);
  const docs = await docsResponse.json();
  for (const path of [
    '/api/auth/admin/users',
    '/api/auth/admin/users/{id}/status',
    '/api/auth/admin/users/{id}/role',
    '/api/auth/admin/users/{id}',
    '/api/auth/admin/invitations',
    '/api/auth/admin/invitations/{id}/revoke',
    '/api/auth/invitation/{token}',
    '/api/auth/invitation/accept',
    '/api/admin/profiles',
    '/api/admin/profiles/{id}',
    '/api/admin/profiles/{id}/qr',
  ]) {
    assert.ok(docs.paths[path]);
  }

  const suffix = randomUUID();
  const adminEmail = `admin-${suffix}@example.com`;
  const memberEmail = `member-${suffix}@example.com`;
  const admin = await createLocalUserForTests({
    email: adminEmail,
    password: 'secure-test-password',
    fullName: 'Platform Admin',
    role: 'admin',
  });
  const adminToken = await login(adminEmail);

  const publicRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: { email: memberEmail, password: 'secure-test-password', fullName: 'Platform Member' },
  });
  assert.equal(publicRegistration.response.status, 403);
  assert.equal(publicRegistration.body.code, 'INVITATION_REQUIRED');
  const unauthenticated = await request('/api/auth/admin/users');
  assert.equal(unauthenticated.response.status, 401);

  const invitationForbidden = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: memberEmail, fullName: 'Platform Member' },
  });
  assert.equal(invitationForbidden.response.status, 401);

  const createdInvitation = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: memberEmail, fullName: 'Platform Member' },
    token: adminToken,
  });
  assert.equal(createdInvitation.response.status, 201);
  assert.match(createdInvitation.body.invitationUrl, /accept-invitation\.html\?token=/);
  const invitationToken = new URL(createdInvitation.body.invitationUrl).searchParams.get('token');
  assert.match(invitationToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Object.hasOwn(createdInvitation.body.invitation, 'token_hash'), false);

  const invitationDetails = await request(`/api/auth/invitation/${invitationToken}`);
  assert.equal(invitationDetails.response.status, 200);
  assert.equal(invitationDetails.body.email, memberEmail);
  const memberAccept = await request('/api/auth/invitation/accept', {
    method: 'POST',
    body: { token: invitationToken, password: 'secure-test-password' },
  });
  assert.equal(memberAccept.response.status, 201);
  const member = memberAccept.body.user;
  const memberToken = await login(memberEmail);
  const memberInviteForbidden = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: `forbidden-${suffix}@example.com`, fullName: 'Forbidden Invite' },
    token: memberToken,
  });
  assert.equal(memberInviteForbidden.response.status, 403);

  const listedInvitations = await request('/api/auth/admin/invitations', { token: adminToken });
  assert.equal(listedInvitations.response.status, 200);
  assert.ok(listedInvitations.body.some(invitation =>
    invitation.id === createdInvitation.body.invitation.id && invitation.status === 'accepted'));
  assert.ok(listedInvitations.body.every(invitation => !Object.hasOwn(invitation, 'token_hash')));

  const reuseInvitation = await request('/api/auth/invitation/accept', {
    method: 'POST',
    body: { token: invitationToken, password: 'another-secure-password' },
  });
  assert.equal(reuseInvitation.response.status, 410);

  const revocableInvitation = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: `revoked-${suffix}@example.com`, fullName: 'Revoked User' },
    token: adminToken,
  });
  assert.equal(revocableInvitation.response.status, 201);
  const revokedToken = new URL(revocableInvitation.body.invitationUrl).searchParams.get('token');
  const revoked = await request(`/api/auth/admin/invitations/${revocableInvitation.body.invitation.id}/revoke`, {
    method: 'POST',
    token: adminToken,
  });
  assert.equal(revoked.response.status, 200);
  const revokedCheck = await request(`/api/auth/invitation/${revokedToken}`);
  assert.equal(revokedCheck.response.status, 410);

  const originalInvitation = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: `renew-${suffix}@example.com`, fullName: 'Renewed User' },
    token: adminToken,
  });
  const originalToken = new URL(originalInvitation.body.invitationUrl).searchParams.get('token');
  const renewedInvitation = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: `renew-${suffix}@example.com`, fullName: 'Renewed User' },
    token: adminToken,
  });
  const renewedToken = new URL(renewedInvitation.body.invitationUrl).searchParams.get('token');
  assert.notEqual(renewedToken, originalToken);
  assert.equal((await request(`/api/auth/invitation/${originalToken}`)).response.status, 410);
  assert.equal((await request(`/api/auth/invitation/${renewedToken}`)).response.status, 200);

  const forbidden = await request('/api/auth/admin/users', { token: memberToken });
  assert.equal(forbidden.response.status, 403);

  const listed = await request('/api/auth/admin/users', { token: adminToken });
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.some(user => user.id === member.id));
  assert.ok(listed.body.every(user => !Object.hasOwn(user, 'password_hash')));

  const selfRole = await request(`/api/auth/admin/users/${admin.id}/role`, {
    method: 'PATCH',
    body: { role: 'user' },
    token: adminToken,
  });
  assert.equal(selfRole.response.status, 400);

  const createProfile = await request('/api/profiles', {
    method: 'POST',
    body: {
      fullName: 'Member Emergency Profile',
      bloodType: 'O+',
      primaryContact: { name: 'Primary Contact', phone: '+56912345678' },
      secondaryContact: { name: 'Secondary Contact', phone: '+56987654321' },
      allergies: ['Pollen'],
    },
    token: memberToken,
  });
  assert.equal(createProfile.response.status, 201);
  assert.equal(Object.hasOwn(createProfile.body, 'qrDataUrl'), false);
  assert.equal(Object.hasOwn(createProfile.body, 'qr_code'), false);

  const emergencyPage = await fetch(`${baseUrl}/emergency.html`);
  assert.equal(emergencyPage.status, 200);
  const emergencyHtml = await emergencyPage.text();
  assert.match(emergencyHtml, /locationContactActions/);
  assert.match(emergencyHtml, /Abrir WhatsApp para/);
  assert.match(emergencyHtml, /target = '_blank'/);
  const emergencyProfile = await request(`/api/v1/emergency/${createProfile.body.public_token}`);
  assert.equal(emergencyProfile.response.status, 200);
  assert.equal(emergencyProfile.body.emergency_contacts.length, 2);

  const secondProfile = await request('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Second Member Profile', bloodType: 'A+' },
    token: memberToken,
  });
  assert.equal(secondProfile.response.status, 201);

  const memberProfiles = await request('/api/profiles', { token: memberToken });
  assert.equal(memberProfiles.response.status, 200);
  assert.equal(memberProfiles.body.length, 2);
  assert.ok(memberProfiles.body.every(profile => profile.id === createProfile.body.id || profile.id === secondProfile.body.id));

  const memberCannotListAllMedicalProfiles = await request('/api/admin/profiles', { token: memberToken });
  assert.equal(memberCannotListAllMedicalProfiles.response.status, 403);
  const listedMedicalProfiles = await request('/api/admin/profiles', { token: adminToken });
  assert.equal(listedMedicalProfiles.response.status, 200);
  assert.ok(listedMedicalProfiles.body.some(profile => profile.id === createProfile.body.id));
  assert.ok(listedMedicalProfiles.body.some(profile => profile.id === secondProfile.body.id));
  assert.ok(listedMedicalProfiles.body.some(profile =>
    profile.id === createProfile.body.id && profile.ownerUserId === member.id));
  assert.ok(listedMedicalProfiles.body.every(profile => !Object.hasOwn(profile, 'allergies')));
  const adminProfile = await request(`/api/admin/profiles/${createProfile.body.id}`, { token: adminToken });
  assert.equal(adminProfile.response.status, 200);
  assert.deepEqual(adminProfile.body.allergies, ['Pollen']);
  const memberCannotViewMedicalProfile = await request(`/api/admin/profiles/${createProfile.body.id}`, { token: memberToken });
  assert.equal(memberCannotViewMedicalProfile.response.status, 403);

  const adminQr = await request(`/api/admin/profiles/${createProfile.body.id}/qr`, { token: adminToken });
  assert.equal(adminQr.response.status, 200);
  assert.match(adminQr.body.targetUrl, /emergency\.html\?token=/);
  assert.match(adminQr.body.qrDataUrl, /^data:image\/png;base64,/);
  const memberCannotGenerateOwnQr = await request(`/api/profiles/${createProfile.body.id}/qr`, { token: memberToken });
  assert.equal(memberCannotGenerateOwnQr.response.status, 403);
  const memberCannotGenerateAdminQr = await request(`/api/admin/profiles/${createProfile.body.id}/qr`, { token: memberToken });
  assert.equal(memberCannotGenerateAdminQr.response.status, 403);
  const downloadableQr = await fetch(`${baseUrl}/api/admin/profiles/${createProfile.body.id}/qr?format=png`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(downloadableQr.status, 200);
  assert.match(downloadableQr.headers.get('content-type'), /image\/png/);
  assert.ok((await downloadableQr.arrayBuffer()).byteLength > 100);

  const suspended = await request(`/api/auth/admin/users/${member.id}/status`, {
    method: 'PATCH',
    body: { isActive: false },
    token: adminToken,
  });
  assert.equal(suspended.response.status, 200);
  assert.equal(suspended.body.isActive, false);

  const suspendedSession = await request('/api/profiles', { token: memberToken });
  assert.equal(suspendedSession.response.status, 401);
  const suspendedLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'secure-test-password' },
  });
  assert.equal(suspendedLogin.response.status, 403);

  const reactivated = await request(`/api/auth/admin/users/${member.id}/status`, {
    method: 'PATCH',
    body: { isActive: true },
    token: adminToken,
  });
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.body.isActive, true);

  const promoted = await request(`/api/auth/admin/users/${member.id}/role`, {
    method: 'PATCH',
    body: { role: 'admin' },
    token: adminToken,
  });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.role, 'admin');
  const promotedAccess = await request('/api/auth/admin/users', { token: memberToken });
  assert.equal(promotedAccess.response.status, 200);

  const deleted = await request(`/api/auth/admin/users/${member.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(deleted.response.status, 200);
  assert.match(deleted.body.message, /perfiles asociados eliminados/);

  const deletedAccountCannotLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'secure-test-password' },
  });
  assert.equal(deletedAccountCannotLogin.response.status, 401);
  const deletedProfileCannotBeFetched = await request(`/api/v1/emergency/${createProfile.body.public_token}`);
  assert.equal(deletedProfileCannotBeFetched.response.status, 404);

  const selfDelete = await request(`/api/auth/admin/users/${admin.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(selfDelete.response.status, 400);
});
