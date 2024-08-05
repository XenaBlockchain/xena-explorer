import debug from 'debug';
const debugLogError = debug("nexexp:error");
import config from "./../config.js";
import coins from "../coins.js";
import utils from "../utils.js";
import crypto from 'crypto-js';
import nexaaddr from 'nexaaddrjs'
import coreApi from './coreApi.js';
import rpcApi from './rpcApi.js';
import { ClusterOrder, ElectrumCluster, ElectrumTransport } from 'electrum-cash';
import global from "../global.js";
const debugLog = debug("nexexp:electrumx");

const coinConfig = coins[config.coin];

const electrum = new ElectrumCluster('nexa-rpc-explorer', '1.4.3', 1, 3, ClusterOrder.PRIORITY, 30000);

var noConnectionsErrorText = "No ElectrumX connection available. This could mean that the connection was lost or that ElectrumX is processing transactions and therefore not accepting requests. This tool will try to reconnect. If you manage your own ElectrumX server you may want to check your ElectrumX logs.";

const handleNotifications = async function (data) {
	if(data.method === 'blockchain.headers.subscribe')
	{
		let blockHash = await rpcApi.getBlockHash(data.params[0].height);
		let block = await coreApi.getBlockByHashWithTransactions(blockHash, 1000, 0);
				
		let txIds =  block.transactions.map(x => x.txid);
		let tokens = new Set();
		const rawTxResult = await coreApi.getRawTransactionsWithInputs(txIds);

		var handledTxids = [];

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
					}
				}
			});
		});
		tokens = [...tokens];

		tokens.forEach(async function(token){
			debugLog("Updating Token in cache: ",token)
			try {
				await coreApi.addTokenToCache(token);
			} catch (err) {
				debugLogError(err)
			}
		})
	}
}

function connectToServers() {
	return new Promise(async function(resolve, reject) {
		for (var i = 0; i < config.electrumXServers.length; i++) {
			var { host, port, protocol } = config.electrumXServers[i];
			var defaultProtocol;
			switch (protocol) {
				case "tcp":
					defaultProtocol = ElectrumTransport.TCP.Scheme;
					break;
				case "tcp_tls":
					defaultProtocol = ElectrumTransport.TCP_TLS.Scheme;
					break;
				case "ws":
					defaultProtocol = ElectrumTransport.WS.Scheme;
					break;
				case "wss":
					defaultProtocol = ElectrumTransport.WSS.Scheme;
					break;
			}
			electrum.addServer(host, port, defaultProtocol);
		}
		await electrum.startup()
		debugLog(`Connected to ElectrumX`);
		electrum.on('notification', handleNotifications);
		resolve()
	});
}

function shutdown() {
	return electrum.shutdown();
}

function getAddressDetails(address, scriptPubkey, sort, limit, offset) {
	return new Promise(function(resolve, reject) {
		if (electrum.clients.length == 0) {
			reject({error: "No ElectrumX Connection", userText: noConnectionsErrorText});

			return;
		}

		var addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(scriptPubkey)));
		addrScripthash = addrScripthash.match(/.{2}/g).reverse().join("");

		var promises = [];

		var txidData = null;
		var balanceData = null;
		// TODO exit early in case getAddressTxids or getAddressBalance fails
		promises.push(new Promise(function(resolve2, reject2) {
			getAddressTxids(addrScripthash).then(function(result) {
				txidData = result;

				resolve2();

			}).catch(function(err) {
				err.userData = {address:address, sort:sort, limit:limit, offset:offset};

				utils.logError("2397wgs0sgse", err);

				reject2(err);
			});
		}));

		promises.push(new Promise(function(resolve2, reject2) {
			getAddressBalance(addrScripthash).then(function(result) {
				balanceData = result;

				resolve2();

			}).catch(function(err) {
				err.userData = {address:address, sort:sort, limit:limit, offset:offset};

				utils.logError("21307ws70sg", err);

				reject2(err);
			});
		}));

		Promise.all(promises.map(utils.reflectPromise)).then(function(results) {
			var addressDetails = {};
			if (txidData) {
				addressDetails.txCount = txidData.length;

				addressDetails.txids = [];
				addressDetails.blockHeightsByTxid = {};

				if (sort == "desc") {
					txidData.reverse();
				}

				for (var i = offset; i < Math.min(txidData.length, limit + offset); i++) {
					addressDetails.txids.push(txidData[i].tx_hash);
					addressDetails.blockHeightsByTxid[txidData[i].tx_hash] = txidData[i].height;
				}
			}

			if (balanceData) {
				addressDetails.balanceSat = balanceData.confirmed;
			}

			var errors = [];
			results.forEach(function(x) {
				if (x.status == "rejected") {
					errors.push(x);
				}
			});

			resolve({addressDetails:addressDetails, errors:errors});
		});
	});
}



function getAddressTxids(addrScripthash) {
	return new Promise(async function(resolve, reject) {
		try {
		 	let results = await electrum.request('blockchain.scripthash.get_history', addrScripthash);
			debugLog(`getAddressTxids=${utils.ellipsize(JSON.stringify(results, utils.bigIntToRawJSON), 200)}`);

			if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
				for (var i = 0; i < results.length; i++) {
					results[i].result.unshift({tx_hash:coinConfig.genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain], height:0});
				}
			}

			var first = results[0];
			var done = false;

			for (var i = 1; i < results.length; i++) {
				if (results[i].length != first.length) {
					resolve({conflictedResults:results});

					done = true;
				}
			}

			if (!done) {
				resolve(results);
			}
		} catch (err) {
			reject(err);
		}
	});
}

function getAddressBalance(addrScripthash) {
	return new Promise(async function(resolve, reject) {
		try {
			let results = await electrum.request('blockchain.scripthash.get_balance', addrScripthash);

			debugLog(`getAddressBalance=${JSON.stringify(results, utils.bigIntToRawJSON)}`);

			if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
				for (var i = 0; i < results.length; i++) {
					var coinbaseBlockReward = coinConfig.blockRewardFunction(0, global.activeBlockchain);

					results[i].result.confirmed += (coinbaseBlockReward * coinConfig.baseCurrencyUnit.multiplier);
				}
			}

			var first = results[0];
			var done = false;

			for (var i = 1; i < results.length; i++) {
				if (results[i].confirmed != first.confirmed) {
					resolve({conflictedResults:results});

					done = true;
				}
			}

			if (!done) {
				resolve(results);
			}
		} catch (err) {
			reject(err);
		}
	});
}

async function getTokenBalanceForAddress(address, token) {
	try {
		let results;
		if (token) {
			results = await executeElectrumRequest('token.address.get_balance', address, null, token);
		} else {
			results = await executeElectrumRequest('token.address.get_balance', address);
		}
		return mergeBalances(results);
	} catch (error) {
		throw error;
	}
}

async function getTokenTransactionsForAddress(address) {
	try {
		const results = await executeElectrumRequest('token.address.get_history', address);
		return results;
	} catch (error) {
		throw error;
	}
}

async function getTokenTransactions(token, sort, limit, offset) {
	try {
		const results = await executeElectrumRequest('token.transaction.get_history', token, null);
		debugLog(`getTokenTransactions=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
		return results.history;
	} catch (error) {
		throw error;
	}
}

async function getTokenGenesis(tokenID) {
	try {
		const results = await executeElectrumRequest('token.genesis.info', tokenID);
		debugLog(`tokenGenesisInfo=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
		return results;
	} catch (error) {
		throw error;
	}
}

async function getTokenNFTs(tokenID) {
	try {
		const results = await executeElectrumRequest('token.nft.list', tokenID);
		debugLog(`getTokenNFTs=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
		return results;
	} catch (error) {
		throw error;
	}
}

async function subscribeToBlockHeaders() {
	const results = await electrum.subscribe('blockchain.headers.subscribe');
	if (results instanceof Error) {
		throw results;
	}

	return results;
}


async function executeElectrumRequest(method, ...params) {
	try {
		const results = await electrum.request(method, ...params);
		if (results instanceof Error) {
			throw results;
		}
		return results;
	} catch (error) {
		throw error;
	}
}


async function handleKnownToken(token) {
	if (utils.knownTokens().includes(token)) {
		return await coreApi.getTokenIcon(token);
	}
}

async function mergeBalances(balanceResults) {
	let mergedBalances = {};

	// Combine confirmed and unconfirmed balances
	for (const type of ['confirmed', 'unconfirmed']) {
		for (const key of Object.keys(balanceResults[type])) {
			// if(utils.hex2array(key).length > 32) {
			// 	//is nft
			// 	continue;
			// }
			let group = nexaaddr.encode('nexa', 'GROUP', utils.hex2array(key));
			let scripthash = key;
			let token = mergedBalances[group] || { scripthash: scripthash, groupId: group };

			// Include additional token information from getTokenGenesis
			let genesisInfo = await coreApi.getTokenGenesis(group);
			token.genesisInfo = genesisInfo;

			// Format confirmed and unconfirmed balances
			let amountNotFormatted = balanceResults[type][key].toString();
			token[type + 'BalanceFormatted'] = formatBalance(amountNotFormatted, genesisInfo.decimal_places);

			token[type + 'Balance'] = balanceResults[type][key];

			token.tokenImageUrl = await handleKnownToken(group);
			mergedBalances[group] = token;
		}
	}
	return mergedBalances;
}

function formatBalance(amountNotFormatted, decimalPlaces) {
	return decimalPlaces > 0
		? `${amountNotFormatted}`.slice(0, -decimalPlaces) + "." + `${amountNotFormatted}`.slice(-decimalPlaces)
		: amountNotFormatted;
}

export default {
	connectToServers,
	getAddressDetails,
	getTokenGenesis,
	getTokenTransactions,
	getTokenBalanceForAddress,
	subscribeToBlockHeaders,
	shutdown,
	getTokenTransactionsForAddress,
	getTokenNFTs
};
