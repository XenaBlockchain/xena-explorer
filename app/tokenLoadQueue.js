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


tokenLoadQueue.process(3,async (job) => {
	debugLog(`tokenLoadQueue: Processing job ${job.id}, token: ${job.data.token}`);
	return new Promise(async function(resolve, reject) {
		let tokenApiGroups = [];
		let tokenApiSubGroups = [];
		if(!global.processingTokens) {
			global.processingTokens = true;

			try {
				let groups = [];
				let subgroups = [];

				try {
					let pageResults = 500;
					let page = 1;
					let limit = 500

					do {
						const data = await tokenApi.fetchGroups(page, limit)
						pageResults = data?.results
						const dataParsed = data?.tokens.map(item => item.token);
						groups = groups.concat(dataParsed)
						page++;
					} while(pageResults !== 0)
					debugLog("Total number of tokens from token api: " + groups.length)
				} catch(err) {
					debugLog(err)
					debugLog("Can't load NFTs from electrum for token: " + token);
				}

				for (const token of groups) {
					debugLog("loading token " + token);
					try {
						let pageResults = 500;
						let page = 1;
						let limit = 500

						do {
							const data = await tokenApi.fetchSubGroups(token, page, limit)
							pageResults = data?.results
							const dataParsed = data?.tokens.map(item => item.token);
							subgroups = subgroups.concat(dataParsed)
							page++;
						} while(pageResults !== 0)
					} catch(err) {
						debugLog(err)
						debugLog("cant load NFT's from token API for token: ", token);
					}

				}debugLog("Total number of subgroups from token api: " + subgroups.length)
				tokenApiGroups = groups;
				tokenApiSubGroups = subgroups;

			} catch(err) {
				debugLog("Unable to load tokens or NFTS")
			}


			const dbIndexedTokens = await db.Token.findAll({
				attributes: ['group'],
				where: {
					is_nft: false,
				},
			});
			const cachedTokenGroups = dbIndexedTokens.map(token => token.group);

			const dbIndexedNFTs = await db.Token.findAll({
				attributes: ['group'],
				where: {
					is_nft: true,
				},
			});

			const cachedNFTGroups = dbIndexedNFTs.map(token => token.group);

			const notIndexedGroups = tokenApiGroups.filter(item => !cachedTokenGroups.includes(item));
			const notIndexedSubGroups = tokenApiSubGroups.filter(item => !cachedNFTGroups.includes(item));

			await utils.loadGroupDataSlow(notIndexedGroups);
			await utils.loadGroupDataSlow(notIndexedSubGroups, true);

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
