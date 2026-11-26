/* ZishuChat website scripts. Every block checks that its element exists, so this file works on all pages. */

/* ============ ONE LINE TO EDIT ============
   Jab app ka download link ready ho, yahan paste kar do. Saare "Get the app" buttons live ho jayenge. */
var DOWNLOAD_URL = "";   // e.g. "https://your-link-here"
/* ========================================== */

(function () {
  var $ = function (id) { return document.getElementById(id); };

  // ---- mobile menu ----
  var mb = $('menuBtn'), nl = $('navLinks');
  if (mb && nl) {
    mb.addEventListener('click', function () {
      var open = nl.classList.toggle('open');
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nl.addEventListener('click', function (e) { if (e.target.tagName === 'A') { nl.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });
  }

  // ---- download buttons ----
  document.querySelectorAll('[data-dl]').forEach(function (a) {
    var label = a.querySelector('[data-dl-label]');
    if (DOWNLOAD_URL) {
      a.href = DOWNLOAD_URL; a.target = '_blank'; a.rel = 'noopener';
      a.removeAttribute('aria-disabled'); a.removeAttribute('role');
      if (label) label.textContent = 'Download for Android';
    }
  });

  // ---- copy buttons (email etc.) ----
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var txt = btn.getAttribute('data-copy');
    var lab = btn.querySelector('[data-copy-label]') || btn;
    var orig = lab.textContent;
    function flash(msg) { lab.textContent = msg; setTimeout(function () { lab.textContent = orig; }, 1800); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); flash(ok ? 'Copied' : 'Press and hold to copy');
    }
    btn.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { flash('Copied'); }, fallback);
      else fallback();
    });
  });

  // ---- call timer (decorative) ----
  var timerEl = $('callTimer'), t = 252;
  if (timerEl && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(function () { t++; timerEl.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }, 1000);
  }

  // ---- waveform ----
  var wb = $('waveBars');
  if (wb) {
    [10,18,26,14,32,22,12,28,34,20,10,24,30,16,26,12,22,32,18,10,26,20,30,14].forEach(function (h, i) {
      var b = document.createElement('i'); b.style.setProperty('--h', h + 'px'); b.style.setProperty('--d', (i * 0.07) + 's'); b.style.display = 'block'; wb.appendChild(b);
    });
  }

  // ---- decorative QR ----
  var qr = $('qr');
  if (qr) {
    var n = 25, seed = 7, cells = '';
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var finder = function (x, y) { return '<rect x="' + x + '" y="' + y + '" width="7" height="7" rx="1.2" fill="#101C1B"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" rx=".8" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" rx=".6" fill="#0FA37F"/>'; };
    var inFinder = function (x, y) { return (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9); };
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { if (inFinder(x, y)) continue; if (rnd() > 0.52) cells += '<rect x="' + x + '" y="' + y + '" width=".92" height=".92" rx=".2" fill="#101C1B"/>'; }
    qr.innerHTML = cells + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7);
  }

  // ---- customizer (home page) ----
  var screen = $('screen'), msgs = $('msgs'), tw = $('themes'), sw = $('swatches');
  if (screen && msgs && tw && sw) {
    var THEMES = [
      { n: 'Mountain Dawn', g: 'linear-gradient(160deg,#f6d1c1,#c9b6e4 55%,#8fb4e8)' },
      { n: 'Ocean Waves', g: 'linear-gradient(160deg,#c2ecf5,#5fb4d9 55%,#1f6fa3)' },
      { n: 'Sakura Blossom', g: 'linear-gradient(160deg,#ffe6ee,#f9b9cf 60%,#e58fb0)' },
      { n: 'Tokyo Night', g: 'linear-gradient(160deg,#1b1740,#3a2a78 55%,#d1457f)' },
      { n: 'Golden Sunset', g: 'linear-gradient(160deg,#ffe29a,#ff9d6c 55%,#c2456b)' },
      { n: 'Pine Forest', g: 'linear-gradient(160deg,#cfe8d5,#5f9f7b 55%,#1e4d3b)' }
    ];
    var COLORS = [['Green', '#0FA37F'], ['Blue', '#2F6FED'], ['Violet', '#7B5CF0'], ['Pink', '#D6409F'], ['Orange', '#D9480F'], ['Slate', '#3B4A5A']];
    var setTheme = function (i) { msgs.style.background = THEMES[i].g; [].forEach.call(tw.children, function (b, j) { b.setAttribute('aria-pressed', j === i); }); };
    var setColor = function (i) { screen.style.setProperty('--out', COLORS[i][1]); [].forEach.call(sw.children, function (b, j) { b.setAttribute('aria-pressed', j === i); }); };
    THEMES.forEach(function (th, i) { var b = document.createElement('button'); b.type = 'button'; b.className = 'theme-btn'; b.innerHTML = '<span class="sw" style="background:' + th.g + '"></span><span class="nm">' + th.n + '</span>'; b.addEventListener('click', function () { setTheme(i); }); tw.appendChild(b); });
    COLORS.forEach(function (c, i) { var b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.style.background = c[1]; b.setAttribute('aria-label', c[0] + ' bubbles'); b.addEventListener('click', function () { setColor(i); }); sw.appendChild(b); });
    var bind = function (id, prop, outId, unit) { var el = $(id), out = $(outId); var f = function () { screen.style.setProperty(prop, el.value + 'px'); out.textContent = el.value + unit; }; el.addEventListener('input', f); f(); };
    bind('rad', '--r', 'radOut', ' dp'); bind('ts', '--ts', 'tsOut', ' pt'); bind('gap', '--gap', 'gapOut', ' dp');
    setTheme(2); setColor(0);
  }
})();
