'use client';
/* eslint-disable @next/next/no-img-element -- Menu images are bounded raster uploads served directly by our storage route. */
/* eslint-disable @next/next/no-html-link-for-pages -- Leaving a room needs a full navigation to remount the catalog controller. */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { similarRestaurants } from '@/lib/restaurant-match';
import { gameFetch } from '@/lib/game-client';
import { MAX_MENU_BYTES, MAX_MENU_IMAGES, MENU_TYPES, menuImageUrl } from '@/lib/restaurant-media';
import { formatMealDateTime } from '@/lib/meal-date';
import type { Catalog, Restaurant } from '@/lib/types';

function MenuPicture({id, alt}: {id:string;alt:string}) {
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  return failed ? <div className="menu-load-error" role="alert"><p>这张菜单暂时无法加载。</p><Button type="button" variant="outline" onClick={()=>{setFailed(false);setAttempt(value=>value+1);}}>重新加载</Button></div>
    : <img src={`${menuImageUrl(id)}&retry=${attempt}`} alt={alt} onError={()=>setFailed(true)}/>;
}
export type MenuMode='snapshot'|'latest';
type MenuRestaurant=Pick<Restaurant,'id'|'name'|'source'|'menu_images'|'media_updated_at'>;
export function MenuBrowser({restaurant,roomId,initialMode='snapshot',onAddMenu,onOrder}: {restaurant:MenuRestaurant;roomId?:string;initialMode?:MenuMode;onAddMenu?:()=>void;onOrder?:(mode:MenuMode)=>void}) {
  const [mode,setMode]=useState<MenuMode>(initialMode),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [latest,setLatest]=useState<Restaurant|null>(null),[loading,setLoading]=useState(initialMode==='latest'),[error,setError]=useState('');
  useEffect(()=>{
    if(mode!=='latest'||!roomId)return;
    let cancelled=false;const controller=new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A menu version change starts a scoped request, not a render loop.
    setLoading(true);setError('');setLatest(null);
    void gameFetch(`/api/game?room=${encodeURIComponent(roomId)}&menu=${encodeURIComponent(restaurant.id)}`,{signal:controller.signal}).then(async response=>{
      const value=await response.json() as {restaurant:Restaurant|null;message?:string;error?:string};
      if(!response.ok)throw new Error(value.error||'暂时无法读取最新菜单。');
      if(!cancelled){setLatest(value.restaurant);setError(value.message||'');}
    }).catch(e=>{if(!cancelled)setError((e as Error).message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[mode,roomId,restaurant.id,refresh]);
  const shown=mode==='latest'?latest:restaurant,images=shown?.menu_images||[],index=Math.min(page,Math.max(0,images.length-1));
  return <div className="menu-browser">
    {roomId&&<div className="menu-version-controls" role="group" aria-label="菜单版本"><Button type="button" variant="outline" aria-pressed={mode==='snapshot'} onClick={()=>{setMode('snapshot');setPage(0);}}>本轮原菜单</Button><Button type="button" variant="outline" aria-pressed={mode==='latest'} onClick={()=>{setMode('latest');setPage(0);setRefresh(n=>n+1);}}>查看最新菜单</Button></div>}
    {mode==='latest'&&shown&&<p className="menu-version-note">当前餐馆：{shown.name}{shown.media_updated_at?` · 更新于 ${formatMealDateTime(shown.media_updated_at)}（香槟时间）`:' · 暂无更新时间记录'}。本轮原菜单不受影响。</p>}
    {mode==='latest'&&loading?<p className="menu-loading" role="status"><Loader2 className="spin"/>正在读取最新菜单…</p>:mode==='latest'&&error?<p className="error" role="alert">{error}<Button type="button" variant="ghost" onClick={()=>setRefresh(n=>n+1)}>重新读取</Button></p>:images.length?<>
      <div className="menu-pager"><Button type="button" variant="outline" size="icon" aria-label="上一张菜单" disabled={index<=0} onClick={()=>setPage(index-1)}><ChevronLeft/></Button><span aria-live="polite">第 {index+1} / {images.length} 张</span><Button type="button" variant="outline" size="icon" aria-label="下一张菜单" disabled={index>=images.length-1} onClick={()=>setPage(index+1)}><ChevronRight/></Button><a href={menuImageUrl(images[index])} target="_blank" rel="noopener noreferrer">打开原图<ExternalLink size={15}/></a></div>
      <div className="menu-full-image"><MenuPicture key={images[index]} id={images[index]} alt={`${shown?.name||restaurant.name} 菜单第 ${index+1} 张`}/></div>
    </>:<div className="menu-empty-state"><BookOpen size={36} aria-hidden="true"/><strong>暂无菜单图片</strong><p>{roomId&&mode==='snapshot'?'可以切换「查看最新菜单」，查看饭局发起后补充的图片。':'群友可以在餐馆清单中补充菜单图片。'}</p>{onAddMenu?<Button type="button" className="primary" onClick={onAddMenu}><Upload size={18}/>添加菜单图片</Button>:<a className="menu-catalog-link" href="/#restaurants">前往餐馆清单</a>}</div>}
    {shown?.source&&<a className="menu-browser-website" href={shown.source} target="_blank" rel="noopener noreferrer">餐馆官网<ExternalLink size={16}/></a>}
    {onOrder&&<Button type="button" className="primary full menu-order-button" onClick={()=>onOrder(mode)}>帮我带一份</Button>}
  </div>;
}
export function RestaurantLinks({restaurant,onAddMenu,roomId,prominent=false,onOrder}: {restaurant:MenuRestaurant;onAddMenu?:()=>void;roomId?:string;prominent?:boolean;onOrder?:(mode:MenuMode)=>void}) {
  const [open,setOpen]=useState(false),images=restaurant.menu_images||[];
  return <div className={`restaurant-links ${prominent?'restaurant-links-prominent':''}`}>
    <Button type="button" variant="outline" className="menu-entry" aria-label={`查看 ${restaurant.name} 的菜单${images.length?`（${images.length} 张）`:'（暂无菜单）'}`} onClick={()=>setOpen(true)}><BookOpen size={17}/>查看菜单{images.length>0&&<span className="menu-image-count">{images.length}</span>}</Button>
    {!images.length&&<span className="menu-missing-label">{roomId?'可查最新菜单':'暂无菜单'}</span>}
    {restaurant.source&&<a href={restaurant.source} target="_blank" rel="noopener noreferrer" aria-label={`${restaurant.name} 官网`}><ExternalLink size={15}/>官网</a>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="menu-viewer"><DialogHeader><DialogTitle>{restaurant.name} · 菜单</DialogTitle><DialogDescription>由群友上传，菜品和价格以餐馆实际供应为准。</DialogDescription></DialogHeader>
      <MenuBrowser restaurant={restaurant} roomId={roomId} onAddMenu={onAddMenu?()=>{setOpen(false);onAddMenu();}:undefined} onOrder={onOrder?mode=>{setOpen(false);onOrder(mode);}:undefined}/>
    </DialogContent></Dialog>
  </div>;
}
type DraftImage = {key:string; url:string; id?:string; file?:File; status:'ready'|'uploading'|'error'; error?:string};
export function RestaurantEditor({item, restaurants, close, saved, focusMenu = false}: {item:Partial<Restaurant>; restaurants:Restaurant[]; close:()=>void; saved:(c:Catalog)=>void; focusMenu?:boolean}) {
  const [base,setBase]=useState(item),[conflict,setConflict]=useState<Restaurant|null>(null),[removed,setRemoved]=useState(false);
  const [choices,setChoices]=useState<Record<string,'mine'|'latest'>>({}),[extraMatches,setExtraMatches]=useState<Restaurant[]>([]),[duplicateOK,setDuplicateOK]=useState(false);
  const [name,setName] = useState(item.name || ''), [cuisine,setCuisine] = useState(item.cuisine || '');
  const [address,setAddress] = useState(item.address || ''), [source,setSource] = useState(item.source || '');
  const [images,setImages] = useState<DraftImage[]>((item.menu_images || []).map(id=>({key:id,id,url:menuImageUrl(id),status:'ready'})));
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const blobUrls = useRef(new Set<string>());
  const uploads = useRef(new Set<string>());
  const submitting = useRef(false);
  const uploading = images.some(image=>image.status==='uploading'), busy = uploading || saving;
  useEffect(()=>{const urls=blobUrls.current;return ()=>{for(const url of urls) URL.revokeObjectURL(url);};},[]);
  const matches=base.id?[]:similarRestaurants(name,[...restaurants,...extraMatches.filter(r=>!restaurants.some(existing=>existing.id===r.id))]);
  const fields=['name','cuisine','address','source','menu_images'] as const;
  const labels={name:'餐馆名称',cuisine:'类型',address:'地址',source:'官网',menu_images:'菜单图片'};
  const mine={name,cuisine,address,source,menu_images:images.map(i=>i.id)};
  const baseline=(key:typeof fields[number])=>base[key]??(key==='menu_images'?[]:'');
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const conflicts=conflict?fields.filter(key=>!same(mine[key],baseline(key))&&!same(conflict[key],baseline(key))&&!same(mine[key],conflict[key])):[];
  function loadRestaurant(r:Restaurant){setBase(r);setName(r.name);setCuisine(r.cuisine);setAddress(r.address);setSource(r.source);setImages(r.menu_images.map(id=>({key:id,id,url:menuImageUrl(id),status:'ready'})));setError('');setConflict(null);setRemoved(false);setChoices({});setDuplicateOK(false);}
  function resolveConflict(){
    if(!conflict)return;
    const merged=Object.fromEntries(fields.map(key=>[key,conflicts.includes(key)?choices[key]==='mine'?mine[key]:conflict[key]:same(mine[key],baseline(key))?conflict[key]:mine[key]]));
    setName(merged.name as string);setCuisine(merged.cuisine as string);setAddress(merged.address as string);setSource(merged.source as string);
    setImages((merged.menu_images as string[]).map(id=>images.find(i=>i.id===id)||{key:id,id,url:menuImageUrl(id),status:'ready'}));
    setBase(conflict);setConflict(null);setChoices({});setError('已合并最新资料，请核对后点击保存。');
  }
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
  return <Dialog open onOpenChange={open=>!open&&!busy&&close()}><DialogContent className="editor-dialog restaurant-editor"><DialogHeader><DialogTitle>{base.id?'修改餐馆':'添加一家餐馆'}</DialogTitle><DialogDescription>保存后，群友都能查看官网和菜单。已发起的饭局保留原来的餐馆资料。</DialogDescription></DialogHeader>
    <form onSubmit={async e=>{e.preventDefault();if(busy||conflict||removed||(!base.id&&matches.length&&!duplicateOK)||submitting.current||images.some(i=>i.status!=='ready'))return;submitting.current=true;setSaving(true);setError('');try{
      const response=await gameFetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveRestaurant',id:base.id,expectedRevision:base.revision,name,cuisine,address,source,menu_images:images.map(image=>image.id),duplicateIds:duplicateOK?matches.map(r=>r.id):[]})});
      const value=await response.json() as Catalog & {error?:string;code?:string;restaurant?:Restaurant|null};
      if(!response.ok){if(value.code==='RESTAURANT_CHANGED'){setConflict(value.restaurant||null);setRemoved(!value.restaurant);setChoices({});}if(value.code==='RESTAURANT_DUPLICATE'){setExtraMatches(value.restaurants);setDuplicateOK(false);}throw new Error(value.error || '保存失败，请重试。');}saved(value);close();
    }catch(e){setError((e as Error).message);}finally{submitting.current=false;setSaving(false);}}}>
      <label className="field">餐馆名称<Input autoFocus={!focusMenu} required maxLength={60} disabled={saving} value={name} onChange={e=>{setName(e.target.value);setDuplicateOK(false);}} placeholder="例如：Kung Fu BBQ（盒饭）"/></label>
      {!!matches.length&&<div className="restaurant-duplicates" role="status"><strong>已有相似餐馆</strong><p>同一家店可直接补充资料；不同分店请注明地址。</p>{matches.map(r=><div key={r.id}><span><b>{r.name}</b><small>{r.address||'未填写地址'}</small></span><Button type="button" variant="outline" disabled={busy} onClick={()=>loadRestaurant(r)}>编辑已有餐馆</Button></div>)}<Button type="button" variant="outline" disabled={busy||duplicateOK} onClick={()=>setDuplicateOK(true)}>{duplicateOK?'已确认是另一家餐馆 / 分店':'这是另一家餐馆 / 分店，继续添加'}</Button></div>}
      <label className="field">类型 <span>选填</span><Input maxLength={40} disabled={saving} value={cuisine} onChange={e=>setCuisine(e.target.value)} placeholder="例如：中餐 · 盒饭"/></label>
      <label className="field">地址 <span>选填</span><Input maxLength={160} disabled={saving} value={address} onChange={e=>{setAddress(e.target.value);setDuplicateOK(false);}} placeholder="方便大家找到同一家店"/></label>
      <label className="field">官网链接 <span>选填</span><Input type="url" inputMode="url" autoCapitalize="none" maxLength={2048} disabled={saving} value={source} onChange={e=>setSource(e.target.value)} placeholder="https://餐馆官网"/></label>
      <div className="menu-upload-section"><div className="menu-upload-heading"><span>菜单图片 <small>选填</small></span><span>{images.length} / {MAX_MENU_IMAGES} 张</span></div>
        <p id="menu-upload-help">支持 JPG、PNG、WebP，每张不超过 5 MB。按选择顺序展示，可上传菜单正反面。</p>
        {!!images.length&&<ol className="menu-upload-list">{images.map((image,i)=><li key={image.key}><img src={image.url} alt={`菜单预览第 ${i+1} 张`}/><div><strong>第 {i+1} 张</strong><span role="status">{image.status==='uploading'?<><Loader2 size={14} className="spin"/>上传中…</>:image.status==='ready'?'已就绪':'上传失败'}</span>{image.error&&<p className="menu-upload-error" role="alert">{image.error}</p>}<div className="menu-image-actions">{image.status==='error'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void upload(image)}>重试上传</Button>}<Button type="button" variant="ghost" disabled={busy} aria-label={`移除第 ${i+1} 张菜单`} onClick={()=>{setImages(previous=>previous.filter(entry=>entry.key!==image.key));if(blobUrls.current.delete(image.url))URL.revokeObjectURL(image.url);}}><Trash2 size={15}/>移除</Button></div></div></li>)}</ol>}
        <label className={`menu-file-picker ${busy||images.length>=MAX_MENU_IMAGES?'disabled':''}`}><Upload size={18}/>{uploading?'正在上传菜单…':'选择菜单图片'}<input autoFocus={focusMenu} type="file" multiple accept={MENU_TYPES.join(',')} aria-label="上传菜单图片" aria-describedby="menu-upload-help" disabled={busy||images.length>=MAX_MENU_IMAGES} onChange={e=>{
          const files=Array.from(e.target.files || []);e.target.value='';setError('');if(!files.length)return;
          if(images.length+files.length>MAX_MENU_IMAGES){setError(`每家餐馆最多 ${MAX_MENU_IMAGES} 张菜单，请减少选择。`);return;}
          if(files.some(file=>!MENU_TYPES.includes(file.type)||file.size>MAX_MENU_BYTES||!file.size)){setError('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片。');return;}
          const drafts:DraftImage[]=files.map(file=>{const url=URL.createObjectURL(file);blobUrls.current.add(url);return {key:crypto.randomUUID(),file,url,status:'uploading'};});
          setImages(previous=>[...previous,...drafts]);void(async()=>{for(const draft of drafts)await upload(draft);})();
        }}/></label>
      </div>
      {conflict&&<div className="restaurant-conflict" role="alert"><strong>餐馆已被更新</strong><p>你的填写仍在上方。以下是最新资料；同时修改过的项目，请选择要保留的内容。</p>{fields.map(key=><div className="conflict-field" key={key}><b>{labels[key]}</b>{key==='menu_images'?<div className="conflict-images">{conflict.menu_images.length?conflict.menu_images.map(id=><a key={id} href={menuImageUrl(id)} target="_blank" rel="noopener noreferrer"><img src={menuImageUrl(id)} alt="最新菜单"/></a>):'暂无图片'}</div>:<p>{conflict[key]||'未填写'}</p>}{conflicts.includes(key)&&<div role="group" aria-label={`${labels[key]}保留哪个版本`}><Button type="button" variant="outline" aria-pressed={choices[key]==='latest'} onClick={()=>setChoices(c=>({...c,[key]:'latest'}))}>采用最新</Button><Button type="button" variant="outline" aria-pressed={choices[key]==='mine'} onClick={()=>setChoices(c=>({...c,[key]:'mine'}))}>保留我的填写</Button></div>}</div>)}<Button type="button" className="secondary full" variant="outline" disabled={busy||conflicts.some(key=>!choices[key])} onClick={resolveConflict}>合并资料，继续核对</Button></div>}
      {error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||!!conflict||removed||(!base.id&&matches.length>0&&!duplicateOK)||images.some(image=>image.status!=='ready')}>{busy?<Loader2 className="spin"/>:<Check/>}{uploading?'等待图片上传完成':saving?'正在保存…':'保存餐馆'}</Button>
    </form>
  </DialogContent></Dialog>;
}
