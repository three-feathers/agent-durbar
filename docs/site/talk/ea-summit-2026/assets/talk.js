/* EA Summit 2026 talk (spec 050 FR-014): section keys, answer reveal, hints, theme, video fallback. No network, no storage needed. */
(function () {
  'use strict';
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var count = document.getElementById('count');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function current() {
    var line = window.innerHeight * 0.35, idx = 0;
    for (var i = 0; i < slides.length; i++) if (slides[i].getBoundingClientRect().top <= line) idx = i;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) idx = slides.length - 1;
    return idx;
  }
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    var top = slides[i].getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    try { history.replaceState(null, '', '#' + slides[i].id); } catch (e) { /* file:// or sandbox */ }
    /* focus the section, not its reveal button: Space must always mean "next", never "reveal" */
    slides[i].focus({ preventScroll: true });
  }
  function show() { if (count) count.textContent = (current() + 1) + ' / ' + slides.length; }
  slides.forEach(function (s) { if (!s.hasAttribute('tabindex')) s.setAttribute('tabindex', '-1'); s.setAttribute('aria-label', s.getAttribute('data-title') || ''); });

  function reveal(sec, on) {
    var btn = sec.querySelector('.reveal'), why = sec.querySelector('.why');
    if (!btn) return;
    var open = on === undefined ? btn.getAttribute('aria-expanded') !== 'true' : on;
    sec.classList.toggle('revealed', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide answer' : 'Reveal answer';
    if (why) why.hidden = !open;
  }
  document.querySelectorAll('.quiz').forEach(function (sec) {
    var btn = sec.querySelector('.reveal');
    if (btn) btn.addEventListener('click', function () { reveal(sec); });
  });

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('talk-theme', t); } catch (e) { /* storage blocked: fine */ }
  }
  try { var saved = localStorage.getItem('talk-theme'); if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* ignore */ }

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'VIDEO' || tag === 'SELECT') return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); go(current() + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); go(current() - 1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(slides.length - 1); }
    else if (k === 'Enter' && tag !== 'BUTTON' && tag !== 'A') { var s = slides[current()]; if (s.classList.contains('quiz')) { e.preventDefault(); reveal(s); } }
    else if (k === 'h' || k === 'H') document.body.classList.toggle('no-hints');
    else if (k === 't' || k === 'T') {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      setTheme(dark ? 'light' : 'dark');
    }
  });
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  if (prev) prev.addEventListener('click', function () { go(current() - 1); });
  if (next) next.addEventListener('click', function () { go(current() + 1); });
  window.addEventListener('scroll', show, { passive: true });
  window.addEventListener('resize', show);
  show();

  /* the video, captions and poster are dropped in later: until then show a placeholder, not a broken player */
  var video = document.getElementById('talkVideo');
  if (video) {
    var missing = document.querySelector('.video-missing'), links = document.getElementById('videoLinks');
    var fail = function () { video.hidden = true; if (missing) missing.hidden = false; if (links) links.hidden = true; };
    var src = video.querySelector('source');
    if (src) src.addEventListener('error', fail);
    video.addEventListener('error', fail);
    if (video.networkState === 3) fail(); /* NETWORK_NO_SOURCE before this script ran */
  }
})();
