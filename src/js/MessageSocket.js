(function() {
  'use strict';
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  angular.module("dbaumann.message-socket", []).factory("WebSocket", [
    "$window", function($window) {
      return $window.WebSocket;
    }
  ]).provider("MessageSocket", [
    "$logProvider", function($logProvider) {
      var DELAYED_QUEUE_SIZE, MAX_RECONNECTS, MESSAGE_TYPE, RECONNECT_TIMEOUT;
      MESSAGE_TYPE = "$variant";
      this.messageTypeKey = function(key) {
        return MESSAGE_TYPE = key;
      };
      RECONNECT_TIMEOUT = 1000;
      this.reconnectTimeout = function(millis) {
        return RECONNECT_TIMEOUT = millis;
      };
      MAX_RECONNECTS = 10;
      this.maxReconnects = function(count) {
        return MAX_RECONNECTS = count;
      };
      DELAYED_QUEUE_SIZE = 25;
      this.delayedQueueSize = function(size) {
        return DELAYED_QUEUE_SIZE = size;
      };
      this.$get = [
        "$rootScope", "$timeout", "$window", "$log", "$q", "WebSocket", function($rootScope, $timeout, $window, $log, $q, WebSocket) {
          var AskContext, BoundedQueue, MessageSocket;
          BoundedQueue = (function() {
            function BoundedQueue(queueSize) {
              this.queueSize = queueSize;
              this.items = [];
            }

            BoundedQueue.prototype.enqueue = function(message) {
              if (this.items.length === this.queueSize) {
                this.items.pop();
              }
              return this.items.unshift(message);
            };

            BoundedQueue.prototype.dequeue = function() {
              return this.items.pop();
            };

            BoundedQueue.prototype.size = function() {
              return this.items.length;
            };

            return BoundedQueue;

          })();
          AskContext = (function() {
            function AskContext(messenger, askMessage, responseTimeout) {
              this.messenger = messenger;
              this.askMessage = askMessage;
              this.responseTimeout = responseTimeout;
              this.messageId = Date.now();
              this.contextReceives = [];
              this.deferreds = [];
              this.tellSent = false;
            }


            /**
             * Send a message upstream and await a response within a timeout.
             * Subsequent calls on the same AskContext are bound to the timeout of the initial call.
             * @param {string | array(string)} acceptable response message name(s)
             * @return $q.deferred of response message
             */

            AskContext.prototype["for"] = function(responseNames) {
              var deferred;
              deferred = $q.defer();
              this.deferreds.push(deferred);
              if (!this.tellSent) {
                this.messenger.tell(this.askMessage, this.messageId);
                this.tellSent = true;
              }
              this.contextReceives.push(this.messenger.receive(responseNames, (function(_this) {
                return function(response) {
                  deferred.resolve(response);
                  _this.contextReceives.forEach(function(cancel) {
                    return cancel();
                  });
                  return $timeout.cancel(_this.timeoutPromise);
                };
              })(this)));
              if (!this.timeoutPromise) {
                this.timeoutPromise = $timeout((function(_this) {
                  return function() {
                    _this.contextReceives.forEach(function(cancel) {
                      return cancel();
                    });
                    return _this.deferreds.forEach(function(deferred) {
                      return deferred.reject(new Error(("[MessageSocket.AskTimedOut] Ask timeout for '" + _this.askMessage[MESSAGE_TYPE] + "'") + (" elapsed after " + _this.responseTimeout + " ms")));
                    });
                  };
                })(this), this.responseTimeout);
              }
              return deferred.promise;
            };

            return AskContext;

          })();
          return MessageSocket = (function() {
            MessageSocket.prototype.connected = false;

            MessageSocket.prototype.reconnects = 0;

            MessageSocket.prototype.connect = function(url) {
              this.socket = new WebSocket(url);
              this.socket.onopen = this.onOpen;
              this.socket.onmessage = this.onMessage;
              this.socket.onclose = (function(_this) {
                return function(message) {
                  _this.connected = false;
                  if (!_this.closeRequested && !message.wasClean) {
                    return _this.reconnect(message);
                  }
                };
              })(this);
              this.socket.onerror = this.onError;
              this.send = function(message) {
                return this.socket.send(message);
              };
              return $window.onbeforeunload = (function(_this) {
                return function() {
                  _this.socket.close();
                  if (!($logProvider.debugEnabled())) {
                    return "Your connection to this application is about to close.";
                  }
                };
              })(this);
            };

            MessageSocket.prototype.close = function() {
              $log.debug("MessageSocket closed.");
              this.closeRequested = true;
              return this.socket.close();
            };

            function MessageSocket(url) {
              this.receive = __bind(this.receive, this);
              this.handlers = {};
              this.outbox = new BoundedQueue(DELAYED_QUEUE_SIZE);
              this.uniqueId = function() {
                return "_" + Math.random().toString(36).substr(2, 9);
              };
              this.onOpen = (function(_this) {
                return function() {
                  var nextMessage, _results;
                  _this.connected = true;
                  _this.reconnects = 0;
                  $log.debug("MessageSocket opened.");
                  if (_this.outbox.size()) {
                    _results = [];
                    while ((nextMessage = _this.outbox.dequeue())) {
                      $log.debug("MessageSocket sent", nextMessage[MESSAGE_TYPE], nextMessage);
                      _results.push(_this.send(JSON.stringify(nextMessage)));
                    }
                    return _results;
                  }
                };
              })(this);
              this.onMessage = (function(_this) {
                return function(message) {
                  var handler, json, receiveId, _ref, _results;
                  json = angular.fromJson(message.data);
                  $log.debug("MessageSocket received", json[MESSAGE_TYPE], json);
                  if ((_this.handlers[json[MESSAGE_TYPE]] != null)) {
                    _ref = _this.handlers[json[MESSAGE_TYPE]];
                    _results = [];
                    for (receiveId in _ref) {
                      handler = _ref[receiveId];
                      _results.push($rootScope.$apply(function() {
                        return handler(json);
                      }));
                    }
                    return _results;
                  }
                };
              })(this);
              this.reconnect = (function(_this) {
                return function(message) {
                  var nextTimeout;
                  if (_this.reconnects === MAX_RECONNECTS) {
                    $rootScope.$emit("MessageSocket.disconnected", Date.now());
                    if (!($logProvider.debugEnabled())) {
                      return $window.alert("Your connection to this application has closed unexpectedly.");
                    }
                  } else {
                    nextTimeout = Math.floor(Math.random() * Math.pow(2, _this.reconnects) * RECONNECT_TIMEOUT);
                    $log.debug("MessageSocket closed unexpectedly. Reconnecting in " + nextTimeout + " ms.");
                    return $timeout(function() {
                      _this.reconnects += 1;
                      return _this.connect(url);
                    }, nextTimeout);
                  }
                };
              })(this);
              this.onError = function(message) {
                return $log.debug("MessageSocket encountered an error", message);
              };
              this.connect(url);
            }


            /**
             * Register a callback for one or more messages.
             * @param {string | array(string)} message name(s)
             * @param {function} function which is passed the message upon receipt
             * @return function which removes the created callbacks
             */

            MessageSocket.prototype.receive = function(messageNames, messageHandler) {
              var messageName, receiveId, _i, _len;
              if (!angular.isFunction(messageHandler)) {
                throw Error("expected function");
              }
              if (angular.isString(messageNames)) {
                messageNames = [messageNames];
              }
              receiveId = this.uniqueId();
              for (_i = 0, _len = messageNames.length; _i < _len; _i++) {
                messageName = messageNames[_i];
                if (this.handlers[messageName] == null) {
                  this.handlers[messageName] = {};
                }
                this.handlers[messageName][receiveId] = messageHandler;
              }
              return (function(_this) {
                return function() {
                  var _j, _len1, _results;
                  _results = [];
                  for (_j = 0, _len1 = messageNames.length; _j < _len1; _j++) {
                    messageName = messageNames[_j];
                    _results.push(delete _this.handlers[messageName][receiveId]);
                  }
                  return _results;
                };
              })(this);
            };


            /**
             * Send a message upstream.
             * @param {object} message contents, including a message type which may be identified with _ key
             * @return timestamp which was assigned to sent message
             */

            MessageSocket.prototype.tell = function(message, messageId) {
              if (messageId == null) {
                messageId = null;
              }
              if (message._) {
                message[MESSAGE_TYPE] = message._;
                delete message._;
              }
              if (!message[MESSAGE_TYPE]) {
                throw Error("Missing message type");
              }
              message.stamp = messageId ? messageId : Date.now();
              if (!this.connected) {
                $log.debug("MessageSocket enqueued", message[MESSAGE_TYPE], message);
                this.outbox.enqueue(message);
              } else {
                $log.debug("MessageSocket sent", message[MESSAGE_TYPE], message);
                this.send(JSON.stringify(message));
              }
              return message.stamp;
            };


            /**
             * Prepare to send a message upstream and await responses within a timeout.
             * @param {number} timeout in milliseconds
             * @return function (askMessage) -> AskContext
             */

            MessageSocket.prototype.withTimeout = function(after) {
              return function(askMessage) {
                return new AskContext(this, askMessage, after);
              };
            };

            return MessageSocket;

          })();
        }
      ];
      return void 0;
    }
  ]);

}).call(this);
