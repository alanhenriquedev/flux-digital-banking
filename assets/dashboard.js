/* ============================================
   FLUX — Dashboard V2 (dashboard_1.html)
   Carrega dados reais via GET /api/auth/me e
   GET /api/transactions (paginado).
   - Gráfico financeiro (7/30 dias) derivado das
     transações reais + saldo atual (âncora).
   - Simulador de empréstimo (frontend, Price).
   - Últimas movimentações reais + "Ver todas"
     (reuso do itemHtml/extrato com paginação).
   Núcleo compartilhado em assets/api.js (nada
   é copiado de lá). PIX vive em pix.html/pix.js.
   ============================================ */
(function(){
  'use strict';

  var profile = null;
  var balanceState = { hidden: false, value: null };
  var chartDays = 7;
  var chartContext = null;
  var tooltipIdx = -1;
  var allLoaded = false;
  var refreshMovements = null;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================
     Helpers locais de apresentação
     ============================================ */
  function firstPart(name){
    var s = String(name || '').trim();
    return s ? s.split(/\s+/)[0] : '';
  }

  function greetingWord(){
    var h = new Date().getHours();
    if(h >= 5 && h < 12) return 'Bom dia';
    if(h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function startOfDay(value){
    var d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fmtNoDec(v){
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  /* ============================================
     Render do perfil (dados reais de /auth/me)
     ============================================ */
  function render(data){
    var user = data.user || {};
    var account = data.account || null;
    profile = data;

    var name = user.fullName || '';
    var short = firstPart(name);

    setText('dashGreeting', greetingWord());
    setText('dashName', short || '...');
    setText('dashStatus', 'Um resumo da sua vida financeira.');

    setText('dbvUserName', name || '...');
    setText('dbvUserInitial', short ? short.charAt(0).toUpperCase() : '?');
    setText('dbvUserMenuName', name || '...');
    setText('dbvUserMenuEmail', user.email || '—');
    setText('dbvUserMenuInitial', short ? short.charAt(0).toUpperCase() : '?');

    if(account){
      setText('dashAgency', account.agency || '—');
      setText('dashNumber', account.number || '—');
      var bal = Number(account.balance);
      if(!isNaN(bal)){
        balanceState.value = bal;
        applyBalanceValue();
        setText('dbvSumBal', formatBRL(bal));
      }
    }
  }

  /* ============================================
     Saldo — ocultar/mostrar (somente UX frontend)
     ============================================ */
  function applyBalanceValue(){
    var el = document.getElementById('dashBalance');
    if(!el) return;
    var v = balanceState.value;
    if(v == null || isNaN(v)){
      el.textContent = '—';
      return;
    }
    el.textContent = balanceState.hidden ? 'R$ ••••••' : formatBRL(v);
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  function initBalanceToggle(){
    var btn = document.getElementById('dbvToggleBalance');
    if(!btn) return;
    function sync(){
      var show = !balanceState.hidden;
      btn.setAttribute('aria-label', show ? 'Ocultar saldo' : 'Mostrar saldo');
      btn.setAttribute('title', show ? 'Ocultar saldo' : 'Mostrar saldo');
    }
    sync();
    btn.addEventListener('click', function(){
      balanceState.hidden = !balanceState.hidden;
      btn.setAttribute('aria-pressed', String(balanceState.hidden));
      btn.classList.toggle('is-off', balanceState.hidden);
      sync();
      applyBalanceValue();
    });
  }

  /* ============================================
     Header — menu mobile (botão hambúrguer)
     ============================================ */
  function initHeader(){
    var burger = document.getElementById('dbvBurger');
    var nav = document.getElementById('dbvNav');
    if(!burger || !nav) return;

    function close(returnFocus){
      nav.classList.remove('open');
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      if(returnFocus) burger.focus();
    }

    burger.addEventListener('click', function(){
      var open = nav.classList.toggle('open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
    burger.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && nav.classList.contains('open')) close(true);
    });
    nav.addEventListener('click', function(e){
      if(e.target.closest('a')){
        close(false);
      }
    });
    nav.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && nav.classList.contains('open')) close(true);
    });
  }
  function initStickyHeader(){
    var headerEl = document.querySelector('.dbv-header');
    if(!headerEl) return;
    var tick = null, target = 0, ticks = 0;
    function evaluate(){
      tick = null;
      var p = window.scrollY || document.documentElement.scrollTop;
      var up = p > 18, down = p < 8;
      if(up){
        if(target !== 1){ target = 1; ticks = 0; }
        if(++ticks === 2) headerEl.classList.add('is-scrolled');
      } else if(down){
        if(target !== -1){ target = -1; ticks = 0; }
        if(++ticks === 2) headerEl.classList.remove('is-scrolled');
      } else {
        target = 0;
        ticks = 0;
      }
    }
    window.addEventListener('scroll', function(){
      if(tick === null) tick = requestAnimationFrame(evaluate);
    }, { passive: true });
    evaluate();
  }

  /* ============================================
     Simulador de empréstimo (simulação oficial via API)
     ============================================ */

  function initLoanSimulator(){
    var slider = document.getElementById('dbvLoanSlider');
    var amountEl = document.getElementById('dbvLoanAmount');
    var resultEl = document.getElementById('dbvLoanResult');
    var presetsEl = document.getElementById('dbvLoanPresets');
    var instEl = document.getElementById('dbvLoanInst');
    var barEl = document.getElementById('dbvLoanBar');
    if(!slider) return;

    var state = { amount: 5000, months: 12 };
    var reqSeq = 0;

    function calc(){
      var a = state.amount;
      var m = state.months;
      if(amountEl){
        amountEl.textContent = fmtNoDec(a);
        amountEl.classList.remove('dbv-pulse');
        void amountEl.offsetWidth;
        amountEl.classList.add('dbv-pulse');
      }
      resultEl && resultEl.classList.add('recalc');
      setTimeout(function(){ resultEl && resultEl.classList.remove('recalc'); }, 180);

      var seq = ++reqSeq;
      apiRequest('/loans/simulate',{
        method: 'POST',
        body: JSON.stringify({ amount: a, installments: m }),
      }).then(function(data){
        if(seq !== reqSeq) return;
        setText('dbvLoanPrincipal', fmtNoDec(a));
        setText('dbvLoanJuros', formatBRL(data.interestTotal));
        setText('dbvLoanTotal', formatBRL(data.totalAmount));
        setText('dbvLoanRate', (data.interestRate * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.m.');
        setText('dbvLoanParcelas', data.installments + 'x');
        setText('dbvLoanRateNote', (data.interestRate * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.m.');
        if(resultEl){
          resultEl.innerHTML = data.installments + 'x de <span class="small">' + formatBRL(data.installmentValue) + '</span>';
        }
        if(barEl){
          var pct = Math.max(55, Math.min(96, (a / data.totalAmount) * 100));
          barEl.style.width = pct.toFixed(1) + '%';
        }
      }).catch(function(){
        // mantém o último valor renderizado; erro silencioso nesta etapa
      });
    }

    function syncPresets(){
      var presets = presetsEl ? presetsEl.querySelectorAll('.dbv-loan-preset') : [];
      for(var i = 0; i < presets.length; i++){
        presets[i].classList.toggle('is-active', Number(presets[i].dataset.amount) === state.amount);
      }
    }

    slider.addEventListener('input', function(){
      state.amount = parseFloat(slider.value);
      syncPresets();
      calc();
    });

    if(presetsEl){
      presetsEl.addEventListener('click', function(e){
        var btn = e.target.closest('.dbv-loan-preset');
        if(!btn) return;
        state.amount = Number(btn.dataset.amount);
        slider.value = String(state.amount);
        syncPresets();
        calc();
      });
    }

    if(instEl){
      instEl.addEventListener('click', function(e){
        var btn = e.target.closest('.inst-opt');
        if(!btn) return;
        state.months = Number(btn.dataset.n);
        var opts = instEl.querySelectorAll('.inst-opt');
        for(var i = 0; i < opts.length; i++) opts[i].classList.remove('active');
        btn.classList.add('active');
        calc();
      });
    }

    /* --------------------------------------------
       Solicitação de empréstimo (POST /api/loans)
       Estados: normal | carregando | aprovado |
                erro | duplicada | loan ativo.
       Backend é a autoridade: só enviamos
       amount/installments — nunca taxa ou parcela.
       -------------------------------------------- */
    var cta = document.getElementById('dbvLoanCta');
    var ctaText = document.getElementById('dbvLoanCtaText');
    var statusEl = document.getElementById('dbvLoanStatus');
    var statusTitle = document.getElementById('dbvLoanStatusTitle');
    var statusText = document.getElementById('dbvLoanStatusText');
    var contractBtn = document.getElementById('dbvLoanContract');
    var busy = false;
    var activeLoan = null;
    var installmentsCache = null;

    function enableCta(enabled, label){
      if(cta) cta.disabled = !enabled;
      if(label != null && ctaText) ctaText.textContent = label;
      if(cta){
        if(!enabled && label === 'Enviando…'){
          cta.title = 'Enviando solicitação…';
        } else if(enabled){
          cta.title = 'Solicitar empréstimo';
        }
      }
    }

    /* --------------------------------------------
       Contratação (POST /api/loans/:id/contract)
       Revisão em modal: valores oficiais vindos do
       backend (nunca recalculados) + acessibilidade
       (foco inicial, trap de Tab, Esc, aria-busy).
       -------------------------------------------- */
    var lmModal  = document.getElementById('dbvLoanModal');
    var lmPanel  = document.getElementById('dbvLoanModalPanel');
    var lmClose  = document.getElementById('dbvLoanModalClose');
    var lmCancel = document.getElementById('dbvLmCancel');
    var lmConfirm = document.getElementById('dbvLmConfirm');
    var lmConfirmText = document.getElementById('dbvLmConfirmText');
    var lmError  = document.getElementById('dbvLmError');
    var contractBusy = false;
    var contractTrigger = null;

    /* Estado de uma parcela — fonte: backend (PENDING/OVERDUE/PAID). */
    function instStatus(it){
      if(it.status === 'PAID') return { cls: 'is-paid', label: 'Paga' };
      if(it.status === 'OVERDUE') return { cls: 'is-overdue', label: 'Em atraso' };
      return { cls: 'is-open', label: 'Em aberto' };
    }

    function updateInstCount(items){
      var el = document.getElementById('dbvInstCount');
      if(!el) return;
      var total = items.length;
      var paid = 0;
      for(var i = 0; i < items.length; i++) if(items[i].status === 'PAID') paid++;
      if(total && paid === total){
        el.textContent = 'Todas pagas';
        el.classList.add('is-done');
      } else {
        el.textContent = paid + ' de ' + total + ' pagas';
        el.classList.remove('is-done');
      }
    }

    function hideParcelas(){
      installmentsCache = null;
      var box = document.getElementById('dbvLoanInstBox');
      if(box) box.hidden = true;
    }

    function fmtDateBR(d){
      if(!d) return '—';
      var dt = d instanceof Date ? d : new Date(d);
      if(isNaN(dt.getTime())) return '—';
      return String(dt.getDate()).padStart(2, '0') + '/' +
        String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
    }

    function renderParcelas(list){
      var box   = document.getElementById('dbvLoanInstBox');
      var listEl = document.getElementById('dbvLoanInstList');
      if(!box || !listEl) return;
      var items = (list || []).filter(function(it){ return it && it.number; });
      if(items.length === 0){
        box.hidden = true;
        return;
      }
      installmentsCache = items;
      updateInstCount(items);
      var nextNo = null;
      for(var i = 0; i < items.length; i++){
        if(items[i].status === 'PENDING' || items[i].status === 'OVERDUE'){ nextNo = items[i].number; break; }
      }
      listEl.innerHTML = items.map(function(it){
        var due = it.dueDate ? new Date(it.dueDate) : null;
        var dueStr = due && !isNaN(due.getTime())
          ? String(due.getDate()).padStart(2, '0') + '/' + String(due.getMonth() + 1).padStart(2, '0') + '/' + due.getFullYear()
          : '—';
        var st = instStatus(it);
        var payable = (it.status === 'PENDING' || it.status === 'OVERDUE');
        var highlight = payable && nextNo !== null && Number(it.number) === Number(nextNo);
        var tip = '';
        if(it.status === 'PAID'){
          var paidAt = fmtDateBR(it.paidAt);
          if(paidAt !== '—'){
            tip = ' title="Paga ' + paidAt + (it.paidAmount == null ? '' : ' · ' + formatBRL(it.paidAmount)) + '"';
          }
        }
        var btn = payable
          ? '<button type="button" class="dbv-loan-inst-pay" data-inst-id="' + it.id + '" data-inst-no="' + it.number + '">Pagar parcela</button>'
          : '';
        var paidAtHtml = '';
        if(it.status === 'PAID'){
          var paidTxt = fmtDateBR(it.paidAt);
          if(paidTxt !== '—') paidAtHtml = '<span class="dbv-inst-paid-at">Paga em ' + paidTxt + '</span>';
        }
        return '<li class="dbv-loan-inst-item' + (highlight ? ' is-next' : '') + ' ' + st.cls + '">' +
          '<span class="dbv-loan-inst-n">Parcela ' + it.number + '</span>' +
          '<span class="dbv-loan-inst-due">' + dueStr + '</span>' +
          '<strong class="dbv-loan-inst-amt">' + formatBRL(it.amount) + '</strong>' +
          '<span class="dbv-inst-badge ' + st.cls + '"' + tip + '>' + st.label + '</span>' +
          paidAtHtml +
          btn +
        '</li>';
      }).join('');
      box.hidden = false;
    }

    function fillContractModal(loan){
      var rate = (Number(loan.interestRate) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.m.';
      setText('dbvLmAmount', formatBRL(loan.amount));
      setText('dbvLmInst', loan.installments + 'x');
      setText('dbvLmParcel', formatBRL(loan.installmentValue));
      setText('dbvLmRate', rate);
      setText('dbvLmTotal', formatBRL(loan.totalAmount));
      setText('dbvLmDescAmount', formatBRL(loan.amount));
    }

    function contractFocusables(){
      if(!lmPanel) return [];
      var els = lmPanel.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      var out = [];
      for(var i = 0; i < els.length; i++){
        var el = els[i];
        if(!el.hidden && (el.offsetWidth || el.offsetHeight)) out.push(el);
      }
      return out;
    }

    function openContractReview(){
      if(!activeLoan || activeLoan.status !== 'APPROVED' || !lmModal) return;
      fillContractModal(activeLoan);
      contractTrigger = contractBtn;
      contractBusy = false;
      lmModal.hidden = false;
      lmModal.setAttribute('aria-hidden', 'false');
      lmModal.setAttribute('aria-busy', 'false');
      if(lmError) lmError.hidden = true;
      if(lmConfirm){
        lmConfirm.disabled = false;
        if(lmConfirmText) lmConfirmText.textContent = 'Confirmar contratação';
      }
      if(lmCancel) lmCancel.disabled = false;
      if(lmClose) lmClose.disabled = false;
      document.body.classList.add('dbv-modal-open');
      // foco inicial no botão menos destrutivo (Cancelar)
      if(lmCancel) lmCancel.focus();
    }

    function closeContractReview(){
      if(!lmModal || lmModal.hidden) return;
      lmModal.hidden = true;
      lmModal.setAttribute('aria-hidden', 'true');
      lmModal.removeAttribute('aria-busy');
      contractBusy = false;
      document.body.classList.remove('dbv-modal-open');
      if(contractTrigger && !contractTrigger.disabled) contractTrigger.focus();
      contractTrigger = null;
    }

    function doContract(){
      if(contractBusy || !activeLoan) return;
      if(lmConfirm && lmConfirm.disabled) return;
      contractBusy = true;
      lmModal.setAttribute('aria-busy', 'true');
      if(lmConfirm) lmConfirm.disabled = true;
      if(lmCancel) lmCancel.disabled = true;
      if(lmClose) lmClose.disabled = true;
      if(lmConfirmText) lmConfirmText.textContent = 'Contratando…';
      if(lmError) lmError.hidden = true;

      apiRequest('/loans/' + encodeURIComponent(activeLoan.id) + '/contract', {
        method: 'POST',
      })
        .then(function(data){
          var loan = data && data.loan;
          if(loan){
            activeLoan = loan;
            var inst = (data && data.installments) || [];
            if(inst.length) renderParcelas(inst);
            applyActiveLoan(loan);
          }
          contractBusy = false;
          closeContractReview();
          // Reflete no resto do dashboard: saldo/profile (re-fetch
          // autoritativo — o backend creditou o valor), gráfico e movs.
          loadProfile()
            .then(function(data){
              if(data) render(data);
            })
            .catch(function(err){
              if(err && err.message === 'Sessão expirada.') return;
            })
            .then(function(){
              loadChart();
            });
          if(refreshMovements) refreshMovements();
          // Notificações: o backend criou LOAN_DISBURSED. Refletimos o
          // contador via hook (sem duplicar a listagem).
          if(window.FluxNotifications && window.FluxNotifications.refreshUnread){
            window.FluxNotifications.refreshUnread();
          }
        })
        .catch(function(err){
          contractBusy = false;
          if(lmModal) lmModal.setAttribute('aria-busy', 'false');
          if(lmConfirm) lmConfirm.disabled = false;
          if(lmCancel) lmCancel.disabled = false;
          if(lmClose) lmClose.disabled = false;
          if(lmConfirmText) lmConfirmText.textContent = 'Confirmar contratação';
          if(err && err.status === 409){
            // pode ter sido contratado em outra aba/duplo envio — re-sincroniza
            closeContractReview();
            loadActiveLoan();
            return;
          }
          if(lmError){
            lmError.textContent = err && err.message ? err.message : 'Não foi possível contratar agora. Tente novamente.';
            lmError.hidden = false;
          }
        });
    }

    if(contractBtn){
      contractBtn.addEventListener('click', openContractReview);
    }
    if(lmModal){
      lmModal.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){
          if(contractBusy) return; // não fecha durante a contratação
          e.preventDefault();
          closeContractReview();
          return;
        }
        if(e.key !== 'Tab') return;
        var els = contractFocusables();
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
      var backdrop = lmModal.querySelector('.dbv-modal-backdrop');
      if(backdrop){
        backdrop.addEventListener('click', function(){
          if(!contractBusy) closeContractReview();
        });
      }
    }
    if(lmCancel){
      lmCancel.addEventListener('click', function(){
        if(!contractBusy) closeContractReview();
      });
    }
    if(lmClose){
      lmClose.addEventListener('click', function(){
        if(!contractBusy) closeContractReview();
      });
    }
    if(lmConfirm){
      lmConfirm.addEventListener('click', doContract);
    }

    /* --------------------------------------------
       Pagamento de parcela (POST /loans/:id/installments/:id/pay).
       Modal acessível no padrão da contratação. O backend é a
       autoridade: nunca calculamos valores no frontend.
       -------------------------------------------- */
    var pmModal = document.getElementById('dbvPayModal');
    var pmPanel = document.getElementById('dbvPayModalPanel');
    var pmClose = document.getElementById('dbvPayModalClose');
    var pmCancel = document.getElementById('dbvPayCancel');
    var pmConfirm = document.getElementById('dbvPayConfirm');
    var pmConfirmText = document.getElementById('dbvPayConfirmText');
    var pmError = document.getElementById('dbvPayError');
    var payBusy = false;
    var payTrigger = null;
    var payInst = null;

    function payFocusables(){
      if(!pmPanel) return [];
      var els = pmPanel.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      var out = [];
      for(var i = 0; i < els.length; i++){
        var el = els[i];
        if(!el.hidden && (el.offsetWidth || el.offsetHeight)) out.push(el);
      }
      return out;
    }

    function openPayReview(inst, triggerEl){
      if(!pmModal || !inst || payBusy) return;
      if(!activeLoan || activeLoan.status !== 'CONTRACTED') return;
      payInst = inst;
      payTrigger = triggerEl || null;
      payBusy = false;
      setText('dbvPayInst', 'Parcela ' + inst.number + ' de ' + activeLoan.installments);
      setText('dbvPayDue', fmtDateBR(inst.dueDate));
      setText('dbvPayAmount', formatBRL(inst.amount));
      var bal = balanceState.value;
      setText('dbvPayBalance', (bal == null || isNaN(bal)) ? '—' : formatBRL(bal));
      pmModal.hidden = false;
      pmModal.setAttribute('aria-hidden', 'false');
      pmModal.setAttribute('aria-busy', 'false');
      if(pmError) pmError.hidden = true;
      if(pmConfirm){
        pmConfirm.disabled = false;
        if(pmConfirmText) pmConfirmText.textContent = 'Confirmar pagamento';
      }
      if(pmCancel) pmCancel.disabled = false;
      if(pmClose) pmClose.disabled = false;
      document.body.classList.add('dbv-modal-open');
      if(pmCancel) pmCancel.focus();
    }

    function closePayReview(){
      if(!pmModal || pmModal.hidden) return;
      pmModal.hidden = true;
      pmModal.setAttribute('aria-hidden', 'true');
      pmModal.removeAttribute('aria-busy');
      payBusy = false;
      document.body.classList.remove('dbv-modal-open');
      if(payTrigger && !payTrigger.disabled) payTrigger.focus();
      payTrigger = null;
    }

    /* Pós-pagamento: usa a resposta como sinal inicial e re-lê o detalhe
       (GET /loans/:id) para a lista completa de parcelas e o status real
       do empréstimo. Depois reflete saldo/gráfico/extrato/notificações. */
    function refreshAfterPayment(data){
      var loan = (data && data.loan) || null;
      if(loan && activeLoan && loan.status){
        activeLoan.status = loan.status;
      }
      var reflect = function(inst){
        if(inst && inst.length){ renderParcelas(inst); }
        else { hideParcelas(); }
        if(activeLoan) applyActiveLoan(activeLoan);
        loadProfile()
          .then(function(p){ if(p) render(p); })
          .catch(function(){})
          .then(function(){ loadChart(); });
        if(refreshMovements) refreshMovements();
        if(window.FluxNotifications && window.FluxNotifications.refreshUnread){
          window.FluxNotifications.refreshUnread();
        }
      };
      if(!activeLoan){
        hideParcelas();
        return Promise.resolve();
      }
      return apiRequest('/loans/' + encodeURIComponent(activeLoan.id))
        .then(function(detail){
          var inst = (detail && Array.isArray(detail.installments)) ? detail.installments : [];
          if(detail && detail.status && activeLoan){
            activeLoan.status = detail.status;
          }
          reflect(inst);
          return detail;
        })
        .catch(function(err){
          if(err && err.message === 'Sessão expirada.') return null;
          reflect(null);
          return null;
        });
    }

    function doPay(){
      if(payBusy || !payInst || !activeLoan) return;
      if(pmConfirm && pmConfirm.disabled) return;
      payBusy = true;
      if(pmModal) pmModal.setAttribute('aria-busy', 'true');
      if(pmConfirm) pmConfirm.disabled = true;
      if(pmCancel) pmCancel.disabled = true;
      if(pmClose) pmClose.disabled = true;
      if(pmConfirmText) pmConfirmText.textContent = 'Pagando…';
      if(pmError) pmError.hidden = true;

      apiRequest('/loans/' + encodeURIComponent(activeLoan.id) + '/installments/' + encodeURIComponent(payInst.id) + '/pay', {
        method: 'POST',
      })
        .then(function(data){
          payBusy = false;
          closePayReview();
          return refreshAfterPayment(data);
        })
        .catch(function(err){
          payBusy = false;
          if(pmModal) pmModal.setAttribute('aria-busy', 'false');
          if(pmConfirm) pmConfirm.disabled = false;
          if(pmCancel) pmCancel.disabled = false;
          if(pmClose) pmClose.disabled = false;
          if(pmConfirmText) pmConfirmText.textContent = 'Confirmar pagamento';
          if(err && err.status === 409){
            // pagamento duplicado/fora de estado — re-sincroniza
            closePayReview();
            loadActiveLoan();
            return;
          }
          if(pmError){
            pmError.textContent = err && err.message ? err.message : 'Não foi possível pagar agora. Tente novamente.';
            pmError.hidden = false;
          }
        });
    }

    // Botões "Pagar parcela" (delegação — a lista é reconstruída a cada render).
    (function(){
      var listEl = document.getElementById('dbvLoanInstList');
      if(!listEl) return;
      listEl.addEventListener('click', function(e){
        var btn = e.target && e.target.closest ? e.target.closest('.dbv-loan-inst-pay') : null;
        if(!btn || btn.disabled) return;
        var id = String(btn.getAttribute('data-inst-id'));
        var items = installmentsCache || [];
        var inst = null;
        for(var i = 0; i < items.length; i++){
          if(String(items[i].id) === id){ inst = items[i]; break; }
        }
        if(inst) openPayReview(inst, btn);
      });
    })();

    if(pmModal){
      pmModal.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){
          if(payBusy) return; // não fecha durante o pagamento
          e.preventDefault();
          closePayReview();
          return;
        }
        if(e.key !== 'Tab') return;
        var els = payFocusables();
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
      var backdrop = pmModal.querySelector('.dbv-modal-backdrop');
      if(backdrop){
        backdrop.addEventListener('click', function(){
          if(!payBusy) closePayReview();
        });
      }
    }
    if(pmCancel){
      pmCancel.addEventListener('click', function(){
        if(!payBusy) closePayReview();
      });
    }
    if(pmClose){
      pmClose.addEventListener('click', function(){
        if(!payBusy) closePayReview();
      });
    }
    if(pmConfirm){
      pmConfirm.addEventListener('click', doPay);
    }

    /* Carrega o detalhe (parcelas incl.) de um empréstimo ativo. */
    function loadLoanDetail(loan){
      if(loan.status !== 'CONTRACTED' && loan.status !== 'PAID_OFF'){
        hideParcelas();
        return Promise.resolve(null);
      }
      return apiRequest('/loans/' + encodeURIComponent(loan.id))
        .then(function(data){
          var inst = (data && Array.isArray(data.installments)) ? data.installments : [];
          if(inst && inst.length){ renderParcelas(inst); }
          else { hideParcelas(); }
          return data;
        })
        .catch(function(err){
          if(err && err.message === 'Sessão expirada.') return null;
          hideParcelas();
          return null;
        });
    }

    function showStatus(kind, title, text, showContract, contractEnabled){
      if(!statusEl) return;
      statusEl.classList.remove('is-success', 'is-error', 'is-info');
      statusEl.classList.add('is-' + kind);
      if(statusTitle) statusTitle.textContent = title;
      if(statusText) statusText.textContent = text;
      if(contractBtn){
        contractBtn.hidden = !showContract;
        // contratação só é permitida no estado APPROVED
        contractBtn.disabled = !contractEnabled;
        contractBtn.title = contractEnabled ? 'Revisar e confirmar a contratação' : '';
      }
      statusEl.hidden = false;
    }

    function hideStatus(){
      if(statusEl) statusEl.hidden = true;
    }

    function loanStatusText(loan){
      var rate = (Number(loan.interestRate) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return loan.installments + 'x de ' + formatBRL(loan.installmentValue) +
        ' · total ' + formatBRL(loan.totalAmount) + ' · taxa ' + rate + '% a.m.';
    }

    function applyActiveLoan(loan){
      if(!loan) return;
      activeLoan = loan;
      var canContract = loan.status === 'APPROVED';
      var ctaEnabled = false;
      var kind, title, text, showContract = false, ctaLabel = null;
      switch(loan.status){
        case 'REQUESTED':
        case 'UNDER_REVIEW':
          kind = 'info'; title = 'Solicitação em análise';
          text = loanStatusText(loan);
          ctaLabel = 'Solicitação pendente';
          break;
        case 'APPROVED':
          kind = 'success'; title = 'Empréstimo pré-aprovado';
          text = loanStatusText(loan);
          showContract = true;
          ctaLabel = 'Empréstimo aprovado';
          break;
        case 'CONTRACTED':
          kind = 'success'; title = 'Empréstimo contratado';
          text = loanStatusText(loan);
          showContract = true;
          ctaLabel = 'Empréstimo contratado';
          break;
        case 'PAID_OFF':
          kind = 'success'; title = 'Empréstimo quitado';
          text = 'Todas as parcelas foram pagas. Você já pode solicitar um novo empréstimo.';
          showContract = false;
          ctaEnabled = true;
          ctaLabel = 'Solicitar empréstimo';
          break;
        default:
          activeLoan = null;
          return; // REJECTED: fluxo normal liberado
      }
      enableCta(ctaEnabled, ctaLabel);
      showStatus(kind, title, text, showContract, canContract);
    }

    /* Re-aplica o empréstimo ativo a partir da API e libera o CTA quando
       não houver nada ativo. Usado no boot, 409 da contratação e 409 do
       pagamento. Empréstimos CONTRACTED/PAID_OFF carregam as parcelas do
       backend (GET /loans/:id) — nunca de storage local. */
    function loadActiveLoan(){
      return apiRequest('/loans')
        .then(function(loans){
          var list = (loans && loans.length) ? loans : [];
          var active = null;
          for(var i = 0; i < list.length; i++){
            var st = list[i].status;
            if(st === 'REQUESTED' || st === 'UNDER_REVIEW' || st === 'APPROVED' || st === 'CONTRACTED' || st === 'PAID_OFF'){
              active = list[i]; break;
            }
          }
          if(active){
            applyActiveLoan(active);
            loadLoanDetail(active);
          } else {
            hideStatus();
            hideParcelas();
            enableCta(true, 'Solicitar empréstimo');
          }
          return active;
        })
        .catch(function(err){
          if(err && err.message === 'Sessão expirada.') return null;
        });
    }

    if(cta){
      cta.addEventListener('click', function(){
        if(busy || cta.disabled) return;
        busy = true;
        enableCta(false, 'Enviando…');
        hideStatus();
        apiRequest('/loans', {
          method: 'POST',
          body: JSON.stringify({ amount: state.amount, installments: state.months }),
        })
          .then(function(loan){
            busy = false;
            // V1: solicitação válida já chega aprovada pelo backend.
            applyActiveLoan(loan);
          })
          .catch(function(err){
            busy = false;
            enableCta(true);
            var msg = (err && err.message) || '';
            var duplicated = err && err.status === 400 && /j[áa] possui uma solicita[çc][ãa]o em andamento/i.test(msg);
            if(duplicated){
              showStatus('info', 'Solicitação em andamento', msg, false);
              return;
            }
            showStatus('error', 'Não foi possível solicitar', msg || 'Tente novamente em instantes.', false);
          });
      });
    }

    // Reflete empréstimo ativo (REQUESTED/UNDER_REVIEW/APPROVED/CONTRACTED)
    // ao carregar — não oferece nova solicitação indiscriminadamente.
    loadActiveLoan();

    calc();
  }

  /* ============================================
     Gráfico financeiro — coleta de dados reais
     ============================================ */
  function fetchTransactionsInWindow(days){
    var start = startOfDay(Date.now() - (days - 1) * 86400000);
    var acc = [];
    var page = 1;
    var LIMIT = 50;

    function fetchMore(){
      return apiRequest('/transactions?page=' + page + '&limit=' + LIMIT)
        .then(function(data){
          var items = (data && data.items) || [];
          var meta = (data && data.meta) || {};
          var hasOld = false;
          for(var i = 0; i < items.length; i++){
            var created = new Date(items[i].createdAt);
            if(isNaN(created.getTime()) || created >= start){
              acc.push(items[i]);
            } else {
              hasOld = true;
            }
          }
          if(!hasOld && page < (meta.totalPages || 1)){
            page++;
            return fetchMore();
          }
          return acc;
        });
    }
    return fetchMore();
  }

  function computeSeries(txList, days){
    var start = startOfDay(Date.now() - (days - 1) * 86400000);
    var map = Object.create(null);
    var i;

    for(i = 0; i < txList.length; i++){
      var t = txList[i];
      var d = new Date(t.createdAt);
      if(isNaN(d.getTime())) continue;
      var key = startOfDay(d.getTime()).getTime();
      var b = map[key] || (map[key] = { in: 0, out: 0 });
      var amt = Number(t.amount) || 0;
      if(t.direction === 'IN') b.in += amt;
      else b.out += amt;
    }

    var ins = [];
    var outs = [];
    var bal = new Array(days);
    var daysArr = [];
    var hasData = [];
    var firstTx = -1;

    for(i = 0; i < days; i++){
      var dd = new Date(start.getTime() + i * 86400000);
      daysArr.push(String(dd.getDate()));
      var b = map[dd.getTime()] || { in: 0, out: 0 };
      ins.push(b.in);
      outs.push(b.out);
      hasData.push(!!(b.in || b.out));
      if(b.in || b.out) firstTx = firstTx === -1 ? i : firstTx;
    }

    var totalIn = 0;
    var totalOut = 0;
    for(i = 0; i < days; i++){
      totalIn += ins[i];
      totalOut += outs[i];
    }

    var balance = profile && profile.account ? Number(profile.account.balance) : NaN;
    if(!isNaN(balance)){
      bal[days - 1] = balance;
      for(var k = days - 2; k >= 0; k--){
        bal[k] = bal[k + 1] - (ins[k + 1] - outs[k + 1]);
      }
    }

    return {
      days: daysArr,
      ins: ins,
      outs: outs,
      bal: bal,
      firstTx: firstTx,
      hasData: hasData,
      hasAny: firstTx !== -1,
      totalIn: totalIn,
      totalOut: totalOut,
    };
  }

  function setChartState(mode, msg){
    var loading = document.getElementById('dbvChartLoading');
    var empty = document.getElementById('dbvChartEmpty');
    var error = document.getElementById('dbvChartError');
    var errorText = document.getElementById('dbvChartErrorText');
    var svg = document.getElementById('dbvChart');

    if(loading) loading.classList.toggle('show', mode === 'loading');
    if(empty) empty.classList.toggle('show', mode === 'empty');
    if(error) error.classList.toggle('show', mode === 'error');
    if(svg) svg.hidden = mode !== 'chart';
    if(errorText && msg) errorText.textContent = msg;
  }

  function drawChart(res){
    var svg = document.getElementById('dbvChart');
    if(!svg) return;

    var W = 640, H = 250, padL = 40, padR = 16, padT = 18, padB = 30;
    var n = res.days.length;
    var iw = W - padL - padR;
    var ih = H - padT - padB;

    var maxVal = 1;
    for(var m = 0; m < n; m++){
      maxVal = Math.max(maxVal, res.ins[m], res.outs[m]);
    }
    maxVal = maxVal * 1.18;

    function xFor(i){
      return padL + i * (iw / (n - 1));
    }
    function yFor(v){
      return H - padB - (v / maxVal) * ih;
    }
    function line(pts){
      var acc = [];
      for(var i = 0; i < pts.length; i++){
        acc.push((i === 0 ? 'M' : 'L') + xFor(i).toFixed(2) + ',' + yFor(pts[i]).toFixed(2));
      }
      return acc.join(' ');
    }
    function area(pts){
      return line(pts) + ' L' + xFor(pts.length - 1).toFixed(2) + ',' + (H - padB) + ' L' + xFor(0).toFixed(2) + ',' + (H - padB) + ' Z';
    }

    var out = '';
    out += '<defs>' +
      '<linearGradient id="dbvGradIn" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#3ddc84" stop-opacity="0.22"/>' +
        '<stop offset="100%" stop-color="#3ddc84" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="dbvGradOut" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#ff5c7a" stop-opacity="0.20"/>' +
        '<stop offset="100%" stop-color="#ff5c7a" stop-opacity="0"/>' +
      '</linearGradient>' +
    '</defs>';

    for(var g = 0; g < 4; g++){
      var gy = padT + g * (ih / 3);
      out += '<line class="base" x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '"/>';
    }

    out += '<path class="dbv-area" d="' + area(res.ins) + '" fill="url(#dbvGradIn)"/>';
    out += '<path class="dbv-area" d="' + area(res.outs) + '" fill="url(#dbvGradOut)"/>';
    out += '<path class="dbv-line is-in" d="' + line(res.ins) + '"/>';
    out += '<path class="dbv-line is-out" d="' + line(res.outs) + '"/>';

    if(res.firstTx > -1 && res.bal && !isNaN(res.bal[res.firstTx])){
      var balPts = [];
      for(var b = res.firstTx; b < n; b++){
        balPts.push({ x: xFor(b), y: yFor(Math.max(res.bal[b], 0)) });
      }
      if(balPts.length > 1){
        var db = 'M' + balPts[0].x.toFixed(2) + ',' + balPts[0].y.toFixed(2);
        for(var bb = 1; bb < balPts.length; bb++){
          db += ' L' + balPts[bb].x.toFixed(2) + ',' + balPts[bb].y.toFixed(2);
        }
        out += '<path class="dbv-line is-bal" d="' + db + '"/>';
      }
    }

    for(var i = 0; i < n; i++){
      out += '<circle class="dbv-dot is-in" cx="' + xFor(i).toFixed(2) + '" cy="' + yFor(res.ins[i]).toFixed(2) + '" r="3"/>';
      out += '<circle class="dbv-dot is-out" cx="' + xFor(i).toFixed(2) + '" cy="' + yFor(res.outs[i]).toFixed(2) + '" r="3"/>';
    }

    var labelIdx = [];
    if(n <= 8){
      for(i = 0; i < n; i++) labelIdx.push(i);
    } else {
      for(i = 0; i < 6; i++){
        var li = Math.round(i * ((n - 1) / 5));
        if(labelIdx.indexOf(li) === -1) labelIdx.push(li);
      }
    }
    for(i = 0; i < labelIdx.length; i++){
      var li2 = labelIdx[i];
      out += '<text class="dbv-lab" x="' + xFor(li2).toFixed(2) + '" y="' + (H - padB + 20) + '" text-anchor="middle">' + res.days[li2] + '</text>';
    }

    svg.innerHTML = out;
    svg.hidden = false;

    var lines = svg.querySelectorAll('path.dbv-line');
    for(var li3 = 0; li3 < lines.length; li3++){
      var len = lines[li3].getTotalLength() || 1;
      lines[li3].style.strokeDasharray = len;
      lines[li3].style.strokeDashoffset = reducedMotion ? 0 : len;
    }
    requestAnimationFrame(function(){
      svg.classList.add('drawn');
      if(!reducedMotion){
        for(var li4 = 0; li4 < lines.length; li4++){
          lines[li4].style.strokeDashoffset = '0';
        }
      }
    });
  }

  function showTooltip(i){
    var tip = document.getElementById('dbvTooltip');
    var wrap = document.getElementById('dbvChartWrap');
    if(!tip || !wrap || !chartContext) return;
    var res = chartContext;
    var n = res.days.length;
    i = Math.max(0, Math.min(n - 1, i));
    tooltipIdx = i;

    // Sem dado real neste ponto não fabricamos R$ 0,00: não abrimos o tooltip.
    if(!res.hasData || !res.hasData[i]){
      hideTooltip();
      return;
    }

    var date = new Date();
    date.setDate(date.getDate() - (n - 1 - i));
    var dayLabel = String(date.getDate()).padStart(2, '0');
    var monthLabel = date.toLocaleDateString('pt-BR', { month: 'short' });
    var hasBal = i >= res.firstTx && res.bal && !isNaN(res.bal[i]);

    tip.innerHTML =
      '<div class="tp-date">' + dayLabel + ' ' + monthLabel + '</div>' +
      '<div class="tp-row"><i class="tp-in"></i><span>Entradas</span><span>' + formatBRL(res.ins[i]) + '</span></div>' +
      '<div class="tp-row"><i class="tp-out"></i><span>Saídas</span><span>' + formatBRL(res.outs[i]) + '</span></div>' +
      '<div class="tp-row"><i class="tp-bal"></i><span>Saldo final</span><span>' + (hasBal ? formatBRL(res.bal[i]) : '—') + '</span></div>';

    var pct = n > 1 ? (i / (n - 1)) * 100 : 50;
    pct = Math.max(7, Math.min(93, pct));
    tip.style.left = pct + '%';
    tip.hidden = false;
    wrap.setAttribute('aria-describedby', tip.id);
    requestAnimationFrame(function(){ tip.classList.add('show'); });
  }

  function hideTooltip(){
    var tip = document.getElementById('dbvTooltip');
    if(!tip) return;
    tooltipIdx = -1;
    tip.classList.remove('show');
    tip.hidden = true;
    var wrap = document.getElementById('dbvChartWrap');
    if(wrap) wrap.removeAttribute('aria-describedby');
  }

  function setSummary(res){
    setText('dbvSumIn', formatBRL(res.totalIn));
    setText('dbvSumOut', formatBRL(res.totalOut));
  }

  function loadChart(){
    setChartState('loading');
    hideTooltip();
    return fetchTransactionsInWindow(chartDays)
      .then(function(tx){
        var res = computeSeries(tx, chartDays);
        chartContext = res;
        setSummary(res);
        var panel = document.getElementById('dbvChartWrap');
        if(panel) panel.setAttribute('aria-label', 'Gráfico com ' + chartDays + ' dias de movimentações');
        if(!res.hasAny){
          setChartState('empty');
          return;
        }
        drawChart(res);
        setChartState('chart');
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setChartState('error', err && err.message ? err.message : 'Não foi possível carregar o gráfico.');
      });
  }

  function initChartPanel(){
    var tabs = document.getElementById('dbvChartTabs');
    var tabBtns = tabs ? tabs.querySelectorAll('[role="tab"]') : [];
    var wrap = document.getElementById('dbvChartWrap');
    var retry = document.getElementById('dbvChartRetry');

    function activate(index){
      for(var j = 0; j < tabBtns.length; j++){
        var on = j === index;
        tabBtns[j].classList.toggle('is-active', on);
        tabBtns[j].setAttribute('aria-selected', on ? 'true' : 'false');
        tabBtns[j].setAttribute('tabindex', on ? '0' : '-1');
      }
      if(wrap && tabBtns[index]) wrap.setAttribute('aria-labelledby', tabBtns[index].id);
      var chart = document.getElementById('dbvChart');
      if(chart){
        chart.setAttribute('aria-label', 'Gráfico de entradas e saídas nos últimos ' + chartDays + ' dias');
      }
    }

    for(var i = 0; i < tabBtns.length; i++){
      tabBtns[i].addEventListener('click', function(){
        var index = Array.prototype.indexOf.call(tabBtns, this);
        if(this.getAttribute('aria-selected') === 'true') return;
        chartDays = parseInt(this.dataset.days, 10);
        activate(index);
        loadChart();
      });
      tabBtns[i].addEventListener('keydown', function(e){
        var current = Array.prototype.indexOf.call(tabBtns, this);
        var next = -1;
        if(e.key === 'ArrowRight') next = (current + 1) % tabBtns.length;
        else if(e.key === 'ArrowLeft') next = (current - 1 + tabBtns.length) % tabBtns.length;
        else if(e.key === 'Home') next = 0;
        else if(e.key === 'End') next = tabBtns.length - 1;
        if(next >= 0){
          e.preventDefault();
          chartDays = parseInt(tabBtns[next].dataset.days, 10);
          activate(next);
          tabBtns[next].focus();
          loadChart();
        }
      });
    }
    if(retry){
      retry.addEventListener('click', function(){ loadChart(); });
    }
    if(wrap){
      wrap.addEventListener('mousemove', function(e){
        if(!chartContext) return;
        var rect = wrap.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var ratio = rect.width > 0 ? x / rect.width : 0;
        var idx = Math.round(ratio * (chartContext.days.length - 1));
        showTooltip(idx);
      });
      wrap.addEventListener('mouseleave', function(){
        hideTooltip();
      });
      wrap.addEventListener('click', function(e){
        if(!chartContext) return;
        var rect = wrap.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var ratio = rect.width > 0 ? x / rect.width : 0;
        showTooltip(Math.round(ratio * (chartContext.days.length - 1)));
      });
      wrap.addEventListener('keydown', function(e){
        if(!chartContext) return;
        var n = chartContext.days.length;
        if(n === 0) return;
        var idx = tooltipIdx >= 0 ? tooltipIdx : (n - 1);
        if(e.key === 'ArrowRight'){ e.preventDefault(); showTooltip(idx + 1); }
        else if(e.key === 'ArrowLeft'){ e.preventDefault(); showTooltip(idx - 1); }
        else if(e.key === 'Home'){ e.preventDefault(); showTooltip(0); }
        else if(e.key === 'End'){ e.preventDefault(); showTooltip(n - 1); }
        else if(e.key === 'Escape' || e.key === 'Enter'){ hideTooltip(); }
      });
    }
  }

  /* ============================================
     Movimentações — lista paginada (dados reais)
     ============================================ */
  function itemHtml(t){
    var incoming = t.direction === 'IN';
    var title = t.counterpartyName || (incoming ? 'PIX recebido' : 'PIX enviado');
    var subParts = [];
    if(t.description) subParts.push(t.description);
    if(t.counterpartyNumber) subParts.push('Conta ' + t.counterpartyNumber);
    var when = formatDateTime(t.createdAt);

    return '' +
      '<li class="stmt-item">' +
        '<div class="stmt-ic ' + (incoming ? 'stmt-ic-in' : 'stmt-ic-out') + '">' +
          (incoming
            ? '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>') +
        '</div>' +
        '<div class="stmt-body">' +
          '<div class="stmt-title">' + es(title) +
            '<span class="stmt-tag">PIX</span>' +
          '</div>' +
          '<div class="stmt-sub">' + es(subParts.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="stmt-side">' +
          '<div class="stmt-amount ' + (incoming ? 'stmt-in' : 'stmt-out') + '">' +
            (incoming ? '+ ' : '- ') + formatBRL(t.amount) +
          '</div>' +
          (when ? '<div class="stmt-date">' + when + '</div>' : '') +
        '</div>' +
      '</li>';
  }

  function createTransactionsView(scope){
    var pager = { page: 1, limit: scope.limit || 10, totalPages: 1 };

    function setState(mode){
      if(scope.loading) scope.loading.classList.toggle('show', mode === 'loading');
      if(scope.empty) scope.empty.classList.toggle('show', mode === 'empty');
      if(scope.error) scope.error.classList.toggle('show', mode === 'error');
      if(scope.list) scope.list.classList.toggle('show', mode === 'list');
      if(scope.pager) scope.pager.hidden = mode !== 'list';
    }

    function load(page){
      if(page == null) page = pager.page;
      if(page < 1) page = 1;
      pager.page = page;
      setState('loading');

      return apiRequest('/transactions?page=' + page + '&limit=' + pager.limit)
        .then(function(data){
          var items = (data && data.items) || [];
          var meta = (data && data.meta) || {};
          pager.totalPages = meta.totalPages || 1;

          if(scope.countEl){
            scope.countEl.textContent = meta.total > pager.limit ? '(' + meta.total + ')' : '';
          }

          if(items.length === 0){
            setState('empty');
            return data;
          }

          scope.list.innerHTML = items.map(itemHtml).join('');
          if(scope.pageInfo){
            scope.pageInfo.textContent = 'Página ' + pager.page + ' de ' + pager.totalPages;
          }
          if(scope.prev) scope.prev.disabled = pager.page <= 1;
          if(scope.next) scope.next.disabled = pager.page >= pager.totalPages;
          setState('list');
          return data;
        })
        .catch(function(err){
          if(scope.errorText){
            scope.errorText.textContent = err && err.message
              ? err.message
              : 'Não foi possível carregar as movimentações.';
          }
          setState('error');
        });
    }

    if(scope.prev){
      scope.prev.addEventListener('click', function(){
        if(pager.page > 1) load(pager.page - 1);
      });
    }
    if(scope.next){
      scope.next.addEventListener('click', function(){
        if(pager.page < pager.totalPages) load(pager.page + 1);
      });
    }
    if(scope.retry){
      scope.retry.addEventListener('click', function(){
        load(pager.page);
      });
    }

    return load;
  }

  function initMovements(){
    var recentLoad = createTransactionsView({
      list: document.getElementById('dbvRecentList'),
      loading: document.getElementById('dbvRecentLoading'),
      empty: document.getElementById('dbvRecentEmpty'),
      error: document.getElementById('dbvRecentError'),
      errorText: document.getElementById('dbvRecentErrorText'),
      retry: document.getElementById('dbvRecentRetry'),
      countEl: document.getElementById('dbvSeeAllCount'),
      limit: 5,
    });
    refreshMovements = recentLoad;

    var allLoad = createTransactionsView({
      list: document.getElementById('dbvAllList'),
      loading: document.getElementById('dbvAllLoading'),
      empty: document.getElementById('dbvAllEmpty'),
      error: document.getElementById('dbvAllError'),
      errorText: document.getElementById('dbvAllErrorText'),
      retry: document.getElementById('dbvAllRetry'),
      pager: document.getElementById('dbvAllPager'),
      pageInfo: document.getElementById('dbvAllPageInfo'),
      prev: document.getElementById('dbvAllPrev'),
      next: document.getElementById('dbvAllNext'),
      limit: 10,
    });

    var recentView = document.getElementById('dbvRecentView');
    var panel = document.getElementById('dbvAllPanel');
    var seeAll = document.getElementById('dbvSeeAll');
    var seeAllLabel = document.getElementById('dbvSeeAllLabel');
    var seeAllCount = document.getElementById('dbvSeeAllCount');
    var expanded = false;

    function setExpanded(on){
      expanded = on;
      if(recentView) recentView.hidden = on;
      if(panel) panel.hidden = !on;
      if(seeAll) seeAll.setAttribute('aria-expanded', String(on));
      if(seeAllLabel) seeAllLabel.textContent = on ? 'Mostrar menos' : 'Ver todas';
      // o contador "(N)" só faz sentido no estado compacto
      if(seeAllCount) seeAllCount.hidden = on;
    }

    function openAll(){
      if(expanded) return;
      if(!allLoaded){
        allLoaded = true;
        allLoad(1);
      }
      setExpanded(true);
      if(panel){
        if(!reducedMotion && panel.scrollIntoView){
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        panel.focus({ preventScroll: true });
      }
    }
    function closeAll(){
      if(!expanded) return;
      setExpanded(false);
      // devolve o foco ao disparador ("Ver todas")
      if(seeAll) seeAll.focus();
    }

    if(seeAll){
      seeAll.addEventListener('click', function(){
        if(expanded) closeAll();
        else openAll();
      });
      seeAll.addEventListener('keydown', function(e){
        if(e.key === 'Escape' && expanded) closeAll();
      });
    }
    if(panel){
      panel.addEventListener('keydown', function(e){
        if(e.key === 'Escape' && expanded) closeAll();
      });
    }

    recentLoad(1);
  }

  /* ============================================
     Flux Neural — fundo em 3 camadas
     Gera 1x o SVG de linhas de fluxo (sem canvas,
     sem loop) e liga reações leves às áreas-chave.
     ============================================ */
  function initNeural(){
    var flow = document.getElementById('dbvNFlow');
    if(!flow) return;

    // rotas orgânicas em coordenadas normalizadas (0..1)
    var routes = [
      [[0.04,0.16],[0.24,0.30],[0.46,0.18],[0.66,0.40],[0.88,0.26],[1.00,0.34]],
      [[0.08,0.58],[0.34,0.64],[0.56,0.48],[0.78,0.66],[0.96,0.50]],
      [[0.14,0.92],[0.30,0.74],[0.50,0.82],[0.70,0.68],[0.94,0.86]],
      [[-0.04,0.36],[0.18,0.22],[0.40,0.48],[0.60,0.26],[0.88,0.46]],
      [[0.52,1.06],[0.58,0.80],[0.70,0.60],[0.80,0.38],[1.02,0.20]],
      [[0.02,0.74],[0.18,0.48],[0.36,0.62],[0.58,0.30],[0.82,0.16]],
    ];
    // mobile: menos linhas, montagem mais leve
    var compact = window.innerWidth < 760;
    if(compact) routes = routes.slice(0, 3);

    function pt(r, i, dim){
      return dim === 0 ? (r[i][0] * 1000).toFixed(1) : (r[i][1] * 600).toFixed(1);
    }
    function pathD(r){
      var d = 'M' + pt(r, 0, 0) + ' ' + pt(r, 0, 1);
      for(var i = 0; i < r.length - 1; i++){
        var pm = r[i - 1] || r[i];
        var p0 = r[i];
        var p1 = r[i + 1];
        var pn = r[i + 2] || p1;
        var c1x = (p0[0] * 1000) + ((p1[0] - pm[0]) / 6) * 1000;
        var c1y = (p0[1] * 600) + ((p1[1] - pm[1]) / 6) * 600;
        var c2x = (p1[0] * 1000) - ((pn[0] - p0[0]) / 6) * 1000;
        var c2y = (p1[1] * 600) - ((pn[1] - p0[1]) / 6) * 600;
        d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + pt(r, i + 1, 0) + ' ' + pt(r, i + 1, 1);
      }
      return d;
    }

    var svg =
      '<svg viewBox="0 0 1000 600" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
    for(var ri = 0; ri < routes.length; ri++){
      var d = pathD(routes[ri]);
      svg += '<path class="dbv-n-line" d="' + d + '"/>';
      svg += '<path class="dbv-n-dash" d="' + d + '" style="animation-delay:-' + (ri * 5) + 's"/>';
    }
    if(!compact){
      // pontos discretos como "dados" ancorados a nós das rotas
      var dots = [[0.24,0.30],[0.56,0.48],[0.18,0.22],[0.58,0.62],[0.40,0.48]];
      for(var di = 0; di < dots.length; di++){
        svg += '<circle class="dbv-n-dot" cx="' + pt(dots, di, 0) + '" cy="' + (dots[di][1] * 600).toFixed(1) + '" r="1.6"/>';
      }
    }
    svg += '</svg>';
    flow.innerHTML = svg;

    if(reducedMotion) return;

    // reações: pulso curto de glow/fluxo em áreas-chave
    function bind(selector, className){
      var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if(!el) return;
      el.addEventListener('mouseenter', function(){ setReact(className, true); });
      el.addEventListener('mouseleave', function(){ setReact(className, false); });
      el.addEventListener('focusin', function(){ setReact(className, true); });
      el.addEventListener('focusout', function(){ setReact(className, false); });
    }
    function setReact(className, on){
      document.body.classList.toggle(className, on);
    }
    bind('#dbvBalance', 'dbv-react-balance');
    bind('a[href="pix.html"]', 'dbv-react-pix');
    bind('#visao', 'dbv-react-visao');
    bind('a[href="cartao.html"]', 'dbv-react-cartao');
  }

  /* ============================================
     Menu do usuário (dropdown Configurações / Sair)
     Teclado: Esc, setas/Home/End, foco inicial no 1º
     item; clique fora/backdrop e foco externo fecham.
     ============================================ */
  function initUserMenu(){
    var wrap = document.getElementById('dbvUserMenu');
    var btn = document.getElementById('dbvUserMenuBtn');
    var panel = document.getElementById('dbvUserMenuPanel');
    var backdrop = document.getElementById('dbvUserMenuBackdrop');
    if(!btn || !panel || !wrap) return;

    var open = false;

    function items(){
      return panel.querySelectorAll('[role="menuitem"]');
    }
    function focusItem(idx){
      var all = items();
      if(all.length === 0) return;
      if(idx < 0) idx = all.length - 1;
      if(idx >= all.length) idx = 0;
      all[idx].focus();
    }
    function setOpen(on, focusFirst){
      open = on;
      panel.hidden = !on;
      if(backdrop) backdrop.hidden = !on;
      btn.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', String(on));
      if(on && focusFirst) focusItem(0);
    }
    function close(returnFocus){
      if(!open) return;
      setOpen(false, false);
      if(returnFocus) btn.focus();
    }

    btn.addEventListener('click', function(){
      if(open) close(true);
      else setOpen(true, true);
    });
    btn.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && open) close(true);
      else if(e.key === 'ArrowDown' && open){
        e.preventDefault();
        focusItem(0);
      }
    });
    panel.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        e.preventDefault();
        close(true);
        return;
      }
      var all = items();
      if(all.length === 0) return;
      var cur = Array.prototype.indexOf.call(all, document.activeElement);
      var next = -1;
      if(e.key === 'ArrowDown') next = cur + 1;
      else if(e.key === 'ArrowUp') next = cur - 1;
      else if(e.key === 'Home') next = 0;
      else if(e.key === 'End') next = all.length - 1;
      if(next !== -1){
        e.preventDefault();
        focusItem(next);
      }
    });
    if(backdrop){
      backdrop.addEventListener('click', function(){
        close(true);
      });
    }
    // perdeu o foco para fora do menu -> fecha
    document.addEventListener('focusin', function(e){
      if(open && !wrap.contains(e.target)) close(false);
    });
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

    initHeader();
    initStickyHeader();
    initBalanceToggle();
    initLoanSimulator();
    initChartPanel();
    initMovements();
    initUserMenu();
    initNeural();

    loadProfile()
      .then(function(data){
        if(data) render(data);
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('dashStatus', err && err.message ? err.message : 'Não foi possível carregar seus dados.');
      })
      .then(function(){
        loadChart();
      });
  });
})();