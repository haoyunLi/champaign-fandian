// Keep identity initialization ordered even when multiple controls load together.
let viewKey='';
let restored=false;
let hasResponse=false;
let bootstrap:Promise<void>|undefined;
export function clearPendingMealDrafts() {
  let found=false;
  try {
    for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('fd_pending_')){found=true;sessionStorage.removeItem(key);}}
  }catch{}
  return found;
}
export async function gameFetch(input:string,init?:RequestInit):Promise<Response> {
  if(!restored){restored=true;try{viewKey=sessionStorage.getItem('fd_view_identity')||'';}catch{}}
  if(bootstrap)await bootstrap;
  let initialized:(()=>void)|undefined;
  if(!viewKey)bootstrap=new Promise(resolve=>{initialized=resolve;});
  const headers=new Headers(init?.headers);
  if(init?.method&&init.method!=='GET'&&viewKey)headers.set('X-Fandian-Identity',viewKey);
  try {
    const response=await fetch(input,{...init,headers,credentials:'same-origin'});
    const received=response.headers.get('X-Fandian-Identity');
    if(received){
      if(viewKey&&viewKey!==received){
        const hadDrafts=clearPendingMealDrafts();
        if(hasResponse||hadDrafts){
          // Avoid a reload loop when browser privacy settings reject cookies.
          let reload=false;
          try{reload=sessionStorage.getItem('fd_identity_reload')!=='1';sessionStorage.setItem('fd_identity_reload','1');sessionStorage.setItem('fd_view_identity',received);}catch{}
          if(reload)window.location.reload();
          throw new Error(reload?'登录身份已变化，正在重新载入页面。':'浏览器没有保留登录状态。请允许此网站保存 Cookie，再刷新页面或登录。');
        }
      } else {try{sessionStorage.removeItem('fd_identity_reload');}catch{}}
      hasResponse=true;viewKey=received;try{sessionStorage.setItem('fd_view_identity',received);}catch{}
    }
    return response;
  } finally {if(initialized){initialized();bootstrap=undefined;}}
}
