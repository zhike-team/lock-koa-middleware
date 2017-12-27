const lock = require('../index')
const Redis = require('ioredis')
const redis = new Redis()
const Promise = require('bluebird')
const assert = require('assert')
const supertest = require('supertest')
const Koa = require('koa')
const Router = require('koa-router')
const router = new Router()
const bodyParser = require('koa-bodyparser')
const parallel = require('mocha.parallel')

const app = new Koa()
app.proxy = true
app.use(bodyParser())
app.use(router.routes())

function request() {
  return supertest(app.listen())
}

const lock1 = lock({
  redisClient: redis,
  expireMilliseconds: 1000, // keep 1 sec
  onAcquireFail: async (ctx, next) => {
    ctx.status = 400
    ctx.body = 'fail'
  }
})

router.all('/:id', lock1, ctx => {
  return Promise.delay(100) // cost 0.1 sec
    .then(() => {
      ctx.body = 'succeed'
    })
})

parallel('2nd should be blocked', function () {
  it('1st', function (done) {
    request()
      .post('/1')
      .expect(200, 'succeed', done)
  })

  it('2nd', function (done) {
    request()
      .post('/1')
      .expect(400, 'fail', done)
  })
})

parallel('2nd should pass', function () {
  it('1st', function (done) {
    request()
      .post('/2')
      .expect(200, 'succeed', done)
  })

  it('2nd', function (done) {
    Promise.delay(150)
      .then(() => {
        request()
          .post('/2')
          .expect(200, 'succeed', done)
      })
  })
})

parallel('params different', function () {
  it('1st', function (done) {
    request()
      .post('/1')
      .expect(200, 'succeed', done)
  })

  it('should block', function (done) {
    request()
      .post('/1')
      .expect(400, 'fail', done)
  })

  it('should pass', function (done) {
    request()
      .post('/1?param=1')
      .expect(200, 'succeed', done)
  })

  it('should pass', function (done) {
    request()
      .post('/1')
      .send({name: 'steve'})
      .expect(200, 'succeed', done)
  })
})
