import debug from "debug";
import { createClient } from "redis";
import { fileTypeFromBuffer } from 'file-type';
import config from "./config.js";
import utils from "./utils.js";
import BeeQueue from 'bee-queue';
import nexaaddr from 'nexaaddrjs'
import coreApi from "./api/coreApi.js";
import db from '../models/index.js'
import path from 'path';
const __dirname = path.dirname('../');
import moment from "moment";
import fs from 'fs';
import axios from 'axios';
const debugLog = debug("nexexp:queue");

const tokenQueue = new BeeQueue('tokenQueue',{
    redis: createClient(config.redisUrl)
});


tokenQueue.process(async (job) => {
    debugLog(`Processing job ${job.id}, token: ${job.data.token}`);
	let token = job.data.token;
	let isNFT = job.data.isNFT
    return new Promise(async function(resolve, reject) {
		let tokenInfo = null;
		const transfers = [];
		let totalSupply = BigInt(0);
		let genesisTxTime = null;
		let circulatingSupply = BigInt(0);
		const result = await coreApi.getTokenGenesis(token);
		var promises = [];
		if(result) {
			tokenInfo = result;

			promises.push(new Promise(function(resolve, reject) {
				coreApi.getTokenMintage(token).then(function(result) {
					totalSupply = BigInt(result.mintage_satoshis)
					circulatingSupply = BigInt(result.mintage_satoshis)
					resolve();
				}).catch(function(err) {
					debugLog(err);
					reject(err);
				});
			}));

			promises.push(new Promise(function(resolve, reject) {
				coreApi.getRawTransaction(tokenInfo.txid).then(function(tx) {
					if (tx) {
						genesisTxTime = moment.unix(tx.time).format();
					}
					resolve();
				}).catch(function(err) {
					reject(err);
				});
			}));

			Promise.all(promises).then(async function() {

				if(tokenInfo.decimal_places > 0) {
					totalSupply = String(totalSupply).substring(0, String(totalSupply).length - tokenInfo.decimal_places) + "." + String(totalSupply).substring(String(totalSupply).length - tokenInfo.decimal_places);
				}

				totalSupply = utils.addThousandsSeparators(totalSupply)
				let documentInfo = null;

				let parent = null;
				let nftData = null;
				let nftMetadata = null;
				let tokenName = tokenInfo.name
				let tokenTicker = tokenInfo.ticker
				let tokenSeries = null;
				let tokenSeriesId = null;
				let tokenAuthor = null;
				let frontFile = null
				let files = [];
				let groupId = nexaaddr.decode(token).hash;
				if (groupId.length > 32) {
					// this is asubgroup which contains the parent group id in the first 32 bytes
					parent = nexaaddr.encode('nexa', 'GROUP', groupId.slice(0, 31));
				}



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
									}
								}
							}
						}
					} catch (err) {
						// utils.logError("Cannot load document URL for token: ", token);
					}
				}

				// If its an NFT lets try and grab the image for it.
				if(isNFT) {
					try{
						var nftPath = path.join(__dirname, "public", "img", "nfts");
						var response = await axios.get('https://niftyart.cash/_public/' + token, {
							responseType: 'arraybuffer'
						});
						var zipData = Buffer.from(response.data, 'binary').toString('base64');
						nftData = await utils.loadNFTData(zipData);
						tokenName = nftData?.nftMetadata?.title ?? null;
						tokenSeries = nftData?.nftMetadata?.series ?? null;
						tokenAuthor = nftData?.nftMetadata?.author ?? null;
						nftMetadata = nftData?.nftMetadata ?? null;
						
						if (!fs.existsSync(nftPath + '/' + token)){
							fs.mkdirSync(nftPath + '/' + token);
						}
						tokenTicker = null;
						for (let i = 0; i < nftData.nftFiles.length; i++) {
							var file = nftData.nftFiles[i]
							if(file.title != 'Owner') {
								try {
									let b =  Buffer.from(file.image, 'base64');
									const fileType =  await fileTypeFromBuffer(b);
									var filePath = nftPath + '/' + token + '/' + file.title + '.'+ fileType.ext
									fs.writeFileSync(filePath, b);
									let fileStore = {title: file.title, path: filePath, ext: fileType.ext, mime: fileType.mime}
									if(file.title == "Front") {
										frontFile = fileStore
									}
									files.push(fileStore)
								} catch(err) {
									debugLog("Cannot write file for token: ", token)
									debugLog("Cannot write file for token: ", err)
								}

							}
						}
						
					} catch(err){
						debugLog(`cannot load NFT data: ${err}`)
					}
					if (tokenSeries && (tokenSeries != ' ' || tokenSeries != '')) {
						const [seriesModel, seriesCreated] = await db.Series.findOrCreate({
							where: { name: tokenSeries},
							defaults: {
								name: tokenSeries,
								author: tokenAuthor,
								cover_image: frontFile ?? null
							}
						});
						tokenSeriesId = seriesModel.id;
					}
				}

				const operations = await utils.fetchTokenOperations(token);
				const holders = await utils.fetchTokenHoldersCount(token);
				const [tokenModel, created] = await db.Tokens.findOrCreate({
					where: { group: token  },
					defaults: {
						group: token,
						parent: parent,
						is_nft: isNFT,
						files: files,
						nft_data: nftMetadata,
						series: tokenSeries,
						series_id: tokenSeriesId,
						author: tokenAuthor,
						holders: holders.total,
						transfers: operations.transfer,
						max_supply: totalSupply,
						name: tokenName,
						genesis: tokenInfo,
						ticker: tokenTicker,
						document_info: documentInfo,
						genesis_datetime: genesisTxTime
					}
				});

				if(!created && tokenModel) {
					await db.Tokens.update(
						{ 
							parent: parent,
							is_nft: isNFT,
							nft_data: nftMetadata,
							series: tokenSeries,
							author: tokenAuthor,
							holders: holders.total,
							transfers: operations.transfer,
							max_supply: totalSupply,
							name: tokenName,
							genesis: tokenInfo,
							ticker: tokenTicker,
							document_info: documentInfo,
							genesis_datetime: genesisTxTime
						},
						{
							where: {
								group: token
							},
						},
						);
				}

				debugLog(`Added Token To Cache: ${token}`)
				resolve(transfers)
			}).catch(function(err) {
				debugLog("db error", err)
				reject(err)
			});
		}
	});
});


tokenQueue.on('error', (err) => {
	debugLog(`A queue error happened: ${err.message}`);
});

tokenQueue.on('succeeded', (job, result) => {
	debugLog(`Job ${job.id} succeeded with result: ${result}`);
});


export default tokenQueue;
