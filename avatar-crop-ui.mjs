import {avatarCropGeometry,avatarSourceCrop} from './avatar-crop-core.mjs?v=1.8';

/** Interactive, non-destructive avatar selection. Only returns JPEG data after
 * explicit confirmation; the caller is responsible for saving it to Firebase.
 * Appending outside #app keeps the editor alive across Firestore re-renders. */
export async function chooseAvatarCrop(file){
  const stored=typeof file==='string';
  if(stored && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(file))throw new Error('已儲存的圖片格式無效。');
  if(!stored && (!file||!file.type.startsWith('image/')))throw new Error('請選擇圖片檔案。');
  if(!stored && file.size>12*1024*1024)throw new Error('圖片超過 12 MB，請先縮小後上傳。');
  const url=stored?file:URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error('圖片無法開啟，請改用 JPG 或 PNG。'));
      image.src=url;
    });
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('圖片尺寸無效。');
  }catch(err){if(!stored)URL.revokeObjectURL(url);throw err;}

  return await new Promise(resolve=>{
    let zoom=1,offsetX=0,offsetY=0,pinch=null,finished=false;
    const pointers=new Map();
    const previousOverflow=document.body.style.overflow;
    const overlay=document.createElement('div');
    overlay.className='avatar-crop-overlay';
    overlay.innerHTML=[
      '<section class="avatar-crop-dialog" role="dialog" aria-modal="true" aria-label="裁切個人頭像">',
      ' <div class="avatar-crop-header"><h2>調整個人頭像</h2><button class="avatar-crop-x" type="button" data-crop-action="cancel" aria-label="取消裁切">✕</button></div>',
      ' <p class="avatar-crop-help">拖曳照片調整位置，雙指縮放或移動下方滑桿；圓圈內就是最後的頭像。</p>',
      ' <div class="avatar-crop-preview"><canvas class="avatar-crop-canvas" width="320" height="320" role="img" tabindex="0" aria-label="可拖曳並縮放的圓形頭像預覽"></canvas></div>',
      ' <div class="avatar-crop-slider-label"><label for="avatar-crop-zoom">縮放</label><output class="avatar-crop-zoom-value" for="avatar-crop-zoom">100%</output></div>',
      ' <input id="avatar-crop-zoom" class="avatar-crop-slider" type="range" min="1" max="3" step="0.01" value="1" aria-label="縮放照片">',
      ' <div class="avatar-crop-buttons"><button class="avatar-crop-btn avatar-crop-reset" type="button" data-crop-action="reset">重新置中</button><button class="avatar-crop-btn avatar-crop-cancel" type="button" data-crop-action="cancel">取消</button><button class="avatar-crop-btn avatar-crop-save" type="button" data-crop-action="save">確認使用</button></div>',
      ' <p class="avatar-crop-status" role="status" aria-live="polite">取消不會修改原本的頭像；確認後才會上傳。</p>',
      '</section>'
    ].join('');
    document.body.appendChild(overlay);
    document.body.style.overflow='hidden';
    const canvas=overlay.querySelector('canvas');
    const slider=overlay.querySelector('.avatar-crop-slider');
    const value=overlay.querySelector('.avatar-crop-zoom-value');
    const status=overlay.querySelector('.avatar-crop-status');
    let geometry=null;
    function redraw(){
      const size=canvas.getBoundingClientRect().width;
      if(size<=0)return;
      const ratio=Math.min(window.devicePixelRatio||1,3),pixels=Math.round(size*ratio);
      if(canvas.width!==pixels||canvas.height!==pixels){canvas.width=pixels;canvas.height=pixels;}
      const ctx=canvas.getContext('2d');if(!ctx)return;
      ctx.setTransform(ratio,0,0,ratio,0,0);
      geometry=avatarCropGeometry(image.naturalWidth,image.naturalHeight,size,zoom,offsetX,offsetY);
      offsetX=geometry.offsetX;offsetY=geometry.offsetY;
      ctx.clearRect(0,0,size,size);
      ctx.fillStyle='#0b111d';ctx.fillRect(0,0,size,size);
      ctx.drawImage(image,geometry.x,geometry.y,geometry.width,geometry.height);
      ctx.fillStyle='rgba(5,9,18,.72)';
      ctx.beginPath();ctx.rect(0,0,size,size);
      ctx.moveTo(size/2+geometry.radius,size/2);
      ctx.arc(size/2,size/2,geometry.radius,0,2*Math.PI,true);
      ctx.fill('evenodd');
      ctx.beginPath();ctx.arc(size/2,size/2,geometry.radius,0,2*Math.PI);
      ctx.lineWidth=2.5;ctx.strokeStyle='#9af3d2';ctx.stroke();
      value.textContent=Math.round(zoom*100)+'%';
    }
    function exportJpeg(){
      if(!geometry)throw new Error('裁切預覽尚未載入。');
      const src=avatarSourceCrop(geometry);
      for(const size of [192,160,144,128]){
        const output=document.createElement('canvas');output.width=output.height=size;
        const ctx=output.getContext('2d');if(!ctx)throw new Error('瀏覽器不支援圖片裁切。');
        ctx.drawImage(image,src.x,src.y,src.size,src.size,0,0,size,size);
        for(const quality of [.78,.66,.55]){
          const encoded=output.toDataURL('image/jpeg',quality);
          if(encoded.length<=30000)return encoded;
        }
      }
      throw new Error('圖片壓縮後仍過大，請嘗試另一張照片。');
    }
    function finish(result){
      if(finished)return;
      finished=true;
      window.removeEventListener('resize',redraw);
      window.removeEventListener('keydown',onKeyDown);
      document.body.style.overflow=previousOverflow;
      overlay.remove();if(!stored)URL.revokeObjectURL(url);
      resolve(result);
    }
    function onKeyDown(ev){
      if(ev.key==='Escape'){ev.preventDefault();finish(null);return;}
      if(document.activeElement!==canvas)return;
      const deltas={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};
      if(deltas[ev.key]){ev.preventDefault();offsetX+=deltas[ev.key][0];offsetY+=deltas[ev.key][1];redraw();}
    }
    canvas.addEventListener('pointerdown',ev=>{
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
      if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom};}
    });
    canvas.addEventListener('pointermove',ev=>{
      const prior=pointers.get(ev.pointerId);if(!prior)return;
      ev.preventDefault();
      pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
      if(pointers.size===1){offsetX+=ev.clientX-prior.x;offsetY+=ev.clientY-prior.y;}
      else if(pointers.size===2){
        const [a,b]=[...pointers.values()];
        if(!pinch)pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom};
        zoom=Math.min(3,Math.max(1,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
        slider.value=String(zoom);
      }
      redraw();
    });
    function endPointer(ev){pointers.delete(ev.pointerId);if(pointers.size<2)pinch=null;redraw();}
    canvas.addEventListener('pointerup',endPointer);
    canvas.addEventListener('pointercancel',endPointer);
    slider.addEventListener('input',()=>{zoom=Number(slider.value);redraw();});
    overlay.addEventListener('click',ev=>{
      const action=ev.target.closest('[data-crop-action]')?.dataset.cropAction;
      if(ev.target===overlay||action==='cancel'){finish(null);return;}
      if(action==='reset'){zoom=1;offsetX=0;offsetY=0;slider.value='1';redraw();return;}
      if(action==='save'){try{finish(exportJpeg());}catch(err){status.textContent=err.message;}}
    });
    window.addEventListener('resize',redraw);
    window.addEventListener('keydown',onKeyDown);
    requestAnimationFrame(()=>{redraw();canvas.focus({preventScroll:true});});
  });
}
