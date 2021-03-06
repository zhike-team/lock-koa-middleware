'use strict';
const crypto = require('crypto');

module.exports = (options) => {
  if (!(options instanceof Object)) {
    throw new Error('options must be an Object');
  }

  const redis = options.redisClient;
  if (typeof redis !== 'object') {
    throw new Error('options.redisClient must be an instance of ioredis(https://www.npmjs.com/package/ioredis)');
  }

  const timeout = options.expireMilliseconds;
  if (!(Number.isInteger(timeout) && timeout > 0)) {
    throw new Error('options.expireMilliseconds must be an integer greater than zero');
  }

  let keyFn = ctx => {
    let params = {
      query: ctx.query,
      body: ctx.request.body,
      params: ctx.params
    };

    const md5 = crypto.createHash('md5').update(JSON.stringify(params)).digest('hex');

    return `lock-koa-middleware:${ctx.path.replace(/\/$/, '')}:${md5}`;
  }
  if (options.keyGenerator) {
    if (typeof options.keyGenerator === 'function') {
      keyFn = options.keyGenerator;
    }
    else {
      throw new Error('options.keyGenerator must be a function which returns a string as redis key');
    }
  }

  let onAcquireFail = async (ctx, next) => {
    let err = new Error('Locked, try later');
    err.status = 429;
    throw err;
  }
  if (options.onAcquireFail) {
    if (typeof options.onAcquireFail === 'function') {
      onAcquireFail = options.onAcquireFail;
    }
    else {
      throw new Error('options.onAcquireFail must be a function which handles response when resource is locked');
    }
  }

  async function lock(redisKey, redisValue, timeout) {
    return redis.eval('return redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2])', 1, redisKey, redisValue, timeout);
  }

  async function unlock(redisKey, redisValue) {
    return redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, redisKey, redisValue);
  }

  return async (ctx, next) => {
    const redisKey = keyFn(ctx);
    const redisValue = Math.random();

    try {
      let ok = await lock(redisKey, redisValue, timeout);
      if(ok){ // ok === 'OK'
        await next();
      }
      else{
        await onAcquireFail(ctx, next);
      }
    }
    finally {
      await unlock(redisKey, redisValue);
    }
  }
}
