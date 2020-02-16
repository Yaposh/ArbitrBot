const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const baseUrl = 'https://kad.arbitr.ru';

function Bot(config) {

    let self = this;
    const rp = require('request-promise');
    const jar = rp.jar();

	this.init = async function() {

        if (!fs.existsSync('./results'))
            fs.mkdirSync('results');

        if (!fs.existsSync('./results/deals'))
            fs.mkdirSync('./results/deals');

        if (!fs.existsSync('./results/docs'))
            fs.mkdirSync('./results/docs');

        let proxyStr = this.getProxy(true);

		this.browser = await puppeteer.launch({
            headless: false,
            ignoreHTTPSErrors: true,
            timeout: 60000,
            //executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            //args: [ '--proxy-server=' + proxyStr ]
        });


		let page = await this.browser.newPage();
		await page.setRequestInterception(true);

        self.page = page;

        return page;
	};

	this.injectCss = async function () {
        await this.page.addStyleTag({content: '.b-promo_notification {display: none !important;}'})
    }

    this.initTransport = function () {
        this.cookies.forEach((item) => {
            jar.setCookie(`${item.name}=${item.value}`, baseUrl);
        });

        this.options = {
            //proxy: 'http://' + this.getProxy(),
            method: 'POST',
            baseUrl: baseUrl,
            uri: '/Kad/SearchInstances',
            //resolveWithFullResponse: true,
            jar: jar,
            //json: jsonReq,
            headers: this.headers
        };
    };

    this.getProxy = function (takeNew) {
        if (takeNew) {
            if (!config.proxyList.length)
                throw 'Empty proxy list';
            this.currentProxy = config.proxyList.shift();
        }
        return this.currentProxy;
    };

    this.auth = async function() {

        let page = this.page,
            self = this,
            proxyStr = this.getProxy();

        return new Promise((resolve, reject) => {
            page.on('request', request => {
                if (request._url.includes(baseUrl + '/Kad/SearchInstances')) {
                    page.cookies(baseUrl).then(cookies => {
                        self.cookies = cookies;
                        self.headers = request._headers;
                        resolve(true);
                    });
                } else request.continue();
            });
			page.on('response', (response) => {
				if (response._url.includes(baseUrl + '/Recaptcha/GetCaptchaId')) {
					let error = response._status === 429 ? 'ipban' : 'captcha';
					//console.log(response)
					reject({ error: error });
				}
			})

            page.waitFor('.b-form-submitters button').then(() => {
                this.injectCss();
                page.$('.b-form-submitters button').then(element => element.click());
            }).catch(error => {
                reject({ error: error });
            })

            page.goto(baseUrl).catch((err) => {
                //console.log(`Bad proxy (${proxyStr}), taking another`, err);
                //return self.browser.close().then(() => self.init())
            });



        }).catch((err) => {
            console.log(`Bad proxy (${proxyStr}), taking another`, err);
            return self.browser.close().then(() => {
                return self.init().then(() => {
                    return self.auth();
                })
            });
        })
    };

    this.parseDeals = async function (searchItems) {
        let tempSearch = [];

        for (let bankID of searchItems) {
            console.log(`Searching ${bankID}`)
            let searchResult = await this.searchUrls(bankID);

            tempSearch = tempSearch.concat(searchResult.map(item => {
                return { url: item, id: bankID }
            }));

            exportDeals(searchResult, bankID);
        }

        return tempSearch;
    };

    this.searchUrls = function(searchItem, pageIndex = 1, accum = []) {
		
		let options = this.options;

        options.json = {
			"Page": pageIndex,
            "CaseType":"B",
			"Count": 25,
			"Courts": [],
			"DateFrom": null,
			"DateTo": null,
			"Sides": [
				{ "Name": searchItem, "Type": 0, "ExactMatch": false } 
			],
			"Judges": [],
			"CaseNumbers": [],
			"WithVKSInstances": false
        };
    
		
		return rp(options).then(result => {

			accum = accum.concat(parseList(result));
            console.log(`Parsing links for ${searchItem}: ${accum.length}`);
			
			if (checkAvailableNext(result)) {
				return this.searchUrls(searchItem, pageIndex + 1, accum);
			} else {
				return accum
			}
		}).catch(err => {
            console.log(err.name);
            if (err.statusCode === 429 || err.name === 'RequestError') {
                this.options.proxy = this.getProxy(true);
                return this.searchUrls(searchItem, pageIndex, accum)
            }
        })
    };

    this.checkDeals = async function (deals) {

        let result = [];

        for (let deal of deals) {
            let options = this.options;

            options.method = 'GET';
            options.uri = deal.url.split('.ru')[1];

            let res = await rp(options),
                resJson = typeof res === 'string' ? JSON.parse(res) : res,
                caseState = resJson["Result"]["CaseInfo"]["CaseState"];

            if (caseState !== 'Рассмотрение дела завершено')
                result.push(deal);
        }

        return result;
    };

    this.parseDocs = async function(deal, pageIndex = 1, accum = []) {

        let options = this.options;

        const caseId = deal.url.split('/').pop();

        options.method = 'GET';
        options.uri = `/Kad/CaseDocumentsPage?caseId=${caseId}&page=${pageIndex}&perPage=25`;

        let res = await rp(options);

        let jsonRes = typeof res === 'string' ? JSON.parse(res) : res;

        jsonRes["Result"]["Items"].forEach(item => {
            if (item["ContentTypes"].some(item => item.includes('О включении требований в реестр требований кредиторов'))) {
                let caseId = item['CaseId'],
                    id = item['Id'],
                    filename = item['FileName'],
                    url = `https://kad.arbitr.ru/Document/Pdf/${caseId}/${id}/${filename}?isAddStamp=False`;
                accum.push({ url, bankID: deal.id });
            }
        });

        if (pageIndex != jsonRes["Result"]["PagesCount"] && jsonRes["Result"]["TotalCount"] > 0)
            return this.parseDocs(deal, pageIndex + 1, accum);

        return accum;
    };

    this.downloadDocs = async function (docs) {

        let banks = {};

        for (let doc of docs) {
            if (banks[doc.bankID])
                banks[doc.bankID].push(doc.url);
            else
                banks[doc.bankID] = [doc.url];
        }

        for (let bankID in banks) {

            let data = JSON.stringify(banks[bankID]);

            fs.writeFile(`./results/docs/${bankID}.json`, data, 'utf8', () => {});
        }
    };

    this.importDeals = function () {
        let files = fs.readdirSync('./results/deals/');

        let items = files.flatMap(filename => {
            let file = fs.readFileSync('./results/deals/' + filename).toString(),
                links = JSON.parse(file),
                bankID = filename.split('.')[0];

            return links.map(link => {
                return { url: link, id: bankID }
            });

        })

        /*tempSearch = [
			{"url":"https://kad.arbitr.ru/Card/e42ea599-ab10-43d7-bfc7-52e4ef69ebaa","id":"1021500000147"},
			{"url":"https://kad.arbitr.ru/Card/28396858-08e4-47f7-9d56-da65ec53f4d2","id":"1021500000147"},
			{"url":"https://kad.arbitr.ru/Card/05f8dee1-61b4-42e1-a311-d897acd860f1","id":"1021500000147"},
			{"url":"https://kad.arbitr.ru/Card/0d5b09f5-aa02-4797-8598-8e0c99423bfd","id":"1021500000147"},
			{"url":"https://kad.arbitr.ru/Card/0b786ab7-f492-4604-84c8-22f99489e8ab","id":"1021500000147"},
			{"url":"https://kad.arbitr.ru/Card/9313dcbf-0449-41d7-b018-07c602898e06","id":"1021500000147"}
		];*/

        return items;
    };

    this.close = function () {
        return this.browser.close();
    }
}

function parseList(body) {
    return [...body.matchAll(/(https\:\/\/kad.arbitr.ru\/Card\/)(.{36})/g)].map(item => {
        return item[0];
    });
}

function checkAvailableNext(body) {
    //return false;
    let currentPageNum = (/("documentsPage" value)(\D){2}(\d{1,3})(\D)/g).exec(body)[3],
        totalPageNum = (/("documentsPagesCount" value)(\D){2}(\d{1,3})(\D)/g).exec(body)[3];

	return currentPageNum !== totalPageNum && totalPageNum != 0;
}

function exportDeals(result, id) {

    let json = JSON.stringify(result);
    fs.writeFile(`./results/deals/${id}.json`, json, 'utf8', () => {});
}




module.exports = Bot;
