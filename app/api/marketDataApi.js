import coreApi from "./coreApi.js";


async function loadExbitronDataForToken(ticker){
	const response = await fetch("https://api.exbitron.digital/api/v1/trading/info/base_pairs/" + ticker);
	if (!response.ok) {
		throw new Error('Network response was not ok');
	}
	const responseBody = await response.json();

	if (responseBody.hasError) {
		console.error("Error in the response:", data);
		return;
	}

	let markets = responseBody.data.markets
	for (let key in markets) {
		markets[key].logo = "https://exbitron.com/images/logo.svg"
		markets[key].marketUrl = "https://app.exbitron.com/exchange/?market=" + markets[key].id
	}
	return markets;
}
async function loadMarketDataForTicker(ticker) {
	const items = [
		{ key: 'Exbitron', loader: () => coreApi.getMarketDataForToken(ticker, 'Exbitron', () => loadExbitronDataForToken(ticker))},
	];

	try {
		const processedData = await processLoadingOfData(items);
		// Add null/undefined checks and filter empty results
		let flatData = processedData
			.filter(item => item?.data) // Filter out null/undefined data
			.flatMap(({key, data}) =>
				(Array.isArray(data) ? data : []) // Ensure we have an array
					.map(item => ({...item, key}))
			);

		// Handle case where all data sources failed
		if (flatData.length === 0) {
			return {
				marketData: [],
				priceData: 0
			};
		}

		const averagePrice = flatData.reduce((sum, item) => sum + item.rate, 0) / flatData.length;

		return {
			marketData: flatData,
			priceData: Math.ceil(averagePrice)
		}
	} catch (error) {
		console.error('Error processing items:', error);
	}
}

async function processLoadingOfData(items) {
	const promises = items.map(async ({ key, loader }) => {
		try {
			const data = await loader();
			return { key, data };
		} catch (error){
			console.error(`Failed to load data for ${key}:`, error);
			// Explicit null for failed loads
			return { key, data: null };
		}
	});

	const results = await Promise.all(promises);
	return results;
}

export default {
	loadMarketDataForTicker
}
