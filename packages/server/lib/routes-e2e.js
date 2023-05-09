"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoutesE2E = void 0;
const tslib_1 = require("tslib");
const body_parser_1 = tslib_1.__importDefault(require("body-parser"));
const debug_1 = tslib_1.__importDefault(require("debug"));
const express_1 = require("express");
const fs_extra_1 = tslib_1.__importDefault(require("fs-extra"));
const path_1 = tslib_1.__importDefault(require("path"));
const app_data_1 = tslib_1.__importDefault(require("./util/app_data"));
const cache_buster_1 = tslib_1.__importDefault(require("./util/cache_buster"));
const spec_1 = tslib_1.__importDefault(require("./controllers/spec"));
const reporter_1 = tslib_1.__importDefault(require("./controllers/reporter"));
const client_1 = tslib_1.__importDefault(require("./controllers/client"));
const files_1 = tslib_1.__importDefault(require("./controllers/files"));
const plugins = tslib_1.__importStar(require("./plugins"));
const debug = (0, debug_1.default)('cypress:server:routes-e2e');
const createRoutesE2E = ({ config, networkProxy, onError, getSpec, }) => {
    const routesE2E = (0, express_1.Router)();
    // routing for the actual specs which are processed automatically
    // this could be just a regular .js file or a .coffee file
    routesE2E.get(`/${config.namespace}/tests`, (req, res, next) => {
        // slice out the cache buster
        const test = cache_buster_1.default.strip(req.query.p);
        spec_1.default.handle(test, req, res, config, next, onError);
    });
    routesE2E.get(`/${config.namespace}/get-file/:filePath`, async (req, res) => {
        const { filePath } = req.params;
        debug('get file: %s', filePath);
        try {
            const contents = await fs_extra_1.default.readFile(filePath);
            res.json({ contents: contents.toString() });
        }
        catch (err) {
            const errorMessage = `Getting the file at the following path errored:\nPath: ${filePath}\nError: ${err.stack}`;
            debug(errorMessage);
            res.json({
                error: errorMessage,
            });
        }
    });
    routesE2E.post(`/${config.namespace}/process-origin-callback`, body_parser_1.default.json(), async (req, res) => {
        try {
            const { file, fn, projectRoot } = req.body;
            debug('process origin callback: %s', fn);
            const contents = await plugins.execute('_process:cross:origin:callback', { file, fn, projectRoot });
            res.json({ contents });
        }
        catch (err) {
            const errorMessage = `Processing the origin callback errored:\n\n${err.stack}`;
            debug(errorMessage);
            res.json({
                error: errorMessage,
            });
        }
    });
    routesE2E.get(`/${config.namespace}/socket.io.js`, (req, res) => {
        client_1.default.handle(req, res);
    });
    routesE2E.get(`/${config.namespace}/reporter/*`, (req, res) => {
        reporter_1.default.handle(req, res);
    });
    routesE2E.get(`/${config.namespace}/automation/getLocalStorage`, (req, res) => {
        res.sendFile(path_1.default.join(__dirname, './html/get-local-storage.html'));
    });
    routesE2E.get(`/${config.namespace}/automation/setLocalStorage`, (req, res) => {
        const origin = req.originalUrl.slice(req.originalUrl.indexOf('?') + 1);
        networkProxy.http.getRenderedHTMLOrigins()[origin] = true;
        res.sendFile(path_1.default.join(__dirname, './html/set-local-storage.html'));
    });
    routesE2E.get(`/${config.namespace}/source-maps/:id.map`, (req, res) => {
        networkProxy.handleSourceMapRequest(req, res);
    });
    // special fallback - serve local files from the project's root folder
    routesE2E.get('/__root/*', (req, res) => {
        const file = path_1.default.join(config.projectRoot, req.params[0]);
        res.sendFile(file, { etag: false });
    });
    // special fallback - serve dist'd (bundled/static) files from the project path folder
    routesE2E.get(`/${config.namespace}/bundled/*`, (req, res) => {
        const file = app_data_1.default.getBundledFilePath(config.projectRoot, path_1.default.join('src', req.params[0]));
        debug(`Serving dist'd bundle at file path: %o`, { path: file, url: req.url });
        res.sendFile(file, { etag: false });
    });
    // TODO: The below route is not technically correct for cypress in cypress tests.
    // We should be using 'config.namespace' to provide the namespace instead of hard coding __cypress, however,
    // In the runner when we create the spec bridge we have no knowledge of the namespace used by the server so
    // we create a spec bridge for the namespace of the server specified in the config, but that server hasn't been created.
    // To fix this I think we need to find a way to listen in the cypress in cypress server for routes from the server the
    // cypress instance thinks should exist, but that's outside the current scope.
    routesE2E.get('/__cypress/spec-bridge-iframes', (req, res) => {
        debug('handling cross-origin iframe for domain: %s', req.hostname);
        // Chrome plans to make document.domain immutable in Chrome 109, with the default value
        // of the Origin-Agent-Cluster header becoming 'true'. We explicitly disable this header
        // in the spec-bridge-iframe to allow setting document.domain to the bare domain
        // to guarantee the spec bridge can communicate with the injected code.
        // @see https://github.com/cypress-io/cypress/issues/25010
        res.setHeader('Origin-Agent-Cluster', '?0');
        files_1.default.handleCrossOriginIframe(req, res, config);
    });
    return routesE2E;
};
exports.createRoutesE2E = createRoutesE2E;
