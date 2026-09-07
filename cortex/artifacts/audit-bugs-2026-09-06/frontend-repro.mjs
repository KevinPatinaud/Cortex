// Read-only frontend probes against the current dist build; every API call is mocked.
// Run from repository root: node artifacts/audit-bugs-2026-09-06/frontend-repro.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
const server = createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({locale:'fr-FR',viewport:{width:1440,height:900}});
page.setDefaultTimeout(6000);
page.on('dialog', dialog => dialog.accept());
page.on('pageerror', error => console.log('PAGEERROR',error.message));
const makeContent = id => ({
 projectId:id,directoryPath:'C:/mock/' + id,engine:'codex',workflowResumable:false,workflowParameterValues:{},parameters:[],
 instructions:{fileName:'AGENTS.md',content:'Instructions ' + id},
 agents:[{id:id+'-agent',name:'Agent '+id,description:'Mock',prompt:'Prompt '+id,nextAgentIds:[],inputMode:'aggregate',hasSession:false,executionStatus:'idle',conversation:[],threads:[]}]
});
const contents = {A:makeContent('A'),B:makeContent('B')};
const schedule = {cron:'0 9 * * *',enabled:false,timezone:'Europe/Paris',nextRunAt:null,running:false,lastRunAt:null,lastRunStatus:null,lastRunError:null,parameterValues:{}};
let specialHandler = async () => false;
await page.route('**/api/**',async route => {
 if(await specialHandler(route)) return;
 const pathname = new URL(route.request().url()).pathname;
 let json;
 if (pathname === '/api/auth/session') json = {authenticated:true,required:false};
 else if (pathname === '/api/projects') json = {projects:Object.values(contents).map(x=>({id:x.projectId,directoryPath:x.directoryPath}))};
 else if (pathname === '/api/agents/projects/actual') json = null;
 else if (pathname === '/api/agents/status') json = {engine:'codex',label:'Codex',error:null};
 else if (pathname.endsWith('/workflow/schedule')) json=schedule;
 else if (/^\/api\/agents\/projects\/[AB]$/.test(pathname)) json=contents[pathname.at(-1)];
 else { console.log('UNMOCKED',pathname); json={}; }
 await route.fulfill({json});
});
try {

 await page.goto(url+'/?project=B');
 await expect(page.locator('.agent-project__edit-button')).toBeVisible();
 await page.locator('.project-list__select-button').filter({hasText:'A'}).click();
 await expect(page.locator('.agent-project__header h1')).toHaveText('A');
 await page.locator('.agent-project__edit-button').click();
 await page.getByRole('textbox',{name:/Mission/}).fill('Changed A');
 let release, started;
 const paused = new Promise(resolve => {release=resolve});
 const entered = new Promise(resolve => {started=resolve});
 specialHandler = async route => {
  if (new URL(route.request().url()).pathname === '/api/agents/projects/A' && route.request().method()==='PUT') {
   started(); await paused; await route.fulfill({json:contents.A}); return true;
  }
  return false;
 };
 await page.locator('.project-editor__save').click();
 await entered;
 await page.goBack();
 await expect(page.locator('.agent-project__header h1')).toHaveText('B');
 await page.locator('.agent-project__edit-button').click();
 await page.getByRole('textbox',{name:/Mission/}).fill('Unsaved important B');
 console.log('B_EDITOR_BEFORE_A_SAVE_RESPONSE', await page.locator('.workspace-content--editor').count());
 release();
 await expect(page.locator('.workspace-content--editor')).toHaveCount(0);
 console.log('B_EDITOR_AFTER_A_SAVE_RESPONSE',await page.locator('.workspace-content--editor').count());
 console.log('B_RECOVERABLE',await page.evaluate(()=>JSON.parse(localStorage.getItem('cortex.project-draft.v1:B'))?.value.agents[0].prompt));
 specialHandler = async () => false;
 await page.evaluate(()=>localStorage.clear());
 const answer={role:'agent',content:JSON.stringify({status:'success',items:[{content:'First option'},{content:'Second option'}],isMultiSelectionAllowed:false,isMultiSelectionThreaded:false,nextAgentIds:[],notes:null})};
 contents.A.agents[0].hasSession=true;
 contents.A.agents[0].conversation=[answer];
 contents.A.agents[0].threads=[{id:'thread-A',conversation:[answer]}];
 await page.goto(url+'/?project=A');
 const choices=page.locator('.agent-card').getByRole('radio');
 await expect(choices).toHaveCount(2);
 await choices.nth(1).check();
 const details=page.locator('.agent-card__additional-instructions textarea');
 await details.fill('Important manual follow-up instructions');
 console.log('BEFORE_EDIT',JSON.stringify({choices:await choices.evaluateAll(xs=>xs.map(x=>x.checked)),details:await details.inputValue()}));
 await page.locator('.agent-project__edit-button').click();
 await expect(page.getByRole('textbox',{name:/Mission/})).toBeVisible();
 await page.locator('.project-editor__exit').click();
 await expect(choices).toHaveCount(2);
 console.log('AFTER_EDIT_WITHOUT_CHANGES',JSON.stringify({choices:await choices.evaluateAll(xs=>xs.map(x=>x.checked)),details:await details.inputValue()}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
