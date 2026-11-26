import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function buildCustomer({customerRoot,output,serviceUrl,publisherKey,previousSiteUrl,fetcher=fetch}) {
  const service=new URL(serviceUrl);
  if(!['https:','http:'].includes(service.protocol) || (service.protocol==='http:'&&!['127.0.0.1','localhost'].includes(service.hostname)) || service.username || service.password)throw new Error('菜单服务地址不合法');
  if(!publisherKey)throw new Error('缺少发布读取凭据');
  const headers={Authorization:'Bearer '+publisherKey};
  const response=await fetcher(new URL('/publisher/snapshot',service),{headers,redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error('无法读取待发布菜单');
  const snapshot=await response.json(), menu=snapshot.menu, images=snapshot.images;
  if(!menu || menu.storeId!=='wangdefu' || menu.formatVersion!==1 || !Number.isSafeInteger(menu.version) || menu.version<1 || !Number.isSafeInteger(menu.savedAt) || !Array.isArray(menu.items) || !menu.items.length || !Array.isArray(images))throw new Error('菜单不完整');
  const paths=new Set(), downloads=[];
  for(const asset of images){
    if(!asset || !/^[a-f0-9]{64}$/.test(asset.id) || !new RegExp('^images/'+asset.id+'\\.(jpg|png|webp)$').test(asset.file) || paths.has(asset.file))throw new Error('图片清单不正确');
    paths.add(asset.file);const image=await fetcher(new URL('/publisher/images/'+asset.id,service),{headers,redirect:'error',cache:'no-store'});
    if(!image.ok)throw new Error('图片未读到');const bytes=Buffer.from(await image.arrayBuffer());
    if(bytes.length>512000 || createHash('sha256').update(bytes).digest('hex')!==asset.id)throw new Error('图片内容与菜单不符');
    downloads.push({file:asset.file,bytes});
  }
  const ids=new Set();
  for(const item of menu.items){
    if(!item || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.name!=='string'||!item.name.trim()||item.category!=='meat'||item.active!==true||typeof item.price!=='number'||!Number.isFinite(item.price)||item.price<0||typeof item.grams!=='number'||!Number.isFinite(item.grams)||item.grams<=0||typeof item.image!=='string'||(item.image && !item.image.startsWith('emoji:')&&!paths.has(item.image)))throw new Error('菜单菜品不完整');
    ids.add(item.id);
  }
  if(menu.brandImage && !paths.has(menu.brandImage))throw new Error('店招图片不完整');
  if(previousSiteUrl){
    const previousUrl=new URL(previousSiteUrl);
    if(previousUrl.username || previousUrl.password || !(previousUrl.protocol==='https:' || previousUrl.protocol==='http:' && ['localhost','127.0.0.1'].includes(previousUrl.hostname)))throw new Error('顾客网址不合法');
    const previousResponse=await fetcher(previousUrl,{redirect:'error',cache:'no-store'});
    if(!previousResponse.ok)throw new Error('无法读取上次顾客网页');
    const previousHtml=await previousResponse.text();
    const match=previousHtml.match(/<script\s+id=["']bundledMenu["']\s+type=["']application\/json["']\s*>([\s\S]*?)<\/script>/i);
    if(match){
      const previous=JSON.parse(match[1]);
      const oldImages=(Array.isArray(previous.items)?previous.items.map(item=>item.image):[]).concat(previous.brandImage||'');
      for(const file of new Set(oldImages)){
        const parts=typeof file==='string' && file.match(/^images\/([a-f0-9]{64})\.(jpg|png|webp)$/);
        if(!parts || paths.has(file))continue;
        const response=await fetcher(new URL(file,previousUrl),{redirect:'error',cache:'no-store'});
        if(!response.ok)throw new Error('无法保留上次菜单图片');
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>512000 || createHash('sha256').update(bytes).digest('hex')!==parts[1])throw new Error('上次菜单图片不完整');
        paths.add(file);downloads.push({file,bytes});
      }
    }
  }
  let html=await readFile(path.join(customerRoot,'index.html'),'utf8');
  const tag=/<script id="bundledMenu" type="application\/json">[\s\S]*?<\/script>/g;
  if((html.match(tag)||[]).length!==1)throw new Error('无法找到唯一的网页菜单位置');
  const safeJson=JSON.stringify(menu).replace(/</g,'\\u003c');
  html=html.replace(tag,()=>'<script id="bundledMenu" type="application/json">'+safeJson+'</script>');
  try{await access(output);throw new Error('输出目录已经存在，请选择新的目录');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(path.join(output,'images'),{recursive:true});
  await writeFile(path.join(output,'index.html'),html);
  for(const file of ['customer.js','style.css','result-effects.js','boss-portraits.webp'])await copyFile(path.join(customerRoot,file),path.join(output,file));
  for(const asset of downloads)await writeFile(path.join(output,asset.file),asset.bytes);
  return {version:menu.version,images:downloads.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const result=await buildCustomer({customerRoot:process.env.CUSTOMER_ROOT||process.cwd(),output:path.resolve(process.env.OUTPUT_DIR||'dist'),serviceUrl:process.env.SERVICE_URL,publisherKey:process.env.PUBLISHER_KEY,previousSiteUrl:process.env.PREVIOUS_SITE_URL});console.log('已构建菜单版本',result.version);}
  catch(error){console.error('发布包生成失败：',error.message);process.exitCode=1;}
}
