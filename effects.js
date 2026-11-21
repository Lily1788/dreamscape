'use strict';

const DreamEffects = (() => {
  const {clamp, distance, mix} = DreamGestures;
  const slots = [
    [[.74,.44,.17,.17],['08-field-jump','09-gold-silhouettes','10-muted-scene']],
    [[.07,.25,.18,.18],['02-violet-wings','01-pink-sea','03-pink-trees','04-flower-field']],
    [[.72,.21,.19,.19],['07-water-glints']],
    [[.10,.49,.17,.17],['05-blue-clouds','06-magenta-flowers']]
  ];
  const textures=['fx-05a-green-texture','fx-05b-blue-texture'];
  const names=[...slots.flatMap(([,list])=>list.map(key=>'pip-'+key)),...textures,
    'fx-06a-blue-flight','flight-fog','wing-cutout','pink-fragments'];
  const art=new Map(names.map(name=>{
    const image=new Image();
    const entry={image,status:'载入中'};
    image.onload=()=>{ entry.status='就绪'; };
    image.onerror=()=>{ entry.status='加载失败'; };
    image.src='assets/dreamscape/'+name+'.webp';
    return [name,entry];
  }));
  const get=name=>art.get(name)?.status==='就绪'?art.get(name).image:null;
  const status=()=>Object.fromEntries([...art].map(([name,a])=>[name,a.status]));
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const TAU=Math.PI*2;
  const fract=n=>n-Math.floor(n);
  const hash=n=>fract(Math.sin(n*87.462+14.29)*43758.5453);
  const layer=(width,height)=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;return c;
  };
  function crop(ctx,image,x,y,w,h) {
    const scale=Math.max(w/image.width,h/image.height), sw=w/scale,sh=h/scale;
    ctx.drawImage(image,(image.width-sw)/2,(image.height-sh)/2,sw,sh,x,y,w,h);
  }
  function curve(ctx,pts,close=false) {
    ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    for(const p of pts.slice(1)) ctx.lineTo(p.x,p.y);
    if(close) ctx.closePath();
  }
  function radial(ctx,x,y,r,inner,outer) {
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,inner);g.addColorStop(1,outer);return g;
  }

  function projectiveQuad(p) {
    const [a,b,c,d]=p;
    const rx=b.x-c.x,ry=b.y-c.y,sx=d.x-c.x,sy=d.y-c.y;
    const tx=a.x-b.x+c.x-d.x,ty=a.y-b.y+c.y-d.y;
    const det=rx*sy-sx*ry;
    const g=Math.abs(det)>1e-5?(tx*sy-sx*ty)/det:0;
    const h=Math.abs(det)>1e-5?(rx*ty-tx*ry)/det:0;
    return (u,v)=>{
      const w=g*u+h*v+1;
      return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/w,
        y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/w};
    };
  }

  function warp(ctx,image,corners) {
    const map=projectiveQuad(corners), n=8;
    const triangle=(u,v,u2,v2,u3,v3)=>{
      const a=map(u,v),b=map(u2,v2),c=map(u3,v3);
      const bx=u2-u,by=v2-v,cx=u3-u,cy=v3-v, det=bx*cy-by*cx;
      const x1=((b.x-a.x)*cy-(c.x-a.x)*by)/det;
      const x2=((c.x-a.x)*bx-(b.x-a.x)*cx)/det;
      const y1=((b.y-a.y)*cy-(c.y-a.y)*by)/det;
      const y2=((c.y-a.y)*bx-(b.y-a.y)*cx)/det;
      if(!Number.isFinite(x1+y2))return;
      const mid={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3};
      const expanded=[a,b,c].map(p=>{
        const r=Math.max(1,distance(p,mid));
        return {x:p.x+(p.x-mid.x)*.65/r,y:p.y+(p.y-mid.y)*.65/r};
      });
      ctx.save();curve(ctx,expanded,true);ctx.clip();
      ctx.transform(x1,y1,x2,y2,a.x-x1*u-x2*v,a.y-y1*u-y2*v);
      ctx.drawImage(image,0,0,1,1);ctx.restore();
    };
    ctx.save();curve(ctx,corners,true);ctx.clip();
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const x=i/n,y=j/n,u=(i+1)/n,v=(j+1)/n;
      triangle(x,y,u,y,u,v);triangle(x,y,u,v,x,v);
    }
    ctx.restore();
  }

  function refraction(width,height) {
    const output=layer(width,height);
    const gl=output.getContext('webgl',{alpha:false,antialias:false});
    if(!gl)return null;
    const program=gl.createProgram();
    const shaders=[
      [gl.VERTEX_SHADER,'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0,1);}'],
      [gl.FRAGMENT_SHADER,`
        precision mediump float;
        varying vec2 uv;
        uniform sampler2D scene;
        uniform vec2 size;
        uniform vec3 waves[5];
        void main(){
          vec2 p=uv*size, shift=vec2(0.0);
          float glint=0.0;
          for(int i=0;i<5;i++){
            float t=waves[i].z;
            if(t<0.0||t>1.65) continue;
            vec2 d=p-waves[i].xy;
            float r=length(d), front=t*size.y*.48;
            float band=(r-front)/(13.0+t*25.0);
            float envelope=exp(-band*band)*pow(max(0.0,1.0-t/1.65),1.5);
            float slope=sin(band*3.5)*envelope;
            shift+=d/max(r,1.0)*slope*(10.5+t*4.0);
            glint+=slope*.048;
          }
          vec3 src=texture2D(scene,clamp(uv+shift/size,.001,.999)).rgb;
          gl_FragColor=vec4(src+vec3(.65,.85,1.0)*glint,1.);
        }`]
    ];
    for(const [type,code] of shaders){
      const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))return null;
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;
    gl.useProgram(program);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(program,'position');
    gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(loc);
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform2f(gl.getUniformLocation(program,'size'),width,height);
    const waveLoc=gl.getUniformLocation(program,'waves[0]');
    return (ctx,src,waves,t)=>{
      if(gl.isContextLost())return false;
      const params=new Float32Array(15).fill(-1);
      waves.slice(-5).forEach((p,i)=>params.set([p.x,height-p.y,(t-p.t)/1000],i*3));
      gl.viewport(0,0,width,height);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
      gl.uniform3fv(waveLoc,params);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      ctx.drawImage(output,0,0);
      return true;
    };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d');
      this.w=canvas.width;this.h=canvas.height;
      this.room=layer(this.w,this.h);this.scratch=layer(this.w,this.h);
      this.frost=layer(this.w,this.h);this.erase=layer(this.w,this.h);
      this.textureLayer=layer(this.w,this.h);
      this.inkHands=new Map();
      this.refract=refraction(this.w,this.h);this.lastPeaks=[0,0];this.mountainMix=0;this.fogMix=0;
      this.refreshMaskContext();
    }
    refreshMaskContext() {
      this.erase.getContext('2d').clearRect(0,0,this.w,this.h);

    }
    reset() {
      this.lastPeaks=[0,0];this.mountainMix=this.fogMix=0;
      this.inkHands.clear();this.refreshMaskContext();
    }
    mirrorRoom(source,fit,mirror) {
      const c=this.room.getContext('2d');
      c.save();
      if(mirror){c.translate(this.w,0);c.scale(-1,1);}
      c.drawImage(source,fit.x,fit.y,fit.w,fit.h);c.restore();
    }
    camera(ctx,src,fit,mirror) {
      ctx.save();if(mirror){ctx.translate(this.w,0);ctx.scale(-1,1);}
      ctx.drawImage(src,fit.x,fit.y,fit.w,fit.h);ctx.restore();
    }
    mountain(s,t) {
      const {ctx,w,h}=this;
      this.mountainMix+=( (s.phase===1&&t-s.lastPeak<420?1:0)-this.mountainMix)*.13;
      if(this.mountainMix<.008)return;
      ctx.save();ctx.globalAlpha=this.mountainMix;
      ctx.fillStyle='#0c1a32dc';ctx.fillRect(0,0,w,h);
      const horizon=h*.56;
      ctx.lineWidth=.75;ctx.strokeStyle='#a0c8f247';ctx.beginPath();
      for(let i=-16;i<=16;i++){
        ctx.moveTo(w*.5+i*w*.013,horizon);ctx.lineTo(w*.5+i*w*.086,h);
      }
      for(let i=0;i<11;i++){
        const y=horizon+(h-horizon)*(i/10)**2;ctx.moveTo(0,y);ctx.lineTo(w,y);
      }
      ctx.stroke();
      this.lastPeaks=this.lastPeaks.map((v,i)=>v+(s.peaks[i]-v)*.18);
      for(let row=0;row<5;row++){
        const points=Array.from({length:31},(_,i)=>{
          const x=(i-1)*w/28, side=i/30;
          const peak=(1-side)*this.lastPeaks[0]+side*this.lastPeaks[1];
          const ridge=Math.max(.15,Math.sin(i*.63+row*.8)*.45+hash(i+row*32)*.58);
          return {x,y:horizon+row*14-ridge*(.06+peak*.29)*h};
        });
        ctx.strokeStyle=row<2?'#c2d9f77a':'#7199c95a';
        curve(ctx,points);ctx.stroke();
        ctx.beginPath();
        for(const p of points){
          ctx.moveTo(p.x,p.y);ctx.lineTo(w*.5+(p.x-w*.5)*1.18,horizon+35+row*28);
        }
        ctx.strokeStyle='#7799bc35';ctx.stroke();
      }
      ctx.restore();
    }
    frostEffect(s,t) {
      const {ctx,w,h}=this, e=this.erase.getContext('2d'),c=this.frost.getContext('2d');
      for(const [a,b,size] of s.sweeps){
        const n=Math.max(1,Math.ceil(distance(a,b)/10));
        const r=clamp(size*1.03,32,91);
        for(let j=0;j<=n;j++){
          const x=a.x+(b.x-a.x)*j/n,y=a.y+(b.y-a.y)*j/n;
          e.fillStyle=radial(e,x,y,r,'#000','#0000');e.fillRect(x-r,y-r,2*r,2*r);
        }
      }
      s.sweeps.length=0;
      c.clearRect(0,0,w,h);
      c.save();c.filter='blur(10px)';c.drawImage(this.canvas,-12,-12,w+24,h+24);c.restore();
      c.fillStyle='#e1e2e16b';c.fillRect(0,0,w,h);
      c.globalCompositeOperation='destination-out';c.drawImage(this.erase,0,0);
      c.globalCompositeOperation='source-over';
      const alpha=s.frostDelay?clamp((t-s.entered-s.frostDelay)/320,0,1):1;
      ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(this.frost,0,0);ctx.restore();
    }
    wing(s,t) {
      const {ctx,w,h}=this, image=get('wing-cutout'),f=s.face;
      const a=clamp((t-s.entered)/440,0,1)*(1-clamp((t-s.flashAt)/160,0,1));
      ctx.save();ctx.globalAlpha=a;
      ctx.fillStyle='#45689bbf';ctx.fillRect(0,0,w,h);
      ctx.fillStyle=radial(ctx,w*.49,h*.45,w*.69,'#b0c7ee59','#252d5ea5');ctx.fillRect(0,0,w,h);
      if(image&&f){
        const size=clamp(f.width*2.5,w*.19,w*.43);
        for(const sign of [-1,1]){
          ctx.save();ctx.translate(f.x+sign*f.width*.37,f.y+f.height*.72);
          ctx.rotate(f.roll*.28);ctx.scale(sign,1);
          ctx.drawImage(image,-size*.08,-size*.66,size,size*.72);ctx.restore();
        }
      }
      ctx.restore();
    }
    print(s,t,matte,fit,mirror) {
      const {ctx,w,h}=this, elapsed=t-s.flashAt;
      if(elapsed<0||elapsed>=720)return;
      if(elapsed<260){
        ctx.save();ctx.globalCompositeOperation='saturation';ctx.fillStyle='#888';ctx.fillRect(0,0,w,h);ctx.restore();
        ctx.fillStyle='#15182d40';
        for(let y=0;y<h;y+=5)for(let x=y%10;x<w;x+=7){
          ctx.beginPath();ctx.ellipse(x,y,1.35,.64,-.60,0,TAU);ctx.fill();
        }
        if(s.face&&elapsed>=90){
          const {eyes,width,height,roll}=s.face;
          eyes.forEach((p,i)=>{
            ctx.save();ctx.translate(p.x,p.y);ctx.rotate(roll);
            ctx.fillStyle=i===0?'#7967f5c4':'#d75cb0cc';
            ctx.fillRect(-width*.155,-height*.053,width*.31,height*.106);ctx.restore();
          });
        }
      } else if(matte&&elapsed<635){
        ctx.save();ctx.globalAlpha=1-clamp((elapsed-510)/125,0,1);
        if(reducedMotion.matches)ctx.globalAlpha*=.55;
        ctx.fillStyle=elapsed<495?'#8199b3':'#8aa69c';ctx.fillRect(0,0,w,h);
        this.camera(ctx,matte.white,fit,mirror);ctx.restore();
      }
    }
    birds(s,t) {
      const {ctx,w,h}=this;
      const groups=[...s.groups.values()].filter(g=>t-g.seen<950);
      const target=(s.phase===5||s.phase===6)&&groups.length?1:0;
      this.fogMix+=(target-this.fogMix)*.10;
      if(this.fogMix<.012)return;
      const fog=get('flight-fog');
      ctx.save();ctx.globalAlpha=this.fogMix*.84;
      if(fog)crop(ctx,fog,0,0,w,h);
      else {ctx.fillStyle='#203b9e';ctx.fillRect(0,0,w,h);}
      ctx.restore();
      for(const g of groups){
        const alpha=this.fogMix*clamp((t-g.start)/550,0,1)*clamp((950-t+g.seen)/550,0,1);
        for(let i=0;i<25;i++) {
          const n=g.seed+i,depth=hash(n+14),size=1.5+depth**2.7*9;
          const travel=fract(hash(n)+(t-g.start)*(.00005+depth*.000095));
          const x=g.origin.x+(travel-.5)*w*.81;
          const y=g.origin.y*.74+(hash(n+2)-.53)*h*.66+Math.sin(t*.0016+n)*12;
          const flap=Math.sin(t*(.008+depth*.006)+n)*size*.78;
          ctx.save();ctx.translate(x,y);
          ctx.rotate((hash(n+8)-.5)*.65);
          ctx.globalAlpha=alpha*(.48+depth*.49);
          if(depth>.88)ctx.filter='blur(1px)';
          ctx.fillStyle=depth>.48?'#e2edff':'#a6c7ed';
          ctx.beginPath();ctx.moveTo(0,1);ctx.quadraticCurveTo(-size*.62,-size*.55,-size*1.75,flap);
          ctx.quadraticCurveTo(-size*.88,flap-size*.66,0,-size*.25);
          ctx.quadraticCurveTo(size*.78,flap-size*.68,size*1.60,flap);
          ctx.quadraticCurveTo(size*.69,-size*.55,0,1);ctx.fill();ctx.restore();
        }
      }
    }
    portal(s,t,matte,fit,mirror) {
      if(s.phase!==4||!s.frame||t-s.frameSeen>510)return;
      const {ctx,w,h}=this;
      const image=get(textures[s.texture%2]);if(!image)return;
      const c=this.textureLayer.getContext('2d');c.clearRect(0,0,w,h);
      warp(c,image,s.frame);
      if(s.texture>=2){
        c.save();curve(c,s.frame,true);c.clip();
        c.globalCompositeOperation='source-atop';
        c.fillStyle=s.texture===2?'#fff2eeb3':'#321051a3';
        c.fillRect(0,0,w,h);c.restore();
      }
      curve(c,s.frame,true);c.strokeStyle='#f4f6ffe6';c.lineWidth=1.15;c.stroke();
      if(matte){
        c.save();c.beginPath();
        for(const h of s.hands){
          for(const id of [4,8]){
            const p=h.points[id],r=clamp(h.scale*.23,8,20);
            c.moveTo(p.x+r,p.y);c.arc(p.x,p.y,r,0,TAU);
          }
        }
        c.clip();c.globalCompositeOperation='destination-out';
        this.camera(c,matte.white,fit,mirror);c.restore();
      }
      ctx.save();ctx.globalAlpha=clamp(1-(t-s.frameSeen-200)/310,0,1);
      ctx.drawImage(this.textureLayer,0,0);ctx.restore();
    }
    windows(s,t) {
      const {ctx,w,h}=this;
      const leave=s.phase===8?1-clamp((t-s.entered)/1120,0,1):1;
      if(leave<=0)return;
      for(const [i,card] of s.cards.entries()){
        const [rect,list]=slots[i], [x,y,sw,sh]=rect.map((v,j)=>v*(j%2?h:w));
        const age=t-card.t;
        if(age<140){
          ctx.save();ctx.globalAlpha=leave*(1-age/175);
          ctx.lineWidth=.85;ctx.strokeStyle='#eceffe';
          const gx=x+sw*.30,gy=y+sh*.28,gw=sw*.40,gh=sh*.44;
          ctx.strokeRect(gx,gy,gw,gh);ctx.setLineDash([3,4]);
          ctx.strokeRect(gx-5,gy-5,gw+10,gh+10);ctx.restore();continue;
        }
        const seconds=(age-140)/1000;
        const phase=seconds/(1.17+i*.16),idx=Math.floor(phase)%list.length;
        let key=list[idx],next=list[(idx+1)%list.length],mix=clamp((fract(phase)-.82)/.18,0,1);
        if(i===0) {
          const period=seconds%4.3;
          key=period<2.12?list[0]:list[2];
          next=period<.70?list[1]:list[2];
          mix=period<.70?clamp(1-Math.abs(period-.48)/.17,0,1):clamp((period-1.9)/.22,0,1);
        }
        const image=get('pip-'+key),second=get('pip-'+next);
        if(!image)continue;
        const alpha=leave*clamp((age-140)/175,0,1);
        ctx.save();ctx.globalAlpha=alpha;
        crop(ctx,image,x,y,sw,sh);
        if(second&&next!==key&&mix&&!reducedMotion.matches){
          ctx.globalAlpha=alpha*mix;crop(ctx,second,x,y,sw,sh);
        }
        if(i===2&&!reducedMotion.matches){
          ctx.globalAlpha=alpha*(.024+.061*Math.max(0,Math.sin(t*.009)));
          ctx.fillStyle='#cff4ff';ctx.fillRect(x,y,sw,sh);
        }
        ctx.globalAlpha=alpha*.75;ctx.strokeStyle='#f0f1ff';ctx.lineWidth=.8;
        ctx.strokeRect(x,y,sw,sh);ctx.restore();
      }
    }
    fragments(s,t) {
      const image=get('pink-fragments');if(!image)return;
      const {ctx,w,h}=this,age=t-s.entered;
      const a=clamp(age/380,0,1)*(1-clamp((age-1450)/1750,0,1));
      if(a<=0)return;
      for(const far of [true,false]){
        ctx.save();ctx.globalAlpha=a*(far?.42:.76);
        ctx.filter=far?'blur(2.4px)':'none';
        const motion=reducedMotion.matches?0:age*.018;
        const offset=far?-motion:motion;
        ctx.drawImage(image,offset-(far?85:0),-motion*.45+(far?-42:14),w*(far?1.2:1),h*(far?1.17:1));
        ctx.restore();
      }
    }
    eyeGlass(s,t) {
      if(s.phase<7||!s.face)return;
      const {ctx,w,h}=this, f=s.face;
      const thin=s.phase===8?clamp((t-s.entered)/390,0,1):0;
      const cx=(f.eyes[0].x+f.eyes[1].x)/2,cy=(f.eyes[0].y+f.eyes[1].y)/2;
      const ew=f.width*.57,eh=f.height*(.076-.051*thin);
      const c=this.scratch.getContext('2d');c.clearRect(0,0,w,h);
      if(thin<1){
        c.save();c.filter='blur(1.45px)';c.drawImage(this.canvas,1.35,-.5);c.restore();
        c.save();c.globalCompositeOperation='destination-in';
        c.translate(cx,cy);c.rotate(f.roll);c.scale(ew,eh);
        const edge=c.createRadialGradient(0,0,.42,0,0,1);
        edge.addColorStop(0,'#000');edge.addColorStop(1,'#0000');
        c.fillStyle=edge;c.fillRect(-w,-h,2*w,2*h);c.restore();
        ctx.save();ctx.globalAlpha=.54*(1-thin);ctx.drawImage(this.scratch,0,0);ctx.restore();
      }
      ctx.save();ctx.translate(cx,cy);ctx.rotate(f.roll);ctx.scale(ew,eh);
      const fog=ctx.createRadialGradient(0,0,0,0,0,1);
      fog.addColorStop(0,`rgba(199,188,224,${.45*(1-thin)})`);fog.addColorStop(.65,`rgba(216,207,230,${.28*(1-thin)})`);fog.addColorStop(1,'#d8cfe600');
      ctx.fillStyle=fog;ctx.fillRect(-1,-1,2,2);ctx.restore();
      if(thin>0){
        ctx.save();ctx.translate(cx,cy);ctx.rotate(f.roll);ctx.globalAlpha=thin*.60;
        ctx.strokeStyle='#bce1bf';ctx.lineWidth=.85;
        ctx.beginPath();
        for(const y of [-eh*.43,eh*.12,eh*.57]){ctx.moveTo(-ew,y);ctx.lineTo(ew,y);}
        for(let i=-4;i<=4;i++){ctx.moveTo(i*ew/5,eh*.60);ctx.lineTo(i*ew/5,eh*.84);}
        ctx.stroke();ctx.restore();
      }
    }
    hands(s,t) {
      const {ctx}=this;
      if(s.phase<5||s.phase===7){this.inkHands.clear();return;}
      const indexOnly=[[0,5,6,7,8],[0,1,5],[5,9]];
      const full=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[17,0],[0,9]];
      for(const tr of s.tracks.values()){
        const h=tr.hand,end=s.phase===8&&h.palm;
        const cheek=(s.phase===5||s.phase===6)&&h.point&&s.cheek(h.points[8]);
        if(!end&&!cheek)continue;
        const cached=this.inkHands.get(h.label);
        if(cached?.seen===tr.seen)continue;
        const points=cached&&tr.seen-cached.seen<125?
          h.points.map((p,i)=>mix(cached.points[i],p,.72)):h.points;
        this.inkHands.set(h.label,{points,end,seen:tr.seen});
      }
      for(const [label,ink] of this.inkHands){
        const {points,end,seen}=ink;
        const a=1-clamp((t-seen-50)/215,0,1);
        if(!a || (s.phase===8)!==end){this.inkHands.delete(label);continue;}
        ctx.save();ctx.globalAlpha=a;ctx.strokeStyle='#d8eff4ce';ctx.lineWidth=1.05;
        ctx.shadowColor='#3a3769';ctx.shadowBlur=2;
        for(const path of end?full:indexOnly){
          curve(ctx,path.map(i=>points[i]));ctx.stroke();
        }
        ctx.fillStyle='#f3f6f1';
        for(const id of end?[4,5,8,9,12,13,16,17,20]:[5,6,7,8]){
          const p=points[id];ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,TAU);ctx.fill();
        }
        ctx.restore();
      }
    }
    draw(s,t,source,fit,mirror,matte,cleanRoom,opacity,debug) {
      const {ctx,w,h}=this;
      this.mirrorRoom(source,fit,mirror);
      ctx.drawImage(s.phase===0&&cleanRoom&&matte?cleanRoom:this.room,0,0);
      const backdrop=()=>{
        this.mountain(s,t);
        if(s.phase===2&&s.ripples.length){
          if(!this.refract?.(ctx,this.room,s.ripples,t)) this.refractFallback(s.ripples,t);
        }
        if(s.phase===3)this.wing(s,t);
        this.birds(s,t);
        if(s.phase===8)this.fragments(s,t);
      };
      const hasBackdrop=this.mountainMix>.01||this.fogMix>.01||[1,2,3,5,8].includes(s.phase);
      if(hasBackdrop){
        ctx.save();
        if(!matte&&s.face){
          const f=s.face;
          ctx.beginPath();ctx.rect(0,0,w,h);ctx.moveTo(f.x+f.width*.95,f.y+f.height*.57);
          ctx.ellipse(f.x,f.y+f.height*.57,Math.max(1,f.width*.95),Math.max(1,f.height*1.48),0,0,TAU);
          ctx.clip('evenodd');
        }
        backdrop();ctx.restore();
      }
      if(matte&&(hasBackdrop||s.phase===0&&cleanRoom)){
        ctx.save();ctx.globalAlpha=s.phase===0&&cleanRoom?opacity:1;
        this.camera(ctx,matte.person,fit,mirror);ctx.restore();
      }
      if(s.phase===0)this.frostEffect(s,t);
      if(s.phase===3)this.print(s,t,matte,fit,mirror);
      this.portal(s,t,matte,fit,mirror);
      this.windows(s,t);
      this.eyeGlass(s,t);
      this.hands(s,t);
      if(debug){
        for(const hand of s.hands){
          for(const [i,p] of [hand.center,hand.points[8]].entries()){
            ctx.fillStyle=i?'#ffd6a2':'#9deaff';ctx.beginPath();ctx.arc(p.x,p.y,3,0,TAU);ctx.fill();
          }
        }
      }
    }
    refractFallback(waves,t) {
      const {ctx,w,h}=this;
      for(const p of waves.slice(-3)){
        const age=(t-p.t)/1000;if(age<0||age>=1.65)continue;
        const r=age*h*.48,spread=14+age*23, step=7;
        const x0=Math.max(0,Math.floor((p.x-r-spread*2)/step)*step);
        const y0=Math.max(0,Math.floor((p.y-r-spread*2)/step)*step);
        for(let y=y0;y<Math.min(h,p.y+r+spread*2);y+=step)
          for(let x=x0;x<Math.min(w,p.x+r+spread*2);x+=step){
            const dx=x+step/2-p.x,dy=y+step/2-p.y,d=Math.hypot(dx,dy),b=(d-r)/spread;
            if(Math.abs(b)>1.75)continue;
            const a=Math.sin(b*3.5)*Math.exp(-b*b)*Math.pow(1-age/1.65,1.5);
            const sx=clamp(x+dx/Math.max(1,d)*a*11,0,w-step);
            const sy=clamp(y+dy/Math.max(1,d)*a*11,0,h-step);
            ctx.drawImage(this.room,sx,sy,step,step,x,y,step,step);
            ctx.fillStyle=a>0?`rgba(198,231,255,${a*.09})`:`rgba(21,47,79,${-a*.07})`;
            ctx.fillRect(x,y,step,step);
          }
      }
    }
  }
  return {Renderer,status};
})();
