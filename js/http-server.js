"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var http = require("http");
var url = require("url");
var fs = require("fs");
var path = require("path");
var Quic;
(function (Quic) {
    var RedirectRule = /** @class */ (function () {
        function RedirectRule(key, value) {
            var t = typeof (value);
            if (t === "string") {
                this.regx = new RegExp(key);
                this.target = value;
            }
            else {
                this.regx = new RegExp(value.rule);
                this.target = value.target;
            }
            this.regx = this.regx.compile();
        }
        RedirectRule.prototype.check = function (path) {
            if (this.regx.test(path))
                return this.target;
        };
        return RedirectRule;
    }());
    Quic.RedirectRule = RedirectRule;
    var Proxy = /** @class */ (function () {
        function Proxy(url, rules) {
            this.rules = rules;
            this.target_url = url;
            var HttpProxy = require("http-proxy");
            var proxy = this.native = HttpProxy.createProxyServer({
                target: url,
            });
            proxy.on('error', function (err, request, response) {
                response.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                console.error(err);
                response.end('proxy[' + url + '] run to a error:' + err);
            });
            for (var i in rules) {
                var rule = rules[i];
                console.log("redirect [" + rule.regx + "] to [" + url + "/" + rule.target + "]");
            }
        }
        Proxy.prototype.tryRedirect = function (path, request, response) {
            for (var i in this.rules) {
                var rule = this.rules[i];
                if (rule.check(path)) {
                    this.native.web(request, response);
                    return true;
                }
            }
            return false;
        };
        return Proxy;
    }());
    Quic.Proxy = Proxy;
    var HttpServer = /** @class */ (function () {
        function HttpServer(cfgPath) {
            if (!cfgPath)
                cfgPath = "./http-server.config.js";
            cfgPath = path.join(__dirname, cfgPath);
            var serv_config = require(cfgPath).serv_config;
            this.config = serv_config;
            console.log("loaded config:");
            console.log(JSON.stringify(serv_config));
            initRoot(this);
        }
        HttpServer.instance = new HttpServer();
        return HttpServer;
    }());
    Quic.HttpServer = HttpServer;
    function initRoot(server) {
        console.log("initializing static_dir...");
        server.static_dir = server.config.static_dir;
        if (!server.static_dir) {
            server.static_dir = "./statics";
        }
        tryMakeDirs(server.static_dir, undefined, function (path) {
            console.log("static_dir is inited: " + path);
            initControllerDir(server);
        });
    }
    function initControllerDir(server) {
        console.log("initializing controller_dir...");
        server.controller_dir = server.config.controller_dir;
        if (!server.controller_dir) {
            server.controller_dir = "./controllers";
        }
        tryMakeDirs(server.controller_dir, undefined, function (path) {
            console.log("controller_dir is inited: " + path);
            initProxies(server);
        });
    }
    function initProxies(server) {
        if (server.config.proxies) {
            console.log("initializing proxies...");
            var proxyConfigs = server.config.proxies;
            var proxies = server.proxies = {};
            for (var i in proxyConfigs) {
                var cfg = proxyConfigs[i];
                console.log("building proxy[" + cfg.target_url + "]...");
                var rules = [];
                for (var n in cfg.rules) {
                    try {
                        var rule = new RedirectRule(n, cfg.rules[n]);
                        rules.push(rule);
                    }
                    catch (ex) {
                        console.error("failed to load proxy rule:" + n);
                    }
                }
                if (rules.length == 0) {
                    console.log("No rules for this proxy, ignored.");
                    continue;
                }
                proxies[cfg.target_url] = new Proxy(cfg.target_url, rules);
            }
        }
        initPAWs(server);
    }
    function initPAWs(server) {
        console.log("initializing POST as writing rules...");
        server.paw_rules = [];
        for (var i in server.config.paw_rules) {
            try {
                var regx = new RegExp(server.config.paw_rules[i]);
                regx = regx.compile();
                server.paw_rules.push(regx);
                console.log("[" + i + "]:" + regx);
            }
            catch (ex) {
                console.error("error occured at " + i + ":" + ex);
            }
        }
        console.log("POST as writing rules inited.");
        initNativeServer(server);
    }
    function initNativeServer(server) {
        var nativeServ = http.createServer(function (request, response) {
            var uri = url.parse(request.url);
            console.log("request is coming:" + request.url);
            var urlpath = uri.pathname;
            handleRequest(server, request, response, urlpath);
        });
        server.native = nativeServ;
        nativeServ.listen(server.port = server.config.port || 8080);
        console.log("listen at: " + server.port + "...");
        console.log("waiting for client connecting in...");
        console.log("=======================================");
    }
    function tryMakeDirs(dirpath, mode, callback) {
        fs.exists(dirpath, function (exists) {
            if (exists) {
                callback(dirpath);
            }
            else {
                //尝试创建父目录，然后再创建当前目录
                var dir = path.dirname(dirpath);
                console.log("try to create path:" + dir);
                tryMakeDirs(dir, mode, function () {
                    console.log("try to create path:" + dirpath);
                    fs.mkdir(dirpath, mode, callback);
                });
            }
        });
    }
    ;
    function handleRequest(server, request, response, urlpath) {
        if (server.proxies) {
            for (var url in server.proxies) {
                if (server.proxies[url].tryRedirect(urlpath, request, response)) {
                    return;
                }
            }
        }
        handleStatic(server, request, response, urlpath);
    }
    function handleStatic(server, request, response, urlpath) {
        if (request.method === "GET") {
            var filename = path.join(server.static_dir, urlpath);
            processStatic(server, request, response, filename, function (status) {
                if (status !== "success") {
                    handlePAW(server, request, response, urlpath);
                }
            });
        }
        else {
            handlePAW(server, request, response, urlpath);
        }
    }
    function processStatic(server, request, response, filename, callback) {
        fs.exists(filename, function (exists) {
            if (!exists) {
                callback("not-exists");
            }
            else {
                fs.readFile(filename, "binary", function (err, file) {
                    if (err) {
                        response.writeHead(500, {
                            'Content-Type': 'text/plain'
                        });
                        response.end(err);
                        callback("read-error");
                    }
                    else {
                        var ext = path.extname(filename);
                        ext = ext.slice(1);
                        var contentType = Quic.mines[ext] || "text/plain";
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
    var handlePAW = function (server, request, response, urlpath) {
        for (var i in server.paw_rules) {
            var rule = server.paw_rules[i];
            if (rule.test(urlpath)) {
                processPAW(server, request, response, urlpath);
                return;
            }
        }
        handleMethod(server, request, response, urlpath);
    };
    function handleMethod(server, request, response, urlpath) {
        response.end('{"status":"error","message":"not implement"}');
    }
    function processPAW(server, request, response, urlpath) {
        if (request.method == "GET") {
            var filename = path.join(__dirname, urlpath);
            processStatic(server, request, response, filename, function (status) {
                if (status !== "success") {
                    handleMethod(server, request, response, urlpath);
                }
            });
        }
        else {
            var realPath = path.join(__dirname, urlpath);
            var bufferHelper = new Quic.BufferHelper();
            request.on('data', function (chunk) {
                bufferHelper.concat(chunk);
            });
            request.on("end", function (data) {
                var json = bufferHelper.toBuffer().toString();
                tryMakeDirs(path.dirname(realPath), undefined, function (dirname) {
                    fs.writeFile(realPath, json, function (err) {
                        if (err) {
                            console.log(err);
                            response.writeHead(500, {
                                'Content-Type': 'text/plain'
                            });
                            response.end('{"status":"error","message":"' + err + '"}');
                        }
                        else {
                            console.log("saved[" + urlpath + "]:");
                            console.log(json);
                            response.end('{"status":"success","message":"success"}');
                        }
                    });
                });
            });
        }
    }
})(Quic || (Quic = {}));
(function (Quic) {
    var BufferHelper = /** @class */ (function () {
        function BufferHelper() {
            this.buffers = [];
            this.size = 0;
        }
        BufferHelper.prototype.concat = function (buffer) {
            this.buffers.push(buffer);
            this.size = this.size + buffer.length;
            return this;
        };
        BufferHelper.prototype.toBuffer = function () {
            var data = null;
            var buffers = this.buffers;
            switch (buffers.length) {
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
        };
        BufferHelper.prototype.toString = function () {
            return Buffer.prototype.toString.apply(this.toBuffer(), arguments);
        };
        return BufferHelper;
    }());
    Quic.BufferHelper = BufferHelper;
})(Quic || (Quic = {}));
(function (Quic) {
    Quic.mines = {
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
})(Quic || (Quic = {}));
