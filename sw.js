/* Training log offline worker.
   Keeps the app, its manifest and any music you have played on the phone, so the app
   opens and runs with no signal. With signal, the page is fetched fresh (waiting 3
   seconds at most), so a new build still arrives. GitHub sync is never touched here:
   it goes to the network, and the app retries it when signal returns. */
const V='2026.09.26.8', APP='tl-app-'+V, MUSIC='tl-music';
const CORE=['./','index.html','manifest.webmanifest'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(APP).then(c=>Promise.all(CORE.map(u=>
    c.add(new Request(u,{cache:'reload'})).catch(()=>{})))));        // a missing file never blocks install
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('tl-app-') && k!==APP).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const r=e.request, u=new URL(r.url);
  if(r.method!=='GET' || u.origin!==location.origin) return;         // GitHub and anything else: straight through
  if(u.pathname.includes('/music/') && !u.pathname.endsWith('.json')) return e.respondWith(music(r));
  e.respondWith(fresh(e,r));
});

/* Network first, the copy kept here if there is no answer within 3 seconds. */
async function fresh(e,r){
  const c=await caches.open(APP), page=r.mode==='navigate';
  const net=fetch(page?r.url:r,page?{cache:'no-store',credentials:'same-origin'}:{cache:'no-store'})
    .then(res=>{ if(res.ok) return c.put(r.url,res.clone()).then(()=>res); return res; });
  e.waitUntil(net.catch(()=>{}));
  const kept=await c.match(r,{ignoreSearch:true}) || (page ? (await c.match('index.html') || await c.match('./')) : null);
  if(!kept) return net.catch(()=>Response.error());
  const late=new Promise(res=>setTimeout(()=>res(null),3000));
  const got=await Promise.race([net.catch(()=>null),late]);
  return got && got.ok ? got : kept;
}

/* Music: the whole file is kept the first time a track plays. Safari asks for audio in
   byte ranges, so ranges are answered from the kept file. */
async function music(r){
  const c=await caches.open(MUSIC), key=r.url.split('#')[0];
  let full=await c.match(key);
  if(!full){
    try{
      const res=await fetch(key);
      if(res.status!==200) return res;
      await c.put(key,res.clone());
      full=res;
    }catch(err){ return Response.error(); }
  }
  const range=r.headers.get('range');
  if(!range) return full;
  const buf=await full.clone().arrayBuffer(), size=buf.byteLength;
  const m=/bytes=(\d*)-(\d*)/.exec(range)||[];
  let a=m[1]===''||m[1]===undefined?NaN:+m[1], b=m[2]===''||m[2]===undefined?NaN:+m[2];
  if(isNaN(a)){ a=Math.max(0,size-(isNaN(b)?size:b)); b=size-1; }       // bytes=-500: the last 500
  if(isNaN(b) || b>=size) b=size-1;
  if(a>=size) return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
  return new Response(buf.slice(a,b+1),{status:206,headers:{
    'Content-Type':full.headers.get('Content-Type')||'audio/mpeg',
    'Content-Range':'bytes '+a+'-'+b+'/'+size,'Content-Length':String(b-a+1),'Accept-Ranges':'bytes'}});
}
