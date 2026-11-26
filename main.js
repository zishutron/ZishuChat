/* ============ ONE LINE TO EDIT ============
   Jab app ka download link ready ho, yahan paste kar do. Saare "Get the app" buttons live ho jayenge. */
var DOWNLOAD_URL = "";   // e.g. "https://your-link-here"
/* ========================================== */

(function(){
  var LEGAL = window.LEGAL;

  // ---- download buttons ----
  document.querySelectorAll('[data-dl]').forEach(function(a){
    var label=a.querySelector('[data-dl-label]');
    if(DOWNLOAD_URL){
      a.href=DOWNLOAD_URL; a.target='_blank'; a.rel='noopener'; a.removeAttribute('aria-disabled'); a.removeAttribute('role');
      if(label) label.textContent='Download for Android';
    }
  });

  // ---- call timer (decorative) ----
  var t=252, timerEl=document.getElementById('callTimer');
  if(timerEl && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    setInterval(function(){ t++; var m=String(Math.floor(t/60)).padStart(2,'0'), s=String(t%60).padStart(2,'0'); timerEl.textContent=m+':'+s; },1000);
  }

  // ---- waveform ----
  var wb=document.getElementById('waveBars'), hs=[10,18,26,14,32,22,12,28,34,20,10,24,30,16,26,12,22,32,18,10,26,20,30,14];
  hs.forEach(function(h,i){ var b=document.createElement('i'); b.style.setProperty('--h',h+'px'); b.style.setProperty('--d',(i*0.07)+'s'); b.style.display='block'; wb.appendChild(b); });

  // ---- decorative QR ----
  var qr=document.getElementById('qr'), n=25, seed=7, cells='';
  function rnd(){ seed=(seed*16807)%2147483647; return seed/2147483647; }
  function finder(x,y){ return '<rect x="'+x+'" y="'+y+'" width="7" height="7" rx="1.2" fill="#101C1B"/><rect x="'+(x+1)+'" y="'+(y+1)+'" width="5" height="5" rx=".8" fill="#fff"/><rect x="'+(x+2)+'" y="'+(y+2)+'" width="3" height="3" rx=".6" fill="#0FA37F"/>'; }
  function inFinder(x,y){ return (x<8&&y<8)||(x>n-9&&y<8)||(x<8&&y>n-9); }
  for(var y=0;y<n;y++){ for(var x=0;x<n;x++){ if(inFinder(x,y)) continue; if(rnd()>0.52) cells+='<rect x="'+x+'" y="'+y+'" width=".92" height=".92" rx=".2" fill="#101C1B"/>'; } }
  qr.innerHTML=cells+finder(0,0)+finder(n-7,0)+finder(0,n-7);

  // ---- customizer ----
  var THEMES=[
    {n:'Mountain Dawn',g:'linear-gradient(160deg,#f6d1c1,#c9b6e4 55%,#8fb4e8)'},
    {n:'Ocean Waves',g:'linear-gradient(160deg,#c2ecf5,#5fb4d9 55%,#1f6fa3)'},
    {n:'Sakura Blossom',g:'linear-gradient(160deg,#ffe6ee,#f9b9cf 60%,#e58fb0)'},
    {n:'Tokyo Night',g:'linear-gradient(160deg,#1b1740,#3a2a78 55%,#d1457f)'},
    {n:'Golden Sunset',g:'linear-gradient(160deg,#ffe29a,#ff9d6c 55%,#c2456b)'},
    {n:'Pine Forest',g:'linear-gradient(160deg,#cfe8d5,#5f9f7b 55%,#1e4d3b)'}
  ];
  var COLORS=[['Green','#0FA37F'],['Blue','#2F6FED'],['Violet','#7B5CF0'],['Pink','#D6409F'],['Orange','#D9480F'],['Slate','#3B4A5A']];
  var screen=document.getElementById('screen'), msgs=document.getElementById('msgs');
  var tw=document.getElementById('themes'), sw=document.getElementById('swatches');
  function setTheme(i){ msgs.style.background=THEMES[i].g; [].forEach.call(tw.children,function(b,j){ b.setAttribute('aria-pressed', j===i); }); }
  function setColor(i){ screen.style.setProperty('--out',COLORS[i][1]); [].forEach.call(sw.children,function(b,j){ b.setAttribute('aria-pressed', j===i); }); }
  THEMES.forEach(function(th,i){ var b=document.createElement('button'); b.type='button'; b.className='theme-btn'; b.innerHTML='<span class="sw" style="background:'+th.g+'"></span><span class="nm">'+th.n+'</span>'; b.addEventListener('click',function(){setTheme(i)}); tw.appendChild(b); });
  COLORS.forEach(function(c,i){ var b=document.createElement('button'); b.type='button'; b.className='swatch'; b.style.background=c[1]; b.setAttribute('aria-label',c[0]+' bubbles'); b.addEventListener('click',function(){setColor(i)}); sw.appendChild(b); });
  function bind(id,prop,unit,outId,outUnit){ var el=document.getElementById(id), out=document.getElementById(outId); function f(){ screen.style.setProperty(prop, el.value+unit); out.textContent=el.value+outUnit; } el.addEventListener('input',f); f(); }
  bind('rad','--r','px','radOut',' dp'); bind('ts','--ts','px','tsOut',' pt'); bind('gap','--gap','px','gapOut',' dp');
  setTheme(2); setColor(0);

  // ---- legal overlay ----
  var ov=document.getElementById('ov'), ovBody=document.getElementById('ovBody'), ovTitle=document.getElementById('ovTitle'), lastFocus=null;
  function openLegal(k){ lastFocus=document.activeElement; ovTitle.textContent=k==='terms'?'Terms of Service':'Privacy Policy'; ovBody.innerHTML=LEGAL[k]; ovBody.scrollTop=0; ov.classList.add('open'); document.getElementById('ovClose').focus(); }
  function closeLegal(){ ov.classList.remove('open'); if(lastFocus) try{lastFocus.focus()}catch(e){} }
  document.querySelectorAll('[data-legal]').forEach(function(b){ b.addEventListener('click',function(){ openLegal(b.getAttribute('data-legal')); }); });
  document.getElementById('ovClose').addEventListener('click',closeLegal);
  ov.addEventListener('click',function(e){ if(e.target===ov) closeLegal(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && ov.classList.contains('open')) closeLegal(); });

  // ---- copy email ----
  var cm=document.getElementById('copyMail');
  cm.addEventListener('click',function(){
    var txt=document.getElementById('mailText').textContent;
    function done(){ cm.textContent='Copied'; setTimeout(function(){cm.textContent='Copy'},1600); }
    function fallback(){ var r=document.createRange(); r.selectNodeContents(document.getElementById('mailText')); var s=getSelection(); s.removeAllRanges(); s.addRange(r); cm.textContent='Selected'; setTimeout(function(){cm.textContent='Copy'},1600); }
    try{ navigator.clipboard.writeText(txt).then(done,fallback); }catch(e){ fallback(); }
  });
})();
