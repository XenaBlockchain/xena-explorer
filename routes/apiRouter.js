import debug from 'debug';
const debugLog = debug('nexexp:router');

import express from 'express';
import cors from 'cors'
import rateLimit from 'express-rate-limit';
import csurf from 'csurf';
import util from 'util';
var router = express.Router();
import moment from 'moment';
import qrcode from 'qrcode';
import bitcoinjs from 'bitcoinjs-lib';
import pkg from 'crypto-js';
const {sha256, hexEnc} = pkg;
import Decimal from 'decimal.js';

import utils from './../app/utils.js';
import coins from './../app/coins.js';
import config from './../app/config.js';
import coreApi from './../app/api/coreApi.js';
import addressApi from './../app/api/addressApi.js';

const forceCsrf = csurf({ ignoreMethods: [] });
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});


const corsOptions = {

	origin: function(origin, callback){    // allow requests with no origin 
		// (like mobile apps or curl requests)
		if(!origin) return callback(null, true);
		
		if(config.corsAllowedServers.indexOf(origin) === -1){
		  var msg = 'The CORS policy for this site does not ' +
					'allow access from the specified Origin.';
		  return callback(new Error(msg), false);
		}
		return callback(null, true);
	},
	optionsSuccessStatus: 200
  }

router.use(limiter);


router.get("/utxo-summary", function(req, res, next) {
	coreApi.getUtxoSetSummary().then(function(info) {
		res.json(info);
		utils.perfMeasure(req);
	});
});

router.get("/decode-script/:scriptHex", function(req, res, next) {
	var hex = req.params.scriptHex;
	var promises = [];

	promises.push(coreApi.decodeScript(hex));

	Promise.all(promises).then(function(results) {
		res.json(results);

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/decode-raw-tx/:txHex", function(req, res, next) {
	var hex = req.params.txHex;
	var promises = [];

	promises.push(coreApi.decodeRawTransaction(hex));

	Promise.all(promises).then(function(results) {
		res.json(results);

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/txpoolinfo", function(req, res, next) {
	coreApi.getTxpoolInfo().then(function(info) {
		["bytes", "usage", "maxtxpool"].map(p => {
			var data = utils.formatLargeNumber(info[p], 1);
			var abbr = data[1].abbreviation || "";
			return { k: p + "Human", v: `${data[0]} ${abbr}B` }
		}).forEach(p => info[p.k] = p.v);
		res.json(info);
		utils.perfMeasure(req);
	});
});

router.get("/getrecentblocks", function(req, res, next) {
	var count = 10;
	coreApi.getRecentBlocksMinimalData(count).then(function(data) {
		res.json(data);

		utils.perfMeasure(req);
	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/blocks", cors(corsOptions), function(req, res, next) {
	var args = {}
	if (req.query.limit)
		args.limit = parseInt(req.query.limit);
	if (req.query.offset)
		args.offset = parseInt(req.query.offset);
	if (req.query.sort)
		args.sort = req.query.sort;

	coreApi.getBlockList(args).then(function(data) {
		res.json(data);

		utils.perfMeasure(req);
	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/blocks-by-height/:blockHeights", function(req, res, next) {
	var blockHeightStrs = req.params.blockHeights.split(",");

	var blockHeights = [];
	for (var i = 0; i < blockHeightStrs.length; i++) {
		blockHeights.push(parseInt(blockHeightStrs[i]));
	}

	coreApi.getBlocksByHeight(blockHeights).then(function(result) {
		res.json(result);

		utils.perfMeasure(req);
	});
});

router.get("/block-headers-by-height/:blockHeights", function(req, res, next) {
	var blockHeightStrs = req.params.blockHeights.split(",");

	var blockHeights = [];
	for (var i = 0; i < blockHeightStrs.length; i++) {
		blockHeights.push(parseInt(blockHeightStrs[i]));
	}

	coreApi.getBlockHeadersByHeight(blockHeights).then(function(result) {
		res.json(result);

		utils.perfMeasure(req);
	});
});

router.get("/block-stats-by-height/:blockHeights", function(req, res, next) {
	var blockHeightStrs = req.params.blockHeights.split(",");

	var blockHeights = [];
	for (var i = 0; i < blockHeightStrs.length; i++) {
		blockHeights.push(parseInt(blockHeightStrs[i]));
	}

	coreApi.getBlocksStatsByHeight(blockHeights).then(function(result) {
		res.json(result);

		utils.perfMeasure(req);
	});
});

router.get("/txids-by-block/:blockHash", function(req, res, next) {
	coreApi.getBlock(req.params.blockHash, true).then(function(block) {
		res.json(block.tx);
		utils.perfMeasure(req);
	});
});

router.get("/check-for-new-block/:maxH", function(req, res, next) {
	var maxH = req.params.maxH;
	coreApi.getBlockchainInfo().then(function(bci) {
		var latestHeight = bci.blocks;
		var chain = bci.chain;
		var reload = false;

		if ((maxH < latestHeight) && (chain != "regtest")) {
			reload = true;
		}
		res.json(reload);
	});

});

router.get("/txpool-txs/:txids", function(req, res, next) {
	var txids = req.params.txids.split(",");

	var promises = [];

	for (var i = 0; i < txids.length; i++) {
		promises.push(coreApi.getTxpoolTxDetails(txids[i], false));
	}

	Promise.all(promises).then(function(results) {
		res.json(results);

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/raw-tx-with-inputs/:txid", function(req, res, next) {
	var txid = req.params.txid;

	var promises = [];

	promises.push(coreApi.getRawTransactionsWithInputs([txid]));

	Promise.all(promises).then(function(results) {
		res.json(results);

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/block-tx-summaries/:blockHeight/:txids", function(req, res, next) {
	var blockHeight = parseInt(req.params.blockHeight);
	var txids = req.params.txids.split(",");

	var promises = [];

	var results = [];

	promises.push(new Promise(function(resolve, reject) {
		coreApi.buildBlockAnalysisData(blockHeight, txids, 0, results, resolve);
	}));

	Promise.all(promises).then(function() {
		res.json(results);

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

// returns the amount of satoshis minted at the current
// tip height
router.get("/coinsupply", function(req, res, next) {
	coreApi.getBlockCount().then(function(blocks) {
		const data = utils.getCoinsMinted(parseInt(blocks));
		res.set('Content-Type', 'text/json')
		res.send(data)
		//res.json(new Number(data).toFixed(2));
		utils.perfMeasure(req);
	});
});

router.get("/utils/:func/:params", function(req, res, next) {
	var func = req.params.func;
	var params = req.params.params;

	var data = null;

	if (func == "formatLargeNumber") {
		if (params.indexOf(",") > -1) {
			var parts = params.split(",");

			data = utils.formatLargeNumber(parseInt(parts[0]), parseInt(parts[1]));

		} else {
			data = utils.formatLargeNumber(parseInt(params));
		}
	} else if (func == "formatCurrencyAmountInSmallestUnits") {
		var parts = params.split(",");

		data = utils.formatCurrencyAmountInSmallestUnits(new Decimal(parts[0]), parseInt(parts[1]));

	} else {
		data = {success:false, error:`Unknown function: ${func}`};
	}

	res.json(data);
	utils.perfMeasure(req);
});



export default router;
