/* ============================================
   FLUX — Configurações da conta (configuracoes.html)
   Boot + Segurança da conta:
   - verifica token e redireciona para login;
   - carrega o perfil e preenche nome;
   - initSecurityPage(): overview, sessões ativas,
     histórico de acessos (paginado), revogar
     sessão/dispositivos e modal acessível.
   Lógica migrada de dashboard.js (initSecurity),
   reusando os helpers de assets/api.js.
   ============================================ */
(function(){
  'use strict';

  function renderProfile(data){
    if(!data || !data.user) return;
    var user = data.user;
    var name = user.fullName || '';
    var short = String(name).trim().split(/\s+/)[0] || '';

    var userEl = document.getElementById('cfgUser');
    if(userEl) userEl.hidden = false;
    setText('cfgUserName', name || '...');
    setText('cfgUserInitial', short ? short.charAt(0).toUpperCase() : '?');

    /* e-mail atual exibido no bloco "Alterar e-mail" */
    setText('cfgCurrentEmail', user.email || '—');
  }

  /* ============================================
     Segurança da conta
     - Overview  /auth/security/overview
     - Sessões  /auth/security/sessions
     - Histórico /auth/security/logins (paginado)
     - Encerrar uma sessão / encerrar as demais
     Reusa o padrão de estados loading/empty/error
     e o modal acessível (foco, Esc, trap de Tab).
     ============================================ */
  function initSecurityPage(){
    /* --- refs overview --- */
    var ovLoading = document.getElementById('dbvSecOvLoading');
    var ovError = document.getElementById('dbvSecOvError');
    var ovErrorText = document.getElementById('dbvSecOvErrorText');
    var ovRetry = document.getElementById('dbvSecOvRetry');
    var ovList = document.getElementById('dbvSecOvList');

    /* --- refs sessões --- */
    var sesLoading = document.getElementById('dbvSecSesLoading');
    var sesEmpty = document.getElementById('dbvSecSesEmpty');
    var sesError = document.getElementById('dbvSecSesError');
    var sesErrorText = document.getElementById('dbvSecSesErrorText');
    var sesRetry = document.getElementById('dbvSecSesRetry');
    var sesList = document.getElementById('dbvSecSessionsList');
    var sesHead = document.getElementById('dbvSecSessionsHead');
    var sesRevokeAll = document.getElementById('dbvSecRevokeOthers');

    /* --- refs histórico --- */
    var histLoading = document.getElementById('dbvSecHistLoading');
    var histEmpty = document.getElementById('dbvSecHistEmpty');
    var histError = document.getElementById('dbvSecHistError');
    var histErrorText = document.getElementById('dbvSecHistErrorText');
    var histRetry = document.getElementById('dbvSecHistRetry');
    var histList = document.getElementById('dbvSecHistList');
    var histPager = document.getElementById('dbvSecHistPager');
    var histPrev = document.getElementById('dbvSecHistPrev');
    var histNext = document.getElementById('dbvSecHistNext');
    var histPage = document.getElementById('dbvSecHistPage');

    /* --- refs modal de segurança --- */
    var secModal = document.getElementById('dbvSecModal');
    var secPanel = document.getElementById('dbvSecModalPanel');
    var secClose = document.getElementById('dbvSecModalClose');
    var secCancel = document.getElementById('dbvSecModalCancel');
    var secConfirm = document.getElementById('dbvSecModalConfirm');
    var secConfirmText = document.getElementById('dbvSecModalConfirmText');
    var secError = document.getElementById('dbvSecModalError');
    var secTitle = document.getElementById('dbvSecModalTitle');
    var secSummary = document.getElementById('dbvSecModalSummary');
    var secDevice = document.getElementById('dbvSecModalDevice');
    var secIp = document.getElementById('dbvSecModalIp');
    var secCount = document.getElementById('dbvSecModalCount');
    var secBusy = false;
    var secTrigger = null;
    var secAction = null; // { kind: 'one', session } | { kind: 'others' }

    /* helper: alterna os estados de um bloco */
    function setBlockState(loadingEl, emptyEl, errorEl, listEl, pagerEl, mode){
      if(loadingEl) loadingEl.classList.toggle('show', mode === 'loading');
      if(emptyEl) emptyEl.classList.toggle('show', mode === 'empty');
      if(errorEl) errorEl.classList.toggle('show', mode === 'error');
      if(listEl) listEl.hidden = mode !== 'list';
      if(pagerEl) pagerEl.hidden = mode !== 'list';
    }

    function sessionIcon(){
      return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
    }

    /* pluralização correta do total de sessões ativas do dispositivo */
    function sessionCountLabel(n){
      var total = n || 1;
      return total === 1 ? '1 sessão ativa' : total + ' sessões ativas';
    }

    /* cada item da API agora representa um DISPOSITIVO (grupo de sessões):
       linha única com rótulo, IP/último acesso e quantidade de sessões.
       A sessão atual ganha badge no lugar do botão de encerramento. */
    function sessionItemHtml(d){
      var meta = [];
      if(d.ipMasked) meta.push('IP <b>' + es(d.ipMasked) + '</b>');
      if(d.lastUsedAt) meta.push('último acesso ' + formatDateTime(d.lastUsedAt));
      else if(d.createdAt) meta.push('criado em ' + formatDateTime(d.createdAt));

      var side;
      if(d.current){
        side = '<div class="dbv-sec-session-actions">' +
          '<span class="dbv-sec-badge is-current" aria-current="true">Este dispositivo</span>' +
        '</div>';
      } else {
        side = '<div class="dbv-sec-session-actions">' +
          '<button type="button" class="btn btn-ghost dbv-sec-session-out" data-sid="' + d.id + '">Encerrar acesso</button>' +
        '</div>';
      }

      return '<li class="dbv-sec-session' + (d.current ? ' is-current' : '') + '">' +
        '<div class="dbv-sec-session-ic">' + sessionIcon() + '</div>' +
        '<div class="dbv-sec-session-body">' +
          '<div class="dbv-sec-session-title">' + es(d.deviceLabel || 'Dispositivo desconhecido') + '</div>' +
          (d.userAgent ? '<div class="dbv-sec-session-sub">' + es(d.userAgent) + '</div>' : '') +
          '<div class="dbv-sec-session-meta">' + meta.join('') + '</div>' +
          '<div class="dbv-sec-session-count">' + sessionCountLabel(d.sessionCount) + '</div>' +
        '</div>' +
        side +
      '</li>';
    }

    function loginItemHtml(l){
      return '<li class="dbv-sec-login">' +
        '<div class="dbv-sec-login-ic"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 16l4-5 3 3 3-4"/><path d="M8 8h2"/></svg></div>' +
        '<div class="dbv-sec-login-body">' +
          '<div class="dbv-sec-login-title">' + es(l.deviceLabel || 'Dispositivo desconhecido') + '</div>' +
          (l.userAgent ? '<div class="dbv-sec-login-sub">' + es(l.userAgent) + '</div>' : '') +
        '</div>' +
        '<div class="dbv-sec-login-side">' +
          '<div class="dbv-sec-login-date">' + formatDateTime(l.createdAt) + '</div>' +
          (l.ipMasked ? '<div class="dbv-sec-login-ip">IP ' + es(l.ipMasked) + '</div>' : '') +
        '</div>' +
      '</li>';
    }

    /* --- overview --- */
    var lastOvData = null;
    var lastSessions = [];

    function renderOverview(){
      if(lastOvData === null) return;
      var d = lastOvData;
      setText('dbvSecLastAccess', d.lastLoginAt ? formatDateTime(d.lastLoginAt) : '—');
      setText('dbvSecTotalLogins', String(d.totalLogins || 0));
      var verifiedEl = document.getElementById('dbvSecVerified');
      if(verifiedEl){
        verifiedEl.innerHTML = d.emailVerified
          ? '<span class="dbv-sec-badge is-ok">Conta verificada</span>'
          : '<span class="dbv-sec-badge is-warn">Verificação pendente</span>';
      }
      var currentEl = document.getElementById('dbvSecCurrentSession');
      var cur = null;
      for(var i = 0; i < lastSessions.length; i++){
        if(lastSessions[i].current){ cur = lastSessions[i]; break; }
      }
      setText('dbvSecCurrentSession', cur && cur.deviceLabel ? cur.deviceLabel : '—');
    }

    function loadOverview(){
      setBlockState(ovLoading, null, ovError, ovList, null, 'loading');
      return loadSecurityOverview()
        .then(function(data){
          lastOvData = data;
          renderOverview();
          setBlockState(ovLoading, null, ovError, ovList, null, 'list');
        })
        .catch(function(err){
          if(ovErrorText){
            ovErrorText.textContent = err && err.message ? err.message : 'Não foi possível carregar seus acessos.';
          }
          setBlockState(ovLoading, null, ovError, ovList, null, 'error');
        });
    }

    /* --- sessões --- */
    function renderSessions(){
      if(sesHead){
        var n = lastSessions.length;
        sesHead.textContent = n === 0 ? 'Nenhum dispositivo conectado.'
          : (n === 1 ? '1 dispositivo conectado.' : n + ' dispositivos conectados.');
      }
      if(sesList){
        sesList.innerHTML = lastSessions.map(sessionItemHtml).join('');
      }
      // mostra "Sair de todos os outros" apenas se houver ao menos 1 sessão além da atual
      var hasOthers = lastSessions.some(function(s){ return !s.current; });
      if(sesRevokeAll) sesRevokeAll.hidden = !hasOthers;
      renderOverview();
    }

    function loadSessions(){
      setBlockState(sesLoading, sesEmpty, sesError, sesList, null, 'loading');
      return listSessions()
        .then(function(data){
          lastSessions = (data && data.items) || [];
          setBlockState(sesLoading, sesEmpty, sesError, sesList, null,
            lastSessions.length === 0 ? 'empty' : 'list');
          renderSessions();
        })
        .catch(function(err){
          if(sesErrorText){
            sesErrorText.textContent = err && err.message ? err.message : 'Não foi possível carregar suas sessões.';
          }
          setBlockState(sesLoading, sesEmpty, sesError, sesList, null, 'error');
        });
    }

    /* --- histórico paginado --- */
    var histPageNum = 1;
    var histTotalPages = 1;

    function renderHistory(items, meta){
      if(histList){
        histList.innerHTML = (items || []).map(loginItemHtml).join('');
      }
      if(histPrev) histPrev.disabled = histPageNum <= 1;
      if(histNext) histNext.disabled = histPageNum >= histTotalPages;
      if(histPage) histPage.textContent = 'Página ' + histPageNum + ' de ' + histTotalPages;
    }

    function loadHistory(page){
      if(page == null) page = histPageNum;
      if(page < 1) page = 1;
      histPageNum = page;
      setBlockState(histLoading, histEmpty, histError, histList, histPager, 'loading');

      return listSecurityLogins(histPageNum, 10)
        .then(function(data){
          data = data || {};
          var meta = data.meta || {};
          histTotalPages = meta.totalPages || 1;
          if(histPageNum > histTotalPages) histPageNum = histTotalPages;
          var items = (data.items || []);
          var mode = items.length === 0 ? 'empty' : 'list';
          setBlockState(histLoading, histEmpty, histError, histList, histPager, mode);
          renderHistory(items, meta);
        })
        .catch(function(err){
          if(histErrorText){
            histErrorText.textContent = err && err.message ? err.message : 'Não foi possível carregar o histórico.';
          }
          setBlockState(histLoading, histEmpty, histError, histList, histPager, 'error');
        });
    }

    /* --- modal acessível --- */
    function secFocusables(){
      if(!secPanel) return [];
      var els = secPanel.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      var out = [];
      for(var i = 0; i < els.length; i++){
        var el = els[i];
        if(!el.hidden && (el.offsetWidth || el.offsetHeight)) out.push(el);
      }
      return out;
    }

    function openSecModal(action, trigger){
      if(!secModal) return;
      secAction = action;
      secTrigger = trigger || null;
      secBusy = false;

      if(secTitle){
        secTitle.textContent = action.kind === 'others'
          ? 'Sair de todos os outros dispositivos'
          : 'Encerrar acesso deste dispositivo?';
      }
      if(secSummary){
        secSummary.hidden = action.kind !== 'one';
        if(action.kind === 'one'){
          var s = action.session || {};
          if(secDevice) secDevice.textContent = s.deviceLabel || 'Dispositivo desconhecido';
          if(secIp) secIp.textContent = s.ipMasked || '—';
          if(secCount) secCount.textContent = sessionCountLabel(s.sessionCount);
        }
      }
      if(secConfirmText){
        secConfirmText.textContent = action.kind === 'others'
          ? 'Sair de todos os outros'
          : 'Encerrar acesso';
      }
      if(secError) secError.hidden = true;
      if(secConfirm) secConfirm.disabled = false;
      if(secCancel) secCancel.disabled = false;
      if(secClose) secClose.disabled = false;
      if(secModal) secModal.hidden = false;
      if(secModal) secModal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('dbv-modal-open');
      if(secCancel) secCancel.focus();
    }

    function closeSecModal(){
      if(!secModal || secModal.hidden) return;
      if(secBusy) return;
      secModal.hidden = true;
      secModal.setAttribute('aria-hidden', 'true');
      secAction = null;
      document.body.classList.remove('dbv-modal-open');
      if(secTrigger && secTrigger.focus) secTrigger.focus();
      secTrigger = null;
    }

    function doSecAction(){
      if(secBusy || !secAction) return;
      if(secConfirm && secConfirm.disabled) return;
      secBusy = true;
      secModal.setAttribute('aria-busy', 'true');
      if(secConfirm) secConfirm.disabled = true;
      if(secCancel) secCancel.disabled = true;
      if(secClose) secClose.disabled = true;
      if(secConfirmText){
        secConfirmText.textContent = secAction.kind === 'others'
          ? 'Encerrando outros acessos...'
          : 'Encerrando acesso...';
      }
      if(secError) secError.hidden = true;

      var req = secAction.kind === 'others'
        ? revokeOtherSessions()
        : revokeSession(secAction.session.id);

      req.then(function(){
        secBusy = false;
        secModal.removeAttribute('aria-busy');
        closeSecModal();
        loadSessions();
      }).catch(function(err){
        secBusy = false;
        secModal.removeAttribute('aria-busy');
        if(secConfirm) secConfirm.disabled = false;
        if(secCancel) secCancel.disabled = false;
        if(secClose) secClose.disabled = false;
        if(secConfirmText){
          secConfirmText.textContent = secAction.kind === 'others'
            ? 'Sair de todos os outros'
            : 'Encerrar acesso';
        }
        if(secError){
          secError.textContent = err && err.message ? err.message : 'Não foi possível concluir agora. Tente novamente.';
          secError.hidden = false;
        }
      });
    }

    if(secModal){
      secModal.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){
          if(secBusy) return;
          e.preventDefault();
          closeSecModal();
          return;
        }
        if(e.key !== 'Tab') return;
        var els = secFocusables();
        if(els.length === 0) return;
        var first = els[0], last = els[els.length - 1];
        var active = document.activeElement;
        if(e.shiftKey){
          if(active === first || active === document.body){
            e.preventDefault();
            last.focus();
          }
        } else if(active === last){
          e.preventDefault();
          first.focus();
        }
      });
      var backdrop = secModal.querySelector('.dbv-modal-backdrop');
      if(backdrop){
        backdrop.addEventListener('click', function(){
          if(!secBusy) closeSecModal();
        });
      }
    }
    if(secCancel) secCancel.addEventListener('click', function(){ if(!secBusy) closeSecModal(); });
    if(secClose) secClose.addEventListener('click', function(){ if(!secBusy) closeSecModal(); });
    if(secConfirm) secConfirm.addEventListener('click', doSecAction);

    /* delegação: botão "Encerrar acesso" de cada linha de dispositivo */
    if(sesList){
      sesList.addEventListener('click', function(e){
        var btn = e.target && e.target.closest ? e.target.closest('[data-sid]') : null;
        if(!btn) return;
        e.preventDefault();
        var sid = btn.getAttribute('data-sid');
        var session = null;
        for(var i = 0; i < lastSessions.length; i++){
          if(lastSessions[i].id === sid){ session = lastSessions[i]; break; }
        }
        if(session) openSecModal({ kind: 'one', session: session }, btn);
      });
    }
    if(sesRevokeAll){
      sesRevokeAll.addEventListener('click', function(){
        openSecModal({ kind: 'others' }, sesRevokeAll);
      });
    }

    /* retries */
    if(ovRetry) ovRetry.addEventListener('click', loadOverview);
    if(sesRetry) sesRetry.addEventListener('click', loadSessions);
    if(histRetry) histRetry.addEventListener('click', function(){ loadHistory(histPageNum); });
    if(histPrev) histPrev.addEventListener('click', function(){ if(histPageNum > 1) loadHistory(histPageNum - 1); });
    if(histNext) histNext.addEventListener('click', function(){ if(histPageNum < histTotalPages) loadHistory(histPageNum + 1); });

    /* disparo inicial */
    loadOverview();
    loadSessions();
    loadHistory(1);
  }

  /* ============================================
     Alterar senha
     - POST /auth/password/change via helper de api.js;
     - validação inline (backend continua autoridade);
     - estados loading/sucesso/erro acessíveis;
     - sucesso encerra a sessão local e vai para
       login.html?changed=1 (o backend já revogou todas
       as sessões — logout esperado).
     ============================================ */
  function initPasswordPage(){
    var form = document.getElementById('cfgPassForm');
    if(!form) return;

    var fields = {
      current: document.getElementById('field-cfgCurrentPassword'),
      next: document.getElementById('field-cfgNewPassword'),
      confirm: document.getElementById('field-cfgConfirmPassword'),
    };
    var inputs = {
      current: document.getElementById('cfgCurrentPassword'),
      next: document.getElementById('cfgNewPassword'),
      confirm: document.getElementById('cfgConfirmPassword'),
    };

    /* Autofill do navegador não deve trazer senhas salvas para cá:
       garante campos vazios no carregamento. */
    function clearPassInputs(){
      try{
        if(inputs.current) inputs.current.value = '';
        if(inputs.next) inputs.next.value = '';
        if(inputs.confirm) inputs.confirm.value = '';
      }catch(e){}
    }
    clearPassInputs();
    window.addEventListener('load', clearPassInputs);

    var submitBtn = document.getElementById('cfgPassSubmit');
    var successBox = document.getElementById('cfgPassSuccess');
    var errorBox = document.getElementById('cfgPassError');
    var busy = false;

    /* --- helpers de erro inline (padrão auth) --- */
    function setFieldError(key, message){
      var field = fields[key];
      var input = inputs[key];
      if(!field || !input) return;
      field.classList.add('has-error');
      field.classList.remove('is-valid');
      var err = field.querySelector('.field-error');
      if(err) err.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      if(err){
        input.setAttribute('aria-describedby', err.id || '');
      }
    }

    function clearFieldError(key){
      var field = fields[key];
      var input = inputs[key];
      if(!field || !input) return;
      field.classList.remove('has-error');
      field.classList.remove('is-valid');
      var err = field.querySelector('.field-error');
      if(err) err.textContent = '';
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }

    function clearAllErrors(){
      clearFieldError('current');
      clearFieldError('next');
      clearFieldError('confirm');
      if(errorBox){ errorBox.hidden = true; errorBox.textContent = ''; }
    }

    function showGeneralError(message){
      if(!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    /* --- mostrar/ocultar senha (aria-pressed + label) --- */
    function bindToggle(btnId, inputId){
      var btn = document.getElementById(btnId);
      var input = document.getElementById(inputId);
      if(!btn || !input) return;
      btn.addEventListener('click', function(){
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.classList.toggle('showing', !showing);
        btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
        btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      });
    }
    bindToggle('cfgToggleCurrent', 'cfgCurrentPassword');
    bindToggle('cfgToggleNew', 'cfgNewPassword');
    bindToggle('cfgToggleConfirm', 'cfgConfirmPassword');

    /* limpa o erro do campo enquanto o usuário digita */
    Object.keys(inputs).forEach(function(key){
      var input = inputs[key];
      if(!input) return;
      input.addEventListener('input', function(){
        var field = fields[key];
        if(field && field.classList.contains('has-error')) clearFieldError(key);
      });
    });

    /* --- validação frontend (backend continua autoridade) --- */
    function validate(){
      var errors = [];
      var current = inputs.current ? inputs.current.value : '';
      var next = inputs.next ? inputs.next.value : '';
      var confirm = inputs.confirm ? inputs.confirm.value : '';

      if(!current){
        errors.push({ key: 'current', message: 'Informe sua senha atual.' });
      }

      if(!next){
        errors.push({ key: 'next', message: 'Informe a nova senha.' });
      } else if(next.length < 8){
        errors.push({ key: 'next', message: 'A nova senha deve ter no mínimo 8 caracteres.' });
      } else if(!/[A-Za-z]/.test(next) || !/\d/.test(next)){
        errors.push({ key: 'next', message: 'A nova senha deve conter letras e números.' });
      }

      if(!confirm){
        errors.push({ key: 'confirm', message: 'Confirme a nova senha.' });
      } else if(next && confirm !== next){
        errors.push({ key: 'confirm', message: 'As senhas não coincidem.' });
      }

      if(!errors.length && current && next && next === current){
        errors.push({ key: 'next', message: 'A nova senha deve ser diferente da atual.' });
      }

      return errors;
    }

    /* --- roteamento de erros do backend para campos --- */
    function routeBackendError(err){
      var status = err && err.status;
      var msg = err && err.message ? err.message : '';

      if(status === 401){
        /* apiRequest já limpou a sessão e redirecionou para o login. */
        return;
      }

      if(status === 400){
        if(msg.indexOf('Senha atual incorreta') !== -1){
          setFieldError('current', msg);
          inputs.current.focus();
          return;
        }
        if(msg.indexOf('não coincidem') !== -1){
          setFieldError('confirm', msg);
          inputs.confirm.focus();
          return;
        }
        if(
          msg.indexOf('diferente da atual') !== -1 ||
          msg.indexOf('letras e números') !== -1 ||
          msg.indexOf('8 characters') !== -1 ||
          msg.indexOf('longer than') !== -1
        ){
          setFieldError('next', msg);
          inputs.next.focus();
          return;
        }
        showGeneralError(msg || 'Não foi possível alterar a senha. Verifique os dados e tente novamente.');
        return;
      }

      if(status === 429){
        showGeneralError(msg || 'Muitas tentativas. Aguarde alguns segundos e tente novamente.');
        return;
      }

      showGeneralError(msg || 'Não foi possível alterar a senha agora. Tente novamente.');
    }

    function setLoading(on){
      if(!submitBtn) return;
      submitBtn.disabled = on;
      if(on){
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.textContent = 'Alterando...';
      } else {
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = 'Alterar senha';
      }
    }

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(busy) return;

      clearAllErrors();
      if(successBox) successBox.hidden = true;

      var errors = validate();
      if(errors.length > 0){
        for(var i = 0; i < errors.length; i++){
          setFieldError(errors[i].key, errors[i].message);
        }
        var first = inputs[errors[0].key];
        if(first) first.focus();
        return;
      }

      busy = true;
      setLoading(true);

      changePassword({
        currentPassword: inputs.current.value,
        newPassword: inputs.next.value,
        confirmNewPassword: inputs.confirm.value,
      }).then(function(){
        /* Sucesso: feedback breve -> logout esperado -> login.html?changed=1 */
        if(successBox){
          successBox.textContent = 'Senha alterada com sucesso. Todas as sessões foram encerradas por segurança — redirecionando para o login...';
          successBox.hidden = false;
        }
        if(errorBox) errorBox.hidden = true;
        inputs.current.value = '';
        inputs.next.value = '';
        inputs.confirm.value = '';
        clearFieldError('current');
        clearFieldError('next');
        clearFieldError('confirm');

        setTimeout(function(){
          clearSession();
          window.location.href = 'login.html?changed=1';
        }, 2000);
        /* busy permanece true até redirecionar: sem duplo envio pós-sucesso */
      }).catch(function(err){
        setLoading(false);
        busy = false;
        routeBackendError(err);
      });
    });
  }

  /* ============================================
     Alterar e-mail
     - POST /auth/email/change via requestEmailChange();
     - validação local: obrigatório, formato, diferente
       do atual, senha obrigatória;
     - sucesso NÃO troca o e-mail na interface: mostra
       confirmação enviada + pendência aguardando;
     - uma nova solicitação substitui a pendência
       anterior (comportamento do backend).
     ============================================ */
  function initEmailPage(){
    var form = document.getElementById('cfgEmailForm');
    if(!form) return;

    var fields = {
      email: document.getElementById('field-cfgNewEmail'),
      pass: document.getElementById('field-cfgEmailPassword'),
    };
    var inputs = {
      email: document.getElementById('cfgNewEmail'),
      pass: document.getElementById('cfgEmailPassword'),
    };

    /* Autofill do navegador não deve preencher o novo e-mail com o
       e-mail atual nem trazer senhas salvas: campos começam vazios. */
    function clearEmailInputs(){
      try{
        if(inputs.email) inputs.email.value = '';
        if(inputs.pass) inputs.pass.value = '';
      }catch(e){}
    }
    clearEmailInputs();
    window.addEventListener('load', clearEmailInputs);

    var submitBtn = document.getElementById('cfgEmailSubmit');
    var successBox = document.getElementById('cfgEmailSuccess');
    var pendingBox = document.getElementById('cfgEmailPending');
    var pendingEmailEl = document.getElementById('cfgPendingEmail');
    var errorBox = document.getElementById('cfgEmailError');
    var busy = false;
    var currentEmail = '';

    function setCurrentEmail(email){
      currentEmail = String(email || '').trim().toLowerCase();
      setText('cfgCurrentEmail', email || '—');
      /* o e-mail atual é apenas informação: o campo de novo e-mail
         nunca deve herdá-lo (nem via autofill). */
      clearEmailInputs();
    }

    /* --- helpers de erro inline (mesmo padrão da senha) --- */
    function setFieldError(key, message){
      var field = fields[key];
      var input = inputs[key];
      if(!field || !input) return;
      field.classList.add('has-error');
      field.classList.remove('is-valid');
      var err = field.querySelector('.field-error');
      if(err) err.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      if(err){
        input.setAttribute('aria-describedby', err.id || '');
      }
    }

    function clearFieldError(key){
      var field = fields[key];
      var input = inputs[key];
      if(!field || !input) return;
      field.classList.remove('has-error');
      field.classList.remove('is-valid');
      var err = field.querySelector('.field-error');
      if(err) err.textContent = '';
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }

    function clearAllErrors(){
      clearFieldError('email');
      clearFieldError('pass');
      if(errorBox){ errorBox.hidden = true; errorBox.textContent = ''; }
    }

    function showGeneralError(message){
      if(!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    /* --- mostrar/ocultar senha --- */
    (function bindToggle(){
      var btn = document.getElementById('cfgToggleEmailPassword');
      var input = inputs.pass;
      if(!btn || !input) return;
      btn.addEventListener('click', function(){
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.classList.toggle('showing', !showing);
        btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
        btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      });
    })();

    /* limpa o erro do campo enquanto o usuário digita */
    Object.keys(inputs).forEach(function(key){
      var input = inputs[key];
      if(!input) return;
      input.addEventListener('input', function(){
        var field = fields[key];
        if(field && field.classList.contains('has-error')) clearFieldError(key);
      });
    });

    function isValidEmailFormat(value){
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    /* --- validação frontend (backend continua autoridade) --- */
    function validate(){
      var errors = [];
      var email = inputs.email ? inputs.email.value.trim() : '';
      var pass = inputs.pass ? inputs.pass.value : '';

      if(!email){
        errors.push({ key: 'email', message: 'Informe o novo e-mail.' });
      } else if(!isValidEmailFormat(email)){
        errors.push({ key: 'email', message: 'Digite um e-mail válido.' });
      } else if(currentEmail && email.toLowerCase() === currentEmail){
        errors.push({ key: 'email', message: 'O novo e-mail deve ser diferente do atual.' });
      }

      if(!pass){
        errors.push({ key: 'pass', message: 'Informe sua senha atual.' });
      }

      return errors;
    }

    /* --- roteamento de erros do backend para campos --- */
    function routeBackendError(err){
      var status = err && err.status;
      var msg = err && err.message ? err.message : '';

      if(status === 401){
        /* apiRequest já limpou a sessão e redirecionou para o login. */
        return;
      }

      if(status === 400){
        if(msg.indexOf('Senha atual incorreta') !== -1){
          setFieldError('pass', msg);
          inputs.pass.focus();
          return;
        }
        if(
          msg.indexOf('diferente do atual') !== -1 ||
          msg.indexOf('válido') !== -1 ||
          msg.indexOf('valid') !== -1 ||
          msg.indexOf('email') !== -1 ||
          msg.indexOf('e-mail') !== -1
        ){
          setFieldError('email', msg);
          inputs.email.focus();
          return;
        }
        showGeneralError(msg || 'Não foi possível enviar a confirmação. Verifique os dados e tente novamente.');
        return;
      }

      if(status === 409){
        setFieldError('email', msg || 'Este e-mail já está cadastrado.');
        inputs.email.focus();
        return;
      }

      if(status === 429){
        showGeneralError(msg || 'Muitas tentativas. Aguarde alguns segundos e tente novamente.');
        return;
      }

      showGeneralError(msg || 'Não foi possível enviar a confirmação agora. Tente novamente.');
    }

    function setLoading(on){
      if(!submitBtn) return;
      submitBtn.disabled = on;
      if(on){
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.textContent = 'Enviando...';
      } else {
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = 'Enviar confirmação';
      }
    }

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(busy) return;

      clearAllErrors();
      if(successBox) successBox.hidden = true;

      var errors = validate();
      if(errors.length > 0){
        for(var i = 0; i < errors.length; i++){
          setFieldError(errors[i].key, errors[i].message);
        }
        var first = inputs[errors[0].key];
        if(first) first.focus();
        return;
      }

      busy = true;
      setLoading(true);

      var requestedEmail = inputs.email.value.trim();

      requestEmailChange({
        newEmail: requestedEmail,
        currentPassword: inputs.pass.value,
      }).then(function(){
        /* Sucesso: e-mail segue o mesmo na interface — só sinaliza
           a pendência. Nova solicitação continua permitida. */
        busy = false;
        setLoading(false);

        if(successBox){
          successBox.textContent = 'Confirmação enviada para seu novo e-mail. Verifique sua caixa de entrada para concluir a alteração.';
          successBox.hidden = false;
        }
        if(pendingBox){
          if(pendingEmailEl) pendingEmailEl.textContent = requestedEmail;
          pendingBox.hidden = false;
        }
        if(errorBox) errorBox.hidden = true;
        inputs.pass.value = '';
        clearFieldError('pass');
      }).catch(function(err){
        setLoading(false);
        busy = false;
        routeBackendError(err);
      });
    });

    /* exposto para o boot preencher o e-mail atual do perfil */
    return { setCurrentEmail: setCurrentEmail };
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

    initSecurityPage();
    initPasswordPage();
    var emailPage = initEmailPage();

    loadProfile()
      .then(function(data){
        renderProfile(data);
        if(emailPage && data && data.user){
          emailPage.setCurrentEmail(data.user.email);
        }
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('cfgSub', err && err.message ? err.message : 'Não foi possível carregar seus dados.');
      });
  });
})();