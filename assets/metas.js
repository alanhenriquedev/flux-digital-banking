/* ============================================
   FLUX — Metas financeiras (metas.html)
   Boot + CRUD de metas via /goals.
   Nenhum dado de usuário vem do frontend:
   userId sempre do token autenticado.
   ============================================ */
(function(){
  'use strict';

  function $(id){ return document.getElementById(id); }
  function setText(id, text){ var el = $(id); if(el) el.textContent = text; }

  function formatBRL(n){
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
  }
  function formatDate(iso){
    var d = iso ? new Date(iso) : null;
    if(!d || isNaN(d.getTime())) return '—';
    function p(n){ return (n<10?'0':'')+n; }
    return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();
  }
  function es(str){
    return String(str==null?'':str)
      .replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')
      .replace(/"/g,'"').replace(/'/g,'');
  }

  /* ---------- estado ---------- */
  var goals = [];
  var editingId = null;
  var moneyCtx = { mode:'deposit', goalId:null };
  var modalReturnFocus = null;

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', function(){
    var logout = $('logoutLink');
    if(logout) logout.addEventListener('click', clearSession);

    if(!getToken()){ goLogin(); return; }

    loadProfile()
      .then(function(data){
        if(data && data.user){
          $('metUser').hidden = false;
          setText('metUserName', data.user.fullName || '...');
          var short = String(data.user.fullName||'').trim().split(/\s+/)[0] || '?';
          setText('metUserInitial', short.charAt(0).toUpperCase());
        }
      })
      .catch(function(){});

    loadGoals();

    $('metNewBtn').addEventListener('click', function(){ openFormModal(null, this); });
    $('metEmptyNew').addEventListener('click', function(){ openFormModal(null, this); });
    $('metRetry').addEventListener('click', loadGoals);

    bindGoalForm();
    bindMoneyForm();
    bindModals();
    $('metList').addEventListener('click', onListClick);
  });

  /* ---------- carregamento ---------- */
  function loadGoals(){
    setState('loading');
    apiRequest('/goals')
      .then(function(data){
        goals = (data && data.items) || [];
        render();
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('metErrorText', err && err.message ? err.message : 'Não foi possível carregar suas metas.');
        setState('error');
      });
  }

  function setState(mode){
    $('metLoading').classList.toggle('show', mode==='loading');
    $('metEmpty').classList.toggle('show', mode==='empty');
    $('metError').classList.toggle('show', mode==='error');
    $('metList').hidden = mode!=='list';
    $('metSumStrip').hidden = !(mode==='list');
    $('metSumLoading').classList.toggle('show', mode==='loading');
    if(mode!=='list') $('metCount').textContent='';
  }

  /* ---------- render ---------- */
  var ICON_GOAL = '<svg viewBox="0 0 24 24"><path d="M6 21V3h11l-2.5 4L17 11H6"/><path d="M3 21h6"/></svg>';
  var IC_ADD = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  var IC_OUT = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var IC_EDIT = '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 16l10-10 2 2-10 10H6Z"/></svg>';
  var IC_PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
  var IC_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8Z"/></svg>';
  var IC_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  function statusLabel(s){
    return s==='COMPLETED' ? 'Concluída' : s==='PAUSED' ? 'Pausada' : 'Ativa';
  }

  function render(){
    if(goals.length===0){ setState('empty'); renderSummary(); return; }
    setState('list');

    var saved = 0, active = 0, done = 0;
    goals.forEach(function(g){
      saved += Number(g.currentAmount)||0;
      if(g.status==='COMPLETED') done++;
      else if(g.status==='ACTIVE') active++;
    });
    renderSummary(saved, active, done);
    setText('metCount', goals.length===1 ? '1 meta' : goals.length+' metas');

    $('metList').innerHTML = goals.map(goalHtml).join('');
  }

  function renderSummary(saved, active, done){
    saved = saved||0; active = active||0; done = done||0;
    setText('metSumSaved', formatBRL(saved));
    setText('metSumActive', String(active));
    setText('metSumDone', String(done));
  }

  function goalHtml(g){
    var pct = Math.min(100, g.percent||0);
    var done = g.status==='COMPLETED';
    var paused = g.status==='PAUSED';

    var details = [];
    details.push('<span>Reservado <b>'+formatBRL(g.currentAmount)+'</b></span>');
    if(g.remaining>0 && !done) details.push('<span>Faltam <b>'+formatBRL(g.remaining)+'</b></span>');
    if(g.deadline){
      var dl = new Date(g.deadline);
      var late = done ? false : dl.getTime() < Date.now();
      details.push('<span>Prazo <b class="'+(late?'late':(g.onTrack===false?'late':'ontime'))+'">'+formatDate(dl)+'</b>'+(late&&!done?' · vencida':'')+'</span>');
    }
    if(g.forecastMonths!=null){
      details.push('<span>Previsão <b>~'+es(String(g.forecastMonths))+(g.forecastMonths===1?' mês':' meses')+'</b></span>');
      if(g.onTrack===false) details.push('<span class="late">fora do prazo estimado</span>');
    }

    var deleteDisabled = (Number(g.currentAmount)>0 && !done) ? ' disabled title="Retire o valor reservado antes de excluir"' : '';
    var pauseLabel = paused ? 'Retomar' : 'Pausar';
    var pauseIcon = paused ? IC_PLAY : IC_PAUSE;

    return '<li class="met-goal'+(paused?' is-paused':'')+(done?' is-completed':'')+'" data-gid="'+es(g.id)+'">' +
      '<div class="met-goal-top">' +
      '<span class="met-goal-ic" aria-hidden="true">'+ICON_GOAL+'</span>' +
        '<div class="met-goal-names">' +
          '<div class="met-goal-name">'+es(g.name)+'</div>' +
          (g.description ? '<div class="met-goal-desc">'+es(g.description)+'</div>' : '') +
        '</div>' +
        '<span class="met-badge is-'+g.status.toLowerCase()+'">'+statusLabel(g.status)+'</span>' +
      '</div>' +
      '<div class="met-progress" role="img" aria-label="Progresso '+String(pct).replace('.',',')+'%">' +
        '<div class="met-progress-fill'+(done?' is-done':'')+'" style="width:'+pct+'%"></div>' +
      '</div>' +
      '<div class="met-values">' +
        '<span class="cur">'+formatBRL(g.currentAmount)+'</span>' +
        '<span class="sep">de</span>' +
        '<span class="target">'+formatBRL(g.targetAmount)+'</span>' +
        '<span class="pct-sep">·</span>' +
        '<span class="pct'+(done?' is-done':'')+'">'+String(pct).replace('.',',')+'%</span>' +
      '</div>' +
      '<div class="met-details">'+details.join('')+'</div>' +
      '<div class="met-actions">' +
        (!done ? '<button type="button" class="met-action is-add" data-act="deposit"> '+IC_ADD+' Adicionar</button>' : '') +
        (Number(g.currentAmount)>0 ? '<button type="button" class="met-action" data-act="withdraw">'+IC_OUT+' Retirar</button>' : '') +
        (!done ? '<button type="button" class="met-action" data-act="edit">'+IC_EDIT+' Editar</button>' : '') +
        (!done ? '<button type="button" class="met-action" data-act="toggle-status">'+pauseIcon+' '+pauseLabel+'</button>' : '') +
        '<button type="button" class="met-action is-danger" data-act="delete"'+deleteDisabled+'>'+IC_TRASH+'<span>Excluir</span></button>' +
      '</div>' +
    '</li>';
  }

  /* ---------- ações por linha ---------- */
  function onListClick(e){
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if(!btn) return;
    var li = btn.closest('[data-gid]');
    if(!li) return;
    var gid = li.getAttribute('data-gid');
    var goal = findGoal(gid);
    if(!goal) return;

    var act = btn.getAttribute('data-act');
    if(act==='deposit') openMoneyModal('deposit', goal, btn);
    else if(act==='withdraw') openMoneyModal('withdraw', goal, btn);
    else if(act==='edit') openFormModal(goal, btn);
    else if(act==='toggle-status') toggleStatus(goal, btn);
    else if(act==='delete') confirmDelete(btn, gid);
  }

  function findGoal(id){
    for(var i=0;i<goals.length;i++) if(goals[i].id===id) return goals[i];
    return null;
  }

  function toggleStatus(goal, btn){
    var next = goal.status==='PAUSED' ? 'ACTIVE' : 'PAUSED';
    busyBtn(btn, true);
    apiRequest('/goals/'+encodeURIComponent(goal.id), {
      method:'PATCH',
      body: JSON.stringify({ status: next }),
    }).then(function(){
      busyBtn(btn,false);
      feedback(next==='PAUSED' ? 'Meta pausada.' : 'Meta retomada.');
      loadGoals();
    }).catch(function(err){
      busyBtn(btn,false);
      feedback(err && err.message ? err.message : 'Não foi possível atualizar.', true);
    });
  }

  /* exclusão em dois cliques (sem confirm nativo) */
  function confirmDelete(btn, gid){
    if(btn.getAttribute('data-confirming')==='1'){
      btn.disabled = true;
      apiRequest('/goals/'+encodeURIComponent(gid), { method:'DELETE' })
        .then(function(res){
          feedback((res&&res.message)||'Meta excluída.');
          loadGoals();
        })
        .catch(function(err){
          busyBtn(btn,false);
          feedback(err && err.message ? err.message : 'Não foi possível excluir.', true);
        });
      return;
    }
    btn.setAttribute('data-confirming','1');
    btn.classList.add('is-confirm');
    var label = btn.querySelector('span') || btn;
    if(btn.querySelector('span')) btn.querySelector('span').textContent = 'Confirmar exclusão?';
    setTimeout(function(){
      if(!btn.isConnected) return;
      btn.removeAttribute('data-confirming');
      btn.classList.remove('is-confirm');
      var sp = btn.querySelector('span');
      if(sp) sp.textContent = 'Excluir';
    }, 4000);
  }

  function busyBtn(btn,on){
    if(on){ btn.setAttribute('aria-busy','true'); btn.disabled=true; }
    else { btn.removeAttribute('aria-busy'); btn.disabled=false; }
  }

  function feedback(msg, isError){
    var el = $('metFeedback');
    el.textContent = msg;
    el.hidden = false;
    el.style.color = isError ? '#ffb3c0' : '';
    el.style.borderColor = isError ? 'rgba(255,92,122,0.35)' : '';
    clearTimeout(feedback._t);
    feedback._t = setTimeout(function(){ el.hidden = true; }, 5000);
  }

  /* ---------- modal: criar/editar ---------- */
  function openFormModal(goal, trigger){
    editingId = goal ? goal.id : null;
    modalReturnFocus = trigger||null;
    $('metFormEyebrow').textContent = goal ? 'Editar meta' : 'Nova meta';
    $('metFormTitle').textContent = goal ? 'Editar meta' : 'Criar meta';
    $('metGoalId').value = goal ? goal.id : '';
    $('metName').value = goal ? goal.name : '';
    $('metDescription').value = goal ? (goal.description||'') : '';
    $('metTarget').value = goal ? String(goal.targetAmount) : '';
    $('metDeadline').value = goal && goal.deadline ? toInputDate(goal.deadline) : '';
    clearErrors(['field-metName','field-metDescription','field-metTarget','field-metDeadline']);
    $('metFormError').hidden = true;
    openModal($('metFormModal'), $('metName'));
  }

  function bindGoalForm(){
    $('metGoalForm').addEventListener('submit', function(e){
      e.preventDefault();
      clearErrors(['field-metName','field-metDescription','field-metTarget','field-metDeadline']);
      $('metFormError').hidden = true;

      var name = $('metName').value.trim();
      var target = parseFloat($('metTarget').value);
      var payload = { name: name, description: $('metDescription').value.trim() };

      if(name.length<2){ setFieldError('field-metName','Informe um nome com pelo menos 2 caracteres.'); return; }
      if(isNaN(target) || target<1){ setFieldError('field-metTarget','Informe o valor objetivo (mínimo R$ 1,00).'); return; }
      payload.targetAmount = target;
      if($('metDeadline').value) payload.deadline = $('metDeadline').value + 'T12:00:00';
      if(editingId){
        payload.status = undefined; // status só pelo botão dedicado
        delete payload.status;
      }

      var submit = $('metFormSubmit');
      submit.disabled = true; submit.textContent = editingId ? 'Salvando...' : 'Criar meta';

      var req = editingId
        ? apiRequest('/goals/'+encodeURIComponent(editingId), { method:'PATCH', body: JSON.stringify(payload) })
        : apiRequest('/goals', { method:'POST', body: JSON.stringify(payload) });

      req.then(function(res){
        submit.disabled = false;
        submit.textContent = editingId ? 'Salvar alterações' : 'Criar meta';
        closeMetModal($('metFormModal'));
        feedback((res&&res.message)||'Meta salva.');
        loadGoals();
      }).catch(function(err){
        submit.disabled = false;
        submit.textContent = editingId ? 'Salvar alterações' : 'Criar meta';
        if(showApiFieldError(err)) return;
        var box = $('metFormError');
        box.textContent = err && err.message ? err.message : 'Não foi possível salvar a meta.';
        box.hidden = false;
      });
    });

  }

  /* ---------- modal: aporte/retirada ---------- */
  function openMoneyModal(mode, goal, trigger){
    moneyCtx = { mode: mode, goalId: goal.id, idempotencyKey: null };
    modalReturnFocus = trigger||null;
    var isDep = mode==='deposit';
    $('metMoneyEyebrow').textContent = isDep ? 'Aporte' : 'Retirada';
    $('metMoneyTitle').textContent = isDep ? 'Adicionar dinheiro' : 'Retirar dinheiro';
    $('metMoneyDesc').textContent = isDep
      ? 'O valor sai do saldo disponível da sua conta e entra na meta "'+goal.name+'".'
      : 'O valor volta para o saldo disponível da sua conta.';
    $('metMoneySubmit').textContent = isDep ? 'Adicionar' : 'Retirar';
    $('metAmount').value = '';
    clearErrors(['field-metAmount']);
    $('metMoneyError').hidden = true;
    $('metMoneyHint').textContent = isDep
      ? 'Disponível na conta: '+formatBRL(goal.currentAmount)
      : 'Reservado nesta meta: '+formatBRL(goal.currentAmount);
    if(isDep){
      apiRequest('/auth/me').then(function(me){
        if(me && me.account) $('metMoneyHint').textContent = 'Disponível na conta: '+formatBRL(me.account.balance);
      }).catch(function(){});
    }
    $('metMoneyGoalId').value = goal.id;
    openModal($('metMoneyModal'), $('metAmount'));
  }

  function bindMoneyForm(){
    $('metMoneyForm').addEventListener('submit', function(e){
      e.preventDefault();
      clearErrors(['field-metAmount']);
      $('metMoneyError').hidden = true;

      var amount = parseFloat($('metAmount').value);
      if(isNaN(amount) || amount<=0){
        setFieldError('field-metAmount','Informe um valor maior que zero.');
        return;
      }
      var isDep = moneyCtx.mode==='deposit';
      if(!moneyCtx.idempotencyKey){
        moneyCtx.idempotencyKey = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
              var r = Math.random() * 16 | 0;
              var v = c === 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
      }
      var submit = $('metMoneySubmit');
      submit.disabled = true;
      submit.textContent = isDep ? 'Adicionando...' : 'Retirando...';

      apiRequest('/goals/'+encodeURIComponent(moneyCtx.goalId)+'/'+(isDep?'deposit':'withdraw'), {
        method:'POST',
         body: JSON.stringify({ amount: amount, idempotencyKey: moneyCtx.idempotencyKey }),
      }).then(function(res){
        submit.disabled = false;
        submit.textContent = isDep ? 'Adicionar' : 'Retirar';
        closeMetModal($('metMoneyModal'));
        feedback((res&&res.message)||(isDep?'Aporte realizado.':'Retirada realizada.'));
        loadGoals();
      }).catch(function(err){
        submit.disabled = false;
        submit.textContent = isDep ? 'Adicionar' : 'Retirar';
        var box = $('metMoneyError');
        box.textContent = err && err.message ? err.message : 'Não foi possível concluir agora.';
        box.hidden = false;
      });
    });

  }

  /* ---------- infra dos modais (foco/Esc/trap) ---------- */
  function bindModals(){
    [ $('metFormModal'), $('metMoneyModal') ].forEach(function(modal){
      if(!modal) return;
      modal.addEventListener('keydown', function(e){
        if(e.key==='Escape'){ e.preventDefault(); closeMetModal(modal); return; }
        if(e.key!=='Tab') return;
        var els = focusables(modal);
        if(els.length===0) return;
        var first = els[0], last = els[els.length-1];
        var active = document.activeElement;
        if(e.shiftKey){ if(active===first || active===document.body){ e.preventDefault(); last.focus(); } }
        else if(active===last){ e.preventDefault(); first.focus(); }
      });
    });
    document.querySelectorAll('[data-met-close]').forEach(function(el){
      el.addEventListener('click', function(){
        var modal = el.closest('.met-modal');
        if(modal) closeMetModal(modal);
      });
    });
    var fc = $('metFormClose'); if(fc) fc.addEventListener('click', function(){ closeMetModal($('metFormModal')); });
    var mc = $('metMoneyClose'); if(mc) mc.addEventListener('click', function(){ closeMetModal($('metMoneyModal')); });
  }

  function focusables(root){
    var list = root.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    var out = [];
    for(var i=0;i<list.length;i++){
      var el = list[i];
      if(!el.hidden && (el.offsetWidth||el.offsetHeight)) out.push(el);
    }
    return out;
  }
  function openModal(modal, focusEl){
    if(!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('met-modal-open');
    if(focusEl) focusEl.focus();
  }
  function closeMetModal(modal){
    if(!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('met-modal-open');
    if(modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  /* ---------- helpers de erro ---------- */
  function setFieldError(fieldId,msg){
    var field = $(fieldId);
    if(!field) return;
    field.classList.add('has-error');
    var err = field.querySelector('.field-error');
    if(err) err.textContent = msg;
    var input = field.querySelector('input');
    if(input) input.setAttribute('aria-invalid','true');
  }
  function clearErrors(fieldIds){
    fieldIds.forEach(function(fid){
      var field = $(fid);
      if(!field) return;
      field.classList.remove('has-error');
      var err = field.querySelector('.field-error');
      if(err) err.textContent='';
      var input = field.querySelector('input');
      if(input) input.removeAttribute('aria-invalid');
    });
  }
  function showApiFieldError(err){
    // roteia erros 400 conhecidos para o campo correspondente
    var map = [
      [/nome/i,'field-metName'],
      [/descri/i,'field-metDescription'],
      [/objetivo/i,'field-metTarget'],
      [/data alvo/i,'field-metDeadline'],
      [/valor/i,'field-metAmount']
    ];
    var msg = err && err.message ? err.message : '';
    for(var i=0;i<map.length;i++){
      if(map[i][0].test(msg)){ setFieldError(map[i][1],msg); return true; }
    }
    return false;
  }
  function toInputDate(iso){
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    function p(n){ return (n<10?'0':'')+n; }
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  }
})();
