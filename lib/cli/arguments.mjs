import {Command,Option} from 'commander';
import {CliError} from './client.mjs';
const specs={json:['--json','Output the stable JSON contract'],browser:['--browser','Open a one-use management link in your browser'],'data-dir':['--data-dir <dir>','Private local service state'],server:['--server <origin>','Explicit paired server origin'],'token-file':['--token-file <file>','Private pairing credential'],'assets-dir':['--assets-dir <dir>','Local resource boundary'],'include-resource':['--include-resource <path>','Include an additional declared resource'],'new-version-of':['--new-version-of <url>','Create a new version of a review'],status:['--status <status>','Filter: open, all, accepted, rejected, stale, withdrawn'],'host-db':['--host-db <file>','Existing host database (filesystem authority)'],out:['--out <file>','Create a private credential file']};
export function argumentsFor(argv){
 // Commander accepts option-looking required values. Reject a following option
 // rather than consuming it as a path and accidentally starting a service.
 for(let i=0;i<argv.length&&argv[i]!=='--';i++){const key=argv[i].replace(/^--/,'');if(specs[key]?.[0].includes('<')&&(argv[i+1]===undefined||argv[i+1].startsWith('--')))throw new CliError('invalid_arguments',`Option --${key} requires a value`);}

 const program=new Command().name('marginroom').description('Share HTML for review and read feedback threads.').exitOverride().configureOutput({writeErr:()=>{}}).configureHelp({helpWidth:process.stdout.columns||80,showGlobalOptions:true,styleTitle:s=>process.stdout.isTTY&&!('NO_COLOR'in process.env)?`\x1b[1m${s}\x1b[0m`:s});
 // Root accepts legacy option placement before the subcommand; hide command-only options.
 for(const [key,[flags,description]]of Object.entries(specs)){const o=new Option(flags,description);if(!['json','data-dir','server','token-file'].includes(key))o.hideHelp();if(key==='include-resource')o.argParser((v,p=[])=>[...p,v]);program.addOption(o);}
 let result;
 for(const [name,arg,description,keys]of [
 ['open','<file>','Import HTML and print its review URL',['browser','assets-dir','include-resource','new-version-of']],
 ['comments','<url>','Read feedback threads (text by default)',['status']],
 ['pair',null,'Write a private machine credential',['host-db','out']]]){
 const cmd=program.command(name).description(description);if(arg)cmd.argument(arg);
 for(const key of keys){const o=new Option(...specs[key]);if(key==='include-resource')o.argParser((v,p=[])=>[...p,v]);cmd.addOption(o);}
 cmd.action((...args)=>{const command=args.at(-1);const opts={...program.opts(),...command.opts()};const v={};for(const [key,value]of Object.entries(opts))v[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]=value;result={values:v,positionals:[name,...command.args]};});
 }
 program.addHelpText('after',`\nExamples:\n  marginroom open article.html\n  marginroom comments 'http://127.0.0.1:PORT/viewer.html?doc=ID'\n  marginroom comments 'REVIEW_URL' --status all --json\n\nLocal links are loopback-only. Pair explicitly for an existing host.`);
 if(!argv.length){program.outputHelp();return null;}
 try{program.parse(argv,{from:'user'});}catch(e){if(e.code==='commander.helpDisplayed')return null;throw new CliError('invalid_arguments',e.message.replace(/^error: /,''));}
 if(!result)throw new CliError('invalid_arguments','Expected open, comments, or pair');
 const {values:v,positionals:p}=result;
 if(p[0]==='comments'&&v.status&&!['open','all','accepted','rejected','stale','withdrawn'].includes(v.status))throw new CliError('invalid_status','Unsupported status');
 if(v.browser&&v.json)throw new CliError('invalid_arguments','--browser and --json are mutually exclusive');
 return result;
}
