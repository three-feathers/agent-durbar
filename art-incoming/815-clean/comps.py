import sys, glob, os
import numpy as np
from PIL import Image
from collections import deque
def comps(a, thr=0):
    h,w=a.shape; m=a>thr; lab=np.zeros((h,w),np.int32); out=[]; n=0
    for y in range(h):
        for x in range(w):
            if m[y,x] and not lab[y,x]:
                n+=1; q=deque([(y,x)]); lab[y,x]=n; px=[]
                while q:
                    cy,cx=q.popleft(); px.append((cy,cx))
                    for dy in (-1,0,1):
                        for dx in (-1,0,1):
                            ny,nx=cy+dy,cx+dx
                            if 0<=ny<h and 0<=nx<w and m[ny,nx] and not lab[ny,nx]:
                                lab[ny,nx]=n; q.append((ny,nx))
                ys=[p[0] for p in px]; xs=[p[1] for p in px]
                out.append((n,len(px),int(a[ys,xs].max()),min(ys),max(ys),min(xs),max(xs)))
    return lab,out
if __name__=='__main__':
    for f in sys.argv[1:]:
        a=np.array(Image.open(f).convert('RGBA'))[:,:,3]
        lab,cs=comps(a)
        cs.sort(key=lambda c:-c[1])
        small=[c for c in cs[1:]]
        print(os.path.basename(f), 'main=',cs[0][1], 'others=',len(small), [ (c[1],c[2],c[3],c[5]) for c in small[:8]])
