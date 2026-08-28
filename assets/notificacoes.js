/* ============================================
   FLUX — Central de notificações (notificacoes.html)
   Usa somente os endpoints existentes:
   - GET  /notifications?page=&limit=
   - GET  /notifications/unread-count
   - POST /notifications/:id/read
   - POST /notifications/read-all
   Como o backend só suporta page/limit, acumulamos
   todas as páginas e filtramos/buscamos em memória.
   Núcleo compartilhado em assets/api.js.
   ============================================ */
(function(){
  'use strict';

  var PAGE_LIMIT = 10;          // itens por página visível
  var FETCH_LIMIT = 50;         // máx. suportado pelo backend por request

  var all = [];                 // todas as notificações carregadas
  var byId = Object.create(null);
  var current = [];             // resultado pós-filtro
  var pager = { page: 1, totalPages: 1 };
  var loaded = false;
  var unreadServer = 0;         // contador autoritativo do servidor

  var filters = {
    status: 'all',              // all | unread
    query: '',
  };

  /* ============================================
     Rotulagem e deep-link
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
      case 'ALERT_SECURITY': return 'Segurança';
      case 'ALERT_MOVEMENT': return 'Alerta';
      case 'ALERT_ACCOUNT':  return 'Conta';
      case 'LOAN_APPROVED':
      case 'LOAN_DISBURSED':
      case 'LOAN_INSTALLMENT_PAID':
      case 'LOAN_PAID_OFF':  return 'Empréstimo';
      default: return '';
    }
  }

  function iconClassFor(type){
    switch(type){
      case 'PIX_IN':           return 'ntf-item-ic-in';
      case 'PIX_OUT':          return 'ntf-item-ic-out';
      case 'CARD_PURCHASE':    return 'ntf-item-ic-card';
      case 'CARD_BLOCKED':     return 'ntf-item-ic-warn';
      case 'CARD_UNBLOCKED':   return 'ntf-item-ic-out';
      case 'INVOICE_PAID':     return 'ntf-item-ic-in';
      case 'AUTH_LOGIN':       return 'ntf-item-ic-auth';
      case 'ALERT_SECURITY':   return 'ntf-item-ic-auth';
      case 'ALERT_MOVEMENT':
      case 'ALERT_ACCOUNT':    return 'ntf-item-ic-warn';
      case 'LOAN_APPROVED':
      case 'LOAN_DISBURSED':
      case 'LOAN_INSTALLMENT_PAID':
      case 'LOAN_PAID_OFF':    return 'ntf-item-ic-in';
      default:                 return 'ntf-item-ic-bell';
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

  function isUnread(n){ return !n.readAt; }

  function deepLinkOf(n){
    if(n.entityType === 'transaction'){
      return 'extrato.html';
    }
    if(n.entityType === 'card' || n.entityType === 'card_purchase' || n.entityType === 'invoice'){
      return 'cartao.html';
    }
    return null;
  }

  /* somente o que existe no payload — nada inventado */
  function itemAccessibleLabel(n){
    var status = isUnread(n) ? 'não lida' : 'lida';
    var parts = [tagFor(n) || 'Notificação', n.title || '', n.message || '', status];
    if(n.amount != null && !isNaN(Number(n.amount))) parts.push(formatBRL(n.amount));
    if(n.createdAt) parts.push(formatDateTime(n.createdAt));
    return parts.filter(Boolean).join(', ');
  }

  /* ============================================
     Renderização
     ============================================ */
  function itemHtml(n, idx){
    var tag    = tagFor(n);
    var ic     = iconClassFor(n.type);
    var svg    = svgFor(n.type);
    var title  = String(n.title || '');
    var sub    = String(n.message || '');
    var read   = !isUnread(n);
    var when   = formatDateTime(n.createdAt);
    var amount = (n.amount != null && !isNaN(Number(n.amount)))
      ? '<span class="ntf-item-amount ' + (n.type === 'PIX_IN' || n.type === 'INVOICE_PAID' ? 'is-in' : 'is-out') + '">' + es(formatBRL(n.amount)) + '</span>'
      : '';
    var tagClass = (n.type === 'CARD_BLOCKED') ? ' ntf-tag-warn'
      : (n.type === 'CARD_PURCHASE' || n.type === 'CARD_UNBLOCKED') ? ' ntf-tag-card'
      : '';

    return '' +
      '<li class="ntf-item-li">' +
        '<button type="button" class="ntf-item' + (read ? ' is-read' : ' is-unread') + '" ' +
          'data-id="' + es(n.id) + '" aria-label="' + es(itemAccessibleLabel(n)) + '">' +
          '<span class="ntf-item-ic ' + ic + '" aria-hidden="true">' + svg + '</span>' +
          '<span class="ntf-item-body">' +
            '<span class="ntf-item-title">' + es(title) +
              (tag ? ' <span class="ntf-tag' + tagClass + '">' + es(tag) + '</span>' : '') +
            '</span>' +
            (sub ? '<span class="ntf-item-sub">' + es(sub) + '</span>' : '') +
            '<span class="ntf-item-meta">' +
              (when ? '<span class="ntf-item-date">' + es(when) + '</span>' : '') +
              (amount ? amount : '') +
            '</span>' +
          '</span>' +
          '<span class="ntf-item-state" aria-hidden="true">' +
            '<span class="ntf-item-dot"></span>' +
          '</span>' +
        '</button>' +
      '</li>';
  }

  function setState(mode){
    document.getElementById('ntfLoading').classList.toggle('show', mode === 'loading');
    document.getElementById('ntfEmpty').classList.toggle('show', mode === 'empty');
    document.getElementById('ntfError').classList.toggle('show', mode === 'error');
    document.getElementById('ntfList').classList.toggle('show', mode === 'list');
    document.getElementById('ntfPager').hidden = mode !== 'list';
  }

  function renderList(){
    var page = pager.page;
    pager.totalPages = Math.max(1, Math.ceil(current.length / PAGE_LIMIT));
    if(page > pager.totalPages) page = pager.totalPages;
    if(page < 1) page = 1;
    pager.page = page;

    var start = (page - 1) * PAGE_LIMIT;
    var slice = current.slice(start, start + PAGE_LIMIT);

    if(!loaded){
      setState('loading');
      return;
    }
    if(current.length === 0){
      var q = filters.query.trim();
      setText('ntfEmptyText', q
        ? 'Nenhuma notificação encontrada para a busca.'
        : (filters.status === 'unread'
            ? 'Você não tem notificações não lidas.'
            : 'Nenhuma notificação encontrada.'));
      setState('empty');
      return;
    }

    document.getElementById('ntfList').innerHTML = slice.map(itemHtml).join('');
    document.getElementById('ntfPageInfo').textContent = 'Página ' + page + ' de ' + pager.totalPages;
    document.getElementById('ntfPrev').disabled = page <= 1;
    document.getElementById('ntfNext').disabled = page >= pager.totalPages;
    setState('list');
  }

  function applySummary(){
    var unreadLocal = 0;
    for(var i = 0; i < all.length; i++){
      if(isUnread(all[i])) unreadLocal++;
    }
    var unread = Math.min(unreadServer, unreadLocal);
    setText('ntfSumUnread', String(unread));
    setText('ntfSumTotal', String(all.length));

    var markAll = document.getElementById('ntfMarkAll');
    markAll.hidden = unread === 0;
  }

  function applyFilters(){
    var q = filters.query.trim().toLowerCase();
    current = all.filter(function(n){
      if(filters.status === 'unread' && !isUnread(n)) return false;
      if(q){
        var hay = [n.title, n.message, tagFor(n)].join(' ').toLowerCase();
        if(hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    pager.page = 1;

    var countEl = document.getElementById('ntfCount');
    if(q){
      countEl.textContent = all.length
        ? current.length + ' de ' + all.length + (all.length === 1 ? ' notificação' : ' notificações')
        : '';
    } else if(filters.status === 'unread'){
      countEl.textContent = current.length + ' não lida' + (current.length === 1 ? '' : 's');
    } else {
      countEl.textContent = '';
    }

    renderList();
  }

  /* ============================================
     Carga incremental — acumula as páginas do backend
     ============================================ */
  function refreshUnreadServer(){
    return loadUnreadCount()
      .then(function(data){
        if(data && typeof data.unread === 'number') unreadServer = data.unread;
        if(loaded) applySummary();
        return data;
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return null;
        return null;
      });
  }

  function fetchAll(){
    setState('loading');
    all = [];
    byId = Object.create(null);
    loaded = false;
    applySummary();

    function next(page, acc){
      return listNotifications(page, FETCH_LIMIT)
        .then(function(data){
          var items = (data && data.items) || [];
          var meta = (data && data.meta) || {};
          acc = acc.concat(items);
          var totalPages = meta.totalPages || 1;
          if(page < totalPages){
            return next(page + 1, acc);
          }
          return acc;
        });
    }

    return refreshUnreadServer()
      .catch(function(){ return null; })
      .then(function(){
        return next(1, []);
      })
      .then(function(acc){
        all = acc;
        var i;
        for(i = 0; i < all.length; i++) byId[all[i].id] = all[i];
        loaded = true;
        applySummary();
        applyFilters();
        return acc;
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('ntfErrorText', err && err.message
          ? err.message
          : 'Não foi possível carregar as notificações.');
        loaded = false;
        setState('error');
      });
  }

  /* ============================================
     Marcar como lida + deep-link
     ============================================ */
  var lastFocused = null;

  function gotoDetail(n){
    var href = deepLinkOf(n);
    if(href) window.location.href = href;
  }

  function markOne(n, li){
    lastFocused = document.activeElement;
    if(!n.readAt){
      var done = function(){
        n.readAt = new Date().toISOString();
        applySummary();
        if(filters.status === 'all'){
          // atualiza o item em lugar, mantendo o foco/navegação
          renderList();
        } else {
          // filtro "não lidas": item some da lista
          applyFilters();
        }
      };
      markNotificationRead(n.id)
        .then(function(){
          refreshUnreadServer();
          done();
        })
        .catch(function(err){
          if(err && err.message === 'Sessão expirada.') return;
          // mantém o estado; usuário pode tentar de novo
        });
    }
    gotoDetail(n);
  }

  function markAll(){
    markAllNotificationsRead()
      .then(function(){
        var i;
        for(i = 0; i < all.length; i++) all[i].readAt = new Date().toISOString();
        unreadServer = 0;
        refreshUnreadServer();
        applySummary();
        applyFilters();
        var heading = document.getElementById('ntfListTitle');
        if(heading) heading.focus({ preventScroll: true });
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
      });
  }

  /* ============================================
     Eventos
     ============================================ */
  function focusHeading(){
    var heading = document.getElementById('ntfListTitle');
    if(heading) heading.focus({ preventScroll: true });
  }

  function initList(){
    document.getElementById('ntfList').addEventListener('click', function(e){
      var btn = e.target.closest('.ntf-item');
      if(!btn) return;
      var id = btn.getAttribute('data-id');
      var n = id ? byId[id] : null;
      if(n) markOne(n, btn);
    });
  }

  function initFilters(){
    var i, opts = document.querySelectorAll('input[name="ntfFilter"]');
    for(i = 0; i < opts.length; i++){
      opts[i].addEventListener('change', function(){
        filters.status = this.value;
        applyFilters();
      });
    }

    var searchEl = document.getElementById('ntfSearchInput');
    var clearBtn = document.getElementById('ntfSearchClear');
    var debounce = null;
    searchEl.addEventListener('input', function(){
      clearTimeout(debounce);
      debounce = setTimeout(function(){
        filters.query = searchEl.value;
        clearBtn.hidden = !filters.query;
        applyFilters();
      }, 160);
    });
    clearBtn.addEventListener('click', function(){
      searchEl.value = '';
      filters.query = '';
      clearBtn.hidden = true;
      applyFilters();
      searchEl.focus();
    });
  }

  function initPager(){
    document.getElementById('ntfPrev').addEventListener('click', function(){
      if(pager.page > 1){
        pager.page -= 1;
        renderList();
        focusHeading();
      }
    });
    document.getElementById('ntfNext').addEventListener('click', function(){
      if(pager.page < pager.totalPages){
        pager.page += 1;
        renderList();
        focusHeading();
      }
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

    initList();
    initFilters();
    initPager();
    document.getElementById('ntfRetry').addEventListener('click', function(){
      fetchAll();
    });
    document.getElementById('ntfMarkAll').addEventListener('click', markAll);

    loadProfile()
      .then(function(data){
        if(data && data.user){
          var name = data.user.fullName || '';
          var short = String(name).trim().split(/\s+/)[0] || '';
          if(name){
            document.getElementById('ntfUser').hidden = false;
            setText('ntfUserName', name || '...');
            setText('ntfUserInitial', short ? short.charAt(0).toUpperCase() : '?');
          }
        }
        return data;
      })
      .catch(function(){})
      .then(function(){
        fetchAll();
      });
  });
})();