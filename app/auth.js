import basicAuth from 'basic-auth';

export default (pass) => (req, res, next) => {
    const cred = basicAuth(req);

    if (cred && cred.pass === pass) {
        req.authenticated = true;
        return next();
    }

    res.set('WWW-Authenticate', `Basic realm="Private Area"`)
        .sendStatus(401);
};
