const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {syncPack}=require(require('path').join(__dirname,'../tools/pack-sync.js'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-'));
fs.writeFileSync(dir+'/pack.json',JSON.stringify({id:'t',name:'T',baseUrl:'https://x.test/t',minecraft:'1.20.1',loader:{type:'forge',version:'47.3.0'},sources:{}}));
fs.writeFileSync(dir+'/mods.txt','# hola\ncreate\nnoexiste\njei@1.0\n');
fs.mkdirSync(dir+'/files/mods',{recursive:true});
fs.writeFileSync(dir+'/files/mods/manual.jar','manual');
const jar={create:Buffer.from('CREATE'),flywheel:Buffer.from('FLY'),jei:Buffer.from('JEI')};
const h=b=>crypto.createHash('sha512').update(b).digest('hex');
const ver=(pid,name,deps=[],vn='1.0')=>[{project_id:pid,version_number:vn,version_type:'release',date_published:'2026-01-01',dependencies:deps,files:[{primary:true,filename:name+'.jar',url:'https://cdn.test/'+name+'.jar',hashes:{sha512:h(jar[name])}}]}];
const http={json:async u=>{
 if(u.includes('/project/create/'))return ver('P1','create',[{dependency_type:'required',project_id:'P2'}]);
 if(u.includes('/project/P2/'))return ver('P2','flywheel');
 if(u.includes('/project/jei/'))return ver('P3','jei');
 if(u.includes('/project/noexiste/'))return null;
 throw new Error('unexpected '+u)},
 bytes:async u=>jar[path.basename(u,'.jar')]};
(async()=>{
 const logs=[];
 const r=await syncPack(dir,{http,log:l=>logs.push(l)});
 const m=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
 assert.deepStrictEqual(m.files.map(f=>f.path).sort(),['mods/create.jar','mods/flywheel.jar','mods/jei.jar','mods/manual.jar']);
 assert(m.files.find(f=>f.path==='mods/create.jar').url==='https://cdn.test/create.jar');
 assert(m.files.find(f=>f.path==='mods/manual.jar').url.startsWith('https://x.test/t/files/'));
 assert(r.missing.some(x=>x.slug==='noexiste'));
 // quitar jei -> se borra, manual se mantiene
 fs.writeFileSync(dir+'/mods.txt','create\n');
 await syncPack(dir,{http,log:()=>{}});
 assert(!fs.existsSync(dir+'/files/mods/jei.jar')); assert(fs.existsSync(dir+'/files/mods/manual.jar'));
 
 console.log('OK pack-sync');
})().catch(e=>{console.error(e);process.exit(1)});
