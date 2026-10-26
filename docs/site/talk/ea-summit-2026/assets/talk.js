/* "LEVEL UP, ARCHITECT" talk, Barcelona (spec 050 FR-014): presenter keys (keyboard and clicker), answer reveal, video steps, black screen,
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
        inner.appendChild(el('p', 'kicker', 'LEVEL UP! \u00b7 player change'));
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
  /* ---------- original 8-bit sounds, made live with the Web Audio API (no audio files, no network) ----------
     Nothing here copies or imitates a game's melody: short envelopes on square/triangle/noise, plain triads and sweeps. */
  var SND = (function () {
    var AC = null, master = null, loop = null, started = false;
    var muted = false;
    try { muted = localStorage.getItem('talk-mute') === '1'; } catch (e) { /* storage blocked */ }
    if (/nosound/.test(location.hash)) muted = true;
    var VOL = 0.15;
    function ctx() {
      if (AC) return AC;
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AC = new C(); master = AC.createGain(); master.gain.value = muted ? 0 : VOL; master.connect(AC.destination);
      return AC;
    }
    function hz(semi) { return 440 * Math.pow(2, semi / 12); } /* semitones from A4 */
    function tone(f, t, dur, type, vol, f2) {
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(t, dur, vol, out) {
      var n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = AC.createBufferSource(), g = AC.createGain();
      src.buffer = buf; g.gain.setValueAtTime(vol || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(g); g.connect(out || master); src.start(t);
    }
    function ok() { return !muted && ctx() && AC.state !== 'closed'; }
    function now() { return AC.currentTime + 0.01; }
    var api = {
      unlock: function () {
        if (!ctx()) return false;
        if (AC.state === 'suspended') AC.resume();
        var first = !started; started = true; return first;
      },
      muted: function () { return muted; },
      toggle: function () {
        muted = !muted;
        try { localStorage.setItem('talk-mute', muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, 0.02);
        if (muted) api.stopLoop();
        return muted;
      },
      blip: function (dir) { if (!ok()) return; var t = now(); tone(dir > 0 ? 990 : 740, t, 0.05, 'square', 0.12); },
      player: function () { if (!ok()) return; var t = now(); tone(hz(3), t, 0.07, 'square', 0.18); tone(hz(10), t + 0.08, 0.1, 'square', 0.18); },
      powerOn: function () {
        if (!ok()) return; var t = now();
        tone(110, t, 0.35, 'square', 0.18, 880);
        [0, 4, 7, 12].forEach(function (s, k) { tone(hz(3 + s), t + 0.36 + k * 0.07, 0.12, 'triangle', 0.3); });
        tone(hz(15), t + 0.66, 0.5, 'triangle', 0.22); tone(hz(10), t + 0.66, 0.5, 'square', 0.06);
      },
      newWay: function () { if (!ok()) return; var t = now(); [0, 4, 7, 12, 16].forEach(function (s, k) { tone(hz(15 + s), t + k * 0.05, 0.14, 'square', 0.16); }); },
      twist: function () {
        if (!ok()) return; var t = now();
        tone(520, t, 0.7, 'square', 0.16, 110); noise(t + 0.7, 0.18, 0.08);
        tone(hz(5), t + 1.05, 0.09, 'square', 0.16); tone(hz(12), t + 1.15, 0.09, 'square', 0.16); tone(hz(17), t + 1.25, 0.3, 'triangle', 0.25);
      },
      warn: function () { if (!ok()) return; var t = now(); for (var k = 0; k < 2; k++) { tone(392, t + k * 0.5, 0.2, 'square', 0.16); tone(330, t + k * 0.5 + 0.22, 0.24, 'square', 0.16); } },
      clear: function () {
        if (!ok()) return; var t = now();
        [0, 4, 7, 12, 16, 19, 24].forEach(function (s, k) { tone(hz(-9 + s + 12), t + k * 0.08, 0.16, 'square', 0.14); });
        [0, 4, 7, 12].forEach(function (s) { tone(hz(3 + s), t + 0.62, 2.2, 'triangle', 0.18); });
        noise(t + 0.62, 0.25, 0.05);
      },
      /* three calm original loops at 100 bpm: 16 eighth notes (2 bars) of bass + soft arpeggio + a quiet hat */
      startLoop: function (which) {
        api.stopLoop();
        if (!ok()) return;
        var P = [
          { bass: [-21, null, -21, null, -16, null, -16, null, -19, null, -19, null, -14, null, -16, null], arp: [3, 7, 10, 7, 3, 7, 12, 7, 2, 7, 10, 7, 5, 9, 12, 9] },
          { bass: [-24, null, null, -24, -17, null, null, -17, -22, null, null, -22, -19, null, -17, null], arp: [0, null, 7, null, 12, null, 7, null, 2, null, 9, null, 14, null, 9, null] },
          { bass: [-19, null, -19, null, -19, null, -12, null, -21, null, -21, null, -16, null, -14, null], arp: [5, 9, 12, 16, 12, 9, 5, 9, 3, 7, 10, 14, 10, 7, 5, 7] }
        ][which % 3];
        var g = AC.createGain(); g.gain.value = 0.0001; g.connect(master); g.gain.exponentialRampToValueAtTime(0.5, AC.currentTime + 0.8);
        var step = 0.3, next = AC.currentTime + 0.1, i = 0;
        function note(f, t, dur, type, vol) {
          var o = AC.createOscillator(), e = AC.createGain();
          o.type = type; o.frequency.value = f;
          e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(e); e.connect(g); o.start(t); o.stop(t + dur + 0.02);
        }
        var timer = setInterval(function () {
          while (next < AC.currentTime + 0.25) {
            var k = i % 16;
            if (P.bass[k] !== null) note(hz(P.bass[k]), next, 0.26, 'triangle', 0.5);
            if (P.arp[k] !== null) note(hz(P.arp[k]), next, 0.12, 'square', 0.08);
            if (k % 2 === 1) noise(next, 0.03, 0.03, g);
            next += step; i++;
          }
        }, 60);
        loop = { g: g, timer: timer };
      },
      stopLoop: function () {
        if (!loop) return;
        var l = loop; loop = null;
        try { l.g.gain.cancelScheduledValues(AC.currentTime); l.g.gain.setTargetAtTime(0.0001, AC.currentTime, 0.25); } catch (e) { /* ignore */ }
        setTimeout(function () { clearInterval(l.timer); try { l.g.disconnect(); } catch (e) { /* ignore */ } }, 1200);
      }
    };
    return api;
  })();
  var cloudN = 0;
  function enterSlide(s, dir) {
    SND.stopLoop();
    if (s.classList.contains('handover')) SND.player(); else SND.blip(dir);
    if (s.id === 'reveal' || s.id === 'ourorg') SND.twist();
    if (s.id === 'exit') SND.clear();
    if (s.id === 'warning') SND.warn();
    var wc = s.querySelector('.pollbar');
    if (wc && !s.classList.contains('revealed')) { var m = /(\d+)/.exec(s.getAttribute('data-title') || ''); SND.startLoop(m ? +m[1] : cloudN++); }
  }


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
    var was = cur;
    cur = i;
    if (i !== was) enterSlide(slides[i], i > was ? 1 : -1);
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
    if (open) { SND.stopLoop(); SND.newWay(); }
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
    if (SND.unlock() && cur === 0 && k !== 'm' && k !== 'M') SND.powerOn(); /* browsers allow sound only after a key press */
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
    else if (k === 'm' || k === 'M') { var mu = SND.toggle(); var note = document.getElementById('soundNote'); if (note) note.textContent = mu ? '\u266A sound off \u2014 press M for sound' : '\u266A sound on \u2014 press M to mute'; }
    else if (k === 't' || k === 'T') {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      setTheme(dark ? 'light' : 'dark');
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('pointerdown', function () { SND.unlock(); }, true);
  var sn = document.getElementById('soundNote');
  if (sn && SND.muted()) sn.textContent = '\u266A sound off \u2014 press M for sound';
  var pb = document.getElementById('prev'), nb = document.getElementById('next');
  if (pb) pb.addEventListener('click', function () { prev(); pb.blur(); });
  if (nb) nb.addEventListener('click', function () { next(); nb.blur(); });
  window.addEventListener('scroll', function () {
    if (Date.now() < lockUntil) return;
    var i = fromScroll();
    if (i !== cur) { var was = cur; cur = i; show(); enterSlide(slides[i], i > was ? 1 : -1); }
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
    video.addEventListener('play', function () { SND.stopLoop(); });
    video.addEventListener('play', function () { if (vhint) vhint.textContent = '► next again: on to the next slide'; });
    video.addEventListener('ended', function () { if (vhint) vhint.textContent = '► press next to continue'; });
  }
})();
