import os from 'os'
import path from 'path';
import url from 'url'

import fs from 'fs'
import dotenv from 'dotenv'

var configPaths = [ path.join(os.homedir(), '.config', 'nex-rpc-explorer.env'), path.join(process.cwd(), '.env') ];
configPaths.filter(fs.existsSync).forEach(path => {
	console.log('Loading env file:', path);
	dotenv.config({ path });
});

var btcUri = process.env.XENAEXP_XENAD_URI ? url.parse(process.env.XENAEXP_XENAD_URI, true) : { query: { } };
var btcAuth = btcUri.auth ? btcUri.auth.split(':') : [];

export default {
	rpc: {
		host: btcUri.hostname || process.env.XENAEXP_XENAD_HOST || "127.0.0.1",
		port: btcUri.port || process.env.XENAEXP_XENAD_PORT || 7227,
		username: btcAuth[0] || process.env.XENAEXP_XENAD_USER || 'explorer',
		password: btcAuth[1] || process.env.XENAEXP_XENAD_PASS || 'explorer',
		cookie: btcUri.query.cookie || process.env.XENAEXP_XENAD_COOKIE || path.join(os.homedir(), '.xena', '.cookie'),
		timeout: parseInt(btcUri.query.timeout || process.env.XENAEXP_XENAD_RPC_TIMEOUT || 5000),
	},

	// optional: enter your api access key from, mapbox below
	// to include a map of the estimated locations of your node's
	// peers
	mapBoxKey: process.env.XENAEXP_MAPBOX_KEY,

	// optional: ip-api.com API KEY to get geodat from IP address.
	ipApiKey: process.env.XENAEXP_IPAPI_KEY,

	// optional: GA tracking code
	// format: "UA-..."
	googleAnalyticsTrackingId: process.env.XENAEXP_GANALYTICS_TRACKING,

	// optional: sentry.io error-tracking url
	// format: "SENTRY_IO_URL"
	sentryUrl: process.env.XENAEXP_SENTRY_URL,
};
