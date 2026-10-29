/* Host sheet (spec 050 FR-014): copy a poll's question and options, one per line, for a Teams poll. */
(function () {
  'use strict';
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'vh';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var poll = btn.closest('.poll'), pre = poll.querySelector('pre'), note = poll.querySelector('.copied');
      var text = pre.textContent.replace(/\r/g, '').trim();
      if (btn.getAttribute('data-what') === 'q') text = text.split('\n')[0];
      var done = function (ok) { if (note) { note.textContent = ok ? 'Copied.' : 'Copy failed: select the text and press Ctrl+C.'; setTimeout(function () { note.textContent = ''; }, 2500); } };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
      else done(fallbackCopy(text));
    });
  });
})();
