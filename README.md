## angular-message-socket
A WebSocket wrapper for Angular with Akka-style semantics.


## Usage

### App
```javascript
var myAppModule = angular.module("MyApp", ["dbaumann.message-socket"]);

myAppModule.factory("myService", function(MessageSocket) {
  var messenger = new MessageSocket("ws://localhost:3000");

  return {
    doTell: function() {
      // fire and forget
      messenger.tell({_: "ProfileUpdate", profile: { name: "Kevin Flynn" }});

      // listen
      messenger.receive("ProfileUpdateDone", function(event) { /*...*/ });
    },

    doAsk: function() {
      // ask (with $q)
      messenger.ask = messenger.withTimeout(5000);
      var profileAsk = messenger.ask({_: "ProfileUpdate", profile: { name: "Kevin Flynn" }});

      Promise.race([
        profileAsk.for("ProfileUpdateDone").then(function(event) { /*...*/ }),
        profileAsk.for("ActionFailed").then(function(event) { /*...*/ })
      ]).catch(function(error) {
        console.error(error);
      });
    }
  }
});
```

### Configuration
```javascript
module.config(function($logProvider, MessageSocketProvider) {
  // enable console messages
  $logProvider.debugEnabled(true);
  
  // message type key (defaults to "$variant")
  MessageSocketProvider.messageTypeKey("verb");

  // messages sent while connection is down are placed in a bounded queue
  MessageSocketProvider.delayedQueueSize(200);

  // when notified of a lost connection, will attempt to reconnect per RFC 6455
  MessageSocketProvider.reconnectTimeout(1000);
  MessageSocketProvider.maxReconnects(10);
});
```

### Testing
`WebSocketBackend` is available for your mocking needs, inspired by `$httpBackend`.
Just make _dist/angular-message-socket-mocks.js_ available to your tests.

```javascript
describe("MyApp", function() {
  beforeEach(module("MyApp", "mock.WebSocket"));

  describe("myService", function() {
    var $timeout, WebSocketBackend, createMessageSocket, mySocket;
    beforeEach(inject(function(_$timeout_, _WebSocketBackend_, _MessageSocket_) {
      $timeout = _$timeout_;
      WebSocketBackend = _WebSocketBackend_;
      createMessageSocket = function() {
        var ret = new _MessageSocket_("ws://localhost:3000");
        $timeout.flush(); // necessary for mock to initialize
        return ret;
      };
    }));

    it("should handle request/response pattern", function() {
      mySocket = createMessageSocket();

      WebSocketBackend.when(function(m) { return m.$variant == "ProfileUpdate" },
        // stamp attribute used by ask to identify responses
        {"$variant": "ProfileUpdateDone",
         profile: { name: "Kevin Flynn" },
         "stamp":Date.now()}
      );

      // ... code using MessageSocket

      WebSocketBackend.flush();

      // ... expectations

      expect(WebSocketBackend.outstandingRequests().length).toBe(0);
    });

    it("should handle push", function() {
      mySocket = createMessageSocket();

      WebSocketBackend.push(
        {"$variant": "ProfileUpdateDone",
         profile: { name: "Kevin Flynn" },
         "stamp":Date.now()}
      );

      // ... expectations
    });
  });
});
```

More examples of `MessageSocket` and `WebSocketBackend` can be found in test/spec/tests.js.


## Development

Code quality is ensured with CoffeeScript, CoffeeLint, and Karma.
```sh
npm install -g grunt-cli
npm install && bower install
grunt
```

### Live Reloading

```sh
grunt karma:unit:start watch
```

### Build

```sh
grunt dist
```
