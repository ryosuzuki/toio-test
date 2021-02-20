const { NearScanner } = require('@toio/scanner')
const munkres = require('munkres-js')
const fs = require('fs')
const config = require('config')

class Toio {
  constructor() {
    this.num = config.get('total_num')
    this.robot_ids = config.get('toio_ids')
    this.robots = []
    this.targets = []
    this.sleepTime = 100
    this.io = null
    this.height

    this.count = 0
    this.prev = {}

    this.minecraft = 0
  }

  newTarget() {
    this.targets = []
    for (let i = 0; i < this.num; i++) {
      let offset = Math.PI / 8 * this.count
      let theta = 2 * Math.PI / this.num
      this.targets.push({
        x: 100 * Math.cos(theta * i + offset) + 250,
        y: 100 * Math.sin(theta * i + offset) + 250,
        angle: 0,
      })
      /*
      this.targets.push({
        x: Math.round(Math.random() * 350) + 50,
        y: Math.round(Math.random() * 350) + 50,
        angle: Math.round(Math.random() * 360),
      })
      */
    }
    this.count++
    console.log(this.targets)
  }

  async init() {
    console.log('init')

    this.io.on('connection', (socket) => {
      console.log('socket-toio connected')

      socket.on('move', (data) => {
        data = this.parseJson(data)
        // console.log(data)
        // robots[0].target = { x: data.x, y: data.y }
        if (data && data.x && data.y) {
          this.targets = [
            { x: data.x, y: data.y, angle: 0, tick: 0 }
          ]
        }
        if (data && data.robots) {
          let targets = data.robots // from unity
          /*
          let targets = []
          for (let pos of data.robots) {
            if (50 < pos.x && pos.x < 450 && 50 < pos.y && pos.y < 450) {
              targets.push(pos)
            }
          }
          */
          this.targets = targets
          this.io.sockets.emit('targets', this.targets )
        }
      })

      socket.on('calibrate', (data) => {
        console.log(data)
        // this.io.sockets.emit('calibrate', data)
        this.io.emit('calibrate', data)
      })

    })

    return

    this.robots = await new NearScanner(this.num).start()
    for (let i = 0; i < this.num; i++) {
      const robot = await this.robots[i].connect()
      let index = this.robot_ids.findIndex(robot_id => {
        return robot_id === robot.id
      })
      robot.numId = index
      console.log(index)
    }
    console.log('toio connected')
    console.log(this.targets)
    console.log(this.robots.map(e => {
      return { numId: e.numId, id: e.id }
    }))

    this.height = parseFloat(fs.readFileSync('height.txt').toString())

    for (let robot of this.robots) {
      robot.turnOnLight({ durationMs: 0, red: 255, green: 0, blue: 255 })
      robot.on('id:position-id', data => {
        robot.x = data.x
        robot.y = data.y
        robot.angle = data.angle
        // console.log(robot.numId)
        // console.log(robot.x, robot.y, robot.angle)

        if (this.io) {
          let robots = this.robots.map((e) => {
            return { id: e.id, numId: e.numId, x: e.x, y: e.y, angle: e.angle}
          })
          this.io.sockets.emit('pos', { robots: robots, targets: this.targets })
        }
      })
    }

    let count = 0
    while (true) {
      try {
        this.loop()
        /*
        count++
        if (count > 10) {
          count = 0
          this.newTarget()
        }
        */
      } catch (err) {
        console.log(err)
      }
      await this.sleep(this.sleepTime) // 100
    }
  }

  parseJson(data) {
    try {
      data = JSON.parse(data)
    } catch (err) {
      return data
    }
    return data
  }

  loop() {
    let res = this.assign()
    let distMatrix = res.distMatrix
    let rids = res.rids
    let ids = munkres(distMatrix)
    for (let id of ids) {
      let targetId = id[0]
      let numId = rids[id[1]]
      let target = this.targets[targetId]
      this.move(numId, target)
      let tilt = false
      if (target.angle) {
        tilt = true
      }
      const data = {
        id: numId,
        target: target.tick,
        tilt: tilt,
      }
      // if (data.target) {
      //   reel.move(data)
      // }
      if (!data.target) continue
      const prev = this.prev[numId]
      if (prev && prev-50 < data.target && data.target < prev+50) continue

      // For house
      /*
      if (numId === 0) {
        console.log('reel-move', data.target)
        data.target = 2000
        this.io.sockets.emit('reel-move', data)
      }
      */
      console.log('reel-move', data.target)
      // this.io.sockets.emit('reel-move', data)
      this.prev[numId] = data.target
    }
  }

  assign() {
    let distMatrix = []
    let rids = []
    for (let target of this.targets) {
      let distArray = []
      for (let robot of this.robots) {
        if (!robot.x || !robot.y) continue
        let dx = target.x - robot.x
        let dy = target.y - robot.y
        let dist = Math.sqrt(dx*dx + dy*dy)
        distArray.push(dist)
        rids.push(robot.numId)
      }
      distMatrix.push(distArray)
    }
    if (!distMatrix.length) return
    return { distMatrix: distMatrix, rids: rids }
  }

  getRobotByNumId(numId) {
    return this.robots.filter((robot) => {
      return robot.numId == numId
    })[0]
  }

  async move(numId, target) {
    if (!target.angle) {
      target.angle = 0
    }
    let status = this.calculate(numId, target)
    let distThreshold = 1
    let dirThreshold = 45

    let angleDiff = (360 + status.angleDiff) % 180
    // console.log(rvo, dirThreshold)

    let calc = this.getDirection(status.diff, dirThreshold)
    let dist = status.dist
    let dir = calc.dir
    let diff = calc.diff

    let command

    let speed = 80 // 150
    const ratio = 1 - Math.abs(diff) / 90
    let rot = 0.5
    if (dist < 60) {
      // speed = dist // > 15 ? dist : 15
      speed = dist**2 / 4
      speed = speed > 40 ? 40 : speed
      // rot = 0.05
      rot = 0.2
    }

    if (dist < distThreshold) {
      return false
    }

    let angleThreshold = 10
    if(target.angle != 0 && dist < 20){
      // return false // stop
      if (angleDiff < angleThreshold) {
        return false // stop
      } else {
        dir = 'right'
        speed = 30
        rot = 0.35
      }
      if (180 - angleDiff < angleThreshold) {
        return false // stop
      } else {
        dir = 'left'
        speed = 30
        rot = 0.35
      }
    }


     // let ratio = 1 - Math.abs(diff) / 90
    // console.log(diff)
    switch (dir) {
      case 'forward':
        if (diff > 0) {
          // slightly turn right
          command = { left: speed, right: speed * ratio}
        } else {
          // slightly turn left
          command = { left: speed * ratio, right: speed}
        }
        break
      case 'backward':
        if (diff < 0) {
          // slightly turn right
          command = { left: -speed * ratio, right: -speed }
        } else {
          // slightly turn left
          command = { left: -speed, right: -speed * ratio}
        }
        break
      case 'left':
        command = { left: -speed * rot, right: speed * rot }
        break
      case 'right':
        command = { left:  speed * rot, right: -speed * rot }
        break
    }
    /*
    console.log(angleDiff)
    console.log(dir)
    console.log(command)
    */

    const robot = this.getRobotByNumId(numId) //this.robots[id]
    robot.move(command.left, command.right, this.sleepTime)
  }

  getDirection(diff, threshold) {
    if (0 <= diff && diff < threshold) {
      return { dir: 'forward', diff: diff }
    }
    if (threshold <= diff && diff < 90) {
      return { dir: 'right', diff: diff }
    }
    if (90 <= diff && diff < 180 - threshold) {
      return { dir: 'left', diff: 180 - diff }
    }
    if (180 - threshold <= diff && diff < 180 + threshold) {
      return { dir: 'backward', diff: 180 - diff }
    }
    if (180 + threshold <= diff && diff < 270) {
      return { dir: 'right', diff: diff - 180 }
    }
    if (270 <= diff && diff < 360 - threshold) {
      return { dir: 'left', diff: 360 - diff }
    }
    if (360 - threshold <= diff && diff <= 360) {
      return { dir: 'forward', diff: diff - 360 }
    }
  }

  async sleep(time) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, time)
    })
  }

  calculate(numId, target) {
    // const robot = this.robots[id]
    const robot = this.getRobotByNumId(numId)
    let dx = target.x - robot.x
    let dy = target.y - robot.y
    let dist = Math.sqrt(dx**2 + dy**2)
    let angleDiff = target.angle - robot.angle

    let dir = Math.atan2(dx, dy) * 180 / Math.PI
    dir = (-dir + 180) % 360
    let diff = Math.min((360) - Math.abs(robot.angle - dir), Math.abs(robot.angle - dir))
    // Example
    // * 1 - 359 = -358 < 0 && 358 > 180 -> -2
    // * 1 - 180 = -179 < 0 && 179 < 180 -> +179
    // * 15 - 1  =  14  > 0 && 14  < 180 -> -14
    // * 1 - 200 = -199 < 0 && 199 > 180 -> -161
    // * 359 - 1 =  358 > 0 && 358 > 180 -> +2
    if (robot.angle - dir < 0 && Math.abs(robot.angle - dir) > 180) {
      diff = -diff
    }
    if (robot.angle - dir > 0 && Math.abs(robot.angle - dir) < 180) {
      diff = -diff
    }
    diff = (diff + 360 - 90) % 360

    // angleDiff = (angleDiff + 180) % 180
    return { dist: dist, diff: diff, angleDiff: angleDiff }
  }


}

module.exports = Toio