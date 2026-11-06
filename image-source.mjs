/** Keep a compact, full-frame JPEG for future crop edits.
 * The source is private for avatar/profile/card and the owner's deck library.
 * Never overwrite this source when only adjusting the visible crop. */
export async function prepareImageSource(file,limit=145000){
  const stored=typeof file==='string';
  if(stored&&!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(file))throw new Error('已儲存的來源圖片無效。');
  if(!stored&&(!file||!file.type?.startsWith('image/')))throw new Error('請選擇圖片檔案。');
  if(!stored&&file.size>12*1024*1024)throw new Error('圖片超過 12 MB，請先縮小後上傳。');
  if(!Number.isInteger(limit)||limit<40000||limit>160000)throw new Error('圖片壓縮參數不正確。');
  const url=stored?file:URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error('圖片無法開啟，請改用 JPG 或 PNG。'));
      image.src=url;
    });
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('圖片尺寸無效。');
    for(const longEdge of [1400,1200,1000,850,700,560]){
      const ratio=Math.min(1,longEdge/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      const ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('瀏覽器無法壓縮圖片。');
      ctx.fillStyle='#101822';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.86,.78,.68,.58,.48,.38]){
        const data=canvas.toDataURL('image/jpeg',quality);
        if(data.startsWith('data:image/jpeg;base64,')&&data.length<=limit)return data;
      }
    }
    throw new Error('完整圖片壓縮後仍過大，請選擇另一張圖片。');
  }finally{
    if(!stored)URL.revokeObjectURL(url);
  }
}
