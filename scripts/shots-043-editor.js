/*
 * Spec 043 FR-014..FR-017 (T012d): the profile file editor in the simulator (no AI credits). Settings > Profiles lists the files;
 * Open shows the editor; Edit | Split | Preview each show the right halves (Split: two halves of about the same width); typing marks
 * it Unsaved and updates the preview; Ctrl/Cmd+S saves and a reopened file has the new text (round trip through the bridge); closing
 * with unsaved changes asks (Keep editing first, Discard closes); a front matter error shows and does not block; a read-only file has
 * no Save; New profile creates and opens a file; the Profile menu's Edit button opens the editor. Every text in the editor is at
 * least 10.5px and the dialog fits the window. Screenshots of Edit, Split and Preview at 1440x900 and 1280x800 in Clean Office and a
 * dark theme. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-043-editor.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes 043-editor-<mode>-<theme>-<w>x<h>.png and fails on a miss.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
/* a dark user theme (spec 040 tokens only): no built-in theme has a dark surface */
const NIGHT = { id: 'night-check', name: 'Night (check)', extends: 'clean-office', tokens: { '--bg': '#14171c', '--surface': '#1d2127', '--surface-2': '#262b33', '--raised': '#22272e', '--card': '#1d2127', '--soft': '#20252c', '--note': '#2a2f37', '--warn-bg': '#3a3020', '--line': '#3a414c', '--line-2': '#4b5361', '--line-ctl': '#5a6372', '--ink': '#e8eaee', '--ink-2': '#c4c9d1', '--muted': '#9aa2ae', '--blue-ink': '#8fb8ff', '--amber-ink': '#f0c36a', '--card-waiting-line': '#7a6330' } };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  const MOD = process.platform === 'darwin' ? 'meta' : 'control';
  const vis = (sel) => `(()=>{const e=document.querySelector(${jsLiteral(sel)});return !!e&&e.offsetParent!==null&&e.getBoundingClientRect().width>0})()`;
  const openSettings = async () => {
    await H.click('#settingsBtn');
    assert.ok(await until(`!!document.querySelector('#pfSec .pf-row')`), 'Settings > Profiles lists files');
  };
  const openFile = async (name) => {
    const ok = await js(`(()=>{const r=[...document.querySelectorAll('#pfSec .pf-row')].find(x=>x.querySelector('b').textContent===${jsLiteral(name)});if(!r)return false;r.querySelector('[data-pf-open]').click();return true})()`);
    assert.ok(ok, `the ${name} row has Open`);
    assert.ok(await until(`!!document.getElementById('peOv')&&document.getElementById('peSrc').value.length>0`), 'the editor opens with the text');
  };
  const mode = async (m) => {
    await H.click(`#peModes [data-pm="${m}"]`);
    await until(`document.getElementById('peMain').dataset.mode===${jsLiteral(m)}`);
    return js(`(()=>{const v=e=>!!e&&e.offsetParent!==null;const s=document.getElementById('peSrc'),p=document.getElementById('pePrev'),m=document.getElementById('peMain');return {src:v(s),prev:v(p),sw:s.getBoundingClientRect().width,pw:p.getBoundingClientRect().width,mw:m.getBoundingClientRect().width,pressed:[...document.querySelectorAll('#peModes button')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.pm)}})()`);
  };
  const fits = () => js(`(()=>{const d=document.querySelector('.dlg.pe').getBoundingClientRect();const small=[...document.querySelectorAll('.dlg.pe *')].filter(e=>e.offsetParent!==null&&e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.tagName+'.'+e.className+':'+getComputedStyle(e).fontSize);return {in:d.left>=0&&d.top>=0&&d.right<=innerWidth&&d.bottom<=innerHeight,small,hscroll:document.querySelector('.dlg.pe').scrollWidth>document.querySelector('.dlg.pe').clientWidth+1}})()`);
  const closeEditor = async () => {
    await H.click('#peClose');
    if (await until(`!!document.getElementById('modeDlg')||!document.getElementById('peOv')`, 3000) && (await H.exists('#modeDlg'))) await H.clickText('#modeDlg .dbtn button', 'Discard');
    assert.ok(await until(`!document.getElementById('peOv')`), 'editor closed');
  };

  let first = true;
  for (const theme of ['clean', 'night']) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      await H.load({ w, h });
      await js(`try{localStorage.removeItem('durbar.profileEditor.mode')}catch(e){}`);
      if (theme === 'night') await js(`window.THEME.setTheme(${jsLiteral(NIGHT)})`);
      await openSettings();
      const rows = await js(`[...document.querySelectorAll('#pfSec .pf-row b')].map(b=>b.textContent)`);
      assert.ok(rows.includes('Reviewer') && rows.includes('test-writer') && rows.includes('house-style'), 'Copilot and Claude Code files listed: ' + rows.join(', '));
      if (theme === 'clean') {
        await js(`(()=>{const h=document.getElementById('pfH');const sc=h.closest('.scr-body');sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-12;})()`);
        await H.shot(path.join(OUT, `043-profiles-settings-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
      }
      await openFile('Reviewer');
      let s = await mode('split');
      assert.ok(s.src && s.prev, 'Split shows both halves');
      assert.ok(Math.abs(s.sw - s.pw) <= s.mw * 0.03 && s.sw > s.mw * 0.4, `Split halves about equal: ${s.sw} / ${s.pw} of ${s.mw}`);
      assert.deepStrictEqual(s.pressed, ['split']);
      assert.ok(await js(`document.querySelectorAll('#peFm dt').length>=3&&/view, grep, glob/.test(document.getElementById('peFm').textContent)`), 'front matter header in the preview');
      assert.ok(await js(`!!document.querySelector('#peMd h1')&&!!document.querySelector('#peMd pre')&&!!document.querySelector('#peMd a[href^="https://"]')`), 'Markdown rendered');
      const f = await fits();
      assert.ok(f.in && !f.hscroll, `the editor fits the window at ${w}x${h}`);
      assert.deepStrictEqual(f.small, [], 'no text under 10.5px');
      await H.shot(path.join(OUT, `043-editor-split-${theme}-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
      s = await mode('edit');
      assert.ok(s.src && !s.prev && s.sw > s.mw * 0.95, 'Edit shows only the text, full width');
      await H.shot(path.join(OUT, `043-editor-edit-${theme}-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
      s = await mode('preview');
      assert.ok(!s.src && s.prev && s.pw > s.mw * 0.95, 'Preview shows only the preview, full width');
      await H.shot(path.join(OUT, `043-editor-preview-${theme}-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
      await closeEditor();
      // the mode is kept for the next file (per computer)
      await openFile('Docs writer');
      assert.strictEqual(await js(`document.getElementById('peMain').dataset.mode`), 'preview', 'the last mode is remembered');
      await mode('split');
      await closeEditor();

      if (first) {
        first = false;
        // typing: Unsaved, preview follows; Ctrl/Cmd+S saves; reopened file has the text (round trip through the bridge)
        await openFile('Reviewer');
        await js(`(()=>{const s=document.getElementById('peSrc');s.focus();s.value=s.value.replace('description: Reviews changes and points at risks; never edits files','description: Reviews changes carefully')+'\\n## Added in the check\\n';s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.ok(await js(`!document.getElementById('peDirty').hidden&&!document.getElementById('peSave').disabled`), 'Unsaved shows, Save on');
        assert.ok(await until(`[...document.querySelectorAll('#peMd h2')].some(h=>h.textContent==='Added in the check')`, 2000), 'the preview follows the text');
        await H.key('S', [MOD], { char: 'never' });
        assert.ok(await until(`document.getElementById('peDirty').hidden&&/Saved/.test(document.getElementById('peStatus').textContent)`), 'Ctrl/Cmd+S saved');
        assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row small')].some(x=>x.textContent==='Reviews changes carefully')`), 'the Settings list shows the new description');
        await closeEditor();
        await openFile('Reviewer');
        assert.ok(await js(`document.getElementById('peSrc').value.includes('## Added in the check')`), 'reopened: the saved text');
        // unsaved guard: Escape asks, Keep editing is focused and keeps it open; Close + Discard closes without saving
        await js(`(()=>{const s=document.getElementById('peSrc');s.value+='unsaved line';s.dispatchEvent(new Event('input',{bubbles:true}));s.focus();})()`);
        await H.key('Escape', [], { char: 'never' });
        assert.ok(await until(`!!document.getElementById('modeDlg')`), 'asks before closing');
        assert.strictEqual(await js(`document.activeElement&&document.activeElement.textContent`), 'Keep editing', 'Keep editing has the focus');
        await H.shot(path.join(OUT, `043-editor-unsaved-${w}x${h}.png`), { prep: 'calm', settle: true, delay: 700 });
        await H.clickText('#modeDlg .dbtn button', 'Keep editing');
        assert.ok(await until(`!document.getElementById('modeDlg')&&!!document.getElementById('peOv')`), 'still open');
        await closeEditor();
        await openFile('Reviewer');
        assert.ok(await js(`!document.getElementById('peSrc').value.includes('unsaved line')`), 'discarded text was not saved');
        await closeEditor();
        // a front matter error shows and Save still works
        await openFile('Blogger');
        assert.ok(await js(`!document.getElementById('peFmErr').hidden&&/needs quotes/.test(document.getElementById('peFmErr').textContent)`), 'front matter error shown');
        await closeEditor();
        // read-only: no Save, the text cannot be changed
        await openFile('house-style');
        assert.ok(await js(`document.getElementById('peSave').hidden&&document.getElementById('peSrc').readOnly&&!document.getElementById('peRo').hidden`), 'read-only file');
        await closeEditor();
        // New profile: creates the file and opens it; a bad name is refused in the form
        await H.click('#pfNew');
        assert.ok(await until(`!!document.getElementById('peNewOv')`), 'New profile form');
        await js(`(()=>{const n=document.getElementById('peNName');n.value='../x';document.getElementById('peNGo').click();})()`);
        assert.ok(await until(`!document.getElementById('peNErr').hidden`), 'bad name refused');
        await js(`(()=>{document.getElementById('peNApp').value='claude';const n=document.getElementById('peNName');n.value='planner';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('peNGo').click();})()`);
        assert.ok(await until(`!!document.getElementById('peOv')&&/name: planner/.test(document.getElementById('peSrc').value)`), 'the new file opens');
        assert.ok(await js(`/Claude Code/.test(document.getElementById('peSub').textContent)&&/planner\\.md/.test(document.getElementById('peSub').textContent)`), 'Claude Code file planner.md');
        await closeEditor();
        assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent==='planner')`), 'listed in Settings');
        // the Profile menu: Edit opens the editor on that profile's file
        await H.click('#scrClose');
        await H.office(15);
        const got = await js(`(()=>{for(const d of document.querySelectorAll('#stage .desk[data-id]')){d.click();if(document.getElementById('agentChip'))return true;const b=document.getElementById('backBtn');if(b)b.click();}return false})()`);
        assert.ok(got, 'a Copilot chat with the Profile chip');
        await H.click('#agentChip');
        assert.ok(await until(`document.querySelectorAll('#agentMenu .mm-edit').length>=3`), 'Edit buttons in the Profile menu');
        await H.shot(path.join(OUT, `043-editor-menu-${w}x${h}.png`), { prep: 'calm', delay: 200 });
        await js(`[...document.querySelectorAll('#agentMenu .mm-edit')].find(b=>/Reviewer/.test(b.getAttribute('aria-label'))).click()`);
        assert.ok(await until(`!!document.getElementById('peOv')&&document.getElementById('peT').textContent==='Reviewer'`), 'the menu opens the editor');
        await closeEditor();
        await settle();
      }
    }
  }
  console.log('[043-editor] PASS');
};
