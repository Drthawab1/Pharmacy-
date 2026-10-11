const C="pharm-v1";
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener("fetch",e=>{
  const r=e.request; if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.hostname.endsWith("googleapis.com")&&!u.pathname.includes("firebasejs"))return;
  e.respondWith(fetch(r).then(res=>{if(res.ok&&(u.origin===location.origin||u.hostname==="www.gstatic.com"||u.hostname==="cdn.jsdelivr.net")){const c=res.clone();caches.open(C).then(x=>x.put(r,c));}return res;}).catch(()=>caches.match(r)));
});
