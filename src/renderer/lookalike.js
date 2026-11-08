/* Lookalike letters in the words of a permission request (spec 003 FR-113..FR-116, issue #1300): a host, a program or a tool name that reads like
   another one because a letter comes from another script, is a compatibility form or is on a short list of lookalikes. Pure: no DOM, no dependency,
   no network. In the page: window.DurbarLookalike (loaded before liveact.js, which reads it on each call); in Node: module.exports.
   check(text, kind) -> {findings, hosts}. kind is spec 097 FR-318's: `shell`, `tool` or `other`. Closed lists only, no confusables table (owner decision 3). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarLookalike=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const CAP=10000; /* spec 097 FR-318's cap: characters looked at */
  /* the FR-318 control and invisible characters (liveact.js PCTRL_T, the same source: test-lookalike checks it): whitespace ones separate words, the rest are left out,
     so a zero-width character can never split one token into two that each pass */
  const PCTRL_T=/[^\S ]|[\x00-\x1f\x7f-\x9f\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u3164\u115f\u1160\uffa0]/u;
  const WS=/[^\S ]/u, TOK=/[\p{L}\p{M}\p{N}]/u, LET=/\p{L}/u, ND=/\p{Nd}/u, NONASCII=/[^\x00-\x7f]/;
  /* every Unicode script name V8 knows (PropertyValueAliases); Common and Inherited are no script */
  const SCRIPTS='Adlam Ahom Anatolian_Hieroglyphs Arabic Armenian Avestan Balinese Bamum Bassa_Vah Batak Bengali Bhaiksuki Bopomofo Brahmi Braille Buginese Buhid Canadian_Aboriginal Carian Caucasian_Albanian Chakma Cham Cherokee Chorasmian Coptic Cuneiform Cypriot Cypro_Minoan Cyrillic Deseret Devanagari Dives_Akuru Dogra Duployan Egyptian_Hieroglyphs Elbasan Elymaic Ethiopic Georgian Glagolitic Gothic Grantha Greek Gujarati Gunjala_Gondi Gurmukhi Han Hangul Hanifi_Rohingya Hanunoo Hatran Hebrew Hiragana Imperial_Aramaic Inscriptional_Pahlavi Inscriptional_Parthian Javanese Kaithi Kannada Katakana Kawi Kayah_Li Kharoshthi Khitan_Small_Script Khmer Khojki Khudawadi Lao Latin Lepcha Limbu Linear_A Linear_B Lisu Lycian Lydian Mahajani Makasar Malayalam Mandaic Manichaean Marchen Masaram_Gondi Medefaidrin Meetei_Mayek Mende_Kikakui Meroitic_Cursive Meroitic_Hieroglyphs Miao Modi Mongolian Mro Multani Myanmar Nabataean Nag_Mundari Nandinagari New_Tai_Lue Newa Nko Nushu Nyiakeng_Puachue_Hmong Ogham Ol_Chiki Old_Hungarian Old_Italic Old_North_Arabian Old_Permic Old_Persian Old_Sogdian Old_South_Arabian Old_Turkic Old_Uyghur Oriya Osage Osmanya Pahawh_Hmong Palmyrene Pau_Cin_Hau Phags_Pa Phoenician Psalter_Pahlavi Rejang Runic Samaritan Saurashtra Sharada Shavian Siddham SignWriting Sinhala Sogdian Sora_Sompeng Soyombo Sundanese Syloti_Nagri Syriac Tagalog Tagbanwa Tai_Le Tai_Tham Tai_Viet Takri Tamil Tangsa Tangut Telugu Thaana Thai Tibetan Tifinagh Tirhuta Toto Ugaritic Vai Vithkuqi Wancho Warang_Citi Yezidi Yi Zanabazar_Square'.split(' ');
  const SCX=[],SC=[];for(const s of SCRIPTS){try{SCX.push([s,new RegExp('\\p{scx='+s+'}','u')]);SC.push([s,new RegExp('\\p{sc='+s+'}','u')]);}catch(e){/* an older engine without this script: it counts for none */}}
  const scxMemo=new Map(), scMemo=new Map();
  /* Script_Extensions of one character, as a list of names ([] for Common and Inherited); memoized per code point, so the cost is per distinct letter */
  const scxOf=c=>{if(c<'\x80')return /[A-Za-z]/.test(c)?['Latin']:[];let v=scxMemo.get(c);if(!v){v=SCX.filter(x=>x[1].test(c)).map(x=>x[0]);scxMemo.set(c,v);}return v;};
  /* the Script value, for the marker's name only */
  const scOf=c=>{let v=scMemo.get(c);if(v===undefined){const h=SC.find(x=>x[1].test(c));v=h?h[0]:(scxOf(c)[0]||'Common');scMemo.set(c,v);}return v;};
  /* UTS #39 resolved scripts: Han, Hiragana, Katakana, Bopomofo and Hangul also count as the writing systems they belong to */
  const aug=s=>{const o=new Set(s);if(o.has('Han')){o.add('Jpan');o.add('Kore');o.add('Hanb');}if(o.has('Hiragana')||o.has('Katakana'))o.add('Jpan');if(o.has('Bopomofo'))o.add('Hanb');if(o.has('Hangul'))o.add('Kore');return o;};
  const inter=(a,b)=>{const o=new Set();for(const x of a)if(b.has(x))o.add(x);return o;};
  const NOT_WITH_LATIN=new Set(['Cyrillic','Greek','Cherokee']);
  /* FR-114 (d), name positions only: Latin letters that look like plain ones (dotless i and j, the click letters, IPA Extensions, Phonetic Extensions,
     Latin Extended-D and -E), and Cyrillic and Greek letters that look like Latin ones (a token written only in them, every letter on the list) */
  const LATIN_LOOK=cp=>cp===0x131||cp===0x237||(cp>=0x1c0&&cp<=0x1c3)||(cp>=0x250&&cp<=0x2af)||(cp>=0x1d00&&cp<=0x1dbf)||(cp>=0xa720&&cp<=0xa7ff)||(cp>=0xab30&&cp<=0xab6f);
  const CYRL_LOOK=new Set([0x430,0x441,0x435,0x4bb,0x456,0x458,0x43e,0x440,0x455,0x443,0x445,0x501,0x51b,0x51d,0x4cf,
    0x410,0x412,0x415,0x41a,0x41c,0x41d,0x41e,0x420,0x421,0x422,0x425,0x405,0x406,0x408,0x4ae,0x51a,0x51c,0x4ba,0x4c0]);
  const GREK_LOOK=new Set([0x3bf,0x3bd,0x3b1,0x3b9,0x3ba,0x3c5,0x3c1,
    0x391,0x392,0x395,0x396,0x397,0x399,0x39a,0x39c,0x39d,0x39f,0x3a1,0x3a4,0x3a5,0x3a7]);
  const WIDTH_SUP=cp=>(cp>=0xff00&&cp<=0xffef)||cp===0xb2||cp===0xb3||cp===0xb9||(cp>=0x2070&&cp<=0x209f);
  const hex=cp=>'U+'+cp.toString(16).toUpperCase().padStart(4,'0');
  const WIN=12, HOST_MAX=80, TIP_MAX=1000;
  const cutS=(t,n)=>{const a=Array.from(String(t));return a.length>n?a.slice(0,n-1).join('')+'\u2026':String(t);};
  const sname=s=>String(s).replace(/_/g,' ');
  /* the visible marker after a flagged character (spec 097 FR-318's shape): [[U+0435 Cyrillic]] in the white square brackets U+27E6 and U+27E7 */
  const marker=f=>'\u27e6'+hex(f.cp)+' '+sname(f.script)+'\u27e7';
  /* the zero of a decimal digit: Unicode keeps each system's ten digits in a row from its zero, and rows of ten follow each other */
  const zeroOf=cp=>{let s=cp;while(s>0&&ND.test(String.fromCodePoint(s-1))&&cp-s<200)s--;return s+Math.floor((cp-s)/10)*10;};
  /* the text the rules read: controls out (whitespace ones as a line break), with where each character came from */
  function clean(text){
    const out=[],at=[];let i=0;
    for(const c of text){if(PCTRL_T.test(c)){if(WS.test(c)){out.push('\n');at.push(i);}}else{out.push(c);at.push(i);}i+=c.length;}
    return {chars:out,at};
  }
  /* FR-115: name positions as [start,end) character ranges of the cleaned text */
  function names(chars,kind){
    const r=[];const n=chars.length;
    if(kind==='tool'){r.push([0,n]);return r;} /* `server > tool` (the U+203A sign), `server/tool`, a custom tool: every word is a name */
    if(kind==='shell'){
      let i=0;if(chars.slice(0,4).join('')==='run ')i=4; /* the card's `run ` before the command */
      let want=true;
      while(i<n){const c=chars[i];
        if(c===';'||c==='|'||c==='&'||c==='\n'||c==='`'||(c==='('&&i>0&&chars[i-1]==='$')){want=true;i++;continue;}
        if(c===' '||c==='$'&&chars[i+1]==='('){i++;continue;}
        if(want){const s=i;while(i<n&&!/[ ;|&\n`]/.test(chars[i])&&!(chars[i]==='$'&&chars[i+1]==='('))i++;r.push([s,i]);want=false;continue;}
        i++;}
    }
    return r;
  }
  /* FR-116: every scheme://host (userinfo and port left out), and the bare host of a `fetch host` grant label. In a shell command (review fix rounds 1
     and 2 of #1300) also a host without a scheme, but only as an argument of a network program, never inside quotes: `user@host` (not an all-digit
     version such as `pkg@1.2.3`), `host.tld:path` (scp, rsync, sftp, git clone/fetch/pull/push), `host.tld/...` or `host.tld:port` (curl, wget...),
     a bare `host.tld` (ssh, ping, nc...). Anything else, a file name like `notes.txt:12` or `name.io/x` included, is not a host. */
  const AT_HOST=/^[^@\/\s]+@([^@\/\s:]+)/, DOTTED=/^([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)(?=$|[:\/])/u;
  const NET_URL=new Set(['curl','wget','http','https','xh','aria2c','lftp','httpie']), NET_COPY=new Set(['scp','rsync','sftp']),
    NET_HOST=new Set(['ssh','mosh','telnet','ping','ping6','nc','ncat','netcat','dig','nslookup','host','traceroute','tracepath','ftp','ssh-copy-id','whois']),
    GIT_NET=new Set(['clone','fetch','pull','push','ls-remote','remote','submodule']);
  /* the words of a shell command outside quotes, grouped by command (a new command after ; | & or a line break). Fix round 3: a backslash outside single
     quotes escapes the next character (so `"a\"b"` does not leave a quote open), and `$(...)` or a backtick pair is read as commands of its own while the
     word around it goes on (so `ssh $(echo) host` stays one command). Linear: every character is read once. */
  function shellCmds(s){
    const cmds=[];const n=s.length;
    const run=(from,to,stopAt,depth)=>{ /* reads s[from..to) and returns where it stopped (a ')' or '`' that closes a substitution, or `to`) */
      let cur=[],q='',w=-1,i=from;
      const end=k=>{if(w>=0){cur.push({x:s.slice(w,k),i:w});w=-1;}};
      const flush=()=>{if(cur.length)cmds.push(cur);cur=[];};
      for(;i<to;i++){const c=s[i];
        if(q==="'"){if(c==="'")q='';continue;}
        if(c==='\\'){if(w<0&&!q)w=i;i++;continue;} /* the escaped character belongs to the word (or to the quoted text) */
        if(q){if(c===q)q='';continue;}
        if(c===stopAt){end(i);flush();return i;}
        if(c==='$'&&s[i+1]==='('&&depth<32){if(w<0)w=i;i=run(i+2,to,')',depth+1);continue;} /* at most 32 levels deep: the stack stays small */
        if(c==='`'&&stopAt!=='`'&&depth<32){if(w<0)w=i;i=run(i+1,to,'`',depth+1);continue;}
        if(c==='"'||c==="'"){end(i);q=c;continue;}
        if(c===';'||c==='|'||c==='&'||c==='\n'||c==='('||c===')'){end(i);flush();continue;}
        if(c===' '||c==='<'||c==='>'){end(i);continue;}
        if(w<0)w=i;}
      end(Math.min(i,to));flush();return to;};
    run(s.slice(0,4)==='run '?4:0,n,'',0);
    return cmds;
  }
  /* wrappers that run another program, and their options that take a separate value (fix round 3: `sudo -u root ssh h`, `xargs ssh h`, `strace -e x ssh h`) */
  const WRAP_VAL={sudo:'ughpCDrtUT',doas:'uC',env:'uCS',nohup:'',time:'fo',command:'',exec:'a',nice:'n',timeout:'sk',torsocks:'aPu',proxychains:'f',proxychains4:'f',builtin:'',
    xargs:'nILPdsEa',watch:'n',strace:'eopsaPIbuE',ltrace:'eopsun',stdbuf:'ioe',ionice:'cnp',chrt:'',taskset:'',unbuffer:'',chroot:'',runuser:'ug',su:'cs',flock:'wEc'};
  const CONTAINER=new Set(['kubectl','docker','podman','oc','nerdctl']);
  const base=x=>x.slice(Math.max(x.lastIndexOf('/'),x.lastIndexOf('\\'))+1).toLowerCase().replace(/\.exe$/,'');
  /* the index of the program a command runs, past env assignments, numbers, wrappers with their options, and a container's `--` */
  function progAt(ws){
    let j=0;
    for(let guard=0;guard<ws.length+1&&j<ws.length;guard++){
      const x=ws[j].x,b=base(x);
      if(/^[A-Za-z_][A-Za-z0-9_]*=/.test(x)||/^[\d.]+[smhd]?$/.test(x)){j++;continue;}
      if(Object.prototype.hasOwnProperty.call(WRAP_VAL,b)){const vals=WRAP_VAL[b];j++;
        while(j<ws.length&&/^-/.test(ws[j].x)){const o=ws[j].x;j++;if(o==='--')break;if(/^-[A-Za-z]$/.test(o)&&vals.indexOf(o[1])>=0)j++;}continue;}
      if(CONTAINER.has(b)){const k=ws.findIndex((o,m)=>m>j&&o.x==='--');if(k>j){j=k+1;continue;}}
      break;}
    return j;
  }
  const hostSpanOf=(x,cls)=>{ /* [start,end) of the host in one argument word, or null */
    const a=AT_HOST.exec(x);if(a){if(/^[\d.]+$/.test(a[1]))return null;const st=a[0].length-a[1].length;return [st,st+a[1].length];}
    const d=DOTTED.exec(x);if(!d||!/\p{L}/u.test(d[1].slice(d[1].lastIndexOf('.')+1)))return null;
    const nx=x[d[1].length]||'';
    if(cls==='copy'&&nx!==':')return null;
    if(cls==='url'&&nx!=='/'&&nx!==':')return null;
    return [0,d[1].length];};
  function hostSpans(s,k){
    const r=[];const re=/[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/([^\s\/?#"'<>\\`]*)/g;let m;
    while((m=re.exec(s))){const auth=m[1];let st=m.index+m[0].length-auth.length;const at=auth.lastIndexOf('@');let h=at>=0?auth.slice(at+1):auth;if(at>=0)st+=at+1;
      if(h[0]!=='['){const p=h.search(/:[0-9]*$/);if(p>=0)h=h.slice(0,p);}if(h)r.push([st,st+h.length]);}
    if(!r.length){const f=/^fetch ([^\s\/?#"'<>\\`]+)$/.exec(s);if(f&&f[1].indexOf('://')<0)r.push([6,6+f[1].length]);}
    if(k==='shell')for(const ws of shellCmds(s)){
      const j=progAt(ws);if(j>=ws.length)continue;
      const prog=base(ws[j].x);
      let cls='';if(NET_URL.has(prog))cls='url';else if(NET_COPY.has(prog))cls='copy';else if(NET_HOST.has(prog))cls='host';
      else if(prog==='git'){let m=j+1;while(m<ws.length&&/^-/.test(ws[m].x)){if(/^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/.test(ws[m].x))m++;m++;} /* git -C d clone ... (fix round 3) */
        if(m<ws.length&&GIT_NET.has(ws[m].x))cls='copy';}
      if(!cls)continue;
      for(const o of ws.slice(j+1)){if(o.x.indexOf('://')>=0||/^-/.test(o.x))continue;const h=hostSpanOf(o.x,cls);if(h)r.push([o.i+h[0],o.i+h[1]]);}
    }
    return r;
  }
  /* the rules for one token (an array of characters); name: FR-114 (d) applies. Returns [{i, rule}] (i within the token) */
  function rules(tok,name){
    const out=new Map(), add=(i,rule)=>{if(!out.has(i))out.set(i,rule);};
    /* (a) mixed scripts, UTS #39 moderately restrictive */
    const lets=[];tok.forEach((c,i)=>{if(LET.test(c)){const s=scxOf(c);if(s.length)lets.push({i,s:aug(s)});}});
    if(lets.length>1){
      let all=new Set(lets[0].s);for(const l of lets)all=inter(all,l.s);
      if(!all.size){
        const rest=lets.filter(l=>!l.s.has('Latin'));let R=rest.length?new Set(rest[0].s):new Set();for(const l of rest)R=inter(R,l.s);
        const okMix=R.has('Jpan')||R.has('Hanb')||R.has('Kore')||[...R].some(x=>!NOT_WITH_LATIN.has(x)&&x!=='Latin');
        if(!okMix){
          const cnt=new Map();for(const l of lets)for(const x of l.s)cnt.set(x,(cnt.get(x)||0)+1);
          let main='',best=-1;for(const [x,k] of cnt)if(k>best||(k===best&&x==='Latin')){main=x;best=k;}
          if(lets.some(l=>l.s.has('Latin')))main='Latin'; /* Latin in a forbidden mix: the other script's letters are the odd ones (fix round 1: `\u0440\u0430\u0443\u0440\u0430l` marks the Cyrillic, not the l) */
          let any=false;for(const l of lets)if(!l.s.has(main)){add(l.i,'mixed');any=true;}
          if(!any)for(const l of lets)if(!l.s.has('Latin'))add(l.i,'mixed');
        }
      }
    }
    /* (b) compatibility forms: fullwidth, mathematical, ligatures, superscripts, circled */
    const t=tok.join('');
    /* outside name positions a width variant (U+FF00..U+FFEF: fullwidth digits, halfwidth kana) or a super- or subscript is ordinary text (Paco, fix round 1) */
    if(t.normalize('NFKC')!==t.normalize('NFC')){let any=false;tok.forEach((c,i)=>{if(c.normalize('NFKC')!==c.normalize('NFC')){any=true;if(name||!WIDTH_SUP(c.codePointAt(0)))add(i,'nfkc');}});if(!any){const j=tok.findIndex(c=>NONASCII.test(c));add(j<0?0:j,'nfkc');}}
    /* (c) digits of two decimal systems */
    const ds=[];tok.forEach((c,i)=>{if(ND.test(c))ds.push({i,z:zeroOf(c.codePointAt(0))});});
    if(ds.length>1){const cnt=new Map();for(const d of ds)cnt.set(d.z,(cnt.get(d.z)||0)+1);
      const arabicAscii=!name&&cnt.size===2&&cnt.has(0x30)&&(cnt.has(0x660)||cnt.has(0x6f0)); /* outside names: Arabic-Indic with ASCII digits is ordinary text (fix round 1) */
      if(cnt.size>1&&!arabicAscii){let main=0,best=-1;for(const [z,k] of cnt)if(k>best||(k===best&&z===0x30)){main=z;best=k;}for(const d of ds)if(d.z!==main)add(d.i,'digits');}}
    /* (d) lookalike letters in one script: name positions only (owner decision 2) */
    if(name){
      tok.forEach((c,i)=>{if(LET.test(c)&&LATIN_LOOK(c.codePointAt(0)))add(i,'lookalike');});
      const ls=tok.filter(c=>LET.test(c));
      for(const [sc,list] of [['Cyrillic',CYRL_LOOK],['Greek',GREK_LOOK]])
        if(ls.length&&ls.every(c=>{const s=scxOf(c);return s.length===1&&s[0]===sc&&list.has(c.codePointAt(0));}))tok.forEach((c,i)=>{if(LET.test(c))add(i,'lookalike');});
    }
    return [...out].map(([i,rule])=>({i,rule})).sort((a,b)=>a.i-b.i);
  }
  /* FR-113: {findings:[{token,index,char,cp,script,rule,marked}], hosts:[{shown,ascii,index}]}; index: within `text` (UTF-16 units) */
  function check(text,kind){
    let s=String(text==null?'':text);if(s.length>CAP)s=s.slice(0,CAP);
    const k=kind==='shell'||kind==='tool'?kind:'other';
    const {chars,at}=clean(s), n=chars.length, joined=chars.join('');
    /* character index -> UTF-16 offset in `joined`, for the host spans */
    const off=new Map();let o=0;chars.forEach((c,j)=>{off.set(o,j);o+=c.length;});off.set(o,n);
    const hs=hostSpans(joined,k).map(([a,b])=>[off.get(a),off.get(b)]).filter(([a,b])=>a!==undefined&&b!==undefined);
    const nm=names(chars,k).concat(hs), isName=new Uint8Array(n+1);for(const [a,b] of nm)for(let i=a;i<b;i++)isName[i]=1;
    const findings=[];
    let i=0;
    while(i<n){
      if(!TOK.test(chars[i])){i++;continue;}
      const st=i;while(i<n&&TOK.test(chars[i]))i++;
      const tok=chars.slice(st,i), name=tok.some((_,j)=>isName[st+j]===1);
      if(!tok.some(c=>NONASCII.test(c)))continue; /* plain ASCII: nothing to find */
      const fs=rules(tok,name);if(!fs.length)continue;
      const flagged=new Set(fs.map(f=>f.i));
      const token=tok.join('');
      /* `marked`: a window of the token around the letter (at most WIN letters each side, at most 3 markers), so the line stays short and linear (fix round 1) */
      const win=i0=>{const a=Math.max(0,i0-WIN),b=Math.min(tok.length,i0+WIN+1);let o=a>0?'\u2026':'',k2=0;
        for(let j=a;j<b;j++){o+=tok[j];if(flagged.has(j)&&k2<3&&(j===i0||Math.abs(j-i0)<=WIN)){o+=marker({cp:tok[j].codePointAt(0),script:scOf(tok[j])});k2++;}}return o+(b<tok.length?'\u2026':'');};
      const first=new Map();for(const f of fs)if(!first.has(f.rule))first.set(f.rule,win(f.i));
      for(const f of fs){const c=tok[f.i];findings.push({token,at:at[st],index:at[st+f.i],char:c,cp:c.codePointAt(0),script:scOf(c),rule:f.rule,marked:first.get(f.rule)});}
    }
    const hosts=[];
    for(const [a,b] of hs){
      const shown=chars.slice(a,b).join('');let ascii=null;
      try{ascii=new URL('https://'+shown+'/').hostname;}catch(e){ascii=null;}
      if(ascii===null||ascii===''){const c=chars[a];findings.push({token:shown,at:at[a],index:at[a],end:at[b-1]+chars[b-1].length,char:c,cp:c.codePointAt(0),script:scOf(c),rule:'host',marked:cutS(shown,HOST_MAX)});continue;}
      hosts.push({shown,ascii,index:at[a],end:at[b-1]+chars[b-1].length});
    }
    findings.sort((x,y)=>x.index-y.index);
    return {findings,hosts};
  }
  /* a host worth naming: what the network reads differs from what is shown (case aside), or a label is already punycode */
  const hostOdd=h=>!!h&&typeof h.ascii==='string'&&(String(h.shown).toLowerCase()!==h.ascii||h.ascii.split('.').some(l=>/^xn--/i.test(l)));
  /* FR-118: the card's plain line for one or more `look` results ({n, findings, hosts, inHidden, unchecked}), or '' */
  const LATIN_IN=/\p{scx=Latin}/u;
  const RULE_WORD={nfkc:'a styled or fullwidth form, not the plain letter',digits:'a digit from another number system',host:'a host name the network cannot read',lookalike:'a letter that looks like a plain Latin one'};
  function line(looks){
    const ls=(Array.isArray(looks)?looks:[looks]).filter(Boolean);
    if(!ls.length)return '';
    const items=[],seen=new Map();let unchecked=false,inHidden=false;const hosts=[],hseen=new Set();
    for(const l of ls){
      if(l.unchecked)unchecked=true;if(l.inHidden)inHidden=true;
      for(const f of l.findings||[]){const tk=String(f.token||''),key=f.rule+'\n'+tk.length+'\n'+tk.slice(0,32)+'\n'+tk.slice(-32); /* the token and rule, constant size (fix round 1: the whole marked token made this quadratic) */
        let it=seen.get(key);if(!it){it={rule:f.rule,script:f.script,token:tk.length>200?tk.slice(0,200):tk,marked:f.marked,cps:[],cpset:new Set()};seen.set(key,it);items.push(it);}
        if(!it.cpset.has(f.cp)){it.cpset.add(f.cp);if(it.cps.length<3)it.cps.push(f.cp);}}
      for(const h of l.hosts||[])if(hostOdd(h)&&!hseen.has(h.ascii)){hseen.add(h.ascii);hosts.push(h);}
    }
    const out=[];
    if(items.length){
      const desc=f=>f.rule==='mixed'?(f.script!=='Latin'&&LATIN_IN.test(f.token)?'a '+sname(f.script)+' letter, not the Latin one':'a '+sname(f.script)+' letter among letters of another script'):
        f.rule==='lookalike'&&f.script!=='Latin'?'a '+sname(f.script)+' letter that looks like a Latin one':RULE_WORD[f.rule]||'a lookalike letter';
      const shown=items.slice(0,5).map(f=>f.rule==='host'?'"'+f.marked+'" is '+desc(f):'"'+f.marked+'" has '+f.cps.map(hex).join(', ')+(f.cpset.size>3?' and '+(f.cpset.size-3)+' more':'')+', '+desc(f));
      out.push('Lookalike letters: '+shown.join('; ')+(items.length>5?'; and '+(items.length-5)+' more':'')+'. Check the name before you allow it.');
    }
    for(const h of hosts.slice(0,3))out.push('This address\u2019s host is '+cutS(h.ascii,HOST_MAX)+': the name you see, '+cutS(h.shown,HOST_MAX)+', is written with letters that are not plain ASCII.');
    if(inHidden)out.push('There are lookalike letters in the hidden part too.');
    if(unchecked)out.push('Durbar could not check this request for lookalike letters.');
    return out.join(' ');
  }
  /* FR-118: how much of a session button's tooltip to keep: 240 characters, more to reach the last marker, never more than TIP_MAX (fix round 1) */
  const tipLen=t=>{const s=String(t==null?'':t);return Math.min(TIP_MAX,Math.max(240,s.lastIndexOf('\u27e7')+2));};
  return {check,line,marker,hostOdd,tipLen,PCTRL_T,CAP,TIP_MAX};
})());
