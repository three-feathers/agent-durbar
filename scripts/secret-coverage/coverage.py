#!/usr/bin/env python3
"""
Regenerates specs/012-claude-codex-adapters/secret-coverage.md (spec 012 FR-080 delta 2026-11-01, T137). A developer tool: nothing runs it in tests or at build,
and it needs only Python 3.11+, Node and a network. It does not spend AI credits.

    npx tsc -p tsconfig.scripts.json
    python3 -I scripts/secret-coverage/coverage.py <empty work dir> dist-scripts/src/shared/redact.js

Into the work dir it downloads the public lists (as data; nothing in them is run) and writes samples.json: 12 made-up samples per gitleaks rule, generated at run time
from the rule's own regex with a fixed seed. The samples never enter the repository. `head.md` is the page's text, `before-1a8317fa.json` the frozen result on `main`
before this work (counts only). TruffleHog is AGPL: only its directory names are read.
"""
import json,os,random,re,subprocess,sys,tomllib,urllib.request
import re._parser as P, re._constants as C

HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.dirname(os.path.dirname(HERE))
WORK,REDACT=sys.argv[1],sys.argv[2]
OUT=sys.argv[3] if len(sys.argv)>3 else os.path.join(ROOT,'specs/012-claude-codex-adapters/secret-coverage.md')
SOURCES={
 'gitleaks.toml':'https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml',
 'gitleaks.sha':'https://api.github.com/repos/gitleaks/gitleaks/commits/master',
 'github.md':'https://docs.github.com/api/article/body?pathname=/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns',
 'trufflehog.json':'https://api.github.com/repos/trufflesecurity/trufflehog/contents/pkg/detectors',
}
os.makedirs(WORK,exist_ok=True)
for name,url in SOURCES.items():
    f=os.path.join(WORK,name)
    if not os.path.exists(f):
        req=urllib.request.Request(url,headers={'User-Agent':'agent-durbar-coverage','Accept':'application/vnd.github.sha' if name=='gitleaks.sha' else '*/*'})
        with urllib.request.urlopen(req,timeout=60) as r: open(f,'wb').write(r.read())

random.seed(1009)
ALL=[chr(c) for c in range(33,127)]
def norm(rx):
    rx=rx.replace('[[:alnum:]]','[A-Za-z0-9]').replace('\\z','$')
    rx=re.sub(r'\(\?-i:','(?:',rx); rx=re.sub(r'\(\?i:','(?:',rx); rx=re.sub(r'\(\?s:','(?:',rx)
    rx=rx.replace('(?i)','')
    return rx
def cls(items):
    out=[];neg=False
    for op,a in items:
        if op==C.NEGATE: neg=True
        elif op==C.LITERAL: out.append(chr(a))
        elif op==C.RANGE: out+= [chr(c) for c in range(a[0],a[1]+1)]
        elif op==C.CATEGORY:
            if a==C.CATEGORY_NOT_SPACE: out+=list('abcdefghijklmnopqrstuvwxyz0123456789')
            elif a==C.CATEGORY_NOT_WORD: out+=[' ']
            elif a==C.CATEGORY_DIGIT: out+=list('0123456789')
            elif a==C.CATEGORY_WORD: out+=list('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_')
            elif a==C.CATEGORY_SPACE: out+=[' ']
    if neg: out=[c for c in ALL if c not in out and (c.isalnum() or not any(x.isalnum() for x in ALL if x not in out))] or [c for c in ALL if c not in out]
    return out
def tokenish(cs):
    al=[c for c in cs if c.isalnum()]
    return al if len(al)>=10 else cs
def gen(seq):
    s=''
    for op,a in seq:
        if op==C.LITERAL: s+=chr(a)
        elif op==C.NOT_LITERAL: s+='x'
        elif op==C.ANY: s+='.'
        elif op==C.IN: s+=random.choice(tokenish(cls(a)))
        elif op==C.BRANCH: s+=gen(random.choice(a[1]))
        elif op==C.SUBPATTERN: s+=gen(a[3])
        elif op in (C.MAX_REPEAT,C.MIN_REPEAT,C.POSSESSIVE_REPEAT):
            lo,hi,sub=a
            n=lo
            if hi==C.MAXREPEAT and not (len(sub)==1 and sub[0][0]==C.IN and all(x[0]==C.CATEGORY and x[1]==C.CATEGORY_SPACE for x in sub[0][1])): n=lo+16
            for _ in range(n): s+=gen(sub)
        elif op in (C.AT,C.ASSERT,C.ASSERT_NOT): pass
        else: raise Exception(op)
    return s

def samples():
    d=tomllib.load(open(os.path.join(WORK,'gitleaks.toml'),'rb'))
    out=[]
    for r in d['rules']:
        rx=r.get('regex')
        if not rx: out.append({'id':r['id'],'kind':'path-only'}); continue
        n=norm(rx); kw=r.get('keywords',[])
        contextual=rx.startswith('(?i)[\\w.-]{0,50}?') or rx.startswith('[\\w.-]{0,50}?')
        for i in range(12):
            sample=gen(P.parse(n))
            m=re.search(n,sample,re.I)
            if m:
                g=r.get('secretGroup') or (1 if m.groups() else 0)
                sec=m.group(g) if g<=len(m.groups()) else m.group(0)
            else: sec=sample
            out.append({'id':r['id'],'kind':'context' if contextual else 'shape','sample':sample,'secret':sec or sample,'kw':kw[0] if kw else ''})
    return out

MEASURE=r"""
const r=require(process.argv[1]);const s=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));const out={};
for(const x of s){if(!x.sample){out[x.id]={kind:x.kind,n:0};continue;}
 const o=out[x.id]??={kind:x.kind,n:0,redact:0,shapes:0,byName:0};o.n++;
 if(!r.redact(x.sample,{}).includes(x.secret))o.redact++;
 if(!r.maskTokenShapes(x.sample,'[redacted]').includes(x.secret))o.shapes++;
 if(x.kind==='context'){const nm=(x.kw||'x').replace(/[^a-z0-9]/gi,'_').toUpperCase()+'_API_KEY='+x.secret;if(!r.redact(nm,{}).includes(x.secret))o.byName++;}
}
process.stdout.write(JSON.stringify(out));
"""
sf=os.path.join(WORK,'samples.json')
json.dump(samples(),open(sf,'w'))
aft=json.loads(subprocess.check_output(['node','-e',MEASURE,os.path.abspath(REDACT),sf]))
base=json.load(open(os.path.join(HERE,'before-1a8317fa.json')))
sha=open(os.path.join(WORK,'gitleaks.sha')).read().strip()

why={
 'curl-auth-user':'`user:pass` is hidden after `curl`; a value without a colon has no password to split.',
 'stripe-access-token':'Real keys are 24 or more; the list accepts 10, and the samples are at that minimum. We take 16 or more, so `sk_test_helpers` stays.',
 'curl-auth-header':'`Authorization`, `Bearer` and secret-named headers are hidden; a custom header with an unknown name is not.',
 'facebook-access-token':'Hidden for the real `<15-16 digits>\\|<27-40 chars>` form; some generated bodies hold characters outside it.',
 'flutterwave-public-key':'Public by design, not a secret.',
 'jwt':'Real JWTs start `eyJ` and are hidden; the list also accepts `ey` plus anything and no signature, which matches base64 in normal output.',
 'jwt-base64':'Base64 of a JWT: encoded secrets pass (see the limits).',
 'kubernetes-secret-yaml':'Values are plain base64 with no prefix: encoded secrets pass.',
 'nuget-config-password':'An XML attribute pair (`key=... value=...`), not a name next to its value; rare in agent output.',
 'pkcs12-file':'A file name rule, not text. The mask does not read files.',
 'slack-webhook-url':'The real `T/B/secret` form is hidden (`hooks.slack.com` rule); the generated sample has no slashes.',
 'sourcegraph-access-token':'`sgp_` is hidden; the rule also accepts a bare 40 hex string, which is a git sha.',
 'square-access-token':'`sq0atp-` is hidden, and `EAAA` from 60 characters: a shorter `EAAA` run is too close to base64.',
 'vault-service-token':'`hvs.` is hidden; the legacy `s.` + 24 characters is too short a prefix (matches ordinary dotted words).',
 'generic-api-key':'Covered when the name is a secret word and the value qualifies; the list\'s entropy test is not ours.',
 'hashicorp-tf-password':'Covered for a name next to a value that qualifies; a value with no digit and under 20 characters stays.',
 'sumologic-access-id':'By name when the value has a digit; `su` + 12 characters alone has no safe prefix.',
}

def st(k,v):
    n=v.get('n',0)
    if n==0: return 'no'
    if v['redact']==n: return 'yes'
    if v['kind']=='context' and v['byName']>=n: return 'by name'
    if v['redact']>0 or v['byName']>0: return 'partial'
    return 'no'
rows=[]
for k,v in sorted(aft.items()):
    a=st(k,v); b=st(k,base.get(k,{'n':0,'kind':v['kind']}))
    if b=='by name': b='no'
    w=why.get(k,'')
    if not w and a=='by name': w='No fixed prefix: needs a secret name next to it.'
    if not w and a in('no','partial'): w="Sample at the list's minimum length: shorter than our form accepts, or no safe prefix."
    rows.append((k,v['kind'],b,a,w))
full=lambda d,k:d[k].get('redact',0)==d[k].get('n',0)!=0
nS=sum(v['kind']=='shape' for v in base.values()); nC=sum(v['kind']=='context' for v in base.values())
beforeS=sum(full(base,k) for k,v in base.items() if v['kind']=='shape'); afterS=sum(full(aft,k) for k,v in aft.items() if v['kind']=='shape')
beforeC=sum(full(base,k) for k,v in base.items() if v['kind']=='context'); afterC=sum(full(aft,k) for k,v in aft.items() if v['kind']=='context')
afterN=sum(st(k,v)=='by name' for k,v in aft.items() if v['kind']=='context')
diff=[k for k,v in aft.items() if v.get('redact')!=v.get('shapes')]
rowsG={}
for l in open(os.path.join(WORK,'github.md'),encoding='utf8'):
    if not l.startswith('|'): continue
    c=[x.strip() for x in l.strip().strip('|').split('|')]
    if len(c)<3 or c[0].startswith(('-',':','*')) or c[0] in('Provider','Category','Capability','User alerts','Push protection','Validity checks','Extended metadata','Base64 format support','Partner notifications'): continue
    rowsG.setdefault(c[0],[]).append(c[1].strip('`').replace('\\_','_'))
gh={ # provider -> (status, note)
 '1Password':('yes','`ops_eyJ`, `A3-`'),'Adobe':('partial','`p8e-`; other Adobe tokens by name'),'Airtable':('partial','`pat…`; old keys by name'),'Alibaba':('yes','`LTAI`'),
 'Amazon AWS':('yes','`AKIA`, `ASIA`, `ABIA`, `ACCA`, `A3T`; session token by name, Bedrock `ABSK`'),'Anthropic':('yes','`sk-ant-`, also glued'),'Atlassian':('yes','`ATATT3`; JWT shape'),'Authress':('yes','own four-part shape'),
 'Azure':('partial','Entra `…Q~…`; `AccountKey=`, `SharedAccessKey=` and `sig=` by name; the many other Azure keys have no public fixed prefix'),'Bitbucket':('by name','`ATBB`, `BBDC-` dropped: no vendor page confirmed them'),'Brevo':('partial','`xkeysib-`; SMTP key by name'),'Buildkite':('by name','`bkua_` dropped: no vendor page confirmed it'),'CircleCI':('partial','`CCIPAT_`, `CCIPRJ_`; others by name'),'Clojars':('yes','`CLOJARS_`'),'Cloudflare':('partial','`cfut_`, `cfat_`, `cfk_`, origin `v1.0-`; older tokens by name'),'Cohere':('by name','no public prefix'),'Contentful':('by name','`CFPAT-` dropped: vendor page refused the fetch'),'crates.io':('by name','`cio` dropped: no vendor page confirmed it'),'Databricks':('partial','`dapi`; session and OAuth tokens by name'),'Datadog':('by name','32/40 hex, no prefix'),'Datastax':('yes','`AstraCS:`'),'DeepSeek':('yes','`sk-`'),'Defined Networking':('by name','`dnkey-` not added: rare in agent logs'),'DigitalOcean':('yes','`doo_v1_`, `dop_v1_`, `dor_v1_`; system token by name'),'Discord':('yes','bot token shape, webhook path'),'Docker':('partial','`dckr_pat_`; other tokens by name'),'Doppler':('yes','`dp.pt.`, `dp.st.` and the others'),'Dropbox':('partial','`sl.`; long-lived by name'),'Duffel':('yes','`duffel_live_`, `duffel_test_`'),'Dynatrace':('yes','`dt0c01.`'),'EasyPost':('yes','`EZAK`, `EZTK`'),'Facebook':('yes','`EAAC`, `EAAM`, `<id>\\|<token>`'),'Figma':('by name','`figd_` dropped: only a forum, no vendor doc'),'Flutterwave':('yes','`FLWSECK`'),'Frame.io':('partial','`fio-u-`; JWT shape'),'Generic':('partial','PEM, OpenSSH, PGP, Bearer, Basic in `Authorization:`, URL credentials; a bare Basic value not next to its header is not'),'GitHub':('yes','`gh[pousr]_`, `github_pat_`; SSH key as PEM block'),'GitLab':('yes','`glpat-`, `gldt-`, `glrt-`, `glft-`, `glffct-`, `glimt-`, `glagent-`, `gloas-`, `glsoat-`, `glptt-`, `glcbt-`, `GR1348941`, `_gitlab_session`'),'Google':('partial','`AIza`, `ya29.`, `GOCSPX-`, `GOOG1`; service account key as PEM block; refresh tokens by name'),'Grafana':('yes','`glc_`, `glsa_`, `eyJrIjoi`'),'Groq':('yes','`gsk_`'),'HashiCorp':('yes','`hvs.`, `hvb.`, `hvr.`, `.atlasv1.`'),'Heroku':('partial','`HRKU-`; Postgres URL as URL credential'),'Hubspot':('by name','`pat-na1-` dropped: no vendor page confirmed it'),'Hugging Face':('yes','`hf_`, `api_org_`'),'JFrog':('partial','`AKCp`, `cmVmd`; platform access tokens are JWTs'),'Langchain':('yes','`lsv2_??_`'),'Linear':('partial','`lin_api_`; OAuth token by name'),'Mailchimp':('yes','`<32 hex>-usNN`; Mandrill by name'),'Mailgun':('partial','`key-<32 hex>`; newer keys by name'),'Mapbox':('by name','`sk.` dropped: no vendor page confirmed it'),'MaxMind':('yes','`_mmk`'),'Microsoft':('yes','Power Automate `sig=`; Teams webhook path'),'Midtrans':('by name','`Mid-server-` dropped: no vendor page confirmed it'),'Mistral AI':('by name','no public prefix'),'MongoDB':('partial','URI as URL credential; Atlas secret by name'),'Neon':('partial','`napi_`; URI as URL credential'),'New Relic':('partial','`NRAK-`, `NRII-`, `NRJS-`; others by name'),'Notion':('partial','`ntn_`; older `secret_` by name'),'npm':('yes','`npm_`, `_authToken=`'),'NuGet':('by name','`oy2` dropped: no vendor page confirmed it'),'Octopus Deploy':('yes','`API-`'),'OpenAI':('yes','`sk-`, `sk-proj-`'),'OpenRouter':('yes','`sk-or-`'),'OpenVSX':('by name','`ovsxp_` dropped: no vendor page confirmed it'),'Paddle':('yes','`pdl_live_`, `pdl_sdbx_`'),'Perplexity':('yes','`pplx-`'),'Pinecone':('by name','`pcsk_` dropped: no vendor page confirmed it'),'PlanetScale':('yes','`pscale_tkn_`, `pscale_oauth_`, `pscale_pw_`'),'PostHog':('yes','`phx_`, `phs_`; `phc_` is public'),'Postman':('yes','`PMAK-`'),'Prefect':('partial','`pnu_`; `pnb_` by name'),'Pulumi':('yes','`pul-`'),'Pydantic Services Inc.':('by name','`pylf_` dropped: no vendor page confirmed it'),'PyPI':('yes','`pypi-Ag`'),'ReadMe':('yes','`rdme_`'),'Replicate':('yes','`r8_`'),'Resend':('yes','`re_`'),'RubyGems':('yes','`rubygems_`'),'RunPod':('by name','`rpa_` dropped: no vendor page confirmed it'),'SendGrid':('yes','`SG.`'),'Sentry':('yes','`sntrys_`, `sntryu_`'),'Shippo':('yes','`shippo_live_`, `shippo_test_`'),'Shopify':('partial','`shpat_`, `shpca_`, `shppa_`, `shpss_`; others by name'),'Slack':('yes','`xox*-`, `xapp-`, webhook and workflow paths'),'Sourcegraph':('yes','`sgp_`'),'Square':('yes','`sq0atp-`, `sq0csp-`, `EAAA`'),'Stripe':('yes','`sk_`, `rk_` + `live`, `test`, `prod`; `whsec_`'),'Supabase':('yes','`sbp_`, `sb_secret_`'),'Tailscale':('yes','`tskey-`'),'Tavily':('yes','`tvly-`'),'Telegram':('yes','`<digits>:<35>`'),'Tencent':('by name','`AKID` dropped: no vendor page confirmed it'),'Twilio':('partial','`SK`; `AC` is an account id; auth token by name'),'Unkey':('by name','`unkey_` dropped: no vendor page confirmed it'),'Vercel':('yes','`vcp_`, `vci_`, `vca_`, `vcr_`, `vck_`'),'VolcEngine':('by name','`AKLT` dropped: no vendor page confirmed it'),'Weights & Biases':('by name','`wandb_v1_` dropped: no vendor page confirmed it'),'xAI':('by name','`xai-` dropped: no vendor page confirmed it'),'Yandex':('by name','listed prefixes (`AQVN`, `YC`, `t1.`) are too short beside normal text'),
}
g=[]
gc={'yes':0,'partial':0,'by name':0}
for p in sorted(rowsG,key=str.lower):
    stt,note=gh.get(p,('by name','GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name.'))
    gc[stt]+=1
    g.append(f"| {p} | {', '.join(rowsG[p])} | {stt} | {note} |")
ds=[('artifactory','`AKCp`; `AP…` password shape not added: 2-letter prefix','partial'),('aws','Access key ids; secret by name (`aws_secret_access_key=`), 40 chars with no name stays','partial'),('azure_storage_key','`AccountKey=` by name','yes'),('basic_auth','URL credentials','yes'),('cloudant','As URL credential; bare key has no prefix','partial'),('discord','Bot token shape','yes'),('github_token','`gh[pousr]_`, `github_pat_`','yes'),('gitlab_token','`gl*-` family','yes'),('high_entropy_strings','Not used: entropy flags git shas, hashes and base64 in normal output; a mask over display text would hide them all','no'),('ibm_cloud_iam','By name only','by name'),('ibm_cos_hmac','By name only','by name'),('ip_public','Not a secret for this mask','no'),('jwt','`eyJ…` three parts','yes'),('keyword','Same idea as the generic name rule; its name list checked against ours (`api_key`, `auth_key`, `service_key`, `account_key`, `private_key`, `password`, `passwd`, `pwd`, `secret`, `contrasena`); `db_key`, `client_key` and `key_pass` not taken, too close to ordinary config names','partial'),('mailchimp','`<32 hex>-usNN`','yes'),('npm','`npm_`; `_authToken=` by name','yes'),('openai','`sk-`','yes'),('private_key','Key blocks; also PuTTY lines are not (see limits)','partial'),('pypi_token','`pypi-Ag`','yes'),('sendgrid','`SG.`','yes'),('slack','`xox*-`, webhook paths','yes'),('softlayer','By name only','by name'),('square_oauth','`sq0csp-`','yes'),('stripe','`sk_live_`, `rk_live_`','yes'),('telegram_token','`<digits>:<35>`','yes'),('twilio','`SK`; `AC` is an account id, not secret','partial')]
names=[x['name'] for x in json.load(open(os.path.join(WORK,'trufflehog.json'))) if x['type']=='dir']
fam={'adobeio','airtablepersonalaccesstoken','alibaba','anthropic','artifactory','artifactoryreferencetoken','atlassian','aws','azure_entra','azure_storage','circleci','clojars','cloudflareapitoken','cloudflarecakey','databrickstoken','deepseek','digitaloceantoken','digitaloceanv2','discordbottoken','discordwebhook','docker','dockerhub','doppler','dropbox','duffeltoken','easypost','facebookoauth','flutterwave','flyio','frameio','gcp','gcpapplicationdefaultcredentials','gemini','googlegemini','googleoauth2','github','github_oauth2','githubapp','gitlab','gitlaboauth2','grafana','grafanaserviceaccount','groq','hashicorpvault','hashicorpvaultauth','heroku','huggingface','jwt','langsmith','linearapi','mailchimp','mailgun','maxmindlicense','microsoftteamswebhook','mongodb','newrelicpersonalapikey','newrelicinsightsinsertkey','newrelicbrowserkey','notion','npmtoken','npmtokenv2','octopusdeploy','openai','openaiadmin','openrouter','planetscale','planetscaledb','postgres','posthog','postman','prefect','privatekey','pulumi','pypi','razorpay','readme','redis','replicate','resend','rootly','rubygems','sendgrid','sentryorgtoken','sentrytoken','shippo','shopify','shopifyoauth','slack','slackwebhook','sourcegraph','sourcegraphcody','square','squareapp','stripe','supabasetoken','tailscale','telegrambottoken','terraformcloudpersonaltoken','twilio','twilioapikey','uri','vercel','sqlserver','jdbc','ftp','ldap','rabbitmq','tencentcloud'}
fam.discard('rootly')
inF=[n for n in names if n in fam]; outF=[n for n in names if n not in fam]
L=open(os.path.join(HERE,'head.md'),encoding='utf8').read()
for k,v in dict(sha7=sha[:7],nS=nS,beforeS=beforeS,afterS=afterS,nC=nC,beforeC=beforeC,afterC=afterC,afterN=afterN,ghp=len(rowsG),gy=gc['yes'],gp=gc['partial'],gn=gc['by name'],thn=len(names),thy=len(inF)).items(): L=L.replace('{'+k+'}',str(v))
L+='\n## gitleaks: every rule, measured\n\n`Before` is `redact` on `main` at 1a8317fa, `after` this change. *kind*: `shape` has a fixed form; `context` needs a service word next to the value.\n\n| Rule | Kind | Before | After | Why not fully |\n|---|---|---|---|---|\n'
for r in rows: L+=f'| `{r[0]}` | {r[1]} | {r[2]} | {r[3]} | {r[4]} |\n'
L+='\n## GitHub secret scanning: every provider, by reading\n\nGitHub publishes names, not patterns, so this table is a judgement from the names and the public formats, not a measurement. `by name`: no shape, hidden only next to a secret name.\n\n| Provider | Secret types | Status | How, or why not |\n|---|---|---|---|\n'+'\n'.join(g)+'\n'
L+='\n## Yelp detect-secrets: every plugin\n\n| Plugin | Status | How, or why not |\n|---|---|---|\n'+'\n'.join(f'| `{a}` | {c} | {b} |' for a,b,c in ds)+'\n'
L+='\n## TruffleHog: service names only\n\nAGPL-3.0: only the directory names of `pkg/detectors` were read; no detector was opened and nothing is copied. The grouping is by name, not measured.\n\n**A shape or URL rule here applies (%d):** %s.\n\n**Not picked; hidden only next to a secret name (%d):** %s.\n' % (len(inF),', '.join(inF),len(outF),', '.join(outF))
open(OUT,'w',encoding='utf8',newline='\n').write(L)
print('fixed',beforeS,'->',afterS,'of',nS,'| word',beforeC,'->',afterC,'+',afterN,'of',nC,'| github',gc,'| trufflehog',len(inF),'of',len(names),'| masks differ on',diff)
