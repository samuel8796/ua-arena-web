/** Rectangular non-destructive cropper for UA Arena artwork (v2.3).
 * Decks: 16:9; profile and public-card banners: 3:1.
 * Writes happen only after explicit confirmation in the calling screen.
 */
const PRESETS={
  deck:{label:'牌組圖片',ratio:16/9,width:960,height:540,limit:150000},
  profile:{label:'個人資料背景',ratio:3,width:960,height:320,limit:90000},
  card:{label:'個人名片背景',ratio:3,width:960,height:320,limit:90000}
};
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));

export async function chooseWideCrop(file,kind='deck'){
  const preset=PRESETS[kind];
  if(!preset)throw new Error('未知的圖片類型。');
  if(!file||!file.type.startsWith('image/'))throw new Error('請選擇圖片檔案。');
  if(file.size>12*1024*1024)throw new Error('圖片超過 12 MB，請先縮小後上傳。');
  const url=URL.createObjectURL(file),source=new Image();
  try{
    await new Promise((ok,fail)=>{
      source.onload=ok;
      source.onerror=()=>fail(new Error('無法讀取圖片，請使用 JPG、PNG 或其他瀏覽器支援的格式。'));
      source.src=url;
    });
    if(!source.naturalWidth||!source.naturalHeight)throw new Error('圖片尺寸無效。');
  }catch(error){URL.revokeObjectURL(url);throw error;}
  return new Promise(resolve=>{
    let zoom=1,offsetX=0,offsetY=0,geometry=null,done=false,pinch=null;
    const pointers=new Map(),priorOverflow=document.body.style.overflow;
    const overlay=document.createElement('div');
    overlay.className='avatar-crop-overlay';
    overlay.innerHTML=`<section class="avatar-crop-dialog wide-crop-dialog" role="dialog" aria-modal="true" aria-label="裁切${preset.label}">
       <div class="avatar-crop-header"><h2>調整${preset.label}</h2><button type="button" class="avatar-crop-x" data-wide-action="cancel" aria-label="取消">✕</button></div>
       <p class="avatar-crop-help">拖曳圖片、用兩指或滑桿調整縮放。框內全部會保存，之後每個頁面都會完整顯示同一張圖。</p>
       <div class="wide-crop-preview" style="aspect-ratio:${preset.ratio}"><canvas class="avatar-crop-canvas wide-crop-canvas" tabindex="0" role="img" aria-label="可拖曳與縮放的橫幅預覽"></canvas></div>
       <div class="avatar-crop-slider-label"><label for="wide-crop-zoom">縮放</label><output class="avatar-crop-zoom-value">100%</output></div>
       <input id="wide-crop-zoom" class="avatar-crop-slider" type="range" min="1" max="4" step="0.01" value="1" aria-label="縮放">
       <div class="avatar-crop-buttons"><button type="button" class="avatar-crop-btn" data-wide-action="reset">重新置中</button><button type="button" class="avatar-crop-btn" data-wide-action="cancel">取消</button><button type="button" class="avatar-crop-btn avatar-crop-save" data-wide-action="save">確認使用</button></div>
       <p class="avatar-crop-status" role="status" aria-live="polite">取消不會變更原圖。確認後才會套用。</p>
      </section>`;
    document.body.appendChild(overlay);
    document.body.style.overflow='hidden';
    const canvas=overlay.querySelector('canvas'),slider=overlay.querySelector('.avatar-crop-slider');
    const readout=overlay.querySelector('.avatar-crop-zoom-value');
    const status=overlay.querySelector('.avatar-crop-status');
    function redraw(){
      const w=canvas.getBoundingClientRect().width,h=canvas.getBoundingClientRect().height;
      if(w<=0||h<=0)return;
      const dpr=Math.min(devicePixelRatio||1,3);
      const pw=Math.max(1,Math.round(w*dpr)),ph=Math.max(1,Math.round(h*dpr));
      if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
      const ctx=canvas.getContext('2d');if(!ctx)return;
      const scale=Math.max(w/source.naturalWidth,h/source.naturalHeight)*zoom;
      const dw=source.naturalWidth*scale,dh=source.naturalHeight*scale;
      offsetX=clamp(offsetX,-(dw-w)/2,(dw-w)/2);
      offsetY=clamp(offsetY,-(dh-h)/2,(dh-h)/2);
      const x=(w-dw)/2+offsetX,y=(h-dh)/2+offsetY;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(source,x,y,dw,dh);
      geometry={w,h,x,y,scale};
      readout.textContent=Math.round(zoom*100)+'%';
    }
    function toJpeg(){
      if(!geometry)throw new Error('裁切預覽尚未載入。');
      const {w,h,x,y,scale}=geometry;
      const sx=-x/scale,sy=-y/scale,sw=w/scale,sh=h/scale;
      for(const factor of [1,.85,.7,.55,.42]){
        const output=document.createElement('canvas');
        output.width=Math.max(1,Math.round(preset.width*factor));
        output.height=Math.max(1,Math.round(preset.height*factor));
        const ctx=output.getContext('2d');
        if(!ctx)throw new Error('瀏覽器不支援圖片裁切。');
        ctx.drawImage(source,sx,sy,sw,sh,0,0,output.width,output.height);
        for(const quality of [.82,.72,.62,.52,.42]){
          const data=output.toDataURL('image/jpeg',quality);
          if(data.startsWith('data:image/jpeg;base64,')&&data.length<=preset.limit)return data;
        }
      }
      throw new Error('圖片壓縮後仍過大，請嘗試另一張照片。');
    }
    function finish(result){
      if(done)return;
      done=true;
      window.removeEventListener('resize',redraw);
      window.removeEventListener('keydown',onKey);
      document.body.style.overflow=priorOverflow;
      overlay.remove();
      URL.revokeObjectURL(url);
      resolve(result);
    }
    function onKey(event){
      if(event.key==='Escape'){event.preventDefault();finish(null);}
      if(document.activeElement!==canvas)return;
      const dir={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]}[event.key];
      if(dir){event.preventDefault();offsetX+=dir[0];offsetY+=dir[1];redraw();}
    }
    canvas.addEventListener('pointerdown',event=>{
      event.preventDefault();canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2){
        const [a,b]=[...pointers.values()];
        pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom};
      }
    });
    canvas.addEventListener('pointermove',event=>{
      const prev=pointers.get(event.pointerId);if(!prev)return;
      event.preventDefault();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===1){offsetX+=event.clientX-prev.x;offsetY+=event.clientY-prev.y;}
      else if(pointers.size===2){
        const [a,b]=[...pointers.values()];
        if(!pinch)pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom};
        zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,1,4);
        slider.value=String(zoom);
      }
      redraw();
    });
    const endPointer=event=>{pointers.delete(event.pointerId);if(pointers.size<2)pinch=null;redraw();};
    canvas.addEventListener('pointerup',endPointer);
    canvas.addEventListener('pointercancel',endPointer);
    slider.addEventListener('input',()=>{zoom=Number(slider.value);redraw();});
    overlay.addEventListener('click',event=>{
      const action=event.target.closest('[data-wide-action]')?.dataset.wideAction;
      if(event.target===overlay||action==='cancel'){finish(null);return;}
      if(action==='reset'){zoom=1;offsetX=offsetY=0;slider.value='1';redraw();}
      if(action==='save'){try{finish(toJpeg());}catch(error){status.textContent=error.message;}}
    });
    window.addEventListener('resize',redraw);
    window.addEventListener('keydown',onKey);
    requestAnimationFrame(()=>{redraw();canvas.focus({preventScroll:true});});
  });
}
