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
		{ key: 'Exbitron', loader: () => coreApi.getMarketDataForToken(ticker, 'Exbitron', loadExbitronDataForToken(ticker))},
	];

	try {
		const processedData = await processLoadingOfData(items);

		let flatData = processedData.flatMap(({key, data}) =>
			data.map(item => ({...item, key}))
		)

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
	const promises = items.map(({ key, loader }) => ({
		key,
		value: loader(),
	}));

	const results = await Promise.all(promises.map(p => p.value));

	return promises.map((promise, index) => ({
		key: promise.key,
		data: results[index],
	}));
}

export default {
	loadMarketDataForTicker
}
