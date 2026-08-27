/* ============================================
   FLUX — Alertas configuráveis (configuracoes.html)
   Carrega preferências (/alerts/settings) e salva
   alterações por linha. userId sempre do token.
   ============================================ */
(function(){
  'use strict';

  function $(id){ return document.getElementById(id); }
  var THRESHOLD_KINDS = ['PIX_ABOVE','BALANCE_BELOW'];
  var CATEGORY_LABEL = { SECURITY:'Segurança', MOVEMENT:'Movimentações', ACCOUNT:'Conta' };

  function es(s){
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function setState(mode){
    $('cfgAlertLoading').classList.toggle('show', mode==='loading');
    $('cfgAlertError').classList.toggle('show', mode==='error');
    $('cfgAlertList').hidden = mode!=='list';
    if(mode!=='list'){
      var note=$('cfgAlertNote'); if(note) note.hidden=true;
    } else {
      var note2=$('cfgAlertNote'); if(note2) note2.hidden=false;
    }
  }

  function feedback(msg, isError){
    var el = $('cfgAlertFeedback');
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
    clearTimeout(feedback._t);
    feedback._t = setTimeout(function(){ el.hidden = true; }, 4000);
  }

  function loadSettings(){
    setState('loading');
    apiRequest('/alerts/settings')
      .then(function(data){
        render((data && data.items) || []);
        setState('list');
      })
      .catch(function(err){
        if(err && err.message === 'Sessão expirada.') return;
        setText('cfgAlertErrorText', err && err.message ? err.message : 'Não foi possível carregar seus alertas.');
        setState('error');
      });
  }

  function render(items){
    var html = '';
    var lastCategory = null;
    items.forEach(function(item, idx){
      if(lastCategory && lastCategory!==item.category){
        html += '<li class="cfg-alert-sep" role="presentation"><span>'+es(CATEGORY_LABEL[item.category]||'')+'</span></li>';
      } else if(idx===0){
        html += '<li class="cfg-alert-sep" role="presentation"><span>'+es(CATEGORY_LABEL[item.category]||'')+'</span></li>';
      }
      lastCategory = item.category;

      var threshold = '';
      if(item.hasThreshold){
        threshold =
          '<label class="cfg-alert-th" for="cfgTh-'+item.kind+'">' +
            '<input type="number" id="cfgTh-'+item.kind+'" min="0" step="1" ' +
              'value="'+(item.threshold!=null?String(item.threshold):'')+'" ' +
              'data-kind="'+es(item.kind)+'" inputmode="numeric" ' +
              'aria-label="Limiar em reais para '+es(item.label)+'">' +
            '<span class="cfg-alert-th-cur">R$</span>' +
          '</label>';
      }

      html +=
        '<li class="cfg-alert-row" data-kind="'+es(item.kind)+'">' +
          '<div class="cfg-alert-info">' +
            '<span class="cfg-alert-label">'+es(item.label)+'</span>' +
            '<span class="cfg-alert-desc">'+es(item.description)+'</span>' +
            (threshold || '') +
          '</div>' +
          '<button type="button" class="cfg-alert-switch'+(item.enabled?' is-on':'')+'" '+
            'role="switch" aria-checked="'+(item.enabled?'true':'false')+'" '+
            'aria-label="'+es(item.label)+'" data-enabled="'+(item.enabled?'1':'0')+'">' +
            '<span class="cfg-alert-knob"></span>' +
          '</button>' +
        '</li>';
    });
    $('cfgAlertList').innerHTML = html;
  }

  /* ---------- interações ---------- */
  function onListClick(e){
    var sw = e.target && e.target.closest ? e.target.closest('.cfg-alert-switch') : null;
    if(!sw) return;
    var kind = sw.closest('[data-kind]').getAttribute('data-kind');
    var enabledNow = sw.getAttribute('data-enabled')==='1';
    var next = !enabledNow;

    sw.disabled = true;
    apiRequest('/alerts/settings/'+encodeURIComponent(kind), {
      method:'PUT',
      body: JSON.stringify({ enabled: next }),
    }).then(function(){
      sw.setAttribute('data-enabled', next?'1':'0');
      sw.setAttribute('aria-checked', next?'true':'false');
      sw.classList.toggle('is-on', next);
      sw.disabled = false;
      feedback(next ? 'Alerta ativado.' : 'Alerta desativado.');
    }).catch(function(err){
      sw.disabled = false;
      feedback(err && err.message ? err.message : 'Não foi possível salvar.', true);
    });
  }

  function onThresholdChange(e){
    var input = e.target;
    if(!input.matches || !input.matches('.cfg-alert-th input')) return;
    var kind = input.getAttribute('data-kind');
    var raw = input.value.trim();

    var payload;
    if(raw===''){ payload = { threshold: null }; }
    else {
      var n = Number(raw);
      if(isNaN(n) || n<0){ feedback('Informe um limiar válido.', true); return; }
      payload = { threshold: Math.round(n*100)/100 };
    }

    input.disabled = true;
    apiRequest('/alerts/settings/'+encodeURIComponent(kind), { method:'PUT', body: JSON.stringify(payload) })
      .then(function(){ input.disabled=false; feedback('Limiar salvo.'); })
      .catch(function(err){ input.disabled=false; feedback(err && err.message ? err.message : 'Não foi possível salvar o limiar.', true); });
  }

  document.addEventListener('DOMContentLoaded', function(){
    if(!getToken()) return; // configuracoes.js já redireciona
    loadSettings();

    var list = $('cfgAlertList');
    list.addEventListener('click', onListClick);
    list.addEventListener('change', onThresholdChange);
    list.addEventListener('keydown', function(e){
      if(e.key==='Enter' && e.target.matches && e.target.matches('.cfg-alert-th input')){
        e.preventDefault();
        e.target.blur(); // dispara change
      }
    });
    $('cfgAlertRetry').addEventListener('click', loadSettings);
  });
})();
