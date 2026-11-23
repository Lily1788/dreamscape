'use strict';

const DreamGestures = (() => {
  const cardFade=360;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y);
  const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const joint = (a,b,c) => {
    const dot = (a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y);
    return dot/Math.max(1,distance(a,b)*distance(c,b));
  };
  function hand(points, label, previous) {
    const palm = points[9], wrist = points[0];
    const scale = Math.max(14,distance(palm,wrist),distance(points[5],points[17]));
    const center = mix(wrist,palm,.70);
    const fingers = [5,9,13,17].map(i => {
      const straight = joint(points[i],points[i+1],points[i+3]) < -.72;
      const long = distance(points[i+3],wrist) > distance(points[i+1],wrist)+scale*.18;
      return straight && long;
    });
    const gap = distance(points[4],points[8])/scale;
    const pinch = gap < (previous?.pinch ? .46 : .34);
    const open = fingers.filter(Boolean).length;
    const point = !pinch && fingers[0] && open===1 && [9,13,17].every(i =>
      joint(points[i],points[i+1],points[i+3]) > -.91 ||
      distance(points[i+3],palm)<scale*1.08);
    return {points,label,center,scale,gap,pinch,point,palm:open>=3&&!pinch,
      clasp:pinch||open===0,velocity:previous?distance(previous.center,center)/scale:0};
  }

  function handInFrame(hand) {
    const margin=clamp(hand.scale*.10,7,21);
    return hand.points.every(p=>p.x>=margin&&p.y>=margin&&p.x<=960-margin&&p.y<=540-margin);
  }
  function uniqueHands(items) {
    const distinct=[];
    for(const item of items){
      if(distinct.some(other=>distance(other.points[9],item.points[9])<
        Math.max(14,distance(item.points[0],item.points[9])*.45)))continue;
      if(distinct.length===2)break;
      distinct.push(item);
    }
    return distinct;
  }

  function frameCorners(hands) {
    if(hands.length!==2 || hands.some(h=>h.gap<.47||h.palm||
      distance(h.points[8],h.points[5])<h.scale*.54)) return null;
    const size=(hands[0].scale+hands[1].scale)/2;
    const pts=hands.flatMap(h=>[h.points[4],h.points[8]]);
    const center=pts.reduce((p,q)=>({x:p.x+q.x/4,y:p.y+q.y/4}),{x:0,y:0});
    pts.sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x));
    const area=pts.reduce((s,p,i)=>s+p.x*pts[(i+1)%4].y-p.y*pts[(i+1)%4].x,0)/2;
    if(area<size*size*.33 || area>size*size*17 ||
      pts.some((p,i)=>cross(p,pts[(i+1)%4],pts[(i+2)%4])<size*size*.044 ||
        distance(p,pts[(i+1)%4])<size*.27)) return null;
    const topLeft=pts.reduce((j,p,i)=>p.x+p.y*.85<pts[j].x+pts[j].y*.85?i:j,0);
    return pts.map((_,i)=>pts[(i+topLeft)%4]);
  }

  class Performance {
    constructor() { this.reset(0); }
    reset(t) {
      this.phase=0;this.entered=t;this.frostDelay=0;this.reason='等待扫掌';this.hands=[];this.tracks=new Map();
      this.sweeps=[];this.sweepDistance=0;this.ripples=[];this.cards=[];this.cardsExit=-Infinity;this.orbit=new Map();this.orbitDone=false;this.eye=0;this.palmHeld=false;this.lastEndPalm=-Infinity;
      this.peaks=[0,0];this.lastPeak=-Infinity;this.groups=new Map();this.frame=null;
      this.frameSeen=-Infinity;this.frameSince=null;this.texture=-1;this.frames=0;
      this.closedAt=this.claspAt=-Infinity;this.face=null;
      this.wingTurnAt=this.wingLastHand=-Infinity;this.flashAt=Infinity;this.endPalms=false;this.neutralAt=null;
      this.handFrameStreak=0;this.lastHandFrame=-Infinity;this.lastDual=-Infinity;this.dualSamples=0;this.lastCard=-Infinity;
    }
    enter(phase,t,reason) {
      this.phase=phase;this.entered=t;this.reason=reason;
    }
    cheek(tip) {
      const face=this.face;
      if(!face) return false;
      const dx=Math.abs(tip.x-face.x)/Math.max(1,face.width);
      const dy=(tip.y-face.y)/Math.max(1,face.height);
      return dx>.29&&dx<1.12&&dy>-.34&&dy<.49;
    }
    tap(track,h,t,sensitivity) {
      const tip=h.points[8];
      if(!h.point) {
        if(track.off==null) track.off=t;
        if(t-track.off>85) track.tap=null;
        return null;
      }
      track.off=null;
      const p=track.tap??={origin:tip,peak:tip,base:h.points[6],started:t,furthest:0,fired:false};
      const rel={x:tip.x-h.points[6].x,y:tip.y-h.points[6].y};
      const initial={x:p.origin.x-p.base.x,y:p.origin.y-p.base.y};
      const depth=-(tip.z-p.origin.z);
      const relativeTravel=distance(rel,initial);
      const travel=Math.max(distance(tip,p.origin),relativeTravel*1.35,depth*1.8);
      const velocity=p.last?distance(tip,p.last)/h.scale*1000/Math.max(12,t-p.lastAt):0;
      p.fastest=Math.max(p.fastest||0,velocity);
      p.relative=Math.max(p.relative||0,relativeTravel/h.scale);
      p.last=tip;p.lastAt=t;
      if(travel>p.furthest){p.furthest=travel;p.peak=tip;}
      const age=t-p.started,stroke=p.furthest/h.scale;
      if(p.fired) {
        if(travel/h.scale<.085 && t-p.fireAt>205) track.tap=null;
        return null;
      }
      const quickStop=age>=85&&stroke>=.19/sensitivity&&p.fastest>1.25/sensitivity&&
        velocity<p.fastest*.31&&(p.relative>.10/sensitivity || this.phase>=5);
      if(age>=28&&age<=420&&stroke>=.13/sensitivity&&stroke<1.34&&
        (travel<p.furthest*.78 || depth>h.scale*.14/sensitivity || quickStop)) {
        p.fired=true;p.fireAt=t;return p.peak;
      }
      if(age>420||stroke>=1.34) track.tap=null;
      return null;
    }
    updateOrbit(hands) {
      for(const h of hands){
        const m=this.orbit.get(h.label)??{p:h.center,angle:null,turn:0,travel:0};
        const dx=h.center.x-m.p.x,dy=h.center.y-m.p.y,step=Math.hypot(dx,dy);
        if(step>h.scale*.035){
          const angle=Math.atan2(dy,dx);
          if(m.angle!=null){
            const delta=angle-m.angle, turn=Math.atan2(Math.sin(delta),Math.cos(delta));
            if(Math.abs(turn)<1.9)m.turn+=turn;
          }
          m.angle=angle;m.p=h.center;m.travel+=step;
        }
        this.orbit.set(h.label,m);
        if(Math.abs(m.turn)>2.4&&m.travel>h.scale*.52)this.orbitDone=true;
      }
    }
    update(hands,face,t,sensitivity=1) {
      this.face=face;
      if(face?.closed) this.closedAt=t;
      this.hands=hands;
      const complete=hands.length>0&&hands.every(handInFrame);
      this.handFrameStreak=complete?(t-this.lastHandFrame<245?this.handFrameStreak+1:1):0;
      this.lastHandFrame=t;
      const palms=hands.filter(h=>h.palm);
      const framedPalms=palms.filter(handInFrame);
      const clasp=hands.length===2&&hands.every(h=>h.clasp&&(!face||
        Math.abs(h.center.y-face.y)<face.height*1.40));
      if(clasp) this.claspAt=t;
      const taps=[];
      for(const h of hands) {
        const track=this.tracks.get(h.label)??{};
        if(t-(track.seen??-Infinity)>220) track.tap=null;
        const hit=this.tap(track,h,t,sensitivity);
        if(hit) taps.push(hit);
        if(this.phase===0&&t-this.entered>=this.frostDelay&&h.palm&&track.hand?.palm&&t-track.seen<170&&h.velocity>.025) {
          this.sweeps.push([track.hand.center,h.center,h.scale]);
          this.sweepDistance+=distance(track.hand.center,h.center);
        }
        track.seen=t;track.hand=h;this.tracks.set(h.label,track);
      }
      for(const [label,track] of this.tracks) {
        if(t-track.seen>430) this.tracks.delete(label);
      }
      this.ripples=this.ripples.filter(p=>t-p.t<1650);
      const phase=this.phase;
      if(phase===0 && palms.length) {
        const swept=this.sweepDistance>palms[0].scale*.78;
        if(swept)this.reason='已接受扫掌，清晰轨迹保留';
        if(framedPalms.length===2&&swept&&palms.every(p=>p.center.y<445)&&
          Math.abs(palms[0].center.x-palms[1].center.x)>palms[0].scale*2.1){
          this.dualSamples=t-this.lastDual<250?this.dualSamples+1:1;
          this.lastDual=t;
          if(this.dualSamples>=2)this.enter(1,t,'已接受双掌托山');
        }
      }

      if(this.phase===1) {
        if(framedPalms.length) this.lastPeak=t;
        for(const p of framedPalms) {
          const side=p.center.x<480?0:1;
          this.peaks[side]=clamp((455-p.center.y)/340,.05,1.25);
        }
      }
      if((phase===1||phase===2)&&taps.length) {
        if(phase===1) this.enter(2,t,'已接受短点触');
        else this.reason='已接受食指点触';
        for(const hit of taps) this.ripples.push({...hit,t});
      }
      if(phase===2) {
        if(clasp&&t-this.closedAt<250){
          const anchors=face?[...hands,{label:'face',center:face,scale:face.width}]:hands;
          this.updateOrbit(anchors);
          if(this.orbitDone)this.wingTurnAt=t;
        }else if(!this.orbitDone&&t-Math.min(this.closedAt,this.claspAt)>420||
          t-this.wingTurnAt>5200&&this.orbitDone){
          this.orbit.clear();this.orbitDone=false;
        }
        if(this.orbitDone&&framedPalms.length===2){
          this.enter(3,t,'转圈后双掌张开，羽翼保持至手指出画');
          this.wingLastHand=t;
          this.orbit.clear();this.orbitDone=false;
        }
      }
      if(phase===3) {
        const fingerVisible=hands.some(h=>h.points.slice(1).some(p=>
          p.x>=0&&p.x<=960&&p.y>=0&&p.y<=540));
        if(fingerVisible&&this.flashAt===Infinity)this.wingLastHand=t;
        if(t-this.wingLastHand>260&&this.flashAt===Infinity)this.flashAt=t+280;
        if(t-this.flashAt>=720) this.enter(4,t,'等待双手成框');
      }
      if(phase===4||this.phase===4) {
        const corners=frameCorners(hands);
        if(corners) {
          this.frameSince??=t;
          if(t-this.frameSince>=75) {
            const fresh=t-this.frameSeen>245;
            if(fresh){this.texture=(this.texture+1)%4;this.frames++;}
            this.frame=this.frame&&!fresh?corners.map((p,i)=>mix(this.frame[i],p,.61)):corners;
            this.frameSeen=t;this.reason='已接受四指角点';
          }
        } else {
          this.frameSince=null;
          if(this.frames&&framedPalms.length&&t-this.frameSeen>280) this.enter(5,t,'已接受张掌召唤飞鸟');
        }
      }
      if(this.phase===5) {
        for(const p of framedPalms) {
          const group=this.groups.get(p.label)??{origin:p.center,start:t,seed:this.groups.size*723};
          group.origin=mix(group.origin,p.center,.50);group.seen=t;this.groups.set(p.label,group);
        }
        for(const [id,g] of this.groups) if(t-g.seen>1000) this.groups.delete(id);
      }
      if(phase===5||phase===6) {
        const hit=taps.find(p=>this.cheek(p));
        if(hit&&this.cards.length<4&&t-this.lastCard>220) {
          if(phase===5) this.enter(6,t,'已接受脸侧点触');
          this.cards.push({t,index:this.cards.length,side:hit.x<face.x?'画面左':'画面右'});
          this.lastCard=t;this.reason='已接受'+this.cards.at(-1).side+'脸侧点触 · '+this.cards.length+'/4';
        }
      }
      if(phase===6&&this.cards.length===4&&clasp&&t-this.closedAt<320){
        this.orbit.clear();this.orbitDone=false;
        this.enter(7,t,'闭眼捏手转圈，四幅画保持');
      }
      if(phase===7&&this.cardsExit===-Infinity){
        if(clasp&&t-this.closedAt<320)this.updateOrbit(hands);
        if(this.orbitDone&&(!clasp&&t-this.claspAt>130||face&&!face.closed&&t-this.closedAt>170)){
          this.cardsExit=t;this.reason='转圈完成，等待点脸';
        }else if(!this.orbitDone&&t-Math.min(this.claspAt,this.closedAt)>650){
          this.orbit.clear();
          this.enter(6,t,'四幅画保持，请闭眼捏手转圈');
        }
      }
      const faceTap=taps.find(p=>face&&Math.abs(p.x-face.x)<face.width*.74&&
        Math.abs(p.y-face.y)<face.height*.54);
      if(phase===7&&t-this.cardsExit>=cardFade&&this.cardsExit!==-Infinity&&faceTap){
        this.eye=faceTap.x<face.x?0:1;
        this.enter(8,t,'机械目镜已锁定，张掌切换');
      }
      if(phase===8) {
        if(palms.length){
          if(!this.palmHeld)this.eye=1-this.eye;
          this.palmHeld=true;this.endPalms=true;this.neutralAt=null;
        }
        else if(!hands.length||hands.every(h=>!h.point)) {
          this.neutralAt??=t;
          if(this.endPalms&&t-this.neutralAt>850){this.reset(t);this.frostDelay=625;}
        } else this.neutralAt=null;
        if(!palms.length&&t-(this.lastEndPalm??-Infinity)>150)this.palmHeld=false;
        if(palms.length)this.lastEndPalm=t;
      }
      return this.snapshot(t);
    }
    snapshot(t) {
      return {phase:this.phase+1,reason:this.reason,windows:this.cardsExit===-Infinity||t-this.cardsExit<cardFade?this.cards.length:0,cardsShown:this.cards.length,ripples:this.ripples.length,
        corners:this.frame,texture:this.texture,groups:this.groups.size,
        candidates:this.hands.map(h=>({hand:h.label,palm:h.palm,point:h.point,pinch:h.pinch,
          anchor:h.center,tip:h.points[8]})),
        wait:this.phase===1?'需要食指短点触；悬停、双指和摊掌不计':
          this.phase===2?(this.orbitDone?'转圈已确认，请张开双掌':'可继续点出水波，或闭眼捏手转圈准备羽翼'):
          this.phase===4?'需要四角稳定成凸四边形':
          this.phase===5?'需要食指在脸侧短点触':
          this.phase===6?'逐次点脸，集齐后闭眼捏手转圈':
          this.phase===7?'转圈结束后用食指点脸，启动单眼目镜':'',
        frameAge:t-this.frameSeen};
    }
  }
  return {Performance,hand,frameCorners,uniqueHands,handInFrame,clamp,distance,mix,cardFade};
})();
