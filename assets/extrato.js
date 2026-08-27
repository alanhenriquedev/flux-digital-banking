/* ============================================
   FLUX — Extrato completo (extrato.html)
   Usa somente o endpoint GET /api/transactions
   (suporta apenas page/limit). Como o backend não
   filtra por tipo/direção/período, acumulamos todas
   as páginas no frontend e filtramos em memória.
   Núcleo compartilhado em assets/api.js.
   ============================================ */
(function(){
  'use strict';

  var PAGE_LIMIT = 10;         // registros por página na listagem visível
  var FETCH_LIMIT = 50;        // máx. suportado pelo backend por request

  var all = [];                // todas as transações carregadas
  var current = [];            // resultado pós-filtro
  var pager = { page: 1, totalPages: 1 };
  var loaded = false;

  var filters = {
    type: 'all',               // all | IN | OUT | PIX | CARD
    query: '',
  };

  /* ============================================
     Helpers de rotulagem (somente dados existentes)
     ============================================ */
  function typeLabel(t){
    if(t.type === 'CARD_PAYMENT') return 'Cartão';
    return t.type || '—';
  }

  function typeKey(t){
    if(t.type === 'CARD_PAYMENT') return 'card';
    if(t.type === 'PIX') return 'pix';
    return String(t.type || '').toLowerCase();
  }

  function dirLabel(t){
    return t.direction === 'IN' ? 'Entrada' : 'Saída';
  }

  function statusLabel(t){
    return t.status === 'COMPLETED' ? 'Concluída' : (t.status || '—');
  }

  function directionOf(t){
    return t.direction === 'IN' ? 'in' : 'out';
  }

  function matchesQuery(t, q){
    if(!q) return true;
    var hay = [
      t.description,
      t.counterpartyName,
      t.counterpartyNumber,
      typeLabel(t),
      dirLabel(t),
    ].join(' ').toLowerCase();
    return hay.indexOf(q.toLowerCase()) !== -1;
  }

  // somente o que existe no payload — nada inventado
  function itemAccessibleLabel(t){
    var dir = t.direction === 'IN' ? 'entrada' : 'saída';
    var name = t.counterpartyName ? ' de ' + t.counterpartyName : '';
    return [
      typeLabel(t),
      dir,
      formatBRL(t.amount),
      name || '',
      formatDateTime(t.createdAt) || '',
    ].join(', ');
  }

  /* ============================================
     Renderização
     ============================================ */
  function itemHtml(t){
    var d = directionOf(t);
    var incoming = t.direction === 'IN';
    var title = t.counterpartyName || (incoming ? 'Entrada (' + typeLabel(t) + ')' : 'Saída (' + typeLabel(t) + ')');
    var subParts = [];
    if(t.description) subParts.push(t.description);
    if(t.counterpartyNumber) subParts.push('Conta ' + t.counterpartyNumber);
    var when = formatDateTime(t.createdAt);
    var isCard = t.type === 'CARD_PAYMENT';
    var icClass = isCard ? 'extr-item-ic-card' : (incoming ? 'extr-item-ic-in' : 'extr-item-ic-out');
    var icSvg = isCard
      ? '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/>'
      : (incoming
          ? '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'
          : '<path d="M7 14l5-5 5 5"/><path d="M12 9v12"/>');

    return '' +
      '<li class="extr-item-li">' +
        '<button type="button" class="extr-item" data-id="' + es(t.id) + '" aria-label="Ver detalhe, ' + es(itemAccessibleLabel(t)) + '">' +
          '<span class="extr-item-ic ' + icClass + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true">' + icSvg + '</svg>' +
          '</span>' +
          '<span class="extr-item-body">' +
            '<span class="extr-item-title">' + es(title) +
              '<span class="extr-item-tags">' +
                '<span class="extr-tag ' + (isCard ? 'extr-tag-card' : '') + '">' + es(typeLabel(t)) + '</span>' +
                (t.status && t.status !== 'COMPLETED' ? '<span class="extr-tag extr-tag-status">' + es(statusLabel(t)) + '</span>' : '') +
              '</span>' +
            '</span>' +
            '<span class="extr-item-sub">' + es(subParts.join(' · ')) + '</span>' +
          '</span>' +
          '<span class="extr-item-side">' +
            '<span class="extr-item-amount ' + d + '">' + (incoming ? '+ ' : '- ') + formatBRL(t.amount) + '</span>' +
            (when ? '<span class="extr-item-date">' + when + '</span>' : '') +
          '</span>' +
        '</button>' +
      '</li>';
  }

  function setState(mode){
    document.getElementById('extrLoading').classList.toggle('show', mode === 'loading');
    document.getElementById('extrEmpty').classList.toggle('show', mode === 'empty');
    document.getElementById('extrError').classList.toggle('show', mode === 'error');
    document.getElementById('extrList').classList.toggle('show', mode === 'list');
    document.getElementById('extrPager').hidden = mode !== 'list';
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
      setText('extrEmptyText', filters.query
        ? 'Nenhuma movimentação encontrada para a busca.'
        : 'Nenhuma movimentação encontrada.');
      setState('empty');
      return;
    }

    document.getElementById('extrList').innerHTML = slice.map(itemHtml).join('');
    document.getElementById('extrPageInfo').textContent = 'Página ' + page + ' de ' + pager.totalPages;
    document.getElementById('extrPrev').disabled = page <= 1;
    document.getElementById('extrNext').disabled = page >= pager.totalPages;
    setState('list');
  }

  function applySummary(){
    if(!loaded){
      setText('extrSumIn', '—');
      setText('extrSumOut', '—');
      setText('extrSumNet', '—');
      setText('extrSumCount', '—');
      var pr = document.getElementById('extrSumPeriod');
      if(pr) pr.textContent = 'carregando período...';
      return;
    }
    var totalIn = 0;
    var totalOut = 0;
    var net = 0;
    for(var i = 0; i < all.length; i++){
      var t = all[i];
      var amount = Number(t.amount) || 0;
      if(t.direction === 'IN') totalIn += amount;
      else totalOut += amount;
    }
    net = totalIn - totalOut;

    setText('extrSumIn', formatBRL(totalIn));
    setText('extrSumOut', formatBRL(totalOut));
    setText('extrSumNet', formatBRL(net));
    setText('extrSumCount', String(all.length));

    var periodEl = document.getElementById('extrSumPeriod');
    if(all.length){
      var min = new Date(all[all.length - 1].createdAt);
      var max = new Date(all[0].createdAt);
      function short(d){
        if(isNaN(d.getTime())) return '—';
        function p(n){ return (n < 10 ? '0' : '') + n; }
        return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
      }
      periodEl.textContent = 'de ' + short(min) + ' a ' + short(max);
    } else {
      periodEl.textContent = 'sem movimentações no período';
    }
  }

  function applyFilters(){
    var q = filters.query.trim();
    current = all.filter(function(t){
      if(filters.type === 'IN' && t.direction !== 'IN') return false;
      if(filters.type === 'OUT' && t.direction !== 'OUT') return false;
      if(filters.type === 'PIX' && t.type !== 'PIX') return false;
      if(filters.type === 'CARD' && t.type !== 'CARD_PAYMENT') return false;
      if(!matchesQuery(t, q)) return false;
      return true;
    });
    pager.page = 1;

    var countEl = document.getElementById('extrCount');
    if(q){
      countEl.textContent = all.length
        ? current.length + ' de ' + all.length + ' movimentação' + (all.length === 1 ? '' : 'ões')
        : '';
    } else if(filters.type !== 'all'){
      countEl.textContent = current.length + ' movimentação' + (current.length === 1 ? '' : 'ões');
    } else {
      countEl.textContent = '';
    }

    renderList();
  }

  /* ============================================
     Carga incremental — acumula as páginas do backend
     ============================================ */
  function fetchAll(){
    setState('loading');
    all = [];
    loaded = false;
    applySummary();

    function next(page, acc){
      return apiRequest('/transactions?page=' + page + '&limit=' + FETCH_LIMIT)
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

    return next(1, [])
      .then(function(acc){
        all = acc;
        loaded = true;
        applySummary();
        applyFilters();
        return acc;
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('extrErrorText', err && err.message
          ? err.message
          : 'Não foi possível carregar o extrato.');
        loaded = false;
        setState('error');
      });
  }

  /* ============================================
     Detalhe da movimentação (dialog acessível)
     ============================================ */
  var detailEl = null;
  var lastFocused = null;

  function openDetail(t){
    detailEl = document.getElementById('extrDetail');
    lastFocused = document.activeElement;

    var dd = function(cls, val){ return '<div class="extr-detail-row"><dt>' + cls + '</dt><dd' + (cls === 'Valor' ? ' class="' + (t.direction === 'IN' ? 'is-in' : 'is-out') + '"' : '') + '>' + val + '</dd></div>'; };

    var html =
      dd('Valor', (t.direction === 'IN' ? '+ ' : '- ') + formatBRL(t.amount)) +
      dd('Tipo', es(typeLabel(t))) +
      dd('Direção', es(dirLabel(t))) +
      dd('Status', es(statusLabel(t))) +
      dd('Descrição', t.description ? es(t.description) : '—') +
      dd('Contraparte', t.counterpartyName ? es(t.counterpartyName) : '—') +
      dd('Conta', t.counterpartyNumber ? es(t.counterpartyNumber) : '—') +
      dd('Data', es(formatDateTime(t.createdAt) || '—')) +
      dd('ID', es(t.id));

    document.getElementById('extrDetailBody').innerHTML = html;
    document.body.style.overflow = 'hidden';
    detailEl.hidden = false;

    requestAnimationFrame(function(){
      document.getElementById('extrDetailClose').focus();
    });
  }

  function closeDetail(){
    if(!detailEl || detailEl.hidden) return;
    detailEl.hidden = true;
    document.body.style.overflow = '';
    if(lastFocused && document.body.contains(lastFocused)){
      lastFocused.focus();
    }
  }

  function initDetail(){
    var closeBtn = document.getElementById('extrDetailClose');
    detailEl = document.getElementById('extrDetail');

    document.getElementById('extrList').addEventListener('click', function(e){
      var btn = e.target.closest('.extr-item');
      if(!btn) return;
      var id = btn.getAttribute('data-id');
      for(var i = 0; i < all.length; i++){
        if(all[i].id === id){
          openDetail(all[i]);
          break;
        }
      }
    });

    closeBtn.addEventListener('click', closeDetail);
    detailEl.addEventListener('click', function(e){
      if(e.target.closest('[data-extr-close]')) closeDetail();
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && detailEl && !detailEl.hidden) closeDetail();
    });
    // trap simples de foco dentro do diálogo
    detailEl.addEventListener('keydown', function(e){
      if(detailEl.hidden) return;
      if(e.key !== 'Tab') return;
      var focusables = detailEl.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if(!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if(e.shiftKey && document.activeElement === first){
        e.preventDefault();
        last.focus();
      } else if(!e.shiftKey && document.activeElement === last){
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ============================================
     Filtros e paginação
     ============================================ */
  function initFilters(){
    var typeBtns = document.querySelectorAll('input[name="extrType"]');
    var i;
    for(i = 0; i < typeBtns.length; i++){
      typeBtns[i].addEventListener('change', function(){
        filters.type = this.value;
        applyFilters();
      });
    }

    var searchEl = document.getElementById('extrSearchInput');
    var clearBtn = document.getElementById('extrSearchClear');
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
    document.getElementById('extrPrev').addEventListener('click', function(){
      if(pager.page > 1){
        pager.page -= 1;
        renderList();
        document.getElementById('extrListTitle').focus();
      }
    });
    document.getElementById('extrNext').addEventListener('click', function(){
      if(pager.page < pager.totalPages){
        pager.page += 1;
        renderList();
        document.getElementById('extrListTitle').focus();
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

    initDetail();
    initFilters();
    initPager();
    document.getElementById('extrRetry').addEventListener('click', function(){
      fetchAll();
    });

    loadProfile()
      .then(function(data){
        if(data && data.user){
          var name = data.user.fullName || '';
          var short = String(name).trim().split(/\s+/)[0] || '';
          if(name){
            document.getElementById('extrUser').hidden = false;
            setText('extrUserName', name || '...');
            setText('extrUserInitial', short ? short.charAt(0).toUpperCase() : '?');
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