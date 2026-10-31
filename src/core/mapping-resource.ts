import type { Params, Candidate } from './model';
import type { ResourceMetadataReader } from './contracts';
import { ContractError, uniqueParts } from './contracts';
import { parseCharacterMap } from './chinese-definitions';
export async function resolveMapping(params:Params,metadata?:ResourceMetadataReader) {
  if(!params.mappingId)return {params};
  const r=await metadata?.(String(params.mappingId));
  if(r?.kind!=='mapping' || r.definition?.type!=='mapping' || !r.version)throw new ContractError({code:'RESOURCE',message:`Mapping ${params.mappingId} 缺失或类型无效`});
  parseCharacterMap(r.definition.rules);
  return {params:{...params,mapping:r.definition.rules},resource:r};
}
export function mappingSource(item:Candidate,id:string,version:number,text:string):Candidate {
  return {...item,parts:uniqueParts([...item.parts,{resourceId:id,version,text}])};
}
