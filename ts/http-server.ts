
declare var require:(filename:string)=>any;
declare var __dirname:string;
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from "path";
import { Url } from 'url';
import { realpath } from 'fs';

namespace Quic{
    export interface IRedirectRule{
        rule:string;

        target:string;
    }
    export interface IProxyConfig{
        target_url:string;
        rules:Array<string|IRedirectRule>
    }
    
    export interface IServerConfig{
        port:number;
        static_dir?:string;
        controller_dir?:string;
        paw_rules?:Array<string>;
        proxies?:Array<IProxyConfig>;
    }
    export interface IRequest{
        queries:{[index:string]:string};
        posts:{[index:string]:string};
        contentType:string;
        method:string;
        contentBody:any;
    }
    export interface IController{
        response:http.ServerResponse
        root_dir:string;
        controller_dir:string;
    }

    export class RedirectRule{
        regx:RegExp;
        target:string;
        constructor(key:any,value:any){
            var t = typeof(value);
            if(t==="string"){
                this.regx = new RegExp(key);
                this.target = value;
                
            }else {
                this.regx = new RegExp(value.rule);
                this.target = value.target;
                
            }
            this.regx = this.regx.compile();
        }
        check(path:string):string{
            if(this.regx.test(path)) return this.target;
        }
    }
    export class Proxy{
        native:any;
        target_url:string;
        rules:Array<RedirectRule>;
        constructor(url:string,rules:Array<RedirectRule>){
            this.rules= rules;
            this.target_url = url;
            let HttpProxy = require("http-proxy");
            let proxy = this.native = HttpProxy.createProxyServer({
                target: url,   //接口地址
                // 下面的设置用于https
                // ssl: {
                //     key: fs.readFileSync('server_decrypt.key', 'utf8'),
                //     cert: fs.readFileSync('server.crt', 'utf8')
                // },
                // secure: false
            });
            

            proxy.on('error', function (err, request, response) {
                response.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                console.error(err)
                response.end('proxy['+url+'] run to a error:' + err)
            });
            for(let i in rules){
                var rule = rules[i];
                console.log(`redirect [${rule.regx}] to [${url}/${rule.target}]`  );
            }
        }
        tryRedirect(path:string,request:http.ServerRequest,response:http.ServerResponse):boolean{
            for(var i in this.rules){
                var rule = this.rules[i];
                if(rule.check(path)){
                    this.native.web(request,response);
                    return true;
                }
            }
            return false;
        }
    }

    

    export class HttpServer{
        config:IServerConfig;
        native:any;
        static_dir:string;
        controller_dir:string;
        proxies:{[url:string]:Proxy};
        paw_rules:Array<RegExp>;
        port:number;

        constructor(cfgPath?:string){
            if(!cfgPath) cfgPath = "./http-server.config.js";
            cfgPath = path.join(__dirname, cfgPath);
            let serv_config:IServerConfig = require(cfgPath).serv_config as IServerConfig;
            this.config = serv_config;
            console.log("loaded config:");
            console.log(JSON.stringify(serv_config));
            initRoot(this);
        }
        static instance:HttpServer = new HttpServer();
    }

    function initRoot(server : HttpServer){
        console.log("initializing static_dir...");
        server.static_dir = server.config.static_dir;
        if(!server.static_dir) {
            server.static_dir = "./statics";
        }
        tryMakeDirs(server.static_dir,undefined,(path)=>{
            console.log("static_dir is inited: " + path);
            initControllerDir(server);
        });
    }

    function initControllerDir(server:HttpServer){
        console.log("initializing controller_dir...");
        server.controller_dir = server.config.controller_dir;
        if(!server.controller_dir) {
            server.controller_dir = "./controllers";
        }
        tryMakeDirs(server.controller_dir,undefined,(path)=>{
            console.log("controller_dir is inited: " + path);
            initProxies(server);
        });
    }

    function initProxies(server:HttpServer){
        if(server.config.proxies){
            console.log("initializing proxies...");
            let proxyConfigs = server.config.proxies;
            let proxies :{[index:string]:Proxy} = server.proxies = {};
            for(var i in proxyConfigs ){
                let cfg:IProxyConfig =proxyConfigs[i];
                
                console.log("building proxy["+cfg.target_url+"]...");
                let rules :Array<RedirectRule> = [];
                for(var n in cfg.rules){
                    try{
                        let rule = new RedirectRule(n,cfg.rules[n]);
                        rules.push(rule);
                    }catch(ex){
                        console.error("failed to load proxy rule:"  + n);
                    }
                }
                if(rules.length==0){
                    console.log("No rules for this proxy, ignored.");
                    continue;
                }
                proxies[cfg.target_url] = new Proxy(cfg.target_url,rules);
                
            }
        } 
        
        initPAWs(server);
    }

    function initPAWs(server:HttpServer){
        console.log("initializing POST as writing rules...");
        server.paw_rules=[];
        for(var i in server.config.paw_rules){
            try{
                let regx :RegExp = new RegExp(server.config.paw_rules[i]);
                regx = regx.compile();
                server.paw_rules.push(regx);
                console.log(`[${i}]:${regx}`);
            }catch(ex){
                console.error(`error occured at ${i}:` + ex);
            }
            
        }
        console.log("POST as writing rules inited.");
        initNativeServer(server);
    }

    function initNativeServer(server:HttpServer){
        let nativeServ:http.Server = http.createServer(function (request, response) {
            let uri = url.parse(request.url);
            console.log("request is coming:" + request.url);
            let urlpath = uri.pathname;
            handleRequest(server, request,response,urlpath);
        });
        server.native = nativeServ;
        nativeServ.listen(server.port = server.config.port || 8080);
        console.log(`listen at: ${server.port}...`);
        console.log(`waiting for client connecting in...`);
        console.log(`=======================================`);
    }

    

    function tryMakeDirs(dirpath, mode, callback) {
        fs.exists(dirpath, function(exists) {
            if(exists) {
                callback(dirpath);
            } else {
                //尝试创建父目录，然后再创建当前目录
                var dir = path.dirname(dirpath);       
                console.log("try to create path:" + dir);        
                tryMakeDirs(dir, mode, function(){       
                    console.log("try to create path:" + dirpath);       
                        fs.mkdir(dirpath, mode, callback);       
                });       
            }       
        });      
    };  
    

    function handleRequest(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,urlpath:string):boolean{
        if(server.proxies){
            for(var url in server.proxies){
                if(server.proxies[url].tryRedirect(urlpath,request,response)){
                    return;
                }
            }
        }
        
        handleStatic(server, request,response,urlpath);
    }
    function handleStatic(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,urlpath:string){
        if(request.method==="GET"){
            
            let filename:string = path.join(server.static_dir, urlpath);
            processStatic(server, request,response,filename,function(status){
                if(status!=="success"){
                    handlePAW(server,request,response,urlpath);
                }
            });
            
            
        }else{
            handlePAW(server,request,response,urlpath);
        }
        
    }

    function processStatic(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,filename:string,callback:(status:string)=>void){
       
            
            fs.exists(filename, function (exists) {
                if (!exists) {
                    callback("not-exists");
                } else {
                    fs.readFile(filename, "binary", function (err, file) {
                        if (err) {
                            response.writeHead(500, {
                                'Content-Type': 'text/plain'
                            });
                            response.end(err);
                            callback("read-error");
                        } else {
                            let ext:string = path.extname(filename);
            
                            ext =  ext.slice(1);
                            var contentType = mines[ext]|| "text/plain";
                            response.writeHead(200, {
                                'Content-Type': contentType
                            });
                            response.write(file, "binary");
                            response.end();
                            callback("success");
                        }
                    });
                    return;
                }
            });
        
    }

   

    var handlePAW = function(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,urlpath:string){
        for(var i in server.paw_rules){
            let rule:RegExp = server.paw_rules[i];
            if(rule.test(urlpath)){
                processPAW(server, request,response,urlpath);
                return;
            }
        }
        handleMethod(server,request,response,urlpath);
    
    }
    function handleMethod(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,urlpath:string){
        response.end('{"status":"error","message":"not implement"}');   
    }
    
    

    function processPAW(server:HttpServer,request:http.ServerRequest,response:http.ServerResponse,urlpath:string){
        if(request.method=="GET"){
            let filename:string = path.join(__dirname, urlpath);
            processStatic(server, request,response,filename,function(status){
                if(status!=="success"){
                    handleMethod(server,request,response,urlpath);
                }
            });
        }else {
            var realPath = path.join(__dirname, urlpath);
            var bufferHelper = new BufferHelper();
            request.on('data', function (chunk) { 
                bufferHelper.concat(chunk);
            });  
            request.on("end",function(data){
                var json = bufferHelper.toBuffer().toString();
                
                tryMakeDirs(path.dirname(realPath),undefined,function(dirname){
                    fs.writeFile(realPath,json,(err)=>{
                        if (err) {
                            console.log(err);
                            response.writeHead(500, {
                                'Content-Type': 'text/plain'
                            });
                            response.end('{"status":"error","message":"'+err+'"}');
                        }else {
                            console.log("saved[" + urlpath + "]:");
                            console.log(json);
                            response.end('{"status":"success","message":"success"}');    
                        }
                        
                    });
                });
            });
        }
        
    }     
    
}

namespace Quic{
    declare var Buffer;
    export class BufferHelper{
        buffers:Array<any>;
        size:number;
        result:any;
        constructor(){
            this.buffers = [];
            this.size = 0;
        }
        concat(buffer){
            this.buffers.push(buffer);
            this.size = this.size + buffer.length;
            return this;
        }
        toBuffer():any{
            var data = null;
            var buffers = this.buffers;
            switch(buffers.length) {
            case 0:
                data = new Buffer(0);
                break;
            case 1:
                data = buffers[0];
                break;
            default:
                data = new Buffer(this.size);
                for (var i = 0, pos = 0, l = buffers.length; i < l; i++) {
                var buffer = buffers[i];
                buffer.copy(data, pos);
                pos += buffer.length;
                }
                break;
            }
            // Cache the computed result
            this.result = data;
            return data;
        }
        toString(){
            return Buffer.prototype.toString.apply(this.toBuffer(), arguments);
        }
    }

}
namespace Quic{
    export let mines:any = {
        "css": "text/css",
        "gif": "image/gif",
        "html": "text/html",
        "ico": "image/x-icon",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "js": "text/javascript",
        "json": "application/json",
        "pdf": "application/pdf",
        "png": "image/png",
        "svg": "image/svg+xml",
        "swf": "application/x-shockwave-flash",
        "tiff": "image/tiff",
        "txt": "text/plain",
        "wav": "audio/x-wav",
        "wma": "audio/x-ms-wma",
        "wmv": "video/x-ms-wmv",
        "xml": "text/xml"
    };
}