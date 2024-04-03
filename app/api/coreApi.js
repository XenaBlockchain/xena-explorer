import debug from "debug";

const debugLog = debug("nexexp:core");

import LRU from "lru-cache";
import fs from 'fs';

import utils from "../utils.js";
import config from "../config.js";
import coins from "../coins.js";
import redisCache from "../redisCache.js";
import Decimal from "decimal.js";
import nexaaddr from 'nexaaddrjs'
import axios from 'axios';
import md5 from "md5";
import NexCore from 'nexcore-lib'

// choose one of the below: RPC to a node, or mock data while testing
import rpcApi from "./rpcApi.js";
import electrumAddressApi from "../api/electrumAddressApi.js";
// import { reject } from "bluebird"; // Uncomment if needed

// var rpcApi = require("./mockApi.js"); // Comment out or remove this line
import global from "../global.js";
global.cacheStats = {};
global.tokenIcons = [];
// this value should be incremented whenever data format changes, to avoid
// pulling old-format data from a persistent cache
var cacheKeyVersion = "v1";


const ONE_SEC = 1000;
const ONE_MIN = 60 * ONE_SEC;
const ONE_HR = 60 * ONE_MIN;
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
var tokenCaches = [];

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
	tokenCaches.push(createMemoryLruCache(new LRU (10000), onMemoryCacheEvent));
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
	tokenCaches.push(redisCacheObj);
}

var miscCache = createTieredCache(miscCaches);
var blockCache = createTieredCache(blockCaches);
var txCache = createTieredCache(txCaches);
var tokenCache = createTieredCache(tokenCaches);




function getGenesisBlockHash() {
	return coins[config.coin].genesisBlockHashesByNetwork[global.activeBlockchain];
}

function getGenesisCoinbaseTransactionId() {
	return coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain];
}

function getTokenGenesis(token) {
	return tryCacheThenElectrum(tokenCache, "getTokenGenesis-" + token, ONE_YR, electrumAddressApi.getTokenGenesis(token));
}

async function tryCacheThenElectrum(cache, cacheKey, cacheMaxAge, electrumApiFunction, cacheConditionFunction) {
    if (cacheConditionFunction == null) {
        cacheConditionFunction = function(obj) {
            return true;
        };
    }

    try {
        const cacheResult = await cache.get(cacheKey);
        
        if (cacheResult != null) {
            return cacheResult;
        }

        const electrumResult = await electrumApiFunction;

        if (electrumResult != null && cacheConditionFunction(electrumResult)) {
            cache.set(cacheKey, electrumResult, cacheMaxAge);
        }

        return electrumResult;
    } catch (err) {
        throw err;
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

function shouldCacheTransaction(tx) {
	if (!tx.confirmations) {
		return false;
	}

	if (tx.confirmations < 1) {
		return false;
	}

	if (tx.vin != null && tx.vin.length > 9) {
		return false;
	}

	return true;
}


function getBlockCount() {
	return tryCacheThenRpcApi(miscCache, "getBlockCount", 10 * ONE_SEC, rpcApi.getBlockCount);
}

function getBlockchainInfo() {
	return tryCacheThenRpcApi(miscCache, "getBlockchainInfo", 10 * ONE_SEC, rpcApi.getBlockchainInfo);
}

function getNetworkInfo() {
	return tryCacheThenRpcApi(miscCache, "getNetworkInfo", 10 * ONE_SEC, rpcApi.getNetworkInfo);
}

function getNetTotals() {
	return tryCacheThenRpcApi(miscCache, "getNetTotals", 10 * ONE_SEC, rpcApi.getNetTotals);
}

function getTxpoolInfo() {
	return tryCacheThenRpcApi(miscCache, "getTxpoolInfo", ONE_SEC, rpcApi.getTxpoolInfo);
}

function getTxpoolTxids() {
	// no caching, that would be dumb
	return rpcApi.getTxpoolTxids();
}

function getMiningInfo() {
	return tryCacheThenRpcApi(miscCache, "getMiningInfo", 30 * ONE_SEC, rpcApi.getMiningInfo);
}

function getUptimeSeconds() {
	return tryCacheThenRpcApi(miscCache, "getUptimeSeconds", ONE_SEC, rpcApi.getUptimeSeconds);
}

function getChainTxStats(blockCount) {
	return tryCacheThenRpcApi(miscCache, "getChainTxStats-" + blockCount, 20 * ONE_MIN, function() {
		return rpcApi.getChainTxStats(blockCount);
	});
}

function getNetworkHashrate(blockCount) {
	return tryCacheThenRpcApi(miscCache, "getNetworkHashrate-" + blockCount, 20 * ONE_MIN, function() {
		return rpcApi.getNetworkHashrate(blockCount);
	});
}

function getBlockStats(hash_or_height) {
	return tryCacheThenRpcApi(miscCache, "getBlockStats-" + hash_or_height, ONE_YR, function() {
		return rpcApi.getBlockStats(hash_or_height);
	});
}

function decodeScript(hex) {
	return tryCacheThenRpcApi(miscCache, "decodeScript-" + hex, 1000 * 60 * 1000, function() {
		return rpcApi.decodeScript(hex);
	});
}

function getTokenMintage(token) {
	return tryCacheThenRpcApi(miscCache, "getTokenMintage-" + token,  20 * ONE_MIN, function() {
		return rpcApi.tokenMintage(token);
	});
}

function getTransactions(txids, cacheSpan=ONE_HR) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		for (var i = 0; i < txids.length; i++) {
			promises.push(getTransaction(txids[i], cacheSpan));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTransaction(tx) {
	return tryCacheThenRpcApi(miscCache, "gettransaction-" + tx, 1000 * 60 * 1000, function() {
		return rpcApi.getTransaction(tx);
	}); 
}

function decodeRawTransaction(hex) {
	return tryCacheThenRpcApi(miscCache, "decodeRawTransaction-" + hex, 1000 * 60 * 1000, function() {
		return rpcApi.decodeRawTransaction(hex);
	});
}

function getUtxoSetSummary() {
	return tryCacheThenRpcApi(miscCache, "getUtxoSetSummary", 15 * ONE_MIN, rpcApi.getUtxoSetSummary);
}

function getTxCountStats(dataPtCount, blockStart, blockEnd) {
	return new Promise(function(resolve, reject) {
		var dataPoints = dataPtCount;

		getBlockchainInfo().then(function(getblockchaininfo) {
			if (typeof blockStart === "string") {
				if (["genesis", "first", "zero"].includes(blockStart)) {
					blockStart = 0;
				}
			}

			if (typeof blockEnd === "string") {
				if (["latest", "tip", "newest"].includes(blockEnd)) {
					blockEnd = getblockchaininfo.blocks;
				}
			}

			if (blockStart > blockEnd) {
				reject(`Error 37rhw0e7ufdsgf: blockStart (${blockStart}) > blockEnd (${blockEnd})`);

				return;
			}

			if (blockStart < 0) {
				blockStart += getblockchaininfo.blocks;
			}

			if (blockEnd < 0) {
				blockEnd += getblockchaininfo.blocks;
			}

			var chainTxStatsIntervals = [];
			for (var i = 0; i < dataPoints; i++) {
				chainTxStatsIntervals.push(parseInt(Math.max(10, getblockchaininfo.blocks - blockStart - i * (blockEnd - blockStart) / (dataPoints - 1) - 1)));
			}

			var promises = [];
			for (var i = 0; i < chainTxStatsIntervals.length; i++) {
				promises.push(getChainTxStats(chainTxStatsIntervals[i]));
			}

			Promise.all(promises).then(function(results) {
				if (results[0].name == "RpcError" && results[0].code == -8) {
					// recently started node - no meaningful data to return
					resolve(null);

					return;
				}

				var txStats = {
					txCounts: [],
					txLabels: [],
					txRates: []
				};

				for (var i = results.length - 1; i >= 0; i--) {
					if (results[i].window_tx_count) {
						txStats.txCounts.push( {x:(getblockchaininfo.blocks - results[i].window_block_count), y: (results[i].txcount - results[i].window_tx_count)} );
						txStats.txRates.push( {x:(getblockchaininfo.blocks - results[i].window_block_count), y: (results[i].txrate)} );
						txStats.txLabels.push(i);
					}
				}
				
				resolve({txCountStats:txStats, getblockchaininfo:getblockchaininfo, totalTxCount:results[0].txcount});

			}).catch(function(err) {
				reject(err);
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getPeerSummary() {
	return new Promise(function(resolve, reject) {
		tryCacheThenRpcApi(miscCache, "getpeerinfo", ONE_SEC, rpcApi.getPeerInfo).then(function(getpeerinfo) {
			var result = {};
			result.getpeerinfo = getpeerinfo;

			result.getpeerinfo_has_mapped_as = getpeerinfo.length > 0 && "mapped_as" in getpeerinfo[0];

			var versionSummaryMap = {};
			for (var i = 0; i < getpeerinfo.length; i++) {
				var x = getpeerinfo[i];

				if (versionSummaryMap[x.subver] == null) {
					versionSummaryMap[x.subver] = 0;
				}

				versionSummaryMap[x.subver]++;
			}

			var versionSummary = [];
			for (var prop in versionSummaryMap) {
				if (versionSummaryMap.hasOwnProperty(prop)) {
					versionSummary.push([prop, versionSummaryMap[prop]]);
				}
			}

			versionSummary.sort(function(a, b) {
				if (b[1] > a[1]) {
					return 1;

				} else if (b[1] < a[1]) {
					return -1;

				} else {
					return a[0].localeCompare(b[0]);
				}
			});



			var servicesSummaryMap = {};
			for (var i = 0; i < getpeerinfo.length; i++) {
				var x = getpeerinfo[i];

				if (servicesSummaryMap[x.services] == null) {
					servicesSummaryMap[x.services] = 0;
				}

				servicesSummaryMap[x.services]++;
			}

			var servicesSummary = [];
			for (var prop in servicesSummaryMap) {
				if (servicesSummaryMap.hasOwnProperty(prop)) {
					servicesSummary.push([prop, servicesSummaryMap[prop]]);
				}
			}

			servicesSummary.sort(function(a, b) {
				if (b[1] > a[1]) {
					return 1;

				} else if (b[1] < a[1]) {
					return -1;

				} else {
					return a[0].localeCompare(b[0]);
				}
			});



			result.versionSummary = versionSummary;
			result.servicesSummary = servicesSummary;

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxpoolDetails(start, count) {
	return new Promise(function(resolve, reject) {
		tryCacheThenRpcApi(miscCache, "getTxpoolTxids", ONE_SEC, rpcApi.getTxpoolTxids).then(function(resultTxids) {
			var txids = [];

			for (var i = start; (i < resultTxids.length && i < (start + count)); i++) {
				txids.push(resultTxids[i]);
			}

			getRawTransactionsWithInputs(txids, config.site.txMaxInput).then(function(result) {
				resolve({ txCount:resultTxids.length, transactions:result.transactions, txInputsByTransaction:result.txInputsByTransaction });
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockInt(hash_or_height)
{
	return new Promise(function(resolve, reject) {
		rpcApi.getBlock(hash_or_height).then(function(block) {
			getRawTransaction(block.txid[0]).then(function(tx) {
				block.coinbaseTx = tx;
				block.totalFees = utils.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(tx, block.height);
				block.subsidy = global.coinConfig.blockRewardFunction(block.height, global.activeBlockchain);
				if (block.nTx === undefined)
					block.nTx = block.txid.length;
				resolve(block);
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getBlockCached(hash_or_height, full = false) {
	if (!full) {
		return tryCacheThenRpcApi(blockCache, "getBlock-" + hash_or_height, ONE_YR, function() {
			return new Promise(function(resolve, reject) {
				getBlockInt(hash_or_height).then(function(block) {
					block.txid.length = 1; // only keep the coinbase TX when caching the result
					resolve(block);
				}).catch(function(err) {
					reject(err);
				});
			});
		});
	} else {
		return getBlockInt(hash_or_height);
	}
}

function getBlock(blockHash, full = false) {
	return new Promise(function(resolve, reject) {
		getBlockCached(blockHash, full).then(function(block) {
			block.miner = utils.getMinerFromCoinbaseTx(block.coinbaseTx); // do not cache miner info
			resolve(block);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlocks(blockHashes, full = false) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHashes.map(h => getBlock(h, full))).then(function(blocks) {
			resolve(blocks);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockByHeight(blockHeight, full = false) {
	if (!config.blockByHeightSupport) {
		return new Promise(function(resolve, reject) {
			rpcApi.getBlockHash(blockHeight).then(function(blockhash) {
				getBlock(blockhash, full).then(function(block) {
					resolve(block);
				}).catch(function(err) {
					reject(err);
				});
			}).catch(function(err) {
				reject(err);
			});
		});
	} else {
		return getBlock(blockHeight, full);
	}
}

function getBlocksByHeight(blockHeights, full = false) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockByHeight(h, full))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockHeader(blockHash) {
	return tryCacheThenRpcApi(blockCache, "getBlockHeader-" + blockHash, ONE_YR, function() {
		return rpcApi.getBlockHeader(blockHash);
	});
}

function getBlockHeaderByHeight(blockHeight) {
	return tryCacheThenRpcApi(blockCache, "getBlockHeader-" + blockHeight, ONE_YR, function() {
		return rpcApi.getBlockHeader(blockHeight);
	});
}

function getBlockHeadersByHeight(blockHeights) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockHeaderByHeight(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlocksStats(blockHashes) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHashes.map(h => getBlockStats(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getBlocksStatsByHeight(blockHeights) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockStats(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getMiningCandidate(args = {}) {
	return tryCacheThenRpcApi(miscCache, "getMiningCandidate", ONE_MIN, function() {
		return rpcApi.getMiningCandidate(args);
	});
}

function getRawTransaction(txid, cacheSpan=ONE_HR) {
	var rpcApiFunction = function() {
		return rpcApi.getRawTransaction(txid);
	};

	return tryCacheThenRpcApi(txCache, "getRawTransaction-" + txid, cacheSpan, rpcApiFunction, shouldCacheTransaction);
}

/*
 * This function pulls raw tx data and then summarizes the outputs. It's used in memory-constrained situations.
 */
function getSummarizedTransactionOutput(outpoint, txid, cacheSpan=ONE_HR) {
	var rpcApiFunction = function() {
		return new Promise(function(resolve, reject) {
			rpcApi.getRawTransaction(outpoint, cacheSpan).then(function(rawTx) {
				var vout = {};
				for (const v of rawTx.vout) {
					if (v.outpoint == outpoint) {vout = v}
				}
				if (vout.scriptPubKey) {
					if (vout.scriptPubKey.asm) {
						delete vout.scriptPubKey.asm;
					}

					if (vout.scriptPubKey.hex) {
						delete vout.scriptPubKey.hex;
					}

				}

				vout.txid = rawTx.txid;
				vout.txidem = rawTx.txidem;
				vout.utxoTime = rawTx.time;

				if (rawTx.vin.length == 0) {
					vout.coinbaseSpend = true;
				}

				resolve(vout);

			}).catch(function(err) {
				reject(err);
			});
		});
	};

	return tryCacheThenRpcApi(txCache, `txoSummary-${txid}-${outpoint}`, cacheSpan, rpcApiFunction, function() { return true; });
}

function getTxUtxos(tx) {
	return new Promise(function(resolve, reject) {
		var promises = [];

		for (var i = 0; i < tx.vout.length; i++) {
			promises.push(getUtxo(tx.txidem, i));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getUtxo(txid, outputIndex) {
	return new Promise(function(resolve, reject) {
		tryCacheThenRpcApi(miscCache, "utxo-" + txid + "-" + outputIndex, ONE_HR, function() {
			return rpcApi.getUtxo(txid, outputIndex);

		}).then(function(result) {
			// to avoid cache misses, rpcApi.getUtxo returns "0" instead of null
			if (typeof result == "string" && result == "0") {
				resolve(null);

				return;
			}

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxpoolTxDetails(txid, includeAncDec) {
	return tryCacheThenRpcApi(miscCache, "txpoolTxDetails-" + txid + "-" + includeAncDec, ONE_HR, function() {
		return rpcApi.getTxpoolTxDetails(txid, includeAncDec);
	});
}

function getAddress(address) {
	return tryCacheThenRpcApi(miscCache, "getAddress-" + address, ONE_HR, function() {
		return rpcApi.getAddress(address);
	});
}

function getRawTransactions(txids, cacheSpan=ONE_HR) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		for (var i = 0; i < txids.length; i++) {
			promises.push(getRawTransaction(txids[i], cacheSpan));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function buildBlockAnalysisData(blockHeight, txids, txIndex, results, callback) {
	if (txIndex >= txids.length) {
		callback();

		return;
	}

	var txid = txids[txIndex];

	getRawTransactionsWithInputs([txid]).then(function(txData) {
		results.push(summarizeBlockAnalysisData(blockHeight, txData.transactions[0], txData.txInputsByTransaction[txid]));

		buildBlockAnalysisData(blockHeight, txids, txIndex + 1, results, callback);
	});
}

function summarizeBlockAnalysisData(blockHeight, tx, inputs) {
	var txSummary = {};

	txSummary.txid = tx.txid;
	txSummary.version = tx.version;
	txSummary.size = tx.size;

	if (tx.vin.lenght = 0) {
		txSummary.coinbase = true;
	}

	txSummary.vin = [];
	txSummary.totalInput = new Decimal(0);

	if (txSummary.coinbase) {
		var subsidy = global.coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

		txSummary.totalInput = txSummary.totalInput.plus(new Decimal(subsidy));

		txSummary.vin.push({
			coinbase: true,
			value: subsidy
		});

	} else {
		for (var i = 0; i < tx.vin.length; i++) {
			var vin = tx.vin[i];
			var inputVout = inputs[i];

			txSummary.totalInput = txSummary.totalInput.plus(new Decimal(inputVout.value));

			txSummary.vin.push({
				txid: tx.vin[i].txid,
				vout: tx.vin[i].vout,
				sequence: tx.vin[i].sequence,
				value: inputVout.value,
				type: inputVout.scriptPubKey.type,
				reqSigs: inputVout.scriptPubKey.reqSigs,
				addressCount: (inputVout.scriptPubKey.addresses ? inputVout.scriptPubKey.addresses.length : 0)
			});
		}
	}


	txSummary.vout = [];
	txSummary.totalOutput = new Decimal(0);

	for (var i = 0; i < tx.vout.length; i++) {
		txSummary.totalOutput = txSummary.totalOutput.plus(new Decimal(tx.vout[i].value));

		txSummary.vout.push({
			value: tx.vout[i].value,
			type: tx.vout[i].scriptPubKey.type,
			reqSigs: tx.vout[i].scriptPubKey.reqSigs,
			addressCount: tx.vout[i].scriptPubKey.addresses ? tx.vout[i].scriptPubKey.addresses.length : 0
		});
	}

	if (txSummary.coinbase) {
		txSummary.totalFee = new Decimal(0);
	} else {
		txSummary.totalFee = txSummary.totalInput.minus(txSummary.totalOutput);
	}

	return txSummary;
}

function getRawTransactionsWithInputs(txids, maxInputs=-1, cacheSpan=ONE_HR) {
	return new Promise(function(resolve, reject) {
		getRawTransactions(txids, cacheSpan).then(function(transactions) {
			var maxInputsTracked = config.site.txMaxInput;

			// FIXME need to make this magic number a parameter
			if (maxInputs <= 0) {
				maxInputsTracked = 1000000;
			} else if (maxInputs > 0) {
				maxInputsTracked = maxInputs;
			}

			var vinIds = [];
			for (var i = 0; i < transactions.length; i++) {
				var transaction = transactions[i];
				// try to determine if the query has been done by txid or txidem
				if (transaction.txidem == txids[i]) {
					transactions[i].searchByIdem = true;
				} else {
					transactions[i].searchByIdem = false;
				}

				if (transaction && transaction.vin) {
					for (var j = 0; j < Math.min(maxInputsTracked, transaction.vin.length); j++) {
						if (transaction.vin[j].outpoint) {
							vinIds.push({outpoint:transaction.vin[j].outpoint, txid:transaction.txid});
						}
					}
				}
			}

			var promises = [];

			for (var i = 0; i < vinIds.length; i++) {
				var vinId = vinIds[i];

				// we are actually fetching data about inputs of this transaction
				// by looking at the parent transaction of each inputs
				promises.push(getSummarizedTransactionOutput(vinId.outpoint, vinId.txid, cacheSpan));
			}

			Promise.all(promises).then(function(promiseResults) {
				var summarizedTxOutputs = {};
				for (var i = 0; i < promiseResults.length; i++) {
					var summarizedTxOutput = promiseResults[i];
					summarizedTxOutputs[`${summarizedTxOutput.outpoint}`] = summarizedTxOutput;
				}

				var txInputsByTransaction = {};

				transactions.forEach(function(tx) {
					txInputsByTransaction[tx.txid] = {};
					txInputsByTransaction[tx.txidem] = {};
					if (tx && tx.vin) {
						for (var i = 0; i < Math.min(maxInputsTracked, tx.vin.length); i++) {
							var summarizedTxOutput = summarizedTxOutputs[`${tx.vin[i].outpoint}`];
							if (summarizedTxOutput) {
								txInputsByTransaction[tx.txidem][i] = summarizedTxOutput;
								txInputsByTransaction[tx.txid][i] = summarizedTxOutput;
							}
						}
					}
				});

				resolve({ transactions:transactions, txInputsByTransaction:txInputsByTransaction });
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockByHashWithTransactions(blockHash, txLimit, txOffset) {
	return new Promise(function(resolve, reject) {
		getBlock(blockHash, true).then(function(block) {
			var txids = [];

			if (txOffset > 0) {
				txids.push(block.txid[0]);
			}

			for (var i = txOffset; i < Math.min(txOffset + txLimit, block.txid.length); i++) {
				txids.push(block.txid[i]);
			}

			getRawTransactionsWithInputs(txids, config.site.txMaxInput).then(function(txsResult) {
				if (txsResult.transactions && txsResult.transactions.length > 0) {
					block.coinbaseTx = txsResult.transactions[0];
					block.totalFees = utils.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(block.coinbaseTx, block.height);
					block.miner = utils.getMinerFromCoinbaseTx(block.coinbaseTx);
				}

				// if we're on page 2, we don't really want the coinbase tx in the tx list anymore
				if (txOffset > 0) {
					txsResult.transactions.shift();
				}

				resolve({ getblock:block, transactions:txsResult.transactions, txInputsByTransaction:txsResult.txInputsByTransaction });
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRecentBlocksMinimalData(count) {
	return new Promise(function(resolve, reject) {
		getBlockchainInfo().then(function(getblockchaininfo) {
			// Get all the block heights we will display
			var blockHeights = Array.from({length: 10})
				.map((_, i) => getblockchaininfo.blocks - i)
				.filter(h => h >= 0 && h <= getblockchaininfo.blocks);

			var promises = [];
			promises.push(getBlocksByHeight(blockHeights));

			Promise.all(promises).then(function(promiseResults) {
				var blocks = promiseResults[0];
				var data = blockHeights.map((h, i) => {
					var minimalData = [blocks[i].height, blocks[i].time, blocks[i].hash];
					return minimalData;
				});

				resolve({"blocks": data});
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

const getBlockListDefaultArgs = {
	limit: config.site.browseBlocksPageSize,
	offset: 0,
	sort: 'desc'
};

function getBlockList(args)
{
	args = Object.assign(Object.assign({}, getBlockListDefaultArgs), args);

	return new Promise(function(resolve, reject) {
		getBlockchainInfo().then(function(getblockchaininfo) {
			var sortDesc = args.sort == 'desc';

			// Get all the block heights we will display
			var blockHeights = Array.from({length: args.limit})
				.map((_, i) => sortDesc ? (getblockchaininfo.blocks - args.offset - i) : (args.offset + i))
				.filter(h => h >= 0 && h <= getblockchaininfo.blocks);

			// hack: default regtest node returns getblockchaininfo.blocks=0, despite having a genesis block
			if (global.activeBlockchain == "regtest" && blockHeights.length < 1)
				blockHeights.push(0);

			// Check if we can fetch an extra block height for time difference calculation
			var hasExtraElement = false;
			var extraElement = sortDesc ? getblockchaininfo.blocks - args.offset - args.limit : args.offset - 1;
			if (extraElement >= 0) {
				if (sortDesc)
					blockHeights.push(extraElement);
				else
					blockHeights.unshift(extraElement);
				hasExtraElement = true;
			}

			//FIXME: remove map since we just need to iterate over the array of heights
			Promise.all(blockHeights.map(h => h)).then(function(blockHashes) {
				var promises = [];
				promises.push(getBlocks(blockHashes));
				promises.push(getBlocksStats(blockHashes));

				Promise.all(promises).then(function(promiseResults) {
					var blocks = promiseResults[0];
					var blockstats = promiseResults[1];
					var data = blockHeights.map((h, i) => {
						var res = blocks[i];
						if (blockstats) {
							res.stats = blockstats[i];
							res.stats.volume = res.stats.total_out + res.stats.subsidy + res.stats.totalfee;
						}
						return res;
					});

					// Calculate time deltas
					var prevIdx = sortDesc ? 1 : -1;
					data.forEach((d, i) => { if (data[i + prevIdx]) d.timeDiff = d.time - data[i + prevIdx].time });

					// Remove extra element from the beginning/end if we have one
					if (hasExtraElement) {
						if (sortDesc)
							data.length = data.length - 1;
						else
							data = data.slice(1)
					}

					resolve({ blockList: data, blockListArgs: args, hasBlockStats: !!blockstats, blockChainInfo: getblockchaininfo });
				}).catch(function(err) {
					debugLog(err);
					reject(err);
				});
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getHelp() {
	return new Promise(function(resolve, reject) {
		tryCacheThenRpcApi(miscCache, "getHelp", ONE_DAY, rpcApi.getHelp).then(function(helpContent) {
			var lines = helpContent.split("\n");
			var sections = [];

			lines.forEach(function(line) {
				if (line.startsWith("==")) {
					var sectionName = line.substring(2);
					sectionName = sectionName.substring(0, sectionName.length - 2).trim();

					sections.push({name:sectionName, methods:[]});

				} else if (line.trim().length > 0) {
					var methodName = line.trim();

					if (methodName.includes(" ")) {
						methodName = methodName.substring(0, methodName.indexOf(" "));
					}

					sections[sections.length - 1].methods.push({name:methodName, content:line.trim()});
				}
			});

			resolve(sections);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRpcMethodHelp(methodName) {
	var rpcApiFunction = function() {
		return rpcApi.getRpcMethodHelp(methodName);
	};

	return new Promise(function(resolve, reject) {
		tryCacheThenRpcApi(miscCache, "getHelp-" + methodName, ONE_DAY, rpcApiFunction).then(function(helpContent) {
			var output = {};
			output.string = helpContent;

			var str = helpContent;

			var lines = str.split("\n");
			var argumentLines = [];
			var catchArgs = false;
			lines.forEach(function(line) {
				if (line.trim().length == 0) {
					catchArgs = false;
				}

				if (catchArgs) {
					argumentLines.push(line);
				}

				if (line.trim() == "Arguments:" || line.trim() == "Arguments") {
					catchArgs = true;
				}
			});

			var args = [];
			var argX = null;
			// looking for line starting with "N. " where N is an integer (1-2 digits)
			argumentLines.forEach(function(line) {
				var regex = /^([0-9]+)\.\s*"?(\w+)"?\s*\(([^,)]*),?\s*([^,)]*),?\s*([^,)]*),?\s*([^,)]*)?\s*\)\s*(.+)?$/;

				var match = regex.exec(line);

				if (match) {
					argX = {};
					argX.name = match[2];
					argX.detailsLines = [];

					argX.properties = [];

					if (match[3]) {
						argX.properties.push(match[3]);
					}

					if (match[4]) {
						argX.properties.push(match[4]);
					}

					if (match[5]) {
						argX.properties.push(match[5]);
					}

					if (match[6]) {
						argX.properties.push(match[6]);
					}

					if (match[7]) {
						argX.description = match[7];
					}

					args.push(argX);
				}

				if (!match && argX) {
					argX.detailsLines.push(line);
				}
			});

			output.args = args;

			resolve(output);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function logCacheSizes() {
	var itemCounts = [ miscCache.itemCount, blockCache.itemCount, txCache.itemCount ];

	var stream = fs.createWriteStream("memoryUsage.csv", {flags:'a'});
	stream.write("itemCounts: " + JSON.stringify(itemCounts) + "\n");
	stream.end();
}


function loadAddressTokenTransactions(address, tokenObjs, pageOffset, pageLimit) {
	return new Promise(function(resolve, reject) {
		const transfers = [];
		electrumAddressApi.getTokenTransactionsForAddress(address).then(async function(result){
			var txids = []
			var txToBlockHeight = []
			result.transactions.forEach(function (transaction){
				txids.push(transaction.tx_hash)
				txToBlockHeight[transaction.tx_hash] = transaction.height;
			})

			const rawTxResult = await getRawTransactionsWithInputs(txids);

			var addrGainsByTx = {};
			var addrLossesByTx = {};

			var handledTxids = [];

			rawTxResult.transactions.forEach((tx) => {
				const txInputs = rawTxResult.txInputsByTransaction[tx.txid];
			
				if (handledTxids.includes(tx.txid)) {
					return;
				}
			
				handledTxids.push(tx.txid);
			
				tx.vout.forEach((vout) => {
					if (vout.scriptPubKey && vout.scriptPubKey.group && vout.scriptPubKey.groupQuantity > 0 && vout.scriptPubKey.groupAuthority === 0 && vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.includes(address)) {
						addrGainsByTx[tx.txid] = addrGainsByTx[tx.txid] || [];
						addrGainsByTx[tx.txid].push({
							group: vout.scriptPubKey.group,
							amount: BigInt(vout.scriptPubKey.groupQuantity),
							address: vout.scriptPubKey.addresses[0]
						});
					}
				});
			
				tx.vin.forEach((vin, j) => {
					const txInput = txInputs[j];
			
					if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.group && txInput.scriptPubKey.groupQuantity > 0 && txInput.scriptPubKey.groupAuthority === 0 && txInput.scriptPubKey.addresses && txInput.scriptPubKey.addresses.includes(address)) {
						addrLossesByTx[tx.txid] = addrLossesByTx[tx.txid] || [];
						if (txInput.scriptPubKey.addresses && txInput.scriptPubKey.addresses.length > 0) {
							addrLossesByTx[tx.txid].push({
								group: txInput.scriptPubKey.group,
								amount: BigInt(txInput.scriptPubKey.groupQuantity),
								address: txInput.scriptPubKey.addresses[0]
							});
						}
					}
				});
			});

			
			
			Object.keys(addrGainsByTx).forEach((key) => {
				addrGainsByTx[key].forEach((gain) => {
					if (addrLossesByTx[key] && addrLossesByTx[key].length > 0) {
						const amountNotFormatted = gain.amount;
						const tokenInfo = tokenObjs[gain.group].genesisInfo;
						let amount = tokenInfo.decimal_places > 0
							? `${amountNotFormatted}`.slice(0, -tokenInfo.decimal_places) + "." + `${amountNotFormatted}`.slice(-tokenInfo.decimal_places)
							: amountNotFormatted;

						amount = utils.addThousandsSeparators(amount)
						
						transfers.push({
							txId: key,
							from: addrLossesByTx[key][0].address,
							to: gain.address,
							amount: amount,
							amountNotFormatted: amountNotFormatted,
							height: txToBlockHeight[key]
						});
					}
				});
			});
			

			let sortedResults = transfers.sort(blockHeightCompare)
			sortedResults = sortedResults.reverse()
			const paginatedTransfers = sortedResults.slice(pageOffset, pageOffset + pageLimit);
			resolve([paginatedTransfers, sortedResults.length]);
		}).catch(function(err){
			console.log(err)
			utils.logError("nds9fc2eg621tf3", err, {address:address});
			reject(err)
			reject(err)
		})
	});
}

function addTokenToCache(token) {
	return new Promise(function(resolve, reject) {
		let tokenInfo = null;
		const transfers = [];
		let richList = [];
		let holders = new Set();
		let holdersCount = 0;
		let totalSupply = BigInt(0);
		let circulatingSupply = BigInt(0);
		getTokenGenesis(token).then(async function(result){
			var promises = [];
			if(result) {
				tokenInfo = result;

				promises.push(new Promise(function(resolve, reject) {
					getTokenMintage(token).then(function(result) {
						totalSupply = BigInt(result.mintage_satoshis)
						circulatingSupply = BigInt(result.mintage_satoshis)
						resolve();
					}).catch(function(err) {
						console.log(err)
						reject(err);
					});
				}));

				promises.push(new Promise(function(resolve, reject){
					electrumAddressApi.getTokenTransactions(token).then(async function(result){
						var txids = []
						var txToBlockHeight = []
						for (const historyItem in result) {
							txids.push(result[historyItem].tx_hash)
							txToBlockHeight[result[historyItem].tx_hash] = result[historyItem].height;
						}

						const rawTxResult = await getRawTransactionsWithInputs(txids);

						var addrGainsByTx = {};
						var addrLossesByTx = {};

						var handledTxids = [];

						rawTxResult.transactions.forEach((tx) => {
							const txInputs = rawTxResult.txInputsByTransaction[tx.txid];
						
							if (handledTxids.includes(tx.txid)) {
								return;
							}
						
							handledTxids.push(tx.txid);
						
							tx.vout.forEach((vout) => {
								if (vout.scriptPubKey && vout.scriptPubKey.group && vout.scriptPubKey.group == token && vout.scriptPubKey.groupQuantity > 0 && vout.scriptPubKey.groupAuthority === 0) {
									addrGainsByTx[tx.txid] = addrGainsByTx[tx.txid] || [];
									addrGainsByTx[tx.txid].push({
										amount: BigInt(vout.scriptPubKey.groupQuantity),
										address: vout.scriptPubKey.addresses[0]
									});
								}
							});
						
							tx.vin.forEach((vin, j) => {
								const txInput = txInputs[j];
						
								if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.group && txInput.scriptPubKey.group == token && txInput.scriptPubKey.groupQuantity > 0 && txInput.scriptPubKey.groupAuthority === 0) {
									addrLossesByTx[tx.txid] = addrLossesByTx[tx.txid] || [];
									if (txInput.scriptPubKey.addresses && txInput.scriptPubKey.addresses.length > 0) {
										addrLossesByTx[tx.txid].push({
											amount: BigInt(txInput.scriptPubKey.groupQuantity),
											address: txInput.scriptPubKey.addresses[0]
										});
									}
								}
							});
						});

						const addressBalances = {};
						Object.entries(addrGainsByTx).forEach(([txid, gains]) => {
							gains.forEach((gain) => {
								addressBalances[gain.address] = (addressBalances[gain.address] || BigInt(0)) + gain.amount;
							});
						});
						
						// Calculate losses
						Object.entries(addrLossesByTx).forEach(([txid, losses]) => {
							losses.forEach((loss) => {
								addressBalances[loss.address] = (addressBalances[loss.address] || BigInt(0)) - loss.amount;
							});
						});
						
						Object.keys(addrGainsByTx).forEach((key) => {
							addrGainsByTx[key].forEach((gain) => {
								const amountNotFormatted = gain.amount;
								let amount = tokenInfo.decimal_places > 0
									? `${amountNotFormatted}`.slice(0, -tokenInfo.decimal_places) + "." + `${amountNotFormatted}`.slice(-tokenInfo.decimal_places)
									: amountNotFormatted;
					
								if (!holders.has(gain.address)) {
									holders.add(gain.address);
								}

								amount = utils.addThousandsSeparators(amount)

								let from = null;
								if(addrLossesByTx[key] && addrLossesByTx[key].length > 0) {
									from = addrLossesByTx[key][0].address
									transfers.push({
										txId: key,
										from: from,
										to: gain.address,
										amount: amount,
										amountNotFormatted: amountNotFormatted,
										height: txToBlockHeight[key]
									});
								} else {
									from = gain.address
								}

								
							});
						});
						
						holders = [...holders];
						
						Object.entries(addressBalances).forEach(([address, balance]) => {
							if(balance > BigInt(0)) {
								const holderGains = transfers.filter((transfer) => transfer.to === address);
								const holderLosses = transfers.filter((transfer) => transfer.from === address);
								const allTransfers = [...holderGains, ...holderLosses];

								const lastTransfer = allTransfers.reduce((latest, transfer) => {
								  return latest.height > transfer.height ? latest : transfer;
								}, {});
	
								const percentage = totalSupply ? ((Number(balance) / Number(totalSupply))) * 100 : BigInt(0);
	
	
								const netAmount = tokenInfo.decimal_places > 0
								? `${balance}`.slice(0, -tokenInfo.decimal_places) + "." + `${balance}`.slice(-tokenInfo.decimal_places)
								: balance;
	
								richList.push({
									address: address,
									netAmount: netAmount,
									netAmountNotFormatted: balance,
									percentage: Number(percentage.toString()).toFixed(2), // Increase precision for percentage
									lastTransferHeight: lastTransfer.height,
									lastTransferTxId: lastTransfer.txId
								});
								holdersCount++
							}
						});
						
						richList.sort((a, b) => b.percentage - a.percentage);
						richList = richList.slice(0, 100);
						resolve()
					}).catch(function(err){
						console.log(token)
						resolve()
					})
				}));

				Promise.all(promises).then(async function() {

					if(tokenInfo.decimal_places > 0) {
						totalSupply = String(totalSupply).substring(0, String(totalSupply).length - tokenInfo.decimal_places) + "." + String(totalSupply).substring(String(totalSupply).length - tokenInfo.decimal_places);
					}

					totalSupply = utils.addThousandsSeparators(totalSupply)
					let documentInfo = null;

					if(tokenInfo.document_url && utils.isValidHttpUrl(tokenInfo.document_url)) {
						try {
							let url = tokenInfo.document_url;
							const response = await axios.get(url, { headers: { "User-Agent": "axios", "Content-Type": "application/json"}});
							const contentType = response.headers["content-type"];
							if(contentType.includes("application/json")) {
								let data = response.data;

								if(data.length > 0) {
									if(typeof data[0] == 'object') {
										documentInfo = {}
										documentInfo['tokenObject'] = data[0];
										documentInfo['signature'] = data[1];

										if(documentInfo['tokenObject']['icon'] != null) {
											if(utils.isValidHttpUrl(documentInfo['tokenObject']['icon'])) {
												const linkParts = documentInfo['tokenObject']['icon'].split('.')
												const extension  = linkParts[linkParts.length - 1];
												let fileTypes = ['jpg', 'JPG', 'png', 'PNG', 'svg', 'SVG'];
												if(fileTypes.includes(extension)){
													documentInfo['icon'] = documentInfo['tokenObject']['icon'];
												}
											} else {
												documentInfo['icon'] = new URL(tokenInfo.document_url).origin + documentInfo['tokenObject']['icon'];
											}
											tokenCache.set('tracked-tokens-icon-' + token, documentInfo['icon'], ONE_YR);
										}
									}
								}
							}
						} catch (err) {
							// utils.logError("Cannot load document URL for token: ", token);
						}
					}

					let parent = null;
					let groupId = nexaaddr.decode(token).hash;
					if (groupId.length > 32) {
						// this is asubgroup which contains the parent group id in the first 32 bytes
						parent = nexaaddr.encode('nexa', 'GROUP', groupId.slice(0, 31));
					}
					
					tokenCache.updateOrAppend('tracked-tokens', {
						groupId: token,
						parent: parent,
						holders: holdersCount,
						totalTransfers: transfers.length,
						maxSupply: totalSupply,
						name: tokenInfo.name,
						ticker: tokenInfo.ticker,
						documentInfo: documentInfo
					}, 'groupId', token, ONE_YR);
					tokenCache.set(token + '-transfers', transfers, ONE_YR);
					tokenCache.set(token + '-richlist', richList, ONE_YR);
					tokenCache.set(token + '-holders', holders, ONE_YR);
					
					debugLog(`Added Token To Cache: ${token}`)
					resolve(transfers)
				}).catch(function(err) {
					reject(err)
				});
			}
		}).catch(function (err) {
			utils.logError("cannot-load-token", err, {token:token});
			reject(err)
		});
	});
}

function blockHeightCompare(a, b) {
	if (a.height < b.height) {
	  return -1;
	} else if (a.height > b.height) {
	  return 1;
	}
	// a must be equal to b
	return 0;
}

function compareFn(a, b) {
	if (a.totalTransfers < b.totalTransfers) {
	  return -1;
	} else if (a.totalTransfers > b.totalTransfers) {
	  return 1;
	}
	// a must be equal to b
	return 0;
}

function getAllTrackedTokens() {
	return new Promise(function(resolve, reject){
		tokenCache.get('tracked-tokens').then(function(results) {
			if(!results || results.length == 0) {
				resolve([])
			}
			resolve(results);
		}).catch(function(err) {
			utils.logError("tracked-tokens-failure", err);
		});
	});
}

function getStatsForToken(token) {
	return new Promise(function(resolve, reject){
		tokenCache.get('tracked-tokens').then(function(results) {
			if(!results || results.length == 0) {
				resolve([])
			}
			const foundIndex = results.findIndex((element) => element.groupId == token);
			if (foundIndex !== -1) { 
				resolve(results[foundIndex]);
			} else {
				resolve[{}]
			}
			
		}).catch(function(err) {
			utils.logError("tracked-tokens-failure", err);
		});
	});
}
  
function getTokenStats() {
	return new Promise(function(resolve, reject){
		tokenCache.get('tracked-tokens').then(function(results) {
			if(!results || results.length == 0) {
				resolve({
					totalTokens: 0,
					totalTransfers: 0,
					totalHolders: 0
				})
			}
			let totalTransfers = results.reduce((n, {totalTransfers}) => n + totalTransfers, 0)
			let totalHolders = results.reduce((n, {holders}) => n + holders, 0)
			resolve({
				totalTokens: results.length,
				totalTransfers: totalTransfers,
				totalHolders: totalHolders
			});
		}).catch(function(err) {
			utils.logError("tracked-tokens-failure", err);
		});
	});
}
function getTokens(pageLimit = 20, pageoffset = 0, sortDir = 'desc'){
	return new Promise(function(resolve, reject){
		tokenCache.get('tracked-tokens').then(function(results) {
			if(!results || results.length == 0) {
				resolve([])
			}
			let sortedResults = results.sort(compareFn)
			sortedResults = sortedResults.reverse()
			const paginatedTokens = sortedResults.slice(pageoffset, pageoffset + pageLimit);
			resolve(paginatedTokens);
		}).catch(function(err) {
			utils.logError("tracked-tokens-failure", err);
		});
	});
}

async function getTransfersForToken(token, transferLimit, transferOffset) {
    let cacheResult = null;

    try {
        cacheResult = await tokenCache.get(token + '-transfers');
        
        if (cacheResult != null) {
            // If token transfers exist in the cache, return paginated results
            const paginatedTransfers = cacheResult.slice(transferOffset, transferOffset + transferLimit);
            return paginatedTransfers;
        } else {
            const transfers = await addTokenToCache(token);
            const paginatedTransfers = transfers.slice(transferOffset, transferOffset + transferLimit);
            return paginatedTransfers;
        }
    } catch (err) {
        utils.logError("token-cache-failure", err, { token: token });
        throw err;
    }
}

function getRichList(token) {
	return new Promise(function(resolve, reject){
		tokenCache.get(token + '-richlist').then(function(result) {
			resolve(result);
		}).catch(function(err) {
			utils.logError("token-richlist-failure", err, {token:token});
			reject(err)
		});
	});
}

function getTokenHolders(token) {
	return new Promise(function(resolve, reject){
		tokenCache.get(token + '-holders').then(function(result) {
			resolve(result);
		}).catch(function(err) {
			utils.logError("token-holders-failure", err, {token:token});
			reject(err)
		});
	});
}

function getTokenIcon(token) {
	return new Promise(function(resolve, reject){
		tokenCache.get('tracked-tokens-icon-' + token).then(function(result) {
			resolve(result);
		}).catch(function(err) {
			utils.logError("token-holders-failure", err, {token:token});
			reject(err)
		});
	});
}

function getTokenTotalTransfers(token) {
	return new Promise(function(resolve, reject){
		tokenCache.get(token + '-transfers').then(function(result) {
			resolve(result.length);
		}).catch(function(err) {
			resolve(0)
			utils.logError("token-holders-failure", err, {token:token});
			// reject(err)
		});
	});
}

function getTransactionTokens(txids) {
	return new Promise(async function(resolve, reject){

		const rawTxResult = await getRawTransactionsWithInputs(txids);

		var handledTxids = [];
		let tokens = new Set();
		let tokensWithData = {};

		rawTxResult.transactions.forEach((tx) => {
			const txInputs = rawTxResult.txInputsByTransaction[tx.txid];
		
			if (handledTxids.includes(tx.txid)) {
				return;
			}
		
			handledTxids.push(tx.txid);
		
			tx.vout.forEach((vout) => {
				if (vout.scriptPubKey && vout.scriptPubKey.group) {
					try {
						let decodedAddress = nexaaddr.decode(vout.scriptPubKey.group);
						
						if(decodedAddress['type'] == 'GROUP') {
							if (!tokens.has(vout.scriptPubKey.group)) {
								tokens.add(vout.scriptPubKey.group);
							}
						}
					} catch (err) {
						console.log(err)
					}
				}
			});
		
			tx.vin.forEach((vin, j) => {
				const txInput = txInputs[j];
		
				if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.group) {
					try {
						let decodedAddress = nexaaddr.decode(txInput.scriptPubKey.group);
						
						if(decodedAddress['type'] == 'GROUP') {

							if (!tokens.has(txInput.scriptPubKey.group)) {
								tokens.add(txInput.scriptPubKey.group);
							}
						}
						
					} catch (err) {
						console.log(err)
					}
				}
			});
		});
		tokens = [...tokens];

		for (const token of tokens) {
			let tokenObj = tokensWithData[token] || {groupId: token };

			// Include additional token information from getTokenGenesis
			let genesisInfo = await getTokenGenesis(token);
			tokenObj.genesisInfo = genesisInfo;
			tokensWithData[token] = tokenObj;
		}
		resolve(tokensWithData);
	});
}

function readKnownTokensIntoCache() {
	return new Promise(async function(resolve, reject) {
		if(!global.processingTokens) {
			global.processingTokens = true;
			debugLog("loading known tokens");
			if(global.firstRun) {
				try {
					global.knownTokens = await rpcApi.dumpTokenset()
					debugLog("used token RPC");
				} catch(err) {
					// global.knownTokens = utils.readUTXOSetForTokens();
					// debugLog("Used UTXO set");
				}
	
				global.firstRun = false;
			}
	
			let indexedTokens = await getAllTrackedTokens();
			
			if(config.slowDeviceMode) {
				for (const token of global.knownTokens) {
					const foundIndex = indexedTokens.findIndex((element) => element.groupId == token);
					if (foundIndex == -1) { 
						try {
							debugLog("Adding token to cache: ", token);
							await addTokenToCache(token);
						} catch (err) {
							debugLog(err);
						}
					} else {
						// debugLog("Token already cached: ", token);
					}
				}
			} else {
				const chunkSize = 5;
				const totalTokens = global.knownTokens.length;
	
				for (let i = 0; i < totalTokens; i += chunkSize) {
					const chunkTokens = global.knownTokens.slice(i, i + chunkSize);
	
					const promises = chunkTokens.map(async (token) => {
						const foundIndex = indexedTokens.findIndex((element) => element.groupId == token);
						if (foundIndex == -1) {
							try {
								debugLog("Adding token to cache: ", token);
								await addTokenToCache(token);
							} catch (err) {
								debugLog(err);
							}
						}
					});
	
					try {
						// await Promise.all(promises);
						await Promise.all(promises.map(utils.reflectPromise))
					}
					catch (err) {
						debugLog('promise failed in token indexing.')
						debugLog(err);
						global.processingTokens = false;
						reject(err)
						break;
					}
				}
			}
			global.processingTokens = false;
		}
		resolve()
	});
}



export default {
	getGenesisBlockHash,
	getGenesisCoinbaseTransactionId,
	getBlockchainInfo,
	getNetworkInfo,
	getNetTotals,
	getTxpoolInfo,
	getTxpoolTxids,
	getMiningInfo,
	getBlock,
	getBlocks,
	getBlockByHeight,
	getBlocksByHeight,
	getBlockByHashWithTransactions,
	getMiningCandidate,
	getRawTransaction,
	getRawTransactions,
	getRawTransactionsWithInputs,
	getRecentBlocksMinimalData,
	getTxUtxos,
	getTxpoolTxDetails,
	getUptimeSeconds,
	getHelp,
	getRpcMethodHelp,
	getAddress,
	logCacheSizes,
	getPeerSummary,
	getChainTxStats,
	getTxpoolDetails,
	getTxCountStats,
	getUtxoSetSummary,
	getNetworkHashrate,
	getBlockStats,
	getBlockCount,
	getBlocksStats,
	getBlocksStatsByHeight,
	buildBlockAnalysisData,
	getBlockHeader,
	getBlockHeaderByHeight,
	getBlockHeadersByHeight,
	decodeScript,
	decodeRawTransaction,
	getBlockList,
	getTokenMintage,
	getTransaction,
	getTransactions,
	getTransfersForToken,
	getRichList,
	getTokenHolders,
	getTokenTotalTransfers,
	addTokenToCache,
	getTokens,
	getTokenStats,
	getStatsForToken,
	loadAddressTokenTransactions,
	readKnownTokensIntoCache,
	getTokenGenesis,
	getTransactionTokens,
	getTokenIcon
};
