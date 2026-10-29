import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
const queue = async (request: APIRequestContext) => (await (await request.get("/api/execution-queue")).json());
const force = async (request: APIRequestContext) => (await (await request.get("/api/work-force")).json());
const telemetry = async (request: APIRequestContext) => (await (await request.post("/__test/global-executions",{data:{}})).json());
const allStarts = async (request: APIRequestContext) => (await telemetry(request)).events.filter((event:any)=>event.event==="start");
const starts = async (request: APIRequestContext) => (await allStarts(request)).filter((event:any)=>event.phase!=="interpretation");
let projects: string[] = [], pending: Promise<unknown>[] = [];
async function createAgent(request:APIRequestContext, marker:string, slow=true) {
  const name=`Concurrency-${randomUUID().slice(0,8)}`;
  const created=await request.post("/api/projects/create",{data:{name,engine:"codex",generationMode:"empty",instructions:"Exécuter uniquement la mission demandée."}});
  expect(created.status()).toBe(201); const {project}=await created.json(); projects.push(project.id);
  const saved=await request.put(`/api/agents/projects/${project.id}`,{data:{name,engine:"codex",instructions:"Exécuter uniquement la mission demandée.",agents:[{name:marker,description:"Agent de vérification",prompt:`${marker} ${slow ? "E2E_SLOW" : "E2E_WORK_FORCE_SLOW"} Produire le résultat demandé.`}]}});
  expect(saved.ok()).toBe(true); const content=await saved.json();
  return {projectId:project.id,agentId:content.agents[0].id,marker};
}
function runAgent(request:APIRequestContext,agent:{projectId:string;agentId:string}) {
  const task=request.post(`/api/agents/projects/${agent.projectId}/agents/run`,{data:{agentId:agent.agentId}});
  pending.push(task); return task;
}
async function enqueueIndependent(request:APIRequestContext,marker:string,slow=false) {
  if ((await request.get("/api/prompt-queue")).ok()) {
    const chat=await (await request.post("/api/prompt-queue/chats",{data:{title:"Prompt global"}})).json();
    const result=await request.post(`/api/prompt-queue/chats/${chat.id}/prompts`,{data:{content:`QUEUE_E2E ${marker} ${slow?"SLOW":""}`}}); expect(result.status()).toBe(201);
    return {source:"prompt",wait:async()=>{await expect.poll(async()=>(await (await request.get(`/api/prompt-queue/chats/${chat.id}`)).json()).prompts[0].status,{timeout:10000}).toBe("completed");}};
  }
  const agent=await createAgent(request,marker,false),job=runAgent(request,agent);
  return {source:"normal",wait:async()=>{expect((await job).ok()).toBe(true);}};
}
async function startForce(request:APIRequestContext,agent:{projectId:string;agentId:string},dates={}) {
  expect((await request.put("/api/work-force/configuration",{data:{agents:[{projectId:agent.projectId,agentId:agent.agentId}],startsAt:null,endsAt:null,...dates}})).ok()).toBe(true);
  expect((await request.post("/api/work-force/start",{data:{}})).status()).toBe(202);
}
async function openSettings(page:Page,projectId:string) {
  await page.goto(`/?project=${projectId}`);
  const trigger=page.locator(".agent-engine-settings-trigger");
  if (!await trigger.isVisible()) await page.getByRole("button",{name:"Afficher la liste des projets",exact:true}).click();
  await trigger.click(); return page.locator(".execution-concurrency-panel");
}
test.beforeEach(async({request})=>{
  projects=[]; pending=[];
  await request.post("/api/work-light/stop",{data:{}});
  await request.post("/api/work-force/stop",{data:{}});
  await expect.poll(async()=>(await force(request)).runtime.active).toBeNull();
  await request.post("/__test/work-force-clock",{data:{at:null}});
  await request.put("/api/work-force/configuration",{data:{agents:[],startsAt:null,endsAt:null}});
  await request.put("/api/execution-queue/settings",{data:{allowParallelExecutions:false}});
  await request.put("/api/agents/codex-quota",{data:{enabled:false,minimumFiveHourRemainingPercent:50,minimumWeeklyRemainingPercent:10}});
  await request.post("/__test/codex-quota",{data:{fiveHourUsed:0,weeklyUsed:0}});
  await request.post("/__test/global-executions",{data:{reset:true}});
});
test.afterEach(async({request})=>{
  await request.post("/api/work-light/stop",{data:{}});
  await request.post("/api/work-force/stop",{data:{}});
  for(const id of projects) await request.post(`/api/agents/projects/${id}/workflow/cancel`,{data:{}});
  const chats=await (await request.get("/api/prompt-queue")).json();
  for(const chat of chats.chats ?? []) {
    await request.put(`/api/prompt-queue/chats/${chat.id}/pause`,{data:{paused:true}});
    const detail=await (await request.get(`/api/prompt-queue/chats/${chat.id}`)).json();
    for(const prompt of detail.prompts) if(["queued","running"].includes(prompt.status)) await request.post(`/api/prompt-queue/chats/${chat.id}/prompts/${prompt.id}/cancel`,{data:{}});
  }
  await request.put("/api/execution-queue/settings",{data:{allowParallelExecutions:true}});
  await Promise.allSettled(pending);
  await expect.poll(async()=>(await queue(request)).active.length).toBe(0);
  await expect.poll(async()=>(await queue(request)).waiting.length).toBe(0);
  await request.post("/__test/work-force-clock",{data:{at:null}});
});

test("normal agents, Work Force and prompts use the same FIFO when parallelism is disabled",async({page,request},info)=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_NORMAL_A"),b=await createAgent(request,"GLOBAL_QUEUE_WORK_FORCE_B",false);
  const first=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  await startForce(request,b); await expect.poll(async()=>(await force(request)).runtime.phase).toBe("queued");
  const third=await enqueueIndependent(request,"GLOBAL_QUEUE_PROMPT_C",true);
  await expect.poll(async()=>(await queue(request)).waiting.map((entry:any)=>entry.source)).toEqual(["work-force",third.source]);
  const panel=await openSettings(page,a.projectId); await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(panel.getByRole("status")).toContainText("Dans la file globale : 2");
  expect((await new AxeBuilder({page}).include(".execution-concurrency-panel").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath("shared-queue.png"),fullPage:true});
  expect((await first).ok()).toBe(true);
  await expect.poll(async()=>(await force(request)).runtime.phase).toBe("running"); await request.post("/api/work-force/stop",{data:{}});
  await third.wait();
  expect((await starts(request)).map((entry:any)=>entry.marker)).toEqual([a.marker,b.marker,"GLOBAL_QUEUE_PROMPT_C"]);
  expect((await telemetry(request)).maximum).toBe(1);
  await page.reload(); const reopened=page.locator(".agent-engine-settings-trigger"); if(!await reopened.isVisible()) await page.getByRole("button",{name:"Afficher la liste des projets",exact:true}).click(); await reopened.click();
  await expect(page.getByRole("checkbox",{name:"Autoriser les exécutions simultanées",exact:true})).not.toBeChecked();
});

test("enabling parallelism releases different agents; disabling lets active runs finish before the next",async({page,request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_LONG_A"),b=await createAgent(request,"GLOBAL_QUEUE_PARALLEL_B",false),c=await createAgent(request,"GLOBAL_QUEUE_AFTER_C",false);
  const first=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  const second=runAgent(request,b); await expect.poll(async()=>(await queue(request)).waiting.length).toBe(1);
  const panel=await openSettings(page,a.projectId); await panel.getByRole("checkbox").check();
  await expect.poll(async()=>(await telemetry(request)).maximum).toBe(2);
  await panel.getByRole("checkbox").uncheck();
  await expect.poll(async()=>(await queue(request)).settings.allowParallelExecutions).toBe(false);
  const third=runAgent(request,c);
  await expect.poll(async()=>(await queue(request)).waiting.some((entry:any)=>entry.label===c.marker)).toBe(true);
  expect((await second).ok()).toBe(true); expect((await starts(request)).some((entry:any)=>entry.marker===c.marker)).toBe(false);
  expect((await first).ok()).toBe(true); expect((await third).ok()).toBe(true);
});

test("Work Force rechecks quotas after waiting while normal agents keep their independent quota rule",async({request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_QUOTA_A"),b=await createAgent(request,"GLOBAL_QUEUE_QUOTA_B",false),c=await createAgent(request,"GLOBAL_QUEUE_QUOTA_C",false);
  const first=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  await startForce(request,b); await expect.poll(async()=>(await force(request)).runtime.phase).toBe("queued");
  const next=runAgent(request,c); await request.post("/__test/codex-quota",{data:{fiveHourUsed:99,weeklyUsed:99}});
  expect((await first).ok()).toBe(true); await expect.poll(async()=>(await force(request)).runtime.phase).toBe("waiting_quota");
  expect((await next).ok()).toBe(true); expect((await starts(request)).map((entry:any)=>entry.marker)).toEqual([a.marker,c.marker]);
  expect((await force(request)).runtime.cursor).toBe(0);
});

test("the planned end withdraws a queued Work Force agent before it can run",async({request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_END_A"),b=await createAgent(request,"GLOBAL_QUEUE_END_B",false);
  const first=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  const now=Date.now(),end=new Date(now+120000).toISOString();
  await request.post("/__test/work-force-clock",{data:{at:new Date(now).toISOString()}}); await startForce(request,b,{endsAt:end});
  await expect.poll(async()=>(await force(request)).runtime.phase).toBe("queued");
  await request.post("/__test/work-force-clock",{data:{at:end}});
  await expect.poll(async()=>(await force(request)).runtime.phase).toBe("stopped");
  await expect.poll(async()=>(await queue(request)).waiting.length).toBe(0);
  expect((await starts(request)).map((entry:any)=>entry.marker)).toEqual([a.marker]);
  await request.post(`/api/agents/projects/${a.projectId}/workflow/cancel`,{data:{}}); await first;
});

test("a complete agent retains the slot through mission and interpretation",async({request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_TWO_PASS_A E2E_TWO_PASS",false);
  const first=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  const next=await enqueueIndependent(request,"GLOBAL_QUEUE_AFTER_INTERPRETATION");
  expect((await first).ok()).toBe(true); await expect.poll(async()=>(await allStarts(request)).length>=3).toBe(true);
  expect((await allStarts(request)).slice(0,3).map((entry:any)=>[entry.marker,entry.phase])).toEqual([["GLOBAL_QUEUE_TWO_PASS_A","mission"],["GLOBAL_QUEUE_TWO_PASS_A","interpretation"],["GLOBAL_QUEUE_AFTER_INTERPRETATION","mission"]]);
  await next.wait();
  expect((await telemetry(request)).maximum).toBe(1);
});

test("a normal scheduled workflow queues during Work Force and runs its claimed occurrence after the current agent",async({request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_SCHEDULE_A",false);
  const content=await (await request.get(`/api/agents/projects/${a.projectId}`)).json();
  const name=content.directoryPath.split(/[\\/]/).at(-1);
  const saved=await request.put(`/api/agents/projects/${a.projectId}`,{data:{name,engine:"codex",instructions:"Exécuter les étapes dans l’ordre.",agents:[
    {id:a.agentId,name:a.marker,description:"Étape normale",prompt:`${a.marker} E2E_WORK_FORCE_SLOW Produire le résultat.`},
    {name:"GLOBAL_QUEUE_SCHEDULE_B",description:"Autre agent du projet",prompt:"GLOBAL_QUEUE_SCHEDULE_B E2E_WORK_FORCE_SLOW Produire le résultat."}
  ]}});
  expect(saved.ok()).toBe(true); const agents=(await saved.json()).agents;
  const b={projectId:a.projectId,agentId:agents.find((agent:any)=>agent.name==="GLOBAL_QUEUE_SCHEDULE_B").id};
  await request.post("/__test/global-executions",{data:{reset:true}});
  await startForce(request,b); await expect.poll(async()=>(await force(request)).runtime.phase).toBe("running");
  const schedule=`/api/agents/projects/${a.projectId}/workflow/schedule`;
  expect((await request.put(schedule,{data:{cron:"* * * * *",enabled:true,timezone:"UTC",parameterValues:{}}})).ok()).toBe(true);
  await request.post("/__test/scheduled-scan",{data:{at:"2027-01-04T10:20:00Z"}});
  await expect.poll(async()=>(await (await request.get(schedule)).json()).lastRunStatus).toBe("queued");
  expect((await queue(request)).waiting.some((entry:any)=>entry.source==="normal")).toBe(true);
  await request.post("/api/work-force/stop",{data:{}});
  await expect.poll(async()=>(await force(request)).runtime.active).toBeNull();
  await request.post("/__test/scheduled-scan",{data:{at:"2027-01-04T10:20:00Z"}});
  await expect.poll(async()=>(await (await request.get(schedule)).json()).lastRunStatus,{timeout:10000}).toBe("succeeded");
  expect((await telemetry(request)).maximum).toBe(1);
  expect((await starts(request)).map((entry:any)=>entry.marker)).toEqual(["GLOBAL_QUEUE_SCHEDULE_B",a.marker,"GLOBAL_QUEUE_SCHEDULE_B"]);
  await request.put(schedule,{data:{cron:"* * * * *",enabled:false,timezone:"UTC",parameterValues:{}}});
});

for (const parallel of [false, true]) test(`active Work Force stays red while normal cron and manual agents keep running (parallel=${parallel})`, async ({page,request},info) => {
  const selected=await createAgent(request,"GLOBAL_QUEUE_PRIORITY_SELECTED",false),normal=await createAgent(request,"GLOBAL_QUEUE_PRIORITY_NORMAL",false);
  await request.put("/api/execution-queue/settings",{data:{allowParallelExecutions:parallel}});
  // Normal quota protection is disabled; Work Force still requires its own reserves.
  await request.post("/__test/codex-quota",{data:{fiveHourUsed:70,weeklyUsed:97}});
  await startForce(request,selected);
  await expect.poll(async()=>(await force(request)).runtime.phase).toBe("waiting_quota");
  expect((await (await request.get("/api/work-force/status")).json()).active).toBe(true);
  const manual=await runAgent(request,normal); expect(manual.ok()).toBe(true);
  const schedule=`/api/agents/projects/${normal.projectId}/workflow/schedule`;
  expect((await request.put(schedule,{data:{cron:"* * * * *",enabled:true,timezone:"UTC",parameterValues:{}}})).ok()).toBe(true);
  await request.post("/__test/scheduled-scan",{data:{at:"2027-01-04T12:00:00Z"}});
  await expect.poll(async()=>(await (await request.get(schedule)).json()).lastRunStatus).toBe("succeeded");
  expect((await starts(request)).length).toBe(2);
  await page.goto(`/?project=${normal.projectId}`);
  let button=page.getByRole("button",{name:"Work Force",exact:true});
  if(!await button.isVisible())await page.getByRole("button",{name:"Afficher la liste des projets",exact:true}).click();
  await expect(button).toHaveAttribute("aria-pressed","true");
  await expect(button).toHaveCSS("background-color","rgb(180, 35, 50)");
  expect((await new AxeBuilder({page}).include(".project-sidebar__header").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath("work-force-active-red.png"),fullPage:true});
  await request.post("/api/work-force/stop",{data:{}});
  await expect(button).toHaveAttribute("aria-pressed","false");
  await request.post("/__test/scheduled-scan",{data:{at:"2027-01-04T12:00:00Z"}});
  expect((await starts(request)).map((event:any)=>event.marker)).toEqual([normal.marker,normal.marker]);
  await request.put(schedule,{data:{cron:"* * * * *",enabled:false,timezone:"UTC",parameterValues:{}}});
});

test("an already running normal agent can finish in parallel, and cancelling it does not stop Work Force",async({request})=>{
  const a=await createAgent(request,"GLOBAL_QUEUE_SHARED_A");
  const original=await (await request.get(`/api/agents/projects/${a.projectId}`)).json();
  const name=original.directoryPath.split(/[\\/]/).at(-1);
  const saved=await request.put(`/api/agents/projects/${a.projectId}`,{data:{name,engine:"codex",instructions:"Exécuter la mission de chaque agent.",agents:[
    {id:a.agentId,name:a.marker,description:"Agent normal",prompt:`${a.marker} E2E_SLOW Produire le résultat.`},
    {name:"GLOBAL_QUEUE_SHARED_B",description:"Agent Work Force",prompt:"GLOBAL_QUEUE_SHARED_B E2E_WORK_FORCE_SLOW Produire le résultat."}
  ]}});
  expect(saved.ok()).toBe(true); const b={projectId:a.projectId,agentId:(await saved.json()).agents.find((agent:any)=>agent.name==="GLOBAL_QUEUE_SHARED_B").id};
  await request.put("/api/execution-queue/settings",{data:{allowParallelExecutions:true}});
  await request.post("/__test/global-executions",{data:{reset:true}});
  const normal=runAgent(request,a); await expect.poll(async()=>(await starts(request)).length).toBe(1);
  await startForce(request,b); await expect.poll(async()=>(await force(request)).runtime.phase).toBe("running");
  await expect.poll(async()=>(await telemetry(request)).maximum).toBe(2);
  await request.post("/api/work-force/stop",{data:{}});
  await request.post(`/api/agents/projects/${a.projectId}/workflow/cancel`,{data:{}}); await normal;
  await expect.poll(async()=>(await force(request)).runtime.phase).toBe("stopped");
  expect((await force(request)).runtime.history[0]).toMatchObject({agent:{name:"GLOBAL_QUEUE_SHARED_B"},outcome:"succeeded"});
});

for (const parallel of [false, true]) test(`all three modes keep their rhythms through the shared admission queue (parallel=${parallel})`, async ({request}) => {
  const selected = await createAgent(request, "GLOBAL_QUEUE_THREE_FORCE"), light = await createAgent(request, "GLOBAL_QUEUE_THREE_LIGHT", false), normal = await createAgent(request, "GLOBAL_QUEUE_THREE_NORMAL", false);
  await request.put("/api/execution-queue/settings", { data: { allowParallelExecutions: parallel } });
  const lightState = await (await request.get("/api/work-light")).json();
  const at = Math.max(Math.floor(Date.now() / 60000) * 60000 + 60000, (lightState.runtime.lastEvaluatedMinute + 1) * 60000);
  await request.post("/__test/work-light-clock", { data: { at: new Date(at - 60000).toISOString() } });
  expect((await request.put("/api/work-light/configuration", { data: { agents: [{ projectId: light.projectId, agentId: light.agentId }], crons: ["* * * * *"], timezone: "UTC" } })).ok()).toBe(true);
  expect((await request.post("/api/work-light/start", { data: {} })).status()).toBe(202);
  await startForce(request, selected);
  await expect.poll(async () => (await starts(request)).length).toBe(1);
  await request.post("/__test/work-light-clock", { data: { at: new Date(at).toISOString() } });
  await expect.poll(async () => (await (await request.get("/api/work-light")).json()).runtime.occurrences[0]?.outcome).toBe(parallel ? "started" : "queued");
  const schedule = `/api/agents/projects/${normal.projectId}/workflow/schedule`;
  expect((await request.put(schedule, { data: { cron: "* * * * *", enabled: true, timezone: "UTC", parameterValues: {} } })).ok()).toBe(true);
  await request.post("/__test/scheduled-scan", { data: { at: new Date(at).toISOString() } });
  if (parallel) {
    await expect.poll(async () => (await telemetry(request)).maximum).toBe(3);
  } else {
    await expect.poll(async () => (await queue(request)).waiting.map((entry: any) => entry.source)).toEqual(["work-light", "normal"]);
    await expect.poll(async () => (await queue(request)).waiting.map((entry: any) => entry.source), { timeout: 12000, intervals: [100] }).toEqual(["normal", "work-force"]);
  }
  await request.post("/api/work-force/stop", { data: {} });
  await expect.poll(async () => (await (await request.get(schedule)).json()).lastRunStatus, { timeout: 15000 }).toBe("succeeded");
  await expect.poll(async () => (await queue(request)).active.length, { timeout: 15000 }).toBe(0);
  expect((await starts(request)).map((entry: any) => entry.marker)).toEqual([selected.marker, light.marker, normal.marker]);
  expect((await telemetry(request)).maximum).toBe(parallel ? 3 : 1);
  expect((await (await request.get("/api/work-light/status")).json()).armed).toBe(true);
  await request.put(schedule, { data: { cron: "* * * * *", enabled: false, timezone: "UTC", parameterValues: {} } });
});

test("later normal schedule occurrences remain queued while an earlier occurrence is still waiting", async ({request}) => {
  const blocker = await createAgent(request, "GLOBAL_QUEUE_RECURRING_BLOCKER"), normal = await createAgent(request, "GLOBAL_QUEUE_RECURRING_NORMAL", false);
  const blocking = runAgent(request, blocker);
  await expect.poll(async () => (await starts(request)).length).toBe(1);
  const schedule = `/api/agents/projects/${normal.projectId}/workflow/schedule`;
  await request.put(schedule, { data: { cron: "* * * * *", enabled: true, timezone: "UTC", parameterValues: {} } });
  for (const at of ["2027-01-04T10:00:00Z", "2027-01-04T10:00:30Z", "2027-01-04T10:01:00Z"])
    await request.post("/__test/scheduled-scan", { data: { at } });
  await expect.poll(async () => (await queue(request)).waiting.filter((entry: any) => entry.projectId === normal.projectId).length).toBe(2);
  await request.post(`/api/agents/projects/${blocker.projectId}/workflow/cancel`, { data: {} }); await blocking;
  await expect.poll(async () => (await (await request.get(schedule)).json()).lastRunStatus, { timeout: 10000 }).toBe("succeeded");
  expect((await starts(request)).filter((entry: any) => entry.marker === normal.marker).length).toBe(2);
  expect((await telemetry(request)).maximum).toBe(1);
  await request.put(schedule, { data: { cron: "* * * * *", enabled: false, timezone: "UTC", parameterValues: {} } });
});
