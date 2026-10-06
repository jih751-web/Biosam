import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=resolve(root,'.'+(path==='/'?'/index.html':path));if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}const file=await readFile(target);res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-cache'}).end(file);}catch{res.writeHead(404).end('Not found');}}).listen(4310,'127.0.0.1',()=>console.log('BioSEM preview: http://127.0.0.1:4310'));
