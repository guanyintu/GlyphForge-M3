import { captureResources, resourceSession } from '../storage/resource-runtime';
self.onmessage=async({data}:MessageEvent<{id:string;page:number}>)=>{
  const watchdog=setTimeout(()=>{self.postMessage({type:"error",message:"动态预览超过10秒，请缩小定义或源范围"});self.close();},10000);
  try {
    if(!Number.isInteger(data.page)||data.page<0||data.page>166)throw new Error('页码超出10,000候选预算');
    const s=resourceSession(await captureResources([data.id]));const rows:string[]=[];let index=0,more=false;
    for await(const c of s.read(data.id,42)) {if(index++<data.page*60)continue;if(rows.length===60){more=true;break;}rows.push(c.text);}
    await s.check();self.postMessage({type:'done',rows,more});
  }catch(e){self.postMessage({type:'error',message:String(e)});}finally{clearTimeout(watchdog);}
};
