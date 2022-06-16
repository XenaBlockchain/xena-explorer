var redis = require("redis");
var bluebird = require("bluebird");
var msgpack = require("msgpack-lite");
var Decimal = require("decimal.js");

var config = require("./config.js");
var utils = require("./utils.js");

var codec = msgpack.createCodec();
codec.addExtPacker(0x3F, Decimal, function(decimal) {
	return msgpack.encode(decimal.toNumber());
});
codec.addExtUnpacker(0x3F, function(buffer) {
	return new Decimal(msgpack.decode(buffer));
});

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

						resolve(msgpack.decode(result, {codec: codec}));
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

			redisClient.set(prefixedKey, msgpack.encode(obj, {codec: codec}), "PX", maxAgeMillis);
		}
	};
}

module.exports = {
	active: (redisClient != null),
	createCache: createCache
}