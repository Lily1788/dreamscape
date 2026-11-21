const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const {Performance, hand, frameCorners, cardDuration} = vm.runInNewContext(
  fs.readFileSync(require.resolve('../gestures.js'), 'utf8')+'\nDreamGestures'
);
const p=(x,y,z=0)=>({x,y,z});
const face=(closed=false,roll=0)=>({x:480,y:205,width:132,height:175,eyes:[p(450,180),p(510,180)],closed,roll});
function points(x,y,pose) {
  const marks=[p(x,y+55),p(x-18,y+19),p(x-33,y+12),p(x-48,y+3),p(x-59,y-7)];
  for(const [j,dx] of [-27,-8,12,30].entries()){
    const stretch=pose==='palm'||pose==='point'&&j===0||pose==='two'&&j<2;
    marks.push(p(x+dx,y),p(x+dx,y-19),p(x+dx+(stretch?0:8),y-36+(stretch?0:16)),
      p(x+dx+(stretch?0:10),y-57+(stretch?0:54)));
  }
  return marks;
}
function setup(){
  const s=new Performance();
  let t=0;
  const step=(samples=[],f=face(),dt=50)=>{
    t+=dt;
    const hands=samples.map(([x,y,pose,label='left',shift=0])=>{
      const marks=points(x,y,pose);
      marks[8].y+=shift;
      return hand(marks,label,s.tracks.get(label)?.hand);
    });
    return s.update(hands,f,t);
  };
  const tap=(x,y,label='left',depth=false)=>{
    step([[x,y,'point',label]]);
    step([[x,y,'point',label,-15]],face(),48);
    step([[x,y,'point',label,-2]],face(),depth?35:58);
  };
  return {s,step,tap,now:()=>t};
}
test('sweep adds persistent segments and two held palms enter the mountain phase',()=>{
  const {s,step}=setup();
  for(let i=0;i<5;i++)step([[180+i*20,310,'palm']]);
  assert.ok(s.sweeps.length>=4);
  step();assert.ok(s.sweeps.length>=4);
  for(let i=0;i<7;i++)step([[235,315-i*4,'palm'],[726,310+i*4,'palm','right']]);
  assert.equal(s.phase,1);assert.ok(s.peaks[0]>s.peaks[1]);
});
test('single-finger tap produces one fixed ripple; similar poses and holding do not fire',()=>{
  const {s,step,tap}=setup();s.enter(1,0,'');
  for(const pose of ['palm','two','fist','point']) for(let i=0;i<10;i++)step([[215+(pose==='point'?0:i*3),300,pose]]);
  assert.equal(s.phase,1);assert.equal(s.ripples.length,0);
  step([],face(),260);
  tap(215,300);assert.equal(s.phase,2);assert.equal(s.ripples.length,1);
  const hit=s.ripples[0];assert.equal(hit.x,188);assert.equal(hit.y,228);
  for(let i=0;i<10;i++)step([[215,300,'point']]);
  assert.equal(s.ripples.length,1);
  tap(734,296,'right');assert.equal(s.ripples.length,2);assert.equal(s.ripples[1].x,707);
});
test('wing phase requires closed eyes with clasp and motion; reopening starts separate flashes',()=>{
  const {s,step,now}=setup();s.enter(2,0,'');
  const fists=[[373,285,'fist'],[596,285,'fist','right']];
  step(fists,face());step(fists,face(false,.11));assert.equal(s.phase,2);
  step(fists,face(true,.13));assert.equal(s.phase,3);
  for(let i=0;i<30;i++)step(fists,face(true,.14+i*.014));
  assert.equal(s.flashAt,Infinity);
  for(let i=0;i<35;i++)step(fists,face());
  assert.equal(s.phase,4);assert.ok(now()-s.flashAt>=720);
});
test('four corners follow skewed motion and survive a dropped hand',()=>{
  const s=new Performance();s.enter(4,0,'');
  const sample=(ox,oy)=>{
    const l=hand(points(368+ox,275,'point'),'left');
    const r=hand(points(588+ox,315,'point'),'right');
    l.points[4]=p(360+ox,240+oy);l.points[8]=p(349+ox,328+oy);
    r.points[4]=p(594+ox,348+oy);r.points[8]=p(607+ox,258+oy);
    l.gap=1.5;r.gap=1.7;l.palm=r.palm=false;
    return [l,r];
  };
  assert.ok(frameCorners(sample(0,0).reverse()));
  const first=sample(0,0);
  s.update(first,face(),100);s.update(first,face(),190);
  assert.equal(s.texture,0);
  s.update([first[0]],face(),235);
  assert.ok(s.frame);assert.equal(s.frameSeen,190);
  for(const t of [270,360])s.update(sample(26,-12),face(),t);
  assert.ok(s.frame[0].x>360);assert.equal(s.texture,0);
  s.update([],face(),680);
  for(const t of [720,820])s.update(sample(-10,4),face(),t);
  assert.equal(s.texture,1);
  const invalid=sample(0,0);invalid[1].points[4]=invalid[1].points[8];
  assert.equal(frameCorners(invalid),null);
});
test('palm anchors are independent and moving palms do not open face windows',()=>{
  const {s,step}=setup();s.enter(5,0,'');
  step([[150,305,'palm']]);
  const first=s.groups.get('left').origin.x;
  step([[325,250,'palm'],[775,305,'palm','right']]);
  assert.equal(s.groups.size,2);assert.ok(s.groups.get('left').origin.x>first+50);
  assert.equal(s.cards.length,0);
  step([[775,305,'palm','right']],face(),1050);
  assert.equal(s.groups.size,1);
});
test('four face taps show one card at a time and expire without a gesture',()=>{
  const {s,step,tap}=setup();s.enter(5,0,'');
  for(let i=0;i<12;i++)step([[418,266,'point']]);
  assert.equal(s.cards.length,0);
  for(let i=0;i<5;i++)step([[418,268+i,'two']]);
  assert.equal(s.cards.length,0);
  for(const [index,x] of [560,418,565,414].entries()){
    step([],face(),300);tap(x,267);
    assert.equal(s.snapshot(s.cards.at(-1).t).windows,1);
    assert.equal(s.cards.at(-1).index,index);
  }
  assert.equal(s.phase,6);
  s.advance(s.cards.at(-1).t+cardDuration);
  assert.equal(s.phase,7);assert.equal(s.cards.length,0);
  step([],face(),cardDuration+90);
  for(let i=0;i<6;i++)step([[560,280,'point']]);
  assert.equal(s.phase,7);
  step([],face(),280);
  tap(560,280);
  assert.equal(s.phase,8);
  step([[650,305,'palm','right']]);step([[650,305,'palm','right'],[337,306,'palm']]);
  assert.ok(s.endPalms);
  step();step([],face(),880);
  assert.equal(s.phase,0);assert.equal(s.cards.length,0);assert.equal(s.groups.size,0);
});

test('one cheek card can be followed by an off-cheek finishing tap',()=>{
  const {s,step,tap,now}=setup();s.enter(5,0,'');
  tap(560,267);
  assert.equal(s.snapshot(now()).windows,1);
  step([],face(),cardDuration+60);
  assert.equal(s.snapshot(now()).windows,0);
  tap(790,300);
  assert.equal(s.phase,8);
});
