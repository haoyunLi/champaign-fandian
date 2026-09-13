'use client';
/* eslint-disable @next/next/no-img-element -- Menu images are bounded raster uploads served directly by our storage route. */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { gameFetch } from '@/lib/game-client';
import { MAX_MENU_BYTES, MAX_MENU_IMAGES, MENU_TYPES, menuImageUrl } from '@/lib/restaurant-media';
import type { Catalog, Restaurant } from '@/lib/types';

function MenuPicture({id, alt}: {id:string;alt:string}) {
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  return failed ? <div className="menu-load-error" role="alert"><p>这张菜单暂时无法加载。</p><Button type="button" variant="outline" onClick={()=>{setFailed(false);setAttempt(value=>value+1);}}>重新加载</Button></div>
    : <img src={`${menuImageUrl(id)}&retry=${attempt}`} alt={alt} onError={()=>setFailed(true)}/>;
}
export function RestaurantLinks({restaurant}: {restaurant: Pick<Restaurant,'name'|'source'|'menu_images'>}) {
  const [page, setPage] = useState<number | null>(null);
  const images = restaurant.menu_images || [];
  const index = Math.min(page ?? 0, images.length-1);
  if (!restaurant.source && !images.length) return null;
  return <div className="restaurant-links">
    {restaurant.source && <a href={restaurant.source} target="_blank" rel="noopener noreferrer" aria-label={`${restaurant.name} 官网`}><ExternalLink size={15}/>官网</a>}
    {!!images.length && <Button type="button" variant="ghost" aria-label={`查看 ${restaurant.name} 的菜单（${images.length} 张）`} onClick={()=>setPage(0)}><BookOpen size={16}/>菜单 · {images.length}</Button>}
    <Dialog open={page!==null && !!images.length} onOpenChange={open=>!open&&setPage(null)}><DialogContent className="menu-viewer"><DialogHeader><DialogTitle>{restaurant.name} · 菜单</DialogTitle><DialogDescription>由群友上传，菜品和价格以餐馆实际供应为准。</DialogDescription></DialogHeader>
      <div className="menu-pager"><Button type="button" variant="outline" size="icon" aria-label="上一张菜单" disabled={index<=0} onClick={()=>setPage(index-1)}><ChevronLeft/></Button><span aria-live="polite">第 {index+1} / {images.length} 张</span><Button type="button" variant="outline" size="icon" aria-label="下一张菜单" disabled={index>=images.length-1} onClick={()=>setPage(index+1)}><ChevronRight/></Button><a href={menuImageUrl(images[index] || '')} target="_blank" rel="noopener noreferrer">打开原图<ExternalLink size={15}/></a></div>
      <div className="menu-full-image"><MenuPicture key={images[index]} id={images[index] || ''} alt={`${restaurant.name} 菜单第 ${index+1} 张`}/></div>
    </DialogContent></Dialog>
  </div>;
}
type DraftImage = {key:string; url:string; id?:string; file?:File; status:'ready'|'uploading'|'error'; error?:string};
export function RestaurantEditor({item, close, saved}: {item:Partial<Restaurant>; close:()=>void; saved:(c:Catalog)=>void}) {
  const [name,setName] = useState(item.name || ''), [cuisine,setCuisine] = useState(item.cuisine || '');
  const [address,setAddress] = useState(item.address || ''), [source,setSource] = useState(item.source || '');
  const [images,setImages] = useState<DraftImage[]>((item.menu_images || []).map(id=>({key:id,id,url:menuImageUrl(id),status:'ready'})));
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const blobUrls = useRef(new Set<string>());
  const uploads = useRef(new Set<string>());
  const submitting = useRef(false);
  const uploading = images.some(image=>image.status==='uploading'), busy = uploading || saving;
  useEffect(()=>{const urls=blobUrls.current;return ()=>{for(const url of urls) URL.revokeObjectURL(url);};},[]);
  async function upload(draft: DraftImage) {
    if (!draft.file || uploads.current.has(draft.key)) return;
    uploads.current.add(draft.key);
    setImages(previous=>previous.map(image=>image.key===draft.key?{...image,status:'uploading',error:undefined}:image));
    try {
      const response=await gameFetch(`/api/menu-images?request=${draft.key}`,{method:'POST',headers:{'Content-Type':draft.file.type},body:draft.file});
      const value=await response.json() as {id:string;error?:string};
      if(!response.ok) throw new Error(value.error || '上传失败，请重试。');
      setImages(previous=>previous.map(image=>image.key===draft.key?{...image,id:value.id,status:'ready'}:image));
    } catch(e) {setImages(previous=>previous.map(image=>image.key===draft.key?{...image,status:'error',error:(e as Error).message}:image));}
    finally {uploads.current.delete(draft.key);}
  }
  return <Dialog open onOpenChange={open=>!open&&!busy&&close()}><DialogContent className="editor-dialog restaurant-editor"><DialogHeader><DialogTitle>{item.id?'修改餐馆':'添加一家餐馆'}</DialogTitle><DialogDescription>保存后，群友都能查看官网和菜单。已发起的饭局保留原来的餐馆资料。</DialogDescription></DialogHeader>
    <form onSubmit={async e=>{e.preventDefault();if(busy||submitting.current||images.some(i=>i.status!=='ready'))return;submitting.current=true;setSaving(true);setError('');try{
      const response=await gameFetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveRestaurant',id:item.id,name,cuisine,address,source,menu_images:images.map(image=>image.id)})});
      const value=await response.json() as Catalog & {error?:string};if(!response.ok)throw new Error(value.error || '保存失败，请重试。');saved(value);close();
    }catch(e){setError((e as Error).message);}finally{submitting.current=false;setSaving(false);}}}>
      <label className="field">餐馆名称<Input autoFocus required maxLength={60} disabled={saving} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：Kung Fu BBQ（盒饭）"/></label>
      <label className="field">类型 <span>选填</span><Input maxLength={40} disabled={saving} value={cuisine} onChange={e=>setCuisine(e.target.value)} placeholder="例如：中餐 · 盒饭"/></label>
      <label className="field">地址 <span>选填</span><Input maxLength={160} disabled={saving} value={address} onChange={e=>setAddress(e.target.value)} placeholder="方便大家找到同一家店"/></label>
      <label className="field">官网链接 <span>选填</span><Input type="url" inputMode="url" autoCapitalize="none" maxLength={2048} disabled={saving} value={source} onChange={e=>setSource(e.target.value)} placeholder="https://餐馆官网"/></label>
      <div className="menu-upload-section"><div className="menu-upload-heading"><span>菜单图片 <small>选填</small></span><span>{images.length} / {MAX_MENU_IMAGES} 张</span></div>
        <p id="menu-upload-help">支持 JPG、PNG、WebP，每张不超过 5 MB。按选择顺序展示，可上传菜单正反面。</p>
        {!!images.length&&<ol className="menu-upload-list">{images.map((image,i)=><li key={image.key}><img src={image.url} alt={`菜单预览第 ${i+1} 张`}/><div><strong>第 {i+1} 张</strong><span role="status">{image.status==='uploading'?<><Loader2 size={14} className="spin"/>上传中…</>:image.status==='ready'?'已就绪':'上传失败'}</span>{image.error&&<p className="menu-upload-error" role="alert">{image.error}</p>}<div className="menu-image-actions">{image.status==='error'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void upload(image)}>重试上传</Button>}<Button type="button" variant="ghost" disabled={busy} aria-label={`移除第 ${i+1} 张菜单`} onClick={()=>{setImages(previous=>previous.filter(entry=>entry.key!==image.key));if(blobUrls.current.delete(image.url))URL.revokeObjectURL(image.url);}}><Trash2 size={15}/>移除</Button></div></div></li>)}</ol>}
        <label className={`menu-file-picker ${busy||images.length>=MAX_MENU_IMAGES?'disabled':''}`}><Upload size={18}/>{uploading?'正在上传菜单…':'选择菜单图片'}<input type="file" multiple accept={MENU_TYPES.join(',')} aria-label="上传菜单图片" aria-describedby="menu-upload-help" disabled={busy||images.length>=MAX_MENU_IMAGES} onChange={e=>{
          const files=Array.from(e.target.files || []);e.target.value='';setError('');if(!files.length)return;
          if(images.length+files.length>MAX_MENU_IMAGES){setError(`每家餐馆最多 ${MAX_MENU_IMAGES} 张菜单，请减少选择。`);return;}
          if(files.some(file=>!MENU_TYPES.includes(file.type)||file.size>MAX_MENU_BYTES||!file.size)){setError('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片。');return;}
          const drafts:DraftImage[]=files.map(file=>{const url=URL.createObjectURL(file);blobUrls.current.add(url);return {key:crypto.randomUUID(),file,url,status:'uploading'};});
          setImages(previous=>[...previous,...drafts]);void(async()=>{for(const draft of drafts)await upload(draft);})();
        }}/></label>
      </div>
      {error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||images.some(image=>image.status!=='ready')}>{busy?<Loader2 className="spin"/>:<Check/>}{uploading?'等待图片上传完成':saving?'正在保存…':'保存餐馆'}</Button>
    </form>
  </DialogContent></Dialog>;
}
