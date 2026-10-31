/** Opt-in audit timings. Nested dynamic/read phases are inclusive, not additive. */
export interface ExecutionMetrics { [phase:string]: {ms:number;calls:number} }
export function measure<T>(metrics:ExecutionMetrics|undefined,phase:string,fn:()=>T):T {
  if(!metrics)return fn();
  const start=performance.now();try{return fn();}finally{record(metrics,phase,performance.now()-start);}
}
export function record(metrics:ExecutionMetrics|undefined,phase:string,ms:number) {
  if(metrics){const p=metrics[phase]??={ms:0,calls:0};p.ms+=ms;p.calls++;}
}
