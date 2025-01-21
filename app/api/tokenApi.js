import debug from "debug";

import config from "../config.js";

const debugLog = debug("nexexp:tokenapi");

// Fetch total number of token transfers from the API
async function fetchTokenOperations(token) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/operations`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	const data = await response.json();
	return data;
}

async function fetchTokenHoldersCount(token) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/holders`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	const data = await response.json();
	return data;
}

// Fetch paginated data from the API using page and size
async function fetchTransfers(token, page, size) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/transactions?page=${page}&size=${size}`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}

async function fetchRichlist(token) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/richlist?max=100`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}


async function fetchGroups(page = 1, size = 500, includeSubGroups = false) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/all?page=${page}&size=${size}&includeSubgroups=${includeSubGroups}`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}

async function fetchSubGroups(token, page = 1, size = 500) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/subgroups?page=${page}&size=${size}`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}

async function fetchTopTokens(size = 20) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/top?max=${size}`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}

async function fetchAuthories(token) {
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/authorities?includeSpent=false`);
	if (!response.ok) {
		debugLog(`Fetch request failed with error code: ${response.status}`)
		throw new Error('Network response was not ok');
	}
	return response.json();
}

async function getTokenSupply(token){
	const response = await fetch(`${config.tokenApi}/api/v1/tokens/${token}/supply`);
	if (!response.ok) {
		throw new Error('Network response was not ok');
	}
	return response.json();
}

export default {
	fetchAuthories,
	fetchGroups,
	fetchRichlist,
	fetchSubGroups,
	fetchTokenHoldersCount,
	fetchTokenOperations,
	fetchTransfers,
	fetchTopTokens, // not used anywhere
	getTokenSupply
}
