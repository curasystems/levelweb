var http = require('http');
var net = require('net');
var url = require('url');
var fs = require('fs');
var levelup = require('levelup');
var path = require('path');

var es = require('event-stream');

var st = require('st')
var WebSocketServer = require('ws').Server;
var WebSocket = require('./websocket');

var staticHandler = st({
  path: path.join(__dirname, '..', 'public'),
  url: '/',
  index: 'index.html'
});

module.exports = function(opts) {

  opts = opts || {};

  opts.http = opts.http || 80;
  opts.tcp = opts.tcp || 9099;

  var userlocation = path.join(opts.location);
  var systemlocation = path.join(__dirname, 'cache');

  var levelopts = { 
    encoding: opts.encoding || 'json',
    createIfMissing: opts.createIfMissing 
  };
  
  var db = {};

  levelup(systemlocation, levelopts, function(error, sysdb) {

    db.sysdb = sysdb;

    //
    // TODO: handle leveldb errors for the user.
    //
    levelup(userlocation, levelopts, function(error, usrdb) {

      db.usrdb = usrdb;

      //
      // handle inbound data from tcp
      //
      var tcpserver = net.createServer({ allowHalfOpen: true }, function(socket) {

        socket
          .pipe(es.split())
          .pipe(es.parse())
          .pipe(usrdb.createWriteStream())
      });

      tcpserver.listen(opts.tcp, function() {
        console.log('tcp server listening on %d', opts.tcp);
      });

      //
      // handle serving the websockets and interface assets
      //
      var httpserver = http.createServer(staticHandler);
      var wss = new WebSocketServer({ 
        server: httpserver.listen(opts.http, function() {
          console.log('http server listening on %d', opts.http);
        }) 
      });

      //
      // handle communication with the server
      //
      wss.on('connection', function(ws) {

        var websocket = new WebSocket(ws);

        function write(object) {
          websocket.write(JSON.stringify(object));
        }

        function sendKeys(opts, dbname) {

          opts = opts || { limit: 100 };
          var keys = [];

          opts.values = false;

          db[dbname]
            .createReadStream(opts)
            .on('data', function(key) {

              keys.push(key);
            })
            .on('end', function() {

              write({ 
                response: 'keyListUpdate',
                value: keys
              });
            });
        }

        function sendMeta() {
          write({ 
            response: 'metaUpdate',
            value: { path: userlocation }
          });
        }

        function sendValue(key, dbname, request) {
          db[dbname].get(key, function(err, value) {
            if (!err) {

              value = { key: key, value: value };
              write({ response: request, value: value });
            }
          });
        }

        function deleteValues(operations, opts, dbname, request) {
          db[dbname].batch(operations, function(err) {
            sendKeys(opts, dbname);
          });
        }

        websocket.on('data', function(message) {

          try { 
            message = JSON.parse(message);
          } 
          catch($) {}

          var dbname = message.dbname;
          var request = message.request;
          var value = message.value;
   
          if (request === 'keyListUpdate') {
            sendKeys(value, dbname);
          }
          else if (request === 'editorUpdate') {
            sendValue(value, dbname, 'editorUpdate');
          }
          else if (request === 'deleteValues') {
            deleteValues(value.operations, value.opts, dbname, 'deleteValues');
          }

        });

        sendMeta();
        sendKeys({}, 'usrdb');

      });
    });
  });
};