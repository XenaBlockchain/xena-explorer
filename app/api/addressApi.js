import config from "./../config.js";
import coins from "../coins.js";
import utils from "../utils.js";

const coinConfig = coins[config.coin];

import electrumAddressApi from "./electrumAddressApi.js";
import blockchairAddressApi from "./blockchairAddressApi.js";

function getSupportedAddressApis() {
	return ["electrumx"];
}

function getCurrentAddressApiFeatureSupport() {
	if (config.addressApi == "electrumx") {
		return {
			pageNumbers: true,
			sortDesc: true,
			sortAsc: true
		};
	}
}

function getAddressDetails(address, scriptPubkey, sort, limit, offset) {
	return new Promise(function(resolve, reject) {
		var promises = [];

		if (config.addressApi == "electrumx") {
			promises.push(electrumAddressApi.getAddressDetails(address, scriptPubkey, sort, limit, offset));

		} else {
			promises.push(new Promise(function(resolve, reject) {
				resolve({addressDetails:null, errors:["No address API configured"]});
			}));
		}

		Promise.all(promises).then(function(results) {
			if (results && results.length > 0) {
				resolve(results[0]);

			} else {
				resolve(null);
			}
		}).catch(function(err) {
			utils.logError("239x7rhsd0gs", err);

			reject(err);
		});
	});
}


export default {
	getSupportedAddressApis,
	getCurrentAddressApiFeatureSupport,
	getAddressDetails,
}
