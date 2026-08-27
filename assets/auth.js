/* ============================================
   FLUX — Auth logic (login / cadastro)
   Conecta os formulários à API do backend:
   POST /api/auth/register e POST /api/auth/login.
   ============================================ */

// ---------- helpers ----------
function $(id){ return document.getElementById(id); }

/* Conecta o input ao elemento de erro (aria-describedby) e marca/limpa
   aria-invalid. Não faz nada além de acessibilidade — validação intacta. */
function bindErrorA11y(input, field, hasError){
  if(!input) return;
  if(hasError){
    input.setAttribute('aria-invalid', 'true');
    const err = field && field.querySelector('.field-error');
    if(err){
      if(!err.id) err.id = (input.id || 'campo') + '-erro';
      input.setAttribute('aria-describedby', err.id);
    }
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function setFieldError(field, input, message){
  field.classList.add('has-error');
  field.classList.remove('is-valid');
  const err = field.querySelector('.field-error');
  if(err) err.textContent = message;
  bindErrorA11y(input, field, true);
}
function clearFieldError(field){
  field.classList.remove('has-error');
  bindErrorA11y(field.querySelector('input, textarea, select'), field, false);
}
function setFieldValid(field){
  field.classList.remove('has-error');
  field.classList.add('is-valid');
  bindErrorA11y(field.querySelector('input, textarea, select'), field, false);
}

function togglePassword(btnId, inputId){
  const btn = $(btnId);
  const input = $(inputId);
  if(!btn || !input) return;
  btn.addEventListener('click', ()=>{
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.classList.toggle('showing', !showing);
    btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  });
}

// ---------- CPF mask ----------
function maskCPF(value){
  let v = value.replace(/\D/g,'').slice(0,11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return v;
}
function isValidCpf(value){
  const digits = value.replace(/\D/g,'');
  if(digits.length !== 11) return false;
  if(/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  for(let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if(check === 10) check = 0;
  if(check !== Number(digits[9])) return false;

  sum = 0;
  for(let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  check = (sum * 10) % 11;
  if(check === 10) check = 0;
  return check === Number(digits[10]);
}

// ---------- email / password validators ----------
function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function passwordStrength(value){
  if(value.length === 0) return { score: 0, label: '' };
  let score = 0;
  if(value.length >= 8) score++;
  if(/[A-Za-z]/.test(value) && /\d/.test(value)) score++;
  if(value.length >= 12 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value)) score++;
  if(score <= 1) return { score: 1, label: 'Fraca' };
  if(score === 2) return { score: 2, label: 'Média' };
  return { score: 3, label: 'Forte' };
}
function meetsPasswordRules(value){
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

// ============================================
// API / integração com o backend
// ============================================
const API_URL = (window.FLUX_API_URL || 'http://localhost:3333/api');
const TOKEN_KEY = 'flux_access_token';
const USER_KEY = 'flux_user';

async function apiFetch(path, options){
  const res = await fetch(API_URL + path, options);
  let body = null;
  try { body = await res.json(); } catch(e){ /* corpo vazio */ }
  if(!res.ok){
    const err = new Error(extractApiError(body, res.status));
    err.status = res.status;
    err.code = body && typeof body.code === 'string' ? body.code : undefined;
    throw err;
  }
  return body;
}

function extractApiError(body, status){
  if(body && typeof body.message === 'string') return body.message;
  if(body && Array.isArray(body.message) && body.message.length > 0) return body.message[0];
  if(status === 401) return 'E-mail ou senha incorretos.';
  return 'Não foi possível completar a solicitação. Tente novamente.';
}

function storeSession(result, persistent){
  const storage = persistent ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, result.accessToken);
  if(result.user) storage.setItem(USER_KEY, JSON.stringify(result.user));
}

// ============================================
// CADASTRO
// ============================================
function initCadastroForm(){
  const form = $('registerForm');
  if(!form) return;

  const fullNameField = $('field-fullName');
  const emailField = $('field-email');
  const cpfField = $('field-cpf');
  const passwordField = $('field-password');
  const confirmField = $('field-confirmPassword');
  const termsField = $('field-acceptTerms');

  const fullNameInput = $('fullName');
  const emailInput = $('email');
  const cpfInput = $('cpf');
  const passwordInput = $('password');
  const confirmInput = $('confirmPassword');
  const termsInput = $('acceptTerms');

  const strengthWrap = $('strengthBlock');
  const strengthLabel = $('strengthLabel');

  togglePassword('togglePassword', 'password');
  togglePassword('toggleConfirmPassword', 'confirmPassword');

  cpfInput.addEventListener('input', ()=>{
    cpfInput.value = maskCPF(cpfInput.value);
  });

  passwordInput.addEventListener('input', ()=>{
    const val = passwordInput.value;
    const { score, label } = passwordStrength(val);
    strengthWrap.className = 'strength-block' + (score === 1 ? ' strength-weak' : score === 2 ? ' strength-medium' : score === 3 ? ' strength-strong' : '');
    strengthLabel.textContent = val ? label : '';
  });

  const errorBanner = $('authError');

  function validate(){
    let valid = true;

    if(fullNameInput.value.trim().length < 3){
      setFieldError(fullNameField, fullNameInput, 'Digite seu nome completo (mínimo 3 caracteres).');
      valid = false;
    } else { setFieldValid(fullNameField); }

    if(!isValidEmail(emailInput.value.trim())){
      setFieldError(emailField, emailInput, 'Digite um e-mail válido.');
      valid = false;
    } else { setFieldValid(emailField); }

    if(!isValidCpf(cpfInput.value)){
      setFieldError(cpfField, cpfInput, 'Digite um CPF válido.');
      valid = false;
    } else { setFieldValid(cpfField); }

    if(!meetsPasswordRules(passwordInput.value)){
      setFieldError(passwordField, passwordInput, 'Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.');
      valid = false;
    } else { setFieldValid(passwordField); }

    if(confirmInput.value !== passwordInput.value || confirmInput.value === ''){
      setFieldError(confirmField, confirmInput, 'As senhas não coincidem.');
      valid = false;
    } else { setFieldValid(confirmField); }

    if(!termsInput.checked){
      setFieldError(termsField, termsInput, 'Você precisa aceitar os termos para continuar.');
      valid = false;
    } else { clearFieldError(termsField); }

    return valid;
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    errorBanner.classList.remove('show');

    if(!validate()){
      const first = [fullNameField, emailField, cpfField, passwordField, confirmField, termsField]
        .find((f)=>f && f.classList.contains('has-error'));
      const target = first && first.querySelector('input, textarea, select');
      if(target) target.focus();
      return;
    }

    const data = {
      fullName: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      cpf: cpfInput.value,
      password: passwordInput.value,
      confirmPassword: confirmInput.value,
      acceptTerms: termsInput.checked,
    };

    const submitBtn = $('registerSubmit');
    if(submitBtn.classList.contains('is-loading')) return;
    submitBtn.classList.add('is-loading');
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.textContent = 'Criando conta...';

    handleRegister(data)
      .then(()=>{
        window.location.href = 'login.html?registered=1';
      })
      .catch((err)=>{
        submitBtn.classList.remove('is-loading');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = 'Criar conta';
        errorBanner.querySelector('span').textContent = err && err.message ? err.message : 'Não foi possível criar sua conta. Tente novamente.';
        errorBanner.classList.add('show');
      });
  });
}

function handleRegister(data){
  // confirmPassword é validada apenas no frontend — não faz parte do RegisterDto.
  const { confirmPassword, ...payload } = data;
  return apiFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ============================================
// LOGIN
// ============================================
function initLoginForm(){
  const form = $('loginForm');
  if(!form) return;

  const emailField = $('field-loginEmail');
  const passwordField = $('field-loginPassword');
  const emailInput = $('email');
  const passwordInput = $('password');
  const errorBanner = $('authError');

  const successBanner = $('authSuccess');
  if(successBanner && new URLSearchParams(window.location.search).has('registered')){
    successBanner.classList.add('show');
  }

  const changedBanner = $('changedNotice');
  if(changedBanner && new URLSearchParams(window.location.search).get('changed') === '1'){
    changedBanner.classList.add('show');
  }

  togglePassword('toggleLoginPassword', 'password');

  function validate(){
    let valid = true;

    if(!isValidEmail(emailInput.value.trim())){
      setFieldError(emailField, emailInput, 'Digite um e-mail válido.');
      valid = false;
    } else { setFieldValid(emailField); }

    if(passwordInput.value.length === 0){
      setFieldError(passwordField, passwordInput, 'Digite sua senha.');
      valid = false;
    } else { setFieldValid(passwordField); }

    return valid;
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    errorBanner.classList.remove('show');
    if(successBanner) successBanner.classList.remove('show');
    if(changedBanner) changedBanner.classList.remove('show');

    if(!validate()){
      const first = [emailField, passwordField].find((f)=>f && f.classList.contains('has-error'));
      const target = first && first.querySelector('input, textarea, select');
      if(target) target.focus();
      return;
    }

    const data = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    };

    const submitBtn = $('loginSubmit');
    if(submitBtn.classList.contains('is-loading')) return;
    submitBtn.classList.add('is-loading');
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.textContent = 'Entrando...';

    handleLogin(data)
      .then((result)=>{
        const remember = $('rememberMe') && $('rememberMe').checked;
        storeSession(result, remember);
        window.location.href = 'dashboard_1.html';
      })
      .catch((err)=>{
        submitBtn.classList.remove('is-loading');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = 'Entrar';

        const emailNotice = $('emailNotice');

        if(err.status === 403 && err.code === 'EMAIL_NOT_VERIFIED'){
          errorBanner.classList.remove('show');
          if(emailNotice) emailNotice.classList.add('show');
          else {
            errorBanner.querySelector('span').textContent = err.message || 'Confirme seu e-mail para continuar.';
            errorBanner.classList.add('show');
          }
          return;
        }

        if(emailNotice) emailNotice.classList.remove('show');
        errorBanner.querySelector('span').textContent = err && err.message ? err.message : 'E-mail ou senha incorretos.';
        errorBanner.classList.add('show');
      });
  });
}

// ============================================
// DEVICE ID (agrupamento de sessões)
// UUID aleatório persistente em localStorage.
// É apenas identificador de agrupamento:
// NÃO é fator de autenticação, NÃO substitui
// o JWT e NÃO concede acesso. O servidor guarda
// somente o HMAC-SHA256, nunca este valor.
// ============================================
const DEVICE_ID_KEY = 'flux_device_id';

function fallbackUuid(){
  // RFC 4122 v4 quando crypto.randomUUID não está disponível
  if(window.crypto && crypto.getRandomValues){
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b)=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c)=>{
    const r = Math.random()*16|0;
    const v = c === 'x' ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}

function getFluxDeviceId(){
  try{
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if(!id){
      id = (window.crypto && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : fallbackUuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }catch(err){
    return ''; // storage indisponível: login segue normal, sem agrupamento
  }
}

function handleLogin(data){
  const payload = { ...data };
  const deviceId = getFluxDeviceId();
  if(deviceId) payload.deviceId = deviceId;
  return apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ============================================
// REENVIO DE CONFIRMAÇÃO
// ============================================
function handleResendVerification(email, password){
  return apiFetch('/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

function initResendVerification(){
  const notice = $('emailNotice');
  const btn = $('resendBtn');
  const feedback = $('resendFeedback');
  if(!notice || !btn || !feedback) return;

  const emailInput = $('email');
  const passwordInput = $('password');

  btn.addEventListener('click', async ()=>{
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    feedback.classList.remove('ok', 'err');

    if(!isValidEmail(email) || password.length === 0){
      feedback.textContent = 'Preencha seu e-mail e senha para reenviar.';
      feedback.classList.add('err');
      return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    feedback.textContent = 'Enviando...';

    try{
      await handleResendVerification(email, password);
      feedback.textContent = 'E-mail de confirmação enviado!';
      feedback.classList.add('ok');
    }catch(err){
      feedback.textContent = err && err.message ? err.message : 'Não foi possível enviar o e-mail. Tente novamente.';
      feedback.classList.add('err');
    }finally{
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  });
}

// ============================================
// PÁGINA DE CONFIRMAÇÃO (verificar_email.html)
// ============================================
function handleVerifyEmail(token){
  return apiFetch('/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

function initVerifyEmailPage(){
  const page = $('verifyPage');
  if(!page) return;

  const states = {
    loading: $('verifyLoading'),
    ok: $('verifyOk'),
    error: $('verifyError'),
  };
  const errorText = $('verifyErrorText');

  function showState(name){
    Object.keys(states).forEach((key)=>{
      if(states[key]) states[key].classList.toggle('show', key === name);
    });
  }

  const token = new URLSearchParams(window.location.search).get('token');

  if(!token){
    if(errorText) errorText.textContent = 'O link de confirmação está ausente. Solicite um novo e-mail pela página de login.';
    showState('error');
    return;
  }

  showState('loading');

  handleVerifyEmail(token)
    .then(()=> showState('ok'))
    .catch((err)=>{
      if(errorText) errorText.textContent = err && err.message
        ? err.message
        : 'Não foi possível confirmar seu e-mail. Tente novamente.';
      showState('error');
    });
}

// ============================================
// ESQUECI MINHA SENHA
// ============================================
function handleForgotPassword(email){
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

function initForgotPasswordPage(){
  const formState = $('forgotFormState');
  if(!formState) return;

  const form = $('forgotForm');
  const emailField = $('field-forgotEmail');
  const emailInput = $('email');
  const errorBanner = $('forgotError');
  const submitBtn = $('forgotSubmit');
  const sentState = $('forgotSent');

  function validate(){
    if(isValidEmail(emailInput.value.trim())){
      setFieldValid(emailField);
      return true;
    }
    setFieldError(emailField, emailInput, 'Digite um e-mail válido.');
    return false;
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    errorBanner.classList.remove('show');

    if(!validate()) return;

    if(submitBtn.classList.contains('is-loading')) return;
    submitBtn.classList.add('is-loading');
    submitBtn.textContent = 'Enviando...';

    handleForgotPassword(emailInput.value.trim())
      .then(()=>{
        formState.classList.remove('show');
        if(sentState) sentState.classList.add('show');
      })
      .catch((err)=>{
        submitBtn.classList.remove('is-loading');
        submitBtn.textContent = 'Enviar instruções';
        errorBanner.querySelector('span').textContent = err && err.message
          ? err.message
          : 'Não foi possível processar sua solicitação. Tente novamente.';
        errorBanner.classList.add('show');
      });
  });
}

// ============================================
// REDEFINIR SENHA
// ============================================
function handleResetPassword(token, password){
  return apiFetch('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

function initResetPasswordPage(){
  const form = $('resetForm');
  if(!form) return;

  const states = {
    form: $('resetFormState'),
    ok: $('resetOk'),
    error: $('resetErrorState'),
  };
  const errorText = $('resetErrorText');
  const formError = $('resetError');

  const newPasswordField = $('field-newPassword');
  const confirmField = $('field-confirmNewPassword');
  const newPasswordInput = $('newPassword');
  const confirmInput = $('confirmNewPassword');
  const submitBtn = $('resetSubmit');

  togglePassword('toggleNewPassword', 'newPassword');
  togglePassword('toggleConfirmNewPassword', 'confirmNewPassword');

  function showState(name){
    Object.keys(states).forEach((key)=>{
      if(states[key]) states[key].classList.toggle('show', key === name);
    });
  }

  const token = new URLSearchParams(window.location.search).get('token');

  if(!token){
    if(errorText) errorText.textContent = 'O link de redefinição está ausente ou incompleto. Solicite um novo link pela página de login.';
    showState('error');
    return;
  }

  function validate(){
    let valid = true;

    if(!meetsPasswordRules(newPasswordInput.value)){
      setFieldError(newPasswordField, newPasswordInput, 'Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.');
      valid = false;
    } else { setFieldValid(newPasswordField); }

    if(confirmInput.value !== newPasswordInput.value || confirmInput.value === ''){
      setFieldError(confirmField, confirmInput, 'As senhas não coincidem.');
      valid = false;
    } else { setFieldValid(confirmField); }

    return valid;
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    formError.classList.remove('show');

    if(!validate()) return;

    if(submitBtn.classList.contains('is-loading')) return;
    submitBtn.classList.add('is-loading');
    submitBtn.textContent = 'Redefinindo...';

    handleResetPassword(token, newPasswordInput.value)
      .then(()=> showState('ok'))
      .catch((err)=>{
        submitBtn.classList.remove('is-loading');
        submitBtn.textContent = 'Redefinir senha';
        const msg = err && err.message
          ? err.message
          : 'Não foi possível redefinir sua senha. Tente novamente.';

        if(err.status === 400){
          if(errorText) errorText.textContent = msg;
          showState('error');
        }else{
          formError.querySelector('span').textContent = msg;
          formError.classList.add('show');
        }
      });
  });
}

// ============================================
document.addEventListener('DOMContentLoaded', ()=>{
  initCadastroForm();
  initLoginForm();
  initResendVerification();
  initVerifyEmailPage();
  initForgotPasswordPage();
  initResetPasswordPage();
});