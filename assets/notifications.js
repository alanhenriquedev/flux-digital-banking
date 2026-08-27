/* ============================================
   FLUX — Sino e dropdown de notificações
   Usado em dashboard_1.html (item 4).
   Endpoints (definidos no api.js):
   - GET  /notifications/unread-count
   - GET  /notifications?page=1&limit=10
   - POST /notifications/:id/read
   Regras:
   - contador no carregamento; atualiza a cada 30s;
     atualiza em focus/visibilitychange.
   - badge oculto em 0; "99+" acima de 99.
   - dropdown: até 10 itens, loading/vazio/erro+retry.
   - clique marca como lida; contador atualiza.
   - Esc/backdrop fecham; foco volta ao sino.
   - deep-link por entityType: transaction -> extrato;
     card/card_purchase/invoice -> cartão.
   - acessibilidade: aria-expanded, label dinâmico,
     teclado (setas, Home/End, Enter, Esc, Tab) e foco.
   ============================================ */
(function(){
  'use strict';

  var STATS_MS = 30000;          // atualização do contador
  var BADGE_OVERFLOW = 99;       // limite do badge "99+"
  var LIST_PAGE = 1;
  var LIST_LIMIT = 10;

  var bellRoot   = document.getElementById('dbvNotificationsRoot');
  if(!bellRoot) return;

  var bellBtn     = document.getElementById('dbvBellBtn');
  var bellBadge   = document.getElementById('dbvBellBadge');
  var headCount   = document.getElementById('dbvBellHeadCount');
  var panel       = document.getElementById('dbvBellPanel');
  var backdrop    = document.getElementById('dbvBellBackdrop');
  var listEl      = document.getElementById('dbvBellList');
  var stateLoad   = document.getElementById('dbvBellLoading');
  var stateEmpty  = document.getElementById('dbvBellEmpty');
  var stateError  = document.getElementById('dbvBellError');
  var errorText   = document.getElementById('dbvBellErrorText');
  var retryBtn    = document.getElementById('dbvBellRetry');
  var seeAllBtn   = document.getElementById('dbvBellSeeAll');

  var open = false;            // dropdown aberto?
  var itemsById = Object.create(null); // mapa id -> notificação (clique/foco)
  var lastUnread = 0;          // último contador conhecido
  var statTimer = null;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================
     Contador (badge)
     ============================================ */
  function applyUnread(count){
    count = Number(count) || 0;
    lastUnread = count;
    var label = count > 0
      ? 'Notificações — ' + count + ' não ' + (count === 1 ? 'lida' : 'lidas')
      : 'Notificações — nenhuma não lida';
    bellBtn.setAttribute('aria-label', label);
    bellBtn.setAttribute('title', count > 0
      ? 'Notificações (' + count + ' não ' + (count === 1 ? 'lida' : 'lidas') + ')'
      : 'Notificações');

    if(count === 0){
      bellBadge.hidden = true;
      bellBadge.textContent = '0';
    } else {
      bellBadge.textContent = count > BADGE_OVERFLOW ? '99+' : String(count);
      bellBadge.hidden = false;
    }
    if(headCount){
      headCount.textContent = count > BADGE_OVERFLOW ? '99+' : String(count);
      headCount.hidden = count === 0;
    }
  }

  function refreshUnread(){
    return loadUnreadCount()
      .then(function(data){
        if(data && typeof data.unread === 'number'){
          applyUnread(data.unread);
        }
        return data;
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return null;
        // falha silenciosa: mantém o último contador válido
        return null;
      });
  }

  /* ============================================
     Lista — estados loading / empty / error / list
     ============================================ */
  function showState(mode){
    if(stateLoad)   stateLoad.classList.toggle('show', mode === 'loading');
    if(stateEmpty)  stateEmpty.classList.toggle('show', mode === 'empty');
    if(stateError)  stateError.classList.toggle('show', mode === 'error');
    if(listEl)      listEl.classList.toggle('show', mode === 'list');
    var footEl = document.querySelector('.dbv-bell-foot');
    if(footEl) footEl.hidden = mode !== 'list';
  }

  function renderEmpty(){
    if(listEl) listEl.innerHTML = '';
    showState('empty');
    if(open && stateEmpty && !reducedMotion){
      stateEmpty.focus({ preventScroll: true });
    }
  }

  function renderError(err){
    if(listEl) listEl.innerHTML = '';
    if(errorText){
      errorText.textContent = err && err.message
        ? err.message
        : 'Não foi possível carregar as notificações.';
    }
    showState('error');
    // leva o foco ao estado de erro (acessível) quando o painel está aberto
    if(open && stateError && !reducedMotion){
      stateError.focus({ preventScroll: true });
    }
  }

  /* ============================================
     Render dos itens
     ============================================ */
  function tagFor(n){
    switch(n.type){
      case 'PIX_IN':  return 'PIX';
      case 'PIX_OUT': return 'PIX';
      case 'CARD_PURCHASE':  return 'Cartão';
      case 'CARD_BLOCKED':   return 'Cartão';
      case 'CARD_UNBLOCKED': return 'Cartão';
      case 'INVOICE_PAID':   return 'Fatura';
      case 'AUTH_LOGIN':     return 'Acesso';
      default: return '';
    }
  }

  function iconClassFor(type){
    switch(type){
      case 'PIX_IN':           return 'dbv-bell-ic-in';
      case 'PIX_OUT':          return 'dbv-bell-ic-out';
      case 'CARD_PURCHASE':    return 'dbv-bell-ic-card';
      case 'CARD_BLOCKED':     return 'dbv-bell-ic-warn';
      case 'CARD_UNBLOCKED':   return 'dbv-bell-ic-out';
      case 'INVOICE_PAID':     return 'dbv-bell-ic-in';
      case 'AUTH_LOGIN':       return 'dbv-bell-ic-auth';
      default:                 return 'dbv-bell-ic-bell';
    }
  }

  function svgFor(type){
    switch(type){
      case 'PIX_IN':
        return '<svg viewBox="0 0 24 24"><path d="M12 3v13M7 11l5 5 5-5M5 21h14"/></svg>';
      case 'PIX_OUT':
        return '<svg viewBox="0 0 24 24"><path d="M12 21V8M7 13l5-5 5 5M5 3h14"/></svg>';
      case 'CARD_PURCHASE':
        return '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="2.4"/><path d="M2.5 10h19M7 14.5h4"/></svg>';
      case 'CARD_BLOCKED':
        return '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
      case 'CARD_UNBLOCKED':
        return '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 7.5-1.4"/></svg>';
      case 'INVOICE_PAID':
        return '<svg viewBox="0 0 24 24"><path d="M6.5 3h11v18l-2-1.2-1.5 1.2L12 21l-2 1.2-1.5-1.2L6.5 21z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/></svg>';
      case 'AUTH_LOGIN':
        return '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M9 8l-4 4 4 4M5 12h9"/></svg>';
      default:
        return '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/></svg>';
    }
  }

  function itemHtml(n){
    var tag    = tagFor(n);
    var ic     = iconClassFor(n.type);
    var svg    = svgFor(n.type);
    var title  = String(n.title || '');
    var subPart = String(n.message || '');
    var amount = (n.amount != null && !isNaN(Number(n.amount)))
      ? '<span class="dbv-bell-amount">' + es(formatBRL(n.amount)) + '</span>'
      : '';
    var read = !!n.readAt;
    var when = formatDateTime(n.createdAt);

    return '' +
      '<li class="dbv-bell-item' + (read ? ' is-read' : '') + '" role="menuitem" ' +
        'data-id="' + es(n.id) + '" tabindex="-1">' +
        '<span class="dbv-bell-ic ' + ic + '" aria-hidden="true">' + svg + '</span>' +
        '<span class="dbv-bell-body">' +
          '<span class="dbv-bell-title">' + es(title) + '</span>' +
          (tag ? '<span class="dbv-bell-tag">' + es(tag) + '</span>' : '') +
          (subPart ? '<span class="dbv-bell-sub">' + es(subPart) + '</span>' : '') +
          '<span class="dbv-bell-meta">' +
            (when ? '<span class="dbv-bell-date">' + es(when) + '</span>' : '') +
            (amount ? amount : '') +
          '</span>' +
        '</span>' +
        '<span class="dbv-bell-dot-wrap" aria-hidden="true">' +
          '<span class="dbv-bell-dot' + (read ? ' is-read' : '') + '"></span>' +
        '</span>' +
      '</li>';
  }

  function renderList(result){
    var data = (result && result.items) ? result.items : [];
    itemsById = Object.create(null);
    if(data.length === 0){
      renderEmpty();
      return;
    }
    for(var i = 0; i < data.length; i++){
      itemsById[data[i].id] = data[i];
    }
    listEl.innerHTML = data.map(itemHtml).join('');
    showState('list');
    handleFocusAfterRender();
  }

  function loadList(){
    showState('loading');
    if(listEl) listEl.innerHTML = '';
    return listNotifications(LIST_PAGE, LIST_LIMIT)
      .then(renderList)
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return null;
        renderError(err);
        return null;
      });
  }

  /* ============================================
     Marcar como lida
     ============================================ */
  function goDeepLink(n){
    if(!n) return;
    if(n.entityType === 'transaction'){
      window.location.href = 'extrato.html';
    } else if(n.entityType === 'card' || n.entityType === 'card_purchase' || n.entityType === 'invoice'){
      window.location.href = 'cartao.html';
    }
  }

  function markReadAndFollow(li, n){
    if(!n) return;
    if(!n.readAt){
      markNotificationRead(n.id)
        .then(function(){
          refreshUnread();
          n.readAt = new Date().toISOString();
          li.classList.add('is-read');
          var dot = li.querySelector('.dbv-bell-dot');
          if(dot) dot.classList.add('is-read');
        })
        .catch(function(err){
          if(err && err.message === 'Sessão expirada.') return;
          // mantém o estado; usuário pode tentar de novo
        });
    }
    goDeepLink(n);
  }

  /* ============================================
     Abrir / fechar
     ============================================ */
  function openPanel(){
    if(open) return;
    open = true;
    backdrop.hidden = false;
    panel.hidden = false;
    bellBtn.classList.add('is-open');
    bellBtn.setAttribute('aria-expanded', 'true');
    // recarrega a lista sempre que abre (dados frescos)
    loadList();
    refreshUnread();
  }

  function closePanel(){
    if(!open) return;
    open = false;
    backdrop.hidden = true;
    panel.hidden = true;
    bellBtn.classList.remove('is-open');
    bellBtn.setAttribute('aria-expanded', 'false');
    bellBtn.focus();
  }

  function togglePanel(){
    if(open){
      closePanel();
    } else {
      openPanel();
    }
  }

  /* ============================================
     Foco dentro do menu (após render)
     ============================================ */
  function focusableItems(){
    if(!panel) return [];
    if(!listEl.classList.contains('show')) return [];
    return Array.prototype.slice.call(panel.querySelectorAll('.dbv-bell-item, .dbv-bell-foot .dbv-bell-seeall'));
  }

  // Após o render, preserva o foco:
  //  - se o usuário ainda está "dentro" e o item anterior sumiu, volta ao 1º;
  //  - senão apenas garante o roving tabindex no item focado.
  function handleFocusAfterRender(){
    if(!open) return;
    var el = document.activeElement;
    var inPanel = panel.contains(el);
    if(!inPanel){
      focusFirst();
      return;
    }
    var fees2 = focusableItems();
    if(fees2.indexOf(el) === -1 && listEl.classList.contains('show')){
      // elemento focado não é mais um item (ex.: lista recarregada) -> 1º item
      focusFirst();
    }
    rovingTabindex(focusableItems());
  }

  function focusFirst(){
    var els = focusableItems();
    if(els[0]){
      els[0].focus({ preventScroll: true });
      rovingTabindex(focusableItems());
      return true;
    }
    return false;
  }

  function focusLast(){
    var els = focusableItems();
    if(els.length){
      els[els.length - 1].focus({ preventScroll: true });
      rovingTabindex(focusableItems());
    }
  }

  function focusNext(els, current, dir){
    var idx = els.indexOf(current);
    var next = idx + dir;
    if(next < 0) next = els.length - 1;
    if(next >= els.length) next = 0;
    if(els[next]) els[next].focus();
  }

  /* componente de menu: roving tabindex (apenas o item ativo fica em tabindex 0) */
  function rovingTabindex(els){
    var active = document.activeElement;
    var current = els.indexOf(active);
    for(var i = 0; i < els.length; i++){
      els[i].setAttribute('tabindex', i === current ? '0' : '-1');
    }
  }

  function handleListKeydown(e){
    if(!open) return;
    var els = focusableItems();
    if(els.length === 0) return;
    rovingTabindex(els);

    switch(e.key){
      case 'ArrowDown':
        e.preventDefault();
        focusNext(els, e.target, 1);
        rovingTabindex(focusableItems());
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusNext(els, e.target, -1);
        rovingTabindex(focusableItems());
        break;
      case 'Home':
        e.preventDefault();
        if(els[0]){ els[0].focus(); rovingTabindex(els); }
        break;
      case 'End':
        e.preventDefault();
        var last = els[els.length - 1];
        if(last){ last.focus(); rovingTabindex(els); }
        break;
      case 'Escape':
        e.preventDefault();
        closePanel();
        break;
    }
  }

  function activateItem(li){
    var id = li.getAttribute('data-id');
    var n = id ? itemsById[id] : null;
    markReadAndFollow(li, n);
  }

  /* ============================================
     Eventos
     ============================================ */
  function initEvents(){
    bellBtn.addEventListener('click', togglePanel);
    bellBtn.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && open){
        e.preventDefault();
        closePanel();
      }
    });

    backdrop.addEventListener('click', function(){
      closePanel();
    });

    listEl.addEventListener('click', function(e){
      var li = e.target.closest('.dbv-bell-item');
      if(li){
        activateItem(li);
      }
    });

    listEl.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){
        var li = e.target.closest('.dbv-bell-item');
        if(li){
          e.preventDefault();
          activateItem(li);
          return;
        }
      }
      handleListKeydown(e);
    });

    listEl.addEventListener('focusin', function(){
      rovingTabindex(focusableItems());
    });

    if(retryBtn){
      retryBtn.addEventListener('click', function(){
        loadList();
        refreshUnread();
      });
    }

    if(seeAllBtn){
      seeAllBtn.addEventListener('click', function(){
        closePanel();
      });
    }

    // foco perdido para fora do dropdown fecha (boa prática de menu)
    document.addEventListener('focusin', function(e){
      if(!open) return;
      var inside = panel.contains(e.target) || bellBtn === e.target;
      if(!inside) closePanel();
    });

    // timer 30s; e focus/visibilitychange
    statTimer = window.setInterval(refreshUnread, STATS_MS);

    window.addEventListener('focus', function(){
      refreshUnread();
    });
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden){
        refreshUnread();
        if(open) loadList();
      }
    });
  }

  /* ============================================
     Boot
     ============================================ */
  document.addEventListener('DOMContentLoaded', function(){
    var token = getToken();
    if(!token){
      return; // dashboard.js redireciona; nada a inicializar
    }
    initEvents();
    refreshUnread(); // contador no carregamento
    panel.hidden = true;
  });

  /* Hook para outras páginas refletirem eventos novos (ex.: contratação
     de empréstimo cria LOAN_DISBURSED) sem duplicar a listagem: apenas
     atualiza o contador de não lidas. O polling/focus continua como está. */
  window.FluxNotifications = {
    refreshUnread: refreshUnread,
  };
})();