'use strict'

angular.module("dbaumann.message-socket", [])

.factory("WebSocket", ["$window", ($window) -> $window.WebSocket])

.provider("MessageSocket", ["$logProvider", ($logProvider) ->
  MESSAGE_TYPE = "$variant"
  @messageTypeKey = (key) -> MESSAGE_TYPE = key

  RECONNECT_TIMEOUT = 1000
  @reconnectTimeout = (millis) -> RECONNECT_TIMEOUT = millis

  MAX_RECONNECTS = 10
  @maxReconnects = (count) -> MAX_RECONNECTS = count

  DELAYED_QUEUE_SIZE = 25
  @delayedQueueSize = (size) -> DELAYED_QUEUE_SIZE = size
  
  @$get = ["$rootScope", "$timeout", "$window", "$log", "$q", "WebSocket",
    ($rootScope, $timeout, $window, $log, $q, WebSocket) ->

      class BoundedQueue
        constructor: (@queueSize) ->
          @items = []

        enqueue: (message) ->
          if(@items.length == @queueSize) then @items.pop()
          @items.unshift(message)

        dequeue: -> @items.pop()

        size: -> @items.length

      class AskContext
        constructor: (@messenger, @askMessage, @responseTimeout) ->
          @messageId = Date.now()
          @contextReceives = []
          @deferreds = []
          @tellSent = false

        ###*
         * Send a message upstream and await a response within a timeout.
         * Subsequent calls on the same AskContext are bound to the timeout of the initial call.
         * @param {string | array(string)} acceptable response message name(s)
         * @return $q.deferred of response message
        ###
        for: (responseNames) ->
          deferred = $q.defer()
          @deferreds.push(deferred)

          if(!@tellSent)
            @messenger.tell(@askMessage, @messageId)
            @tellSent = true

          @contextReceives.push(
            @messenger.receive(responseNames, (response) =>
              deferred.resolve(response)
              @contextReceives.forEach((cancel) -> cancel())
              $timeout.cancel(@timeoutPromise)
            )
          )
          if(!@timeoutPromise)
            @timeoutPromise = $timeout(=>
              @contextReceives.forEach((cancel) -> cancel())
              @deferreds.forEach((deferred) =>
                deferred.reject(new Error(
                  "[MessageSocket.AskTimedOut] Ask timeout for '#{@askMessage[MESSAGE_TYPE]}'" +
                  " elapsed after #{@responseTimeout} ms"
                ))
              )
            , @responseTimeout)

          deferred.promise

      class MessageSocket
        connected: false
        reconnects: 0

        connect: (url) ->
          @socket = new WebSocket(url)
          @socket.onopen = @onOpen
          @socket.onmessage = @onMessage
          @socket.onclose = (message) =>
            @connected = false
            if(!message.wasClean) then @reconnect(message)
          @socket.onerror = @onError
          @send = (message) -> @socket.send(message)

          $window.onbeforeunload = =>
            @socket.close()
            unless($logProvider.debugEnabled())
              "Your connection to this application is about to close."

        constructor: (url) ->
          @handlers = {}
          @outbox = new BoundedQueue(DELAYED_QUEUE_SIZE)

          @uniqueId = -> "_" + Math.random().toString(36).substr(2, 9)

          @onOpen = =>
            @connected = true
            @reconnects = 0

            $log.debug("MessageSocket opened.")
            if(@outbox.size())
              # todo throttle
              while(nextMessage = @outbox.dequeue())
                $log.debug("MessageSocket sent", nextMessage[MESSAGE_TYPE], nextMessage)
                @send(JSON.stringify(nextMessage))

          @onMessage = (message) =>
            json = angular.fromJson(message.data)
            $log.debug("MessageSocket received", json[MESSAGE_TYPE], json)
          
            if(@handlers[json[MESSAGE_TYPE]]?)
              for receiveId, handler of @handlers[json[MESSAGE_TYPE]]
                $rootScope.$apply(-> handler(json))

          @reconnect = (message) =>
            if(@reconnects == MAX_RECONNECTS)
              $rootScope.$emit("MessageSocket.disconnected", Date.now())
              unless($logProvider.debugEnabled())
                $window.alert("Your connection to this application has closed unexpectedly.")
            else
              # reconnect with binary exponential backoff, per section 7.2.3 of RFC 6455
              nextTimeout = Math.floor(Math.random() * Math.pow(2, @reconnects) * RECONNECT_TIMEOUT)
              $log.debug("MessageSocket closed unexpectedly. Reconnecting in #{nextTimeout} ms.")
              $timeout(=>
                @reconnects += 1
                @connect(url)
              , nextTimeout)

          @onError = (message) ->
            $log.debug("MessageSocket encountered an error", message)

          @connect(url)

        ###*
         * Register a callback for one or more messages.
         * @param {string | array(string)} message name(s)
         * @param {function} function which is passed the message upon receipt
         * @return function which removes the created callbacks
        ###
        receive: (messageNames, messageHandler) =>
          if(!angular.isFunction(messageHandler)) then throw Error("expected function")
          if(angular.isString(messageNames)) then messageNames = [messageNames]
          receiveId = @uniqueId()

          for messageName in messageNames
            if(!@handlers[messageName]?) then @handlers[messageName] = {}
            @handlers[messageName][receiveId] = messageHandler

          => delete @handlers[messageName][receiveId] for messageName in messageNames

        ###*
         * Send a message upstream.
         * @param {object} message contents, including a message type which may be identified with _ key
         * @return timestamp which was assigned to sent message
        ###
        tell: (message, messageId = null) ->
          if(message._)
            message[MESSAGE_TYPE] = message._
            delete message._
          if(!message[MESSAGE_TYPE]) then throw Error("Missing message type")

          message.stamp = if(messageId) then messageId else Date.now()

          if(!@connected)
            $log.debug("MessageSocket enqueued", message[MESSAGE_TYPE], message)
            @outbox.enqueue(message)
          else
            $log.debug("MessageSocket sent", message[MESSAGE_TYPE], message)
            @send(JSON.stringify(message))
          message.stamp

        ###*
         * Prepare to send a message upstream and await responses within a timeout.
         * @param {number} timeout in milliseconds
         * @return function (askMessage) -> AskContext
        ###
        withTimeout: (after) -> (askMessage) -> new AskContext(this, askMessage, after)
  ]

  undefined
])
