describe("dbaumann.message-socket", function() {

  var $logProvider, MessageSocketProvider;
  beforeEach(module("dbaumann.message-socket", "mock.WebSocket", function(_$logProvider_, _MessageSocketProvider_) {
    $logProvider = _$logProvider_;
    MessageSocketProvider = _MessageSocketProvider_;
  }));

  describe("MessageSocket", function() {

    var $timeout, WebSocketBackend, MessageSocket, createMessageSocket, mySocket;
    beforeEach(inject(function(_$timeout_, _WebSocketBackend_, _MessageSocket_) {
      $timeout = _$timeout_;
      WebSocketBackend = _WebSocketBackend_;
      MessageSocket = _MessageSocket_;
      createMessageSocket = function() {
        var ret = new MessageSocket("ws://localhost:3000");
        $timeout.flush();
        return ret;
      };
    }));

    it("should reconnect automatically when the connection closes unexpectedly", function() {
      mySocket = createMessageSocket();

      expect(mySocket.connected).toBe(true);

      WebSocketBackend.disable();
      expect(mySocket.connected).toBe(false);

      $timeout.flush();

      expect(mySocket.connected).toBe(false);
      expect(mySocket.reconnects).toBe(1);

      WebSocketBackend.enable();
      $timeout.flush();

      expect(mySocket.connected).toBe(true);
      expect(mySocket.reconnects).toBe(0);
    });

    it("should generate an event upon a maximum number of failed reconnects", inject(function($rootScope, $window) {
      // configurable with maxReconnects
      MessageSocketProvider.maxReconnects(2);

      // disconnect alert enabled by disabling log debugging
      $logProvider.debugEnabled(false);

      mySocket = createMessageSocket();

      spyOn($rootScope, "$emit").andCallThrough();
      spyOn($window, "alert");

      expect(mySocket.connected).toBe(true);

      WebSocketBackend.disable();

      expect(mySocket.connected).toBe(false);
      expect(mySocket.reconnects).toBe(0);
      
      $timeout.flush();

      expect(mySocket.connected).toBe(false);
      expect(mySocket.reconnects).toBe(1);

      expect($rootScope.$emit).not.toHaveBeenCalled();
      expect($window.alert).not.toHaveBeenCalled();
      
      $timeout.flush();
      // maxReconnects used up

      expect(mySocket.connected).toBe(false);
      expect(mySocket.reconnects).toBe(2);
      expect($rootScope.$emit).toHaveBeenCalledWith(
        "MessageSocket.disconnected", jasmine.any(Number)
      );
      // alert on disconnect when debug messages are not enabled
      expect($window.alert).toHaveBeenCalled();
    }));

    it("should close the connection before the client leaves", inject(function($window) {
      mySocket = createMessageSocket();

      expect(mySocket.connected).toBe(true);

      var unloadMessage = $window.onbeforeunload();
      expect(mySocket.connected).toBe(false);

      // unload prompt enabled by disabling log debugging
      expect(unloadMessage).toBeUndefined();

      $logProvider.debugEnabled(false);

      unloadMessage = $window.onbeforeunload();

      expect(unloadMessage).toBeDefined();
    }));

    it("should enable handling of one or more incoming messages with 'receive'", function() {
      mySocket = createMessageSocket();

      var receivedMsgs = [];
      mySocket.receive("Foo", function (msg) { receivedMsgs.push(msg); });

      var pushedMsgs = [{"$variant":"Foo","message":"the quick brown fox"}];
      WebSocketBackend.push(pushedMsgs[0]);

      expect(receivedMsgs).toEqual(pushedMsgs);

      // can handle multiple messages with the same handler
      receivedMsgs = [];
      var cancelBarBaz = mySocket.receive(["Bar", "Baz"], function (msg) { receivedMsgs.push(msg); });

      pushedMsgs = [
        {"$variant":"Bar","message":"jumps over"},
        {"$variant":"Baz","message":"the lazy dog"}
      ];
      WebSocketBackend.push(pushedMsgs[0]);
      WebSocketBackend.push(pushedMsgs[1]);

      expect(receivedMsgs).toEqual(pushedMsgs);

      // can be canceled
      cancelBarBaz();

      receivedMsgs = [];
      WebSocketBackend.push(pushedMsgs[0]);
      WebSocketBackend.push(pushedMsgs[1]);

      expect(receivedMsgs).toEqual([]);
    });

    it("should enable sending of outgoing messages with 'tell'", function() {
      mySocket = createMessageSocket();

      mySocket.tell({_: "Foo", "message": "the quick brown fox"});
      var serverReceived = WebSocketBackend.outstandingRequests();
      expect(serverReceived.length).toBe(1);
      delete serverReceived[0].stamp;
      expect(serverReceived[0]).toEqual({"$variant":"Foo","message":"the quick brown fox"});

      WebSocketBackend.resetRequests();

      // configurable message type key
      MessageSocketProvider.messageTypeKey("topic");
      mySocket = createMessageSocket();

      mySocket.tell({_: "Bar", "message": "jumps over"});
      serverReceived = WebSocketBackend.outstandingRequests();
      expect(serverReceived.length).toBe(1);
      delete serverReceived[0].stamp;
      expect(serverReceived[0]).toEqual({"topic":"Bar","message":"jumps over"});

      // returns an accurate stamp in milliseconds
      var sendStamp = mySocket.tell({_: "Foo", "message": "the quick brown fox"});
      expect(sendStamp).toBeCloseTo(Date.now(), 10);
    });

    it("should enqueue messages that are requested to be sent while connection is down", function() {
      // configurable queue size
      MessageSocketProvider.delayedQueueSize(2);
      mySocket = createMessageSocket();

      WebSocketBackend.close({wasClean: false});
      expect(mySocket.connected).toBe(false);

      mySocket.tell({_: "Foo", "message": "the quick brown fox"});
      mySocket.tell({_: "Foo", "message": "jumps over"});
      mySocket.tell({_: "Foo", "message": "the lazy dog"});

      expect(WebSocketBackend.outstandingRequests().length).toBe(0);

      $timeout.flush();
      expect(mySocket.connected).toBe(true);

      var serverReceived = WebSocketBackend.outstandingRequests();
      expect(serverReceived.length).toBe(2);

      expect(serverReceived[0].message).toBe("jumps over");
      expect(serverReceived[1].message).toBe("the lazy dog");
    });

    it("should support the ask pattern through 'withTimeout'", function() {
      mySocket = createMessageSocket();

      mySocket.ask = mySocket.withTimeout(5000);

      WebSocketBackend.when(function(m) { return m.$variant == "Foo" },
        // stamp attribute used to identify responses
        {"$variant":"FooDone","message":"pong","stamp":Date.now()}
      );

      var actualResponse, responseDone, reponseFailed;
      var fooAsk = mySocket.ask({_: "Foo", "message": "ping"});

      // message sent in lazy fashion, only after a for handler is declared
      expect(WebSocketBackend.outstandingRequests().length).toBe(0);

      fooAsk.for("FooDone").then(function(message) { responseDone = true; actualResponse = message; });
      fooAsk.for("FooFailed").then(function(message) { reponseFailed = true; });

      // should send only one request per ask, regardless of the number of for handlers
      expect(WebSocketBackend.outstandingRequests().length).toBe(1);

      WebSocketBackend.flush();

      // should complete only one promise
      expect(responseDone).toBeDefined();
      expect(reponseFailed).toBeUndefined();

      expect(actualResponse.$variant).toBe("FooDone");
      expect(actualResponse.message).toBe("pong");
      expect(actualResponse.stamp).toEqual(jasmine.any(Number));

      expect(WebSocketBackend.outstandingRequests.length).toBe(0);
    });

    it("should reject all promises when an ask times out", function() {
      mySocket = createMessageSocket();

      mySocket.ask = mySocket.withTimeout(5000);
      
      var thrown = [];
      var fooAsk = mySocket.ask({_: "Foo", "message": "the quick brown fox"});
      fooAsk.for("FooDone").catch(function(error) { thrown.push(error) });
      fooAsk.for("FooFailed").catch(function(error) { thrown.push(error) });

      $timeout.flush();

      expect(thrown.length).toBe(2);
      expect(typeof thrown[0]).toBe("object");
      expect(thrown[0].constructor.name).toBe("Error");
    });

  });

});
