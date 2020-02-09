let Bot = require('./bot');
const fs = require('fs');

//const searchItems = ['1021500000147'];
//const proxyList = ['5.62.154.248:8085'];

const searchItems = fs.readFileSync("./banks.txt", "utf-8").split("\r\n");
const proxyList = fs.readFileSync("./proxies.txt", "utf-8").split("\r\n");

const importDealsLocal = false;

let bot = new Bot({
	proxyList
});

bot.init().then(() => {
	bot.auth().then(async () => {
		console.log('Authenticated')
		bot.initTransport();

		let tempSearch;

		if (importDealsLocal) {
			tempSearch = await bot.importDeals(searchItems);
			console.log('Deals imported localy: ' + tempSearch.length);
		} else {
			tempSearch = await bot.parseDeals(searchItems);
			console.log('Parsing links done: ' + tempSearch.length);
		}

		/*for (let searchItem of tempSearch) {
			let parseResult = await bot.parseDocs(searchItem.url);

			console.log(parseResult);
		}*/


		console.log('Work done, closing.');
		bot.close();

	}).catch((err) => {
		console.error(err);
		bot.close();
	});
}).catch((err) => {
	console.error(err);
	bot.close();
})