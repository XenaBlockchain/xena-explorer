import debug from 'debug';
const debugLog = debug('nexexp:router');

import express from 'express';
import csurf from 'csurf';
const router = express.Router();
import util from 'util';
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




router.get("/formatCurrencyAmount/:amt", function(req, res, next) {
	res.locals.currencyValue = req.params.amt;

	res.render("includes/value-display");
	utils.perfMeasure(req);

});

export default router;
