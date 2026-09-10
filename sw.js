// 离线缓存：让 App 在 iPhone 主屏打开时无需联网也可使用
const CACHE='profit-v9';
// index.html 排第一：就算后面的文件缓存失败，也要保证离线能打开主程序
const FILES=['index.html','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(async c=>{
    // 逐个缓存并容错：addAll 只要有一个文件 404 就会整体失败，导致完全无法离线
    for(const f of FILES){
      try{ await c.add(new Request(f,{cache:'reload'})); }catch(err){}
    }
  }).catch(()=>{}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  const isNav = e.request.mode==='navigate' || url.pathname.endsWith('.html');
  if(isNav){
    // 导航/HTML 请求：网络优先，成功则更新缓存；离线时回退缓存
    e.respondWith(fetch(e.request).then(resp=>{
      const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); return resp;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));
    return;
  }
  // 其它静态资源：缓存优先
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); return resp;
  }).catch(()=>caches.match('index.html'))));
});
