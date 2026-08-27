/* ============================================
   FLUX — Página do Cartão (cartao.html)
   Reutiliza o núcleo compartilhado (assets/api.js):
   sessão, autenticação, formatação e API.
   Consome apenas endpoints existentes do backend.
   Fluxos: carregar/obter cartão, limite, fatura,
   compras, pagar fatura (revisão → loading →
   sucesso/erro), bloquear/desbloquear (confirmação),
   flip 3D + tilt do cartão e animações de
   revelação de dados. Nenhum valor é hardcoded —
   tudo vem da API. A compra manual não é exposta
   ao usuário (o endpoint continua no backend).
   ============================================ */
(function(){
  'use strict';

  var state = {
    card: null,
    invoices: [],
    invoice: null,
    purchases: [],
    profile: null,
  };

  function $(id){ return document.getElementById(id); }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  function fmtDate(iso){
    var d = iso ? new Date(iso) : null;
    if(!d || isNaN(d.getTime())) return '—';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtShort(iso){
    var d = iso ? new Date(iso) : null;
    if(!d || isNaN(d.getTime())) return '—';
    return pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
  }
  function fmtCalendarDate(iso){
    var d = iso ? new Date(iso) : null;
    if(!d || isNaN(d.getTime())) return '—';
    return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fmtCalendarShort(iso){
    var d = iso ? new Date(iso) : null;
    if(!d || isNaN(d.getTime())) return '—';
    return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
  }

  /* ============================================
     HEADER / USER
     ============================================ */
  function renderUser(data){
    var name = data && data.user && data.user.fullName;
    if(!name) return;
    var chip = $('crdUser');
    var nameEl = $('crdUserName');
    var avatarEl = $('crdUserAvatar');
    if(nameEl) nameEl.textContent = name;
    if(avatarEl && avatarEl.textContent === '?'){
      var initials = name.trim().split(/\s+/).map(function(p){ return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
      avatarEl.textContent = initials || '?';
    }
    if(chip) chip.hidden = false;
  }

  /* ============================================
     ESTADO GLOBAL DA PÁGINA
     ============================================ */
  function setStage(mode){
    var loading = $('crdLoading');
    var error = $('crdError');
    var content = $('crdContent');
    if(loading) loading.classList.toggle('show', mode === 'loading');
    if(error) error.classList.toggle('show', mode === 'error');
    if(content) content.hidden = mode !== 'content';
  }

  /* ============================================
     RENDER: CARTÃO ARTE / LIMITE / FATURA / AÇÕES
     ============================================ */
  function formatPan(pan){
    if(!pan) return '';
    var d = String(pan).replace(/\D/g, '');
    var groups = d.match(/.{1,4}/g) || [];
    return groups.join(' ');
  }
  function revealNumber(show){
    var card = state.card;
    var num = $('crdCardNum');
    var btn = $('crdNumBtn');
    var lbl = $('crdNumLabel');
    if(!num) return;
    var canReveal = !!(card && card.fullNumber);
    if(show && canReveal){
      num.textContent = formatPan(card.fullNumber);
      if(lbl) lbl.textContent = 'Ocultar número';
      if(btn){ btn.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
    } else {
      num.textContent = '•••• •••• •••• ' + (card && card.last4 ? card.last4 : '••••');
      if(lbl) lbl.textContent = 'Ver número do cartão';
      if(btn){ btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
    }
  }

  function renderCard(){
    var card = state.card;
    if(!card) return;
    var holder = state.profile && state.profile.user && state.profile.user.fullName;
    if($('crdCardHolder')) $('crdCardHolder').textContent = holder || '—';
    if($('crdCardExpiry')) $('crdCardExpiry').textContent = card.expiresAt ? fmtShort(card.expiresAt) : '—';
    setText('crdCardType', card.type || 'VIRTUAL');

    var art = $('crdArtCard');
    var blocked = card.status === 'BLOCKED';
    if(art) art.classList.toggle('is-blocked', blocked);
    if($('crdBlockOverlay')) $('crdBlockOverlay').hidden = !blocked;

    var st = $('crdCardStatus');
    if(st){
      st.textContent = blocked ? 'Bloqueado' : 'Ativo';
      st.className = 'crd-badge-status ' + (blocked ? 'is-blocked' : 'is-active');
    }
    revealNumber(false);
  }

  function renderLimit(){
    var card = state.card;
    if(!card) return;
    var credit = Number(card.creditLimit);
    var avail = Number(card.availableLimit);
    var used = Math.max(0, credit - avail);
    var pct = credit > 0 ? Math.round((used / credit) * 100) : 0;

    var pctEl = $('crdLimitPct');
    if(pctEl){
      pctEl.textContent = pct + '%';
      pctEl.classList.remove('is-up', 'is-mid', 'is-high');
      pctEl.classList.add(pct >= 75 ? 'is-high' : (pct >= 45 ? 'is-mid' : 'is-up'));
    }
    var fill = $('crdLimitBarFill');
    if(fill) fill.style.width = Math.min(100, pct) + '%';
    var thumb = $('crdLimitThumb');
    if(thumb) thumb.style.left = Math.min(100, pct) + '%';
    animNumber($('crdLimitTotal'), credit, '');
    animNumber($('crdLimitAvail'), avail, '');
    animNumber($('crdLimitUsed'), used, '');
    setText('crdLimitStatus', card.status === 'BLOCKED' ? 'Bloqueado' : 'Ativo');
  }

  function pickInvoice(){
    var open = state.invoices.filter(function(i){ return i.status === 'OPEN'; });
    state.invoice = open.length ? open[0] : (state.invoices.length ? state.invoices[0] : null);
  }

  function renderInvoice(){
    var inv = state.invoice;
    var statusEl = $('crdInvStatus');
    if(!inv){
      setText('crdInvoiceSub', 'Você ainda não possui faturas.');
      if(statusEl){ statusEl.textContent = '—'; statusEl.className = 'crd-inv-status'; }
      animNumber($('crdInvAmount'), 0, '');
      setText('crdInvClosing', '—');
      setText('crdInvDue', '—');
      setText('crdInvCycle', '');
      if($('crdInvPaid')) $('crdInvPaid').hidden = true;
      return;
    }

    var open = inv.status === 'OPEN';
    if(statusEl){
      statusEl.textContent = open ? 'Aberta' : 'Paga';
      statusEl.className = 'crd-inv-status ' + (open ? 'is-open' : 'is-paid');
    }
    setText('crdInvoiceSub', open ? 'Fatura em aberto do seu cartão.' : 'Fatura mais recente — já paga.');
    animNumber($('crdInvAmount'), inv.totalAmount, '');
    setText('crdInvClosing', fmtCalendarShort(inv.closingDate));
    setText('crdInvDue', fmtCalendarShort(inv.dueDate));
    setText('crdInvCycle', open ? 'Aguardando pagamento até o vencimento.' : 'Ciclo encerrado.');

    var paid = $('crdInvPaid');
    if(paid){
      if(open){
        paid.hidden = true;
      } else {
        paid.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' +
          '<span>Fatura paga em <strong>' + fmtDate(inv.paidAt) + '</strong> · <strong>' + formatBRL(inv.paidAmount) + '</strong></span>';
        paid.hidden = false;
      }
    }
  }

  function renderActions(){
    var card = state.card;
    if(!card) return;
    var blocked = card.status === 'BLOCKED';
    var hasOpen = !!(state.invoice && state.invoice.status === 'OPEN');

    var payBtn = $('crdPayBtn');
    if(payBtn) payBtn.hidden = blocked || !hasOpen;

    var viewInv = $('crdViewInvoice');
    if(viewInv) viewInv.hidden = !state.invoice;

    setText('crdBlockActionLabel', blocked ? 'Desbloquear cartão' : 'Bloquear cartão');
    setText('crdBlockActionSub', blocked ? 'Reativar o uso do cartão' : 'Em caso de perda ou roubo');
  }

  /* ============================================
     RENDER: COMPRAS
     ============================================ */
  var PURCH_STATUS = {
    COMPLETED: ['Concluída', 'is-ok'],
    PENDING: ['Pendente', 'is-warn'],
    REFUNDED: ['Estornada', 'is-off'],
  };

  function purchHtml(p, idx){
    var s = PURCH_STATUS[p.status] || [p.status || '—', 'is-off'];
    return '' +
      '<li class="crd-purch" style="animation-delay:' + ((idx || 0) * 70) + 'ms">' +
        '<div class="crd-purch-ic">' +
          '<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.2L21 8H6"/></svg>' +
        '</div>' +
        '<div class="crd-purch-body">' +
          '<div class="crd-purch-name">' + es(p.description || 'Compra no cartão') + '</div>' +
          '<div class="crd-purch-sub">' + formatDateTime(p.createdAt) + ' · <span class="crd-badge ' + s[1] + '">' + s[0] + '</span></div>' +
        '</div>' +
        '<div class="crd-purch-amount">- ' + formatBRL(p.amount) + '</div>' +
      '</li>';
  }

  function purchState(mode){
    var L = $('crdPurchLoading');
    var E = $('crdPurchEmpty');
    var R = $('crdPurchError');
    var list = $('crdPurchList');
    if(L) L.classList.toggle('show', mode === 'loading');
    if(E) E.classList.toggle('show', mode === 'empty');
    if(R) R.classList.toggle('show', mode === 'error');
    if(list) list.classList.toggle('show', mode === 'list');
  }

  function renderPurchases(){
    if(!state.invoice || !state.purchases.length){
      purchState('empty');
      return;
    }
    purchState('list');
    var list = $('crdPurchList');
    if(!list) return;
    var html = '';
    for(var i = 0; i < state.purchases.length; i++){
      html += purchHtml(state.purchases[i], i);
    }
    list.innerHTML = html;
  }

  function renderAll(){
    renderCard();
    renderLimit();
    renderInvoice();
    renderActions();
    renderPurchases();
  }

  /* ============================================
     MODAIS
     ============================================ */
  var openModals = [];

  /* Elementos focáveis (visíveis) dentro de um modal. */
  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  var modalOpeners = {};

  function isVisible(el){
    return el && el.getClientRects && el.getClientRects().length > 0;
  }

  function firstFocusable(m){
    var els = m.querySelectorAll(FOCUSABLE);
    for(var i = 0; i < els.length; i++){
      if(isVisible(els[i])) return els[i];
    }
    return null;
  }

  function focusableList(m){
    var els = m.querySelectorAll(FOCUSABLE);
    var out = [];
    for(var i = 0; i < els.length; i++){
      if(isVisible(els[i])) out.push(els[i]);
    }
    return out;
  }

  function openModal(id){
    var m = $(id);
    if(!m) return;
    var opener = document.activeElement;
    // Guarda quem acionou o modal (para devolver o foco ao fechar).
    if(opener && !m.contains(opener)) modalOpeners[id] = opener;
    if(openModals.indexOf(id) === -1) openModals.push(id);
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
    // Move o foco para o primeiro controle/interativo relevante do modal.
    var first = firstFocusable(m);
    if(first) first.focus();
  }
  function closeModal(id){
    openModals = openModals.filter(function(m){ return m !== id; });
    var m = $(id);
    if(m) m.classList.remove('show');
    if(!openModals.length) document.body.style.overflow = '';
    var opener = modalOpeners[id];
    delete modalOpeners[id];
    // Devolve o foco ao elemento que abriu o modal.
    if(opener && opener.focus && document.contains(opener)) opener.focus();
  }
  function closeAllModals(){
    for(var i = openModals.length - 1; i >= 0; i--) closeModal(openModals[i]);
  }
  function showStep(modalId, stepId){
    var m = $(modalId);
    var s = $(stepId);
    if(!m || !s) return;
    var steps = m.querySelectorAll('.crd-modal-step');
    for(var i = 0; i < steps.length; i++) steps[i].classList.remove('show');
    s.classList.add('show');
  }
  function hideError(modalId){
    var card = $(modalId).querySelector('.crd-error-card');
    if(card) card.classList.remove('show');
  }
  function showError(msg){
    var card = document.querySelector('#cardPage .crd-modal.show .crd-error-card');
    if(!card) return;
    card.classList.remove('show');
    var span = card.querySelector('.crd-error-msg');
    if(span) span.textContent = msg;
    card.classList.add('show');
  }

  /* ============================================
     FLUXO: PAGAR FATURA
     ============================================ */
  function openPay(){
    var inv = state.invoice;
    if(!inv || inv.status !== 'OPEN'){
      return;
    }
    var balance = state.profile && state.profile.account ? Number(state.profile.account.balance) : 0;
    var avail = state.card ? Number(state.card.availableLimit) : 0;

    state.payAmount = inv.totalAmount;

    hideError('crdModalPay');
    setText('crdPayAmount', formatBRL(inv.totalAmount));
    setText('crdPayDue', fmtCalendarDate(inv.dueDate));
    setText('crdPayBalance', formatBRL(balance));
    setText('crdPayNewLimit', formatBRL(avail + Number(inv.totalAmount)));
    showStep('crdModalPay', 'crdPayReviewStep');
    openModal('crdModalPay');
  }

  function resetPayButton(){
    var btn = $('crdPayConfirm');
    if(btn) btn.classList.remove('is-loading');
  }

  function confirmPay(){
    var inv = state.invoice;
    if(!inv || inv.status !== 'OPEN') return;
    var btn = $('crdPayConfirm');
    if(btn && btn.classList.contains('is-loading')) return;
    hideError('crdModalPay');

    var balance = state.profile && state.profile.account ? Number(state.profile.account.balance) : 0;
    showStep('crdModalPay', 'crdPayLoadingStep');

    apiRequest('/invoices/' + inv.id + '/pay', { method: 'POST' })
      .then(function(res){
        var amount = Number(state.payAmount || inv.totalAmount);
        var newLimit = res && typeof res.availableLimit === 'number' ? res.availableLimit : Number(inv.totalAmount);
        setText('crdPayDoneAmount', formatBRL(amount));
        setText('crdPayDoneBalance', formatBRL(Math.max(0, balance - amount)));
        setText('crdPayDoneLimit', formatBRL(newLimit));
        showStep('crdModalPay', 'crdPayDoneStep');
        pulseLimit();
        refreshAll().catch(function(){});
      })
      .catch(function(err){
        showStep('crdModalPay', 'crdPayReviewStep');
        showError(err && err.message ? err.message : 'Não foi possível pagar a fatura.');
      });
  }

  /* ============================================
     FLUXO: BLOQUEAR / DESBLOQUEAR
     ============================================ */
  var blockMode = 'BLOCKED';

  function openBlock(){
    var card = state.card;
    if(!card) return;
    blockMode = card.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    var isBlock = blockMode === 'BLOCKED';
    setText('crdBlockTitle', isBlock ? 'Bloquear cartão' : 'Desbloquear cartão');
    setText('crdBlockText', isBlock
      ? 'Depois de bloqueado, nenhuma compra é aprovada. Você pode desbloquear a qualquer momento.'
      : 'Seu cartão voltará a funcionar para novas compras após o desbloqueio.');
    setText('crdBlockConfirm', isBlock ? 'Confirmar bloqueio' : 'Desbloquear cartão');
    var confirmBtn = $('crdBlockConfirm');
    var textP = $('crdBlockText');
    if(confirmBtn) confirmBtn.classList.remove('is-loading');
    if(textP) textP.classList.remove('is-err');
    openModal('crdModalBlock');
  }

  function confirmBlock(){
    var btn = $('crdBlockConfirm');
    if(btn && btn.classList.contains('is-loading')) return;
    var textP = $('crdBlockText');
    if(textP) textP.classList.remove('is-err');
    if(btn){
      btn.classList.add('is-loading');
      btn.textContent = 'Processando...';
    }

    apiRequest(blockMode === 'BLOCKED' ? '/cards/me/block' : '/cards/me/unblock', { method: 'POST' })
      .then(function(){
        closeModal('crdModalBlock');
        refreshAll()
          .then(function(){
            if(blockMode === 'BLOCKED'){
              setText('crdStatus', '');
            }
          })
          .catch(function(){});
      })
      .catch(function(err){
        if(btn){
          btn.classList.remove('is-loading');
          btn.textContent = blockMode === 'BLOCKED' ? 'Confirmar bloqueio' : 'Desbloquear cartão';
        }
        if(textP){
          textP.classList.add('is-err');
          textP.textContent = err && err.message ? err.message : 'Não foi possível concluir a operação.';
        }
      });
  }

  /* ============================================
     MODAL: VER FATURA
     ============================================ */
  function setInvoiceModalState(mode){
    var L = $('crdInvModalLoading');
    var E = $('crdInvModalEmpty');
    var list = $('crdInvModalList');
    if(L) L.classList.toggle('show', mode === 'loading');
    if(E) E.classList.toggle('show', mode === 'empty');
    if(list) list.classList.toggle('show', mode === 'list');
  }

  function openInvoiceModal(){
    var inv = state.invoice;
    if(!inv) return;
    var open = inv.status === 'OPEN';
    setText('crdInvModalTitle', open ? 'Fatura em aberto' : 'Fatura paga');
    if($('crdInvModalAmount')) $('crdInvModalAmount').textContent = formatBRL(inv.totalAmount);
    var statusEl = $('crdInvModalStatus');
    if(statusEl){
      statusEl.textContent = open ? 'Aberta' : 'Paga';
      statusEl.className = 'crd-inv-status ' + (open ? 'is-open' : 'is-paid');
    }
    setText('crdInvModalClosing', fmtCalendarShort(inv.closingDate));
    setText('crdInvModalDue', fmtCalendarShort(inv.dueDate));
    setText('crdInvModalActions', '');
    var payBtn = $('crdInvModalPay');
    if(payBtn) payBtn.hidden = !open;

    state.invoiceModalId = inv.id;
    openModal('crdModalInvoice');
    setInvoiceModalState('loading');

    apiRequest('/cards/me/invoices/' + inv.id)
      .then(function(detail){
        var purchases = detail && detail.purchases ? detail.purchases : [];
        if(!purchases.length){
          setInvoiceModalState('empty');
          return;
        }
        setInvoiceModalState('list');
        var list = $('crdInvModalList');
        var html = '';
        for(var i = 0; i < purchases.length; i++) html += purchHtml(purchases[i], i);
        list.innerHTML = html;
      })
      .catch(function(){
        setInvoiceModalState('empty');
        if($('crdInvModalEmpty')){
          var p = $('crdInvModalEmpty').querySelector('p');
          if(p) p.textContent = 'Não foi possível carregar os detalhes da fatura.';
        }
      });
  }

  /* ============================================
     API / REFRESH
     ============================================ */
  function getCardData(){
    return apiRequest('/cards/me').then(function(list){
      if(list && list.length) return list[0];
      return apiRequest('/cards', { method: 'POST' });
    });
  }

  function refreshAll(){
    return Promise.all([getCardData(), apiRequest('/cards/me/invoices'), loadProfile()])
      .then(function(results){
        state.card = results[0];
        state.invoices = results[1] || [];
        state.profile = results[2];
        renderUser(state.profile);
        pickInvoice();
        renderAll();
        if(state.invoice){
          return apiRequest('/cards/me/invoices/' + state.invoice.id);
        }
        state.purchases = [];
        return null;
      })
      .then(function(detail){
        state.purchases = detail && detail.purchases ? detail.purchases : [];
        renderPurchases();
      });
  }

  function pulseLimit(){
    var pctEl = $('crdLimitPct');
    if(!pctEl) return;
    pctEl.classList.remove('pulse');
    void pctEl.offsetWidth;
    pctEl.classList.add('pulse');
  }

  /* ============================================
     ANIMAÇÕES / INTERAÇÃO DO CARTÃO
     ============================================ */
  function animNumber(el, value, prefix){
    if(!el) return;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      el.textContent = prefix + formatBRL(value);
      return;
    }
    var from = 0;
    var to = Number(value) || 0;
    var dur = 750;
    var start = null;
    function step(ts){
      if(start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + formatBRL(from + (to - from) * e);
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCardInteractions(){
    var numBtn = $('crdNumBtn');
    if(numBtn){
      numBtn.addEventListener('click', function(){
        revealNumber(numBtn.getAttribute('aria-expanded') !== 'true');
      });
    }

    var flipBtn = $('crdFlipBtn');
    if(flipBtn){
      flipBtn.addEventListener('click', function(){
        var card = $('crdArtCard');
        if(!card) return;
        var open = card.classList.toggle('is-flipped');
        flipBtn.classList.toggle('is-open', open);
        flipBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        var lbl = $('crdFlipLabel');
        if(lbl) lbl.textContent = open ? 'Esconder verso' : 'Ver verso';
      });
    }

    var stage = $('crdCard3D');
    if(stage && window.matchMedia &&
       window.matchMedia('(hover:hover) and (pointer:fine)').matches &&
       !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      var raf = null;
      stage.addEventListener('mousemove', function(e){
        if(raf) return;
        raf = requestAnimationFrame(function(){
          var r = stage.getBoundingClientRect();
          var rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
          var ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
          stage.style.setProperty('--rx', rx.toFixed(2) + 'deg');
          stage.style.setProperty('--ry', ry.toFixed(2) + 'deg');
          raf = null;
        });
      });
      stage.addEventListener('mouseleave', function(){
        stage.style.setProperty('--rx', '0deg');
        stage.style.setProperty('--ry', '0deg');
      });
    }
  }

  /* ============================================
     BOOT
     ============================================ */
  function loadAll(){
    setStage('loading');
    setText('crdStatus', '');

    refreshAll()
      .then(function(){ setStage('content'); })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setStage('error');
        setText('crdErrorText', err && err.message ? err.message : 'Não foi possível carregar seu cartão.');
      });
  }

  document.addEventListener('DOMContentLoaded', function(){
    var logoutLink = $('logoutLink');
    if(logoutLink){
      logoutLink.addEventListener('click', clearSession);
    }

    var retry = $('crdRetry');
    if(retry) retry.addEventListener('click', loadAll);
    var purchRetry = $('crdPurchRetry');
    if(purchRetry) purchRetry.addEventListener('click', function(){ refreshAll().catch(function(){}); });

    var token = getToken();
    if(!token){
      goLogin();
      return;
    }

    /* ações */
    var blockAction = $('crdBlockAction');
    if(blockAction) blockAction.addEventListener('click', openBlock);
    var payBtn = $('crdPayBtn');
    if(payBtn) payBtn.addEventListener('click', openPay);
    var viewInv = $('crdViewInvoice');
    if(viewInv) viewInv.addEventListener('click', openInvoiceModal);
    var seePurchases = $('crdSeePurchases');
    if(seePurchases){
      seePurchases.addEventListener('click', function(){
        var s = $('crdPurchasesSection');
        if(s){
          var smoother = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
          s.scrollIntoView({ behavior: smoother, block: 'start' });
        }
      });
    }

    /* interação do cartão: flip + tilt */
    initCardInteractions();

    /* pagar fatura */
    var payConfirm = $('crdPayConfirm');
    if(payConfirm) payConfirm.addEventListener('click', confirmPay);
    var payRetry = $('crdPayRetry');
    if(payRetry) payRetry.addEventListener('click', confirmPay);
    var payDoneClose = $('crdPayDoneClose');
    if(payDoneClose) payDoneClose.addEventListener('click', function(){ closeModal('crdModalPay'); });

    /* bloquear */
    var blockConfirm = $('crdBlockConfirm');
    if(blockConfirm) blockConfirm.addEventListener('click', confirmBlock);
    var blockCancel = $('crdBlockCancel');
    if(blockCancel) blockCancel.addEventListener('click', function(){ closeModal('crdModalBlock'); });

    /* modal ver fatura → pagar */
    var invModalPay = $('crdInvModalPay');
    if(invModalPay) invModalPay.addEventListener('click', function(){
      closeModal('crdModalInvoice');
      openPay();
    });

    /* fechamento de modais via [data-close] (botão X e backdrop) */
    var closers = document.querySelectorAll('[data-close]');
    for(var i = 0; i < closers.length; i++){
      (function(el){
        el.addEventListener('click', function(){ closeModal(el.getAttribute('data-close')); });
      })(closers[i]);
    }

    /* Esc fecha o modal mais recente; Tab fica preso dentro do modal aberto. */
    document.addEventListener('keydown', function(e){
      if(!openModals.length) return;
      var top = openModals[openModals.length - 1];
      var topEl = $(top);
      if(e.key === 'Escape'){
        closeModal(top);
        return;
      }
      if(e.key === 'Tab' && topEl){
        var vis = focusableList(topEl);
        if(!vis.length) return;
        var first = vis[0];
        var last = vis[vis.length - 1];
        var active = document.activeElement;
        var inside = topEl.contains(active);
        if(e.shiftKey){
          if(active === first || !inside){
            e.preventDefault();
            last.focus();
          }
        } else {
          if(active === last || !inside){
            e.preventDefault();
            first.focus();
          }
        }
      }
    });

    loadAll();
  });
})();