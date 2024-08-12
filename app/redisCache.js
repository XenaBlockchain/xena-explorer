import redis from "redis";
import bluebird from "bluebird";
import {unpack, pack} from "msgpackr";

import config from "./config.js";
import utils from "./utils.js";

let redisClient = null;
if (config.redisUrl) {
  bluebird.promisifyAll(redis.RedisClient.prototype);

  redisClient = redis.createClient(config.redisUrl,{return_buffers: true})
}

function createCache(keyPrefix, onCacheEvent) {
	return {
		get: function(key) {
			var prefixedKey = `${keyPrefix}-${key}`;

			return new Promise(function(resolve, reject) {
				onCacheEvent("redis", "try", prefixedKey);

				redisClient.getAsync(prefixedKey).then(function(result) {
					if (result == null) {
						onCacheEvent("redis", "miss", prefixedKey);

						resolve(null);

					} else {
						onCacheEvent("redis", "hit", prefixedKey);

						resolve(unpack(result));
					}
				}).catch(function(err) {
					onCacheEvent("redis", "error", prefixedKey);

					utils.logError("328rhwefghsdgsdss", err);

					reject(err);
				});
			});
		},
		set: function(key, obj, maxAgeMillis) {
			var prefixedKey = `${keyPrefix}-${key}`;

			redisClient.set(prefixedKey, pack(obj), "PX", maxAgeMillis);
		}
	};
}

export default{
	active: (redisClient != null),
	createCache
}
