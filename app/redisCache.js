var redis = require("redis");
var bluebird = require("bluebird");
var msgpack = require("msgpackr");

var config = require("./config.js");
var utils = require("./utils.js");

var redisClient = null;
if (config.redisUrl) {
	bluebird.promisifyAll(redis.RedisClient.prototype);

	redisClient = redis.createClient({
		url: config.redisUrl,
		return_buffers: true
	});
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

						resolve(msgpack.unpack(result));
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

			redisClient.set(prefixedKey, msgpack.pack(obj), "PX", maxAgeMillis);
		}
	};
}

module.exports = {
	active: (redisClient != null),
	createCache: createCache
}
