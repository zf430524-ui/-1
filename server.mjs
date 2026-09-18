import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root=process.cwd();
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};

createServer(async(req,res)=>{
  try{
    const requested=decodeURIComponent((req.url||'/').split('?')[0]);
    const relative=requested==='/'?'index.html':requested.replace(/^\/+/, '');
    const safe=normalize(relative);
    if(safe.startsWith('..'))throw new Error('invalid path');
    const file=join(root,safe);
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`研学派团工作台 Demo: http://127.0.0.1:${port}`));
