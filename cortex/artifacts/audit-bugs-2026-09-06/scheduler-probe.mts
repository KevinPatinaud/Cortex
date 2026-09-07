import { WorkflowScheduler } from '../../src/back/application/service/workflowScheduler/WorkflowScheduler.ts';
import { getNextCronOccurrence, cronMatchesDate } from '../../src/back/application/service/workflowScheduler/CronExpression.ts';
let stored:any = null;
const project:any = {
 getProjects: async()=>[{id:'project'}],
 getWorkflowScheduleConfiguration:async()=>stored,
 saveWorkflowScheduleConfiguration:async(_id:string,value:any)=>{stored=value;}
};
const agents:any={validateWorkflowParameterValues:async()=>({}),isProjectRunning:()=>false};
const s=new WorkflowScheduler(project,agents,()=>new Date('2026-09-06T10:00:00Z'));
const started=performance.now();
try{await s.saveSchedule('project',{cron:'0 0 31 2 *',enabled:true});}catch(e){console.log('IMPOSSIBLE_CRON',JSON.stringify({error:(e as Error).message,stored,elapsedMs:Math.round(performance.now()-started)}));}
try{await s.getSchedule('project');}catch(e){console.log('GET_PERSISTED_SCHEDULE_ERROR',(e as Error).message);}
process.env.TZ='Europe/Paris';
const after=new Date('2026-10-25T00:45:00Z');
const upcoming=new Date('2026-10-25T01:30:00Z');
console.log('DST',JSON.stringify({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,after:after.toString(),next:getNextCronOccurrence('30 2 * * *',after).toISOString(),earlierMatchingOccurrence:upcoming.toISOString(),matches:cronMatchesDate('30 2 * * *',upcoming)}));

