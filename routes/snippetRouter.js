import express from 'express';
const router = express.Router();

import utils from './../app/utils.js';
router.get("/formatCurrencyAmount/:amt", function(req, res, next) {
	res.locals.currencyValue = req.params.amt;

	res.render("includes/value-display");
	utils.perfMeasure(req);

});

export default router;
