import debug from "debug";
import { createClient } from "redis";
import config from "./config.js";
import utils from "./utils.js";
import tokenApi from "./api/tokenApi.js";
import BeeQueue from 'bee-queue';
import db from '../models/index.js'

const debugLog = debug("nexexp:queue");
import global from "./global.js";

const tokenLoadQueue = new BeeQueue('tokenLoadQueue',{
	redis: createClient(config.redisUrl),
	activateDelayedJobs: true,
	removeOnSuccess: true
});


tokenLoadQueue.process(1,async (job) => {
	debugLog(`tokenLoadQueue: Processing job ${job.id}`);
	return new Promise(async function(resolve, reject) {
		let tokenApiGroups = [];
		let tokenApiSubGroups = [];
		let lastBlockHeight = 0
		if(!global.processingTokens) {
			global.processingTokens = true;
			const storedBlockHeight = await db.Preference.findOne({
				where: {
					key: "last_block"
				}
			})
			if(storedBlockHeight && storedBlockHeight.value > 0) {
				lastBlockHeight = storedBlockHeight.value
			}
			try {
				let results = [];
				let groups = [];
				let subgroups = [];

				try {
					let pageResults = 500;
					let page = 1;
					let limit = 500

					do {
						const data = await tokenApi.fetchGroups(page, limit, true)
						pageResults = data?.results
						const dataParsed = data?.tokens.map(item => {
							if(item.blockHeight < lastBlockHeight ){
								return null
							}
							if (item.parentGroup === null) {
								groups.push(item.token)
							} else {
								subgroups.push(item.token) // add to subgroups array
							}
							return item.token
						});
						results = results.concat(dataParsed)
						page++;
					} while(pageResults !== 0)

				} catch(err) {
					debugLog(err)
					debugLog("Can't load NFTs from electrum for token: " + token);
				}
				debugLog("Total number of assets from token api: " + results.length)
				debugLog("Total number of groups for indexing: " + groups.length)
				debugLog("Total number of subgroups for indexing: " + subgroups.length)
				tokenApiGroups = groups;
				tokenApiSubGroups = subgroups;

			} catch(err) {
				debugLog("Unable to load tokens or NFTS")
				reject(err)
			}

			await utils.loadGroupDataSlow(tokenApiGroups);
			await utils.loadGroupDataSlow(tokenApiSubGroups, true);

			global.processingTokens = false;
		}
		resolve()
	});
});


tokenLoadQueue.on('error', (err) => {
	debugLog(`tokenLoadQueue: A queue error happened: ${err.message}`);
});

tokenLoadQueue.on('succeeded', (job, result) => {
	debugLog(`tokenLoadQueue: Job ${job.id} succeeded with result: ${result}`);
});


export default tokenLoadQueue;
