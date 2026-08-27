/* ============================================
   FLUX — Núcleo compartilhado (API + sessão + formatação)
   Usado por dashboard.js e pix.js.
   Carregar SEMPRE antes dos scripts de página
   (depois de config.js).
   ============================================ */
var API_URL = (window.FLUX_API_URL || 'http://localhost:3333/api');
var TOKEN_KEY = 'flux_access_token';
var USER_KEY = 'flux_user';

function getToken(){
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

function clearSession(){
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function goLogin(){
  window.location.href = 'login.html';
}

function formatBRL(value){
  var n = Number(value);
  if(isNaN(n)) return 'R$ 0,00';
  return 'R$ ' + n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function setText(id, text){
  var el = document.getElementById(id);
  if(el) el.textContent = text;
}

function extractApiMessage(body, status){
  if(body && typeof body.message === 'string') return body.message;
  if(body && Array.isArray(body.message) && body.message.length > 0) return body.message[0];
  if(status === 401) return 'Sessão expirada. Faça login novamente.';
  return 'Não foi possível completar a solicitação. Tente novamente.';
}

function apiRequest(path, options){
  options = options || {};
  var headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + getToken();
  if(options.body) headers['Content-Type'] = 'application/json';

  return fetch(API_URL + path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body || null,
  })
    .then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        if(res.status === 401){
          clearSession();
          goLogin();
          var err = new Error('Sessão expirada.');
          err.status = 401;
          throw err;
        }
        if(!res.ok){
          var msg = extractApiMessage(body, res.status);
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
}

function loadProfile(){
  return apiRequest('/auth/me');
}

/* --- Notificações (usado por notifications.js e futuras páginas) --- */
function loadUnreadCount(){
  return apiRequest('/notifications/unread-count');
}

function listNotifications(page, limit){
  page = page || 1;
  limit = limit || 10;
  return apiRequest('/notifications?page=' + page + '&limit=' + limit);
}

function markNotificationRead(id){
  return apiRequest('/notifications/' + encodeURIComponent(id) + '/read', {
    method: 'POST',
  });
}

function markAllNotificationsRead(){
  return apiRequest('/notifications/read-all', {
    method: 'POST',
  });
}

/* --- Segurança da conta (dashboard.js) --- */
function loadSecurityOverview(){
  return apiRequest('/auth/security/overview');
}

function listSecurityLogins(page, limit){
  page = page || 1;
  limit = limit || 10;
  return apiRequest('/auth/security/logins?page=' + page + '&limit=' + limit);
}

function listSessions(){
  return apiRequest('/auth/security/sessions');
}

function revokeSession(id){
  return apiRequest('/auth/security/sessions/' + encodeURIComponent(id), {
    method: 'DELETE',
  });
}

function revokeOtherSessions(){
  return apiRequest('/auth/security/sessions/revoke-others', {
    method: 'POST',
  });
}

/* --- Alteração de senha (configuracoes.js) --- */
function changePassword(data){
  return apiRequest('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      confirmNewPassword: data.confirmNewPassword,
    }),
  });
}

/* --- Alteração de e-mail (configuracoes.js) --- */
function requestEmailChange(data){
  return apiRequest('/auth/email/change', {
    method: 'POST',
    body: JSON.stringify({
      newEmail: data.newEmail,
      currentPassword: data.currentPassword,
    }),
  });
}

function formatCents(whole){
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function maskAmount(input){
  var digits = input.value.replace(/\D/g, '');
  if(digits.length === 0){
    input.value = '';
    return;
  }
  if(digits.length < 2) digits = '0' + digits;
  var cents = digits.slice(-2);
  var whole = digits.slice(0, -2) || '0';
  whole = whole.replace(/^0+(?=\d)/, '');
  if(whole === '') whole = '0';
  input.value = formatCents(whole) + ',' + cents;
}

function parseAmount(value){
  var v = String(value == null ? '' : value).trim();
  if(!v) return NaN;
  var hasComma = v.indexOf(',') !== -1;
  var dotCount = (v.match(/\./g) || []).length;
  if(hasComma){
    v = v.replace(/\./g, '').replace(',', '.');
  } else if(dotCount > 1){
    v = v.replace(/\./g, '');
  }
  var n = Number(v);
  return isNaN(n) ? NaN : n;
}

function formatDateTime(iso){
  var d = iso ? new Date(iso) : null;
  if(!d || isNaN(d.getTime())) return '';
  function p(n){ return (n < 10 ? '0' : '') + n; }
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
    ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function es(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
