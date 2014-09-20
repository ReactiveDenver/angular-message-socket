(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function () {
  'use strict';
  
  var module = angular.module("mock.WebSocket", []);

  module.factory("WebSocketBackend", function($timeout) {
    var requests = [];
    var handlers = [];
    var mockClient = undefined;
    var backendDisabled = false;

    return {
      /**
       * Creates a message handler.
       * 
       * @param {function} messageFilter The filter which must pass for the message to be handled.
       * @param {object} data The data attribute to use in the data given by the handler.
       * @todo Permit data parameter to be a function (request -> response)
       */
      when: function(messageFilter, data) {
        handlers.push([messageFilter, data]);
      },

      /**
       * Flushes all responses to mock client.
       *
       */
      flush: function() {
        angular.forEach(requests, function(request, i) {
          var handled = false;
          angular.forEach(handlers, function(handler) {
            if(handler[0](angular.fromJson(request))) {
              var messageEvent = {type: "message", data: handler[1]};
              mockClient.onmessage(messageEvent);
            }
            handled = true;
          });
          if(handled) delete requests[i];
        });
      },

      /**
       * Pushes a message to mock client.
       *
       * @param {object} data The data attribute to use in the pushed message.
       */
      push: function(data) {
        var messageEvent = {type: "message", data: data};
        mockClient.onmessage(messageEvent);
      },

      /**
       * Sends a close event to mock client.
       *
       * @param {object} message The data attribute to use in the pushed message.
       */
      close: function(closeAttrs) {
        var closeEvent = {type: "close", code: 1000, reason: "", wasClean: true};
        angular.forEach(closeAttrs, function(val, key) {
          if(key in closeEvent) closeEvent[key] = val;
        });
        mockClient.onclose(closeEvent);
      },

      /**
       * Sends an error event to mock client.
       *
       */
      error: function() {
        var event = {type: "error"};
        mockClient.onerror(event);
      },

      /**
       * Simulates service downtime until enable() is called.
       *
       */
      disable: function() {
        backendDisabled = true;
        this.close({wasClean: false});
      },

      /**
       * Re-enables backend after a simulated blackout.
       *
       */
      enable: function() {
        backendDisabled = false;
      },

      /**
       * Produces a list of outstanding request messages.
       *
       * @return {array} 
       */
      outstandingRequests: function() {
        return requests.map(function(msgString) {
          return JSON.parse(msgString);
        });
      },

      /**
       * Resets all request expectations, but preserves all backend definitions.
       *
       */
      resetRequests: function() {
        requests = [];
      },

      // interface for the mock to use
      _registerClient: function(oMockClient) {
        mockClient = oMockClient;
        // defer onopen; allows callbacks to be defined on a newly created instance of WebSocket
        var that = this;
        $timeout(function() {
          // onclose, onerror called on a failed connection attempt
          if(backendDisabled) {
            that.close({wasClean: false});
            that.error();
          }
          else mockClient.onopen();
        });
      },
      _receiveRequest: function(sData) {
        requests.push(sData);
      },
      _receiveClose: function(lCode, sReason) {
        mockClient.onclose({code: 1000, reason: "", wasClean: true});
      }
    };
  });

  module.factory("WebSocket", function(WebSocketBackend) {
    function WebSocket(url) {
      WebSocketBackend._registerClient(this);
    }

    WebSocket.prototype.send = function(sData) {
      // for the sake of testing, a response is expected for every request
      WebSocketBackend._receiveRequest(sData);
    };

    WebSocket.prototype.close = function(lCode, sReason) {
      if(lCode == null) lCode = 1000;
      if(sReason == null) sReason = "";
      WebSocketBackend._receiveClose(lCode, sReason);
    };

    return WebSocket;
  });

}).call(this);

},{}]},{},[1]);
