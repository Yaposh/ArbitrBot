let Bot = require('./bot');
const fs = require('fs');

//const searchItems = ['1021500000147'];
//const proxyList = ['5.62.154.248:8085'];

const searchItems = fs.readFileSync("./banks.txt", "utf-8").split("\r\n");
const proxyList = fs.readFileSync("./proxies.txt", "utf-8").split("\r\n");

const importDealsLocal = true;
//const useProxy = false;

let bot = new Bot({
	proxyList
});

bot.init().then(() => {
	bot.auth().then(async () => {
		console.info('Authenticated')
		bot.initTransport();

		let tempSearch;

		if (importDealsLocal) {
			tempSearch = await bot.importDeals(searchItems);
			console.info('Deals imported localy: ' + tempSearch.length);
		} else {
			tempSearch = await bot.parseDeals(searchItems);
			console.info('Parsing links done: ' + tempSearch.length);
		}

		let dealsBeforeCheck = tempSearch.length;
		tempSearch = await bot.checkDeals(tempSearch);

		console.info(`Deals checked: ${tempSearch.length} good, ${dealsBeforeCheck} total`);

		let docs = [];
		for (let deal of tempSearch) {
			docs = docs.concat(await bot.parseDocs(deal))
		}

		console.info('Documents parsed: ' + docs.length);

		await bot.downloadDocs(docs);

		console.info('Work done, closing.');
		bot.close();

	}).catch((err) => {
		console.error(err);
		bot.close();
	});
}).catch((err) => {
	console.error(err);
	bot.close();
})