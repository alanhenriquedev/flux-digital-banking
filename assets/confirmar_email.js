/* ============================================
   FLUX — Confirmação de troca de e-mail
   Página pública: confirmar_email.html
   Consome POST /api/auth/email/change/confirm
   (não exige login; o token é o credential).
   ============================================ */
(function(){
  'use strict';

  var API_URL = window.FLUX_API_URL || 'http://localhost:3333/api';

  function $(id){ return document.getElementById(id); }

  function apiFetch(path, options){
    return fetch(API_URL + path, options).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        if(!res.ok){
          var message = 'Não foi possível completar a solicitação. Tente novamente.';
          if(body && typeof body.message === 'string') message = body.message;
          else if(body && Array.isArray(body.message) && body.message.length > 0) message = body.message[0];
          var err = new Error(message);
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function handleConfirmEmailChange(token){
    return apiFetch('/auth/email/change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    });
  }

  function friendlyError(err){
    if(!err) return 'Ocorreu um erro inesperado. Tente novamente.';
    if(err.message === 'Failed to fetch'){
      return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    }
    return err.message || 'Ocorreu um erro inesperado. Tente novamente.';
  }

  function initConfirmEmailPage(){
    var page = $('confirmEmailPage');
    if(!page) return;

    var states = {
      loading: $('ceLoading'),
      ok: $('ceOk'),
      error: $('ceError'),
    };
    var errorText = $('ceErrorText');

    function showState(name, focusTarget){
      Object.keys(states).forEach(function(key){
        if(states[key]) states[key].classList.toggle('show', key === name);
      });
      if(focusTarget && states[focusTarget]) states[focusTarget].focus({ preventScroll: false });
    }

    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');

    if(!token || token.trim() === ''){
      if(errorText){
        errorText.textContent = 'Este link está incompleto: falta o código de confirmação. Abra o link mais recente que enviamos para o seu novo e-mail — ou solicite uma nova troca nas configurações da conta.';
      }
      showState('error', 'error');
      return;
    }

    showState('loading');

    handleConfirmEmailChange(token.trim())
      .then(function(){
        showState('ok', 'ok');
      })
      .catch(function(err){
        if(errorText) errorText.textContent = friendlyError(err);
        showState('error', 'error');
      });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initConfirmEmailPage);
  } else {
    initConfirmEmailPage();
  }
})();
