/* eslint-env mocha */

import dgram from 'dgram'

// A small fake UDP-server.
//

const FakeServer = function (options) {
  options = options || {}
  this.port = options.port || 8125
  this._socket = undefined
  this._packetsReceived = []
  this._expectedPackets = []
}

// Start the server and listen for messages.
//
FakeServer.prototype.start = function (cb) {
  const that = this
  this._socket = dgram.createSocket('udp4')
  this._socket.on('message', (msg, rinfo) => {
    msg.toString().split('\n').forEach((part) => {
      that._packetsReceived.push(part)
    })

    that.checkMessages()
  })

  this._socket.on('listening', cb)
  this._socket.bind(this.port)
}

// For closing server down after use.
//
FakeServer.prototype.stop = function () {
  this._socket.close()
  this._socket = undefined
}

// Expect `message` to arrive and call `cb` if/when it does.
//
FakeServer.prototype.expectMessage = function (message, cb) {
  const that = this
  this._expectedPackets.push({
    message,
    callback: cb
  })

  process.nextTick(() => {
    that.checkMessages()
  })
}

// Expect `message` to arrive and call `cb` if/when it does.
//
FakeServer.prototype.expectMessageRegex = function (message, cb) {
  const that = this
  this._expectedPackets.push({
    message,
    callback: cb
  })

  process.nextTick(() => {
    that.checkMessages(true)
  })
}

// Check for expected messages.
//
FakeServer.prototype.checkMessages = function (regex) {
  const that = this
  this._expectedPackets.forEach((details, detailIndex) => {
    let i
    if (regex) {
      // Is it in there?
      i = that._packetsReceived.indexOf(details.message)
      if (i !== -1) {
        // Remove message and the listener from their respective lists
        that._packetsReceived.splice(i, 1)
        that._expectedPackets.splice(detailIndex, 1)
        return details.callback()
      }
    } else {
      // Is it in there?
      i = that._packetsReceived.indexOf(details.message)
      if (i !== -1) {
        // Remove message and the listener from their respective lists
        that._packetsReceived.splice(i, 1)
        that._expectedPackets.splice(detailIndex, 1)
        return details.callback()
      }
    }
  })
}

export default FakeServer
