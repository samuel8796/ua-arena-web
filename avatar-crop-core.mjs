/** Shared geometry for the interactive avatar cropper (CSS-pixel coordinates).
 * The square inscribed around the circular crop is always covered by the
 * source image, even while zoomed and dragged. All numbers are independent
 * of the phone's devicePixelRatio.
 */
export const AVATAR_CROP_CIRCLE_RATIO = 0.88;
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 3;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function avatarCropGeometry(imageWidth,imageHeight,viewSize,zoom=1,offsetX=0,offsetY=0){
  if(![imageWidth,imageHeight,viewSize].every(n=>Number.isFinite(n)&&n>0))throw new Error('無效的頭像尺寸');
  const radius=viewSize*AVATAR_CROP_CIRCLE_RATIO/2;
  const z=clamp(Number.isFinite(zoom)?zoom:1,AVATAR_MIN_ZOOM,AVATAR_MAX_ZOOM);
  const scale=Math.max(2*radius/imageWidth,2*radius/imageHeight)*z;
  const width=imageWidth*scale,height=imageHeight*scale;
  const maxX=Math.max(0,(width-2*radius)/2);
  const maxY=Math.max(0,(height-2*radius)/2);
  const dx=clamp(Number.isFinite(offsetX)?offsetX:0,-maxX,maxX);
  const dy=clamp(Number.isFinite(offsetY)?offsetY:0,-maxY,maxY);
  const x=(viewSize-width)/2+dx,y=(viewSize-height)/2+dy;
  return {viewSize,radius,zoom:z,scale,width,height,x,y,offsetX:dx,offsetY:dy};
}
export function avatarSourceCrop(geometry){
  const {viewSize,radius,scale,x,y}=geometry;
  return {x:(viewSize/2-radius-x)/scale,y:(viewSize/2-radius-y)/scale,size:2*radius/scale};
}
