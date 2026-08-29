/* ============================================
   FLUX — Página de envio de PIX (pix.html)
   Reutiliza o núcleo compartilhado (assets/api.js):
   sessão, autenticação, formatação e API.
   Fluxo: formulário → revisão (camada visual) →
   POST /api/pix/send → sucesso. O saldo continua
   vindo do GET /api/auth/me real.
   Contrato da API, validações e máscaras intactos.
   ============================================ */
(function(){
  'use strict';

  function renderAccount(data){
    var account = data && data.account;
    var block = document.getElementById('pixAccountSummary');
    if(account && block){
      setText('pixAgency', account.agency || '—');
      setText('pixNumber', account.number || '—');
      setText('pixBalance', formatBRL(account.balance));
      block.hidden = false;
    }
    renderUser(data);
  }

  /* nome real do usuário (data.user.fullName) para o chip do header */
  function renderUser(data){
    var name = data && data.user && data.user.fullName;
    if(!name) return;
    var chip = document.getElementById('pixUser');
    var nameEl = document.getElementById('pixUserName');
    var avatarEl = document.getElementById('pixUserAvatar');
    if(nameEl) nameEl.textContent = name;
    if(avatarEl && avatarEl.textContent === '?'){
      var initials = name.trim().split(/\s+/).map(function(p){ return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
      avatarEl.textContent = initials || '?';
    }
    if(chip) chip.hidden = false;
  }

  /* Acessibilidade dos erros de campo: aria-invalid + aria-describedby.
     Só marca estado — nenhuma validação é alterada. */
  function setFieldA11y(input, field, hasError){
    if(!input) return;
    if(hasError){
      var errEl = field ? field.querySelector('.field-error') : null;
      input.setAttribute('aria-invalid', 'true');
      if(errEl){
        if(!errEl.id) errEl.id = (input.id || 'campo') + '-erro';
        input.setAttribute('aria-describedby', errEl.id);
      }
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  /* ============================================
     PIX — formulário de envio com revisão
     ============================================ */
  function initPix(){
    var form = document.getElementById('pixForm');
    if(!form) return;

    var formState = document.getElementById('pixFormState');
    var reviewState = document.getElementById('pixReview');
    var doneState = document.getElementById('pixDone');
    var doneText = document.getElementById('pixDoneText');
    var accountInput = document.getElementById('pixAccount');
    var amountInput = document.getElementById('pixAmount');
    var descInput = document.getElementById('pixDescription');
    var accountField = document.getElementById('fieldPixAccount');
    var amountField = document.getElementById('fieldPixAmount');
    var confirmBtn = document.getElementById('pixConfirm');
    var backBtn = document.getElementById('pixBackToForm');
    var retryBtn = document.getElementById('pixRetry');
    var reviewError = document.getElementById('pixReviewError');

    var riskModal = document.getElementById('pixRiskModal');
    var riskCancelBtn = document.getElementById('pixRiskCancel');
    var riskConfirmBtn = document.getElementById('pixRiskConfirm');
    var riskBackBtn = document.getElementById('pixRiskBack');
    var riskLevelEl = document.getElementById('pixRiskLevel');
    var riskSignals = document.getElementById('pixRiskSignals');
    var riskConfirmHandler = null;
    var riskReturnFocus = null;

    var pending = null;

    var RISK_SIGNAL_LABEL = {
      NEW_DEVICE: 'Dispositivo diferente',
      NEW_RECIPIENT: 'Destinatário não utilizado',
      HIGH_VALUE: 'Valor elevado',
      UNUSUAL_HOUR: 'Horário incomum',
      DIFFERENT_NETWORK: 'Rede/IP diferente'
    };

    function newIdempotencyKey(){
      if(window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    function hideBanner(banner){
      if(banner) banner.classList.remove('show');
    }
    function showReviewError(msg){
      if(!reviewError) return;
      reviewError.classList.remove('show');
      var span = reviewError.querySelector('.pix-error-msg');
      if(span) span.textContent = msg;
      reviewError.classList.add('show');
    }
    function clearFieldState(){
      if(accountField){ accountField.classList.remove('has-error', 'is-valid'); setFieldA11y(accountInput, accountField, false); }
      if(amountField){ amountField.classList.remove('has-error', 'is-valid'); setFieldA11y(amountInput, amountField, false); }
    }
    function showState(state){
      var states = document.querySelectorAll('.pix-state');
      for(var i = 0; i < states.length; i++){
        states[i].classList.remove('show');
        states[i].hidden = true;
      }
      if(state){
        state.hidden = false;
        state.classList.add('show');
      }
    }

    if(accountInput){
      accountInput.addEventListener('input', function(){
        accountInput.value = accountInput.value.replace(/\D/g, '');
        if(accountField) accountField.classList.remove('has-error');
        setFieldA11y(accountInput, accountField, false);
      });
    }

    if(amountInput){
      amountInput.addEventListener('input', function(){
        maskAmount(amountInput);
        if(amountField) amountField.classList.remove('has-error');
        setFieldA11y(amountInput, amountField, false);
      });
    }

    function validate(){
      var valid = true;

      var account = accountInput ? accountInput.value.trim() : '';
      if(!/^\d{8}$/.test(account)){
        if(accountField){
          var errEl = accountField.querySelector('.field-error');
          if(errEl) errEl.textContent = 'O número da conta deve conter 8 dígitos.';
          accountField.classList.add('has-error');
        }
        setFieldA11y(accountInput, accountField, true);
        valid = false;
      }

      var amount = amountInput ? parseAmount(amountInput.value) : NaN;
      if(!(amount > 0)){
        if(amountField){
          var errEl = amountField.querySelector('.field-error');
          if(errEl) errEl.textContent = 'Digite um valor maior que zero.';
          amountField.classList.add('has-error');
        }
        setFieldA11y(amountInput, amountField, true);
        valid = false;
      } else if(amount > 100000){
        if(amountField){
          var errEl = amountField.querySelector('.field-error');
          if(errEl) errEl.textContent = 'Valor acima do limite permitido para um PIX.';
          amountField.classList.add('has-error');
        }
        setFieldA11y(amountInput, amountField, true);
        valid = false;
      }

      return valid;
    }

    function openReview(){
      if(!pending) return;
      setText('pixReviewAmount', formatBRL(pending.amount));
      setText('pixReviewAccount', pending.accountNumber);
      setText('pixReviewDescription', pending.description || '—');
      hideBanner(reviewError);
      showState(reviewState);
    }

    function resetConfirm(){
      if(confirmBtn){
        confirmBtn.classList.remove('is-loading');
        confirmBtn.textContent = 'Confirmar PIX';
      }
    }

    function closeRiskModal(){
      if(!riskModal || riskModal.hidden) return;
      riskModal.hidden = true;
      riskModal.setAttribute('aria-hidden','true');
      riskModal.classList.remove('is-critical');
      riskConfirmHandler = null;
      if(riskReturnFocus && riskReturnFocus.focus) riskReturnFocus.focus();
      riskReturnFocus = null;
    }

    function openRiskModal(opts){
      if(!riskModal) return;
      riskModal.hidden = false;
      riskModal.classList.toggle('is-critical', !!opts.critical);
      riskModal.setAttribute('aria-hidden','false');
      setText('pixRiskAmount', formatBRL(opts.amount));
      setText('pixRiskLevel', opts.critical ? 'Crítico' : (opts.level === 'HIGH' ? 'Alto' : 'Médio'));
      setText('pixRiskDesc', opts.desc);
      setText('pixRiskEyebrow', opts.critical ? 'Pagamento bloqueado' : 'Verificação de segurança');
      setText('pixRiskTitle', opts.critical ? 'Pagamento bloqueado' : 'Verificação de segurança');

      if(riskSignals){
        var list = riskSignals.querySelector('.pix-risk-signals-list');
        var sigs = (opts.signals || []).filter(function(s){ return RISK_SIGNAL_LABEL[s]; });
        if(list){
          list.innerHTML = sigs.map(function(s){
            return '<span class="pix-risk-signal">'+es(RISK_SIGNAL_LABEL[s])+'</span>';
          }).join('');
        }
        riskSignals.hidden = sigs.length === 0;
      }

      riskConfirmHandler = opts.onConfirm || null;
      riskReturnFocus = opts.returnFocus || null;

      if(opts.critical){
        riskConfirmBtn.hidden = true;
        riskCancelBtn.hidden = true;
        riskBackBtn.hidden = false;
        riskBackBtn.focus();
      } else {
        riskConfirmBtn.hidden = false;
        riskCancelBtn.hidden = false;
        riskBackBtn.hidden = true;
        riskConfirmBtn.textContent = opts.confirmLabel || 'Continuar';
        riskConfirmBtn.focus();
      }
    }

    function sendPix(){
      if(!pending) return;
      if(confirmBtn && confirmBtn.classList.contains('is-loading')) return;
      hideBanner(reviewError);
      if(confirmBtn){
        confirmBtn.classList.add('is-loading');
        confirmBtn.textContent = 'Enviando...';
      }

      apiRequest('/pix/send', {
        method: 'POST',
        body: JSON.stringify(pending),
      })
        .then(function(res){
          if(res && res.status === 'CONFIRMATION_REQUIRED'){
            resetConfirm();
            var level = res.risk && res.risk.level;
            openRiskModal({
              level: level,
              amount: pending.amount,
              signals: res.risk && res.risk.signals,
              desc: level === 'HIGH'
                ? 'Este pagamento apresenta sinais de risco.'
                : 'Este pagamento apresenta características incomuns.',
              confirmLabel: level === 'HIGH' ? 'Confirmar pagamento' : 'Continuar',
              returnFocus: confirmBtn,
              onConfirm: function(){
                pending.riskConfirmation = res.confirmationToken;
                closeRiskModal();
                sendPix();
              }
            });
            return;
          }
          resetConfirm();
          var msg = res && res.message ? res.message : 'PIX enviado com sucesso.';
          var to = res && res.to;
          if(doneText) doneText.textContent = msg;
          setText('pixDoneAmount', formatBRL(pending.amount));
          setText('pixDoneName', to && to.name ? to.name : '—');
          setText('pixDoneAccount', to && to.number ? to.number : pending.accountNumber);
          showState(doneState);
          loadProfile()
            .then(function(data){
              if(data && data.account){
                renderAccount(data);
                setText('pixDoneBalance', formatBRL(data.account.balance));
              }
            })
            .catch(function(){});
        })
        .catch(function(err){
          resetConfirm();
          if(err && err.status === 403){
            openRiskModal({
              critical: true,
              amount: pending.amount,
              signals: [],
              desc: 'Por segurança, este Pix foi interrompido.',
              returnFocus: confirmBtn,
              onConfirm: null
            });
            return;
          }
          showReviewError(err && err.message
            ? err.message
            : 'Não foi possível enviar o PIX. Tente novamente.');
        });
    }

    form.addEventListener('submit', function(e){
      e.preventDefault();
      clearFieldState();

      if(!validate()) return;

      var account = accountInput.value.trim();
      var amount = parseAmount(amountInput.value);
      var payload = { accountNumber: account, amount: amount, idempotencyKey: newIdempotencyKey() };
      if(descInput && descInput.value.trim()){
        payload.description = descInput.value.trim();
      }
      pending = payload;
      openReview();
    });

    if(confirmBtn){
      confirmBtn.addEventListener('click', sendPix);
    }
    if(backBtn){
      backBtn.addEventListener('click', function(){
        hideBanner(reviewError);
        showState(formState);
      });
    }
    if(retryBtn){
      retryBtn.addEventListener('click', sendPix);
    }

    if(riskConfirmBtn){
      riskConfirmBtn.addEventListener('click', function(){
        if(riskConfirmHandler) riskConfirmHandler();
      });
    }
    if(riskCancelBtn){
      riskCancelBtn.addEventListener('click', closeRiskModal);
    }
    if(riskBackBtn){
      riskBackBtn.addEventListener('click', closeRiskModal);
    }
    if(riskModal){
      riskModal.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){ e.preventDefault(); closeRiskModal(); return; }
        if(e.key !== 'Tab') return;
        var els = riskModal.querySelectorAll('button:not([hidden]):not([disabled])');
        if(els.length === 0) return;
        var first = els[0], last = els[els.length - 1];
        var active = document.activeElement;
        if(e.shiftKey){ if(active === first){ e.preventDefault(); last.focus(); } }
        else if(active === last){ e.preventDefault(); first.focus(); }
      });
      var backdrop = riskModal.querySelector('[data-pixrisk-close]');
      if(backdrop){
        backdrop.addEventListener('click', closeRiskModal);
      }
    }
  }

  /* ============================================
     Boot
     ============================================ */
  document.addEventListener('DOMContentLoaded', function(){
    var logoutLink = document.getElementById('logoutLink');
    if(logoutLink){
      logoutLink.addEventListener('click', clearSession);
    }

    var token = getToken();
    if(!token){
      goLogin();
      return;
    }

    initPix();

    loadProfile()
      .then(function(data){
        if(data) renderAccount(data);
        setText('pixStatus', '');
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('pixStatus', err && err.message ? err.message : 'Não foi possível carregar seus dados.');
        var status = document.getElementById('pixStatus');
        if(status) status.classList.add('is-err');
      });
  });
})();
