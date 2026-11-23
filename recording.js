'use strict';

// Dreamscape's local H.264/AAC recording pipeline. No upload or server processing.
const DreamscapeRecorder = (() => {
  const MP4 = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1,mp4a.40.2"',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4'
  ];
  const WEBM = ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const text = (bytes,a,b) => String.fromCharCode(...bytes.subarray(a,b));
  const $ = id => document.getElementById(id);

  async function inspectMP4(blob) {
    if(blob.size < 2048) throw Error('录制文件太小，未正确封装');
    const front = new Uint8Array(await blob.slice(0,Math.min(blob.size,2097152)).arrayBuffer());
    if(text(front,4,8)!=='ftyp') throw Error('文件不是有效的 MP4 封装');
    const back = new Uint8Array(await blob.slice(Math.max(0,blob.size-2097152)).arrayBuffer());
    const atoms = new TextDecoder('latin1').decode(front)+new TextDecoder('latin1').decode(back);
    if(!/(avc1|avc3)/.test(atoms)||!atoms.includes('mp4a'))
      throw Error('MP4 中缺少 H.264 视频或 AAC 音轨');
    const url=URL.createObjectURL(blob),probe=document.createElement('video');
    probe.preload='metadata';probe.muted=true;
    try {
      await new Promise((resolve,reject)=>{
        const clear=()=>{clearTimeout(timer);probe.removeEventListener('loadedmetadata',done);probe.removeEventListener('error',failed);};
        const done=()=>{clear();resolve();};
        const failed=()=>{clear();reject(Error('播放器无法解码 MP4'))};
        const timer=setTimeout(()=>{clear();reject(Error('MP4 元数据验证超时'))},12000);
        probe.addEventListener('loadedmetadata',done);probe.addEventListener('error',failed);
        probe.src=url;probe.load();
      });
      if(!Number.isFinite(probe.duration)||probe.duration<=0)throw Error('MP4 时长信息无效');
    } finally {
      probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);
    }
  }

  async function blobURL(src,type){
    const res=await fetch(src);
    if(!res.ok)throw Error('转码组件加载失败（HTTP '+res.status+'）');
    return URL.createObjectURL(new Blob([await res.arrayBuffer()],{type}));
  }
  function script(src){
    return new Promise((resolve,reject)=>{
      const el=document.createElement('script');el.src=src;
      el.onload=resolve;el.onerror=()=>reject(Error('MP4 转码组件下载失败'));
      document.head.append(el);
    });
  }
  async function transcode(blob,sourceExt,updateStatus){
    // ffmpeg.wasm 0.12 single-thread core runs on static GitHub Pages.
    const lib='https://cdnjs.cloudflare.com/ajax/libs/ffmpeg/0.12.15/umd';
    const core='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    if(!window.FFmpegWASM)await script(lib+'/ffmpeg.min.js');
    if(!window.FFmpegWASM?.FFmpeg)throw Error('浏览器无法初始化 MP4 转码器');
    const ffmpeg=new window.FFmpegWASM.FFmpeg(),urls=[];
    const fetchObjectURL=async(u,type)=>{const obj=await blobURL(u,type);urls.push(obj);return obj;};
    try {
      updateStatus('正在加载本地 MP4 转码模块（首次需要下载约 30MB）…');
      const [classWorkerURL,coreURL,wasmURL]=await Promise.all([
        fetchObjectURL(lib+'/814.ffmpeg.js','text/javascript'),
        fetchObjectURL(core+'/ffmpeg-core.js','text/javascript'),
        fetchObjectURL(core+'/ffmpeg-core.wasm','application/wasm')
      ]);
      ffmpeg.on('progress',({progress})=>{
        if(Number.isFinite(progress))updateStatus('正在生成 MP4：'+Math.round(clamp(progress,0,1)*100)+'%');
      });
      await ffmpeg.load({classWorkerURL,coreURL,wasmURL});
      await ffmpeg.writeFile('in.'+sourceExt,new Uint8Array(await blob.arrayBuffer()));
      updateStatus('正在把视频转换为 H.264、音乐转换为 AAC，请保持网页打开…');
      const rc=await ffmpeg.exec([
        '-fflags','+genpts','-i','in.'+sourceExt,
        '-map','0:v:0','-map','0:a:0',
        '-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','160k','-ar','48000',
        '-af','aresample=async=1:first_pts=0',
        '-movflags','+faststart','-avoid_negative_ts','make_zero','out.mp4'
      ]);
      if(rc!==0)throw Error('转码未成功，错误码 '+rc);
      const data=await ffmpeg.readFile('out.mp4');
      if(!data?.byteLength)throw Error('转码输出为空');
      return new Blob([new Uint8Array(data)],{type:'video/mp4'});
    }finally{
      ffmpeg.terminate();
      urls.forEach(u=>URL.revokeObjectURL(u));
    }
  }

  function attach({canvas,audio,isRunning,ensureAudio,getAudioContext,getMusicTrack,getOffset}){
    let recorder=null,stream=null,chunks=[],busy=false,failed=null,mime='',savedURL=null;
    const button=$('recordButton'),label=$('recordButtonLabel'),toast=$('recordToast'),dl=$('recordDownload');
    const status=(message)=>{
      $('recordState').textContent=message;toast.textContent=message;toast.hidden=false;
    };
    const active=()=>recorder?.state==='recording';
    function update(){
      button.disabled=busy||(!active()&&!isRunning());
      button.classList.toggle('is-recording',!!active());
      label.textContent=active()?'停止并导出':busy?'导出中…':'录制 MP4';
      button.setAttribute('aria-pressed',active()?'true':'false');
    }
    function resetDownload(){
      if(savedURL)URL.revokeObjectURL(savedURL);
      savedURL=null;dl.hidden=true;dl.removeAttribute('href');
    }
    function offer(blob,filename,caption){
      resetDownload();savedURL=URL.createObjectURL(blob);
      dl.href=savedURL;dl.download=filename;dl.textContent=caption;dl.hidden=false;
      dl.click(); // Manual link remains if the browser blocks an automatic download.
    }
    async function finalize(blob,sourceMime,issue){
      try {
        if(issue)throw issue;
        if(blob.size<2048)throw Error('没有收到录制的视频帧');
        let out=blob;
        if(sourceMime.startsWith('video/mp4')){
          try{await inspectMP4(out)}
          catch(e){status('原生 MP4 校验失败，正在重新编码…');out=await transcode(blob,'mp4',status)}
        }else out=await transcode(blob,'webm',status);
        await inspectMP4(out);
        const name='Dreamscape-'+new Date().toISOString().replace(/[:.]/g,'-')+'.mp4';
        offer(out,name,'保存 MP4');
        status('MP4 已校验：H.264 视频 + AAC 音频。若未自动下载，请点击“保存 MP4”。');
      } catch(e) {
        console.error('Dreamscape MP4 export:',e);
        const ext=sourceMime.startsWith('video/mp4')?'mp4':'webm';
        if(blob.size>2048)offer(blob,'Dreamscape-original.'+ext,'保存原始录制');
        status('MP4 导出失败：'+e.message+'。已保留原始录制文件，未伪装成 MP4。');
      } finally {busy=false;update();}
    }
    function stop(){
      if(!active())return;
      busy=true;status('正在结束录制并整理音视频…');
      try{recorder.stop()}catch(e){busy=false;status('停止录制失败：'+e.message)}
      update();
    }
    async function start(){
      if(busy||active()||!isRunning())return;
      let createdStream=null,started=false;
      try {
        if(typeof MediaRecorder==='undefined'||!canvas.captureStream)
          throw Error('浏览器不支持 MediaRecorder 或画布录制');
        ensureAudio();
        const context=getAudioContext();
        if(context?.state==='suspended')await context.resume();
        const picture=canvas.captureStream(30).getVideoTracks()[0];
        const music=getMusicTrack();
        if(!picture||!music)throw Error('未取得画面与音频轨道');
        createdStream=new MediaStream([picture,music.clone()]);
        let picked=null,selected='';
        for(const candidate of [...MP4,...WEBM]){
          if(!MediaRecorder.isTypeSupported(candidate))continue;
          try {
            picked=new MediaRecorder(createdStream,{
              mimeType:candidate,videoBitsPerSecond:4000000,audioBitsPerSecond:160000
            });selected=candidate;break;
          } catch(e){console.warn('Recording codec skipped:',candidate,e)}
        }
        if(!picked)throw Error('当前浏览器不支持可用的 MP4 或 WebM 编码');
        resetDownload();
        recorder=picked;stream=createdStream;mime=recorder.mimeType||selected;failed=null;chunks=[];
        recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
        recorder.onerror=e=>{failed=e.error||Error('录制期间音视频编码失败');if(active())stop()};
        recorder.onstop=()=>{
          const file=new Blob(chunks,{type:mime}),err=failed,sourceMime=mime;
          stream?.getTracks().forEach(t=>t.stop());
          stream=null;recorder=null;chunks=[];
          busy=true;update();
          finalize(file,sourceMime,err);
        };
        recorder.start(500);started=true;
        // Start playback in the same user click that starts the recorder.
        if(audio.paused&&audio.src){
          const duration=audio.duration||29.8;
          if(!audio.currentTime||audio.currentTime>=duration-.1)
            audio.currentTime=clamp(getOffset(),0,Math.max(0,duration-.05));
          await audio.play();
        }
        status('正在录制视频与音乐，'+(mime.startsWith('video/mp4')?'直接输出 MP4':'停止后本地转换 MP4')+'…');
        update();
      } catch(e) {
        failed=e;
        if(started&&active())stop();
        else createdStream?.getTracks().forEach(t=>t.stop());
        status('录制启动失败：'+e.message);
        update();
      }
    }
    button.addEventListener('click',()=>active()?stop():start());
    update();
    return {update,stop};
  }
  return {attach};
})();
