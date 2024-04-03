#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import axios from 'axios';

import utils from '../app/utils.js';
import coins from '../app/coins.js';

// Get the current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function refreshMiningPoolsForCoin(coinName) {
	console.log(`Refreshing mining pools for ${coinName}...`);
	if (coins[coinName].miningPoolsConfigUrls) {
		const miningPoolsConfigDir = path.join(__dirname, "..", "public", "txt", "mining-pools-configs", coinName);
		fs.readdir(miningPoolsConfigDir, (err, files) => {
			if (err) {
				throw new Error(`Unable to delete existing files from '${miningPoolsConfigDir}'`);
			}

			files.forEach(function(file) {
				// delete existing file
				fs.unlinkSync(path.join(miningPoolsConfigDir, file));
			});
		});

		const miningPoolsConfigUrls = coins[coinName].miningPoolsConfigUrls;

		const promises = [];

		console.log(`${miningPoolsConfigUrls.length} mining pool config(s) found for ${coinName}`);

		for (var i = 0; i < miningPoolsConfigUrls.length; i++) {
			promises.push(refreshMiningPoolConfig(coinName, i, miningPoolsConfigUrls[i]));
		}

		await Promise.all(promises);
		console.log(`Refreshed ${miningPoolsConfigUrls.length} mining pool config(s) for ${coinName}\n---------------------------------------------`);
	} else {
			console.log(`No mining pool URLs configured for ${coinName}`);
			throw new Error (`No mining pool URLs configured for ${coinName}`);
	}
}

async function refreshMiningPoolConfig(coinName, index, url) {
	try {
		const response = await axios.get(url, { transformResponse: res => res })

		const filename = path.join(__dirname, "..", "public", "txt", "mining-pools-configs", coinName, index + ".json");

		fs.writeFileSync(filename, response.data, (err) => {
			console.log(`Error writing file '${filename}': ${err}`);
		});

		console.log(`Wrote '${coinName}/${index}.json' with contents of url: ${url}`);
	} catch(err) {
		console.log(`Error downloading mining pool config for ${coinName}: url=${url}`);
		throw err;
	}
}

async function refreshAllMiningPoolConfigs() {
	const outerPromises = [];

	for (let i = 0; i < coins.coins.length; i++) {
		const coinName = coins.coins[i];

		await refreshMiningPoolsForCoin(coinName);
	}
}

refreshAllMiningPoolConfigs().then(() => {
	process.exit();
});

