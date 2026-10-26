/* EA Summit 2026 talk (spec 050 FR-014): presenter keys (keyboard and clicker), answer reveal, video steps, black screen,
   hints, theme, HUD, video fallback. No network; localStorage only remembers light/dark. */
(function () {
  'use strict';
  /* The presenters, like players taking turns. Reassigning a part is one data-presenter="..." on its <section>;
     a handover card is made here wherever the presenter changes. */
  var PLAYERS = {
    vikram: { key: 'vikram', n: 1, name: 'Vikram', handle: 'vikramgorla', img: 'assets/art/player-vikram.svg' },
    paco: { key: 'paco', n: 2, name: 'Paco', handle: 'fjcabello', img: 'assets/art/player-paco.svg' },
    ruben: { key: 'ruben', n: 3, name: 'Ruben', handle: 'rubenlupi', img: 'assets/art/player-ruben.svg' },
    /* the two architects (owner 2026-10-26: no names or handles; `hud` is the short form in the HUD) */
    ea: { key: 'ea', n: 4, name: 'the Shy Architect', hud: 'Shy Architect', role: 'Enterprise Architect', handle: '', img: 'assets/art/player-ea.svg' },
    pea: { key: 'pea', n: 5, name: 'the Chief Architect', hud: 'Chief Architect', role: 'Principal Enterprise Architect', handle: '', img: 'assets/art/player-pea.svg' }
  };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  /* the line-up on the title and exit screens, from the same table */
  Array.prototype.forEach.call(document.querySelectorAll('[data-players]'), function (ul) {
    Object.keys(PLAYERS).forEach(function (k) {
      var P = PLAYERS[k], li = el('li'), img = el('img');
      img.src = P.img; img.alt = ''; img.width = 200; img.height = 124;
      li.appendChild(img);
      li.appendChild(el('b', '', 'P' + P.n + ' \u00b7 ' + P.name));
      li.appendChild(el('span', '', P.handle || P.role || ''));
      ul.appendChild(li);
    });
  });
  (function handovers() {
    var all = Array.prototype.slice.call(document.querySelectorAll('.slide')), last = null;
    all.forEach(function (s) {
      var who = s.getAttribute('data-presenter');
      if (!who || !Object.prototype.hasOwnProperty.call(PLAYERS, who)) return;
      if (last && who !== last) {
        var P = PLAYERS[who], card = document.createElement('section');
        card.className = 'slide handover';
        card.id = 'turn-' + s.id;
        card.setAttribute('data-presenter', P.key);
        card.setAttribute('data-title', 'Player ' + P.n + ' \u00b7 ' + P.name);
        /* built with createElement/textContent: nothing read from the page goes into HTML */
        var inner = el('div', 'inner'), img = el('img');
        img.src = P.img; img.alt = ''; img.width = 200; img.height = 124;
        inner.appendChild(el('p', 'kicker', 'Player change'));
        inner.appendChild(img);
        inner.appendChild(el('p', 'turn', 'PLAYER ' + P.n + ' \u00b7 ' + P.name.toUpperCase()));
        inner.appendChild(el('p', 'turn-sub', (P.handle || P.role || '') + ' \u2014 YOUR TURN \u25BA'));
        card.appendChild(inner);
        s.parentNode.insertBefore(card, s);
      }
      last = who;
    });
  })();
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var level = document.getElementById('level'), hudTitle = document.getElementById('hudTitle'), bar = document.getElementById('progress');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cur = 0, lockUntil = 0;

  function fromScroll() {
    var line = window.innerHeight * 0.35, idx = 0;
    for (var i = 0; i < slides.length; i++) if (slides[i].getBoundingClientRect().top <= line) idx = i;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) idx = slides.length - 1;
    return idx;
  }
  function show() {
    var s = slides[cur];
    var who = s.getAttribute('data-presenter');
    var P = who && Object.prototype.hasOwnProperty.call(PLAYERS, who) ? PLAYERS[who] : null;
    if (level) level.textContent = (P ? 'P' + P.n + ' ' + (P.hud || P.name).toUpperCase() + ' \u00b7 ' : '') + 'LEVEL ' + (cur + 1) + '/' + slides.length;
    if (hudTitle) hudTitle.textContent = s.getAttribute('data-title') || '';
    if (bar) { bar.style.width = (100 * (cur + 1) / slides.length) + '%'; bar.parentNode.setAttribute('aria-valuenow', String(cur + 1)); bar.parentNode.setAttribute('aria-valuemax', String(slides.length)); }
  }
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    cur = i;
    lockUntil = Date.now() + (reduce ? 100 : 1600); /* a smooth scroll in flight must not move `cur` back (released early by scrollend) */
    var top = slides[i].getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    try { history.replaceState(null, '', '#' + slides[i].id); } catch (e) { /* file:// or sandbox */ }
    slides[i].focus({ preventScroll: true });
    show();
  }
  slides.forEach(function (s) { if (!s.hasAttribute('tabindex')) s.setAttribute('tabindex', '-1'); s.setAttribute('aria-label', s.getAttribute('data-title') || ''); });

  /* a slide taller than the window (a small Teams share): next/previous first scroll within it */
  function scrollWithin(dir) {
    var r = slides[cur].getBoundingClientRect(), h = window.innerHeight;
    if (dir > 0 && r.bottom > h + 8) { window.scrollBy({ top: Math.min(r.bottom - h, h * 0.8), behavior: reduce ? 'auto' : 'smooth' }); lockUntil = Date.now() + 1200; return true; }
    if (dir < 0 && r.top < -8) { window.scrollBy({ top: Math.max(r.top, -h * 0.8), behavior: reduce ? 'auto' : 'smooth' }); lockUntil = Date.now() + 1200; return true; }
    return false;
  }

  function reveal(sec, on) {
    var btn = sec.querySelector('.reveal'), why = sec.querySelector('.why');
    if (!btn) return;
    var open = on === undefined ? btn.getAttribute('aria-expanded') !== 'true' : on;
    sec.classList.toggle('revealed', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide' : 'The new way';
    if (why) why.hidden = !open;
  }
  document.querySelectorAll('.quiz').forEach(function (sec) {
    var btn = sec.querySelector('.reveal');
    if (btn) btn.addEventListener('click', function () { reveal(sec); });
  });

  var video = document.getElementById('talkVideo'), videoOk = !!video, playRefused = false;
  function videoSlide() { return video && slides[cur].contains(video); }

  /* one "next" from a keyboard or a presenter remote: reveal, play, scroll within, or advance */
  function next() {
    var s = slides[cur];
    if (s.classList.contains('quiz') && !s.classList.contains('revealed')) { reveal(s, true); return; }
    if (videoSlide() && videoOk) {
      if (video.paused && !video.ended && !playRefused) { var p = video.play(); if (p && p.catch) p.catch(function () { playRefused = true; /* refused: the next press moves on; the presenter can click play */ }); return; }
      if (!video.paused) video.pause();
    }
    if (scrollWithin(1)) return;
    go(cur + 1);
  }
  function prev() {
    if (videoSlide() && videoOk && !video.paused) video.pause();
    if (scrollWithin(-1)) return;
    go(cur - 1);
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('talk-theme', t); } catch (e) { /* storage blocked: fine */ }
  }
  try { var saved = localStorage.getItem('talk-theme'); if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* ignore */ }
  function black(on) { document.body.classList.toggle('black', on === undefined ? !document.body.classList.contains('black') : on); }

  /* capture phase on window: the video's own controls or a clicked button never swallow the presenter's keys */
  window.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key;
    var handled = true;
    if (document.body.classList.contains('black') && k !== 'b' && k !== 'B' && k !== '.' && k !== 'Escape') { black(false); }
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === 'Enter' || (k === ' ' && !e.shiftKey)) next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) prev();
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'b' || k === 'B' || k === '.') black();
    else if (k === 'Escape') black(false);
    else if (k === 'F5') { /* clickers send F5 / Shift+F5 for "start slideshow": already presenting */ }
    else if (k === 'h' || k === 'H') document.body.classList.toggle('no-hints');
    else if (k === 't' || k === 'T') {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      setTheme(dark ? 'light' : 'dark');
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  var pb = document.getElementById('prev'), nb = document.getElementById('next');
  if (pb) pb.addEventListener('click', function () { prev(); pb.blur(); });
  if (nb) nb.addEventListener('click', function () { next(); nb.blur(); });
  window.addEventListener('scroll', function () {
    if (Date.now() < lockUntil) return;
    var i = fromScroll();
    if (i !== cur) { cur = i; show(); }
  }, { passive: true });
  window.addEventListener('scrollend', function () { lockUntil = 0; });
  window.addEventListener('resize', show);
  var start = location.hash ? slides.findIndex(function (s) { return '#' + s.id === location.hash; }) : -1;
  cur = start >= 0 ? start : fromScroll();
  show();

  /* the video, captions and poster are dropped in later: until then show a placeholder, not a broken player */
  if (video) {
    var missing = document.querySelector('.video-missing'), links = document.getElementById('videoLinks'), vhint = document.getElementById('videoHint');
    var fail = function () { videoOk = false; video.hidden = true; if (missing) missing.hidden = false; if (links) links.hidden = true; if (vhint) vhint.hidden = true; };
    var src = video.querySelector('source');
    if (src) src.addEventListener('error', fail);
    video.addEventListener('error', fail);
    if (video.networkState === 3) fail(); /* NETWORK_NO_SOURCE before this script ran */
    video.addEventListener('play', function () { if (vhint) vhint.textContent = '► next again: on to the next slide'; });
    video.addEventListener('ended', function () { if (vhint) vhint.textContent = '► press next to continue'; });
  }
})();
