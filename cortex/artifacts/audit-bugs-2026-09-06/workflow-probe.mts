import assert from "node:assert/strict";
import { AgentUseCase } from "../../src/back/application/usecase/AgentUseCase.ts";
import type { ProjectUseCase, ProjectContentOutput } from "../../src/back/application/usecase/ProjectUseCase.ts";
import type { AgentService } from "../../src/back/application/service/iaService/AgentService.ts";
import type { AgentExecutionOptions, AgentExecutionResult } from "../../src/back/application/service/iaService/AgentProvider.ts";
import type { AgentWorkflowConfiguration } from "../../src/back/application/service/projectService/ProjectService.ts";
import type { WorkflowExecutionLimits } from "../../src/back/application/service/workflowExecution/WorkflowExecution.ts";
import type { WorkflowParameterDefinition } from "../../src/shared/WorkflowParameter.ts";
import { WorkflowAuditService } from "../../src/back/application/service/workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../src/back/infrastructure/audit/SqliteWorkflowAuditRepository.ts";

const agentId = (name: string): string => `.claude/agents/${name}.md`;
function response(items: string[], next: string[], threaded = false): AgentExecutionResult {
  return {
    answer: JSON.stringify({ status: "success", items: items.map((content) => ({ content })),
      isMultiSelectionAllowed: threaded, isMultiSelectionThreaded: threaded,
      nextAgentIds: next.map(agentId), notes: null }),
    sessionId: `session-${items.join("-")}`
  };
}

function fixture(
  graph: Record<string, string[]>,
  execute: (name: string, prompt: string, options: AgentExecutionOptions) => Promise<AgentExecutionResult>,
  limits: WorkflowExecutionLimits = {},
  repository = new SqliteWorkflowAuditRepository(":memory:"),
  parameters: WorkflowParameterDefinition[] = []
) {
  let configuration: AgentWorkflowConfiguration | null = null;
  const file = (name: string, relativePath: string, content: string) => ({
    type: "file" as const, name, relativePath, content, size: content.length, encoding: "utf8" as const
  });
  const content: ProjectContentOutput = {
    id: "project", directoryPath: process.cwd(), root: {
      type: "directory", name: "project", relativePath: "", children: [
        file("CLAUDE.md", "CLAUDE.md", "Execute the configured workflow."),
        { type: "directory", name: ".claude", relativePath: ".claude", children: [
          { type: "directory", name: "agents", relativePath: ".claude/agents", children:
            Object.keys(graph).map((name) => file(`${name}.md`, agentId(name),
              `---\nname: ${name}\ndescription: ${name}\n---\nTASK_${name}`)) }
        ] }
      ]
    }
  };
  const project = {
    getProjectContent: async () => content,
    getAgentWorkflowConfiguration: async () => configuration,
    saveAgentWorkflowConfiguration: async (_id: string, value: AgentWorkflowConfiguration) => { configuration = value; }
  } as unknown as ProjectUseCase;
  const service = {
    execute: async (_engine: string, prompt: string, options: AgentExecutionOptions) => {
      if (!options.persistSession) return { answer: JSON.stringify({ agents:
        Object.entries(graph).map(([name, next]) => ({ id: agentId(name), nextAgentIds: next.map(agentId), inputMode: "separate" })), parameters }) };
      const name = Object.keys(graph).find((candidate) => prompt.includes(`TASK_${candidate}`));
      assert.ok(name, "The task identifies its agent");
      return execute(name, prompt, options);
    }
  } as unknown as AgentService;
  return { repository, content, createUseCase: (storage = repository) =>
    new AgentUseCase(service, project, new WorkflowAuditService(storage), limits) };
}


let entryCalls=0;
let workerStarted!:()=>void;
const workerReady = new Promise<void>(r=>workerStarted=r);
let releaseWorker!:(value:AgentExecutionResult)=>void;
const concurrent = fixture({entry:['worker'],worker:[]}, async(name) => {
  if(name==='entry') return response([`INPUT_${++entryCalls}`], ['worker']);
  workerStarted();
  return new Promise<AgentExecutionResult>(r=>releaseWorker=r);
});
try {
 const uc=concurrent.createUseCase();
 await uc.loadProject('project');
 await uc.runAgent('project',{agentId:agentId('entry')});
 const running=uc.runAgent('project',{agentId:agentId('worker'),upstreamAgentResults:[{agentId:agentId('entry'),selectedItemIndexes:[]}]});
 await workerReady;
 await uc.runAgent('project',{agentId:agentId('entry')});
 const during=await uc.loadProject('project');
 console.log('CONCURRENT',JSON.stringify({hasActiveExecutions:uc.hasActiveExecutions(),isProjectRunning:uc.isProjectRunning('project'),workerStatus:during.agents[1].executionStatus}));
 releaseWorker(response(['STALE_RESULT_FROM_INPUT_1'],[]));
 await running;
 const after=await uc.loadProject('project');
 console.log('CONCURRENT_COMPLETED',JSON.stringify({resumable:after.workflowResumable,entry:after.agents[0].conversation.at(-1)?.content,worker:after.agents[1].conversation.at(-1)?.content}));
}finally{concurrent.repository.close();}

for(const status of ['error','blocked']){
 const f=fixture({entry:[]},async()=>({answer:JSON.stringify({status,items:[],isMultiSelectionAllowed:false,isMultiSelectionThreaded:false,nextAgentIds:[],notes:'Cannot perform the task'}),sessionId:'failed-session'}));
 try{
  const uc=f.createUseCase();
  const result=await uc.runWorkflow('project');
  console.log('RESPONSE_STATUS',JSON.stringify({providerStatus:status,runStatus:f.repository.getRun('project',result.auditRunId!)?.status,resumable:(await uc.loadProject('project')).workflowResumable}));
 }finally{f.repository.close();}
}

let workerBCalls=0;
const partial=fixture({entry:['worker'],worker:[]},async(name,prompt,options)=>{
 if(name==='entry')return response(['INPUT_A','INPUT_B','INPUT_C'],['worker'],true);
 if(prompt.includes('INPUT_B')){workerBCalls++;throw new Error('B unavailable');}
 return response(['SUCCESS_A'],[]);
});
try{
 const uc=partial.createUseCase();
 await uc.loadProject('project');
 await uc.runAgent('project',{agentId:agentId('entry')});
 const input={agentId:agentId('worker'),upstreamAgentResults:[{agentId:agentId('entry'),selectedItemIndexes:[0,1,2]}]};
 try{await uc.runAgent('project',input);}catch{}
 const failed=await uc.loadProject('project');
 const before={status:failed.agents[1].executionStatus,resumable:failed.workflowResumable,threads:failed.agents[1].threads.length};
 const id=failed.agents[1].threads[0].id;
 await uc.runAgent('project',{...input,threadId:id});
 const after=await uc.loadProject('project');
 console.log('RERUN_SUCCESSFUL_THREAD_AFTER_PARTIAL_FAILURE',JSON.stringify({before,after:{status:after.agents[1].executionStatus,resumable:after.workflowResumable,threads:after.agents[1].threads.length},workerBCalls,audit:partial.repository.listRuns('project',20,0).items.map(r=>r.status)}));
}finally{partial.repository.close();}

