import sys, glob, os, io
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from comps import comps
SRC, OUT, MAXA = sys.argv[1], sys.argv[2], 40  # islands of at most 40 px are specks
os.makedirs(OUT, exist_ok=True)
rep=[]
for f in sorted(glob.glob(os.path.join(SRC,'**','*.webp'), recursive=True)):
    im=Image.open(f).convert('RGBA'); a=np.array(im)
    lab,cs=comps(a[:,:,3])
    cs.sort(key=lambda c:-c[1]); main=cs[0][1]
    drop=[c for c in cs[1:] if c[1]<=MAXA]
    keep_small=[c for c in cs[1:] if c[1]>MAXA]
    if drop:
        mask=np.isin(lab,[c[0] for c in drop]); a[mask]=0
    rel=os.path.relpath(f,SRC); dst=os.path.join(OUT,rel); os.makedirs(os.path.dirname(dst),exist_ok=True)
    out=Image.fromarray(a,'RGBA')
    best=None
    for kw in ({'lossless':True,'quality':100,'method':6},{'quality':95,'method':6},{'quality':92,'method':6},{'quality':90,'method':6},{'quality':86,'method':6},{'quality':82,'method':6},{'quality':78,'method':6}):
        b=io.BytesIO(); out.save(b,'WEBP',**kw)
        if b.tell()<=40*1024: best=(kw,b.getvalue()); break
    if not drop:
        best=({'unchanged':True},open(f,'rb').read())
    open(dst,'wb').write(best[1])
    rep.append((rel,len(drop),sum(c[1] for c in drop),len(keep_small),[c[1] for c in keep_small][:4],best[0],len(best[1])//1024))
for r in rep: print(*r)
