// ============================================
// FLUX — landing page interactions & animations
// ============================================

// ---------- boot / intro logo ----------
const boot = document.getElementById('boot');
if(boot){
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced){
    boot.remove();
  }else{
    document.documentElement.classList.add('flx-js');
    window.scrollTo(0,0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const bootLogo = document.getElementById('bootLogo');
    const bootMark = document.getElementById('bootMark');
    const headerLogo = document.querySelector('header .logo');

    requestAnimationFrame(()=>{
      // 1) marca expande + FLUX entra
      setTimeout(()=>{ boot.classList.add('play'); }, 60);
      // 2) logo voa até o header e overlay desvanece
      setTimeout(()=>{
        if(bootLogo && headerLogo){
          const s = bootLogo.getBoundingClientRect();
          const t = headerLogo.getBoundingClientRect();
          const dx = (t.left + t.width/2) - (s.left + s.width/2);
          const dy = (t.top + t.height/2) - (s.top + s.height/2);
          const scale = s.width > 0 ? t.width / s.width : 1;
          if(bootMark) bootMark.classList.add('is-final');
          bootLogo.style.transition = 'transform .52s cubic-bezier(.16,.8,.3,1)';
          bootLogo.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
        }
        boot.classList.add('is-exit');
      }, 1250);
      // 3) cleanup
      setTimeout(()=>{
        boot.remove();
        document.body.style.overflow = prevOverflow;
        document.body.classList.add('booted');
      }, 1880);
    });
  }
}

// ---------- scroll reveal (data-reveal, Etapa B) ----------
const revealEls = document.querySelectorAll('[data-reveal]');
const revealReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// stagger automático: índice entre irmãos com data-reveal -> --i (80ms cada)
revealEls.forEach(el=>{
  const parent = el.parentNode;
  let idx = 0;
  if(parent){
    const sibs = Array.prototype.filter.call(parent.children, c => c.hasAttribute('data-reveal'));
    idx = Math.max(0, sibs.indexOf(el));
  }
  el.style.setProperty('--i', idx);
});
if(revealReduce){
  // revela tudo imediatamente
  revealEls.forEach(el => el.classList.add('in'));
}else{
  const revealIo = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        en.target.classList.add('in');
        revealIo.unobserve(en.target); // sem replay: revela uma vez ao entrar
      }
    });
  },{ threshold:0.12, rootMargin:'0px 0px -8% 0px' });
  revealEls.forEach(el => revealIo.observe(el));
}
// ---------- scroll progress bar ----------
const scrollProgress = document.getElementById('scrollProgress');
  const siteHeader = document.querySelector('header');
  function updateScrollProgress(){
    if(!scrollProgress) return;
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop;
    const height = doc.scrollHeight - doc.clientHeight;
    const pct = height > 0 ? (scrollTop / height) * 100 : 0;
    scrollProgress.style.width = pct + '%';
    if(siteHeader){
      const up = scrollTop > 18, down = scrollTop < 8;
      if(up){
        if(scTarget !== 1){ scTarget = 1; scTicks = 0; }
        if(++scTicks === 2) siteHeader.classList.add('is-scrolled');
      } else if(down){
        if(scTarget !== -1){ scTarget = -1; scTicks = 0; }
        if(++scTicks === 2) siteHeader.classList.remove('is-scrolled');
      } else {
        scTarget = 0;
        scTicks = 0;
      }
    }
  }
let progressTicking = false;
let scTicks = 0, scTarget = 0;
window.addEventListener('scroll', ()=>{
  if(!progressTicking){
    requestAnimationFrame(()=>{ updateScrollProgress(); progressTicking = false; });
    progressTicking = true;
  }
});
updateScrollProgress();

// ---------- hero depth: scroll + mouse parallax ----------
const mqFine = window.matchMedia && window.matchMedia('(pointer: fine)');
const mqReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
// reduz a força do parallax em telas menores; desliga em touch e reduced-motion
const parallaxEnabled = (mqFine && mqFine.matches) && !(mqReduce && mqReduce.matches);

const heroVisual = document.querySelector('.hero-visual');
const orb = document.querySelector('.hero .orb');
const orb2 = document.querySelector('.hero .orb-2');
const heroComp = document.getElementById('heroComp');

let parX = 0, parY = 0;          // -1..1 posição do mouse relativa ao hero
let parSmoothX = 0, parSmoothY = 0;
let parRaf = null;

function applyParallax(){
  // suaviza o follow do mouse (lerp) para sensação física
  const k = 0.09;
  parSmoothX += (parX - parSmoothX) * k;
  parSmoothY += (parY - parSmoothY) * k;
  const settled = Math.abs(parX - parSmoothX) < 0.001 && Math.abs(parY - parSmoothY) < 0.001;
  if(heroComp && parallaxEnabled){
    heroComp.style.setProperty('--mx', parSmoothX.toFixed(3));
    heroComp.style.setProperty('--my', parSmoothY.toFixed(3));
  }
  const sy = window.scrollY || 0;
  if(parallaxEnabled){
    if(orb) orb.style.transform = `translate3d(${(parSmoothX * -18).toFixed(1)}px, ${(parSmoothY * -12).toFixed(1)}px, 0) translateY(${(sy * 0.12).toFixed(1)}px)`;
    if(orb2) orb2.style.transform = `translate3d(${(parSmoothX * 26).toFixed(1)}px, ${(parSmoothY * -8).toFixed(1)}px, 0) translateY(${(sy * -0.08).toFixed(1)}px)`;
  }
  if(!settled){
    parRaf = requestAnimationFrame(applyParallax);
  }else{
    parRaf = null;
  }
}
function scheduleParallax(){
  if(parRaf === null) parRaf = requestAnimationFrame(applyParallax);
}
// scroll parallax (sempre, mas sem raf se não houver nada para mover)
if(heroVisual || orb || orb2){
  const onScrollPar = () => { if((orb||orb2||heroComp) && !(mqReduce && mqReduce.matches)) scheduleParallax(); };
  window.addEventListener('scroll', onScrollPar, { passive:true });
  window.addEventListener('resize', onScrollPar, { passive:true });
}
// mouse parallax (só pointer:fine e sem reduced-motion)
if(heroVisual && parallaxEnabled){
  heroVisual.addEventListener('mousemove',(e)=>{
    const r = heroVisual.getBoundingClientRect();
    parX = ((e.clientX - r.left) / r.width) * 2 - 1;
    parY = ((e.clientY - r.top) / r.height) * 2 - 1;
    scheduleParallax();
  });
  heroVisual.addEventListener('mouseleave',()=>{
    parX = 0; parY = 0;
    scheduleParallax();
  });
}

// ---------- animated number count-up ----------
function easeOutExpo(t){ return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
function animateCount(el){
  const target = parseFloat(el.dataset.count);
  if(isNaN(target)) return;
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  const duration = 1300;
  const start = performance.now();
  function frame(now){
    const elapsed = Math.min((now - start) / duration, 1);
    const eased = easeOutExpo(elapsed);
    const value = target * eased;
    el.textContent = 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if(elapsed < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
const countEls = document.querySelectorAll('[data-count]');
const countIo = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){ animateCount(e.target); countIo.unobserve(e.target); }
  });
},{threshold:0.4});
countEls.forEach(el=>countIo.observe(el));

// ---------- interactive objects (Etapa C) ----------
// UM listener document-level: tilt do cartão + respiro sutil da composição de
// celulares. Movimento unificado do grupo (translate/rotate), sem deslocar os
// elementos internos — transições CSS suavizam o movimento e o retorno.
if(parallaxEnabled){
  const cardEl = document.getElementById('tiltCard');
  const phoneWrap = document.querySelector('.phones');
  document.addEventListener('mousemove',(e)=>{
    if(cardEl){
      const hit = e.target.closest && e.target.closest('#tiltCard');
      if(hit){
        const r = cardEl.getBoundingClientRect();
        const x = (e.clientX - r.left)/r.width  - 0.5;
        const y = (e.clientY - r.top)/r.height - 0.5;
        cardEl.style.transform = 'rotateX(' + (-y * 7).toFixed(2) + 'deg) rotateY(' + (x * 7).toFixed(2) + 'deg) scale(1.02)';
      }else{
        cardEl.style.transform = 'rotateX(0deg) rotateY(0deg) scale(1)';
      }
    }
    if(phoneWrap){
      const hit = e.target.closest && e.target.closest('.phones');
      if(hit){
        const r = phoneWrap.getBoundingClientRect();
        const rx = (e.clientX - r.left)/r.width  - 0.5;
        const ry = (e.clientY - r.top)/r.height - 0.5;
        phoneWrap.style.translate = (rx * -4).toFixed(1) + 'px ' + (ry * -3).toFixed(1) + 'px';
        const ang = Math.min((Math.abs(rx) + Math.abs(ry)) * 3, 3);
        phoneWrap.style.rotate = (-ry).toFixed(3) + ' ' + rx.toFixed(3) + ' 0 ' + ang.toFixed(2) + 'deg';
      }else{
        phoneWrap.style.translate = '0px 0px';
        phoneWrap.style.rotate = '0 0 0 0deg';
      }
    }
  },{passive:true});
}

// ---------- loan simulator (simulação oficial via API) ----------
const slider = document.getElementById('loanSlider');
const amountLabel = document.getElementById('loanAmountLabel');
const installGroup = document.getElementById('installmentGroup');
const loanResult = document.getElementById('loanResult');
let installments = 12;
const loanApiUrl = (window.FLUX_API_URL || 'http://localhost:3333/api') + '/loans/simulate';
let loanBarVisible = false; // only fills once the simulator has scrolled into view
let loanReqSeq = 0;

function formatBRL(v){
  return 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function loanSimulate(amount, n){
  return fetch(loanApiUrl,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ amount: amount, installments: n }),
  }).then(function(res){
    if(!res.ok) throw new Error('Simulação indisponível no momento.');
    return res.json();
  });
}

function renderLoan(data){
  loanResult.innerHTML = data.installments + 'x de <span class="small">' + formatBRL(data.installmentValue) + '</span>';
  document.getElementById('legPrincipal').textContent = 'R$ ' + data.amount.toLocaleString('pt-BR',{maximumFractionDigits:0});
  document.getElementById('legJuros').textContent = formatBRL(data.interestTotal);
  document.getElementById('statTotal').textContent = formatBRL(data.totalAmount);
  document.getElementById('statRate').textContent = (data.interestRate * 100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) + '% a.m.';
  const principalPct = Math.max(55, Math.min(96, (data.amount / data.totalAmount) * 100));
  document.getElementById('segPrincipal').style.width = loanBarVisible ? principalPct + '%' : '0%';
}

function calc(){
  const amount = parseFloat(slider.value);
  amountLabel.textContent = 'R$ ' + amount.toLocaleString('pt-BR',{maximumFractionDigits:0});
  const seq = ++loanReqSeq;
  loanSimulate(amount, installments).then(function(data){
    if(seq === loanReqSeq) renderLoan(data);
  }).catch(function(){
    // mantém o último valor renderizado; o erro é silencioso nesta etapa
  });
}
slider.addEventListener('input', calc);
installGroup.querySelectorAll('.inst-opt').forEach(opt=>{
  opt.addEventListener('click',()=>{
    installGroup.querySelectorAll('.inst-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    installments = parseInt(opt.dataset.n);
    calc();
  });
});
calc();

const loanSimEl = document.querySelector('.loan-sim');
if(loanSimEl){
  const loanIo = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        loanBarVisible = true;
        calc();
        loanIo.unobserve(e.target);
      }
    });
  },{threshold:0.4});
  loanIo.observe(loanSimEl);
}

// ---------- finance chart (line chart, draws in on scroll) ----------
const svg = document.getElementById('finChart');
const months = ['Mar','Abr','Mai','Jun','Jul','Ago'];
const receitas = [4200,4600,4300,4900,5000,5200];
const despesas = [2600,3100,2400,2700,2900,2840];
const w=460,h=180,pad=24;
const maxVal = Math.max(...receitas)*1.1;
function xFor(i){ return pad + i*((w-pad*2)/(months.length-1)); }
function yFor(v){ return h-24 - (v/maxVal)*(h-50); }
function pathFor(arr){
  return arr.map((v,i)=> (i===0?'M':'L') + xFor(i) + ',' + yFor(v)).join(' ');
}
let svgContent = '';
// grid lines
for(let g=0; g<3; g++){
  const gy = 20 + g*((h-50)/2);
  svgContent += `<line x1="${pad}" y1="${gy}" x2="${w-pad}" y2="${gy}" stroke="#1b212b" stroke-width="1"/>`;
}
// area under receitas
svgContent += `<path d="${pathFor(receitas)} L ${xFor(months.length-1)},${h-24} L ${xFor(0)},${h-24} Z" fill="url(#gradUp)" opacity="0.18"/>`;
svgContent += `<path class="chart-line" d="${pathFor(receitas)}" fill="none" stroke="#3ddc84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
svgContent += `<path class="chart-line" d="${pathFor(despesas)}" fill="none" stroke="#ff5c7a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
receitas.forEach((v,i)=>{ svgContent += `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="3" fill="#3ddc84"/>`; });
despesas.forEach((v,i)=>{ svgContent += `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="3" fill="#ff5c7a"/>`; });
months.forEach((m,i)=>{ svgContent += `<text x="${xFor(i)}" y="${h-6}" font-size="9" fill="#5c6577" text-anchor="middle" font-family="Inter">${m}</text>`; });
svg.innerHTML = `<defs><linearGradient id="gradUp" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#3ddc84"/><stop offset="100%" stop-color="#3ddc84" stop-opacity="0"/>
</linearGradient></defs>` + svgContent;

// set real path lengths for a precise draw-in animation, then trigger on scroll
svg.querySelectorAll('path.chart-line').forEach(p=>{
  const len = p.getTotalLength();
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
});
const chartIo = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      svg.classList.add('drawn');
      svg.querySelectorAll('path.chart-line').forEach(p=>{ p.style.strokeDashoffset = 0; });
      chartIo.unobserve(e.target);
    }
  });
},{threshold:0.35});
chartIo.observe(svg);

// ---------- mobile header menu (hambúrguer) ----------
// Sem Observers novos: apenas alterna o estado .nav-open no header,
// sincroniza o aria-expanded e fecha ao escolher um link, Esc ou ao
// voltar a um viewport desktop. Fecha também a seleção do logo.
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
const headerEl = document.querySelector('header');
function closeNavMenu(){
  if(!headerEl) return;
  headerEl.classList.remove('nav-open');
  if(navToggle) navToggle.setAttribute('aria-expanded','false');
}
if(navToggle && headerEl){
  navToggle.addEventListener('click',(e)=>{
    e.stopPropagation();
    const open = headerEl.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  if(navMenu){
    navMenu.addEventListener('click',(e)=>{
      if(e.target.closest('a')) closeNavMenu(); // fecha ao navegar
    });
  }
  document.addEventListener('keydown',(e)=>{
    if(e.key === 'Escape') closeNavMenu();
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth > 900) closeNavMenu();
  });
}