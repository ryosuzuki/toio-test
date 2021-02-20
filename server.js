const dotenv = require('dotenv').config()
const express = require('express')
const socketio = require('socket.io')
const http = require('http')
const path = require('path')
const app = express()
const server = http.Server(app)
const io = socketio(server)

// const Toio = require('./libs/toio')
// const toio = new Toio()

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname + '/index.html'))
})

server.listen(3000, () => {
  console.log('listening on 3000')

  // toio.io = io
  // toio.init()
})