var sys = require('sys');
var fs = require('fs');
var net = require('net');
var events = require('events');
var path = require('path');
var pipe = require('./lib/nodepipe.js');


//-----------------------------Expose server API-----------------------------
exports.createServer = function(func ) {
    var server = new Server(func);
    return server;
};

function Server(func) {
     events.EventEmitter.call(this);

     this.sessions = {};

     var self = this;

     this.stream = net.createServer(function(stream) {

        this.senderCompID = null;
        this.targetCompID = null;
        this. p = null;
        this.sessionEmitter = function(){
            events.EventEmitter.call(this);
        }
        sys.inherits(sessionEmitter,events.EventEmitter);

        var session = this;

        stream.on('connect', function() {
            self.emit('connect');
            
            session.p = pipe.makePipe(stream);
            //session.p.addHandler({incoming:function(ctx,event){ sys.log(event); ctx.sendNext(event); }});
            session.p.addHandler(require('./handlers/fixFrameDecoder.js').newFixFrameDecoder());
            //session.p.addHandler({incoming:function(ctx,event){ sys.log(event); ctx.sendNext(event); }});
            session.p.addHandler(require('./handlers/logonManager.js').newLogonManager(false));
            session.p.addHandler({outgoing:function(ctx,event){ self.sessionEmitter.emit('outgoingmsg',event); ctx.sendNext(event); }});
            session.p.addHandler(require('./handlers/sessionProcessor.js').newSessionProcessor(false));
            session.p.addHandler({incoming:function(ctx,event){ 
                self.sessionEmitter.emit('incomingmsg',event);
                
                if(event['35'] === 'A'){//if logon
                    session.senderCompID = event['49'];
                    session.targetCompID = event['56'];
                    self.sessions[session.senderCompID + '-' + session.targetCompID] = session;
                    self.sessionEmitter.emit('logon', session.senderCompID, session.targetCompID);
                }
                
                if(event['35'] === '5'){
                    delete self.sessions[session.senderCompID + '-' + session.targetCompID];
                    self.sessionEmitter.emit('logoff', session.senderCompID, session.targetCompID);
                }

                ctx.sendNext(event);
            }});
        });
        stream.on('data', function(data) { session.p.pushIncoming(data); });
        
        func(self.sessionEmitter);

     });

     this.listen = function(port, host) { self.stream.listen(port, host); };
     this.write = function(targetCompID, data) { self.sessions[targetCompID].write(data); };
     this.logoff = function(targetCompID, logoffReason) { self.sessions[targetCompID].write({35:5, 58:logoffReason}); };
     this.kill = function(targetCompID, reason){ self.sessions[targetCompID].end(); };

}
sys.inherits(Server, events.EventEmitter);

//-----------------------------Expose client API-----------------------------
exports.createConnection = function(fixVersion, senderCompID, targetCompID, port, host) {
    return new Client({'8': fixVersion, '56': targetCompID, '49': senderCompID, '35': 'A', '90': '0', '108': '30'}, port, host);
};

exports.createConnectionWithLogonMsg = function(logonmsg, port, host) {
    return new Client(logonmsg, port, host);
};

function Client(logonmsg, port, host) {
    events.EventEmitter.call(this);

    this.session = null;
    var self = this;

    var stream = net.createConnection(port, host);

    this.p = pipe.makePipe(stream);
    this.p.addHandler(require('./handlers/fixFrameDecoder.js').newFixFrameDecoder());
    this.p.addHandler({outgoing:function(ctx,event){ sys.log(event); ctx.sendNext(event); }});
    this.p.addHandler(require('./handlers/logonManager.js').newLogonManager(true));
    this.p.addHandler({outgoing:function(ctx,event){ self.emit('outgoingmsg',event); ctx.sendNext(event);}});
    this.p.addHandler(require('./handlers/sessionProcessor.js').newSessionProcessor(true));
    this.p.addHandler({incoming:function(ctx,event){ self.emit('incomingmsg',event); ctx.sendNext(event); }});
    
    stream.on('connect', function() {
        self.emit('connect');
        self.p.pushOutgoing(logonmsg);
    });
    stream.on('data', function(data) { self.p.pushIncoming(data); });

    this.write = function(data) { self.p.pushOutgoing(data); };
    this.logoff = function(logoffReason){ self.p.pushOutgoing({35:5, 58:logoffReason}) };
}
sys.inherits(Client, events.EventEmitter);
