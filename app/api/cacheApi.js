import global from "../global.js";
import config from "../config.js";
import LRU from "lru-cache";
import redisCache from "../redisCache.js";
import md5 from "md5";
import utils from "../utils.js";

global.cacheStats = {};
// this value should be incremented whenever data format changes, to avoid
// pulling old-format data from a persistent cache
var cacheKeyVersion = "v1";

const ONE_SEC = 1000;
const ONE_MIN = 60 * ONE_SEC;
const ONE_HR = 60 * ONE_MIN;
const FIVE_MINUTES = 5 * ONE_MIN;
const ONE_DAY = 24 * ONE_HR;
const ONE_YR = 265 * ONE_DAY;



function createMemoryLruCache(cacheObj, onCacheEvent) {
	return {
		get:function(key) {
			return new Promise(function(resolve, reject) {
				onCacheEvent("memory", "try", key);

				var val = cacheObj.get(key);

				if (val != null) {
					onCacheEvent("memory", "hit", key);

				} else {
					onCacheEvent("memory", "miss", key);
				}

				resolve(cacheObj.get(key));
			});
		},
		set:function(key, obj, maxAge) { cacheObj.set(key, obj, maxAge); }
	}
}

async function tryCache(cacheKey, cacheObjs, index) {
	if (index === cacheObjs.length) {
		return null;
	}

	const result = await cacheObjs[index].get(cacheKey);

	if (result !== null) {
		return result;
	} else {
		return tryCache(cacheKey, cacheObjs, index + 1);
	}
}

function createTieredCache(cacheObjs) {
	return {
		get: async function (key) {
			return await tryCache(key, cacheObjs, 0);
		},

		set: function (key, obj, maxAge) {
			for (let i = 0; i < cacheObjs.length; i++) {
				cacheObjs[i].set(key, obj, maxAge);
			}
		},

		append: async function (key, obj, maxAge) {
			let result = await tryCache(key, cacheObjs, 0);
			result = Array.isArray(result) && result.length > 0 ? [...result, obj] : [obj];

			for (let i = 0; i < cacheObjs.length; i++) {
				cacheObjs[i].set(key, result, maxAge);
			}
		},

		prepend: async function (key, obj, maxAge) {
			let result = await tryCache(key, cacheObjs, 0);
			result = Array.isArray(result) && result.length > 0 ? [obj, ...result] : [obj];

			for (let i = 0; i < cacheObjs.length; i++) {
				cacheObjs[i].set(key, result, maxAge);
			}
		},
		updateOrAppend: async function (cacheKey, obj, objKey, objKeyValue, maxAge) {
			let result = await tryCache(cacheKey, cacheObjs, 0);
			if (Array.isArray(result) && result.length > 0) {
				const foundIndex = result.findIndex((element) => element[objKey] == objKeyValue);
				if (foundIndex !== -1) {
					result[foundIndex] = obj
				} else {
					result.push(obj);
				}
			} else {
				result = [];
				result.push(obj);
			}

			for (let i = 0; i < cacheObjs.length; i++) {
				cacheObjs[i].set(cacheKey, result, maxAge);
			}
		}
	}
}




var miscCaches = [];
var blockCaches = [];
var txCaches = [];
var marketDataCaches = [];
var ipAddressCaches = [];

if (!config.noInmemoryRpcCache) {
	global.cacheStats.memory = {
		try: 0,
		hit: 0,
		miss: 0
	};

	var onMemoryCacheEvent = function(cacheType, eventType, cacheKey) {
		if(!('memory' in global.cacheStats)) {
			global.cacheStats.memory = {
				try: 0,
				hit: 0,
				miss: 0
			};
		}
		global.cacheStats.memory[eventType]++;
	}

	miscCaches.push(createMemoryLruCache(new LRU(2000), onMemoryCacheEvent));
	blockCaches.push(createMemoryLruCache(new LRU(2000), onMemoryCacheEvent));
	txCaches.push(createMemoryLruCache(new LRU(10000), onMemoryCacheEvent));
	marketDataCaches.push(createMemoryLruCache(new LRU( 10000), onMemoryCacheEvent));
	ipAddressCaches.push(createMemoryLruCache(new LRU( 10000), onMemoryCacheEvent));
}

if (redisCache.active) {
	global.cacheStats.redis = {
		try: 0,
		hit: 0,
		miss: 0,
		error: 0
	};

	var onRedisCacheEvent = function(cacheType, eventType, cacheKey) {
		if(!('redis' in global.cacheStats)) {
			global.cacheStats.redis = {
				try: 0,
				hit: 0,
				miss: 0
			};
		}
		global.cacheStats.redis[eventType]++;
	}

	// md5 of the active RPC credentials serves as part of the key; this enables
	// multiple instances of btc-rpc-explorer (eg mainnet + testnet) to share
	// a single redis instance peacefully
	var rpcHostPort = `${config.credentials.rpc.host}:${config.credentials.rpc.port}`;
	var rpcCredKeyComponent = md5(JSON.stringify(config.credentials.rpc)).substring(0, 8);

	var redisCacheObj = redisCache.createCache(`${cacheKeyVersion}-${rpcCredKeyComponent}`, onRedisCacheEvent);

	miscCaches.push(redisCacheObj);
	blockCaches.push(redisCacheObj);
	txCaches.push(redisCacheObj);
	marketDataCaches.push(redisCacheObj)
	ipAddressCaches.push(redisCacheObj)
}

var miscCache = createTieredCache(miscCaches);
var blockCache = createTieredCache(blockCaches);
var txCache = createTieredCache(txCaches);
var marketCache = createTieredCache(marketDataCaches)
var ipAddressCache = createTieredCache(ipAddressCaches)

async function tryCacheThenCallFunction(cache, cacheKey, cacheMaxAge, functionToCall, cacheConditionFunction) {
	if (cacheConditionFunction == null) {
		cacheConditionFunction = function(obj) {
			return true;
		};

		try {
			const cacheResult = await cache.get(cacheKey);
			if (cacheResult != null) {
				return cacheResult;
			}

			const functionResult = await functionToCall();

			if (functionResult != null && cacheConditionFunction(functionResult)) {
				cache.set(cacheKey, functionResult, cacheMaxAge);
			}

			return functionResult;
		} catch (err) {
			throw err;
		}
	}
}

function tryCacheThenRpcApi(cache, cacheKey, cacheMaxAge, rpcApiFunction, cacheConditionFunction) {

	if (cacheConditionFunction == null) {
		cacheConditionFunction = function(obj) {
			return true;
		};
	}

	return new Promise(function(resolve, reject) {
		var cacheResult = null;

		var finallyFunc = function() {
			if (cacheResult != null) {
				resolve(cacheResult);

			} else {
				rpcApiFunction().then(function(rpcResult) {
					if (rpcResult != null && cacheConditionFunction(rpcResult)) {
						cache.set(cacheKey, rpcResult, cacheMaxAge);
					}

					resolve(rpcResult);

				}).catch(function(err) {
					reject(err);
				});
			}
		};

		cache.get(cacheKey).then(function(result) {
			cacheResult = result;

			finallyFunc();

		}).catch(function(err) {
			utils.logError("nds9fc2eg621tf3", err, {cacheKey:cacheKey});

			finallyFunc();
		});
	});
}

export default {
	ONE_SEC,
	ONE_MIN,
	ONE_HR,
	FIVE_MINUTES,
	ONE_DAY,
	ONE_YR,
	miscCache,
	blockCache,
	txCache,
	marketCache,
	ipAddressCache,
	tryCacheThenCallFunction,
	tryCacheThenRpcApi,
}
